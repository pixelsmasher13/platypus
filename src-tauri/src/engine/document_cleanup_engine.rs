use crate::configuration::state::ServiceAccess;
use crate::repository::settings_repository::get_setting;
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        ChatCompletionRequestMessage, CreateChatCompletionRequestArgs,
    },
    Client as OpenAIClient,
};
use log::{debug, error, info};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const CLEANUP_SYSTEM_PROMPT: &str = r##"You are a note cleanup assistant. Clean up the following raw text into well-organized markdown:

- Fix grammar, spelling, and punctuation
- Keep the tone natural — don't over-formalize casual notes
- Match formatting to the content: short notes stay simple, longer notes get headings and structure. Prose stays as prose — don't force bullet points where paragraphs read better
- If this looks like meeting notes, preserve who said what and highlight key decisions
- Use **bold**, *italic*, lists, and code blocks only where they genuinely improve readability
- Preserve the original meaning — do not add or remove information

Return ONLY the cleaned markdown. No explanations, no preamble, no wrapping in code fences."##;

const MEETING_SUMMARY_SYSTEM_PROMPT: &str = r##"You are a meeting notes assistant. Transform the following raw text into concise meeting notes in markdown:

## Summary
A 2-3 sentence overview of what was discussed.

## Key Points
Bullet list of the important points, topics, and takeaways from the meeting.

Rules:
- Only use information present in the text — do not add or infer anything
- Preserve names and specific details mentioned
- Keep it concise but comprehensive
- Return ONLY the markdown. No explanations, no preamble, no code fences."##;

// Claude types
#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: usize,
    messages: Vec<ClaudeMessage>,
    system: String,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Deserialize)]
struct ClaudeContent {
    text: String,
}

// Gemini types
#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    generation_config: GeminiGenerationConfig,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiGenerationConfig {
    max_output_tokens: usize,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiCandidateContent,
}

#[derive(Deserialize)]
struct GeminiCandidateContent {
    parts: Vec<GeminiCandidatePart>,
}

#[derive(Deserialize)]
struct GeminiCandidatePart {
    text: String,
}

// Ollama types
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

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent";

#[tauri::command]
pub async fn clean_up_document_with_llm(
    app_handle: tauri::AppHandle,
    plain_text: String,
    provider: String,
    model_id: Option<String>,
) -> Result<String, String> {
    info!("Cleaning up document with provider: {}, model: {:?}", provider, model_id);
    send_to_llm(&app_handle, &plain_text, &provider, model_id, CLEANUP_SYSTEM_PROMPT).await
}

#[tauri::command]
pub async fn summarize_as_meeting_notes(
    app_handle: tauri::AppHandle,
    plain_text: String,
    provider: String,
    model_id: Option<String>,
) -> Result<String, String> {
    info!("Summarizing as meeting notes with provider: {}, model: {:?}", provider, model_id);
    send_to_llm(&app_handle, &plain_text, &provider, model_id, MEETING_SUMMARY_SYSTEM_PROMPT).await
}

