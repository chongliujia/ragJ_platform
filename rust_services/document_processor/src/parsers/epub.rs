use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse EPUB content
pub fn parse_epub(content: &[u8], options: &ParseOptions) -> Result<String> {
    use zip::ZipArchive;
    use std::io::Cursor;
    
    let cursor = Cursor::new(content);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| DocumentError::ArchiveError(format!("Failed to open EPUB: {}", e)))?;
    
    let mut all_text = String::new();
    let mut chapter_number = 1;
    
    // Extract text from XHTML files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| DocumentError::ArchiveError(format!("Failed to read archive entry: {}", e)))?;
        
        let name = file.name().to_string();
        
        // Process XHTML content files
        if name.ends_with(".xhtml") || name.ends_with(".html") {
            let mut content = String::new();
            std::io::Read::read_to_string(&mut file, &mut content)
                .map_err(|e| DocumentError::ArchiveError(format!("Failed to read file content: {}", e)))?;
            
            let chapter_text = extract_epub_chapter_text(&content, options)?;
            if !chapter_text.trim().is_empty() {
                all_text.push_str(&format!("\n=== Chapter {} ===\n", chapter_number));
                all_text.push_str(&chapter_text);
                all_text.push('\n');
                chapter_number += 1;
            }
        }
    }
    
    if all_text.trim().is_empty() {
        return Err(DocumentError::ArchiveError("No text found in EPUB".to_string()));
    }
    
    Ok(all_text)
}

/// Extract text from EPUB chapter (XHTML content)
fn extract_epub_chapter_text(html_content: &str, options: &ParseOptions) -> Result<String> {
    // Use HTML parser to extract text
    crate::parsers::html::parse_html(html_content.as_bytes(), options)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_epub_chapter_text() {
        let html = r#"<html><body><h1>Chapter Title</h1><p>This is chapter content.</p></body></html>"#;
        let options = ParseOptions::default();
        let result = extract_epub_chapter_text(html, &options).unwrap();
        assert!(result.contains("Chapter Title"));
        assert!(result.contains("chapter content"));
    }
}