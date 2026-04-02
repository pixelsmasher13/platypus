use anyhow::{Result, anyhow};
use log::info;

/// Resample audio from source_rate to target_rate using rubato
pub fn resample(samples: &[f32], source_rate: u32, target_rate: u32) -> Result<Vec<f32>> {
    if source_rate == target_rate {
        return Ok(samples.to_vec());
    }
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction, Resampler};

    let ratio = target_rate as f64 / source_rate as f64;

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let chunk_size = samples.len().min(1024);
    let mut resampler = SincFixedIn::<f32>::new(
        ratio,
        2.0,
        params,
        chunk_size,
        1,
    ).map_err(|e| anyhow!("Failed to create resampler: {}", e))?;

    let mut output = Vec::with_capacity((samples.len() as f64 * ratio) as usize + 1024);

    let mut offset = 0;
    while offset + chunk_size <= samples.len() {
        let chunk = &samples[offset..offset + chunk_size];
        let waves_in = vec![chunk.to_vec()];
        match resampler.process(&waves_in, None) {
            Ok(waves_out) => {
                if let Some(out) = waves_out.into_iter().next() {
                    output.extend_from_slice(&out);
                }
            }
            Err(e) => return Err(anyhow!("Resampling error: {}", e)),
        }
        offset += chunk_size;
    }

    if offset < samples.len() {
        let remaining = &samples[offset..];
        let mut padded = remaining.to_vec();
        padded.resize(chunk_size, 0.0);
        let waves_in = vec![padded];
        match resampler.process(&waves_in, None) {
            Ok(waves_out) => {
                if let Some(out) = waves_out.into_iter().next() {
                    let expected = (remaining.len() as f64 * ratio) as usize;
                    let take = expected.min(out.len());
                    output.extend_from_slice(&out[..take]);
                }
            }
            Err(e) => return Err(anyhow!("Resampling error on final chunk: {}", e)),
        }
    }

    info!("Resampled {} samples ({}Hz) -> {} samples ({}Hz)",
          samples.len(), source_rate, output.len(), target_rate);
    Ok(output)
}

/// Apply RNNoise noise suppression. Input must be at 48kHz.
pub fn apply_noise_suppression(samples_48k: &[f32]) -> Vec<f32> {
    use nnnoiseless::DenoiseState;

    let frame_size = DenoiseState::FRAME_SIZE;
    let mut denoiser = Box::new(DenoiseState::new());
    let mut output = Vec::with_capacity(samples_48k.len());
    let mut offset = 0;

    while offset + frame_size <= samples_48k.len() {
        let frame: Vec<f32> = samples_48k[offset..offset + frame_size]
            .iter()
            .map(|&s| s * 32767.0)
            .collect();

        let mut denoised = vec![0.0f32; frame_size];
        denoiser.process_frame(&mut denoised, &frame);

        for s in &denoised {
            output.push(s / 32767.0);
        }
        offset += frame_size;
    }

    if offset < samples_48k.len() {
        let remaining = &samples_48k[offset..];
        let mut frame = vec![0.0f32; frame_size];
        for (i, &s) in remaining.iter().enumerate() {
            frame[i] = s * 32767.0;
        }
        let mut denoised = vec![0.0f32; frame_size];
        denoiser.process_frame(&mut denoised, &frame);
        for s in &denoised[..remaining.len()] {
            output.push(s / 32767.0);
        }
    }

    info!("Noise suppression applied to {} samples", output.len());
    output
}
