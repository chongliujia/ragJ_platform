use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;
use std::collections::HashMap;

/// Parse PDF document using pdf-extract
pub fn parse_pdf(content: &[u8], options: &ParseOptions) -> Result<String> {
    use pdf_extract::extract_text_from_mem;
    
    match extract_text_from_mem(content) {
        Ok(text) => {
            if text.trim().is_empty() {
                if options.enable_ocr {
                    parse_pdf_with_ocr(content, options)
                } else {
                    Err(DocumentError::pdf_error("No text found in PDF. Consider enabling OCR."))
                }
            } else {
                Ok(process_pdf_text(text, options))
            }
        }
        Err(e) => Err(DocumentError::pdf_error(format!("Failed to extract text: {}", e))),
    }
}

/// Parse PDF using OCR when text extraction fails
#[cfg(feature = "ocr")]
fn parse_pdf_with_ocr(content: &[u8], options: &ParseOptions) -> Result<String> {
    // This would require additional image processing and OCR libraries
    // For now, return an error suggesting manual OCR
    Err(DocumentError::pdf_error(
        "OCR parsing not yet implemented. Please use a different PDF or convert to text format."
    ))
}

#[cfg(not(feature = "ocr"))]
fn parse_pdf_with_ocr(_content: &[u8], _options: &ParseOptions) -> Result<String> {
    Err(DocumentError::pdf_error(
        "OCR feature not enabled. Rebuild with 'ocr' feature to enable OCR parsing."
    ))
}

/// Process extracted PDF text
fn process_pdf_text(text: String, options: &ParseOptions) -> String {
    let mut processed = text;
    
    // Remove excessive whitespace
    processed = processed
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    
    // Handle page breaks and headers/footers
    processed = remove_page_artifacts(processed);
    
    // Preserve formatting if requested
    if options.preserve_formatting {
        processed = preserve_pdf_formatting(processed);
    }
    
    processed
}

/// Remove common PDF artifacts like page numbers, headers, footers
fn remove_page_artifacts(text: String) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut cleaned_lines = Vec::new();
    
    for (i, line) in lines.iter().enumerate() {
        let line_trimmed = line.trim();
        
        // Skip likely page numbers (single number on a line)
        if line_trimmed.parse::<u32>().is_ok() && line_trimmed.len() <= 4 {
            continue;
        }
        
        // Skip very short lines at the beginning or end of pages
        if line_trimmed.len() < 3 && (i == 0 || i == lines.len() - 1) {
            continue;
        }
        
        // Skip common footer patterns
        if line_trimmed.to_lowercase().contains("page ") 
            && line_trimmed.len() < 20 {
            continue;
        }
        
        cleaned_lines.push(*line);
    }
    
    cleaned_lines.join("\n")
}

/// Preserve PDF formatting elements
fn preserve_pdf_formatting(text: String) -> String {
    // Add paragraph breaks for better readability
    let mut result = String::new();
    let lines: Vec<&str> = text.lines().collect();
    
    for (i, line) in lines.iter().enumerate() {
        result.push_str(line);
        
        // Add extra newline for paragraph breaks
        if i < lines.len() - 1 {
            let current_line = line.trim();
            let next_line = lines[i + 1].trim();
            
            // Check if this looks like end of paragraph
            if current_line.ends_with('.') 
                || current_line.ends_with('!') 
                || current_line.ends_with('?') {
                if !next_line.is_empty() 
                    && next_line.chars().next().unwrap_or(' ').is_uppercase() {
                    result.push_str("\n\n");
                } else {
                    result.push('\n');
                }
            } else {
                result.push('\n');
            }
        }
    }
    
    result
}

/// Extract metadata from PDF
pub fn extract_pdf_metadata(content: &[u8]) -> Result<HashMap<String, String>> {
    // For now, return basic metadata
    // A full implementation would use a proper PDF library like lopdf
    let mut metadata = HashMap::new();
    
    metadata.insert("file_type".to_string(), "pdf".to_string());
    metadata.insert("file_size".to_string(), content.len().to_string());
    
    // Try to extract text to estimate page count
    if let Ok(text) = pdf_extract::extract_text_from_mem(content) {
        let estimated_pages = estimate_page_count(&text);
        metadata.insert("estimated_pages".to_string(), estimated_pages.to_string());
        metadata.insert("character_count".to_string(), text.len().to_string());
        metadata.insert("word_count".to_string(), text.split_whitespace().count().to_string());
    }
    
    Ok(metadata)
}

/// Estimate page count from extracted text
fn estimate_page_count(text: &str) -> usize {
    // Simple heuristic: average 500 words per page
    let word_count = text.split_whitespace().count();
    std::cmp::max(1, word_count / 500)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_remove_page_artifacts() {
        let input = "Some content\n1\nMore content\nPage 2\nFinal content".to_string();
        let result = remove_page_artifacts(input);
        assert_eq!(result, "Some content\nMore content\nFinal content");
    }
    
    #[test]
    fn test_estimate_page_count() {
        let text = "word ".repeat(1000);
        assert_eq!(estimate_page_count(&text), 2);
    }
}