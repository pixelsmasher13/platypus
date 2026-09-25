use anyhow::{Result, anyhow};
use log::info;

/// Resample audio from source_rate to target_rate using rubato
pub fn resample(samples: &[f32], source_rate: u32, target_rate: u32) -> Result<Vec<f32>> {
    if source_rate == 0 || target_rate == 0 { return Err(anyhow!("Sample rates must be positive")); }
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

    let chunk_size = 1024;
    let mut resampler = SincFixedIn::<f32>::new(
        ratio,
        2.0,
        params,
        chunk_size,
        1,
    ).map_err(|e| anyhow!("Failed to create resampler: {}", e))?;

    let expected = (samples.len() as f64 * ratio).round() as usize;
    let mut output = Vec::with_capacity(expected + 1024);
    for chunk in samples.chunks(chunk_size) {
        let waves = vec![chunk.to_vec()];
        let resampled = resampler.process_partial(Some(&waves), None)
            .map_err(|e| anyhow!("Resampling error: {}", e))?;
        output.extend_from_slice(&resampled[0]);
    }
    // SincFixedIn emits fewer samples until its lookahead is filled. Flush
    // that tail so the final consonant is retained; its output is time-aligned.
    while output.len() < expected {
        let resampled = resampler.process_partial::<Vec<f32>>(None, None)
            .map_err(|e| anyhow!("Resampling flush error: {}", e))?;
        output.extend_from_slice(&resampled[0]);
    }
    output.truncate(expected);

    info!("Resampled {} samples ({}Hz) -> {} samples ({}Hz)",
          samples.len(), source_rate, output.len(), target_rate);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resampling_preserves_duration_and_final_audio() {
        for rate in [44100, 48000] {
            for len in [137, 1024, 17003] {
                let mut input = vec![0.0; len];
                for i in len - 64..len { input[i] = (i as f32 * 0.07).sin() * 0.3; }
                let output = resample(&input, rate, 16000).unwrap();
                assert_eq!(output.len(), (len as f64 * 16000.0 / rate as f64).round() as usize);
                let energy = output.iter().rev().take(30).map(|s| s * s).sum::<f32>();
                assert!(energy > 0.001, "rate={rate} len={len} tail_energy={energy}");
            }
        }
        assert!(resample(&[0.0], 0, 16000).is_err());
    }
}
