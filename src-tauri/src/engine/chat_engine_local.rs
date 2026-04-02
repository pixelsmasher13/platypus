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

// Default model for local Ollama
const DEFAULT_MODEL: &str = "llama3.3:70b";

#[derive(Serialize, Deserialize)]
pub struct Message {
    role: String,
    content: String,
}

// Ollama API structures
#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: OllamaMessage,
}

#[tauri::command]
pub async fn send_prompt_to_local(
    app_handle: tauri::AppHandle,
    conversation_history: Vec<Message>,
    is_first_message: bool,
    combined_activity_text: String,
    model_id: Option<String>,
    project_id: Option<i64>, // Project ID for chunk-based retrieval
) -> Result<(), String> {
    // Get local model URL from settings (defaults to localhost:11434 for Ollama)
    let setting = app_handle.db(|db| get_setting(db, "local_model_url").expect("Failed on local_model_url"));
    let base_url = if setting.setting_value.is_empty() {
        "http://localhost:11434".to_string()
    } else {
        setting.setting_value
    };

    // Configure client with longer timeouts for local models
    let client = Client::builder()
        .timeout(Duration::from_secs(300))  // Longer timeout for local inference
        .tcp_keepalive(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(2)
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let model_to_use = match model_id.as_deref() {
        Some(model) => model.to_string(),
        _ => DEFAULT_MODEL.to_string(),
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

        let setting_openai = app_handle.db(|db| {
            get_setting(db, "api_key_open_ai").expect("Failed on api_key_open_ai")
        });

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

    // Build system prompt - include RAG context only on first message
    let system_prompt = if !filtered_context.is_empty() {
        format!(
            "You are Platypus, a friendly and helpful AI note-taking assistant running locally via Ollama. Keep your tone warm and helpful. Provide answers in markdown format.\n\n\
            The following document chunks were retrieved from the user's project and may help answer their question. Use them if relevant, otherwise ignore them:\n\n{}",
            filtered_context
        )
    } else {
        "You are Platypus, a friendly and helpful AI note-taking assistant running locally via Ollama. Keep your tone warm and helpful. Provide answers in markdown format.".to_string()
    };

    // Build Ollama messages using native multi-turn format
    let mut messages: Vec<OllamaMessage> = vec![
        OllamaMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
    ];

    for (i, msg) in conversation_history.iter().enumerate() {
        let mut content = msg.content.clone();

        // Add combined_activity_text to first user message if no RAG context
        if i == 0 && msg.role == "user" && !combined_activity_text.is_empty() && filtered_context.is_empty() {
            content = format!(
                "{}\n\nContext from selected documents:\n{}",
                content, combined_activity_text
            );
        }

        messages.push(OllamaMessage {
            role: msg.role.clone(),
            content,
        });
    }

    let api_url = format!("{}/api/chat", base_url);

    let request_body = OllamaRequest {
        model: model_to_use,
        messages,
        stream: false,
    };

    // Make the request to Ollama
    let mut attempt = 0;
    let max_retries = 3;
    let mut delay = Duration::from_secs(2);

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
                    return handle_ollama_response(resp, app_handle).await;
                } else {
                    let error_message = resp.text().await
                        .map_err(|e| format!("Failed to read error message: {}", e))?;
                    error!("Ollama error: {}", error_message);
                    return Err(format!("Error from Ollama: {}. Make sure Ollama is running and the model is downloaded.", error_message));
                }
            }
            Err(e) => {
                if attempt < max_retries {
                    attempt += 1;
                    error!("Request to Ollama failed: {}. Retrying... (Attempt {}/{})", e, attempt, max_retries);
                    tokio::time::sleep(delay).await;
                    delay *= 2;
                } else {
                    let error_message = "Could not connect to Ollama. Make sure Ollama is running (ollama serve) and try again.";
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

async fn handle_ollama_response(
    response: Response,
    app_handle: AppHandle,
) -> Result<(), String> {
    let response_body: OllamaResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let completion = response_body.message.content;

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

    debug!("Ollama response complete - output tokens: {}", output_tokens);
    Ok(())
}

#[tauri::command]
pub async fn name_conversation_local(
    app_handle: tauri::AppHandle,
    user_input: String,
) -> Result<String, String> {
    let setting = app_handle.db(|db| get_setting(db, "local_model_url").expect("Failed on local_model_url"));
    let base_url = if setting.setting_value.is_empty() {
        "http://localhost:11434".to_string()
    } else {
        setting.setting_value
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let messages = vec![
        OllamaMessage {
            role: "system".to_string(),
            content: "Name the conversation based on the user input. Use a total of 18 characters or less, without quotation marks. You only need to answer with the name.".to_string(),
        },
        OllamaMessage {
            role: "user".to_string(),
            content: user_input,
        },
    ];

    let api_url = format!("{}/api/chat", base_url);

    let request_body = OllamaRequest {
        model: DEFAULT_MODEL.to_string(),
        messages,
        stream: false,
    };

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if response.status().is_success() {
        let response_body: OllamaResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let generated_name = response_body.message.content.trim().to_string();
        if generated_name.is_empty() {
            Ok("Unnamed Conversation".to_string())
        } else {
            Ok(generated_name)
        }
    } else {
        let error_message = response.text().await
            .map_err(|e| format!("Failed to read error message: {}", e))?;
        Err(format!("Error from Ollama: {}", error_message))
    }
}
