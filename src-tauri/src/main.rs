// Prevents additional console window on Windows in release!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::engine::model_settings::set_model_effort;
use std::env;
use std::sync::Arc;

use lazy_static::lazy_static;
use log::info;
use rusqlite::Connection;
use serde_derive::Serialize;
use tauri::utils::config::AppUrl;
use tauri::SystemTray;
use tauri::{AppHandle, Manager, State, SystemTrayEvent, WindowUrl};
use tauri::{CustomMenuItem, SystemTrayMenu};
use tauri_plugin_log::LogTarget;
use tokio::sync::Mutex;

use configuration::settings::Settings;

use crate::bootstrap::{fix_path_env, prerequisites, setup_directories};
use crate::configuration::database;
use crate::configuration::database::drop_database_handle;
use crate::configuration::state::{AppState, ServiceAccess};
use crate::engine::chat_engine::{name_conversation, send_prompt_to_llm};
use crate::engine::chat_engine_openai::{generate_conversation_name, send_prompt_to_openai};
use crate::engine::chat_engine_gemini::{name_conversation_gemini, send_prompt_to_gemini};
use crate::engine::chat_engine_local::{name_conversation_local, send_prompt_to_local};
use crate::engine::clean_up_engine::clean_up;
use crate::engine::document_cleanup_engine::{clean_up_document_with_llm, summarize_as_meeting_notes, generate_slides_from_document, draft_follow_up_email, generate_suggested_questions};
use crate::engine::podcast_generator::{generate_podcast_from_document, list_elevenlabs_voices};
use crate::engine::meeting_popup::{meeting_popup_dismiss, meeting_popup_start_recording};
use crate::engine::url_ingestion::ingest_url_command;
use crate::engine::similarity_search_engine::SyncSimilaritySearch;
use crate::entity::chat_item::{Chat, StoredMessage};
use crate::entity::permission::Permission;
use crate::entity::project::Project;
use crate::entity::setting::Setting;
use crate::permissions::permission_engine::init_permissions;
use crate::repository::chat_db_repository;
use crate::repository::chunk_repository::{save_chunks_for_document, get_chunk_full_text};
use crate::repository::permissions_repository::{get_permissions, update_permission};
use crate::repository::project_repository::{
    delete_project, fetch_all_projects, add_blank_document, save_project, update_project, get_activity_text_from_project, get_activity_plain_text, get_project_id_for_document, update_activity_text, update_activity_name, delete_project_document, ensure_unassigned_project, move_document_to_project, get_all_documents, search_documents_by_content,
};
use crate::repository::settings_repository::{get_setting, get_settings, insert_or_update_setting};
use tauri_plugin_autostart::MacosLauncher;

mod bootstrap;
mod configuration;
mod engine;
mod entity;
pub mod permissions;
mod repository;

#[derive(Clone, Serialize)]
struct Payload {
    data: bool,
}

#[cfg(debug_assertions)]
const USE_LOCALHOST_SERVER: bool = false;
#[cfg(not(debug_assertions))]
const USE_LOCALHOST_SERVER: bool = true;

lazy_static! {
    static ref HNSW: SyncSimilaritySearch = Arc::new(Mutex::new(None));
    static ref WHISPER_ENGINE: Arc<std::sync::Mutex<Option<crate::engine::whisper_engine::WhisperEngine>>> =
        Arc::new(std::sync::Mutex::new(None));
    static ref LOCAL_TRANSCRIPTION_TASK: tokio::sync::Mutex<Option<tokio::task::JoinHandle<Result<String, String>>>> =
        tokio::sync::Mutex::new(None);
    static ref ACCUMULATED_TRANSCRIPT: Arc<std::sync::Mutex<String>> =
        Arc::new(std::sync::Mutex::new(String::new()));
}

//#[cfg(any(target_os = "macos"))]
//static ACCESSIBILITY_PERMISSIONS_GRANTED: AtomicBool = AtomicBool::new(false);

