//! Run against a local, mono 16kHz WAV: cargo run --example transcription_quality_check -- <wav> [model]
//! Uses only installed models. Does not record or upload audio.
#[path = "../src/engine/whisper_engine.rs"]
#[allow(dead_code)]
mod whisper_engine;
use platypus_notes::transcription_audio::{LiveTranscript, SpeechChunker};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let path = args.get(1).ok_or("Expected a mono 16kHz WAV path")?;
    let mut wav = hound::WavReader::open(path)?;
    assert_eq!(wav.spec().sample_rate, 16000);
    assert_eq!(wav.spec().channels, 1);
    let speech: Vec<f32> = wav
        .samples::<i16>()
        .map(|s| s.map(|s| s as f32 / 32768.0))
        .collect::<Result<_, _>>()?;
    let engine =
        whisper_engine::WhisperEngine::load(args.get(2).map(String::as_str).unwrap_or("large-v3"))?;
    if args.iter().any(|arg| arg == "--drafts") {
        assert!(engine.transcribe_preview(&speech, || true).is_err(), "Stop should cancel provisional inference");
        println!("Preview cancellation passed; running final quality checks on the same engine.");
    }
    for (label, audio) in [
        (
            "speech + 8s silence",
            [speech.clone(), vec![0.0; 16000 * 8]].concat(),
        ),
        (
            "quiet speech + 8s silence",
            [
                speech.iter().map(|s| s * 0.08).collect::<Vec<_>>(),
                vec![0.0; 16000 * 8],
            ]
            .concat(),
        ),
        ("silence only", vec![0.0; 16000 * 8]),
        (
            "intentionally repeated speech",
            [speech.clone(), vec![0.0; 16000], speech].concat(),
        ),
    ] {
        let mut chunker = SpeechChunker::new(16000);
        let mut transcript = LiveTranscript::default();
        let drafts = args.iter().any(|arg| arg == "--drafts");
        let mut count = 0;
        for packet in audio.chunks(800) {
            for chunk in chunker.push(packet) {
                transcript.commit(&engine.transcribe(&chunk)?);
                count += 1;
            }
            if drafts {
                if let Some(preview) = chunker.take_preview() {
                    let started = std::time::Instant::now();
                    transcript.revise(engine.transcribe_preview(&preview, || false)?);
                    println!(
                        "  draft ({:.2}s): {}",
                        started.elapsed().as_secs_f32(),
                        transcript.update(false).draft_text
                    );
                }
            }
        }
        for chunk in chunker.finish() {
            transcript.commit(&engine.transcribe(&chunk)?);
            count += 1;
        }
        println!("{} ({} chunks): {}", label, count, transcript.committed());
    }
    Ok(())
}
