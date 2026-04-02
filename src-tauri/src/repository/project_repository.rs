use crate::entity::project::Project;
use platypus_notes::html_to_plain_text;
use rusqlite::{named_params, params, Connection};

pub fn delete_project(conn: &Connection, project_id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
    delete_project_activities(conn, project_id)?;
    Ok(())
}

pub fn delete_project_activities(
    conn: &Connection,
    project_id: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM projects_activities WHERE project_id = ?1",
        params![project_id],
    )?;
    Ok(())
}

pub fn save_project(
    conn: &Connection,
    name: &str,
    activities: &Vec<i64>,
) -> Result<(), rusqlite::Error> {
    let mut statement = conn.prepare("INSERT INTO projects (name) VALUES (@name)")?;

    statement.execute(named_params! {
        "@name": name
    })?;
    let project_id = conn.last_insert_rowid();

    // Only add activities if the vector is not empty
    if !activities.is_empty() {
        add_project_activities(conn, project_id, activities)?;
    }
    
    Ok(())
}

pub fn update_project(
    conn: &Connection,
    project_id: i64,
    name: &str,
    activities: &Vec<i64>,
) -> Result<(), rusqlite::Error> {
    // Update the project name first
    conn.execute(
        "UPDATE projects SET name = ?1 WHERE id = ?2",
        params![name, project_id],
    )?;
    
    // Only handle activities if they're provided
    if !activities.is_empty() {
        delete_project_activities(conn, project_id)?;
        add_project_activities(conn, project_id, activities)?;
    }
    
    Ok(())
}

/// Move a document to a new project
/// Also updates chunks' project_id and marks them for re-vectorization
pub fn move_document_to_project(
    conn: &Connection,
    document_id: i64,
    target_project_id: i64,
) -> Result<(), rusqlite::Error> {
    // Update document's project
    conn.execute(
        "UPDATE projects_activities SET project_id = ?1 WHERE id = ?2",
        params![target_project_id, document_id],
    )?;
    
    // Update chunks' project_id and mark for re-vectorization
    // (vectors will be added to new project's index on next vectorize call)
    conn.execute(
        "UPDATE document_chunks SET project_id = ?1, is_vectorized = 0 WHERE document_id = ?2",
        params![target_project_id, document_id],
    )?;
    
    Ok(())
}

pub fn add_project_activities(
    conn: &Connection,
    project_id: i64,
    activity_ids: &Vec<i64>,
) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare(
        "INSERT INTO projects_activities (project_id, activity_id, document_name, full_document_text)
         SELECT ?1, id, COALESCE(window_title, 'Document ' || id), edited_full_text
         FROM activity_full_text
         WHERE id = ?2"
    )?;

    for &activity_id in activity_ids {
        stmt.execute(params![project_id, activity_id])?;
    }
    Ok(())
}

pub fn fetch_all_projects(conn: &Connection) -> Result<Vec<Project>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT id, name, created_at FROM projects")?;
    let project_iter = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            activities: Vec::new(),
            activity_ids: Vec::new(),
            activity_names: Vec::new(),
            created_at: row.get(2)?,
        })
    })?;

    let mut projects = Vec::new();
    for project in project_iter {
        let mut project = project?;
        let (ids, activity_ids, names) = fetch_activities_by_project_id(conn, project.id)?;
        project.activities = ids;
        project.activity_ids = activity_ids;
        project.activity_names = names;
        projects.push(project);
    }

    Ok(projects)
}

pub fn fetch_activities_by_project_id(
    conn: &Connection,
    project_id: i64,
) -> Result<(Vec<i64>, Vec<Option<i64>>, Vec<String>), rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT pa.id, pa.activity_id, pa.document_name
         FROM projects_activities pa
         WHERE pa.project_id = ?1
         ORDER BY pa.id"
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok((
            row.get::<_, i64>("id")?,
            row.get::<_, Option<i64>>("activity_id")?,
            row.get::<_, String>("document_name")?,
        ))
    })?;

    let mut ids = Vec::new();
    let mut activity_ids = Vec::new();
    let mut names = Vec::new();

    for row in rows {
        let (id, activity_id, name) = row?;
        ids.push(id);
        activity_ids.push(activity_id);
        names.push(name);
    }

    Ok((ids, activity_ids, names))
}

