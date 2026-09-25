use super::model_settings::saved_effort;
use crate::{configuration::state::ServiceAccess, repository::settings_repository::get_setting};
use platypus_notes::{
    models::{selected_model, DEFAULT_OPENAI_MODEL},
    presentation::{create_designed_presentation, presentation_request, DesignedPresentation},
};
use platypus_notes::{
    presentation_library::{self, SavedPresentation},
    slides::Slide,
};
use serde::Deserialize;
use std::{path::PathBuf, time::Instant};

fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path_resolver()
        .app_data_dir()
        .map(|path| path.join("presentations"))
        .ok_or_else(|| "Could not locate your presentations folder.".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationRequest {
    plain_text: String,
    provider: String,
    model_id: String,
    focus: String,
    slide_count: u32,
    kind: String,
    source_id: Option<i64>,
    source_title: String,
    effort: Option<String>,
}

#[tauri::command]
pub async fn generate_saved_presentation(
    app_handle: tauri::AppHandle,
    request: PresentationRequest,
) -> Result<SavedPresentation, String> {
    let root = library_root(&app_handle)?;
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Could not create your presentations folder: {}", e))?;
    if request.plain_text.trim().is_empty() {
        return Err("Write or import a note before generating slides.".into());
    }
    let started = Instant::now();
    let mut saved = SavedPresentation {
        id: String::new(),
        title: format!("{} — Slides", request.source_title.trim()),
        source_id: request.source_id,
        source_title: request.source_title,
        created_at: String::new(),
        kind: request.kind.clone(),
        model: request.model_id.clone(),
        effort: request.effort.clone(),
        elapsed_seconds: 0,
        slide_count: 0,
        file_path: None,
        slides: None,
    };
    if request.kind == "designed" {
        if request.provider != "openai" {
            return Err("Choose an OpenAI model for a designed PowerPoint.".into());
        }
        let key = app_handle
            .db(|db| get_setting(db, "api_key_open_ai"))
            .map_err(|_| "Add an OpenAI API key in Settings.".to_string())?
            .setting_value;
        if key.trim().is_empty() {
            return Err("Add an OpenAI API key in Settings.".into());
        }
        let body = presentation_request(
            &request.plain_text,
            &request.focus,
            request.slide_count,
            &request.model_id,
            request.effort.as_deref(),
        )?;
        let deck = create_designed_presentation(&key, body).await?;
        saved.model = deck.model;
        saved.effort = deck.effort;
        saved.elapsed_seconds = deck.elapsed_seconds;
        presentation_library::save_new(&root, saved, Some(&deck.bytes))
    } else if request.kind == "simple" {
        let slides = super::document_cleanup_engine::generate_slides_from_document(
            app_handle,
            request.plain_text,
            request.provider,
            Some(request.model_id),
            Some(request.focus),
            Some(request.slide_count),
        )
        .await?;
        saved.slide_count = slides.len();
        saved.slides = Some(slides);
        saved.elapsed_seconds = started.elapsed().as_secs();
        presentation_library::save_new(&root, saved, None)
    } else {
        Err("Unknown presentation style.".into())
    }
}

#[tauri::command]
pub fn list_saved_presentations(
    app_handle: tauri::AppHandle,
) -> Result<Vec<SavedPresentation>, String> {
    presentation_library::list(&library_root(&app_handle)?)
}

#[tauri::command]
pub fn update_saved_presentation(
    app_handle: tauri::AppHandle,
    id: String,
    slides: Vec<Slide>,
) -> Result<SavedPresentation, String> {
    presentation_library::update_slides(&library_root(&app_handle)?, &id, slides)
}

#[tauri::command]
pub fn read_saved_presentation_file(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<Vec<u8>, String> {
    presentation_library::read_powerpoint(&library_root(&app_handle)?, &id)
}

#[tauri::command]
pub fn open_saved_presentation(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = library_root(&app_handle)?;
    let deck = presentation_library::load(&root, &id)?;
    if deck.file_path.is_none() {
        return Err("Open this deck in the slide editor and export it first.".into());
    }
    let path = root.join(&deck.id).join("presentation.pptx");
    if !path.is_file() {
        return Err("The saved PowerPoint could not be found. It may have been moved.".into());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&path).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&path).spawn();
    result
        .map(|_| ())
        .map_err(|e| format!("Could not open PowerPoint: {}", e))
}

#[tauri::command]
pub async fn generate_designed_presentation(
    app_handle: tauri::AppHandle,
    plain_text: String,
    model_id: Option<String>,
    focus: Option<String>,
    slide_count: Option<u32>,
) -> Result<DesignedPresentation, String> {
    let key = app_handle
        .db(|db| get_setting(db, "api_key_open_ai"))
        .map_err(|_| "OpenAI API key is not configured. Add it in Settings.".to_string())?
        .setting_value;
    if key.trim().is_empty() {
        return Err("OpenAI API key is not configured. Add it in Settings.".into());
    }
    let model = selected_model(model_id.as_deref(), DEFAULT_OPENAI_MODEL);
    let effort = saved_effort(&app_handle, model);
    let request = presentation_request(
        &plain_text,
        focus.as_deref().unwrap_or("Brief the team"),
        slide_count.unwrap_or(5),
        model,
        effort.as_deref(),
    )?;
    create_designed_presentation(&key, request).await
}
