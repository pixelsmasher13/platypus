use crate::configuration::state::ServiceAccess;
use crate::engine::similarity_search_engine::DEFAULT_RAG_TOP_K;
use crate::engine::project_vector_engine::search_project_vectors;
use crate::repository::settings_repository::get_setting;
use crate::repository::chunk_repository::{get_chunks_by_ids, get_chunk_sources, ChunkSource};
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        CreateChatCompletionRequestArgs,
    },
    Client as OpenAIClient,
};
use futures::StreamExt;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use tauri::Manager;

const DEFAULT_MODEL: &str = "gpt-5.4";

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
    let model_to_use = match model_id.as_deref() {
        Some("gpt-5.4") => "gpt-5.4",
        _ => "gpt-5.4",
    };
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

            match search_project_vectors(&app_handle, pid, &user_prompt, rag_top_k, &setting.setting_value).await {
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
            "You are Platypus, a friendly and helpful AI note-taking assistant powered by OpenAI. Keep your tone warm and helpful. Provide answers in markdown format.\n\n\
            The following document chunks were retrieved from the user's project and may help answer their question. Use them if relevant, otherwise ignore them:\n\n{}",
            filtered_context
        )
    } else {
        "You are Platypus, a friendly and helpful AI note-taking assistant powered by OpenAI. Keep your tone warm and helpful. Provide answers in markdown format.".to_string()
    };

    // Build messages array using OpenAI's native multi-turn format
    let mut messages: Vec<ChatCompletionRequestMessage> = vec![
        ChatCompletionRequestSystemMessageArgs::default()
            .content(system_prompt)
            .build()
            .unwrap()
            .into(),
    ];

    // Add conversation history
    for (i, msg) in conversation_history.iter().enumerate() {
        let mut content = msg.content.clone();

        // Add combined_activity_text to first user message if no RAG context
        if i == 0 && msg.role == "user" && !combined_activity_text.is_empty() && filtered_context.is_empty() {
            content = format!(
                "{}\n\nContext from selected documents:\n{}",
                content, combined_activity_text
            );
        }

        if msg.role == "user" {
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
        .model(model_to_use)
        .messages(messages)
        .build()
        .map_err(|e| format!("Failed to build request: {}", e))?;

    let response_client =
        OpenAIClient::with_config(OpenAIConfig::new().with_api_key(&setting.setting_value));
    let mut stream = response_client
        .chat()
        .create_stream(request)
        .await
        .map_err(|e| format!("Failed to create chat completion stream: {}", e))?;

    let mut completion = String::new();

    while let Some(result) = stream.next().await {
        match result {
            Ok(response) => {
                if let Some(choice) = response.choices.first() {
                    if let Some(content) = &choice.delta.content {
                        completion.push_str(content);
                    }
                }
            }
            Err(e) => {
                return Err(format!("Error while streaming response: {}", e));
            }
        }

        app_handle
            .get_window("main")
            .expect("Failed to get main window")
            .emit("llm_response", completion.clone())
            .map_err(|e| format!("Failed to emit response: {}", e))?;
    }

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

#[tauri::command]
pub async fn generate_conversation_name(
    app_handle: tauri::AppHandle,
    user_input: &str,
) -> Result<String, String> {
    // Fetch the OpenAI API key from your settings
    let setting =
        app_handle.db(|db| get_setting(db, "api_key_open_ai").expect("Failed on api_key_open_ai"));

    // Initialize the OpenAI client with the API key
    let config = OpenAIConfig::new().with_api_key(&setting.setting_value);
    let client = OpenAIClient::with_config(config);

    // Define the system prompt to guide the model
    let system_prompt = format!(
        "Name the conversation based on the user input. Use a total of 18 characters or less, without quotation marks. Use proper English, don't skip spaces between words. You only need to answer with the name. The following is the user input: \n\n{}\n\n.:",
        user_input
    );

    // Create a chat completion request with the system message and user input
    let request = CreateChatCompletionRequestArgs::default()
        .model(DEFAULT_MODEL) // Specify the model, you can use "gpt-4" if needed
        .max_tokens(20u32) // Limit the response to 20 tokens
        .messages(vec![
            // Use the correct message type for the system message
            ChatCompletionRequestSystemMessageArgs::default()
                .content(system_prompt)
                .build()
                .unwrap()
                .into(), // Convert to correct type
            // Use the correct message type for the user message
            ChatCompletionRequestUserMessageArgs::default()
                .content(
                    "Please generate a concise name for the conversation based on the user input.",
                )
                .build()
                .unwrap()
                .into(), // Convert to correct type
        ])
        .build()
        .map_err(|e| format!("generate_conversation_name request_error: {}", e))?; // Handle request building error

    // Send the request to OpenAI and await the response, converting any OpenAIError to a String
    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("generate_conversation_name OpenAI API request failed: {}", e))?;

    // Extract the first message content safely from the response
    let generated_name = response.choices[0]
        .message
        .content
        .as_ref() // Convert Option<String> to Option<&String>
        .map(|s| s.trim().to_string()) // Trim and convert to String if Some
        .unwrap_or_else(|| "Unnamed Conversation".to_string()); // Provide fallback if None

    Ok(generated_name)
}
