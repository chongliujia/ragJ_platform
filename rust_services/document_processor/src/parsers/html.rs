use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse HTML content
pub fn parse_html(content: &[u8], options: &ParseOptions) -> Result<String> {
    let html_str = String::from_utf8_lossy(content);
    
    // Convert HTML to plain text
    let text = html2text::from_read(html_str.as_bytes(), 80);
    
    if text.trim().is_empty() {
        return Err(DocumentError::HtmlError("No text found in HTML".to_string()));
    }
    
    Ok(process_html_text(text, options))
}

/// Process extracted HTML text
fn process_html_text(text: String, options: &ParseOptions) -> String {
    let mut processed = text;
    
    // Remove excessive whitespace
    processed = processed
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    
    // Handle HTML-specific formatting
    if !options.preserve_formatting {
        processed = normalize_html_text(processed);
    }
    
    processed
}

/// Normalize HTML text
fn normalize_html_text(text: String) -> String {
    let mut result = String::new();
    let lines: Vec<&str> = text.lines().collect();
    
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        
        // Skip lines that are likely navigation or UI elements
        if is_likely_navigation(trimmed) {
            continue;
        }
        
        // Skip very short lines
        if trimmed.len() < 3 {
            continue;
        }
        
        result.push_str(trimmed);
        
        // Add appropriate spacing
        if i < lines.len() - 1 {
            if trimmed.ends_with('.') || trimmed.ends_with('!') || trimmed.ends_with('?') {
                result.push_str("\n\n");
            } else {
                result.push('\n');
            }
        }
    }
    
    result
}

/// Check if line is likely navigation or UI element
fn is_likely_navigation(line: &str) -> bool {
    let lower = line.to_lowercase();
    
    // Common navigation terms
    let nav_terms = [
        "home", "menu", "navigation", "nav", "skip to", "breadcrumb",
        "search", "login", "sign in", "register", "contact", "about",
        "privacy", "terms", "copyright", "all rights reserved",
        "click here", "read more", "continue reading", "next", "previous",
        "back to top", "scroll to top", "follow us", "social media",
        "share", "like", "subscribe", "newsletter", "email",
    ];
    
    // Check if line contains navigation terms
    if nav_terms.iter().any(|term| lower.contains(term)) {
        return true;
    }
    
    // Check for common UI patterns
    if lower.starts_with("©") || lower.contains("cookie") || lower.contains("javascript") {
        return true;
    }
    
    // Check for short lines with common action words
    if line.len() < 20 && (lower.contains("click") || lower.contains("here") || lower.contains("more")) {
        return true;
    }
    
    false
}

/// Extract text from HTML table
pub fn extract_table_text(html: &str) -> Result<String> {
    // This is a simplified table extraction
    // A more sophisticated implementation would parse HTML properly
    let mut text = String::new();
    let lines: Vec<&str> = html.lines().collect();
    
    let mut in_table = false;
    let mut in_cell = false;
    let mut cell_text = String::new();
    let mut row_cells = Vec::new();
    
    for line in lines {
        let trimmed = line.trim();
        
        if trimmed.starts_with("<table") {
            in_table = true;
            text.push_str("\n[TABLE]\n");
        } else if trimmed.starts_with("</table>") {
            in_table = false;
            text.push_str("[/TABLE]\n");
        } else if in_table {
            if trimmed.starts_with("<td") || trimmed.starts_with("<th") {
                in_cell = true;
                cell_text.clear();
            } else if trimmed.starts_with("</td>") || trimmed.starts_with("</th>") {
                in_cell = false;
                row_cells.push(cell_text.trim().to_string());
                cell_text.clear();
            } else if trimmed.starts_with("</tr>") {
                if !row_cells.is_empty() {
                    text.push_str(&row_cells.join("\t"));
                    text.push('\n');
                    row_cells.clear();
                }
            } else if in_cell {
                // Extract text from cell content
                let clean_text = html2text::from_read(trimmed.as_bytes(), 100);
                cell_text.push_str(&clean_text);
            }
        }
    }
    
    Ok(text)
}

