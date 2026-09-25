use serde::Deserialize;
use serde_json::{json, Value};

pub const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-5";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-6-astra";
pub const QUICK_OPENAI_MODEL: &str = "gpt-6-luna";

pub fn selected_model<'a>(requested: Option<&'a str>, default: &'a str) -> &'a str {
    requested.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(default)
}

// Preserve the app's no-thinking Claude workflow and predictable output budget.
// Sonnet 5 otherwise enables adaptive thinking by default.
pub fn claude_thinking(model: &str) -> Option<Value> {
    model.starts_with("claude-sonnet-5").then(|| json!({"type": "disabled"}))
}

#[derive(Deserialize)]
pub struct ClaudeContent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

pub fn claude_text(content: &[ClaudeContent]) -> Result<String, String> {
    let text = content.iter().filter(|block| block.kind == "text")
        .map(|block| block.text.as_str()).collect::<Vec<_>>().join("\n");
    if text.trim().is_empty() {
        Err("Claude returned no text. Please try again.".into())
    } else {
        Ok(text.trim().to_string())
    }
}

fn is_family(model: &str, family: &str) -> bool {
    model == family || model.strip_prefix(family).map_or(false, |suffix| suffix.starts_with('-'))
}

pub fn effort_options(model: &str) -> &'static [&'static str] {
    if is_family(model, "gpt-6-astra") { return &["low", "medium", "high", "xhigh", "max"]; }
    if ["gpt-6-sol", "gpt-6-luna", "claude-sonnet-5"].iter().any(|family| is_family(model, family)) {
        return &["none", "low", "medium", "high", "xhigh", "max"];
    }
    if ["claude-opus-4-6", "claude-sonnet-4-6"].iter().any(|family| is_family(model, family)) {
        return &["none", "low", "medium", "high", "max"];
    }
    &[]
}

fn selected_effort<'a>(model: &str, requested: Option<&'a str>) -> Option<&'a str> {
    let options = effort_options(model);
    requested.filter(|effort| options.contains(effort)).or_else(|| options.first().copied())
}

pub fn claude_request(mut request: Value, requested: Option<&str>) -> Value {
    let model = request["model"].as_str().unwrap_or_default();
    if let Some(effort) = selected_effort(model, requested) {
        if effort == "none" {
            request["thinking"] = json!({"type": "disabled"});
        } else {
            request["thinking"] = json!({"type": "adaptive"});
            request["output_config"] = json!({"effort": effort});
            // max_tokens covers reasoning AND the final answer. Leave room for both.
            let allowance = match effort { "max" | "xhigh" => 65536, "high" => 32768, _ => 16384 };
            request["max_tokens"] = json!(request["max_tokens"].as_u64().unwrap_or(0).max(allowance));
        }
    }
    request
}

// The pinned SDK predates reasoning_effort; extend its serialized request.
pub fn openai_request(mut request: Value, requested: Option<&str>) -> Value {
    let model = request["model"].as_str().unwrap_or_default();
    if let Some(effort) = selected_effort(model, requested) {
        request["reasoning_effort"] = json!(effort);
    }
    request
}

pub async fn send_openai(api_key: &str, request: Value, effort: Option<&str>) -> Result<reqwest::Response, String> {
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build().map_err(|e| e.to_string())?
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&openai_request(request, effort))
        .send().await.map_err(|e| format!("OpenAI request failed: {}", e))?;
    if response.status().is_success() {
        Ok(response)
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("OpenAI API error ({}): {}", status, body))
    }
}

