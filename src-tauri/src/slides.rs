use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Slide {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    pub title: String,
    pub bullets: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker_notes: Option<String>,
}

/// Best-effort JSON array extraction: strips optional markdown fences and slices
/// to the first '[' and last ']' to forgive a stray preamble or trailing comment.
pub fn extract_json_array(raw: &str) -> Result<&str, String> {
    let trimmed = raw.trim();
    let start = trimmed
        .find('[')
        .ok_or_else(|| "LLM response did not contain a JSON array".to_string())?;
    let end = trimmed
        .rfind(']')
        .ok_or_else(|| "LLM response did not contain a closing JSON array bracket".to_string())?;
    if end <= start {
        return Err("Malformed JSON in LLM response".to_string());
    }
    Ok(&trimmed[start..=end])
}

pub fn parse_slides(raw: &str) -> Result<Vec<Slide>, String> {
    let trimmed = raw.trim();
    let json_slice = extract_json_array(raw)?;

    let mut slides = serde_json::from_str::<Vec<Slide>>(json_slice).map_err(|e| {
        format!(
            "Failed to parse slide JSON: {}. Raw response began with: {}",
            e,
            &trimmed.chars().take(120).collect::<String>()
        )
    })?;
    if slides.is_empty() || slides.len() > 30 {
        return Err(
            "The model returned an empty or oversized deck. Try a smaller slide count.".to_string(),
        );
    }
    for (index, slide) in slides.iter_mut().enumerate() {
        slide.title = slide.title.trim().to_string();
        if slide.title.is_empty() {
            return Err(format!(
                "Slide {} is missing a title. Please generate again.",
                index + 1
            ));
        }
        slide.bullets = slide
            .bullets
            .iter()
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
            .collect();
    }
    Ok(slides)
}

#[cfg(test)]
mod slide_tests {
    use super::parse_slides;

    #[test]
    fn reads_layouts_and_speaker_notes_from_fenced_json() {
        let slides = parse_slides(r#"```json
[{"layout":"steps","title":" Release plan ","bullets":[" Test "," Ship "],"speaker_notes":"Keep the dates from the source."}]
```"#).unwrap();
        assert_eq!(slides[0].layout.as_deref(), Some("steps"));
        assert_eq!(slides[0].title, "Release plan");
        assert_eq!(slides[0].bullets, vec!["Test", "Ship"]);
        assert!(slides[0].speaker_notes.is_some());
    }

    #[test]
    fn accepts_legacy_slides_and_rejects_unusable_decks() {
        assert!(parse_slides(r#"[{"title":"Plan","bullets":["Ship"]}]"#).is_ok());
        assert!(parse_slides("[]").is_err());
        assert!(parse_slides(r#"[{"title":" ","bullets":[]}]"#).is_err());
        assert!(parse_slides(r#"[{"title":"Plan","bullets":"not an array"}]"#).is_err());
        assert!(parse_slides("incomplete [").is_err());
    }
}
