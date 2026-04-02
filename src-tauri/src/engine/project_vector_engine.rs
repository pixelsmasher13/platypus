//! Per-project vector index management
//! 
//! Each project gets its own HNSW index stored at:
//! `{app_data}/vectors/project_{id}/chunks.hnsw.*`
//! 
//! This ensures search results are always scoped to the project.

use std::collections::HashMap;
use std::fs::create_dir_all;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use log::info;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::engine::similarity_search_engine::SimilaritySearch;

/// Cache of open project vector indices
/// Key: project_id, Value: SimilaritySearch instance
type ProjectVectorCache = Arc<Mutex<HashMap<i64, Arc<Mutex<SimilaritySearch>>>>>;

lazy_static::lazy_static! {
    static ref PROJECT_VECTORS: ProjectVectorCache = Arc::new(Mutex::new(HashMap::new()));
}

/// Get the directory path for a project's vector index
fn get_project_vector_path(app_handle: &AppHandle, project_id: i64) -> PathBuf {
    let app_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .expect("The app data directory should exist.");
    
    app_dir.join("vectors").join(format!("project_{}", project_id))
}

/// Get or create a vector index for a specific project
pub async fn get_project_vector_db(
    app_handle: &AppHandle,
    project_id: i64,
) -> Result<Arc<Mutex<SimilaritySearch>>> {
    let mut cache = PROJECT_VECTORS.lock().await;
    
    // Check if already cached
    if let Some(db) = cache.get(&project_id) {
        info!("Using cached vector index for project {}", project_id);
        return Ok(db.clone());
    }
    
    // Create new index
    info!("Initializing vector index for project {}", project_id);
    let vector_path = get_project_vector_path(app_handle, project_id);
    
    // Ensure directory exists
    create_dir_all(&vector_path)?;
    
    let collection_name = "chunks";
    let db = SimilaritySearch::open(vector_path.to_str().unwrap(), collection_name)?;
    let db_arc = Arc::new(Mutex::new(db));
    
    cache.insert(project_id, db_arc.clone());
    
    Ok(db_arc)
}

/// Add a chunk to a project's vector index
pub async fn add_chunk_to_project_vectors(
    app_handle: &AppHandle,
    project_id: i64,
    chunk_id: i64,
    chunk_text: &str,
    api_key: &str,
) -> Result<()> {
    let db_arc = get_project_vector_db(app_handle, project_id).await?;
    let db = db_arc.lock().await;
    
    db.add(chunk_id, chunk_text, api_key).await?;
    
    info!("Added chunk {} to project {} vector index", chunk_id, project_id);
    Ok(())
}

/// Search for similar chunks within a project's vector index
pub async fn search_project_vectors(
    app_handle: &AppHandle,
    project_id: i64,
    query: &str,
    top_k: usize,
    api_key: &str,
) -> Result<Vec<(i64, f32)>> {
    let db_arc = get_project_vector_db(app_handle, project_id).await?;
    let db = db_arc.lock().await;
    
    let results = db.top_k(query, top_k, api_key).await?;
    
    // Convert usize IDs to i64
    let results: Vec<(i64, f32)> = results
        .into_iter()
        .map(|(id, distance)| (id as i64, distance))
        .collect();
    
    info!("Found {} similar chunks in project {}", results.len(), project_id);
    Ok(results)
}

/// Sync a project's vector index to disk
pub async fn sync_project_vectors(
    app_handle: &AppHandle,
    project_id: i64,
) -> Result<()> {
    let db_arc = get_project_vector_db(app_handle, project_id).await?;
    let db = db_arc.lock().await;
    
    db.sync().await?;
    
    info!("Synced project {} vector index to disk", project_id);
    Ok(())
}

/// Close a project's vector index (removes from cache)
pub async fn close_project_vectors(project_id: i64) -> Result<()> {
    let mut cache = PROJECT_VECTORS.lock().await;
    
    // Simply remove from cache - the index will be synced when dropped
    if cache.remove(&project_id).is_some() {
        info!("Removed project {} vector index from cache", project_id);
    }
    
    Ok(())
}

/// Delete a project's vector index entirely
pub async fn delete_project_vectors(
    app_handle: &AppHandle,
    project_id: i64,
) -> Result<()> {
    // First close if open
    close_project_vectors(project_id).await?;
    
    // Delete the directory
    let vector_path = get_project_vector_path(app_handle, project_id);
    if vector_path.exists() {
        std::fs::remove_dir_all(&vector_path)?;
        info!("Deleted vector index directory for project {}", project_id);
    }
    
    Ok(())
}