// SSE data lines may span network chunks, including in the middle of UTF-8.
#[derive(Default)]
pub struct StreamLines {
    pending: Vec<u8>,
}
impl StreamLines {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let bytes: Vec<_> = self.pending.drain(..=end).collect();
            let line = String::from_utf8(bytes).map_err(|e| format!("Invalid stream text: {}", e))?;
            lines.push(line.trim_end_matches(['\r', '\n']).to_string());
        }
        Ok(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_models_are_never_silently_downgraded() {
        for model in ["claude-sonnet-5", "claude-custom", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-custom"] {
            assert_eq!(selected_model(Some(model), DEFAULT_OPENAI_MODEL), model);
        }
        assert_eq!(selected_model(Some("  "), DEFAULT_CLAUDE_MODEL), "claude-sonnet-5");
        assert_eq!(selected_model(None, DEFAULT_OPENAI_MODEL), "gpt-6-astra");
    }
    #[test]
    fn claude_ignores_thinking_and_collects_all_text_blocks() {
        let blocks: Vec<ClaudeContent> = serde_json::from_value(json!([
            {"type": "thinking", "thinking": "", "signature": "signature"},
            {"type": "text", "text": " First "},
            {"type": "text", "text": "Second"}
        ])).unwrap();
        assert_eq!(claude_text(&blocks).unwrap(), "First \nSecond");
        assert!(claude_text(&[]).is_err());
        assert_eq!(claude_thinking("claude-sonnet-5"), Some(json!({"type": "disabled"})));
        assert_eq!(claude_thinking("claude-haiku-4-5"), None);
    }
    #[test]
    fn gpt6_requests_preserve_low_latency_without_unsupported_sampling() {
        for (model, effort) in [("gpt-6-astra", "low"), ("gpt-6-sol", "none"), ("gpt-6-luna", "none")] {
            let request = openai_request(json!({"model": model, "messages": [{"role":"user", "content":"Summarize my notes"}]}), None);
            assert_eq!(request["model"], model);
            assert_eq!(request["reasoning_effort"], effort);
            assert_eq!(request["messages"][0]["content"], "Summarize my notes");
            assert!(request.get("temperature").is_none());
        }
        assert!(openai_request(json!({"model":"custom"}), None).get("reasoning_effort").is_none());
    }
    #[test]
    fn each_supported_effort_reaches_the_provider() {
        for model in ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "claude-sonnet-5", "claude-opus-4-6"] {
            for effort in effort_options(model) {
                let source = json!({"model": model, "max_tokens": 8192, "messages": [{"role":"user", "content":"Notes"}]});
                if model.starts_with("gpt") {
                    let request = openai_request(source, Some(effort));
                    assert_eq!(request["reasoning_effort"], *effort);
                } else {
                    let request = claude_request(source, Some(effort));
                    if *effort == "none" {
                        assert_eq!(request["thinking"]["type"], "disabled");
                        assert_eq!(request["max_tokens"], 8192);
                        assert!(request.get("output_config").is_none());
                    } else {
                        assert_eq!(request["thinking"]["type"], "adaptive");
                        assert_eq!(request["output_config"]["effort"], *effort);
                        assert!(request["max_tokens"].as_u64().unwrap() >= 16384);
                        assert!(request["thinking"].get("budget_tokens").is_none());
                    }
                    assert_eq!(request["messages"][0]["content"], "Notes");
                }
            }
        }
    }
    #[test]
    fn incompatible_or_stale_efforts_never_reach_the_api() {
        assert_eq!(openai_request(json!({"model":"gpt-6-astra"}), Some("none"))["reasoning_effort"], "low");
        assert_eq!(openai_request(json!({"model":"gpt-6-luna"}), Some("invalid"))["reasoning_effort"], "none");
        let source = json!({"model":"claude-haiku-4-5", "max_tokens":8192});
        assert_eq!(claude_request(source.clone(), Some("high")), source);
        assert!(!effort_options("claude-opus-4-6").contains(&"xhigh"));
        assert!(effort_options("gpt-6-astra-custom").contains(&"max"));
        assert!(effort_options("gpt-6-astra2").is_empty());
    }
    #[test]
    fn stream_keeps_split_json_and_unicode_intact() {
        let input = "data: {\"text\":\"café 🦆\"}\r\n\r\ndata: [DONE]\n";
        for split in 0..input.len() {
            let mut lines = StreamLines::default();
            let mut result = lines.push(&input.as_bytes()[..split]).unwrap();
            result.extend(lines.push(&input.as_bytes()[split..]).unwrap());
            assert_eq!(result, ["data: {\"text\":\"café 🦆\"}", "", "data: [DONE]"]);
        }
    }
}
