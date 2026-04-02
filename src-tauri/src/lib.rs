pub mod entity;

use scraper::{Html, Selector};

/// Utility function to convert HTML to plain text using industrial-strength parser
pub fn html_to_plain_text(html: &str) -> String {
    // Safety check for empty or invalid input
    if html.is_empty() {
        return String::new();
    }

    // Parse HTML with scraper (built on Mozilla's html5ever)
    let document = Html::parse_document(html);
    
    // Extract text content while preserving structure
    extract_text_with_structure(&document)
}

fn extract_text_with_structure(document: &Html) -> String {
    let mut result = String::new();
    
    // Process the body, or fall back to the entire document
    let main_selector = Selector::parse("body").unwrap();
    let root_element = document.select(&main_selector).next()
        .unwrap_or_else(|| document.root_element());
    
    extract_element_text(root_element, &mut result, 0);
    
    // Clean up the result
    clean_extracted_text(&result)
}

fn extract_element_text(element: scraper::ElementRef, result: &mut String, depth: usize) {
    use scraper::Node;
    
    // Prevent infinite recursion in malformed HTML
    if depth > 50 {
        return;
    }
    
    for child in element.children() {
        match child.value() {
            Node::Text(text) => {
                let text_content = text.trim();
                if !text_content.is_empty() {
                    if !result.is_empty() && !result.ends_with(' ') && !result.ends_with('\n') {
                        result.push(' ');
                    }
                    result.push_str(text_content);
                }
            }
            Node::Element(element_data) => {
                let tag_name = element_data.name();
                
                // Skip script and style elements
                if matches!(tag_name, "script" | "style") {
                    continue;
                }
                
                // Add line breaks for block elements
                let is_block_element = matches!(tag_name, 
                    "div" | "p" | "br" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | 
                    "li" | "ul" | "ol" | "blockquote" | "pre" | "hr" | "table" | "tr"
                );
                
                if is_block_element && !result.is_empty() && !result.ends_with('\n') {
                    result.push('\n');
                }
                
                // Recursively process child elements
                if let Some(child_element) = scraper::ElementRef::wrap(child) {
                    extract_element_text(child_element, result, depth + 1);
                }
                
                // Add spacing after certain elements
                match tag_name {
                    "br" => result.push('\n'),
                    "p" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        if !result.is_empty() && !result.ends_with('\n') {
                            result.push('\n');
                        }
                    }
                    "li" => {
                        if !result.is_empty() && !result.ends_with('\n') {
                            result.push('\n');
                        }
                    }
                    "td" | "th" => {
                        if !result.is_empty() && !result.ends_with(' ') && !result.ends_with('\n') {
                            result.push(' ');
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

fn clean_extracted_text(text: &str) -> String {
    // Split into lines and clean each one
    let lines: Vec<&str> = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| {
            // Filter out empty lines and separator lines
            if line.is_empty() {
                return false;
            }
            
            // Skip lines that are just separators
            if line.chars().all(|c| matches!(c, '-' | '_' | '=' | '*' | '+' | ' ')) {
                return false;
            }
            
            // Keep lines with actual content
            line.split_whitespace().count() > 0
        })
        .collect();
    
    // Join lines with single newlines and normalize whitespace
    lines.join("\n")
        .trim()
        .to_string()
}