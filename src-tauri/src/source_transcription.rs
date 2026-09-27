//! Source attribution, not voice identification: each turn belongs to either
//! the microphone or system-audio channel. The capture clock orders both sides.
use crate::transcription_audio::{SpeechChunker, TimedChunk};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioSource {
    Microphone,
    System,
}
impl AudioSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::Microphone => "You",
            Self::System => "Remote participants",
        }
    }
    fn index(self) -> usize {
        if self == Self::Microphone {
            0
        } else {
            1
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub source: AudioSource,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}
pub struct SourceChunk {
    pub source: AudioSource,
    pub audio: TimedChunk,
}
pub struct SourceChunker {
    channels: [SpeechChunker; 2],
    next_preview: usize,
}
impl SourceChunker {
    pub fn new(rate: u32) -> Self {
        Self {
            channels: [SpeechChunker::new(rate), SpeechChunker::new(rate)],
            next_preview: 0,
        }
    }
    pub fn push(&mut self, frames: &[[f32; 2]]) -> Vec<SourceChunk> {
        let mut result = Vec::new();
        for source in [AudioSource::Microphone, AudioSource::System] {
            let channel: Vec<_> = frames.iter().map(|frame| frame[source.index()]).collect();
            result.extend(
                self.channels[source.index()]
                    .push_timed(&channel)
                    .into_iter()
                    .map(|audio| SourceChunk { source, audio }),
            );
        }
        result.sort_by_key(|chunk| chunk.audio.start_sample);
        result
    }
    pub fn finish(&mut self) -> Vec<SourceChunk> {
        let mut result = Vec::new();
        for source in [AudioSource::Microphone, AudioSource::System] {
            result.extend(
                self.channels[source.index()]
                    .finish_timed()
                    .into_iter()
                    .map(|audio| SourceChunk { source, audio }),
            );
        }
        result.sort_by_key(|chunk| chunk.audio.start_sample);
        result
    }
    // At most one speculative decode per tick; alternate to avoid starving a side.
    pub fn preview(&mut self) -> Option<SourceChunk> {
        for _ in 0..2 {
            let index = self.next_preview;
            self.next_preview = (index + 1) % 2;
            if let Some(audio) = self.channels[index].take_timed_preview() {
                return Some(SourceChunk {
                    source: if index == 0 {
                        AudioSource::Microphone
                    } else {
                        AudioSource::System
                    },
                    audio,
                });
            }
        }
        None
    }
}
#[derive(Default)]
pub struct SourceTranscript {
    pub segments: Vec<TranscriptSegment>,
    drafts: [Option<TranscriptSegment>; 2],
}
impl SourceTranscript {
    pub fn commit(&mut self, chunk: &SourceChunk, rate: u32, text: &str) {
        self.drafts[chunk.source.index()] = None;
        if text.chars().any(char::is_alphanumeric) {
            self.segments.push(Self::segment(chunk, rate, text));
            // A short reply can finish before an earlier, longer utterance.
            self.segments.sort_by_key(|segment| segment.start_ms);
        }
    }
    pub fn revise(&mut self, chunk: &SourceChunk, rate: u32, text: &str) {
        self.drafts[chunk.source.index()] = if !text.chars().any(char::is_alphanumeric) {
            None
        } else {
            Some(Self::segment(chunk, rate, text))
        };
    }
    fn segment(chunk: &SourceChunk, rate: u32, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            source: chunk.source,
            start_ms: chunk.audio.start_sample * 1000 / rate as u64,
            end_ms: (chunk.audio.start_sample + chunk.audio.samples.len() as u64) * 1000
                / rate as u64,
            text: text.trim().to_owned(),
        }
    }
    pub fn context(&self, source: AudioSource) -> String {
        let text = self
            .segments
            .iter()
            .rev()
            .filter(|segment| segment.source == source)
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        crate::transcription_context::transcription_prompt("", &text)
    }
    pub fn text(&self) -> String {
        format_segments(&self.segments)
    }
    pub fn update(&self, is_final: bool) -> serde_json::Value {
        let committed = self.text();
        let drafts: Vec<_> = if is_final {
            vec![]
        } else {
            self.drafts.iter().flatten().cloned().collect()
        };
        let draft = format_segments(&drafts);
        let text = [committed.as_str(), draft.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        serde_json::json!({
            "text": text,
            "committed_text": committed, "draft_text": draft, "is_final": is_final,
            "segments": self.segments, "draft_segments": drafts,
        })
    }
}
pub fn format_segments(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| format!("{}: {}", segment.source.label(), segment.text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn speech(n: usize) -> Vec<f32> {
        (0..n).map(|i| (i as f32 * 0.13).sin() * 0.04).collect()
    }
    #[test]
    fn channels_keep_samples_and_absolute_time_across_packets_and_stop() {
        let rate = 16000;
        let voice = speech(rate);
        let mut frames = vec![[0.0; 2]; rate * 4 + 137];
        for (i, sample) in voice.iter().enumerate() {
            frames[rate + i][0] = *sample;
            frames[rate * 2 + i][1] = *sample;
        }
        // A final quiet, short word must survive Stop between frames.
        for (i, frame) in frames[rate * 4..].iter_mut().enumerate() {
            frame[0] = (i as f32 * 0.13).sin() * 0.001;
        }
        let mut chunker = SourceChunker::new(rate as u32);
        let mut actual = Vec::new();
        for packet in frames.chunks(431) {
            actual.extend(chunker.push(packet));
        }
        actual.extend(chunker.finish());
        for (source, index) in [(AudioSource::Microphone, 0), (AudioSource::System, 1)] {
            let mut baseline = SpeechChunker::new(rate as u32);
            let samples: Vec<_> = frames.iter().map(|frame| frame[index]).collect();
            let mut expected = baseline.push_timed(&samples);
            expected.extend(baseline.finish_timed());
            let channel: Vec<_> = actual
                .iter()
                .filter(|chunk| chunk.source == source)
                .collect();
            assert_eq!(channel.len(), expected.len());
            for (actual, expected) in channel.iter().zip(expected) {
                assert_eq!(actual.audio, expected);
            }
        }
        assert_eq!(
            actual
                .iter()
                .find(|c| c.source == AudioSource::Microphone)
                .unwrap()
                .audio
                .start_sample,
            12800
        );
        assert_eq!(
            actual
                .iter()
                .find(|c| c.source == AudioSource::System)
                .unwrap()
                .audio
                .start_sample,
            28800
        );
        assert!(chunker.finish().is_empty());
    }
    #[test]
    fn silence_and_drafts_do_not_change_final_chunks() {
        let rate = 16000;
        let voice = speech(rate * 5);
        let frames: Vec<_> = voice.iter().map(|v| [*v, 0.0]).collect();
        let mut chunker = SourceChunker::new(rate as u32);
        assert!(chunker.push(&frames[..rate * 3]).is_empty());
        assert_eq!(chunker.preview().unwrap().source, AudioSource::Microphone);
        assert!(chunker.preview().is_none());
        assert!(chunker.push(&frames[rate * 3..]).is_empty());
        let chunks = chunker.finish();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].audio.samples, voice);
        assert!(chunker.preview().is_none());
    }
    #[test]
    fn late_final_turns_sort_by_capture_time_and_context_stays_on_its_channel() {
        let mut transcript = SourceTranscript::default();
        let mic = SourceChunk {
            source: AudioSource::Microphone,
            audio: TimedChunk {
                start_sample: 0,
                samples: vec![0.1; 32000],
            },
        };
        let remote = SourceChunk {
            source: AudioSource::System,
            audio: TimedChunk {
                start_sample: 16000,
                samples: vec![0.1; 1000],
            },
        };
        transcript.revise(&mic, 16000, "Incorrect draft");
        transcript.commit(&remote, 16000, "Yes, yes.");
        assert!(transcript.context(AudioSource::Microphone).is_empty());
        transcript.commit(&mic, 16000, "Send the report.");
        assert_eq!(transcript.segments[0].source, AudioSource::Microphone);
        assert_eq!(transcript.segments[1].start_ms, 1000);
        assert_eq!(
            transcript.context(AudioSource::Microphone),
            "Send the report."
        );
        assert_eq!(transcript.context(AudioSource::System), "Yes, yes.");
        assert!(!transcript.text().contains("Incorrect"));
        assert!(transcript.update(true)["draft_segments"]
            .as_array()
            .unwrap()
            .is_empty());
        transcript.revise(&remote, 16000, "Thank you.");
        transcript.commit(&remote, 16000, ". . .");
        assert_eq!(transcript.segments.len(), 2);
        assert_eq!(transcript.update(false)["draft_text"], "");
    }
}

