use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use platypus_notes::recording_audio::{
    self, AudioTimeline, RecordingWriter, SavedRecording, SourceResampler, RATE,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub static IS_RECORDING: AtomicBool = AtomicBool::new(false);
pub static LOCAL_CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);
pub static DEVICE_SAMPLE_RATE: AtomicU32 = AtomicU32::new(RATE);
static AUDIO_BUFFER: Mutex<Vec<f32>> = Mutex::new(Vec::new());
static RECORDING_THREAD: Mutex<Option<std::thread::JoinHandle<Result<String, String>>>> =
    Mutex::new(None);
static STATUS: once_cell::sync::Lazy<Mutex<CaptureStatus>> =
    once_cell::sync::Lazy::new(|| Mutex::new(CaptureStatus::default()));

#[derive(Clone, Default, Serialize)]
pub struct CaptureStatus {
    pub recording_id: String,
    pub recording: bool,
    pub can_stop: bool,
    pub use_local: bool,
    pub source: String,
    pub microphone: String,
    pub meeting_audio: String,
    pub microphone_level: f32,
    pub meeting_level: f32,
    pub warning: Option<String>,
}
pub fn capture_status() -> CaptureStatus {
    let mut status = STATUS.lock().unwrap().clone();
    status.can_stop = RECORDING_THREAD.lock().unwrap().is_some();
    status
}
pub fn take_new_samples() -> Vec<f32> {
    std::mem::take(&mut *AUDIO_BUFFER.lock().unwrap())
}
pub fn read_audio_file(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

struct Packet {
    source: usize,
    rate: u32,
    start: f64,
    samples: Vec<f32>,
}
#[derive(Clone)]
struct CaptureSink {
    tx: SyncSender<Packet>,
    epoch: Arc<once_cell::sync::OnceCell<Instant>>,
    dropped: Arc<AtomicUsize>,
    failure: Arc<Mutex<Option<String>>>,
}
impl CaptureSink {
    fn send(&self, source: usize, rate: u32, samples: Vec<f32>, age: f64) {
        let Some(epoch) = self.epoch.get() else {
            return;
        };
        let start = (epoch.elapsed().as_secs_f64() - age.max(0.0)).max(0.0);
        if self
            .tx
            .try_send(Packet {
                source,
                rate,
                start,
                samples,
            })
            .is_err()
        {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
    fn fail(&self, error: String) {
        *self.failure.lock().unwrap() = Some(error);
    }
}

#[cfg(target_os = "macos")]
struct SystemCapture {
    handle: *mut std::ffi::c_void,
    _sink: Box<CaptureSink>,
}
#[cfg(target_os = "macos")]
extern "C" {
    fn platypus_system_audio_start(
        callback: extern "C" fn(*mut std::ffi::c_void, *const f32, usize, f64),
        error: extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char),
        context: *mut std::ffi::c_void,
        message: *mut std::ffi::c_char,
        capacity: usize,
    ) -> *mut std::ffi::c_void;
    fn platypus_system_audio_stop(handle: *mut std::ffi::c_void);
}
#[cfg(target_os = "macos")]
impl SystemCapture {
    fn start(sink: CaptureSink) -> Result<Self, String> {
        extern "C" fn audio(
            context: *mut std::ffi::c_void,
            data: *const f32,
            count: usize,
            age: f64,
        ) {
            // The bridge owns this callback lifetime and drains it before drop.
            let sink = unsafe { &*(context as *const CaptureSink) };
            let samples = unsafe { std::slice::from_raw_parts(data, count) }.to_vec();
            sink.send(
                1,
                RATE,
                samples,
                if age.is_finite() && (0.0..5.0).contains(&age) {
                    age
                } else {
                    count as f64 / RATE as f64
                },
            );
        }
        extern "C" fn error(context: *mut std::ffi::c_void, message: *const std::ffi::c_char) {
            let sink = unsafe { &*(context as *const CaptureSink) };
            sink.fail(format!(
                "Meeting audio stopped: {}",
                unsafe { std::ffi::CStr::from_ptr(message) }.to_string_lossy()
            ));
        }
        let mut sink = Box::new(sink);
        let mut message = [0i8; 1024];
        let handle = unsafe {
            platypus_system_audio_start(
                audio,
                error,
                &mut *sink as *mut CaptureSink as *mut _,
                message.as_mut_ptr(),
                message.len(),
            )
        };
        if handle.is_null() {
            return Err(unsafe { std::ffi::CStr::from_ptr(message.as_ptr()) }
                .to_string_lossy()
                .into_owned());
        }
        Ok(Self {
            handle,
            _sink: sink,
        })
    }
}
#[cfg(target_os = "macos")]
impl Drop for SystemCapture {
    fn drop(&mut self) {
        unsafe {
            platypus_system_audio_stop(self.handle);
        }
    }
}
#[cfg(not(target_os = "macos"))]
struct SystemCapture;
#[cfg(not(target_os = "macos"))]
impl SystemCapture {
    fn start(_: CaptureSink) -> Result<Self, String> {
        Err("Direct meeting audio is currently available on macOS 13+. Choose Microphone only on this computer.".into())
    }
}

fn start_microphone(sink: CaptureSink) -> Result<(cpal::Stream, String), String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("No microphone available. Connect a microphone or choose Meeting audio only.")?;
    let name = device.name().unwrap_or_else(|_| "Microphone".into());
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let channels = config.channels() as usize;
    let rate = config.sample_rate().0;
    let error_sink = sink.clone();
    let on_error = move |e| {
        error_sink.fail(format!("Microphone disconnected or stopped: {}. Stop and restart recording to use the current input.", e))
    };
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], info: &cpal::InputCallbackInfo| {
                let samples = data
                    .chunks_exact(channels)
                    .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                    .collect();
                let timestamp = info.timestamp();
                let age = timestamp
                    .callback
                    .duration_since(&timestamp.capture)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(data.len() as f64 / channels as f64 / rate as f64);
                sink.send(0, rate, samples, age);
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], info: &cpal::InputCallbackInfo| {
                let samples = data
                    .chunks_exact(channels)
                    .map(|frame| {
                        frame.iter().map(|s| *s as f32 / 32768.0).sum::<f32>() / channels as f32
                    })
                    .collect();
                let timestamp = info.timestamp();
                let age = timestamp
                    .callback
                    .duration_since(&timestamp.capture)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(data.len() as f64 / channels as f64 / rate as f64);
                sink.send(0, rate, samples, age);
            },
            on_error,
            None,
        ),
        format => return Err(format!("Unsupported microphone format: {:?}", format)),
    }
    .map_err(|e| format!("Could not open microphone: {}", e))?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, name))
}

