//! Compare identical audio/chunks with no prompt, history, and optional note hints.
//! cargo run --example transcription_context_check -- <mono WAV> [model] [hints]
//! Reads local files/models only; does not modify saved recordings.
#[path = "../src/engine/whisper_engine.rs"]
#[allow(dead_code)]
mod whisper_engine;
use platypus_notes::{
    audio_processor::resample,
    transcription_audio::{LiveTranscript, SpeechChunker},
    transcription_context::transcription_prompt,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mut wav = hound::WavReader::open(args.get(1).ok_or("Expected a mono PCM16 WAV")?)?;
    let spec = wav.spec();
    assert_eq!(spec.channels, 1);
    assert_eq!(spec.bits_per_sample, 16);
    let audio = wav
        .samples::<i16>()
        .map(|s| s.map(|s| s as f32 / 32768.0))
        .collect::<Result<Vec<_>, _>>()?;
    let mut chunker = SpeechChunker::new(spec.sample_rate);
    let mut chunks = Vec::new();
    for packet in audio.chunks((spec.sample_rate / 20) as usize) {
        chunks.extend(chunker.push(packet));
    }
    chunks.extend(chunker.finish());
    let chunks = chunks
        .iter()
        .map(|c| resample(c, spec.sample_rate, 16000))
        .collect::<Result<Vec<_>, _>>()?;
    let engine =
        whisper_engine::WhisperEngine::load(args.get(2).map(String::as_str).unwrap_or("large-v3"))?;
    let hints = args.get(3).map(String::as_str).unwrap_or("");
    let mut results = Vec::new();
    for (label, history, hints) in [
        ("baseline", false, ""),
        ("history", true, ""),
        ("history_and_hints", true, hints),
    ] {
        if label == "history_and_hints" && hints.is_empty() {
            continue;
        }
        let started = std::time::Instant::now();
        let mut transcript = LiveTranscript::default();
        let mut segments = Vec::new();
        for (i, chunk) in chunks.iter().enumerate() {
            let prompt = if history {
                transcription_prompt(hints, transcript.committed())
            } else {
                String::new()
            };
            let text = engine.transcribe_with_context(chunk, &prompt)?;
            eprintln!("{label}: chunk {}/{} complete", i + 1, chunks.len());
            segments.push(serde_json::json!({"seconds": chunk.len() as f64 / 16000.0, "prompt": prompt, "text": text}));
            transcript.commit(&text);
        }
        // Context must not turn trailing silence into continued speech.
        let prompt = transcription_prompt(hints, transcript.committed());
        let silence = engine.transcribe_with_context(&vec![0.0; 16000 * 3], &prompt)?;
        assert!(silence.is_empty(), "Prompt leaked into silence: {silence}");
        results.push(serde_json::json!({"mode": label, "elapsed_seconds": started.elapsed().as_secs_f64(), "text": transcript.committed(), "chunks": segments, "silence_text": silence}));
    }
    println!("{}", serde_json::to_string_pretty(&results)?);
    Ok(())
}