/// Extract metadata from HTML
pub fn extract_html_metadata(content: &[u8]) -> Result<std::collections::HashMap<String, String>> {
    use regex::Regex;
    use std::collections::HashMap;
    
    let html_str = String::from_utf8_lossy(content);
    let mut metadata = HashMap::new();
    
    metadata.insert("file_type".to_string(), "html".to_string());
    metadata.insert("file_size".to_string(), content.len().to_string());
    
    // Extract title
    if let Ok(title_regex) = Regex::new(r"<title[^>]*>([^<]+)</title>") {
        if let Some(caps) = title_regex.captures(&html_str) {
            if let Some(title) = caps.get(1) {
                metadata.insert("title".to_string(), title.as_str().trim().to_string());
            }
        }
    }
    
    // Extract meta tags
    if let Ok(meta_regex) = Regex::new(r#"<meta\s+name="([^"]+)"\s+content="([^"]+)""#) {
        for caps in meta_regex.captures_iter(&html_str) {
            if let (Some(name), Some(content)) = (caps.get(1), caps.get(2)) {
                let name_str = name.as_str().to_lowercase();
                let content_str = content.as_str().to_string();
                
                match name_str.as_str() {
                    "description" => metadata.insert("description".to_string(), content_str),
                    "keywords" => metadata.insert("keywords".to_string(), content_str),
                    "author" => metadata.insert("author".to_string(), content_str),
                    "generator" => metadata.insert("generator".to_string(), content_str),
                    _ => metadata.insert(name_str, content_str),
                };
            }
        }
    }
    
    // Extract language
    if let Ok(lang_regex) = Regex::new(r#"<html[^>]*lang="([^"]+)""#) {
        if let Some(caps) = lang_regex.captures(&html_str) {
            if let Some(lang) = caps.get(1) {
                metadata.insert("language".to_string(), lang.as_str().to_string());
            }
        }
    }
    
    // Estimate content length
    let text = html2text::from_read(html_str.as_bytes(), 80);
    metadata.insert("character_count".to_string(), text.len().to_string());
    metadata.insert("word_count".to_string(), text.split_whitespace().count().to_string());
    
    Ok(metadata)
}

/// Check if HTML is likely a webpage vs document
pub fn is_webpage(html: &str) -> bool {
    let lower = html.to_lowercase();
    
    // Check for common webpage elements
    let webpage_indicators = [
        "<nav", "<header", "<footer", "<aside", "<main",
        "javascript", "stylesheet", "jquery", "bootstrap",
        "google-analytics", "facebook", "twitter", "instagram",
        "cookie", "privacy", "terms of service",
    ];
    
    let indicator_count = webpage_indicators.iter()
        .filter(|&&indicator| lower.contains(indicator))
        .count();
    
    // If more than 2 indicators, likely a webpage
    indicator_count > 2
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_is_likely_navigation() {
        assert!(is_likely_navigation("Home"));
        assert!(is_likely_navigation("Click here for more"));
        assert!(is_likely_navigation("© 2023 Company"));
        assert!(!is_likely_navigation("This is regular content."));
    }
    
    #[test]
    fn test_is_webpage() {
        let webpage = r#"<html><head><script>google-analytics</script></head><body><nav>menu</nav><main>content</main></body></html>"#;
        assert!(is_webpage(webpage));
        
        let document = r#"<html><body><h1>Title</h1><p>Content</p></body></html>"#;
        assert!(!is_webpage(document));
    }
    
    #[test]
    fn test_normalize_html_text() {
        let input = "Home\nNavigation\nThis is real content.\nMore content here.".to_string();
        let result = normalize_html_text(input);
        assert!(!result.contains("Home"));
        assert!(!result.contains("Navigation"));
        assert!(result.contains("This is real content."));
    }
}