/// Stream archived source audio through the same boundaries/context as capture.
pub fn transcribe_source_wav(
    path: &std::path::Path,
    mut decode: impl FnMut(&[f32], u32, &str) -> Result<String, String>,
) -> Result<SourceTranscript, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    if spec.channels != 2
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Err("Expected the recording's stereo PCM16 source archive".into());
    }
    let mut chunker = SourceChunker::new(spec.sample_rate);
    let mut transcript = SourceTranscript::default();
    let mut process = |chunk: SourceChunk| -> Result<(), String> {
        let text = decode(
            &chunk.audio.samples,
            spec.sample_rate,
            &transcript.context(chunk.source),
        )?;
        transcript.commit(&chunk, spec.sample_rate, &text);
        Ok(())
    };
    let mut samples = reader.samples::<i16>();
    let mut frames = Vec::with_capacity(spec.sample_rate as usize);
    while let Some(left) = samples.next() {
        let right = samples
            .next()
            .ok_or("Incomplete stereo frame")?
            .map_err(|e| e.to_string())?;
        frames.push([
            left.map_err(|e| e.to_string())? as f32 / 32768.0,
            right as f32 / 32768.0,
        ]);
        if frames.len() >= spec.sample_rate as usize {
            for chunk in chunker.push(&frames) {
                process(chunk)?;
            }
            frames.clear();
        }
    }
    for chunk in chunker.push(&frames).into_iter().chain(chunker.finish()) {
        process(chunk)?;
    }
    Ok(transcript)
}
