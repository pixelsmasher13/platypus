use futures::StreamExt;
use log::{debug, error, info};
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::configuration::state::ServiceAccess;
use crate::engine::similarity_search_engine::DEFAULT_RAG_TOP_K;
use crate::engine::project_vector_engine::search_project_vectors;
use crate::repository::settings_repository::get_setting;
use crate::repository::chunk_repository::{get_chunks_by_ids, get_chunk_sources, ChunkSource};

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: usize,
    messages: Vec<Message>,
    system: Vec<SystemBlock>,
    stream: bool,
}

#[derive(Serialize)]
struct SystemBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<CacheControl>,
}

#[derive(Serialize)]
struct CacheControl {
    #[serde(rename = "type")]
    cache_type: String,
}

#[derive(Serialize, Deserialize)]
pub struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<Content>,
    usage: Usage,
}

#[derive(Deserialize)]
struct Usage {
    input_tokens: u32,
    output_tokens: u32,
}

#[derive(Deserialize)]
struct Content {
    text: String,
}

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTRHOPIC_MODEL: &str = "claude-haiku-4-5";
const ANTRHOPIC_MAIN_MODEL: &str = "claude-opus-4-6";
const ANTRHOPIC_MODEL_CHEAP: &str = "claude-haiku-4-5";

