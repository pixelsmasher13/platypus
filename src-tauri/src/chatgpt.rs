//! ChatGPT subscription access, as an alternative to an OpenAI API key.
//!
//! Sign-in is OAuth 2.0 authorization code + PKCE against auth.openai.com with
//! the public client that OpenAI's Codex CLI uses. That client only accepts
//! http://localhost:1455/auth/callback as its redirect. Requests then go to the
//! Codex Responses endpoint on chatgpt.com and count against the user's ChatGPT
//! plan instead of API billing. The endpoint isn't a documented public API, so
//! its errors are passed through verbatim.

use crate::models::{selected_effort, StreamLines};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures::StreamExt;
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

pub const CALLBACK_PORT: u16 = 1455;
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const ORIGINATOR: &str = "platypus_notes";
const AUTH_CLAIM: &str = "https://api.openai.com/auth";

#[derive(Clone, Debug, PartialEq)]
pub struct Credentials {
    pub access_token: String,
    pub refresh_token: String,
    /// Milliseconds since the Unix epoch.
    pub expires_ms: i64,
    pub account_id: String,
    pub email: Option<String>,
}

impl Credentials {
    /// Refresh a minute early so a long request doesn't start on a dying token.
    pub fn needs_refresh(&self, now_ms: i64) -> bool {
        self.expires_ms - now_ms < 60_000
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn new_pkce() -> Pkce {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = pkce_challenge(&verifier);
    Pkce { verifier, challenge }
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn new_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn authorize_url(challenge: &str, state: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("response_type", "code"),
            ("client_id", CLIENT_ID),
            ("redirect_uri", REDIRECT_URI),
            ("scope", "openid profile email offline_access"),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("state", state),
            ("id_token_add_organizations", "true"),
            ("codex_cli_simplified_flow", "true"),
            ("originator", ORIGINATOR),
        ])
        .finish();
    // Form encoding writes spaces as '+' (a literal '+' becomes %2B); send %20 like the Codex CLI.
    format!("{}?{}", AUTHORIZE_URL, query.replace('+', "%20"))
}

/// Returns the authorization code from the browser's redirect after checking `state`.
pub fn code_from_callback(callback_url: &str, expected_state: &str) -> Result<String, String> {
    let url = url::Url::parse(callback_url)
        .map_err(|e| format!("Unexpected ChatGPT sign-in redirect: {}", e))?;
    let param = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    if let Some(error) = param("error_description").or_else(|| param("error")) {
        return Err(format!("ChatGPT sign-in failed: {}", error));
    }
    if param("state").as_deref() != Some(expected_state) {
        return Err("ChatGPT sign-in didn't match this request. Please try again.".into());
    }
    param("code")
        .filter(|code| !code.is_empty())
        .ok_or_else(|| "ChatGPT sign-in didn't return an authorization code.".into())
}

fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Every Codex request must name the ChatGPT account carried in the access token.
pub fn account_id(access_token: &str) -> Option<String> {
    jwt_claims(access_token)?
        .get(AUTH_CLAIM)?
        .get("chatgpt_account_id")?
        .as_str()
        .filter(|id| !id.is_empty())
        .map(String::from)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    expires_in: i64,
}

pub async fn exchange_code(code: &str, verifier: &str) -> Result<Credentials, String> {
    let tokens = token_request(&[
        ("grant_type", "authorization_code"),
        ("client_id", CLIENT_ID),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", REDIRECT_URI),
    ])
    .await?;
    credentials_from(tokens, None)
}

pub async fn refresh(current: &Credentials) -> Result<Credentials, String> {
    let tokens = token_request(&[
        ("grant_type", "refresh_token"),
        ("client_id", CLIENT_ID),
        ("refresh_token", &current.refresh_token),
    ])
    .await?;
    credentials_from(tokens, Some(current))
}

async fn token_request(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let response = client(Duration::from_secs(30))?
        .post(TOKEN_URL)
        .form(form)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach OpenAI sign-in: {}", e))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("OpenAI sign-in failed ({}): {}", status, body));
    }
    serde_json::from_str(&body).map_err(|e| format!("Unexpected OpenAI sign-in response: {}", e))
}

fn credentials_from(tokens: TokenResponse, previous: Option<&Credentials>) -> Result<Credentials, String> {
    let account_id = account_id(&tokens.access_token)
        .ok_or("OpenAI didn't return a ChatGPT account for this sign-in.")?;
    // Refresh responses may omit tokens that didn't change.
    let refresh_token = tokens
        .refresh_token
        .or_else(|| previous.map(|p| p.refresh_token.clone()))
        .ok_or("OpenAI sign-in didn't return a refresh token.")?;
    let email = tokens
        .id_token
        .as_deref()
        .and_then(jwt_claims)
        .and_then(|claims| claims.get("email")?.as_str().map(String::from))
        .or_else(|| previous.and_then(|p| p.email.clone()));
    Ok(Credentials {
        access_token: tokens.access_token,
        refresh_token,
        expires_ms: now_ms() + tokens.expires_in.saturating_mul(1000),
        account_id,
        email,
    })
}

