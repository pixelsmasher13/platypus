use std::path::Path;
use reqwest::{self, multipart, StatusCode};
use anyhow::{Result, anyhow};
use log::{info, warn, error};
use std::time::Duration;

/// Transcribe audio using OpenAI's Whisper API
pub async fn transcribe_with_openai(file_path: &str, api_key: &str) -> Result<String> {
    info!("Transcribing with OpenAI Whisper API: {}", file_path);
    
    // Prepare file for upload
    let file_name = Path::new(file_path).file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("audio.wav");
    
    // Read file as bytes
    let file_bytes = std::fs::read(file_path)?;
    info!("Audio file size: {} bytes", file_bytes.len());
    
    // Check file size - Whisper has a 25MB limit
    if file_bytes.len() > 24 * 1024 * 1024 {
        return Err(anyhow!("Audio file exceeds size limit (24 MB). File size: {} MB", 
            file_bytes.len() / (1024 * 1024)));
    }
    
    // Build client with longer timeout (120 seconds for large files)
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()?;
    
    // Implement retry logic with exponential backoff
    for attempt in 0..5 {
        if attempt > 0 {
            info!("Retry attempt {} for transcription", attempt);
        }
        
        // Create a new form for each request (since Form is not cloneable)
        let form = multipart::Form::new()
            .part("file", multipart::Part::bytes(file_bytes.to_vec())
                .file_name(file_name.to_string())
                .mime_str("audio/wav")?)
            .text("model", "whisper-1")
            .text("response_format", "text");
        
        let response_result = client.post("https://api.openai.com/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await;
            
        match response_result {
            Ok(response) => {
                if response.status().is_success() {
                    let text = response.text().await?;
                    info!("Transcription successful, length: {}", text.len());
                    return Ok(text);
                } else {
                    let status = response.status();
                    let error_text = response.text().await.unwrap_or_default();
                    error!("Transcription failed with status {}: {}", status, error_text);
                    
                    // Handle rate limits and server errors with retry
                    if status == StatusCode::TOO_MANY_REQUESTS || 
                       status.as_u16() >= 500 && status.as_u16() < 600 {
                        let sleep_duration = Duration::from_secs(2u64.pow(attempt));
                        warn!("Rate limited or server error, sleeping for {}s before retry", sleep_duration.as_secs());
                        tokio::time::sleep(sleep_duration).await;
                        continue;
                    }
                    
                    // For other errors, return immediately
                    return Err(anyhow!("OpenAI API error {}: {}", status, error_text));
                }
            },
            Err(err) => {
                // For connection/timeout errors, retry with backoff
                error!("Request error: {}", err);
                let sleep_duration = Duration::from_secs(2u64.pow(attempt));
                warn!("Connection error, sleeping for {}s before retry", sleep_duration.as_secs());
                tokio::time::sleep(sleep_duration).await;
            }
        }
    }
    
    Err(anyhow!("Failed to transcribe audio after multiple attempts"))
}
