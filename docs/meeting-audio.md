# Meeting audio and saved recordings

## Capture

The native recorder supports three source combinations, chosen with two switches in Settings > General > Meeting audio rather than per recording. The Record button shows the active one.

- **Mic + meeting audio** (both switches on; default on macOS): default input device plus the computer's audio.
- **Microphone only** (computer audio off): voice notes and in-person meetings; also the only Windows path.
- **Meeting audio only** (microphone off): capture remote speakers or a presentation without room noise.

On a Mac that has not yet allowed meeting audio, the recorder uses the microphone and an inline notice beside Record says so; the setting itself is unchanged and applies once the permission is granted.

macOS system capture uses ScreenCaptureKit on macOS 13+. Only an audio stream output is registered. No screenshots, video, MP4, meeting-platform integration, or meeting bot is used. All eligible computer audio is captured, except Platypus's own process; this is not a per-meeting-app filter. Apple documents the audio options on [SCStreamConfiguration](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration).

macOS may call the permission **Screen Recording** or **Screen & System Audio Recording**, depending on OS version. It has no in-app Allow button: the grant happens in System Settings and takes effect after Platypus relaunches. Platypus therefore asks during onboarding on macOS, shows an inline notice beside Record whenever the permission is missing (with Allow and Restart actions), and the meeting-detected banner and popup offer to allow meeting audio instead of starting a recording that would fail. A failed requested source still fails startup with an actionable error; the recorder never silently substitutes microphone-only capture. Microphone-only remains usable without this permission and on older macOS releases.

The microphone uses its supported native sample rate and channel count, then downmixes to mono. System audio is downmixed to mono at 48 kHz. Timestamped packets go to a bounded worker queue, off the audio callbacks. A streaming sinc resampler aligns each source to a common 48 kHz timeline with a 400 ms buffer for callback timing. The saved source channels remain separate. The combined track reserves headroom when both sources are selected; single-source recording retains its level. For local **Mic + meeting audio** sessions, Whisper decodes the two original channels separately; single-source sessions and cloud transcription keep the existing path. No noise suppression is applied to the direct digital feed.

Microphone loss or native stream errors stop capture and preserve available audio. Missing meeting packets are shown separately from a connected, quiet stream. Large processing stalls/sleep interrupt the recording instead of allocating a long silent gap. Source changes are not automatically reconnected; stop/restart recording to adopt a changed microphone. Headphones avoid remote speech entering both the digital stream and the microphone. Acoustic echo cancellation and per-participant speaker identification are not implemented.

## Basic speaker labels

Local **Mic + meeting audio** transcripts show **You** (microphone) and **Remote participants** (system audio), with elapsed times. Each channel keeps its own chunk boundaries and short finalized-text context. The installed Silero detector skips speech-free source chunks without trimming speech inside accepted chunks; punctuation-only output creates no turn. One Whisper model decodes serially; final chunks take priority over speculative drafts. Turns are sorted by capture time, including when an overlapping reply finishes decoding first. Times mark utterance chunks, not precise word boundaries.

Use **Edit labels** inside the transcript to rename either side. That updates all turns from the same source in that transcript, saves with the note, and can be undone. Edited labels are included when organizing notes or using the note as AI context. Labeling does not require retaining audio.

This identifies audio sources, not individual voices. People in the same room share the microphone label; everyone on the call shares the remote label. System audio may include other apps. Headphones avoid duplicate speech caused by speaker audio entering the microphone. Existing plain transcripts are unchanged; retranscribing a retained two-channel recording creates a labeled comparison. Cloud transcription currently remains unlabeled.

## Saved files

Under the Tauri app data directory:

```text
recordings/<recording-id>/
  recording.json          # note association, source, model, duration, warnings, original transcript
  audio.wav               # mono 48 kHz / 16-bit playback and transcription mix
  sources.wav             # stereo 48 kHz / 16-bit: microphone left, meeting audio right
  source-transcript.json  # local source turns and capture times, retained without audio
  transcript-<time>.json   # optional local retranscription comparisons
```

The source export is a common-rate, downmixed archive, not a bit-for-bit copy of each device's native buffers. Audio is written continuously and WAV headers flushed every second. Metadata is atomically replaced. Interrupted recordings remain discoverable; their duration is read from the last flushed WAV header. New sessions snapshot **Settings → Keep recordings** at capture start (off by default). After successful local or API transcription, the transcript is persisted before temporary audio is removed. Empty results, capture warnings, and failed/interrupted sessions retain audio for recovery. Existing archives without a retention field default to keeping audio. Nothing is uploaded in local mode. Retained recordings use roughly 1 GB per hour for both WAV files. Transcript metadata survives audio cleanup.

**Play recording** appears inside a transcript only when its audio exists. **Settings → Manage recordings** lists archives and recovery transcripts, including sessions that failed before a new note could be created. If navigation unmounts the recording editor, the sidebar exposes **Stop & save transcript**; its transcript is recoverable from the library. Original transcripts can be copied from Settings into a note; regenerated transcripts are saved as separate comparisons. Local retranscriptions run independently of the modal and save separate version files.

The existing OpenAI Whisper upload size limit still applies to API transcription; long sessions can be saved/exported or retranscribed locally.

## Verification

Automated checks cover source timing across silence/late packets, streaming resampling with different callback sizes, end-of-speech preservation, separate-channel WAV output, metadata persistence, and note filtering. Frontend and native binary builds check the React/IPC and Objective-C/Rust integration. A browser fixture checks source controls, audio-player loading, original-versus-new transcript preview, insertion, export dispatch, and disconnected-source warnings.

These checks do not establish real-call quality or exercise the macOS permission dialog. Before considering live-call validation complete, run the built app and:

1. Grant its macOS capture permission and keep both Meeting audio switches on in Settings.
2. With headphones, speak a short sentence while another participant speaks a different sentence. Confirm both meters respond and both sentences reach the final transcript.
3. Replay/export the recording. Verify the left source contains the microphone and the right contains the remote participant. Compare their timing in an audio editor.
4. Repeat with each single-source mode, then deny system capture and confirm the error offers microphone-only as an explicit alternative.
5. Stop mid-sentence, navigate to another note during capture, and disconnect a microphone. Confirm saved audio is accessible and a stop/recovery control remains available.
6. Choose another installed Whisper model and retranscribe the same recording. Close the panel during transcription; reopen it afterward and choose the saved comparison. The original note and transcript should be unchanged.