struct Track {
    resampler: SourceResampler,
    rate: u32,
    origin: f64,
    input: usize,
    output: usize,
    last_packet: Instant,
    level: f32,
}
impl Track {
    fn new(packet: &Packet) -> Result<Self, String> {
        Ok(Self {
            resampler: SourceResampler::new(packet.rate)?,
            rate: packet.rate,
            origin: packet.start,
            input: 0,
            output: 0,
            last_packet: Instant::now(),
            level: 0.0,
        })
    }
    fn append(
        &mut self,
        source: usize,
        samples: &[f32],
        finish: bool,
        timeline: &mut AudioTimeline,
    ) -> Result<(), String> {
        let converted = self.resampler.push(samples, finish)?;
        let start = (self.origin * RATE as f64).round() as usize + self.output;
        timeline.push(source, start, &converted);
        self.input += samples.len();
        self.output += converted.len();
        Ok(())
    }
}

pub async fn start_recording(
    root: PathBuf,
    note_id: Option<i64>,
    source: String,
    local: bool,
    model: String,
    keep_audio: bool,
) -> Result<String, String> {
    if !["both", "microphone", "system"].contains(&source.as_str()) {
        return Err("Choose a recording source".into());
    }
    if RECORDING_THREAD.lock().unwrap().is_some()
        || LOCAL_CAPTURE_RUNNING.load(Ordering::SeqCst)
        || IS_RECORDING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
    {
        return Err("Finish the current recording first.".into());
    }
    AUDIO_BUFFER.lock().unwrap().clear();
    LOCAL_CAPTURE_RUNNING.store(true, Ordering::SeqCst);
    let id = format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%d%H%M%S%6f"),
        std::process::id()
    );
    let recording = SavedRecording {
        id: id.clone(),
        note_id,
        created_at: chrono::Utc::now().to_rfc3339(),
        duration_seconds: 0.0,
        source,
        transcription_model: model,
        status: "recording".into(),
        warning: None,
        transcript: None,
        keep_audio,
    };
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let thread = std::thread::spawn(move || {
        let result = capture(root, recording, local, ready_tx);
        IS_RECORDING.store(false, Ordering::SeqCst);
        LOCAL_CAPTURE_RUNNING.store(false, Ordering::SeqCst);
        let mut status = STATUS.lock().unwrap();
        status.recording = false;
        if let Err(error) = &result {
            status.warning = Some(error.clone());
        }
        result
    });
    *RECORDING_THREAD.lock().unwrap() = Some(thread);
    if ready_rx.await.is_err() {
        stop_recording().await?;
        return Err("Audio capture could not start".into());
    }
    Ok(id)
}

