use anyhow::Result;
use log::{error, info};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::configuration::state::ServiceAccess;
use crate::engine::document_cleanup_engine::generate_podcast_script;
use crate::repository::settings_repository::get_setting;

const ELEVENLABS_TTS_URL_TEMPLATE: &str = "https://api.elevenlabs.io/v1/text-to-speech/";
const ELEVENLABS_MODEL_ID: &str = "eleven_multilingual_v2";

/// Hard-coded preset voices users can pick from. (Voice IDs from ElevenLabs default library.)
/// Frontend mirrors this list. Adding a voice in code = appearing in the UI dropdown.
fn default_voice_id() -> &'static str {
    "21m00Tcm4TlvDq8ikWAM" // "Rachel" — neutral, clear delivery
}

#[derive(Serialize)]
struct ElevenLabsRequest {
    text: String,
    model_id: String,
    voice_settings: VoiceSettings,
}

#[derive(Serialize)]
struct VoiceSettings {
    stability: f32,
    similarity_boost: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PodcastResult {
    /// Absolute path to the saved MP3 file.
    pub file_path: String,
    /// The script the LLM produced (so the frontend can show it).
    pub script: String,
    /// Length of the script in characters (rough proxy for audio length).
    pub script_chars: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ElevenLabsVoice {
    pub voice_id: String,
    pub name: String,
    pub category: Option<String>,
}

#[derive(Deserialize)]
struct VoicesListResponse {
    voices: Vec<ElevenLabsVoice>,
}

/// List the voices available to the configured ElevenLabs account.
/// On free tier this is just the user's personal library; on paid tiers it
/// also includes ElevenLabs' premium library voices.
#[tauri::command]
pub async fn list_elevenlabs_voices(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ElevenLabsVoice>, String> {
    let key = app_handle
        .db(|db| get_setting(db, "api_key_elevenlabs"))
        .map(|s| s.setting_value)
        .unwrap_or_default();

    if key.trim().is_empty() {
        return Err("ElevenLabs API key is not configured.".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get("https://api.elevenlabs.io/v1/voices")
        .header("xi-api-key", &key)
        .send()
        .await
        .map_err(|e| format!("Voices request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("ElevenLabs returned {}: {}", status, body));
    }

    let parsed: VoicesListResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse voices list: {}", e))?;

    Ok(parsed.voices)
}

#[tauri::command]
pub async fn generate_podcast_from_document(
    app_handle: tauri::AppHandle,
    plain_text: String,
    provider: String,
    model_id: Option<String>,
    focus: Option<String>,
    length_minutes: Option<u32>,
    voice_id: Option<String>,
) -> Result<PodcastResult, String> {
    info!(
        "Generating podcast — provider: {}, model: {:?}, length_min: {:?}, focus: {:?}, voice: {:?}",
        provider, model_id, length_minutes, focus, voice_id
    );

    // ── Step 1: validate ElevenLabs credentials early
    let eleven_key = app_handle
        .db(|db| get_setting(db, "api_key_elevenlabs"))
        .map(|s| s.setting_value)
        .unwrap_or_default();

    if eleven_key.trim().is_empty() {
        return Err(
            "ElevenLabs API key is not configured. Add it in Settings before generating a podcast."
                .to_string(),
        );
    }

    let voice: String = match voice_id.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => default_voice_id().to_string(),
    };

    // ── Step 2: ask the configured LLM to write the podcast script
    let target_minutes = length_minutes.unwrap_or(3).clamp(1, 10);
    let script = generate_podcast_script(
        &app_handle,
        &plain_text,
        &provider,
        model_id,
        focus.as_deref(),
        target_minutes,
    )
    .await?;

    if script.trim().is_empty() {
        return Err("LLM returned an empty podcast script.".to_string());
    }

    let script_chars = script.chars().count();
    info!("Podcast script generated: {} chars", script_chars);

    // ── Step 3: ElevenLabs TTS → MP3 bytes
    let mp3_bytes = synthesize_speech(&eleven_key, &voice, &script).await?;
    info!("ElevenLabs returned {} bytes of MP3", mp3_bytes.len());

    // ── Step 4: persist to a known location inside the app data dir
    let file_path = save_podcast_mp3(&app_handle, &mp3_bytes)?;

    Ok(PodcastResult {
        file_path,
        script,
        script_chars,
    })
}

async fn synthesize_speech(api_key: &str, voice_id: &str, text: &str) -> Result<Vec<u8>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let url = format!("{}{}", ELEVENLABS_TTS_URL_TEMPLATE, voice_id);

    let body = ElevenLabsRequest {
        text: text.to_string(),
        model_id: ELEVENLABS_MODEL_ID.to_string(),
        voice_settings: VoiceSettings {
            stability: 0.5,
            similarity_boost: 0.75,
        },
    };

    let resp = client
        .post(&url)
        .header("xi-api-key", api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "audio/mpeg")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ElevenLabs request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_else(|_| "(no body)".to_string());
        error!("ElevenLabs error {}: {}", status, err_text);
        return Err(format!("ElevenLabs returned {}: {}", status, err_text));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read ElevenLabs audio response: {}", e))?;

    Ok(bytes.to_vec())
}

fn save_podcast_mp3(app_handle: &tauri::AppHandle, bytes: &[u8]) -> Result<String, String> {
    use std::fs;
    use tauri::Manager;

    let base = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Could not resolve app data dir".to_string())?
        .join("podcasts");

    fs::create_dir_all(&base).map_err(|e| format!("Failed to create podcasts dir: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let path = base.join(format!("podcast_{}.mp3", timestamp));

    fs::write(&path, bytes).map_err(|e| format!("Failed to write MP3: {}", e))?;

    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Saved path was not valid UTF-8".to_string())
}
