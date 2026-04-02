use rusqlite::{params, Connection};
use log::info;

const CHUNK_SIZE: usize = 4000;  // ~700 words per chunk
const CHUNK_OVERLAP: usize = 400;

#[derive(Debug, Clone)]
pub struct DocumentChunk {
    pub id: i64,
    pub document_id: i64,
    pub project_id: i64,
    pub chunk_index: i32,
    pub chunk_text: String,
    pub is_vectorized: bool,
}

/// Snap a byte offset to the nearest char boundary (forward)
fn snap_to_char_boundary(text: &str, pos: usize) -> usize {
    let mut p = pos;
    while p < text.len() && !text.is_char_boundary(p) {
        p += 1;
    }
    p
}

/// Split text into overlapping chunks
pub fn split_into_chunks(text: &str) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return vec![];
    }

    // If text is smaller than chunk size, return as single chunk
    if text.len() <= CHUNK_SIZE {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;

    while start < text.len() {
        let end = snap_to_char_boundary(text, std::cmp::min(start + CHUNK_SIZE, text.len()));

        // Try to find a good break point (sentence end or paragraph)
        let chunk_end = if end < text.len() {
            find_break_point(text, start, end)
        } else {
            end
        };

        let chunk = text[start..chunk_end].trim().to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }

        // Move start forward, accounting for overlap
        if chunk_end >= text.len() {
            break;
        }
        let overlap_pos = if chunk_end > CHUNK_OVERLAP {
            chunk_end - CHUNK_OVERLAP
        } else {
            chunk_end
        };
        start = snap_to_char_boundary(text, overlap_pos);
    }

    chunks
}

/// Find a good break point near the target end position
fn find_break_point(text: &str, start: usize, target_end: usize) -> usize {
    // Look for sentence endings near the target
    let search_range = std::cmp::min(200, target_end - start);
    let search_start = snap_to_char_boundary(text, target_end.saturating_sub(search_range));

    // Priority: paragraph break > sentence end > word break
    let slice = &text[search_start..target_end];
    
    // Look for paragraph break
    if let Some(pos) = slice.rfind("\n\n") {
        return search_start + pos + 2;
    }
    
    // Look for sentence end
    for pattern in &[". ", "! ", "? ", ".\n", "!\n", "?\n"] {
        if let Some(pos) = slice.rfind(pattern) {
            return search_start + pos + pattern.len();
        }
    }
    
    // Look for word break (space)
    if let Some(pos) = slice.rfind(' ') {
        return search_start + pos + 1;
    }
    
    // Fallback to target end
    target_end
}

/// Delete existing chunks for a document
pub fn delete_chunks_for_document(conn: &Connection, document_id: i64) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM document_chunks WHERE document_id = ?1",
        params![document_id],
    )?;
    Ok(())
}

/// Save chunks for a document
pub fn save_chunks_for_document(
    conn: &Connection,
    document_id: i64,
    project_id: i64,
    plain_text: &str,
) -> Result<Vec<i64>, rusqlite::Error> {
    // First delete any existing chunks
    delete_chunks_for_document(conn, document_id)?;
    
    // Split into chunks
    let chunks = split_into_chunks(plain_text);
    
    if chunks.is_empty() {
        info!("No chunks to save for document {}", document_id);
        return Ok(vec![]);
    }
    
    info!("Saving {} chunks for document {} in project {}", chunks.len(), document_id, project_id);
    
    let mut chunk_ids = Vec::new();
    
    for (index, chunk_text) in chunks.iter().enumerate() {
        conn.execute(
            "INSERT INTO document_chunks (document_id, project_id, chunk_index, chunk_text, is_vectorized)
             VALUES (?1, ?2, ?3, ?4, 0)",
            params![document_id, project_id, index as i32, chunk_text],
        )?;
        chunk_ids.push(conn.last_insert_rowid());
    }
    
    Ok(chunk_ids)
}

/// Get chunks that need vectorization for a project
pub fn get_unvectorized_chunks(conn: &Connection, project_id: i64, limit: i64) -> Result<Vec<DocumentChunk>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, project_id, chunk_index, chunk_text, is_vectorized
         FROM document_chunks 
         WHERE project_id = ?1 AND is_vectorized = 0
         LIMIT ?2"
    )?;
    
    let chunks = stmt.query_map(params![project_id, limit], |row| {
        Ok(DocumentChunk {
            id: row.get(0)?,
            document_id: row.get(1)?,
            project_id: row.get(2)?,
            chunk_index: row.get(3)?,
            chunk_text: row.get(4)?,
            is_vectorized: row.get::<_, i32>(5)? == 1,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    
    Ok(chunks)
}

/// Mark a chunk as vectorized
pub fn mark_chunk_as_vectorized(conn: &Connection, chunk_id: i64) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE document_chunks SET is_vectorized = 1 WHERE id = ?1",
        params![chunk_id],
    )?;
    Ok(())
}

/// Get all chunk IDs for a project (for vector search filtering)
pub fn get_chunk_ids_for_project(conn: &Connection, project_id: i64) -> Result<Vec<i64>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id FROM document_chunks WHERE project_id = ?1 AND is_vectorized = 1"
    )?;
    
    let ids = stmt.query_map(params![project_id], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    
    Ok(ids)
}

