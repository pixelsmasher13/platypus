//! Audio boundaries for live dictation. Text is never deduplicated: repeated
//! words may be intentional. Each captured sample belongs to at most one chunk.
use std::collections::VecDeque;

pub struct SpeechChunker {
    frame_size: usize,
    pre_roll_size: usize,
    silence_frames: usize,
    max_samples: usize,
    remainder: Vec<f32>,
    pre_roll: VecDeque<f32>,
    utterance: Vec<f32>,
    quiet_frames: usize,
    active_frames: usize,
    last_active_end: usize,
    preview_interval: usize,
    last_preview_end: usize,
}

impl SpeechChunker {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            frame_size: (sample_rate as usize / 50).max(1), // 20 ms
            pre_roll_size: sample_rate as usize / 5,        // 200 ms to protect consonants
            silence_frames: 35, // end an utterance after 700 ms of quiet
            max_samples: sample_rate as usize * 20,
            remainder: Vec::new(),
            pre_roll: VecDeque::new(),
            utterance: Vec::new(),
            quiet_frames: 0,
            active_frames: 0,
            last_active_end: 0,
            preview_interval: sample_rate as usize * 2,
            last_preview_end: 0,
        }
    }

    pub fn push(&mut self, samples: &[f32]) -> Vec<Vec<f32>> {
        self.remainder
            .extend(samples.iter().map(|s| if s.is_finite() { *s } else { 0.0 }));
        let complete = self.remainder.len() / self.frame_size * self.frame_size;
        let frames: Vec<_> = self.remainder.drain(..complete).collect();
        let mut chunks = Vec::new();
        for frame in frames.chunks(self.frame_size) {
            if let Some(chunk) = self.frame(frame) {
                chunks.push(chunk);
            }
        }
        chunks
    }

    fn frame(&mut self, frame: &[f32]) -> Option<Vec<f32>> {
        // Conservative near-silence gate, NOT a speech classifier. Remove DC
        // from the measurement so an idle microphone offset isn't called speech.
        let mean = frame.iter().sum::<f32>() / frame.len() as f32;
        let rms =
            (frame.iter().map(|s| (s - mean).powi(2)).sum::<f32>() / frame.len() as f32).sqrt();
        let active = rms >= 0.00015;
        if self.utterance.is_empty() && !active {
            self.pre_roll.extend(frame);
            while self.pre_roll.len() > self.pre_roll_size {
                self.pre_roll.pop_front();
            }
            return None;
        }
        if self.utterance.is_empty() {
            self.utterance.extend(self.pre_roll.drain(..));
        }
        self.utterance.extend_from_slice(frame);
        if active {
            self.active_frames += 1;
            self.quiet_frames = 0;
            self.last_active_end = self.utterance.len();
        } else {
            self.quiet_frames += 1;
        }
        if self.quiet_frames >= self.silence_frames || self.utterance.len() >= self.max_samples {
            return self.take_utterance();
        }
        None
    }

    fn take_utterance(&mut self) -> Option<Vec<f32>> {
        let mut chunk = std::mem::take(&mut self.utterance);
        chunk.truncate((self.last_active_end + self.pre_roll_size).min(chunk.len()));
        let has_signal = self.active_frames >= 3; // reject isolated clicks, keep short words
        self.active_frames = 0;
        self.quiet_frames = 0;
        self.last_active_end = 0;
        self.last_preview_end = 0;
        if has_signal {
            Some(chunk)
        } else {
            None
        }
    }

    /// A revisable snapshot; never drains or changes the final audio boundaries.
    /// Require fresh speech so idle microphones don't repeatedly decode silence.
    pub fn take_preview(&mut self) -> Option<Vec<f32>> {
        if self.active_frames < 3
            || self.last_active_end.saturating_sub(self.last_preview_end) < self.preview_interval
        {
            return None;
        }
        self.last_preview_end = self.last_active_end;
        let end = (self.last_active_end + self.pre_roll_size).min(self.utterance.len());
        Some(self.utterance[..end].to_vec())
    }

    /// Flush the user's final words even when Stop arrives before a pause.
    pub fn finish(&mut self) -> Vec<Vec<f32>> {
        let mut chunks = Vec::new();
        let remainder = std::mem::take(&mut self.remainder);
        if !remainder.is_empty() {
            if let Some(chunk) = self.frame(&remainder) {
                chunks.push(chunk);
            }
        }
        if let Some(chunk) = self.take_utterance() {
            chunks.push(chunk);
        }
        self.pre_roll.clear();
        chunks
    }
}

/// Provisional text is kept out of the committed transcript by construction.
#[derive(Default)]
pub struct LiveTranscript {
    committed: String,
    draft: String,
}

#[derive(Clone, serde::Serialize)]
pub struct TranscriptUpdate {
    pub text: String,
    pub committed_text: String,
    pub draft_text: String,
    pub is_final: bool,
}

