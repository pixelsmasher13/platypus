use crate::engine::chatgpt_auth;
use crate::engine::model_settings::saved_effort;
use platypus_notes::models::{selected_model, DEFAULT_OPENAI_MODEL, QUICK_OPENAI_MODEL, send_openai, StreamLines};
use crate::configuration::state::ServiceAccess;
use crate::engine::similarity_search_engine::DEFAULT_RAG_TOP_K;
use crate::engine::project_vector_engine::search_project_vectors_live;
use crate::engine::rag_prompt::{build_grounded_context, grounded_system_prompt};
use crate::repository::settings_repository::get_setting;
use async_openai::{
    types::{
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        CreateChatCompletionRequestArgs, CreateChatCompletionResponse, CreateChatCompletionStreamResponse,
    },
};
use futures::StreamExt;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use tauri::Manager;


#[derive(Serialize, Deserialize)]
pub struct Message {
    role: String,
    content: String,
}

#[tauri::command]
pub async fn send_prompt_to_openai(
    app_handle: tauri::AppHandle,
    conversation_history: Vec<Message>,
    is_first_message: bool,
    combined_activity_text: String,
    model_id: Option<String>,
    project_id: Option<i64>, // Project ID for chunk-based retrieval
) -> Result<(), String> {
    let setting =
        app_handle.db(|db| get_setting(db, "api_key_open_ai").expect("Failed on api_key_open_ai"));

    let mut filtered_context = String::new();
    let model_to_use = selected_model(model_id.as_deref(), DEFAULT_OPENAI_MODEL);
    let rag_top_k: usize = app_handle
        .db(|db| get_setting(db, "rag_top_k"))
        .map(|s| s.setting_value.parse().unwrap_or(DEFAULT_RAG_TOP_K))
        .unwrap_or(DEFAULT_RAG_TOP_K);

    if is_first_message {
        let user_prompt = conversation_history
            .last()
            .map(|msg| msg.content.clone())
            .unwrap_or_default();

        // Use per-project vector index if project_id is provided
        if let Some(pid) = project_id {
            debug!("Using per-project vector search for project {}", pid);

            match search_project_vectors_live(&app_handle, pid, &user_prompt, rag_top_k, &setting.setting_value).await {
                Ok(similar_chunk_ids) if !similar_chunk_ids.is_empty() => {
                    debug!("Retrieved {} similar chunks from project index", similar_chunk_ids.len());

                    let (numbered_context, sources) = app_handle
                        .db(|conn| build_grounded_context(conn, &similar_chunk_ids))
                        .map_err(|e| format!("Failed to build RAG context: {}", e))?;

                    if !sources.is_empty() {
                        if let Err(e) = app_handle
                            .get_window("main")
                            .expect("Failed to get main window")
                            .emit("llm_sources", &sources)
                        {
                            error!("Failed to emit sources: {}", e);
                        }
                    }

                    filtered_context = numbered_context;
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

    const BASE_SYSTEM: &str = "You are Platypus, a friendly and helpful AI note-taking assistant powered by OpenAI. Keep your tone warm and helpful. Provide answers in markdown format.";
    let system_prompt = if !filtered_context.is_empty() {
        grounded_system_prompt(BASE_SYSTEM, &filtered_context)
    } else {
        BASE_SYSTEM.to_string()
    };

    // Selected-document context rides on the first user message when retrieval found nothing.
    let turns: Vec<(&str, String)> = conversation_history
        .iter()
        .enumerate()
        .map(|(i, msg)| {
            let mut content = msg.content.clone();
            if i == 0 && msg.role == "user" && !combined_activity_text.is_empty() && filtered_context.is_empty() {
                content = format!(
                    "{}\n\nContext from selected documents:\n{}",
                    content, combined_activity_text
                );
            }
            (if msg.role == "user" { "user" } else { "assistant" }, content)
        })
        .collect();

    let effort = saved_effort(&app_handle, model_to_use);
    let completion = if chatgpt_auth::is_signed_in(&app_handle) {
        let turns: Vec<(&str, &str)> = turns.iter().map(|(role, text)| (*role, text.as_str())).collect();
        let window = app_handle.get_window("main").expect("Failed to get main window");
        chatgpt_auth::complete(&app_handle, model_to_use, &system_prompt, &turns, effort.as_deref(), |text| {
            window.emit("llm_response", text).map_err(|e| format!("Failed to emit response: {}", e))
        })
        .await?
    } else {
        stream_with_api_key(&app_handle, &setting.setting_value, model_to_use, system_prompt, &turns, effort.as_deref()).await?
    };

    // Estimate token usage based on word count
    let word_count = completion.split_whitespace().count();
    let output_tokens = (word_count as f64 * 0.75) as i64;

    // Emit the estimated token usage to the frontend
    app_handle
        .get_window("main")
        .expect("Failed to get main window")
        .emit("output_tokens", output_tokens)
        .map_err(|e| format!("Failed to emit estimated tokens: {}", e))?;

    debug!("OpenAI response complete - estimated tokens: {}", output_tokens);
    Ok(())
}

async fn stream_with_api_key(
    app_handle: &tauri::AppHandle,
    api_key: &str,
    model: &str,
    system_prompt: String,
    turns: &[(&str, String)],
    effort: Option<&str>,
) -> Result<String, String> {
    // Build messages array using OpenAI's native multi-turn format
    let mut messages: Vec<ChatCompletionRequestMessage> = vec![
        ChatCompletionRequestSystemMessageArgs::default()
            .content(system_prompt)
            .build()
            .unwrap()
            .into(),
    ];

    // Add conversation history
    for (role, content) in turns {
        let content = content.clone();
        if *role == "user" {
            messages.push(
                ChatCompletionRequestUserMessageArgs::default()
                    .content(content)
                    .build()
                    .unwrap()
                    .into(),
            );
        } else {
            messages.push(
                ChatCompletionRequestAssistantMessageArgs::default()
                    .content(content)
                    .build()
                    .unwrap()
                    .into(),
            );
        }
    }

    let request = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(messages)
        .build()
        .map_err(|e| format!("Failed to build request: {}", e))?;

    let mut payload = serde_json::to_value(request).map_err(|e| e.to_string())?;
    payload["stream"] = serde_json::json!(true);
    let mut stream = send_openai(api_key, payload, effort).await?.bytes_stream();
    let mut lines = StreamLines::default();
    let mut completion = String::new();
    let mut finished = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Error while streaming response: {}", e))?;
        for line in lines.push(&chunk)? {
            let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue; };
            if data == "[DONE]" {
                finished = true;
                break;
            }
            if data.is_empty() { continue; }
            let response: CreateChatCompletionStreamResponse = serde_json::from_str(data)
                .map_err(|e| format!("Invalid OpenAI stream response: {}", e))?;
            if let Some(content) = response.choices.first().and_then(|c| c.delta.content.as_ref()) {
                completion.push_str(content);
                app_handle.get_window("main").expect("Failed to get main window")
                    .emit("llm_response", completion.clone())
                    .map_err(|e| format!("Failed to emit response: {}", e))?;
            }
        }
        if finished { break; }
    }
    if !finished {
        return Err("OpenAI response was interrupted. Please try again.".into());
    }
    if completion.trim().is_empty() {
        return Err("OpenAI returned no text. Please try again.".into());
    }
    Ok(completion)
}

#[tauri::command]
pub async fn generate_conversation_name(
    app_handle: tauri::AppHandle,
    user_input: &str,
) -> Result<String, String> {
    // Fetch the OpenAI API key from your settings
    let setting =
        app_handle.db(|db| get_setting(db, "api_key_open_ai").expect("Failed on api_key_open_ai"));

    // Define the system prompt to guide the model
    let system_prompt = format!(
        "Name the conversation based on the user input. Use a total of 18 characters or less, without quotation marks. Use proper English, don't skip spaces between words. You only need to answer with the name. The following is the user input: \n\n{}\n\n.:",
        user_input
    );
    const NAME_REQUEST: &str = "Please generate a concise name for the conversation based on the user input.";

    if chatgpt_auth::is_signed_in(&app_handle) {
        let name = chatgpt_auth::complete(
            &app_handle, QUICK_OPENAI_MODEL, &system_prompt, &[("user", NAME_REQUEST)], None, |_| Ok(()),
        )
        .await?;
        return Ok(name.trim().to_string());
    }

    let request = CreateChatCompletionRequestArgs::default()
        .model(QUICK_OPENAI_MODEL)
        .messages(vec![
            // Use the correct message type for the system message
            ChatCompletionRequestSystemMessageArgs::default()
                .content(system_prompt)
                .build()
                .unwrap()
                .into(), // Convert to correct type
            // Use the correct message type for the user message
            ChatCompletionRequestUserMessageArgs::default()
                .content(NAME_REQUEST)
                .build()
                .unwrap()
                .into(), // Convert to correct type
        ])
        .build()
        .map_err(|e| format!("generate_conversation_name request_error: {}", e))?; // Handle request building error

    let response: CreateChatCompletionResponse = send_openai(
        &setting.setting_value, serde_json::to_value(request).map_err(|e| e.to_string())?, None
    ).await?.json().await.map_err(|e| format!("Invalid OpenAI response: {}", e))?;

    // Extract the first message content safely from the response
    let generated_name = response.choices.first()
        .and_then(|choice| choice.message.content.as_ref()) // Convert Option<String> to Option<&String>
        .map(|s| s.trim().to_string()) // Trim and convert to String if Some
        .unwrap_or_else(|| "Unnamed Conversation".to_string()); // Provide fallback if None

    Ok(generated_name)
}
