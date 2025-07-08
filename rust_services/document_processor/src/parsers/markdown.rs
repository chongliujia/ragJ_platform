use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse Markdown content
pub fn parse_markdown(content: &[u8], options: &ParseOptions) -> Result<String> {
    let markdown_str = String::from_utf8_lossy(content);
    
    if options.preserve_formatting {
        // Return original Markdown with minor cleanup
        Ok(clean_markdown(markdown_str.to_string()))
    } else {
        // Convert to plain text
        Ok(markdown_to_text(markdown_str.to_string()))
    }
}

/// Convert Markdown to plain text
fn markdown_to_text(markdown: String) -> String {
    let mut text = String::new();
    let lines: Vec<&str> = markdown.lines().collect();
    
    let mut in_code_block = false;
    let mut in_table = false;
    
    for line in lines {
        let trimmed = line.trim();
        
        // Handle code blocks
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            if !in_code_block {
                text.push_str("\n[CODE BLOCK]\n");
            }
            continue;
        }
        
        if in_code_block {
            // Include code content but mark it
            text.push_str("CODE: ");
            text.push_str(line);
            text.push('\n');
            continue;
        }
        
        // Handle table detection
        if trimmed.contains('|') && !trimmed.starts_with('>') {
            if !in_table {
                text.push_str("\n[TABLE]\n");
                in_table = true;
            }
            let cleaned_row = clean_table_row(trimmed);
            text.push_str(&cleaned_row);
            text.push('\n');
            continue;
        } else if in_table {
            text.push_str("[/TABLE]\n");
            in_table = false;
        }
        
        // Process regular content
        let processed_line = process_markdown_line(trimmed);
        if !processed_line.is_empty() {
            text.push_str(&processed_line);
            text.push('\n');
        }
    }
    
    // Close table if still open
    if in_table {
        text.push_str("[/TABLE]\n");
    }
    
    clean_text_output(text)
}

/// Process a single Markdown line
fn process_markdown_line(line: &str) -> String {
    let mut processed = line.to_string();
    
    // Remove headers but keep content
    if processed.starts_with('#') {
        processed = processed.trim_start_matches('#').trim().to_string();
        if processed.is_empty() {
            return processed;
        }
        processed = format!("HEADING: {}", processed);
    }
    
    // Remove blockquote markers but keep content
    if processed.starts_with('>') {
        processed = processed.trim_start_matches('>').trim().to_string();
        if !processed.is_empty() {
            processed = format!("QUOTE: {}", processed);
        }
    }
    
    // Handle list items
    if processed.starts_with("- ") || processed.starts_with("* ") || processed.starts_with("+ ") {
        processed = processed[2..].trim().to_string();
        if !processed.is_empty() {
            processed = format!("LIST: {}", processed);
        }
    }
    
    // Handle numbered lists
    if let Some(pos) = processed.find(". ") {
        if processed[..pos].chars().all(|c| c.is_ascii_digit()) {
            processed = processed[pos + 2..].trim().to_string();
            if !processed.is_empty() {
                processed = format!("LIST: {}", processed);
            }
        }
    }
    
    // Remove inline formatting
    processed = remove_inline_formatting(processed);
    
    processed
}

/// Remove inline Markdown formatting
fn remove_inline_formatting(text: String) -> String {
    let mut result = text;
    
    // Remove bold/italic markers
    result = result.replace("***", "").replace("**", "").replace("*", "");
    result = result.replace("___", "").replace("__", "").replace("_", " ");
    
    // Remove inline code markers
    result = result.replace("`", "");
    
    // Remove links but keep text
    result = remove_links(result);
    
    // Remove strikethrough
    result = result.replace("~~", "");
    
    result
}

