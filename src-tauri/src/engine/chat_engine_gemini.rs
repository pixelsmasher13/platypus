use crate::configuration::state::ServiceAccess;
use crate::engine::similarity_search_engine::DEFAULT_RAG_TOP_K;
use crate::engine::project_vector_engine::search_project_vectors;
use crate::repository::settings_repository::get_setting;
use crate::repository::chunk_repository::{get_chunks_by_ids, get_chunk_sources, ChunkSource};
use log::{debug, error};
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};

// Constants for Gemini model versions
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent";

#[derive(Serialize, Deserialize)]
pub struct Message {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<Content>,
    generation_config: GenerationConfig,
}

#[derive(Serialize)]
struct Content {
    role: String,
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct Part {
    text: String,
}

#[derive(Serialize)]
struct GenerationConfig {
    max_output_tokens: usize,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<Candidate>,
}

#[derive(Deserialize)]
struct Candidate {
    content: CandidateContent,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Vec<CandidatePart>,
}

#[derive(Deserialize)]
struct CandidatePart {
    text: String,
}

#[tauri::command]
pub async fn send_prompt_to_gemini(
    app_handle: tauri::AppHandle,
    conversation_history: Vec<Message>,
    is_first_message: bool,
    combined_activity_text: String,
    model_id: Option<String>,
    project_id: Option<i64>, // Project ID for chunk-based retrieval
) -> Result<(), String> {
    let setting =
        app_handle.db(|db| get_setting(db, "api_key_gemini").expect("Failed on api_key_gemini"));
    let setting_openai =
        app_handle.db(|db| get_setting(db, "api_key_open_ai").expect("Failed on api_key_open_ai"));

    // Configure client with keep-alive and proper timeouts
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .tcp_keepalive(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(2)
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let _model_to_use = match model_id.as_deref() {
        Some("gemini-3-pro-preview") => "gemini-3-pro-preview",
        _ => "gemini-2.0-flash", // Default
    };
    let rag_top_k: usize = app_handle
        .db(|db| get_setting(db, "rag_top_k"))
        .map(|s| s.setting_value.parse().unwrap_or(DEFAULT_RAG_TOP_K))
        .unwrap_or(DEFAULT_RAG_TOP_K);

    let mut filtered_context = String::new();

    if is_first_message {
        let user_prompt = conversation_history
            .last()
            .map(|msg| msg.content.clone())
            .unwrap_or_default();

        // Use per-project vector index if project_id is provided
        if let Some(pid) = project_id {
            debug!("Using per-project vector search for project {}", pid);

            match search_project_vectors(&app_handle, pid, &user_prompt, rag_top_k, &setting_openai.setting_value).await {
                Ok(similar_chunk_ids) if !similar_chunk_ids.is_empty() => {
                    let chunk_ids_to_fetch: Vec<i64> = similar_chunk_ids
                        .iter()
                        .map(|(id, _)| *id)
                        .collect();

                    debug!("Retrieved {} similar chunks from project index", chunk_ids_to_fetch.len());

                    let chunks = app_handle
                        .db(|conn| get_chunks_by_ids(conn, &chunk_ids_to_fetch))
                        .map_err(|e| format!("Failed to get chunk content: {}", e))?;

                    // Get source information for citations
                    let sources: Vec<ChunkSource> = app_handle
                        .db(|conn| get_chunk_sources(conn, &chunk_ids_to_fetch))
                        .unwrap_or_else(|e| {
                            error!("Failed to get chunk sources: {}", e);
                            vec![]
                        });

                    // Emit sources to frontend
                    if !sources.is_empty() {
                        if let Err(e) = app_handle
                            .get_window("main")
                            .expect("Failed to get main window")
                            .emit("llm_sources", &sources)
                        {
                            error!("Failed to emit sources: {}", e);
                        }
                    }

                    for (index, chunk) in chunks.iter().enumerate() {
                        filtered_context.push_str(&format!(
                            "Chunk {} (from document {}):\n{}\n\n",
                            index + 1, chunk.document_id, chunk.chunk_text
                        ));
                    }
                }
                Ok(_) => {
                    debug!("No vectorized chunks found for project");
                }
                Err(e) => {
                    debug!("Project vector search failed: {}", e);
                }
            }
        }
    }

    // Build system instruction with RAG context if available
    let system_instruction = if !filtered_context.is_empty() {
        format!(
            "You are Platypus, a friendly and helpful AI note-taking assistant powered by Google Gemini. Keep your tone warm and helpful. Provide answers in markdown format.\n\n\
            The following document chunks were retrieved from the user's project and may help answer their question. Use them if relevant, otherwise ignore them:\n\n{}",
            filtered_context
        )
    } else {
        "You are Platypus, a friendly and helpful AI note-taking assistant powered by Google Gemini. Keep your tone warm and helpful. Provide answers in markdown format.".to_string()
    };

    // Build contents array using Gemini's native multi-turn format
    let mut contents: Vec<Content> = vec![];

    for (i, msg) in conversation_history.iter().enumerate() {
        let mut content = msg.content.clone();

        // For first user message, prepend system instruction and add activity context if needed
        if i == 0 && msg.role == "user" {
            let mut prefix = format!("{}\n\n", system_instruction);
            if !combined_activity_text.is_empty() && filtered_context.is_empty() {
                prefix.push_str(&format!("Context from selected documents:\n{}\n\n", combined_activity_text));
            }
            content = format!("{}{}", prefix, content);
        }

        // Gemini uses "model" instead of "assistant"
        let role = if msg.role == "assistant" { "model" } else { "user" };

        contents.push(Content {
            role: role.to_string(),
            parts: vec![Part { text: content }],
        });
    }

    let api_url = format!("{}?key={}", GEMINI_URL, setting.setting_value);

    let request_body = GeminiRequest {
        contents,
        generation_config: GenerationConfig {
            max_output_tokens: 2500,
        },
    };

    // Make the request to Gemini API with retries
    let mut attempt = 0;
    let max_retries = 3;
    let mut delay = Duration::from_secs(1);

    loop {
        let response = client
            .post(&api_url)
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    return handle_gemini_response(resp, app_handle).await;
                } else {
                    let error_message = resp.text().await
                        .map_err(|e| format!("Failed to read error message: {}", e))?;
                    error!("Gemini API error: {}", error_message);
                    return Err(format!("Error from Gemini API: {}", error_message));
                }
            }
            Err(e) => {
                if attempt < max_retries {
                    attempt += 1;
                    error!("Request to Gemini API failed: {}. Retrying... (Attempt {}/{})", e, attempt, max_retries);
                    tokio::time::sleep(delay).await;
                    delay *= 2;
                } else {
                    let error_message = "Apologies, Gemini API appears to be down right now - please try again later";
                    error!("Request failed after {} attempts: {}", max_retries, e);
                    app_handle
                        .get_window("main")
                        .expect("Failed to get main window")
                        .emit("llm_response", error_message.to_string())
                        .map_err(|emit_err| format!("Failed to emit error message: {}", emit_err))?;
                    return Err(error_message.to_string());
                }
            }
        }
    }
}

