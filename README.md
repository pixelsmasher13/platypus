# Platypus Notes

Lightning-fast note taker, meeting transcriber, and knowledge manager. The open-source, private knowledge organizer with built-in AI.

- **Voice notes** — Record and automatically transcribe your meetings and voice notes
- **Note editor** — Rich document editor with formatting, auto-save, and AI-powered cleanup
- **Project organization** — Group notes and docs by project for focused retrieval
- **Paste & go** — Copy-paste any document and it instantly becomes part of your knowledge base
- **Local embeddings** — Fast vector search across all your documents, no cloud needed
- **Chat with your knowledge** — Ask questions using Claude, OpenAI, Gemini, or local models
- **Meeting detection** — Automatically detects Zoom and Teams meetings and prompts you to record
- **100% private** — Everything stored locally on your device


<video src="https://github.com/user-attachments/assets/e034862a-0def-4b75-a133-d850d191d82a" autoplay loop muted playsinline></video>


## Voice Transcription

Two modes, controlled via a toggle in Settings (or during onboarding):

| | OpenAI API (default) | Local Whisper |
|---|---|---|
| **How it works** | Records WAV, uploads to OpenAI Whisper API | On-device transcription via whisper.cpp |
| **Model** | OpenAI Whisper | User-selectable (see below) |
| **Requires** | OpenAI API key | Nothing (model auto-downloaded on first use) |
| **Real-time** | No (transcribes after recording) | Yes (live transcript streams during recording) |
| **Offline** | No | Yes |
| **Hardware accel** | N/A | Metal (macOS), CPU fallback |

**Local models** (selectable in Settings): Distil Large v3.5 (~1.5GB, default), Large v3 Turbo (~1.6GB), Large v3 (~3.1GB, best quality).

## Requirements

- [Node 18+](https://nodejs.org/en/download/package-manager) (recommended via [nvm](https://github.com/nvm-sh/nvm))
- [Rust](https://www.rust-lang.org/tools/install)
- **cmake** (required by whisper-rs-sys to compile whisper.cpp) — `brew install cmake` on macOS

## How to run

```
npm install
npm run tauri dev
```

If you have dependency issues, try deleting `package-lock.json` and running `npm install` again.

Add your API keys in the app Settings before use.

## How to build

```
npm install
npm run tauri build
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v1 (1.5.2) |
| Backend | Rust |
| Frontend | React + TypeScript + Vite |
| UI | Chakra UI + styled-components |
| Editor | TipTap |
| AI providers | Claude, OpenAI, Gemini, Ollama |
| Transcription | whisper-rs v0.16 (local) / OpenAI Whisper API (cloud) |
| Audio | CPAL (recording), nnnoiseless (denoising), rubato (resampling) |
| Database | SQLite (rusqlite) |
| Vector search | HNSW (hnswlib-rs) |
