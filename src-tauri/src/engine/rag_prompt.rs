//! Shared RAG prompt construction.
//!
//! All chat engines (Claude, OpenAI, Gemini, local) used to duplicate the same
//! "format chunks + glue them onto a system prompt" code. The numbering in the
//! prompt also drifted from the order of source chips emitted to the UI, which
//! made inline `[n]` citations impossible.
//!
//! This module owns both pieces:
//!   - `build_grounded_context` returns the numbered context block AND the
//!     `ChunkSource`s in the same order, so `[n]` in the LLM's reply maps to
//!     `sources[n-1]` on the frontend.
//!   - `grounded_system_prompt` produces the tightened, citation-required
//!     system prompt shared by every provider.
//!
//! Note: callers should still emit the returned `Vec<ChunkSource>` to the
//! `llm_sources` event so the frontend can resolve `[n]` clicks back to chunks.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::repository::chunk_repository::{
    get_chunk_sources, get_chunks_by_ids, ChunkSource,
};

/// Build a numbered context block aligned with the citation chips shown to the user.
///
/// `scored_chunk_ids` is the raw HNSW search result `(chunk_id, distance)`. The
/// returned `sources` are sorted by score descending (best first), and the
/// returned context string numbers chunks `[1]..[n]` in that same order. This
/// alignment is what lets the LLM's inline `[n]` map cleanly back to a
/// `ChunkSource` on the frontend.
pub fn build_grounded_context(
    conn: &Connection,
    scored_chunk_ids: &[(i64, f32)],
) -> Result<(String, Vec<ChunkSource>), rusqlite::Error> {
    if scored_chunk_ids.is_empty() {
        return Ok((String::new(), vec![]));
    }

    // Sources come back sorted by score descending — that defines the [n] order.
    let sources = get_chunk_sources(conn, scored_chunk_ids)?;
    if sources.is_empty() {
        return Ok((String::new(), vec![]));
    }

    let chunk_ids: Vec<i64> = sources.iter().map(|s| s.chunk_id).collect();
    let chunks = get_chunks_by_ids(conn, &chunk_ids)?;

    // get_chunks_by_ids returns rows in (document_id, chunk_index) order, not
    // score order. Build a lookup so we can re-emit them in the score order
    // that matches `sources`.
    let text_by_id: HashMap<i64, &str> = chunks
        .iter()
        .map(|c| (c.id, c.chunk_text.as_str()))
        .collect();

    let mut context = String::new();
    for (i, source) in sources.iter().enumerate() {
        let Some(text) = text_by_id.get(&source.chunk_id) else { continue };
        context.push_str(&format!(
            "[{n}] (from \"{doc}\"):\n{text}\n\n",
            n = i + 1,
            doc = source.document_name,
            text = text,
        ));
    }

    Ok((context, sources))
}

/// Tightened, source-grounded system prompt that requires inline `[n]` citations.
///
/// `persona` is the per-provider intro line (different wording across Claude,
/// OpenAI, Gemini, Ollama). `numbered_context` is the output of
/// `build_grounded_context`. When the context is empty, only the persona is
/// returned so non-RAG conversations are unaffected.
pub fn grounded_system_prompt(persona: &str, numbered_context: &str) -> String {
    if numbered_context.is_empty() {
        return persona.to_string();
    }

    format!(
        "{persona}\n\n\
You are answering using ONLY the numbered sources below. Follow these rules:\n\n\
1. Every factual claim in your answer MUST be followed by a citation in square \
brackets: `[1]`, or `[1][3]` when multiple sources support the same claim. Place \
the citation at the end of the sentence or clause that the source supports.\n\
2. Use ONLY information from the numbered sources. Do NOT use prior knowledge \
to fill gaps and do NOT speculate.\n\
3. If the sources don't contain enough information to answer, say so plainly: \
\"I don't see that in your sources.\" Do not invent an answer.\n\
4. When a source supports a claim verbatim, prefer a short direct quote in \
quotation marks followed by the citation.\n\
5. Do NOT add a list of sources at the end of your answer — the inline \
citations are the only references the user needs.\n\n\
=== SOURCES ===\n\
{numbered_context}\
=== END SOURCES ==="
    )
}