pub fn get_activity_text_from_project(
    conn: &Connection,
    project_id: i64,
    activity_id: i64,
) -> Result<String, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT full_document_text 
         FROM projects_activities 
         WHERE project_id = ?1 AND id = ?2"  // Use id but keep activity_id in the interface
    )?;
    
    stmt.query_row(params![project_id, activity_id], |row| row.get(0))
}

/// Get plain text version of document content (for LLM queries)
pub fn get_activity_plain_text(
    conn: &Connection,
    activity_id: i64,
) -> Result<(String, String), rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT document_name, COALESCE(NULLIF(plain_text, ''), full_document_text) as text_content
         FROM projects_activities 
         WHERE id = ?1"
    )?;
    
    stmt.query_row(params![activity_id], |row| {
        let document_name: String = row.get(0)?;
        let text_content: String = row.get(1)?;
        Ok((document_name, text_content))
    })
}

/// Get project_id for a document
pub fn get_project_id_for_document(
    conn: &Connection,
    document_id: i64,
) -> Result<i64, rusqlite::Error> {
    conn.query_row(
        "SELECT project_id FROM projects_activities WHERE id = ?1",
        params![document_id],
        |row| row.get(0),
    )
}

pub fn update_activity_text(
    conn: &Connection,
    activity_id: i64,
    text: &str,
) -> Result<(), rusqlite::Error> {
    // Generate plain text from HTML content
    let plain_text = html_to_plain_text(text);
    
    conn.execute(
        "UPDATE projects_activities SET full_document_text = ?1, plain_text = ?2 WHERE id = ?3",
        params![text, plain_text, activity_id],
    )?;
    Ok(())
}

pub fn update_activity_name(
    conn: &Connection,
    activity_id: i64,
    name: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE projects_activities SET document_name = ?1 WHERE id = ?2",
        params![name, activity_id],
    )?;
    Ok(())
}

pub fn add_blank_document(
    conn: &Connection,
    project_id: i64,
) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO projects_activities (project_id, document_name, full_document_text, plain_text)
         VALUES (?1, ?2, ?3, ?4)",
        params![project_id, "", "", ""],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_project_document(
    conn: &Connection,
    activity_id: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM projects_activities WHERE id = ?1",
        params![activity_id],
    )?;
    Ok(())
}

const DEFAULT_PROJECT_ID: i64 = 0;

/// Get all documents across all projects for the "Add content to Platypus" modal
/// Returns: Vec of (document_id, document_name, project_name, created_at)
pub fn get_all_documents(
    conn: &Connection,
) -> Result<Vec<(i64, String, String, String)>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT pa.id, pa.document_name, p.name as project_name,
                COALESCE(pa.created_at, p.created_at, '') as created_at
         FROM projects_activities pa
         JOIN projects p ON pa.project_id = p.id
         ORDER BY pa.id DESC"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    rows.collect()
}

pub fn ensure_unassigned_project(conn: &Connection) -> Result<i64, rusqlite::Error> {
    // Check if unassigned project exists
    let mut stmt = conn.prepare("SELECT id FROM projects WHERE name = ?1")?;
    let mut rows = stmt.query_map(params!["Unassigned"], |row| row.get(0))?;
    
    if let Some(Ok(id)) = rows.next() {
      // Project exists, return its ID
      return Ok(id);
    }
    
    // Project doesn't exist, create it
    conn.execute(
      "INSERT INTO projects (name) VALUES (?1)",
      params!["Unassigned"],
    )?;
    
    Ok(conn.last_insert_rowid())
  }