#[tokio::main]
async fn main() {
    let port = 5173;
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_oauth::init());

    fix_path_env::fix_all_vars().expect("Failed to load env");
    let tray = build_system_tray();

    let mut context = tauri::generate_context!();

    let url = format!("http://localhost:{}", port).parse().unwrap();
    let window_url = WindowUrl::External(url);

    if USE_LOCALHOST_SERVER == true {
        context.config_mut().build.dist_dir = AppUrl::Url(window_url.clone());
        context.config_mut().build.dev_path = AppUrl::Url(window_url.clone());
        builder = builder.plugin(tauri_plugin_localhost::Builder::new(port).build());
    }

    builder
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([LogTarget::Stdout, LogTarget::Webview])
                .level_for("hnsw_rs", log::LevelFilter::Warn)
                .level_for("html5ever", log::LevelFilter::Warn)
                .level_for("selectors", log::LevelFilter::Warn)
                .level_for("tao", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_positioner::init())
        .system_tray(tray)
        .on_system_tray_event(|app, event| match event {
            // Ensure the window is toggled when the tray icon is clicked
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                if window.is_visible().unwrap() {
                    window.hide().unwrap();
                } else {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "start_stop_recording" => {
                    let wrapped_window = app.get_window("main");
                    if let Some(window) = wrapped_window {
                        window
                            .emit("toggle_recording", Payload { data: true })
                            .unwrap();
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            update_settings,
            set_model_effort,
            engine::chatgpt_auth::chatgpt_sign_in,
            engine::chatgpt_auth::chatgpt_cancel_sign_in,
            engine::chatgpt_auth::chatgpt_sign_out,
            engine::chatgpt_auth::chatgpt_status,
            get_latest_settings,
            send_prompt_to_llm,
            send_prompt_to_openai,
            send_prompt_to_gemini,
            send_prompt_to_local,
            generate_conversation_name,
            name_conversation_gemini,
            name_conversation_local,
            name_conversation,
            create_chat,
            get_all_chats,
            create_message,
            get_messages_by_chat_id,
            update_chat_name,
            update_app_permissions,
            get_app_permissions,
            get_projects,
            save_app_project,
            update_app_project,
            delete_app_project,
            delete_chat,
            get_chunk_text,
            prompt_for_accessibility_permissions,
            get_app_project_activity_text,
            update_project_activity_text,
            append_project_activity_text,
            vectorize_document_chunks,
            add_project_blank_activity,
            update_project_activity_name,
            delete_project_activity,
            ensure_unassigned_activity,
            update_project_activity_content,
            get_app_project_activity_plain_text,
            get_all_project_documents,
            start_audio_recording,
            stop_audio_recording,
            read_audio_file,
            get_audio_capture_status,
            list_recordings,
            list_recording_transcripts,
            attach_recording,
            recording_audio_path,
            export_recording,
            retranscribe_recording,
            transcribe_audio,
            extract_document_text,
            ingest_url_command,
            clean_up_document_with_llm,
            summarize_as_meeting_notes,
            draft_follow_up_email,
            generate_suggested_questions,
            search_documents_content,
            generate_slides_from_document,
            engine::presentation_engine::generate_designed_presentation,
            engine::presentation_engine::generate_saved_presentation,
            engine::presentation_engine::list_saved_presentations,
            engine::presentation_engine::update_saved_presentation,
            engine::presentation_engine::read_saved_presentation_file,
            engine::presentation_engine::open_saved_presentation,
            generate_podcast_from_document,
            list_elevenlabs_voices,
            check_whisper_model,
            download_whisper_model,
            init_whisper_model,
            get_transcript,
            meeting_popup_dismiss,
            meeting_popup_start_recording,
        ])
        .manage(AppState {
            db: Default::default(),
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                event.window().hide().unwrap(); // Hide window on close
            }
            _ => {}
        })
        .setup(move |app| {
            let args: Vec<String> = env::args().collect();
            let should_start_minimized = args.contains(&"--minimized".to_string());

            let window = app.get_window("main").unwrap();

            if should_start_minimized {
                window.hide().unwrap();
            } else {
                window.show().unwrap();
            }

            let app_handle = app.handle();
            let _ = setup_directories::setup_dirs(
                app_handle
                    .path_resolver()
                    .app_data_dir()
                    .unwrap()
                    .to_str()
                    .unwrap(),
            );
            prerequisites::check_and_install_prerequisites(
                app_handle
                    .path_resolver()
                    .resource_dir()
                    .unwrap()
                    .to_str()
                    .unwrap(),
            );
            clean_up(app_handle.path_resolver().app_data_dir().unwrap());
            setup_keypress_listener(&app_handle);

            // Load meeting detection setting from DB and start the detector thread
            let detection_enabled = app_handle.db(|db| {
                get_setting(db, "meeting_detection_enabled")
                    .map(|s| s.setting_value == "true")
                    .unwrap_or(false)
            });
            engine::meeting_detector::MEETING_DETECTION_ENABLED
                .store(detection_enabled, std::sync::atomic::Ordering::Relaxed);
            engine::meeting_detector::start_meeting_detection(app_handle.clone());

            init_app_permissions(app_handle);
            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
    drop_database_handle().await;
}

fn build_system_tray() -> SystemTray {
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let tray_menu = SystemTrayMenu::new()
        .add_item(quit);
    SystemTray::new().with_menu(tray_menu)
}

fn setup_keypress_listener(app_handle: &AppHandle) {
    let app_state: State<AppState> = app_handle.state();

    let db: Connection =
        database::initialize_database(&app_handle).expect("Database initialization failed!");
    *app_state.db.lock().unwrap() = Some(db);
}

#[tauri::command]
fn get_latest_settings(app_handle: AppHandle) -> Result<Vec<Setting>, ()> {
    let settings = app_handle.db(|db| get_settings(db).unwrap());
    // ChatGPT tokens stay in the backend; the UI reads `chatgpt_status` instead.
    let settings = settings
        .into_iter()
        .filter(|s| !s.setting_key.starts_with(engine::chatgpt_auth::SECRET_PREFIX))
        .collect();
    return Ok(settings);
}

#[tauri::command]
async fn update_settings(app_handle: AppHandle, settings: Settings) {
    info!("update_settings: {:?}", settings);
    app_handle.db(|db| {
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("interval"),
                setting_value: format!("{}", settings.interval),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("is_dev_mode"),
                setting_value: format!("{}", settings.is_dev_mode),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("auto_start"),
                setting_value: format!("{}", settings.auto_start),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("api_choice"),
                setting_value: format!("{}", settings.api_choice),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("api_key_claude"),
                setting_value: format!("{}", settings.api_key_claude),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("api_key_open_ai"),
                setting_value: format!("{}", settings.api_key_open_ai),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("api_key_gemini"),
                setting_value: format!("{}", settings.api_key_gemini),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("local_model_url"),
                setting_value: format!("{}", settings.local_model_url),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("vectorization_enabled"),
                setting_value: format!("{}", settings.vectorization_enabled),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("rag_top_k"),
                setting_value: format!("{}", settings.rag_top_k),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("meeting_detection_enabled"),
                setting_value: format!("{}", settings.meeting_detection_enabled),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("model_claude"),
                setting_value: settings.model_claude.clone(),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("model_openai"),
                setting_value: settings.model_openai.clone(),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("model_gemini"),
                setting_value: settings.model_gemini.clone(),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("use_local_transcription"),
                setting_value: format!("{}", settings.use_local_transcription),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("keep_recordings"),
                setting_value: settings.keep_recordings.to_string(),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("whisper_model"),
                setting_value: settings.whisper_model.clone(),
            },
        )
        .unwrap();
        insert_or_update_setting(
            db,
            Setting {
                setting_key: String::from("api_key_elevenlabs"),
                setting_value: settings.api_key_elevenlabs.clone(),
            },
        )
        .unwrap();
    });

    // Update the runtime flag so the detection loop picks up the change immediately
    engine::meeting_detector::MEETING_DETECTION_ENABLED
        .store(settings.meeting_detection_enabled, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn init_app_permissions(app_handle: AppHandle) {
    init_permissions(app_handle);
}

#[tauri::command]
fn update_app_permissions(app_handle: AppHandle, app_path: String, allow: bool) {
    app_handle.db(|database| {
        update_permission(database, app_path, allow).expect("Failed to update permission");
    })
}

#[tauri::command]
fn get_app_permissions(app_handle: AppHandle) -> Result<Vec<Permission>, ()> {
    let permissions = app_handle.db(|database| get_permissions(database).unwrap());
    return Ok(permissions);
}

#[tauri::command]
fn get_projects(app_handle: AppHandle) -> Result<Vec<Project>, ()> {
    let projects = app_handle.db(|database| fetch_all_projects(database).unwrap());
    return Ok(projects);
}

#[tauri::command]
fn save_app_project(
    app_handle: AppHandle,
    name: &str,
    activities: Vec<i64>,
) -> Result<Vec<i64>, ()> {
    app_handle.db(|database| save_project(database, name, &activities).unwrap());
    return Ok(activities);
}

#[tauri::command]
fn update_app_project(
    app_handle: AppHandle,
    id: i64,
    name: &str,
    activities: Vec<i64>,
) -> Result<Vec<i64>, ()> {
    app_handle.db(|database| update_project(database, id, name, &activities).unwrap());
    return Ok(activities);
}

#[tauri::command]
fn delete_app_project(app_handle: AppHandle, project_id: i64) -> Result<i64, ()> {
    app_handle.db(|database| delete_project(database, project_id).unwrap());
    return Ok(project_id);
}

#[tauri::command]
fn create_chat(app_handle: AppHandle, name: &str) -> Result<i64, String> {
    app_handle
        .db(|db| chat_db_repository::create_chat(db, name))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_chats(app_handle: AppHandle) -> Result<Vec<Chat>, String> {
    app_handle
        .db(|db| chat_db_repository::get_all_chats(db))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_message(
    app_handle: AppHandle,
    chat_id: i64,
    role: &str,
    content: &str,
    sources: Option<String>,
) -> Result<i64, String> {
    app_handle
        .db(|db| chat_db_repository::create_message(db, chat_id, role, content, sources.as_deref()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_messages_by_chat_id(
    app_handle: AppHandle,
    chat_id: i64,
) -> Result<Vec<StoredMessage>, String> {
    app_handle
        .db(|db| chat_db_repository::get_messages_by_chat_id(db, chat_id))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_chat_name(app_handle: AppHandle, chat_id: i64, name: &str) -> Result<bool, String> {
    app_handle
        .db(|db| chat_db_repository::update_chat(db, chat_id, name))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_chat(app_handle: AppHandle, chat_id: i64) -> Result<bool, String> {
    app_handle
        .db(|db| chat_db_repository::delete_chat(db, chat_id))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_chunk_text(app_handle: AppHandle, chunk_id: i64) -> Result<Option<String>, String> {
    app_handle
        .db(|db| get_chunk_full_text(db, chunk_id))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_project_activity_text(
    app_handle: AppHandle,
    project_id: i64,
    activity_id: i64,
) -> Result<String, ()> {
    // Properly propagate errors instead of unwrapping
    let text = app_handle.db(|database| {
        match get_activity_text_from_project(database, project_id, activity_id) {
            Ok(text) => Ok(text),
            Err(_) => Err(())  // Or provide more specific error information
        }
    })?;  // Propagate error with ? operator
    
    Ok(text)
}

#[tauri::command]
fn get_app_project_activity_plain_text(
    app_handle: AppHandle,
    activity_id: i64,
) -> Result<(String, String), String> {
    app_handle
        .db(|database| get_activity_plain_text(database, activity_id))
        .map_err(|e| e.to_string())
}

/// Get all documents across all projects for the "Add content to Platypus" modal
#[tauri::command]
fn get_all_project_documents(
    app_handle: AppHandle,
) -> Result<Vec<(i64, String, String, String)>, String> {
    app_handle
        .db(|database| get_all_documents(database))
        .map_err(|e| e.to_string())
}

/// Content search over document plain text; returns matching document IDs so
/// the notes list can include content hits alongside name matches.
#[tauri::command]
fn search_documents_content(
    app_handle: AppHandle,
    search_term: String,
) -> Result<Vec<i64>, String> {
    let term = search_term.trim().to_string();
    if term.is_empty() {
        return Ok(vec![]);
    }
    app_handle
        .db(|database| search_documents_by_content(database, &term))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_project_activity_content(
    app_handle: AppHandle,
    document_id: i64,
    target_project_id: i64,
) -> Result<(), String> {
    app_handle
        .db(|database| {
            move_document_to_project(database, document_id, target_project_id)
                .map_err(|e| e.to_string())
        })
        .map_err(|e| e.to_string())
}

// Append a completed recording to its original note after navigation. The read
// and write share the DB lock so newer persisted edits are never overwritten.
#[tauri::command]
fn append_project_activity_text(app_handle: AppHandle, activity_id: i64, text: String) -> Result<(), String> {
    app_handle.db(|db| {
        let existing: String = db.query_row(
            "SELECT full_document_text FROM projects_activities WHERE id = ?1",
            rusqlite::params![activity_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        update_activity_text(db, activity_id, &(existing + &text)).map_err(|e| e.to_string())?;
        if get_setting(db, "vectorization_enabled").map(|s| s.setting_value == "true").unwrap_or(false) {
            let project_id = get_project_id_for_document(db, activity_id).map_err(|e| e.to_string())?;
            let (_, plain_text) = get_activity_plain_text(db, activity_id).map_err(|e| e.to_string())?;
            save_chunks_for_document(db, activity_id, project_id, &plain_text).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

#[tauri::command]
fn update_project_activity_text(
    app_handle: AppHandle,
    activity_id: i64,
    text: &str,
) -> Result<(), String> {
    // Update the document text (this also generates plain_text)
    app_handle
        .db(|db| update_activity_text(db, activity_id, text))
        .map_err(|e| e.to_string())?;
    
    // Only chunk if vectorization is enabled
    let vectorization_enabled = app_handle
        .db(|db| get_setting(db, "vectorization_enabled"))
        .map(|s| s.setting_value == "true")
        .unwrap_or(false);

    if vectorization_enabled {
        let (project_id, plain_text) = app_handle
            .db(|db| {
                let project_id = get_project_id_for_document(db, activity_id)?;
                let (_, plain_text) = get_activity_plain_text(db, activity_id)?;
                Ok::<(i64, String), rusqlite::Error>((project_id, plain_text))
            })
            .map_err(|e| e.to_string())?;

        app_handle
            .db(|db| save_chunks_for_document(db, activity_id, project_id, &plain_text))
            .map_err(|e| e.to_string())?;

        info!("Document {} updated and chunked", activity_id);
    } else {
        info!("Document {} updated (vectorization disabled, skipping chunking)", activity_id);
    }
    Ok(())
}

/// Vectorize all unvectorized chunks for a document
/// Called after document is saved when vectorization is enabled
/// Uses per-project vector indices for proper scoping
#[tauri::command]
async fn vectorize_document_chunks(
    app_handle: AppHandle,
    document_id: i64,
) -> Result<i32, String> {
    use crate::repository::chunk_repository::mark_chunk_as_vectorized;
    use crate::engine::project_vector_engine::{add_chunk_to_project_vectors, sync_project_vectors};
    use log::{info, error};
    
    // Check if vectorization is enabled
    let vectorization_enabled = app_handle
        .db(|db| get_setting(db, "vectorization_enabled"))
        .map(|s| s.setting_value == "true")
        .unwrap_or(false);
    
    if !vectorization_enabled {
        info!("Vectorization disabled, skipping for document {}", document_id);
        return Ok(0);
    }
    
    // Get OpenAI API key
    let api_key = app_handle
        .db(|db| get_setting(db, "api_key_open_ai"))
        .map(|s| s.setting_value)
        .unwrap_or_default();
    
    if api_key.is_empty() {
        info!("No OpenAI API key, skipping vectorization for document {}", document_id);
        return Ok(0);
    }
    
    // Get project_id for the document
    let project_id = app_handle
        .db(|db| get_project_id_for_document(db, document_id))
        .map_err(|e| e.to_string())?;
    
    // Get unvectorized chunks for this document
    let chunks = app_handle
        .db(|db| {
            let mut stmt = db.prepare(
                "SELECT id, document_id, project_id, chunk_index, chunk_text, is_vectorized
                 FROM document_chunks 
                 WHERE document_id = ?1 AND is_vectorized = 0"
            )?;
            
            let chunks: Vec<crate::repository::chunk_repository::DocumentChunk> = stmt.query_map(
                rusqlite::params![document_id],
                |row| {
                    Ok(crate::repository::chunk_repository::DocumentChunk {
                        id: row.get(0)?,
                        document_id: row.get(1)?,
                        project_id: row.get(2)?,
                        chunk_index: row.get(3)?,
                        chunk_text: row.get(4)?,
                        is_vectorized: row.get::<_, i32>(5)? == 1,
                    })
                }
            )?.collect::<Result<Vec<_>, _>>()?;
            
            Ok::<Vec<crate::repository::chunk_repository::DocumentChunk>, rusqlite::Error>(chunks)
        })
        .map_err(|e| e.to_string())?;
    
    if chunks.is_empty() {
        info!("No chunks to vectorize for document {}", document_id);
        return Ok(0);
    }
    
    info!("Vectorizing {} chunks for document {} in project {}", chunks.len(), document_id, project_id);
    
    let mut vectorized_count = 0;
    
    for chunk in chunks {
        // Add to project-specific vector index
        if let Err(e) = add_chunk_to_project_vectors(
            &app_handle,
            project_id,
            chunk.id,
            &chunk.chunk_text,
            &api_key
        ).await {
            error!("Failed to vectorize chunk {}: {}", chunk.id, e);
            continue;
        }
        
        // Mark as vectorized in DB
        if let Err(e) = app_handle.db(|db| mark_chunk_as_vectorized(db, chunk.id)) {
            error!("Failed to mark chunk {} as vectorized: {}", chunk.id, e);
            continue;
        }
        
        vectorized_count += 1;
    }
    
    // Sync project's vector index to disk
    if let Err(e) = sync_project_vectors(&app_handle, project_id).await {
        error!("Failed to sync project {} vector index: {}", project_id, e);
    }
    
    info!("Vectorized {} chunks for document {} in project {}", vectorized_count, document_id, project_id);
    Ok(vectorized_count)
}

#[tauri::command]
fn add_project_blank_activity(
    app_handle: AppHandle,
    project_id: i64,
) -> Result<i64, String> {
    app_handle
        .db(|db| add_blank_document(db, project_id))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn ensure_unassigned_activity(app_handle: AppHandle) -> Result<i64, String> {
  app_handle
    .db(|db| {
      // First ensure unassigned project exists
      let unassigned_project_id = ensure_unassigned_project(db)?;
      // Then add blank document to it
      add_blank_document(db, unassigned_project_id)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_project_activity_name(
    app_handle: AppHandle,
    activity_id: i64,
    name: &str,
) -> Result<(), String> {
    app_handle
        .db(|db| update_activity_name(db, activity_id, name))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project_activity(
    app_handle: AppHandle,
    activity_id: i64,
) -> Result<(), String> {
    app_handle
        .db(|db| delete_project_document(db, activity_id))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn prompt_for_accessibility_permissions() {
    // No-op - accessibility permissions no longer needed
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn prompt_for_accessibility_permissions() {
    // No-op for non-macOS platforms
}

mod recording_commands;
use recording_commands::*;

// Audio recording commands — dual mode (file-based for OpenAI, buffer for local Whisper)
#[tauri::command]
async fn start_audio_recording(app_handle: AppHandle, use_local: bool, note_id: Option<i64>, source: Option<String>) -> Result<String, String> {
    let mut task = LOCAL_TRANSCRIPTION_TASK.lock().await;
    if task.is_some() { return Err("Finish the previous recording first.".into()); }
    if use_local && WHISPER_ENGINE.lock().unwrap().is_none() {
        return Err("The local model is not ready. Start recording again to initialize it.".into());
    }
    let root = recording_root(&app_handle)?;
    let model = if use_local { get_whisper_model_id(&app_handle) } else { "whisper-1".into() };
    let keep_audio = app_handle.db(|db| get_setting(db, "keep_recordings").map(|s| s.setting_value == "true").unwrap_or(false));
    let id = crate::engine::audio_engine::start_recording(root, note_id, source.unwrap_or_else(|| if cfg!(target_os = "macos") { "both" } else { "microphone" }.into()), use_local, model, keep_audio).await?;
    if use_local {
        ACCUMULATED_TRANSCRIPT.lock().unwrap().clear();
        *task = Some(tokio::spawn(realtime_transcription_loop(app_handle)));
    }
    Ok(id)
}

#[tauri::command]
async fn stop_audio_recording(app_handle: AppHandle, use_local: bool) -> Result<String, String> {
    if use_local {
        // Hold the session lock until all inference finishes. A new recording
        // cannot receive text from jobs belonging to an earlier session.
        let mut task = LOCAL_TRANSCRIPTION_TASK.lock().await;
        if task.is_none() { return Err("No local recording to finish.".into()); }
        let capture_result = crate::engine::audio_engine::stop_recording().await;
        let final_result = if let Some(handle) = task.take() {
            handle.await.map_err(|e| format!("Transcription worker failed: {}", e))?
        } else {
            Err("No local recording to finish.".into())
        };
        capture_result?;
        let final_text = final_result?;
        let id = crate::engine::audio_engine::capture_status().recording_id;
        platypus_notes::recording_audio::finish_transcription(&recording_root(&app_handle)?, &id, &final_text)?;
        if let Some(w) = app_handle.get_window("main") {
            let _ = w.emit("transcript-update", serde_json::json!({ "text": final_text, "committed_text": final_text, "draft_text": "", "is_final": true }));
        }
        Ok(final_text)
    } else {
        crate::engine::audio_engine::stop_recording().await
    }
}

#[tauri::command]
fn read_audio_file(file_path: String) -> Result<Vec<u8>, String> {
    crate::engine::audio_engine::read_audio_file(&file_path)
}

#[tauri::command]
async fn transcribe_audio(
    app_handle: AppHandle,
    file_path: String,
) -> Result<String, String> {
    use crate::configuration::state::ServiceAccess;
    use crate::repository::settings_repository::get_setting;

    log::info!("Transcribing audio file: {}", file_path);

    // Get OpenAI API key from settings
    let setting = app_handle.db(|db| {
        get_setting(db, "api_key_open_ai").expect("Failed to get api_key_open_ai")
    });

    let openai_api_key = setting.setting_value;
    if openai_api_key.is_empty() {
        return Err("OpenAI API key is required for audio transcription".to_string());
    }

    // Transcribe using OpenAI Whisper
    let transcription = crate::engine::transcription_engine::transcribe_with_openai(
        &file_path,
        &openai_api_key,
    )
    .await
    .map_err(|e| format!("Transcription failed: {}", e))?;

    // Keep transcript recovery metadata even when temporary audio is removed.
    if let Some(id) = std::path::Path::new(&file_path).parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()) {
        let root = recording_root(&app_handle)?;
        if platypus_notes::recording_audio::load(&root, id).is_ok() {
            platypus_notes::recording_audio::finish_transcription(&root, id, &transcription)?;
        }
    }

    Ok(transcription)
}

// Whisper model management commands
fn get_whisper_model_id(app_handle: &AppHandle) -> String {
    app_handle.db(|db| {
        get_setting(db, "whisper_model")
            .map(|s| s.setting_value)
            .unwrap_or_default()
    })
}

#[tauri::command]
fn check_whisper_model(app_handle: AppHandle) -> bool {
    let model_id = get_whisper_model_id(&app_handle);
    crate::engine::whisper_engine::is_model_downloaded(&model_id)
}

#[tauri::command]
async fn download_whisper_model(app_handle: AppHandle) -> Result<(), String> {
    let model_id = get_whisper_model_id(&app_handle);
    crate::engine::whisper_engine::download_model(&app_handle, &model_id)
        .await
        .map_err(|e| format!("{}", e))
}

#[tauri::command]
async fn init_whisper_model(app_handle: AppHandle) -> Result<(), String> {
    let session = LOCAL_TRANSCRIPTION_TASK.try_lock().map_err(|_| "Finish the current transcription first.".to_string())?;
    if session.is_some() || crate::engine::audio_engine::IS_RECORDING.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Finish the current recording before changing the transcription model.".into());
    }
    let model_id = get_whisper_model_id(&app_handle);
    let engine = tokio::task::spawn_blocking(move || {
        crate::engine::whisper_engine::WhisperEngine::load(&model_id)
    })
    .await
    .map_err(|e| format!("Join error: {}", e))?
    .map_err(|e| format!("{}", e))?;

    let mut guard = WHISPER_ENGINE.lock().unwrap();
    *guard = Some(engine);
    info!("Whisper engine initialized");
    Ok(())
}

#[tauri::command]
fn get_transcript() -> String {
    let t = ACCUMULATED_TRANSCRIPT.lock().unwrap();
    t.clone()
}

/// Decode one complete utterance, without text post-processing or phrase removal.
fn process_and_transcribe_chunk(raw_samples: &[f32], device_rate: u32, draft: bool, prompt: &str) -> Result<String, String> {
    let samples_16k = crate::engine::audio_processor::resample(raw_samples, device_rate, 16000)
        .map_err(|e| format!("Audio resampling failed: {}", e))?;
    let guard = WHISPER_ENGINE.lock().unwrap();
    let engine = guard.as_ref().ok_or_else(|| "Whisper engine not initialized".to_string())?;
    let result = if draft {
        engine.transcribe_preview_with_context(&samples_16k, || !crate::engine::audio_engine::IS_RECORDING.load(std::sync::atomic::Ordering::SeqCst), prompt)
    } else {
        engine.transcribe_with_context(&samples_16k, prompt)
    };
    result.map_err(|e| format!("Whisper transcription failed: {}", e))
}

/// A single worker owns chunk boundaries, decode order, and the final flush.
async fn realtime_transcription_loop(app_handle: AppHandle) -> Result<String, String> {
    use crate::engine::audio_engine::{LOCAL_CAPTURE_RUNNING, IS_RECORDING, DEVICE_SAMPLE_RATE, take_new_samples};
    use std::sync::atomic::Ordering;
    use platypus_notes::transcription_audio::{SpeechChunker, LiveTranscript};

    let device_rate = DEVICE_SAMPLE_RATE.load(Ordering::SeqCst);
    let mut chunker = SpeechChunker::new(device_rate);
    let mut transcript = LiveTranscript::default();
    let mut last_preview = std::time::Instant::now();
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        // Capture sets this flag only after its final callback and stream drop.
        let finished = !LOCAL_CAPTURE_RUNNING.load(Ordering::SeqCst);
        let mut chunks = chunker.push(&take_new_samples());
        if finished { chunks.extend(chunker.finish()); }
        for chunk in chunks {
            let prompt = platypus_notes::transcription_context::transcription_prompt("", transcript.committed());
            let result = tokio::task::spawn_blocking(move || process_and_transcribe_chunk(&chunk, device_rate, false, &prompt)).await;
            let text = match result {
                Ok(Ok(text)) => text,
                error => {
                    IS_RECORDING.store(false, Ordering::SeqCst);
                    return Err(format!("Transcription stopped: {:?}", error));
                }
            };
            transcript.commit(&text);
            *ACCUMULATED_TRANSCRIPT.lock().unwrap() = transcript.committed().to_string();
            if let Some(w) = app_handle.get_window("main") {
                let _ = w.emit("transcript-update", transcript.update(false));
            }
        }
        if finished { break; }
        // Final chunks always take priority. Only one preview can be in flight;
        // later previews replace the entire unfinished utterance, never append.
        if IS_RECORDING.load(Ordering::SeqCst) && last_preview.elapsed() >= std::time::Duration::from_secs(2) {
            if let Some(audio) = chunker.take_preview() {
                let prompt = platypus_notes::transcription_context::transcription_prompt("", transcript.committed());
                let result = tokio::task::spawn_blocking(move || process_and_transcribe_chunk(&audio, device_rate, true, &prompt)).await;
                last_preview = std::time::Instant::now();
                if IS_RECORDING.load(Ordering::SeqCst) {
                    match result {
                        Ok(Ok(text)) => {
                            transcript.revise(text);
                            if let Some(w) = app_handle.get_window("main") {
                                let _ = w.emit("transcript-update", transcript.update(false));
                            }
                        }
                        error => log::warn!("Live draft unavailable; final transcription will continue: {:?}", error),
                    }
                }
            }
        }
    }
    Ok(transcript.committed().to_string())
}

// Document import commands
#[tauri::command]
async fn extract_document_text(file_path: String) -> Result<String, String> {
    use std::path::Path;
    
    log::info!("Extracting text from document: {}", file_path);
    
    // Check if file exists
    if !Path::new(&file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    // Determine file type based on extension
    let path = Path::new(&file_path);
    let extension = path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default();
    
    log::info!("File extension detected: {}", extension);
    
    match extension.as_str() {
        "pdf" => {
            log::info!("Attempting to extract text from PDF...");
            extract_text_from_pdf(&file_path)
        },
        "txt" | "md" | "rtf" => {
            log::info!("Reading text file...");
            read_text_file(&file_path)
        },
        "docx" => {
            log::info!("Attempting to extract text from DOCX...");
            extract_text_from_docx(&file_path)
        },
        _ => Err(format!("Unsupported file format: {}. Supported formats: PDF, TXT, MD, RTF, DOCX", extension))
    }
}

fn extract_text_from_pdf(file_path: &str) -> Result<String, String> {
    match pdf_extract::extract_text(file_path) {
        Ok(text) => {
            log::info!("Successfully extracted {} characters from PDF", text.len());
            if text.trim().is_empty() {
                Err("PDF appears to be empty or contains only images/non-text content".to_string())
            } else {
                Ok(text)
            }
        },
        Err(err) => {
            log::error!("PDF extraction error: {:?}", err);
            Err(format!("Failed to extract text from PDF: {}. Make sure the PDF contains text (not just images).", err))
        }
    }
}

fn extract_text_from_docx(file_path: &str) -> Result<String, String> {
    // Read the file bytes
    let bytes = std::fs::read(file_path).map_err(|e| format!("Failed to read DOCX file: {}", e))?;
    
    log::info!("DOCX file size: {} bytes", bytes.len());
    
    // DOCX files are ZIP archives containing XML
    // We'll extract text from the document.xml inside
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to open DOCX archive: {}", e))?;
    
    // Find and read word/document.xml
    let mut doc_xml = archive.by_name("word/document.xml")
        .map_err(|_| "DOCX file does not contain document.xml")?;
    
    let mut xml_content = String::new();
    std::io::Read::read_to_string(&mut doc_xml, &mut xml_content)
        .map_err(|e| format!("Failed to read document.xml: {}", e))?;
    
    // Extract text between <w:t> tags (Word text elements)
    let mut extracted_text = String::new();
    let mut in_text_element = false;
    let mut current_text = String::new();
    let mut tag_buffer = String::new();
    let mut in_tag = false;
    
    for c in xml_content.chars() {
        if c == '<' {
            in_tag = true;
            tag_buffer.clear();
            if !current_text.is_empty() && in_text_element {
                extracted_text.push_str(&current_text);
                current_text.clear();
            }
        } else if c == '>' {
            in_tag = false;
            // Check if it's a text element opening or closing
            if tag_buffer.starts_with("w:t") && !tag_buffer.starts_with("w:t ") || tag_buffer.starts_with("w:t ") {
                in_text_element = true;
            } else if tag_buffer == "/w:t" {
                in_text_element = false;
            } else if tag_buffer == "/w:p" {
                // End of paragraph - add newline
                extracted_text.push('\n');
            }
        } else if in_tag {
            tag_buffer.push(c);
        } else if in_text_element {
            current_text.push(c);
        }
    }
    
    let trimmed = extracted_text.trim().to_string();
    if trimmed.is_empty() {
        Err("DOCX file appears to be empty or could not be parsed".to_string())
    } else {
        log::info!("Successfully extracted {} characters from DOCX", trimmed.len());
        Ok(trimmed)
    }
}

fn read_text_file(file_path: &str) -> Result<String, String> {
    match std::fs::read_to_string(file_path) {
        Ok(content) => {
            log::info!("Successfully read {} characters from text file", content.len());
            Ok(content)
        },
        Err(e) => {
            log::error!("Error reading text file: {:?}", e);
            Err(format!("Failed to read text file: {}", e))
        }
    }
}
