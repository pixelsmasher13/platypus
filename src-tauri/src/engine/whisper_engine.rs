use std::path::PathBuf;
use std::sync::Once;
use anyhow::{Result, anyhow};
use log::{info, warn};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

struct WhisperModelInfo {
    filename: &'static str,
    url: &'static str,
}

fn get_model_info(model_id: &str) -> WhisperModelInfo {
    match model_id {
        "large-v3-turbo" => WhisperModelInfo {
            filename: "ggml-large-v3-turbo.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        },
        "large-v3" => WhisperModelInfo {
            filename: "ggml-large-v3.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        },
        _ => WhisperModelInfo {
            filename: "ggml-distil-large-v3.5.bin",
            url: "https://huggingface.co/distil-whisper/distil-large-v3.5-ggml/resolve/main/ggml-model.bin",
        },
    }
}

static SUPPRESS_WHISPER_LOGS: Once = Once::new();

fn suppress_whisper_logs() {
    SUPPRESS_WHISPER_LOGS.call_once(|| {
        unsafe {
            whisper_rs::set_log_callback(None, std::ptr::null_mut());
        }
    });
}

pub fn model_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("platypus_notes")
        .join("models")
}

pub fn model_path(model_id: &str) -> PathBuf {
    let info = get_model_info(model_id);
    model_dir().join(info.filename)
}

pub fn is_model_downloaded(model_id: &str) -> bool {
    let path = model_path(model_id);
    path.exists() && path.metadata().map(|m| m.len() > 1_000_000).unwrap_or(false)
}

pub async fn download_model(app_handle: &tauri::AppHandle, model_id: &str) -> Result<()> {
    use tauri::Manager;

    let info = get_model_info(model_id);
    let dir = model_dir();
    std::fs::create_dir_all(&dir)?;

    let dest = model_path(model_id);
    let tmp = dest.with_extension("bin.tmp");

    info!("Downloading whisper model from {}", info.url);

    let client = reqwest::Client::new();
    let resp = client.get(info.url).send().await
        .map_err(|e| anyhow!("Failed to start model download: {}", e))?;

    if !resp.status().is_success() {
        return Err(anyhow!("Model download failed with status {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    info!("Model size: {} MB", total_size / 1_048_576);

    let mut file = std::fs::File::create(&tmp)?;
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 0;

    use futures::StreamExt;
    use std::io::Write;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow!("Download error: {}", e))?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let percent = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            if percent != last_percent {
                last_percent = percent;
                if let Some(w) = app_handle.get_window("main") {
                    let _ = w.emit("model-download-progress", serde_json::json!({
                        "percent": percent
                    }));
                }
            }
        }
    }

    drop(file);
    std::fs::rename(&tmp, &dest)?;
    info!("Model downloaded successfully to {:?}", dest);

    Ok(())
}

pub struct WhisperEngine {
    ctx: WhisperContext,
}

impl WhisperEngine {
    pub fn load(model_id: &str) -> Result<Self> {
        let path = model_path(model_id);
        if !path.exists() {
            return Err(anyhow!("Whisper model not found at {:?}. Download it first.", path));
        }

        suppress_whisper_logs();
        info!("Loading whisper model from {:?}", path);

        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(
            path.to_str().ok_or_else(|| anyhow!("Invalid model path"))?,
            params,
        ).map_err(|e| anyhow!("Failed to load whisper model: {:?}", e))?;

        info!("Whisper model loaded successfully");
        Ok(Self { ctx })
    }

    pub fn transcribe(&self, samples_16k: &[f32]) -> Result<String> {
        if samples_16k.is_empty() {
            return Ok(String::new());
        }

        let mut state = self.ctx.create_state()
            .map_err(|e| anyhow!("Failed to create whisper state: {:?}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_translate(false);
        params.set_single_segment(true);
        params.set_no_timestamps(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_n_threads(4);

        state.full(params, samples_16k)
            .map_err(|e| anyhow!("Whisper inference failed: {:?}", e))?;

        let mut text = String::new();
        let n_segments = state.full_n_segments();

        for i in 0..n_segments {
            if let Some(segment) = state.get_segment(i) {
                if let Ok(segment_text) = segment.to_str_lossy() {
                    text.push_str(&segment_text);
                }
            }
        }

        let trimmed = text.trim().to_string();

        if is_hallucination(&trimmed) {
            warn!("Filtered hallucinated output: {:?}", trimmed);
            return Ok(String::new());
        }

        Ok(trimmed)
    }
}

fn is_hallucination(text: &str) -> bool {
    let lower = text.to_lowercase();

    let hallucinations = [
        "thank you",
        "thanks for watching",
        "subscribe",
        "like and subscribe",
        "see you next time",
        "bye",
        "you",
        "...",
    ];

    for h in &hallucinations {
        if lower.trim().trim_matches('.').trim() == *h {
            return true;
        }
    }

    if lower.len() <= 3 {
        return true;
    }

    false
}