async fn send_to_llm(
    app_handle: &tauri::AppHandle,
    plain_text: &str,
    provider: &str,
    model_id: Option<String>,
    system_prompt: &str,
) -> Result<String, String> {
    if plain_text.trim().is_empty() {
        return Err("Document is empty, nothing to process.".to_string());
    }

    match provider {
        "claude" => call_claude(app_handle, plain_text, model_id, system_prompt).await,
        "openai" => call_openai(app_handle, plain_text, model_id, system_prompt).await,
        "gemini" => call_gemini(app_handle, plain_text, model_id, system_prompt).await,
        "local" => call_local(app_handle, plain_text, model_id, system_prompt).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

async fn call_claude(
    app_handle: &tauri::AppHandle,
    plain_text: &str,
    model_id: Option<String>,
    system_prompt: &str,
) -> Result<String, String> {
    let setting = app_handle.db(|db| get_setting(db, "api_key_claude").expect("Failed on api_key_claude"));

    if setting.setting_value.is_empty() {
        return Err("Claude API key is not configured. Please set it in Settings.".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let model_to_use = match model_id.as_deref() {
        Some("claude-opus-4-6") => "claude-opus-4-6",
        Some("claude-sonnet-4-6") => "claude-sonnet-4-6",
        Some("claude-haiku-4-5") => "claude-haiku-4-5",
        _ => "claude-sonnet-4-6",
    };

    let request_body = ClaudeRequest {
        model: model_to_use.to_string(),
        max_tokens: 8192,
        messages: vec![ClaudeMessage {
            role: "user".to_string(),
            content: plain_text.to_string(),
        }],
        system: system_prompt.to_string(),
        stream: false,
    };

    let response = client
        .post(ANTHROPIC_URL)
        .header("Content-Type", "application/json")
        .header("x-api-key", &setting.setting_value)
        .header("anthropic-version", "2023-06-01")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request to Claude API failed: {}", e))?;

    if response.status().is_success() {
        let response_body: ClaudeResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Claude response: {}", e))?;
        let cleaned = response_body.content.first()
            .map(|c| c.text.trim().to_string())
            .unwrap_or_default();
        debug!("Claude cleanup complete, {} chars", cleaned.len());
        Ok(cleaned)
    } else {
        let error_message = response.text().await
            .map_err(|e| format!("Failed to read error: {}", e))?;
        error!("Claude API error: {}", error_message);
        Err(format!("Claude API error: {}", error_message))
    }
}

async fn call_openai(
    app_handle: &tauri::AppHandle,
    plain_text: &str,
    model_id: Option<String>,
    system_prompt: &str,
) -> Result<String, String> {
    let setting = app_handle.db(|db| get_setting(db, "api_key_open_ai").expect("Failed on api_key_open_ai"));

    if setting.setting_value.is_empty() {
        return Err("OpenAI API key is not configured. Please set it in Settings.".to_string());
    }

    let model_to_use = match model_id.as_deref() {
        Some(m) => m,
        _ => "gpt-5.4",
    };

    let messages: Vec<ChatCompletionRequestMessage> = vec![
        ChatCompletionRequestSystemMessageArgs::default()
            .content(system_prompt)
            .build()
            .unwrap()
            .into(),
        ChatCompletionRequestUserMessageArgs::default()
            .content(plain_text)
            .build()
            .unwrap()
            .into(),
    ];

    let request = CreateChatCompletionRequestArgs::default()
        .model(model_to_use)
        .messages(messages)
        .build()
        .map_err(|e| format!("Failed to build request: {}", e))?;

    let client = OpenAIClient::with_config(OpenAIConfig::new().with_api_key(&setting.setting_value));
    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    let cleaned = response.choices.first()
        .and_then(|c| c.message.content.as_ref())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    debug!("OpenAI cleanup complete, {} chars", cleaned.len());
    Ok(cleaned)
}

async fn call_gemini(
    app_handle: &tauri::AppHandle,
    plain_text: &str,
    model_id: Option<String>,
    system_prompt: &str,
) -> Result<String, String> {
    let setting = app_handle.db(|db| get_setting(db, "api_key_gemini").expect("Failed on api_key_gemini"));

    if setting.setting_value.is_empty() {
        return Err("Gemini API key is not configured. Please set it in Settings.".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let contents = vec![GeminiContent {
        role: "user".to_string(),
        parts: vec![GeminiPart {
            text: format!("{}\n\n{}", system_prompt, plain_text),
        }],
    }];

    let api_url = format!("{}?key={}", GEMINI_URL, setting.setting_value);

    let request_body = GeminiRequest {
        contents,
        generation_config: GeminiGenerationConfig {
            max_output_tokens: 8192,
        },
    };

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request to Gemini API failed: {}", e))?;

    if response.status().is_success() {
        let response_body: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        let cleaned = response_body.candidates.first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.trim().to_string())
            .unwrap_or_default();

        debug!("Gemini cleanup complete, {} chars", cleaned.len());
        Ok(cleaned)
    } else {
        let error_message = response.text().await
            .map_err(|e| format!("Failed to read error: {}", e))?;
        error!("Gemini API error: {}", error_message);
        Err(format!("Gemini API error: {}", error_message))
    }
}

async fn call_local(
    app_handle: &tauri::AppHandle,
    plain_text: &str,
    model_id: Option<String>,
    system_prompt: &str,
) -> Result<String, String> {
    let setting = app_handle.db(|db| get_setting(db, "local_model_url").expect("Failed on local_model_url"));
    let base_url = if setting.setting_value.is_empty() {
        "http://localhost:11434".to_string()
    } else {
        setting.setting_value
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let model_to_use = model_id.unwrap_or_else(|| "llama3.3:70b".to_string());

    let messages = vec![
        OllamaMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        OllamaMessage {
            role: "user".to_string(),
            content: plain_text.to_string(),
        },
    ];

    let api_url = format!("{}/api/chat", base_url);

    let request_body = OllamaRequest {
        model: model_to_use,
        messages,
        stream: false,
    };

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request to Ollama failed: {}. Make sure Ollama is running.", e))?;

    if response.status().is_success() {
        let response_body: OllamaResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        let cleaned = response_body.message.content.trim().to_string();
        debug!("Ollama cleanup complete, {} chars", cleaned.len());
        Ok(cleaned)
    } else {
        let error_message = response.text().await
            .map_err(|e| format!("Failed to read error: {}", e))?;
        error!("Ollama error: {}", error_message);
        Err(format!("Ollama error: {}. Make sure Ollama is running and the model is downloaded.", error_message))
    }
}