impl LiveTranscript {
    pub fn revise(&mut self, draft: String) {
        self.draft = draft.trim().to_string();
    }
    pub fn commit(&mut self, text: &str) {
        self.draft.clear();
        if !text.trim().is_empty() {
            if !self.committed.is_empty() {
                self.committed.push(' ');
            }
            self.committed.push_str(text.trim());
        }
    }
    pub fn committed(&self) -> &str {
        &self.committed
    }
    pub fn update(&self, is_final: bool) -> TranscriptUpdate {
        let draft = if is_final { "" } else { &self.draft };
        let text = [self.committed.as_str(), draft]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        TranscriptUpdate {
            text,
            committed_text: self.committed.clone(),
            draft_text: draft.to_string(),
            is_final,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn signal(seconds: f32, amplitude: f32) -> Vec<f32> {
        (0..(16000.0 * seconds) as usize)
            .map(|i| amplitude * (i as f32 * 0.13).sin())
            .collect()
    }
    #[test]
    fn preview_snapshots_never_change_final_audio_or_repeat_without_new_speech() {
        let speech = signal(5.0, 0.04);
        let mut chunker = SpeechChunker::new(16000);
        assert!(chunker.push(&speech[..32000]).is_empty());
        assert_eq!(chunker.take_preview().unwrap(), speech[..32000]);
        assert!(chunker.take_preview().is_none());
        assert!(chunker.push(&speech[32000..]).is_empty());
        assert_eq!(chunker.take_preview().unwrap(), speech);
        let mut final_chunks = chunker.push(&vec![0.0; 16000]);
        final_chunks.extend(chunker.finish());
        assert!(chunker.take_preview().is_none());
        let mut baseline = SpeechChunker::new(16000);
        let mut expected = baseline.push(&[speech, vec![0.0; 16000]].concat());
        expected.extend(baseline.finish());
        assert_eq!(final_chunks, expected);
    }
    #[test]
    fn drafts_replace_instead_of_append_and_never_enter_the_saved_text() {
        let mut transcript = LiveTranscript::default();
        transcript.commit("Earlier sentence.");
        transcript.revise("To bee, or not. Thank you.".into());
        transcript.revise("To be or not to be".into());
        assert_eq!(
            transcript.update(false).text,
            "Earlier sentence. To be or not to be"
        );
        assert_eq!(transcript.committed(), "Earlier sentence.");
        assert_eq!(transcript.update(true).text, "Earlier sentence.");
        assert!(transcript.update(true).draft_text.is_empty());
        transcript.commit("To be or not to be, that is the question.");
        assert!(transcript.update(false).draft_text.is_empty());
        assert_eq!(
            transcript.committed(),
            "Earlier sentence. To be or not to be, that is the question."
        );
        // A final no-speech result must also remove a mistaken preview.
        transcript.revise("Thank you.".into());
        transcript.commit("");
        assert!(transcript.update(false).draft_text.is_empty());
        assert!(!transcript.committed().contains("Thank you"));
    }
    #[test]
    fn silence_dc_and_single_clicks_produce_no_chunks() {
        let mut chunker = SpeechChunker::new(16000);
        assert!(chunker.push(&vec![0.0; 16000 * 60]).is_empty());
        assert!(chunker.push(&vec![0.02; 16000]).is_empty());
        let mut click = vec![0.0; 16000];
        click[500] = 0.5;
        assert!(chunker.push(&click).is_empty());
        assert!(chunker.finish().is_empty());
    }
    #[test]
    fn sentence_longer_than_three_seconds_is_kept_whole_and_silence_trimmed() {
        let speech = signal(5.0, 0.08);
        let mut audio = vec![0.0; 16000];
        audio.extend(&speech);
        audio.extend(vec![0.0; 16000 * 4]);
        let mut chunker = SpeechChunker::new(16000);
        let chunks = chunker.push(&audio);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].len(), speech.len() + 6400); // 200 ms each side
        assert_eq!(&chunks[0][3200..3200 + speech.len()], speech);
        assert!(chunker.finish().is_empty());
    }
    #[test]
    fn stop_flushes_short_quiet_speech_once_even_between_audio_frames() {
        let speech = signal(0.333, 0.001); // well below the former 0.005 threshold
        let mut chunker = SpeechChunker::new(16000);
        for part in speech.chunks(137) {
            assert!(chunker.push(part).is_empty());
        }
        assert_eq!(chunker.finish(), vec![speech]);
        assert!(chunker.finish().is_empty());
    }
    #[test]
    fn sustained_speech_is_bounded_and_never_overlaps() {
        let speech = signal(45.0, 0.05);
        let mut chunker = SpeechChunker::new(16000);
        let mut chunks = chunker.push(&speech);
        chunks.extend(chunker.finish());
        assert_eq!(chunks.len(), 3);
        assert!(chunks.iter().all(|c| c.len() <= 16000 * 20));
        assert_eq!(chunks.concat(), speech);
    }
    #[test]
    fn actual_repeated_utterances_are_not_removed() {
        let phrase = signal(1.0, 0.03);
        let mut audio = phrase.clone();
        audio.extend(vec![0.0; 16000]);
        audio.extend(&phrase);
        let mut chunker = SpeechChunker::new(16000);
        let mut chunks = chunker.push(&audio);
        chunks.extend(chunker.finish());
        assert_eq!(chunks.len(), 2);
        assert_eq!(&chunks[0][..phrase.len()], phrase);
        assert_eq!(&chunks[1][3200..], phrase);
    }
}
