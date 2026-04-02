use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use anyhow::Result;
use log::info;

// Shared atomic flag to control recording state
pub static IS_RECORDING: AtomicBool = AtomicBool::new(false);

// Store the recording path (file-based mode)
pub static RECORDING_PATH: once_cell::sync::Lazy<Arc<std::sync::Mutex<Option<String>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(std::sync::Mutex::new(None)));

// In-memory buffer for local transcription mode
pub static AUDIO_BUFFER: once_cell::sync::Lazy<Arc<std::sync::Mutex<Vec<f32>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(std::sync::Mutex::new(Vec::new())));

// Device sample rate detected at recording start
pub static DEVICE_SAMPLE_RATE: AtomicU32 = AtomicU32::new(0);

// How many samples the realtime loop has already consumed
pub static PROCESSED_SAMPLE_COUNT: once_cell::sync::Lazy<Arc<std::sync::Mutex<usize>>> =
    once_cell::sync::Lazy::new(|| Arc::new(std::sync::Mutex::new(0)));

/// Record audio to a WAV file 
pub fn record_audio(file_path: &str) -> Result<(), String> {
    use hound::{WavSpec, WavWriter};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    
    // Get default host and input device
    let host = cpal::default_host();
    let device = host.default_input_device()
        .ok_or_else(|| "No input device available".to_string())?;
    
    // Get supported config
    let config = device.default_input_config()
        .map_err(|e| format!("Default config not supported: {}", e))?;
    
    // Set up WAV writer - using mono (1 channel) instead of stereo
    let spec = WavSpec {
        channels: 1, // Force mono recording
        sample_rate: config.sample_rate().0,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    
    let writer = Arc::new(std::sync::Mutex::new(
        WavWriter::create(file_path, spec)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?
    ));
    
    // Create a modified configuration that forces mono
    let stream_config = cpal::StreamConfig {
        channels: 1, // Force mono
        sample_rate: config.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };
    
    // Set up stream
    let err_fn = move |err| {
        eprintln!("an error occurred on stream: {}", err);
    };
    
    let writer_clone = writer.clone();
    let stream = match config.sample_format() {
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &_| {
                if IS_RECORDING.load(Ordering::SeqCst) {
                    let mut writer = writer_clone.lock().unwrap();
                    for &sample in data {
                        writer.write_sample(sample).unwrap();
                    }
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &_| {
                if IS_RECORDING.load(Ordering::SeqCst) {
                    let mut writer = writer_clone.lock().unwrap();
                    for &sample in data {
                        // Convert f32 to i16
                        let sample = (sample * 32767.0) as i16;
                        writer.write_sample(sample).unwrap();
                    }
                }
            },
            err_fn,
            None,
        ),
        _ => return Err("Unsupported sample format".to_string()),
    }.map_err(|e| format!("Failed to build input stream: {}", e))?;
    
    // Start the stream
    stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;
    
    // Record until IS_RECORDING is set to false
    while IS_RECORDING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    
    // The stream will be stopped when it goes out of scope
    drop(stream);
    
    Ok(())
}

/// Start a new audio recording
pub async fn start_recording() -> Result<String, String> {
    // Check if already recording
    if IS_RECORDING.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    // Create a temporary file path in the system temp directory
    let app_data_dir = std::env::temp_dir().join("platypus_recordings");
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create recording directory: {}", e))?;
    
    // Create a timestamped file name
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let file_path = app_data_dir.join(format!("recording_{}.wav", timestamp));
    let file_path_str = file_path.to_str()
        .ok_or_else(|| "Failed to convert path to string".to_string())?
        .to_string();
    
    // Store the recording path
    let mut path_guard = RECORDING_PATH.lock().unwrap();
    *path_guard = Some(file_path_str.clone());
    drop(path_guard);

    // Start recording in a separate thread
    let file_path_clone = file_path_str.clone();
    std::thread::spawn(move || {
        if let Err(err) = record_audio(&file_path_clone) {
            eprintln!("Error recording audio: {}", err);
            IS_RECORDING.store(false, Ordering::SeqCst);
        }
    });

    IS_RECORDING.store(true, Ordering::SeqCst);
    Ok(file_path_str)
}

/// Stop the current recording
pub async fn stop_recording() -> Result<String, String> {
    // Get the recording path first before changing IS_RECORDING state
    let path_guard = RECORDING_PATH.lock().unwrap();
    let path = path_guard.clone().unwrap_or_default();
    drop(path_guard);

    // Check if recording
    if !IS_RECORDING.load(Ordering::SeqCst) {
        // If we have a path, return it even if we're not recording
        if !path.is_empty() {
            return Ok(path);
        }
        return Err("Not recording".to_string());
    }

    // Stop recording
    IS_RECORDING.store(false, Ordering::SeqCst);

    // Wait a moment for the recording thread to finish
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    Ok(path)
}

/// Read the contents of an audio file into a byte vector
pub fn read_audio_file(file_path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(file_path)
        .map_err(|err| format!("Failed to read audio file: {}", err))
}

// ── In-memory buffer mode (for local Whisper transcription) ──

/// Record audio into an in-memory f32 buffer instead of a WAV file
fn record_audio_to_buffer() -> std::result::Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host.default_input_device()
        .ok_or_else(|| "No input device available".to_string())?;

    let config = device.default_input_config()
        .map_err(|e| format!("Default config not supported: {}", e))?;

    let sample_rate = config.sample_rate().0;
    DEVICE_SAMPLE_RATE.store(sample_rate, Ordering::SeqCst);
    info!("Recording to buffer at {}Hz", sample_rate);

    let stream_config = cpal::StreamConfig {
        channels: 1,
        sample_rate: config.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };

    let buffer = AUDIO_BUFFER.clone();
    let err_fn = move |err| {
        eprintln!("an error occurred on stream: {}", err);
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::I16 => {
            let buf = buffer.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _: &_| {
                    if IS_RECORDING.load(Ordering::SeqCst) {
                        let mut b = buf.lock().unwrap();
                        for &sample in data {
                            b.push(sample as f32 / 32768.0);
                        }
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::F32 => {
            let buf = buffer.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _: &_| {
                    if IS_RECORDING.load(Ordering::SeqCst) {
                        let mut b = buf.lock().unwrap();
                        b.extend_from_slice(data);
                    }
                },
                err_fn,
                None,
            )
        }
        _ => return Err("Unsupported sample format".to_string()),
    }.map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;

    while IS_RECORDING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    drop(stream);
    Ok(())
}

/// Start recording into the in-memory buffer
pub async fn start_recording_local() -> std::result::Result<(), String> {
    if IS_RECORDING.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    // Clear previous buffer
    {
        let mut buf = AUDIO_BUFFER.lock().unwrap();
        buf.clear();
    }
    {
        let mut count = PROCESSED_SAMPLE_COUNT.lock().unwrap();
        *count = 0;
    }

    IS_RECORDING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        if let Err(err) = record_audio_to_buffer() {
            eprintln!("Error recording audio to buffer: {}", err);
            IS_RECORDING.store(false, Ordering::SeqCst);
        }
    });

    Ok(())
}

/// Stop the in-memory buffer recording
pub async fn stop_recording_local() -> std::result::Result<(), String> {
    if !IS_RECORDING.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }
    IS_RECORDING.store(false, Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(200));
    Ok(())
}

/// Get new (unprocessed) samples from the buffer for the realtime loop
pub fn take_new_samples() -> Vec<f32> {
    let buf = AUDIO_BUFFER.lock().unwrap();
    let mut count = PROCESSED_SAMPLE_COUNT.lock().unwrap();
    let start = *count;
    if start >= buf.len() {
        return Vec::new();
    }
    let new_samples = buf[start..].to_vec();
    *count = buf.len();
    new_samples
}

/// Drain all remaining samples (called at stop for final processing)
pub fn drain_all_samples() -> Vec<f32> {
    let buf = AUDIO_BUFFER.lock().unwrap();
    let count = PROCESSED_SAMPLE_COUNT.lock().unwrap();
    let start = *count;
    if start >= buf.len() {
        return Vec::new();
    }
    buf[start..].to_vec()
}
