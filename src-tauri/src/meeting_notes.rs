//! Save a generated meeting into its existing note only while its source matches.
use rusqlite::{params, Connection};

pub fn save_if_unchanged(conn: &Connection, id: i64, expected_text: &str, expected_title: &str, text: &str, title: &str) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "UPDATE projects_activities SET full_document_text = ?1, plain_text = ?2, document_name = ?3
         WHERE id = ?4 AND full_document_text = ?5 AND document_name = ?6",
        params![text, crate::html_to_plain_text(text), title, id, expected_text, expected_title],
    )?;
    Ok(changed == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn summary_replaces_the_same_note_without_losing_transcript_or_project() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE projects_activities (id INTEGER PRIMARY KEY, project_id INTEGER, document_name TEXT, full_document_text TEXT, plain_text TEXT);
            INSERT INTO projects_activities VALUES (42, 7, 'Meeting — Oct 2', '<p>raw</p>', 'raw');").unwrap();
        let html = "<p>Launch Friday if QA passes.</p><section data-transcript=\"true\" data-collapsed=\"true\"><p>Original words.</p></section>";
        assert!(save_if_unchanged(&db, 42, "<p>raw</p>", "Meeting — Oct 2", html, "Launch timing").unwrap());
        let row: (i64, i64, String, String, String) = db.query_row("SELECT id, project_id, document_name, full_document_text, plain_text FROM projects_activities", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap();
        assert_eq!((row.0, row.1, row.2.as_str(), row.3.as_str()), (42, 7, "Launch timing", html));
        assert!(row.4.contains("Original words."));
        assert_eq!(db.query_row("SELECT count(*) FROM projects_activities", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert!(!save_if_unchanged(&db, 42, "<p>raw</p>", "Meeting — Oct 2", "stale", "stale").unwrap());
        assert!(!save_if_unchanged(&db, 42, html, "old title", "stale", "stale").unwrap());
        db.execute("DELETE FROM projects_activities", []).unwrap();
        assert!(!save_if_unchanged(&db, 42, html, "Launch timing", "stale", "stale").unwrap());
    }
}
