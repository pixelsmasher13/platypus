//! Timestamped audio assembly. Two isolated channels are retained on disk;
//! only the transcription/playback mix combines microphone and meeting audio.
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
};
pub const RATE: u32 = 48_000;

pub struct SourceResampler {
    input_rate: u32,
    pending: Vec<f32>,
    resampler: Option<SincFixedIn<f32>>,
    input_count: usize,
    output_count: usize,
}
impl SourceResampler {
    pub fn new(input_rate: u32) -> Result<Self, String> {
        if input_rate == 0 {
            return Err("Invalid audio sample rate".into());
        }
        let resampler = if input_rate == RATE {
            None
        } else {
            Some(
                SincFixedIn::<f32>::new(
                    RATE as f64 / input_rate as f64,
                    1.0,
                    SincInterpolationParameters {
                        sinc_len: 128,
                        f_cutoff: 0.95,
                        interpolation: SincInterpolationType::Linear,
                        oversampling_factor: 128,
                        window: WindowFunction::BlackmanHarris2,
                    },
                    1024,
                    1,
                )
                .map_err(|e| e.to_string())?,
            )
        };
        Ok(Self {
            input_rate,
            pending: Vec::new(),
            resampler,
            input_count: 0,
            output_count: 0,
        })
    }
    pub fn push(&mut self, data: &[f32], finish: bool) -> Result<Vec<f32>, String> {
        self.input_count += data.len();
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(data.to_vec());
        };
        self.pending.extend_from_slice(data);
        let mut output = Vec::new();
        while self.pending.len() >= 1024 {
            let input: Vec<f32> = self.pending.drain(..1024).collect();
            output.extend(
                resampler
                    .process(&[input], None)
                    .map_err(|e| e.to_string())?
                    .remove(0),
            );
        }
        let expected =
            (self.input_count as f64 * RATE as f64 / self.input_rate as f64).round() as usize;
        if finish {
            if !self.pending.is_empty() {
                output.extend(
                    resampler
                        .process_partial(Some(&[std::mem::take(&mut self.pending)]), None)
                        .map_err(|e| e.to_string())?
                        .remove(0),
                );
            }
            while self.output_count + output.len() < expected {
                output.extend(
                    resampler
                        .process_partial::<Vec<f32>>(None, None)
                        .map_err(|e| e.to_string())?
                        .remove(0),
                );
            }
        }
        // SincFixedIn accounts for its lookahead by emitting fewer initial
        // frames. Dropping output_delay() here would cut actual speech.
        if finish {
            output.truncate(expected.saturating_sub(self.output_count));
        }
        self.output_count += output.len();
        Ok(output)
    }
}

#[derive(Default)]
pub struct AudioTimeline {
    frames: VecDeque<[f32; 2]>,
    cursor: usize,
    pub late_samples: usize,
}
impl AudioTimeline {
    pub fn push(&mut self, source: usize, offset: usize, samples: &[f32]) {
        let skip = self.cursor.saturating_sub(offset).min(samples.len());
        self.late_samples += skip;
        let start = offset.max(self.cursor) - self.cursor;
        let samples = &samples[skip..];
        if samples.is_empty() {
            return;
        }
        if self.frames.len() < start + samples.len() {
            self.frames.resize(start + samples.len(), [0.0; 2]);
        }
        for (index, &sample) in samples.iter().enumerate() {
            self.frames[start + index][source] = if sample.is_finite() {
                sample.clamp(-1.0, 1.0)
            } else {
                0.0
            };
        }
    }
    pub fn drain_until(&mut self, end: usize) -> Vec<[f32; 2]> {
        let count = end.saturating_sub(self.cursor);
        self.frames.resize(self.frames.len().max(count), [0.0; 2]);
        self.cursor += count;
        self.frames.drain(..count).collect()
    }
    pub fn end(&self) -> usize {
        self.cursor + self.frames.len()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedRecording {
    pub id: String,
    pub note_id: Option<i64>,
    pub created_at: String,
    pub duration_seconds: f64,
    pub source: String,
    pub transcription_model: String,
    pub status: String,
    pub warning: Option<String>,
    pub transcript: Option<String>,
    // Archives created before retention was configurable must be preserved.
    #[serde(default = "legacy_keep_audio")]
    pub keep_audio: bool,
}
fn legacy_keep_audio() -> bool { true }

// Persist the recoverable transcript before removing temporary audio. Capture
// warnings and empty results retain audio so the user can retry transcription.
pub fn finish_transcription(root: &Path, id: &str, text: &str) -> Result<(), String> {
    let mut recording = load(root, id)?;
    if recording.transcript.as_deref().unwrap_or("").trim().is_empty() {
        recording.transcript = Some(text.to_owned());
    }
    save_metadata(root, &recording)?;
    if !recording.keep_audio && recording.status == "saved" && recording.warning.is_none() && !text.trim().is_empty() {
        let dir = directory(root, id)?;
        for name in ["audio.wav", "sources.wav"] {
            if let Err(error) = std::fs::remove_file(dir.join(name)) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    log::warn!("Transcript saved, but temporary audio cleanup failed: {}", error);
                }
            }
        }
    }
    Ok(())
}