#[tauri::command]
pub async fn send_prompt_to_llm(
    app_handle: tauri::AppHandle,
    conversation_history: Vec<Message>,
    is_first_message: bool,
    combined_activity_text: String,
    model_id: Option<String>,
    project_id: Option<i64>, // Project ID for chunk-based retrieval
) -> Result<(), String> {
    let setting =
        app_handle.db(|db| get_setting(db, "api_key_claude").expect("Failed on api_key_claude"));
    let setting_openai =
        app_handle.db(|db| get_setting(db, "api_key_open_ai").expect("Failed on api_key_open_ai"));
    let rag_top_k: usize = app_handle
        .db(|db| get_setting(db, "rag_top_k"))
        .map(|s| s.setting_value.parse().unwrap_or(DEFAULT_RAG_TOP_K))
        .unwrap_or(DEFAULT_RAG_TOP_K);

    // Configure client with keep-alive and proper timeouts
    let client = Client::builder()
        .timeout(Duration::from_secs(180))  // Increased timeout
        .tcp_keepalive(Duration::from_secs(60))  // Keep connection alive for 60 seconds
        .pool_idle_timeout(Duration::from_secs(90))  // Allow connections to stay in pool
        .pool_max_idle_per_host(2)  // Keep up to 2 idle connections per host
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let model_to_use = match model_id.as_deref() {
        Some("claude-opus-4-6") => "claude-opus-4-6",
        Some("claude-sonnet-4-6") => "claude-sonnet-4-6",
        Some("claude-sonnet-4-5") => "claude-sonnet-4-5",
        Some("claude-haiku-4-5") => "claude-haiku-4-5",
        _ => "claude-sonnet-4-6", // Default to Claude Sonnet 4.6
    };
    let mut filtered_context = String::new();
    let window_titles: Vec<String> = Vec::new();
    if is_first_message {
        let user_prompt = conversation_history
            .last()
            .map(|msg| msg.content.clone())
            .unwrap_or_default();
        debug!("User Prompt: {}", user_prompt);

        let mut context = String::new();

        // Use per-project vector index if project_id is provided
        if let Some(pid) = project_id {
            debug!("Using per-project vector search for project {}", pid);
            
            // Search directly in project's vector index
            match search_project_vectors(&app_handle, pid, &user_prompt, rag_top_k, &setting_openai.setting_value).await {
                Ok(similar_chunk_ids) if !similar_chunk_ids.is_empty() => {
                    let chunk_ids_to_fetch: Vec<i64> = similar_chunk_ids
                        .iter()
                        .map(|(id, _)| *id)
            .collect();

                    debug!("Retrieved {} similar chunks from project index", chunk_ids_to_fetch.len());
                    
                    // Get chunk content
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
                    
                    // Build context from chunks (no relevance filtering needed - chunks are small)
                    for (index, chunk) in chunks.iter().enumerate() {
                        context.push_str(&format!(
                            "Chunk {} (from document {}):\n{}\n\n",
                            index + 1, chunk.document_id, chunk.chunk_text
                        ));
                    }
                    
                    // Set filtered_context directly since chunks are already relevant
                    filtered_context = context.clone();
                }
                Ok(_) => {
                    debug!("No vectorized chunks found for project, falling back to legacy search");
                }
                Err(e) => {
                    debug!("Project vector search failed: {}, falling back to legacy search", e);
                }
            }
        }

        // No project selected = no RAG
        if project_id.is_none() {
            debug!("No project selected, skipping RAG retrieval");
        }

        // RAG retrieval complete - filtered_context already set from chunk search above
    }

    // Build system prompt - include RAG context only on first message
    let system_prompt = if !filtered_context.is_empty() {
        format!(
            "You are Platypus, a friendly and helpful AI note-taking assistant powered by Anthropic. Keep your tone warm and helpful. Provide answers in markdown format.\n\n\
            The following document chunks were retrieved from the user's project and may help answer their question. Use them if relevant, otherwise ignore them:\n\n{}",
            filtered_context
        )
    } else {
        "You are Platypus, a friendly and helpful AI note-taking assistant powered by Anthropic. Keep your tone warm and helpful. Provide answers in markdown format.".to_string()
    };

    // Build messages array using Claude's native multi-turn format
    let mut messages: Vec<Message> = conversation_history
        .iter()
        .map(|msg| Message {
            role: msg.role.clone(),
            content: msg.content.clone(),
        })
        .collect();

    // Add combined_activity_text to first user message if no RAG context
    if !combined_activity_text.is_empty() && filtered_context.is_empty() {
        if let Some(first_user_msg) = messages.iter_mut().find(|m| m.role == "user") {
            first_user_msg.content = format!(
                "{}\n\nContext from selected documents:\n{}",
                first_user_msg.content, combined_activity_text
            );
        }
    }

    // Wrap the system prompt with prompt caching enabled.
    // Anthropic silently ignores cache_control if the block is below the
    // minimum cacheable size (~1024 tokens), so this is safe for short prompts.
    let request_body = ClaudeRequest {
        model: model_to_use.to_string(),
        max_tokens: 4096,
        messages,
        system: vec![SystemBlock {
            block_type: "text".to_string(),
            text: system_prompt,
            cache_control: Some(CacheControl {
                cache_type: "ephemeral".to_string(),
            }),
        }],
        stream: true,
    };

    let mut attempt = 0;
    let max_retries = 3;
    let mut delay = Duration::from_secs(1);

    loop {
        let response = client
            .post(ANTHROPIC_URL)
            .header("Content-Type", "application/json")
            .header("x-api-key", &setting.setting_value)
            .header("anthropic-version", "2023-06-01")
            .header("Connection", "keep-alive")
            .json(&request_body)
            .send()
            .await;

        match response {
            Ok(resp) => {
                return handle_success_response(resp, app_handle, window_titles.clone()).await;
            }
            Err(e) => {
                if attempt < max_retries {
                    attempt += 1;
                    error!(
                        "Request to Claude API failed: {}. Retrying... (Attempt {}/{})",
                        e, attempt, max_retries
                    );
                    tokio::time::sleep(delay).await;
                    delay *= 2;  // Exponential backoff
                } else {
                    let error_message =
                        "Apologies, Claude API appears to be down right now - please try again later or switch to OpenAI for the time being";
                    error!("Request failed after {} attempts: {}", max_retries, e);
                    app_handle
                        .get_window("main")
                        .expect("Failed to get main window")
                        .emit("llm_response", error_message.to_string())
                        .map_err(|emit_err| {
                            format!("Failed to emit error message: {}", emit_err)
                        })?;
                    return Err(error_message.to_string());
                }
            }
        }
    }
}