/// Get chunk text by IDs
pub fn get_chunks_by_ids(conn: &Connection, chunk_ids: &[i64]) -> Result<Vec<DocumentChunk>, rusqlite::Error> {
    if chunk_ids.is_empty() {
        return Ok(vec![]);
    }
    
    let placeholders: Vec<String> = chunk_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        "SELECT id, document_id, project_id, chunk_index, chunk_text, is_vectorized
         FROM document_chunks 
         WHERE id IN ({})
         ORDER BY document_id, chunk_index",
        placeholders.join(",")
    );
    
    let mut stmt = conn.prepare(&query)?;
    
    let chunks = stmt.query_map(
        rusqlite::params_from_iter(chunk_ids.iter()),
        |row| {
            Ok(DocumentChunk {
                id: row.get(0)?,
                document_id: row.get(1)?,
                project_id: row.get(2)?,
                chunk_index: row.get(3)?,
                chunk_text: row.get(4)?,
                is_vectorized: row.get::<_, i32>(5)? == 1,
            })
        }
    )?.collect::<Result<Vec<_>, _>>()?;
    
    Ok(chunks)
}

/// Get total chunk count for a project
pub fn get_chunk_count_for_project(conn: &Connection, project_id: i64) -> Result<i64, rusqlite::Error> {
    conn.query_row(
        "SELECT COUNT(*) FROM document_chunks WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )
}

/// Source information for a document chunk
#[derive(Debug, Clone, serde::Serialize)]
pub struct ChunkSource {
    pub chunk_id: i64,
    pub document_id: i64,
    pub document_name: String,
    pub chunk_index: i32,
    pub chunk_preview: String,
}

/// Get source information for chunk IDs (for citations)
pub fn get_chunk_sources(conn: &Connection, chunk_ids: &[i64]) -> Result<Vec<ChunkSource>, rusqlite::Error> {
    if chunk_ids.is_empty() {
        return Ok(vec![]);
    }
    
    let placeholders: Vec<String> = chunk_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        "SELECT dc.id, dc.document_id, pa.document_name, dc.chunk_index, 
                SUBSTR(dc.chunk_text, 1, 150) as chunk_preview
         FROM document_chunks dc
         JOIN projects_activities pa ON dc.document_id = pa.id
         WHERE dc.id IN ({})
         ORDER BY dc.document_id, dc.chunk_index",
        placeholders.join(",")
    );
    
    let mut stmt = conn.prepare(&query)?;
    
    let sources = stmt.query_map(
        rusqlite::params_from_iter(chunk_ids.iter()),
        |row| {
            Ok(ChunkSource {
                chunk_id: row.get(0)?,
                document_id: row.get(1)?,
                document_name: row.get(2)?,
                chunk_index: row.get(3)?,
                chunk_preview: row.get::<_, String>(4)?.trim().to_string() + "...",
            })
        }
    )?.collect::<Result<Vec<_>, _>>()?;
    
    Ok(sources)
}

/// Get full text for a single chunk by ID
pub fn get_chunk_full_text(conn: &Connection, chunk_id: i64) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT chunk_text FROM document_chunks WHERE id = ?")?;
    let result = stmt.query_row([chunk_id], |row| row.get(0));
    match result {
        Ok(text) => Ok(Some(text)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_split_small_text() {
        let text = "This is a small text.";
        let chunks = split_into_chunks(text);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], text);
    }
    
    #[test]
    fn test_split_empty_text() {
        let text = "";
        let chunks = split_into_chunks(text);
        assert_eq!(chunks.len(), 0);
    }
    
    #[test]
    fn test_split_large_text() {
        let text = "A".repeat(5000);
        let chunks = split_into_chunks(&text);
        assert!(chunks.len() > 1);
        // Each chunk should be roughly CHUNK_SIZE
        for chunk in &chunks {
            assert!(chunk.len() <= CHUNK_SIZE + 100); // Allow some flexibility for break points
        }
    }
}
