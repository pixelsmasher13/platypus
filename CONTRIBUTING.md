# Contributing

Thanks for your interest. Platypus is in active development; small, focused PRs are easiest to land.

## Getting started

1. Follow the build requirements in the [README](README.md).
2. Run `npm run tauri dev` to launch the app in development mode.
3. Frontend hot-reloads automatically; backend changes require a restart.

## Checks

```sh
npm run build
npm run test:notes
npm run test:core
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### Transcription quality

With an installed Whisper model and a mono 16kHz, 16-bit PCM WAV fixture:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example transcription_quality_check -- /path/to/fixture.wav large-v3
```

This exercises speech followed by silence, quiet speech, silence alone, and deliberately repeated speech. It uses only local audio and models. Substitute `large-v3-turbo` or `distil-large-v3.5` to compare the other supported models. Append `--drafts` to exercise provisional decoding before the final pass.

Append `--context ""` to exercise the app's short finalized history, including draft cancellation with `--drafts`. Nonempty `--context "Names and terminology"` additionally tests experimental vocabulary hints; the app does not enable those hints. To compare no prompt, history alone, and history with supplied hints on identical chunks of a mono PCM16 recording (any sample rate):

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example transcription_context_check -- /path/to/recording.wav large-v3 "Names and terminology"
```

The comparison prints JSON with each chunk's prompt and output, checks that context does not produce speech on silence, and leaves recordings unchanged. Supplied hints are an explicit experimental input; do not count corrected spellings as automatic improvements unless those hints were actually present in the note.

The current 16-word/120-character history limit was checked against a 69-second earnings-call recording using Large v3 and identical audio chunks. It removed an inserted clause while retaining the introduction and final passage. A longer 64-word history lost the final passage; vocabulary hints corrected an acronym but dropped the operator's introduction. That is why only short finalized history is enabled. This is a regression fixture, not a general accuracy benchmark; names and clipped final words remain unresolved.

### Presentation quality

The [presentation quality guide](docs/presentation-quality.md) documents the live comparison and a CLI harness that uses the same generation and download code as the app. Inspect the rendered slides as well as the returned file: passing a format test alone does not demonstrate a useful presentation.

## Project structure

```
src/                       React + TypeScript frontend
  screens/                 Top-level screens (ChatScreen, etc.)
  features/                Feature modules (Projects, etc.)
  Providers/               Global context providers (settings, etc.)

src-tauri/                 Rust backend
  src/engine/              Audio, transcription, vector, AI engines
  src/repository/          SQLite data access
  src/configuration/       Settings, app state, DB init
  src/permissions/         macOS permission prompts

website/                   Marketing site (platypusnotes.com)
scripts/                   Build and release scripts
```

## Pull requests

- One change per PR. Keep diffs focused.
- For non-trivial changes, open an issue first to discuss approach.
- Test the feature in the running app before submitting — type checks and `cargo check` verify code correctness, not feature correctness.
- Commit messages should explain the *why*, not just the *what*.

## Reporting issues

Please include:

- OS and version (for macOS, the chip — M1/M2/M3/Intel)
- Whether you're using local or OpenAI transcription
- Tauri logs (Settings → there's no log viewer yet, but logs go to stdout when running `npm run tauri dev`)
- Steps to reproduce

## Areas where help is especially welcome

- **Speaker diarization** — currently unsupported; would need either a cloud provider integration (Deepgram / AssemblyAI) or a local pipeline using a speaker-embedding ONNX model
- **Windows release builds + CI** — macOS signed builds are scripted; Windows side is unfinished
- **Linux support** — Tauri supports it but we haven't tested
- **Transcription accuracy testing** across accents, noise conditions, and chunk lengths
- **Additional LLM providers** — anything OpenAI-compatible should drop in cleanly

## Code style

- **Frontend**: TypeScript strict mode, prefer functional components, use existing Chakra primitives over custom CSS
- **Backend**: standard `rustfmt` and `clippy`; pattern-match on errors rather than `unwrap` outside main and tests
- **No new dependencies without justification** — Rust compile times are already long, every additional crate makes it worse

## License

By contributing you agree your contributions will be licensed under the MIT license, the same license that covers the project.