async fn handle_success_response(
    response: Response,
    app_handle: AppHandle,
    window_titles: Vec<String>,
) -> Result<(), String> {
    if response.status().is_success() {
        let mut stream = response.bytes_stream();
        let mut completion = String::new();
        let mut input_tokens = 0;
        let mut output_tokens = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;
            let text = String::from_utf8_lossy(&chunk);

            for line in text.lines() {
                if !line.starts_with("data: ") {
                    continue;
                }
                
                let data = line[6..].trim();
                
                // Skip empty data lines
                if data.is_empty() {
                    continue;
                }

                // Handle ping events - these keep the connection alive
                if data == "{\"type\": \"ping\"}" {
                    debug!("Received ping event");
                    continue;
                }

                // Parse the event data
                let json_data: serde_json::Value = match serde_json::from_str(data) {
                    Ok(data) => data,
                    Err(e) => {
                        error!("Failed to parse event data: {}", e);
                        continue;
                    }
                };

                // Handle error events
                if let Some("error") = json_data["type"].as_str() {
                    if let Some(error) = json_data["error"].as_object() {
                        let error_type = error["type"].as_str().unwrap_or("unknown");
                        let error_message = error["message"].as_str().unwrap_or("Unknown error");
                        
                        error!("Received error event: {} - {}", error_type, error_message);
                        
                        match error_type {
                            "overloaded_error" => {
                                return Err("Service is currently overloaded. Please try again later.".to_string());
                            }
                            _ => {
                                return Err(format!("Stream error: {}", error_message));
                            }
                        }
                    }
                }

                // Handle different event types
                match json_data["type"].as_str() {
                    Some("message_start") => {
                        if let Some(usage) = json_data["message"]["usage"].as_object() {
                            input_tokens = usage["input_tokens"].as_u64().unwrap_or(0) as u32;
                            output_tokens = usage["output_tokens"].as_u64().unwrap_or(0) as u32;
                            info!("Input tokens: {}", input_tokens);
                        }
                        if let Some(model) = json_data["message"]["model"].as_str() {
                            info!("Using model: {}", model);
                        }
                    }
                    Some("content_block_delta") => {
                        if let Some(delta) = json_data["delta"]["text"].as_str() {
                            completion.push_str(delta);
                            
                            // Emit updates to frontend more frequently
                            app_handle
                                .get_window("main")
                                .expect("Failed to get main window")
                                .emit("llm_response", completion.clone())
                                .map_err(|e| format!("Failed to emit response: {}", e))?;
                        }
                    }
                    Some("message_delta") => {
                        if let Some(usage) = json_data["usage"].as_object() {
                            output_tokens = usage["output_tokens"].as_u64().unwrap_or(0) as u32;
                        }
                    }
                    Some("message_stop") => {
                        info!("Response complete - Input: {} tokens, Output: {} tokens, Total: {} tokens",
                            input_tokens, output_tokens, input_tokens + output_tokens);

                        // Final emission of window titles and completion
                        app_handle
                            .get_window("main")
                            .expect("Failed to get main window")
                            .emit(
                                "window_titles",
                                serde_json::to_string(&window_titles).unwrap(),
                            )
                            .map_err(|e| format!("Failed to emit window titles: {}", e))?;

                        app_handle
                            .get_window("main")
                            .expect("Failed to get main window")
                            .emit("input_tokens", input_tokens)
                            .map_err(|e| format!("Failed to emit input tokens: {}", e))?;

                        app_handle
                            .get_window("main")
                            .expect("Failed to get main window")
                            .emit("output_tokens", output_tokens)
                            .map_err(|e| format!("Failed to emit output tokens: {}", e))?;
                    }
                    _ => {} // Ignore unknown event types
                }
            }
        }

        debug!(
            "Claude response complete - Input tokens: {}, Output tokens: {}",
            input_tokens, output_tokens
        );
        Ok(())
    } else {
        let error_message = response
            .text()
            .await
            .map_err(|e| format!("Failed to read error message: {}", e))?;
        error!("Claude API error: {}", error_message);
        Err(format!("Error from Claude API: {}", error_message))
    }
}

#[tauri::command]
pub async fn name_conversation(
    app_handle: tauri::AppHandle,
    user_input: String,
) -> Result<String, String> {
    let setting =
        app_handle.db(|db| get_setting(db, "api_key_claude").expect("Failed on api_key_claude"));

    // Use the same client configuration for consistency
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .tcp_keepalive(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(2)
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let system_prompt = format!(
        "Name the conversation based on the user input. Use a total of 18 characters or less, without quotation marks. Use proper English, don't skip spaces between words. You only need to answer with the name. The following is the user input: \n\n{}\n\n.:",
        user_input
    );
    let request_body = ClaudeRequest {
        model: ANTRHOPIC_MODEL_CHEAP.to_string(),
        max_tokens: 20,
        messages: vec![Message {
            role: "user".to_string(),
            content: "Please generate a concise name for the conversation based on the user input."
                .to_string(),
        }],
        system: vec![SystemBlock {
            block_type: "text".to_string(),
            text: system_prompt,
            cache_control: None,
        }],
        stream: false,
    };

    let response = client
        .post(ANTHROPIC_URL)
        .header("Content-Type", "application/json")
        .header("x-api-key", &setting.setting_value)
        .header("anthropic-version", "2023-06-01")
        .header("Connection", "keep-alive")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if response.status().is_success() {
        let response_body: ClaudeResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        let generated_name = response_body.content[0].text.trim().to_string();
        Ok(generated_name)
    } else {
        let error_message = response
            .text()
            .await
            .map_err(|e| format!("Failed to read error message: {}", e))?;
        Err(format!("Error from Claude API: {}", error_message))
    }
}

// Legacy identify_relevant_keywords removed - no longer used with per-project vector search