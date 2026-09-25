// Sign in with ChatGPT so OpenAI chat and note features use the user's ChatGPT
// plan instead of an API key. While signed in, every OpenAI text request goes
// through `complete`; embeddings, cloud transcription, and designed PowerPoints
// have no subscription route and keep using the API key.
use crate::configuration::state::ServiceAccess;
use crate::entity::setting::Setting;
use crate::repository::settings_repository::{get_setting, insert_or_update_setting};
use lazy_static::lazy_static;
use log::info;
use platypus_notes::chatgpt::{self, Credentials};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_oauth::{cancel, start_with_config, OauthConfig};
use tokio::sync::oneshot;

/// Token settings share this prefix; `get_latest_settings` keeps them out of the webview.
pub const SECRET_PREFIX: &str = "chatgpt_";
const ACCESS_TOKEN: &str = "chatgpt_access_token";
const REFRESH_TOKEN: &str = "chatgpt_refresh_token";
const EXPIRES_MS: &str = "chatgpt_expires_ms";
const ACCOUNT_ID: &str = "chatgpt_account_id";
const EMAIL: &str = "chatgpt_email";

// Shown in the browser tab after OpenAI redirects back. It doesn't say "signed in"
// because the redirect can also carry an error or a cancelled sign-in.
const RETURN_PAGE: &str = "<!doctype html><html><head><title>Platypus</title></head>\
<body style=\"font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">\
<p>You can close this tab and return to Platypus.</p></body></html>";

static SIGN_IN_ATTEMPTS: AtomicU64 = AtomicU64::new(0);

lazy_static! {
    /// The pending sign-in's (attempt, callback port), so it can be cancelled or replaced.
    static ref PENDING_SIGN_IN: Mutex<Option<(u64, u16)>> = Mutex::new(None);
    /// OpenAI rotates refresh tokens, so concurrent requests must not refresh twice.
    static ref REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::new(());
}

#[derive(Serialize)]
pub struct ChatGptStatus {
    signed_in: bool,
    email: Option<String>,
}

fn load(app: &tauri::AppHandle) -> Option<Credentials> {
    let credentials = app.db(|db| {
        let read = |key: &str| get_setting(db, key).map(|s| s.setting_value).unwrap_or_default();
        Credentials {
            access_token: read(ACCESS_TOKEN),
            refresh_token: read(REFRESH_TOKEN),
            expires_ms: read(EXPIRES_MS).parse().unwrap_or(0),
            account_id: read(ACCOUNT_ID),
            email: Some(read(EMAIL)).filter(|email| !email.is_empty()),
        }
    });
    let complete = !credentials.access_token.is_empty()
        && !credentials.refresh_token.is_empty()
        && !credentials.account_id.is_empty();
    complete.then_some(credentials)
}

fn store(app: &tauri::AppHandle, credentials: Option<&Credentials>) -> Result<(), String> {
    let expires = credentials.map(|c| c.expires_ms.to_string()).unwrap_or_default();
    let values = [
        (ACCESS_TOKEN, credentials.map_or("", |c| c.access_token.as_str())),
        (REFRESH_TOKEN, credentials.map_or("", |c| c.refresh_token.as_str())),
        (EXPIRES_MS, expires.as_str()),
        (ACCOUNT_ID, credentials.map_or("", |c| c.account_id.as_str())),
        (EMAIL, credentials.and_then(|c| c.email.as_deref()).unwrap_or("")),
    ];
    app.db(|db| {
        values.iter().try_for_each(|(key, value)| {
            insert_or_update_setting(db, Setting { setting_key: key.to_string(), setting_value: value.to_string() })
        })
    })
    .map_err(|e| format!("Couldn't save your ChatGPT sign-in: {}", e))
}

fn status(app: &tauri::AppHandle) -> ChatGptStatus {
    let credentials = load(app);
    ChatGptStatus { signed_in: credentials.is_some(), email: credentials.and_then(|c| c.email) }
}

pub fn is_signed_in(app: &tauri::AppHandle) -> bool {
    load(app).is_some()
}

