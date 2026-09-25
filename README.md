<p align="center">
  <img src="docs/images/banner.svg" alt="Platypus — notes, meetings, and knowledge, on your machine" width="100%"/>
</p>

# Platypus Notes

An open-source desktop workspace for notes, meetings, and the things you make from them. Capture a conversation, turn rough notes into something useful, ask questions across your documents, and build a presentation with actual substance.

Your notes live on your machine in SQLite. Local Whisper transcription works offline after the model downloads; connected AI features use your chosen providers and API keys.

[**Download for macOS**](https://the-platypus-app.s3.amazonaws.com/PlatypusNotes-latest.dmg) · [platypusnotes.com](https://platypusnotes.com) · MIT license

<video src="https://github.com/user-attachments/assets/e034862a-0def-4b75-a133-d850d191d82a" autoplay loop muted playsinline></video>

## The highlights

- **Live meeting transcription:** see revisable drafts while you speak, followed by a more accurate final pass at pauses and Stop. Zoom and Teams detection helps you start capturing calls.
- **Meeting notes built around your priorities:** combine your rough notes with the transcript to bring out the reasoning, decisions, examples, and follow-ups that matter.
- **Cleanup you can review:** tidy, shorten, or organize a note; compare with the original, edit the draft, and apply with one-step undo.
- **Answers with sources:** chat across a project's notes and documents, with clickable citations and suggested questions to get started.
- **Presentations with substance:** generate PowerPoints with editable charts, tables, and layouts suited to the source. Generation runs in the background, saves automatically, and lets you know when the deck is ready.
- **Your choice of model and effort:** Claude Sonnet 5, GPT-6 Astra/Sol/Luna, Gemini, and local Ollama, with saved reasoning effort for supported models.
- **A cleaner note library:** project grouping, content search, keyboard browsing, and a compact sort menu.

## From a meeting to useful notes

1. **Record and jot down what matters.** Local transcription shows provisional text as the conversation unfolds. Keep your own shorthand, questions, and priorities alongside it.
2. **Choose Organize meeting notes.** The notebook-and-pencil button opens this workflow when the note contains a transcript. It is also available under **Generate from this note**.
3. **Review the sources.** Rough notes and transcript are separate inputs. New recordings keep their transcript identity across saves; you can paste a transcript into an older note's organization dialog.
4. **Review and edit the draft.** Your rough notes guide emphasis; the transcript supplies supporting detail. The prompt distinguishes suggestions from commitments, retains conditions and disagreement, and includes owners or deadlines only when supported.
5. **Save a separate note.** The original stays intact, and the organized note keeps its transcript attached for reference.

Transcript-only and notes-only inputs also work. Decisions, next steps, and open questions appear when the source supports them, without forcing every meeting into the same template.

## Clean up note

Use the notebook-and-pencil button on an ordinary note to clean up the text currently in the editor, including unsaved edits.

| Style | What it does |
| --- | --- |
| **Tidy up** | Smooth rough wording, false starts, and verbal clutter while keeping your voice and detail. |
| **Make concise** | Trim wordiness and redundant points while retaining distinct facts and follow-ups. |
| **Organize** | Group related ideas and bring out decisions and next steps already present in the note. |

Switch between **Cleaned up**, **Original**, and **Edit draft** before applying. Cleanup focuses on preserving numbers, names, uncertainty, negation, and task status. Applying the result is one undoable edit; failed requests leave the original available.

## Ask your documents

Bring together notes, PDFs, DOCX files, plain text, Markdown, and articles imported from a URL. Group them into projects and ask questions across the project's material.

- **Source-backed answers:** inline `[n]` citations open the supporting passage.
- **Context on follow-ups:** retrieval runs for each question, and each answer keeps its own citations.
- **Suggested questions:** projects offer starting points based on their content.
- **Semantic retrieval:** optional per-project vector search finds relevant passages beyond exact keyword matches. Documents are chunked and embedded when saved with vectorization enabled.

## Turn a note into a presentation

Open **Generate from this note → Slide deck**. Choose the model, effort, audience, purpose, and what to emphasize. Target lengths are **2, 5, 8, 10, or 15 slides**; short sources may produce fewer to avoid filler. Two-slide briefs use substantive slides without a separate cover or closing page.

### Generate while you keep working

1. Click **Generate deck**. The dialog closes immediately.
2. A bottom-right status card says the deck is generating. Switch notes, keep writing, or dismiss the card; the job keeps running.
3. When generation finishes, the deck is saved automatically and a new notification offers **Open deck**.

If generation fails, **Retry** reuses the same source and brief. The app prevents duplicate submissions while that note already has a deck running. Keep Platypus open until generation finishes; unfinished jobs do not resume after quitting.

### Find your saved decks

Open **Presentations** in the app header, or **Generate → Saved presentations** from a note. The library shows running jobs and completed decks, with each deck's source note, creation time, and slide count. Completed decks remain available after restarting the app, and generating again creates a separate version.

- **Designed decks** are saved as `.pptx` files. Choose **Open PowerPoint** to open the saved file in your presentation app, or **Save a copy** to export it elsewhere. The deck's saved file path is shown in its details.
- **Simple decks** are saved as editable drafts. Reopen them to change slide text, order, layouts, or speaker notes. Changes save when you close the editor or export; if saving fails, the editor stays open so you can retry.

Files and deck metadata live in the `presentations` folder inside Platypus's application data directory.

### Choose a presentation style

| | Designed PowerPoint | Simple slides |
| --- | --- | --- |
| **Generation** | The model creates the PowerPoint file directly from the source and brief. | The model writes structured slides that Platypus lays out. |
| **Content and layout** | Charts, comparison tables, metrics, diagrams, and supporting evidence where useful. | Titles, key points, steps, takeaways, and speaker notes. |
| **Review and editing** | Save and open in PowerPoint or Keynote. Text and native chart/table elements remain editable. | Preview, edit text and notes, reorder, add, and delete slides inside Platypus. |
| **Export** | PowerPoint (`.pptx`). | PowerPoint or Marp Markdown, with layout checks before PowerPoint export. |
| **Availability** | Default for OpenAI models; takes a few minutes. | Available across providers; usually faster. |

Designed PowerPoint keeps the core evidence on the slides and uses speaker notes for supporting context. It uses OpenAI Responses with Code Interpreter; model and tool usage are billed to your configured API key.

**Tested with a real source:** using Alphabet's full Q4/FY2025 earnings release, Astra at medium effort produced a two-slide deck with an editable business comparison table, CapEx chart, Cloud margins, cash flow, and visible earnings qualifications in **2 minutes 18 seconds**. The earlier eight-slide workflow produced a bullet-based deck in **42 seconds**. These are individual runs with different briefs and workflows, not a general speed or quality guarantee. See the [comparison and reproducible quality check](docs/presentation-quality.md).

The same **Generate** menu also offers a **follow-up email draft** and an **audio podcast**. Podcasts support a chosen voice, focus, and target length through ElevenLabs.

## Models and reasoning effort

| Provider | Built-in choices |
| --- | --- |
| **Claude** | Sonnet 5 (default), Haiku 4.5, Opus 4.6 |
| **OpenAI** | GPT-6 Astra (default), Sol, Luna |
| **Google** | Gemini 3 Pro preview |
| **Local** | Ollama, with Llama 3.3 70B as the default |

Configure providers and API keys in **Settings**. Custom Claude and OpenAI model IDs remain available, and existing explicitly configured IDs stay pinned.

The effort selector appears alongside the chat model, in Settings, and in the slide generator. It remembers a separate level for each supported model across chat and generation. Available levels follow the model's capabilities, from **Off/Low** through **Max**. Sonnet 5, Sol, and Luna initially use Off; Astra uses Low. Higher effort gives the model more time to reason, and supported Claude models use adaptive thinking when effort is enabled.

Local note editing and local transcription need no API key. Cloud chat, generation, API transcription, and ElevenLabs audio use their connected services; semantic indexing also makes embedding requests when enabled.

## Find and organize notes

Use the rich-text editor, group notes into projects, and import several documents at once. URL imports extract the article and retain a source link. The library searches note titles, project names, and note content, with content matches labeled in the results.

| Action | Shortcut or control |
| --- | --- |
| Focus note search | `⌘/Ctrl + Shift + F` |
| Move from search into results | `↓` |
| Browse while the note list has focus | `↑` / `↓`, or `Home` / `End` |
| Clear search | `Esc` while searching |
| Sort notes | Sort icon → newest, oldest, or title |

Browsing keeps keyboard focus in the list while displaying the selected note, so arrow keys continue through the results. The sort choice is remembered on this device.

## Voice transcription

Two modes, switchable in Settings.

**Local Whisper (default)** — on-device transcription via whisper.cpp.

- Revisable live drafts are requested about every two seconds of new speech (display timing depends on local inference speed). Drafts use a fast decode of the current utterance and are labeled “Draft · may change.”
- The quality pass replaces drafts at pauses or Stop, with a 20-second maximum chunk for continuous speech. Only quality-pass text is saved; Stop cancels any unfinished draft.
- Near-silence is skipped; utterances retain a short audio margin, and Stop waits for the final words to finish decoding
- Deterministic beam decoding; uses the existing `ggml-silero-v5.1.2.bin` speech detector when installed in the models directory (otherwise falls back to the conservative audio gate and Whisper's no-speech detection)
- Transcript wording is preserved, including intentional repetition; no phrase blacklist or automatic rewriting
- Works offline, no API key required
- Hardware-accelerated via Metal on macOS, CPU fallback elsewhere
- Models (selectable in Settings): Large v3 (~3.1GB, default, best quality), Large v3 Turbo (~1.6GB), Distil Large v3.5 (~1.5GB, fastest)
- Model auto-downloads on first use

**OpenAI API** — records WAV, uploads to OpenAI's Whisper endpoint.

- Requires an OpenAI API key
- Transcribes after recording finishes (not real-time)

## Tech stack

| Layer            | Technology                                                                        |
| ---------------- | --------------------------------------------------------------------------------- |
| Desktop shell    | Tauri v1 (1.5.2)                                                                  |
| Backend          | Rust                                                                              |
| Frontend         | React + TypeScript + Vite                                                         |
| UI               | Chakra UI + styled-components                                                     |
| Editor           | TipTap                                                                            |
| AI providers     | Claude, OpenAI, Gemini, Ollama                                                    |
| Transcription    | whisper-rs v0.16 (local) / OpenAI Whisper API (cloud)                             |
| Audio            | CPAL (recording), nnnoiseless (denoising), rubato (resampling)                    |
| Database         | SQLite (rusqlite)                                                                 |
| Vector search    | HNSW (hnswlib-rs)                                                                 |
| Presentations    | OpenAI Responses + Code Interpreter (designed decks); PptxGenJS (simple decks)      |

## Build from source

### Requirements

- Node 18+ (recommended via [nvm](https://github.com/nvm-sh/nvm))
- Yarn available on your PATH — the current Tauri hooks run `yarn start` and `yarn build`
- [Rust](https://www.rust-lang.org/tools/install)
- **cmake** — required by `whisper-rs-sys` to compile whisper.cpp
  - macOS: `brew install cmake`
  - Windows: `winget install Kitware.CMake`
- **LLVM / libclang** (Windows only — required by `bindgen` when building `whisper-rs-sys`; macOS ships this via Xcode Command Line Tools)
  - `winget install LLVM.LLVM`
  - Then set `LIBCLANG_PATH` so `bindgen` can find `libclang.dll`:
    ```
    setx LIBCLANG_PATH "C:\Program Files\LLVM\bin"
    ```
    Open a new terminal afterward so the env var is picked up.

### Run in dev

```bash
npm install
npm run tauri dev
```

Add your provider keys in Settings for cloud AI features, or start with local notes and Whisper transcription. The first local recording downloads the selected Whisper model. When changing Rust commands, restart the Tauri dev process to load the new backend.

### Build a release

```bash
npm install
npm run tauri build
```

For a signed + notarized macOS build that uploads to your S3 bucket, see [`scripts/build-mac.sh`](scripts/build-mac.sh) — requires Apple Developer credentials in `.env.build`.

## Architecture notes

A few of the less-obvious decisions:

- **Audio pipeline**: CPAL capture → energy-based VAD on raw samples → nnnoiseless denoising at 48kHz → rubato resample to 16kHz → whisper.cpp via [whisper-rs](https://github.com/tazz4843/whisper-rs). VAD runs *before* denoise because RNNoise crushes signal amplitude ~100x and every chunk would otherwise look silent.
- **Meeting detection**: Zoom is detected by presence of the `CptHost` process; Teams by CPU usage on its `audio.mojom.AudioService` sub-process. No Zoom/Teams API access required.
- **Vector search**: per-project HNSW indices ([hnswlib-rs](https://github.com/jean-pierreBoth/hnswlib-rs)); documents chunked and embedded on save when vectorization is enabled.
- **Grounded chat with inline citations**: retrieved chunks are numbered `[1]..[n]` in the system prompt, the LLM is instructed to cite every claim and refuse to invent answers, and the same numbering is emitted to the UI so each `[n]` in the response is a clickable chip that opens the supporting passage.
- **Meeting sources**: recordings use a dedicated TipTap transcript node, persisted in HTML. Meeting note organization receives rough notes and transcript separately, so personal priorities can guide synthesis without losing the source.
- **Presentation generation**: app-level jobs outlive the originating note editor. Designed decks use the full source and brief in a Responses request; the backend downloads, validates, and saves the returned PowerPoint before reporting completion. Metadata is published after the file is saved. Simple drafts are persisted as structured slides and share a layout model between preview and PowerPoint export.

## Development checks

```sh
npm run build
npm run test:notes
npm run test:core
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### Check transcription quality locally

With an installed Whisper model and a mono 16kHz, 16-bit PCM WAV fixture:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example transcription_quality_check -- /path/to/fixture.wav large-v3
```

This exercises speech followed by silence, quiet speech, silence alone, and deliberately repeated speech. It uses only local audio and models. Substitute `large-v3-turbo` or `distil-large-v3.5` to compare the other supported models. Append `--drafts` to exercise provisional decoding before the final pass.

### Check presentation quality with a live model

The [presentation quality guide](docs/presentation-quality.md) documents the live comparison and a CLI harness that uses the same generation and download code as the app. Inspect the rendered slides as well as the returned file: passing a format test alone does not demonstrate a useful presentation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgments

Platypus stands on the shoulders of:

- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and [whisper-rs](https://github.com/tazz4843/whisper-rs) — local speech-to-text
- [Distil-Whisper](https://huggingface.co/distil-whisper) by HuggingFace — the distilled Whisper variants
- [nnnoiseless](https://github.com/jneem/nnnoiseless) — pure-Rust port of Mozilla's RNNoise
- [rubato](https://github.com/HEnquist/rubato) — sample-rate conversion
- [hnswlib-rs](https://github.com/jean-pierreBoth/hnswlib-rs) — HNSW vector index

## License

MIT.
