use crate::{presentation::presentation_slide_count, slides::Slide};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct SavedPresentation {
    pub id: String,
    pub title: String,
    pub source_id: Option<i64>,
    pub source_title: String,
    pub created_at: String,
    pub kind: String,
    pub model: String,
    pub effort: Option<String>,
    pub elapsed_seconds: u64,
    pub slide_count: usize,
    pub file_path: Option<String>,
    pub slides: Option<Vec<Slide>>,
}

fn deck_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("Invalid presentation ID.".into());
    }
    Ok(root.join(id))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing presentation folder")?)
            .map_err(|e| format!("Could not save presentation: {}", e))?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_new(
    root: &Path,
    mut deck: SavedPresentation,
    bytes: Option<&[u8]>,
) -> Result<SavedPresentation, String> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let dir = loop {
        deck.id = format!(
            "{}-{}",
            chrono::Utc::now().timestamp_micros(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let dir = deck_dir(root, &deck.id)?;
        match fs::create_dir(&dir) {
            Ok(()) => break dir,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    };
    deck.created_at = chrono::Utc::now().to_rfc3339();
    deck.file_path = None;
    if let Some(bytes) = bytes {
        deck.slide_count = presentation_slide_count(bytes)?;
        let path = dir.join("presentation.pptx");
        atomic_write(&path, bytes)?;
        deck.file_path = Some(path.to_string_lossy().into_owned());
    }
    // Publish metadata last: the library only shows fully saved records.
    atomic_write(
        &dir.join("record.json"),
        &serde_json::to_vec_pretty(&deck).map_err(|e| e.to_string())?,
    )?;
    Ok(deck)
}

pub fn load(root: &Path, id: &str) -> Result<SavedPresentation, String> {
    let path = deck_dir(root, id)?.join("record.json");
    serde_json::from_slice(
        &fs::read(path).map_err(|e| format!("Could not load presentation: {}", e))?,
    )
    .map_err(|e| e.to_string())
}

pub fn list(root: &Path) -> Result<Vec<SavedPresentation>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut decks = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        if let Ok(deck) = load(root, &entry.file_name().to_string_lossy()) {
            decks.push(deck);
        }
    }
    decks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(decks)
}

pub fn update_slides(
    root: &Path,
    id: &str,
    slides: Vec<Slide>,
) -> Result<SavedPresentation, String> {
    let mut deck = load(root, id)?;
    if deck.kind != "simple" {
        return Err("Edit this PowerPoint in your presentation app.".into());
    }
    if slides.is_empty() || slides.len() > 30 {
        return Err("A deck must have 1–30 slides.".into());
    }
    deck.slide_count = slides.len();
    deck.slides = Some(slides);
    // Any existing PowerPoint is now stale; export rebuilds it from the saved draft.
    deck.file_path = None;
    atomic_write(
        &deck_dir(root, id)?.join("record.json"),
        &serde_json::to_vec_pretty(&deck).map_err(|e| e.to_string())?,
    )?;
    Ok(deck)
}

pub fn read_powerpoint(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let deck = load(root, id)?;
    if deck.file_path.is_none() {
        return Err("Export this deck from the slide editor.".into());
    }
    fs::read(deck_dir(root, id)?.join("presentation.pptx")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn draft() -> SavedPresentation {
        SavedPresentation {
            id: String::new(),
            title: "Brief".into(),
            source_id: Some(42),
            source_title: "Original meeting".into(),
            created_at: String::new(),
            kind: "simple".into(),
            model: "gpt-6-astra".into(),
            effort: Some("medium".into()),
            elapsed_seconds: 12,
            slide_count: 1,
            file_path: None,
            slides: Some(vec![Slide {
                title: "Decision".into(),
                layout: Some("content".into()),
                bullets: vec!["Ship on Friday if QA passes".into()],
                speaker_notes: None,
            }]),
        }
    }
    #[test]
    fn saved_decks_survive_reload_with_source_identity_and_separate_versions() {
        let dir = tempfile::tempdir().unwrap();
        let first = save_new(dir.path(), draft(), None).unwrap();
        let second = save_new(dir.path(), draft(), None).unwrap();
        assert_ne!(first.id, second.id);
        let decks = list(dir.path()).unwrap();
        assert_eq!(decks.len(), 2);
        assert_eq!(decks[0].id, second.id);
        assert_eq!(decks[0].source_id, Some(42));
        let mut slides = first.slides.unwrap();
        slides[0].title = "Revised decision".into();
        update_slides(dir.path(), &first.id, slides).unwrap();
        assert_eq!(
            load(dir.path(), &first.id).unwrap().slides.unwrap()[0].title,
            "Revised decision"
        );
        assert_eq!(
            load(dir.path(), &second.id).unwrap().slides.unwrap()[0].title,
            "Decision"
        );
    }
    #[test]
    fn saves_exact_powerpoint_bytes_and_ignores_unfinished_records() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("123-1")).unwrap();
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for name in ["ppt/presentation.xml", "ppt/slides/slide1.xml"] {
            zip.start_file(name, zip::write::FileOptions::default())
                .unwrap();
            zip.write_all(b"<xml/>").unwrap();
        }
        let bytes = zip.finish().unwrap().into_inner();
        let mut deck = draft();
        deck.kind = "designed".into();
        deck.slides = None;
        let saved = save_new(dir.path(), deck, Some(&bytes)).unwrap();
        assert_eq!(read_powerpoint(dir.path(), &saved.id).unwrap(), bytes);
        assert_eq!(list(dir.path()).unwrap().len(), 1);
        assert!(load(dir.path(), "../other").is_err());
        assert!(save_new(dir.path(), draft(), Some(b"not a pptx")).is_err());
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }
}