async fn credentials(app: &tauri::AppHandle) -> Result<Credentials, String> {
    let saved = load(app).ok_or("Sign in with ChatGPT in Settings.")?;
    if !saved.needs_refresh(chatgpt::now_ms()) {
        return Ok(saved);
    }
    let _guard = REFRESH_LOCK.lock().await;
    // Another request may have refreshed while this one waited.
    let saved = load(app).ok_or("Sign in with ChatGPT in Settings.")?;
    if !saved.needs_refresh(chatgpt::now_ms()) {
        return Ok(saved);
    }
    let refreshed = chatgpt::refresh(&saved)
        .await
        .map_err(|e| format!("Your ChatGPT session expired. Sign in again in Settings. ({})", e))?;
    store(app, Some(&refreshed))?;
    Ok(refreshed)
}

/// Sends one request on the user's ChatGPT plan. `on_text` receives the reply so far.
pub async fn complete(
    app: &tauri::AppHandle,
    model: &str,
    instructions: &str,
    turns: &[(&str, &str)],
    effort: Option<&str>,
    on_text: impl FnMut(&str) -> Result<(), String>,
) -> Result<String, String> {
    let credentials = credentials(app).await?;
    let request = chatgpt::responses_request(model, instructions, turns, effort);
    chatgpt::stream_text(&credentials, &request, on_text).await
}

fn cancel_pending_sign_in() {
    if let Some((_, port)) = PENDING_SIGN_IN.lock().unwrap().take() {
        let _ = cancel(port);
    }
}

#[tauri::command]
pub async fn chatgpt_sign_in(app_handle: tauri::AppHandle) -> Result<ChatGptStatus, String> {
    // A second click replaces the first attempt; both need port 1455.
    cancel_pending_sign_in();
    let pkce = chatgpt::new_pkce();
    let state = chatgpt::new_state();
    let (sender, receiver) = oneshot::channel::<String>();
    let mut sender = Some(sender);
    let port = start_with_config(
        OauthConfig { ports: Some(vec![chatgpt::CALLBACK_PORT]), response: Some(RETURN_PAGE.into()) },
        move |url| {
            if let Some(sender) = sender.take() {
                let _ = sender.send(url);
            }
        },
    )
    .map_err(|e| format!(
        "Couldn't start ChatGPT sign-in because port {} is busy ({}). Close anything else signing in to ChatGPT, such as the Codex CLI, and try again.",
        chatgpt::CALLBACK_PORT, e
    ))?;
    let attempt = SIGN_IN_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
    *PENDING_SIGN_IN.lock().unwrap() = Some((attempt, port));

    let url = chatgpt::authorize_url(&pkce.challenge, &state);
    if let Err(e) = tauri::api::shell::open(&app_handle.shell_scope(), &url, None) {
        cancel_pending_sign_in();
        return Err(format!("Couldn't open your browser for ChatGPT sign-in: {}", e));
    }

    let callback = tokio::time::timeout(Duration::from_secs(300), receiver).await;
    let still_pending = {
        let mut pending = PENDING_SIGN_IN.lock().unwrap();
        let ours = matches!(*pending, Some((id, _)) if id == attempt);
        if ours {
            *pending = None;
        }
        ours
    };
    let callback_url = match callback {
        Ok(Ok(url)) => url,
        Ok(Err(_)) => return Err("ChatGPT sign-in was cancelled.".into()),
        Err(_) => {
            // The server is still listening only when nothing arrived.
            if still_pending {
                let _ = cancel(port);
            }
            return Err("ChatGPT sign-in timed out. Please try again.".into());
        }
    };
    let code = chatgpt::code_from_callback(&callback_url, &state)?;
    let credentials = chatgpt::exchange_code(&code, &pkce.verifier).await?;
    store(&app_handle, Some(&credentials))?;
    info!("Signed in with ChatGPT");
    Ok(status(&app_handle))
}

#[tauri::command]
pub fn chatgpt_cancel_sign_in() {
    cancel_pending_sign_in();
}

#[tauri::command]
pub fn chatgpt_sign_out(app_handle: tauri::AppHandle) -> Result<ChatGptStatus, String> {
    store(&app_handle, None)?;
    Ok(status(&app_handle))
}

#[tauri::command]
pub fn chatgpt_status(app_handle: tauri::AppHandle) -> ChatGptStatus {
    status(&app_handle)
}