/// A streaming Responses request. Turns are (role, text) in order; any role
/// other than "assistant" is sent as the user.
pub fn responses_request(model: &str, instructions: &str, turns: &[(&str, &str)], effort: Option<&str>) -> Value {
    let input: Vec<Value> = turns
        .iter()
        .map(|(role, text)| {
            let (role, kind) = if *role == "assistant" { ("assistant", "output_text") } else { ("user", "input_text") };
            json!({"type": "message", "role": role, "content": [{"type": kind, "text": text}]})
        })
        .collect();
    // The Codex endpoint only serves streamed responses that aren't stored server-side.
    let mut request = json!({
        "model": model,
        "instructions": instructions,
        "input": input,
        "stream": true,
        "store": false,
    });
    if let Some(effort) = selected_effort(model, effort) {
        request["reasoning"] = json!({"effort": effort});
    }
    request
}

/// Sends `request` and returns the full reply. `on_text` receives the text so far after each delta.
pub async fn stream_text(
    credentials: &Credentials,
    request: &Value,
    mut on_text: impl FnMut(&str) -> Result<(), String>,
) -> Result<String, String> {
    let response = client(Duration::from_secs(600))?
        .post(RESPONSES_URL)
        .bearer_auth(&credentials.access_token)
        .header("chatgpt-account-id", &credentials.account_id)
        .header("originator", ORIGINATOR)
        .header("OpenAI-Beta", "responses=experimental")
        .header("Accept", "text/event-stream")
        .json(request)
        .send()
        .await
        .map_err(|e| format!("ChatGPT request failed: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(match status.as_u16() {
            401 | 403 => format!("ChatGPT didn't accept your sign-in ({}). Sign in again in Settings. {}", status, body),
            _ => format!("ChatGPT error ({}): {}", status, body),
        });
    }
    let mut stream = response.bytes_stream();
    let mut lines = StreamLines::default();
    let mut text = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("ChatGPT response was interrupted: {}", e))?;
        for line in lines.push(&chunk)? {
            let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
            match parse_event(data)? {
                Event::Text(delta) => {
                    text.push_str(&delta);
                    on_text(&text)?;
                }
                Event::Done if text.trim().is_empty() => return Err("ChatGPT returned no text. Please try again.".into()),
                Event::Done => return Ok(text),
                Event::Other => {}
            }
        }
    }
    Err("ChatGPT response was interrupted. Please try again.".into())
}

#[derive(Debug, PartialEq)]
enum Event {
    Text(String),
    Done,
    Other,
}

