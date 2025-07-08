use crate::error::{DocumentError, Result};
use mime_guess;
use std::path::Path;

/// Detect file type from filename extension and content
pub fn detect_file_type(filename: &str, content: &[u8]) -> Result<String> {
    // First try to detect from filename extension
    let path = Path::new(filename);
    if let Some(ext) = path.extension() {
        if let Some(ext_str) = ext.to_str() {
            let ext_lower = ext_str.to_lowercase();
            match ext_lower.as_str() {
                "pdf" => return Ok("pdf".to_string()),
                "docx" => return Ok("docx".to_string()),
                "doc" => return Ok("doc".to_string()),
                "xlsx" => return Ok("xlsx".to_string()),
                "xls" => return Ok("xls".to_string()),
                "pptx" => return Ok("pptx".to_string()),
                "ppt" => return Ok("ppt".to_string()),
                "txt" => return Ok("txt".to_string()),
                "md" => return Ok("markdown".to_string()),
                "rtf" => return Ok("rtf".to_string()),
                "html" | "htm" => return Ok("html".to_string()),
                "xml" => return Ok("xml".to_string()),
                "csv" => return Ok("csv".to_string()),
                "json" => return Ok("json".to_string()),
                "yaml" | "yml" => return Ok("yaml".to_string()),
                "epub" => return Ok("epub".to_string()),
                "odt" => return Ok("odt".to_string()),
                "ods" => return Ok("ods".to_string()),
                "odp" => return Ok("odp".to_string()),
                _ => {}
            }
        }
    }
    
    // Fallback to content-based detection
    detect_from_content(content)
}

/// Detect file type from content (magic bytes)
fn detect_from_content(content: &[u8]) -> Result<String> {
    if content.is_empty() {
        return Err(DocumentError::EmptyDocument);
    }
    
    // Check magic bytes
    if content.len() >= 4 {
        match &content[0..4] {
            [0x25, 0x50, 0x44, 0x46] => return Ok("pdf".to_string()), // %PDF
            [0x50, 0x4B, 0x03, 0x04] | [0x50, 0x4B, 0x05, 0x06] => {
                // ZIP-based formats (DOCX, XLSX, PPTX, etc.)
                return detect_office_format(content);
            }
            [0xD0, 0xCF, 0x11, 0xE0] => {
                // Legacy Office formats (DOC, XLS, PPT)
                return Ok("legacy_office".to_string());
            }
            _ => {}
        }
    }
    
    // Check for RTF
    if content.len() >= 5 && &content[0..5] == b"{\\rtf" {
        return Ok("rtf".to_string());
    }
    
    // Check for HTML
    if content.len() >= 5 {
        let start = String::from_utf8_lossy(&content[0..std::cmp::min(100, content.len())]);
        if start.to_lowercase().contains("<!doctype html") || 
           start.to_lowercase().contains("<html") {
            return Ok("html".to_string());
        }
    }
    
    // Check if it's valid UTF-8 text
    if let Ok(text) = std::str::from_utf8(content) {
        // Check for JSON
        if text.trim_start().starts_with('{') || text.trim_start().starts_with('[') {
            return Ok("json".to_string());
        }
        
        // Check for CSV (simple heuristic)
        if text.lines().take(5).any(|line| line.contains(',')) {
            return Ok("csv".to_string());
        }
        
        // Check for XML
        if text.trim_start().starts_with("<?xml") || text.trim_start().starts_with('<') {
            return Ok("xml".to_string());
        }
        
        // Check for YAML
        if text.contains("---") || text.lines().any(|line| line.contains(": ")) {
            return Ok("yaml".to_string());
        }
        
        // Default to plain text
        return Ok("txt".to_string());
    }
    
    Err(DocumentError::UnsupportedFormat { 
        format: "unknown".to_string() 
    })
}

/// Detect specific Office format from ZIP content
fn detect_office_format(content: &[u8]) -> Result<String> {
    use std::io::Cursor;
    use zip::ZipArchive;
    
    let cursor = Cursor::new(content);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| DocumentError::ArchiveError(e.to_string()))?;
    
    // Check for specific Office format indicators
    for i in 0..archive.len() {
        let file = archive.by_index(i)
            .map_err(|e| DocumentError::ArchiveError(e.to_string()))?;
        
        match file.name() {
            "word/document.xml" => return Ok("docx".to_string()),
            "xl/workbook.xml" => return Ok("xlsx".to_string()),
            "ppt/presentation.xml" => return Ok("pptx".to_string()),
            "content.xml" => {
                // Could be ODT, ODS, or ODP
                // Need to check manifest.xml for more specifics
                return Ok("odt".to_string()); // Default to ODT
            }
            _ => {}
        }
    }
    
    // Check for EPUB
    if archive.by_name("META-INF/container.xml").is_ok() {
        return Ok("epub".to_string());
    }
    
    // Generic ZIP archive
    Ok("zip".to_string())
}

/// Validate file size
pub fn validate_file_size(content: &[u8], max_size: usize) -> Result<()> {
    if content.len() > max_size {
        return Err(DocumentError::DocumentTooLarge { 
            size: content.len(), 
            max_size 
        });
    }
    Ok(())
}

/// Extract file extension from filename
pub fn get_file_extension(filename: &str) -> Option<String> {
    Path::new(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
}

/// Check if file is text-based
pub fn is_text_file(file_type: &str) -> bool {
    matches!(file_type, 
        "txt" | "markdown" | "html" | "xml" | "csv" | "json" | "yaml" | "rtf"
    )
}

/// Check if file is binary
pub fn is_binary_file(file_type: &str) -> bool {
    matches!(file_type, 
        "pdf" | "docx" | "doc" | "xlsx" | "xls" | "pptx" | "ppt" | 
        "odt" | "ods" | "odp" | "epub"
    )
}

/// Normalize whitespace in text
pub fn normalize_whitespace(text: &str) -> String {
    text.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Remove control characters from text
pub fn remove_control_chars(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect()
}