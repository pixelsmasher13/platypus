//! Short, explicit context for Whisper. Only finalized speech belongs in history;
//! drafts and transcripts from previous recordings must never be fed back.

fn bounded_text(text: &str, words: usize, chars: usize, tail: bool) -> String {
    let clean = text.replace('\0', " ");
    let mut tokens: Vec<_> = clean.split_whitespace().collect();
    if tail {
        tokens = tokens.into_iter().rev().take(words).collect();
        tokens.reverse();
    } else {
        tokens.truncate(words);
    }
    let text = tokens.join(" ");
    if tail {
        let mut end: Vec<_> = text.chars().rev().take(chars).collect();
        end.reverse();
        end.into_iter().collect()
    } else {
        text.chars().take(chars).collect()
    }
}

/// Experimental hints for offline comparisons only. The app supplies no hints:
/// on the evaluation recording, vocabulary prompts suppressed real speech.
pub fn note_context(text: &str) -> String {
    bounded_text(text, 24, 160, false)
}

pub fn transcription_prompt(hints: &str, committed: &str) -> String {
    let hints = note_context(hints);
    let recent = bounded_text(committed, 16, 120, true);
    [hints, recent]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcription_audio::LiveTranscript;

    #[test]
    fn context_keeps_recent_final_speech_and_excludes_drafts() {
        let mut transcript = LiveTranscript::default();
        transcript.commit(&format!("{} recent final words", "old ".repeat(100)));
        transcript.revise("incorrect provisional name".into());
        let prompt = transcription_prompt(
            "Costco. Gary Millerchip. SEC. GAAP.",
            transcript.committed(),
        );
        assert!(prompt.starts_with("Costco. Gary Millerchip. SEC. GAAP."));
        assert!(prompt.ends_with("recent final words"));
        assert!(!prompt.contains("provisional"));
        assert!(prompt.split_whitespace().count() <= 40);
        assert_eq!(
            transcription_prompt("", LiveTranscript::default().committed()),
            ""
        );
    }

    #[test]
    fn context_is_bounded_for_unicode_and_long_unbroken_text() {
        let prompt = transcription_prompt(&"界".repeat(1000), &"é".repeat(1000));
        assert_eq!(prompt.chars().count(), 281);
        assert_eq!(
            note_context("  Gary\0Millerchip\n SEC  "),
            "Gary Millerchip SEC"
        );
        assert_eq!(transcription_prompt(" \n", " \0 "), "");
    }
}