pub fn directory(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("Invalid recording id".into());
    }
    Ok(root.join(id))
}
pub fn save_metadata(root: &Path, recording: &SavedRecording) -> Result<(), String> {
    let dir = directory(root, &recording.id)?;
    let mut file = tempfile::NamedTempFile::new_in(&dir).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut file, recording).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(dir.join("recording.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn load(root: &Path, id: &str) -> Result<SavedRecording, String> {
    serde_json::from_slice(
        &std::fs::read(directory(root, id)?.join("recording.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
pub fn list(root: &Path, note_id: Option<i64>) -> Result<Vec<SavedRecording>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut recordings = Vec::new();
    for entry in std::fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        if let Ok(recording) = load(root, &entry.file_name().to_string_lossy()) {
            if note_id.is_none() || recording.note_id == note_id {
                recordings.push(recording);
            }
        }
    }
    recordings.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(recordings)
}

pub struct RecordingWriter {
    isolated: hound::WavWriter<std::io::BufWriter<std::fs::File>>,
    mix: hound::WavWriter<std::io::BufWriter<std::fs::File>>,
    frames: usize,
    mix_gain: f32,
}
impl RecordingWriter {
    pub fn new(dir: &Path, both_sources: bool) -> Result<Self, String> {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        Ok(Self {
            isolated: hound::WavWriter::create(dir.join("sources.wav"), spec)
                .map_err(|e| e.to_string())?,
            mix: hound::WavWriter::create(
                dir.join("audio.wav"),
                hound::WavSpec {
                    channels: 1,
                    ..spec
                },
            )
            .map_err(|e| e.to_string())?,
            frames: 0,
            mix_gain: if both_sources { 0.5 } else { 1.0 },
        })
    }
    pub fn write(&mut self, frames: &[[f32; 2]]) -> Result<Vec<f32>, String> {
        let mut mixed = Vec::with_capacity(frames.len());
        for frame in frames {
            for sample in frame {
                self.isolated
                    .write_sample((sample.clamp(-1.0, 1.0) * 32767.0).round() as i16)
                    .map_err(|e| e.to_string())?;
            }
            // Fixed headroom avoids clipping when both people speak at once.
            let sample = (frame[0] + frame[1]) * self.mix_gain;
            self.mix
                .write_sample((sample * 32767.0).round() as i16)
                .map_err(|e| e.to_string())?;
            mixed.push(sample);
        }
        self.frames += frames.len();
        Ok(mixed)
    }
    pub fn flush(&mut self) -> Result<(), String> {
        self.isolated.flush().map_err(|e| e.to_string())?;
        self.mix.flush().map_err(|e| e.to_string())
    }
    pub fn finish(self) -> Result<f64, String> {
        self.isolated.finalize().map_err(|e| e.to_string())?;
        self.mix.finalize().map_err(|e| e.to_string())?;
        Ok(self.frames as f64 / RATE as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_preserves_legacy_archives_and_recovery_audio() {
        for (keep, status, warning, text, should_keep) in [
            (None, "saved", None, "Final transcript", true),
            (Some(true), "saved", None, "Final transcript", true),
            (Some(false), "saved", None, "Final transcript", false),
            (Some(false), "saved", None, "", true),
            (Some(false), "interrupted", None, "Partial transcript", true),
            (Some(false), "saved_with_warning", Some("Source disconnected"), "Partial", true),
        ] {
            let root = tempfile::tempdir().unwrap();
            let id = "20260925-1";
            let dir = directory(root.path(), id).unwrap();
            std::fs::create_dir(&dir).unwrap();
            let mut metadata = serde_json::json!({
                "id": id, "note_id": 42, "created_at": "2026-09-25", "duration_seconds": 1.0,
                "source": "both", "transcription_model": "large-v3", "status": status,
                "warning": warning, "transcript": null
            });
            if let Some(keep) = keep { metadata["keep_audio"] = keep.into(); }
            std::fs::write(dir.join("recording.json"), serde_json::to_vec(&metadata).unwrap()).unwrap();
            for name in ["audio.wav", "sources.wav"] { std::fs::write(dir.join(name), b"audio").unwrap(); }
            std::fs::write(dir.join("transcript-comparison.json"), b"comparison").unwrap();
            finish_transcription(root.path(), id, text).unwrap();
            assert_eq!(load(root.path(), id).unwrap().transcript.as_deref(), Some(text));
            assert_eq!(load(root.path(), id).unwrap().note_id, Some(42));
            for name in ["audio.wav", "sources.wav"] { assert_eq!(dir.join(name).exists(), should_keep); }
            assert!(dir.join("transcript-comparison.json").exists());
            // Repeated completion is safe and never replaces the original.
            finish_transcription(root.path(), id, text).unwrap();
        }
    }

    #[test]
    fn unreadable_metadata_never_triggers_audio_deletion() {
        let root = tempfile::tempdir().unwrap();
        let dir = directory(root.path(), "1").unwrap();
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("audio.wav"), b"audio").unwrap();
        assert!(finish_transcription(root.path(), "1", "transcript").is_err());
        assert!(dir.join("audio.wav").exists());
    }

    #[test]
    fn timestamps_keep_sources_aligned_through_silence_and_late_callbacks() {
        let mut timeline = AudioTimeline::default();
        timeline.push(1, 4, &[0.2, 0.3]);
        timeline.push(0, 1, &[0.1, 0.2, 0.3]);
        assert_eq!(
            timeline.drain_until(3),
            vec![[0.0, 0.0], [0.1, 0.0], [0.2, 0.0]]
        );
        timeline.push(0, 2, &[0.9, 0.4, 0.5]);
        assert_eq!(timeline.late_samples, 1);
        assert_eq!(
            timeline.drain_until(6),
            vec![[0.4, 0.0], [0.5, 0.2], [0.0, 0.3]]
        );
    }
    #[test]
    fn streaming_resampler_preserves_duration_and_boundaries_independent_of_callback_size() {
        let input: Vec<_> = (0..44100).map(|i| (i as f32 * 0.03).sin() * 0.2).collect();
        let run = |size| {
            let mut resampler = SourceResampler::new(44100).unwrap();
            let mut output = Vec::new();
            for chunk in input.chunks(size) {
                output.extend(resampler.push(chunk, false).unwrap());
            }
            output.extend(resampler.push(&[], true).unwrap());
            output
        };
        let result = run(137);
        assert_eq!(result.len(), 48000);
        assert_eq!(result, run(2048));
        // Check alignment, not just duration: the initial lookahead must not
        // shift the microphone relative to the direct meeting-audio channel.
        for i in [1000, 10000, 47000] {
            let expected = (i as f32 * 44100.0 / 48000.0 * 0.03).sin() * 0.2;
            assert!((result[i] - expected).abs() < 0.01);
        }
        assert!(
            result.iter().rev().take(100).map(|s| s * s).sum::<f32>() > 0.1,
            "tail energy {} last nonzero {:?}",
            result.iter().rev().take(100).map(|s| s * s).sum::<f32>(),
            result.iter().rposition(|v| v.abs() > 0.01)
        );
    }
    #[test]
    fn archives_survive_reload_and_keep_sources_separate_from_mix() {
        let root = tempfile::tempdir().unwrap();
        let id = "20260925-123";
        let dir = directory(root.path(), id).unwrap();
        std::fs::create_dir(&dir).unwrap();
        let mut writer = RecordingWriter::new(&dir, true).unwrap();
        writer.write(&[[0.4, 0.2], [0.0, -0.4]]).unwrap();
        let duration = writer.finish().unwrap();
        let record = SavedRecording {
            id: id.into(),
            note_id: Some(42),
            created_at: "2026-09-25".into(),
            duration_seconds: duration,
            source: "both".into(),
            transcription_model: "large-v3".into(),
            status: "saved".into(),
            warning: None,
            transcript: None,
            keep_audio: true,
        };
        save_metadata(root.path(), &record).unwrap();
        assert_eq!(list(root.path(), Some(42)).unwrap().len(), 1);
        assert!(list(root.path(), Some(7)).unwrap().is_empty());
        let reader = hound::WavReader::open(dir.join("sources.wav")).unwrap();
        assert_eq!(reader.spec().channels, 2);
        assert_eq!(
            reader
                .into_samples::<i16>()
                .map(Result::unwrap)
                .collect::<Vec<_>>(),
            vec![13107, 6553, 0, -13107]
        );
        assert_eq!(
            hound::WavReader::open(dir.join("audio.wav"))
                .unwrap()
                .spec()
                .channels,
            1
        );
        assert!(directory(root.path(), "../other").is_err());
    }
}
