# Presentation quality check, 25 September 2026

The quality target was a user-supplied two-slide Alphabet Q4/FY2025 brief generated with Luna. It combined results, business growth, capital spending and cash flow in substantive slides with charts and metric comparisons.

The live tests used the full [public Alphabet earnings release](https://s206.q4cdn.com/479360582/files/doc_financials/2025/q4/2025q4-alphabet-earnings-release.pdf), extracted with `pdftotext -layout`. No private saved note was transmitted. This is the earnings release, not an earnings-call transcript.

| Run | Model / effort | Time | Result |
| --- | --- | --- | --- |
| Previous app prompt and default eight-slide brief | GPT-6 Astra / medium | 41.7 seconds | Eight slides, 3–4 bullets on most content slides, 372 visible words. Exported through the actual Platypus PowerPoint renderer. All slides passed layout validation. No charts or tables. |
| Direct PowerPoint experiment, two-slide brief | GPT-6 Astra / medium | 131.2 seconds | Two substantive slides, metric groups, two native editable charts, visible qualifications and separate speaker notes. |
| Implemented Rust workflow, two-slide brief | GPT-6 Astra / medium | 138 seconds | Two substantive slides, a native editable comparison table and CapEx chart, Cloud operating margins, cash flow, and earnings qualifications. Returned file passed PowerPoint validation, rendered successfully, and both slides were visually inspected. |

This does not reproduce the user's exact historical “slide deck 2”: that request's brief and response are unavailable. The fresh baseline had more substance than two lines per slide, but it exposed the restrictive presentation format. Both the brief and generation workflow changed in the direct tests; this is a product workflow comparison, not an isolated model benchmark or a guarantee for every source.

The designed workflow sends the full source and brief to OpenAI Responses with Code Interpreter. The model creates the PowerPoint itself. Platypus reads the final file citation, downloads the file, validates it and returns the original bytes for export. It does not squeeze the output back into the title/bullets schema. Model and effort are explicit in the dialog; other providers retain Simple slides.

## Repeat a live production check

Use only a source authorized for transmission to OpenAI. This incurs normal model and Code Interpreter charges. From `src-tauri`, with `OPENAI_API_KEY` already set:

```sh
printf '%s' "$OPENAI_API_KEY" | cargo run --example presentation_quality_check -- /path/to/source.txt /path/to/output.pptx gpt-6-astra medium 2
```

The harness uses the same request builder and network/download code as the app. Render and inspect the result; a passing JSON or ZIP test alone does not demonstrate presentation quality. Compare source coverage, numeric accuracy, meaningful chart labels, qualifications, readability and clipping.

The browser integration check used a recorded real PowerPoint with mocked Tauri IPC to verify failure/retry, brief preservation, model switching, two-slide selection, exact byte export and the existing simple slide editor. That UI check did not generate another model response. The production API check above was live.

Known tradeoff: designed decks are reviewed and edited in PowerPoint or Keynote; Platypus's built-in slide editor applies only to Simple slides. Generation takes minutes and uses a remote tool session in addition to model tokens.

Generation now runs outside the note editor, with bottom-right progress and completion notifications. The backend saves each completed deck in the local presentations library before reporting success. Designed decks retain their original PowerPoint bytes; simple decks retain editable slide data. Persistence and background-job checks cover reloading saved versions, retaining source identity after navigation, duplicate submissions, failure/retry, and saving edits without overwriting another version. In-progress jobs require the app to remain open; completed decks survive app restarts.
