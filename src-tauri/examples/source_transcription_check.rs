//! Read-only local quality check: cargo run --example source_transcription_check -- <sources.wav> [model]
#[path = "../src/engine/whisper_engine.rs"]
#[allow(dead_code)]
mod whisper_engine;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let engine =
        whisper_engine::WhisperEngine::load(args.get(2).map(String::as_str).unwrap_or("large-v3"))?;
    let start = std::time::Instant::now();
    let transcript = platypus_notes::source_transcription::transcribe_source_wav(
        std::path::Path::new(args.get(1).ok_or("Expected stereo PCM16 WAV")?),
        |samples, rate, prompt| {
            let audio = platypus_notes::audio_processor::resample(samples, rate, 16000)
                .map_err(|e| e.to_string())?;
            let text = engine
                .transcribe_source_with_context(&audio, prompt)
                .map_err(|e| e.to_string())?;
            eprintln!("{:.2}s decoded: {}", audio.len() as f64 / 16000.0, text);
            Ok(text)
        },
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(
            &serde_json::json!({ "elapsed_seconds": start.elapsed().as_secs_f64(), "segments": transcript.segments, "text": transcript.text() })
        )?
    );
    Ok(())
}