async fn handle_gemini_response(
    response: Response,
    app_handle: AppHandle,
) -> Result<(), String> {
    let response_body: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    let completion = if let Some(candidate) = response_body.candidates.first() {
        if let Some(part) = candidate.content.parts.first() {
            part.text.clone()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Emit the response
    app_handle
        .get_window("main")
        .expect("Failed to get main window")
        .emit("llm_response", completion.clone())
        .map_err(|e| format!("Failed to emit response: {}", e))?;

    // Estimate token usage
    let word_count = completion.split_whitespace().count();
    let output_tokens = (word_count as f64 * 0.75) as u32;
    
    app_handle
        .get_window("main")
        .expect("Failed to get main window")
        .emit("output_tokens", output_tokens)
        .map_err(|e| format!("Failed to emit output tokens: {}", e))?;

    debug!("Gemini response complete - output tokens: {}", output_tokens);
    Ok(())
}

#[tauri::command]
pub async fn name_conversation_gemini(
    app_handle: tauri::AppHandle,
    user_input: String,
) -> Result<String, String> {
    let setting =
        app_handle.db(|db| get_setting(db, "api_key_gemini").expect("Failed on api_key_gemini"));

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let system_prompt = "Name the conversation based on the user input. Use a total of 18 characters or less, without quotation marks. You only need to answer with the name.";
    
    let contents = vec![
        Content {
            role: "user".to_string(),
            parts: vec![Part { text: format!("{}\n\n{}", system_prompt, user_input) }],
        },
    ];

    let api_url = format!("{}?key={}", GEMINI_URL, setting.setting_value);

    let request_body = GeminiRequest {
        contents,
        generation_config: GenerationConfig {
            max_output_tokens: 20,
        },
    };

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if response.status().is_success() {
        let response_body: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        
        let generated_name = if let Some(candidate) = response_body.candidates.first() {
            if let Some(part) = candidate.content.parts.first() {
                part.text.trim().to_string()
            } else {
                "Unnamed Conversation".to_string()
            }
        } else {
            "Unnamed Conversation".to_string()
        };
        
        Ok(generated_name)
    } else {
        let error_message = response.text().await
            .map_err(|e| format!("Failed to read error message: {}", e))?;
        Err(format!("Error from Gemini API: {}", error_message))
    }
}