fn parse_event(data: &str) -> Result<Event, String> {
    let Ok(event) = serde_json::from_str::<Value>(data) else { return Ok(Event::Other) };
    let message = || {
        [&event["response"]["error"]["message"], &event["error"]["message"], &event["message"]]
            .into_iter()
            .find_map(Value::as_str)
            .unwrap_or("no details")
            .to_string()
    };
    match event["type"].as_str().unwrap_or_default() {
        "response.output_text.delta" => Ok(Event::Text(event["delta"].as_str().unwrap_or_default().to_string())),
        "response.completed" => Ok(Event::Done),
        "response.incomplete" => Err(format!(
            "ChatGPT stopped before finishing ({}).",
            event["response"]["incomplete_details"]["reason"].as_str().unwrap_or("no reason given")
        )),
        "response.failed" | "error" => Err(format!("ChatGPT error: {}", message())),
        _ => Ok(Event::Other),
    }
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(timeout)
        .user_agent(format!(
            "PlatypusNotes/{} ({}; {})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(claims: Value) -> String {
        format!("header.{}.signature", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    #[test]
    fn pkce_matches_rfc_7636_and_stays_in_range() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let pkce = new_pkce();
        assert!((43..=128).contains(&pkce.verifier.len()));
        assert_eq!(pkce.challenge, pkce_challenge(&pkce.verifier));
        assert_ne!(new_pkce().verifier, pkce.verifier);
    }

    #[test]
    fn authorize_url_carries_the_registered_redirect_and_challenge() {
        let url = url::Url::parse(&authorize_url("challenge-1", "state-1")).unwrap();
        let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
        assert_eq!(url.host_str(), Some("auth.openai.com"));
        assert_eq!(param("redirect_uri").as_deref(), Some(REDIRECT_URI));
        assert_eq!(param("scope").as_deref(), Some("openid profile email offline_access"));
        assert_eq!(param("code_challenge").as_deref(), Some("challenge-1"));
        assert_eq!(param("code_challenge_method").as_deref(), Some("S256"));
        assert_eq!(param("state").as_deref(), Some("state-1"));
        assert!(url.query().unwrap().contains("scope=openid%20profile%20email%20offline_access"));
    }

    #[test]
    fn callback_requires_matching_state() {
        let callback = "http://localhost:1455/auth/callback?code=abc&state=s1";
        assert_eq!(code_from_callback(callback, "s1").unwrap(), "abc");
        assert!(code_from_callback(callback, "s2").is_err());
        assert!(code_from_callback("http://localhost:1455/auth/callback?state=s1", "s1").is_err());
        let denied = "http://localhost:1455/auth/callback?error=access_denied&error_description=User%20cancelled&state=s1";
        assert_eq!(code_from_callback(denied, "s1").unwrap_err(), "ChatGPT sign-in failed: User cancelled");
    }

    #[test]
    fn credentials_read_account_and_keep_previous_values_on_refresh() {
        let access = token(json!({AUTH_CLAIM: {"chatgpt_account_id": "acct_1"}}));
        assert_eq!(account_id(&access).as_deref(), Some("acct_1"));
        assert_eq!(account_id(&token(json!({AUTH_CLAIM: {"chatgpt_account_id": ""}}))), None);
        assert_eq!(account_id("not-a-jwt"), None);

        let first = credentials_from(TokenResponse {
            access_token: access.clone(),
            refresh_token: Some("refresh-1".into()),
            id_token: Some(token(json!({"email": "me@example.com"}))),
            expires_in: 3600,
        }, None).unwrap();
        assert_eq!(first.email.as_deref(), Some("me@example.com"));
        assert!(!first.needs_refresh(now_ms()));
        assert!(first.needs_refresh(first.expires_ms - 30_000));

        let refreshed = credentials_from(TokenResponse {
            access_token: access, refresh_token: None, id_token: None, expires_in: 3600,
        }, Some(&first)).unwrap();
        assert_eq!(refreshed.refresh_token, "refresh-1");
        assert_eq!(refreshed.email.as_deref(), Some("me@example.com"));

        let no_account = TokenResponse {
            access_token: token(json!({})), refresh_token: Some("r".into()), id_token: None, expires_in: 60,
        };
        assert!(credentials_from(no_account, None).is_err());
    }

    #[test]
    fn requests_map_turns_and_supported_effort() {
        let request = responses_request(
            "gpt-6-astra",
            "Be brief.",
            &[("user", "Summarize"), ("assistant", "Done"), ("system", "Again")],
            Some("high"),
        );
        assert_eq!(request["instructions"], "Be brief.");
        assert_eq!(request["stream"], true);
        assert_eq!(request["store"], false);
        assert_eq!(request["reasoning"]["effort"], "high");
        let roles: Vec<_> = request["input"].as_array().unwrap().iter()
            .map(|item| (item["role"].as_str().unwrap(), item["content"][0]["type"].as_str().unwrap()))
            .collect();
        assert_eq!(roles, [("user", "input_text"), ("assistant", "output_text"), ("user", "input_text")]);
        assert_eq!(request["input"][1]["content"][0]["text"], "Done");

        assert_eq!(responses_request("gpt-6-astra", "", &[], Some("none"))["reasoning"]["effort"], "low");
        assert_eq!(responses_request("gpt-6-luna", "", &[], None)["reasoning"]["effort"], "none");
        assert!(responses_request("gpt-custom", "", &[], Some("high")).get("reasoning").is_none());
    }

    #[test]
    fn stream_events_yield_text_completion_and_errors() {
        assert_eq!(parse_event(r#"{"type":"response.output_text.delta","delta":"Hi"}"#), Ok(Event::Text("Hi".into())));
        assert_eq!(parse_event(r#"{"type":"response.completed","response":{}}"#), Ok(Event::Done));
        assert_eq!(parse_event(r#"{"type":"response.created"}"#), Ok(Event::Other));
        assert_eq!(parse_event("[DONE]"), Ok(Event::Other));
        assert_eq!(
            parse_event(r#"{"type":"response.failed","response":{"error":{"message":"Model not available"}}}"#),
            Err("ChatGPT error: Model not available".into())
        );
        assert_eq!(parse_event(r#"{"type":"error","message":"Rate limited"}"#), Err("ChatGPT error: Rate limited".into()));
        assert_eq!(
            parse_event(r#"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}"#),
            Err("ChatGPT stopped before finishing (max_output_tokens).".into())
        );
    }
}