/// Remove Markdown links but keep link text
fn remove_links(text: String) -> String {
    use regex::Regex;
    
    // Remove reference-style links [text][ref]
    if let Ok(ref_regex) = Regex::new(r"\[([^\]]+)\]\[[^\]]*\]") {
        let result = ref_regex.replace_all(&text, "$1").to_string();
        
        // Remove inline links [text](url)
        if let Ok(inline_regex) = Regex::new(r"\[([^\]]+)\]\([^)]*\)") {
            return inline_regex.replace_all(&result, "$1").to_string();
        }
        
        return result;
    }
    
    text
}

/// Clean table row
fn clean_table_row(row: &str) -> String {
    // Split by | and clean each cell
    let cells: Vec<&str> = row.split('|').collect();
    let cleaned_cells: Vec<String> = cells
        .iter()
        .map(|cell| cell.trim().to_string())
        .filter(|cell| !cell.is_empty())
        .collect();
    
    cleaned_cells.join("\t")
}

/// Clean Markdown (preserve formatting mode)
fn clean_markdown(markdown: String) -> String {
    markdown
        .lines()
        .map(|line| line.trim_end()) // Remove trailing whitespace
        .collect::<Vec<_>>()
        .join("\n")
}

/// Clean final text output
fn clean_text_output(text: String) -> String {
    text.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Extract metadata from Markdown frontmatter
pub fn extract_frontmatter(markdown: &str) -> (Option<std::collections::HashMap<String, String>>, String) {
    use std::collections::HashMap;
    
    let lines: Vec<&str> = markdown.lines().collect();
    
    if lines.is_empty() || lines[0] != "---" {
        return (None, markdown.to_string());
    }
    
    // Find the end of frontmatter
    let mut end_index = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if *line == "---" {
            end_index = Some(i);
            break;
        }
    }
    
    if let Some(end) = end_index {
        let frontmatter_lines = &lines[1..end];
        let content_lines = &lines[end + 1..];
        
        let mut metadata = HashMap::new();
        
        // Parse YAML-like frontmatter
        for line in frontmatter_lines {
            if let Some(colon_pos) = line.find(':') {
                let key = line[..colon_pos].trim().to_string();
                let value = line[colon_pos + 1..].trim().trim_matches('"').to_string();
                if !value.is_empty() {
                    metadata.insert(key, value);
                }
            }
        }
        
        let content = content_lines.join("\n");
        return (Some(metadata), content);
    }
    
    (None, markdown.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_process_markdown_line() {
        assert_eq!(process_markdown_line("# Title"), "HEADING: Title");
        assert_eq!(process_markdown_line("- List item"), "LIST: List item");
        assert_eq!(process_markdown_line("> Quote"), "QUOTE: Quote");
        assert_eq!(process_markdown_line("1. Numbered item"), "LIST: Numbered item");
    }
    
    #[test]
    fn test_remove_inline_formatting() {
        let input = "This is **bold** and *italic* text with `code`.".to_string();
        let result = remove_inline_formatting(input);
        assert_eq!(result, "This is bold and italic text with code.");
    }
    
    #[test]
    fn test_remove_links() {
        let input = "Check out [Google](https://google.com) and [GitHub][gh].".to_string();
        let result = remove_links(input);
        assert_eq!(result, "Check out Google and GitHub.");
    }
    
    #[test]
    fn test_extract_frontmatter() {
        let markdown = r#"---
title: Test Document
author: John Doe
---

# Content
This is the content."#;
        
        let (metadata, content) = extract_frontmatter(markdown);
        assert!(metadata.is_some());
        let meta = metadata.unwrap();
        assert_eq!(meta.get("title"), Some(&"Test Document".to_string()));
        assert_eq!(meta.get("author"), Some(&"John Doe".to_string()));
        assert!(content.contains("# Content"));
    }
    
    #[test]
    fn test_clean_table_row() {
        let row = "| Column 1 | Column 2 | Column 3 |";
        let result = clean_table_row(row);
        assert_eq!(result, "Column 1\tColumn 2\tColumn 3");
    }
}