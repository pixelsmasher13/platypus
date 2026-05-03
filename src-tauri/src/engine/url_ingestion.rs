//! URL ingestion: fetch a web page, extract the main article body, and
//! return it as both HTML (for the rich-text editor) and Markdown (for
//! structure-aware chunking down the line).
//!
//! Strategy:
//!   1. `reqwest` fetches with a Chrome User-Agent and bounded redirects so
//!      lazy bot blockers don't reject us. Same HTTP shape as the Automation
//!      Agent's `fetch_single_page` — that part is well-tuned.
//!   2. `readability` (Mozilla Readability port) identifies the actual
//!      `<article>` body, stripping nav/sidebars/ads/comments. This is the
//!      step the Automation Agent's hand-rolled tag-stripper skips.
//!   3. `htmd` converts the cleaned HTML to Markdown, preserving headings
//!      and lists. The TipTap editor renders the HTML directly; the
//!      Markdown is kept around for future structure-aware chunking.

use std::io::Cursor;
use std::time::Duration;

use anyhow::{anyhow, Result};
use log::info;
use serde::Serialize;

const FETCH_TIMEOUT_SECS: u64 = 15;
const MAX_REDIRECTS: usize = 5;
// Honest identifying UA, not Chrome impersonation. Works on SEC.gov (which
// 403s generic Chrome strings to enforce its identification policy) and on
// most other sites. Some Cloudflare-fronted sites may prefer a real browser
// string — if that becomes a real complaint, expose this in Settings.
const USER_AGENT: &str = "PlatypusNotes/0.1 (+https://platypusnotes.com)";

#[derive(Serialize, Clone)]
pub struct IngestedPage {
    /// The page's `<title>` (or the readability-derived title if better).
    pub title: String,
    /// Cleaned article HTML. Safe to feed directly into TipTap.
    pub html: String,
    /// Markdown version of the same content. Headings/lists preserved.
    pub markdown: String,
    /// The final URL after redirects — useful for "Source: ..." footers.
    pub url: String,
}

/// Fetch a URL and return its readable content. Returns an error message
/// suitable for surfacing to the user (e.g. "HTTP 403", "Page is mostly
/// JavaScript", "Network error").
pub async fn ingest_url(url_input: &str) -> Result<IngestedPage> {
    let trimmed = url_input.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("URL is empty"));
    }

    // Allow the user to paste "example.com/foo" without a scheme.
    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };

    info!("Ingesting URL: {}", normalized);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .build()
        .map_err(|e| anyhow!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get(&normalized)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.9")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| anyhow!("Network error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(anyhow!("HTTP {}", status));
    }

    if let Some(ct) = response.headers().get("content-type") {
        let ct_str = ct.to_str().unwrap_or("");
        if !ct_str.contains("text/html") && !ct_str.contains("application/xhtml") {
            return Err(anyhow!("Not an HTML page (content-type: {})", ct_str));
        }
    }

    // resp.url() is the *final* URL after redirects — readability needs this
    // to resolve relative <a href> and <img src> in the cleaned content.
    let final_url = response.url().clone();
    let html = response
        .text()
        .await
        .map_err(|e| anyhow!("Failed to read response body: {}", e))?;

    // Run on a blocking thread — readability is sync and parses HTML, which
    // can be heavy on big pages. Keep the async runtime responsive.
    let final_url_for_blocking = final_url.clone();
    let html_for_blocking = html.clone();
    let extracted = tokio::task::spawn_blocking(move || {
        let mut cursor = Cursor::new(html_for_blocking.into_bytes());
        readability::extractor::extract(&mut cursor, &final_url_for_blocking)
    })
    .await
    .map_err(|e| anyhow!("Extractor task panicked: {}", e))?
    .map_err(|e| anyhow!("Readability failed to parse page: {}", e))?;

    let cleaned_html = extracted.content;

    // Readability's text field is plain-text-with-newlines — useful for the
    // "did we actually get anything?" check below, but not for chunking.
    if extracted.text.trim().len() < 100 {
        return Err(anyhow!(
            "Page returned almost no readable text. It may be JavaScript-rendered or behind a paywall."
        ));
    }

    // HTML → Markdown so future structure-aware chunking has headings to
    // split on. htmd::convert() returns Result; on failure we fall back to
    // the raw text so the user still gets *something*.
    let markdown = htmd::convert(&cleaned_html).unwrap_or_else(|e| {
        info!("htmd conversion failed ({}), using plain text fallback", e);
        extracted.text.clone()
    });

    // readability often lifts the title from <title> already, but trim
    // common cruft like " | Site Name" suffixes when it's obvious.
    let title = clean_title(&extracted.title);

    Ok(IngestedPage {
        title,
        html: cleaned_html,
        markdown,
        url: final_url.to_string(),
    })
}

/// Strip trailing site-name suffixes from titles. Keeps the result if the
/// suffix split looks ambiguous so we don't mangle real titles that contain
/// pipes or dashes.
fn clean_title(raw: &str) -> String {
    let trimmed = raw.trim();
    // Only strip if a separator appears with reasonable substring lengths
    // on both sides — guards against eating e.g. "Bug — fix in 1.2".
    for sep in [" | ", " - ", " — ", " · "] {
        if let Some(idx) = trimmed.rfind(sep) {
            let (head, tail) = trimmed.split_at(idx);
            let tail_text = tail.trim_start_matches(sep).trim();
            if head.len() >= 12 && tail_text.len() <= 40 && !tail_text.is_empty() {
                return head.trim().to_string();
            }
        }
    }
    trimmed.to_string()
}

#[tauri::command]
pub async fn ingest_url_command(url: String) -> Result<IngestedPage, String> {
    ingest_url(&url).await.map_err(|e| e.to_string())
}
