use platypus_notes::recording_audio::{self, SavedRecording};
use tauri::AppHandle;

pub fn recording_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path_resolver()
        .app_data_dir()
        .map(|p| p.join("recordings"))
        .ok_or("Could not find recordings folder".into())
}
#[tauri::command]
pub fn get_audio_capture_status() -> crate::engine::audio_engine::CaptureStatus {
    crate::engine::audio_engine::capture_status()
}
#[derive(serde::Serialize)]
pub struct RecordingDetails {
    #[serde(flatten)]
    recording: SavedRecording,
    audio_available: bool,
}
#[tauri::command]
pub fn list_recordings(
    app_handle: AppHandle,
    note_id: Option<i64>,
) -> Result<Vec<RecordingDetails>, String> {
    let mut recordings = recording_audio::list(&recording_root(&app_handle)?, note_id)?;
    let active = crate::engine::audio_engine::capture_status();
    for recording in &mut recordings {
        if recording.status == "recording"
            && !(active.recording && active.recording_id == recording.id)
        {
            recording.status = "interrupted".into();
            if let Ok(wav) = hound::WavReader::open(
                recording_audio::directory(&recording_root(&app_handle)?, &recording.id)?
                    .join("audio.wav"),
            ) {
                recording.duration_seconds = wav.duration() as f64 / wav.spec().sample_rate as f64;
            }
            recording.warning = Some("Recording was interrupted. Audio written before the interruption is available below.".into());
        }
    }
    let root = recording_root(&app_handle)?;
    recordings.into_iter().map(|recording| {
        let audio_available = recording_audio::directory(&root, &recording.id)?.join("audio.wav").is_file();
        Ok(RecordingDetails { recording, audio_available })
    }).collect()
}
#[tauri::command]
pub fn list_recording_transcripts(
    app_handle: AppHandle,
    id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let root = recording_root(&app_handle)?;
    recording_audio::load(&root, &id)?;
    let mut versions = Vec::new();
    for entry in std::fs::read_dir(recording_audio::directory(&root, &id)?)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("transcript-") && name.ends_with(".json") {
            if let Ok(bytes) = std::fs::read(entry.path()) {
                if let Ok(mut version) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    version["id"] = name.into();
                    versions.push(version);
                }
            }
        }
    }
    versions.sort_by(|a, b| b["created_at"].as_str().cmp(&a["created_at"].as_str()));
    Ok(versions)
}
#[tauri::command]
pub fn attach_recording(app_handle: AppHandle, id: String, note_id: i64) -> Result<(), String> {
    let root = recording_root(&app_handle)?;
    let mut recording = recording_audio::load(&root, &id)?;
    recording.note_id = Some(note_id);
    recording_audio::save_metadata(&root, &recording)
}
#[tauri::command]
pub fn recording_audio_path(app_handle: AppHandle, id: String) -> Result<String, String> {
    let root = recording_root(&app_handle)?;
    recording_audio::load(&root, &id)?;
    let path = recording_audio::directory(&root, &id)?.join("audio.wav");
    if !path.is_file() {
        return Err("The recording file is missing.".into());
    }
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn export_recording(
    app_handle: AppHandle,
    id: String,
    isolated: bool,
) -> Result<bool, String> {
    let root = recording_root(&app_handle)?;
    recording_audio::load(&root, &id)?;
    let path = recording_audio::directory(&root, &id)?.join(if isolated {
        "sources.wav"
    } else {
        "audio.wav"
    });
    tokio::task::spawn_blocking(move || {
        let destination = tauri::api::dialog::blocking::FileDialogBuilder::new()
            .set_file_name(&format!(
                "Platypus-{}{}.wav",
                id,
                if isolated { "-separate-sources" } else { "" }
            ))
            .add_filter("WAV audio", &["wav"])
            .save_file();
        if let Some(destination) = destination {
            std::fs::copy(path, destination).map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn retranscribe_recording(app_handle: AppHandle, id: String) -> Result<String, String> {
    // Serialize with live capture and other retranscriptions. Never replace a
    // note automatically: the caller previews this result before inserting it.
    let _session = crate::LOCAL_TRANSCRIPTION_TASK.lock().await;
    if crate::engine::audio_engine::IS_RECORDING.load(std::sync::atomic::Ordering::SeqCst)
        || _session.is_some()
    {
        return Err("Finish the current recording before retranscribing.".into());
    }
    let root = recording_root(&app_handle)?;
    let recording = recording_audio::load(&root, &id)?;
    if recording.status == "failed" {
        return Err("This recording did not capture any audio.".into());
    }
    let path = recording_audio::directory(&root, &id)?.join("audio.wav");
    let model = crate::get_whisper_model_id(&app_handle);
    let selected_model = model.clone();
    // No live inference can be running while the session lock is held. Release
    // the previous model before loading a comparison model (several GB each).
    *crate::WHISPER_ENGINE.lock().unwrap() = None;
    let text = tokio::task::spawn_blocking(move || {
        let engine = crate::engine::whisper_engine::WhisperEngine::load(&selected_model)
            .map_err(|e| e.to_string())?;
        let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
        let rate = reader.spec().sample_rate;
        let mut transcript = platypus_notes::transcription_audio::LiveTranscript::default();
        let mut transcribe = |chunk: &[f32]| -> Result<(), String> {
            let samples = platypus_notes::audio_processor::resample(chunk, rate, 16000)
                .map_err(|e| e.to_string())?;
            let prompt = platypus_notes::transcription_context::transcription_prompt("", transcript.committed());
            let text = engine.transcribe_with_context(&samples, &prompt).map_err(|e| e.to_string())?;
            transcript.commit(&text);
            Ok(())
        };
        let mut chunker = platypus_notes::transcription_audio::SpeechChunker::new(rate);
        let mut buffer = Vec::with_capacity(rate as usize);
        for sample in reader.samples::<i16>() {
            buffer.push(sample.map_err(|e| e.to_string())? as f32 / 32768.0);
            if buffer.len() == rate as usize {
                for chunk in chunker.push(&buffer) {
                    transcribe(&chunk)?;
                }
                buffer.clear();
            }
        }
        for chunk in chunker.push(&buffer).into_iter().chain(chunker.finish()) {
            transcribe(&chunk)?;
        }
        Ok::<String, String>(transcript.committed().to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    // Preserve the original transcript alongside a separately named comparison.
    let comparison = serde_json::json!({ "model": model, "created_at": chrono::Utc::now().to_rfc3339(), "text": text, "contextual": true });
    let dir = recording_audio::directory(&root, &id)?;
    std::fs::write(
        dir.join(format!(
            "transcript-{}.json",
            chrono::Utc::now().format("%Y%m%d%H%M%S%6f")
        )),
        serde_json::to_vec_pretty(&comparison).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    recording_audio::finish_transcription(&root, &id, &text)?;
    Ok(text)
}