fn capture(
    root: PathBuf,
    mut recording: SavedRecording,
    local: bool,
    ready: tokio::sync::oneshot::Sender<()>,
) -> Result<String, String> {
    let dir = recording_audio::directory(&root, &recording.id)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let mut writer = RecordingWriter::new(&dir, recording.source == "both")?;
    recording_audio::save_metadata(&root, &recording)?;
    let (tx, rx) = mpsc::sync_channel(512);
    let sink = CaptureSink {
        tx,
        epoch: Arc::new(once_cell::sync::OnceCell::new()),
        dropped: Arc::new(AtomicUsize::new(0)),
        failure: Arc::new(Mutex::new(None)),
    };
    let mut status = CaptureStatus {
        recording_id: recording.id.clone(),
        recording: true,
        use_local: local,
        source: recording.source.clone(),
        microphone: "Off".into(),
        meeting_audio: "Off".into(),
        ..Default::default()
    };
    // Start the system stream first: macOS may need the user's permission.
    let sources = (|| {
        let system = if recording.source != "microphone" {
            let capture = SystemCapture::start(sink.clone())?;
            status.meeting_audio = "Waiting for meeting audio".into();
            Some(capture)
        } else {
            None
        };
        let microphone = if recording.source != "system" {
            let (stream, name) = start_microphone(sink.clone())?;
            status.microphone = name;
            Some(stream)
        } else {
            None
        };
        Ok::<_, String>((system, microphone))
    })();
    let (system, microphone) = match sources {
        Ok(sources) => sources,
        Err(error) => {
            recording.status = "failed".into();
            recording.warning = Some(error.clone());
            writer.finish()?;
            recording_audio::save_metadata(&root, &recording)?;
            return Err(error);
        }
    };
    let _ = sink.epoch.set(Instant::now());
    *STATUS.lock().unwrap() = status.clone();
    let _ = ready.send(());
    let mut timeline = AudioTimeline::default();
    let mut tracks: [Option<Track>; 2] = [None, None];
    let mut flush_at = Instant::now();
    let mut publish_at = Instant::now();
    let mut stopping = false;
    let mut last_tick = Instant::now();
    let mut streams = Some((system, microphone));
    let result = (|| -> Result<(), String> {
        loop {
            if last_tick.elapsed() > Duration::from_secs(5) {
                status.warning = Some("Recording interrupted while the computer was asleep or audio processing stalled. Audio captured before the interruption has been saved.".into());
                IS_RECORDING.store(false, Ordering::SeqCst);
                drop(streams.take());
                // Avoid allocating hours of silence after waking from sleep.
                while rx.try_recv().is_ok() {}
                stopping = true;
            }
            last_tick = Instant::now();
            if !IS_RECORDING.load(Ordering::SeqCst) && !stopping {
                // Dropping both streams settles callbacks before draining the queue.
                drop(streams.take());
                stopping = true;
            }
            while let Ok(packet) = rx.try_recv() {
                let index = packet.source;
                if let Some(track) = &mut tracks[index] {
                    let expected = track.origin + track.input as f64 / track.rate as f64;
                    if track.rate != packet.rate || (packet.start - expected).abs() > 0.1 {
                        track.append(index, &[], true, &mut timeline)?;
                        tracks[index] = None;
                    }
                }
                if tracks[index].is_none() {
                    tracks[index] = Some(Track::new(&packet)?);
                }
                let track = tracks[index].as_mut().unwrap();
                track.last_packet = Instant::now();
                track.level = (packet.samples.iter().map(|v| v * v).sum::<f32>()
                    / packet.samples.len().max(1) as f32)
                    .sqrt();
                track.append(index, &packet.samples, false, &mut timeline)?;
            }
            if stopping {
                for (index, track) in tracks.iter_mut().enumerate() {
                    if let Some(track) = track {
                        track.append(index, &[], true, &mut timeline)?;
                    }
                }
            }
            let end = if stopping {
                timeline.end()
            } else {
                (sink.epoch.get().unwrap().elapsed().as_secs_f64().max(0.4) * RATE as f64) as usize
                    - (RATE as usize * 2 / 5)
            };
            let frames = timeline.drain_until(end);
            let mixed = writer.write(&frames)?;
            if local {
                AUDIO_BUFFER.lock().unwrap().extend(mixed);
            }
            if flush_at.elapsed() >= Duration::from_secs(1) {
                writer.flush()?;
                flush_at = Instant::now();
            }
            if publish_at.elapsed() >= Duration::from_millis(150) || stopping {
                for (index, track) in tracks.iter().enumerate() {
                    let level = track
                        .as_ref()
                        .filter(|t| t.last_packet.elapsed() < Duration::from_millis(500))
                        .map(|t| t.level)
                        .unwrap_or(0.0);
                    if index == 0 {
                        status.microphone_level = level;
                    } else {
                        status.meeting_level = level;
                        if recording.source != "microphone" {
                            status.meeting_audio = if track
                                .as_ref()
                                .map_or(true, |t| t.last_packet.elapsed() > Duration::from_secs(5))
                            {
                                "No audio received · check meeting output"
                            } else if level > 0.00015 {
                                "Receiving audio"
                            } else {
                                "Connected · quiet"
                            }
                            .into();
                        }
                    }
                }
                if sink.dropped.load(Ordering::Relaxed) > 0
                    || timeline.late_samples > RATE as usize / 10
                {
                    status.warning = Some("Some audio arrived too late or was dropped. The saved recording may have gaps.".into());
                }
                if let Some(error) = sink.failure.lock().unwrap().clone() {
                    status.warning = Some(error);
                    IS_RECORDING.store(false, Ordering::SeqCst);
                }
                if recording.source != "system"
                    && tracks[0].as_ref().map_or(
                        sink.epoch.get().unwrap().elapsed() > Duration::from_secs(8),
                        |t| t.last_packet.elapsed() > Duration::from_secs(5),
                    )
                {
                    status.warning = Some("The microphone stopped delivering audio. Stop and restart recording after checking your input device.".into());
                    IS_RECORDING.store(false, Ordering::SeqCst);
                }
                *STATUS.lock().unwrap() = status.clone();
                publish_at = Instant::now();
            }
            if stopping {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Ok(())
    })();
    drop(streams);
    recording.duration_seconds = writer.finish()?;
    recording.warning = result.as_ref().err().cloned().or(status.warning);
    recording.status = if recording.warning.is_some() {
        "saved_with_warning"
    } else {
        "saved"
    }
    .into();
    recording_audio::save_metadata(&root, &recording)?;
    result?;
    Ok(dir.join("audio.wav").to_string_lossy().into_owned())
}

pub async fn stop_recording() -> Result<String, String> {
    IS_RECORDING.store(false, Ordering::SeqCst);
    let thread = RECORDING_THREAD
        .lock()
        .unwrap()
        .take()
        .ok_or("No recording to finish")?;
    tokio::task::spawn_blocking(move || thread.join())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "Recording thread failed".to_string())?
}
