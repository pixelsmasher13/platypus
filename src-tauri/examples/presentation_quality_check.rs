//! Manual live quality check using the exact production presentation workflow.
//! API key is read from stdin; source and output paths are explicit arguments.
use platypus_notes::presentation::{create_designed_presentation, presentation_request};
use std::io::Read;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 6 {
        return Err("Usage: presentation_quality_check SOURCE.txt OUTPUT.pptx MODEL EFFORT SLIDE_COUNT (API key on stdin)".into());
    }
    let source = std::fs::read_to_string(&args[1])?;
    let mut key = String::new();
    std::io::stdin().read_to_string(&mut key)?;
    if key.trim().is_empty() {
        return Err("Provide an OpenAI API key on stdin.".into());
    }
    let request = presentation_request(
        &source,
        "Audience: Readers familiar with the topic\nPurpose: Brief the team",
        args[5].parse()?,
        &args[3],
        Some(&args[4]),
    )?;
    let deck = create_designed_presentation(key.trim(), request).await?;
    std::fs::write(&args[2], &deck.bytes)?;
    println!(
        "{} slides; model {}; effort {}; {} seconds; saved {}",
        deck.slide_count,
        deck.model,
        deck.effort.as_deref().unwrap_or("default"),
        deck.elapsed_seconds,
        args[2]
    );
    Ok(())
}
