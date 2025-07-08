use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;
use std::collections::HashMap;
use std::io::Cursor;

/// Parse PowerPoint PPTX file
pub fn parse_pptx(content: &[u8], options: &ParseOptions) -> Result<String> {
    use zip::ZipArchive;
    use quick_xml::Reader;
    use quick_xml::events::Event;
    
    let cursor = Cursor::new(content);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| DocumentError::PowerPointError(format!("Failed to open PPTX: {}", e)))?;
    
    let mut all_text = String::new();
    let mut slide_number = 1;
    
    // Extract text from slides
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| DocumentError::PowerPointError(format!("Failed to read archive entry: {}", e)))?;
        
        let name = file.name().to_string();
        
        // Process slide files
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
            let mut content = String::new();
            std::io::Read::read_to_string(&mut file, &mut content)
                .map_err(|e| DocumentError::PowerPointError(format!("Failed to read slide content: {}", e)))?;
            
            let slide_text = extract_slide_text(&content, options)?;
            if !slide_text.trim().is_empty() {
                all_text.push_str(&format!("\n=== Slide {} ===\n", slide_number));
                all_text.push_str(&slide_text);
                all_text.push('\n');
                slide_number += 1;
            }
        }
        
        // Process notes if requested
        if options.extract_metadata && name.starts_with("ppt/notesSlides/notesSlide") && name.ends_with(".xml") {
            let mut content = String::new();
            std::io::Read::read_to_string(&mut file, &mut content)
                .map_err(|e| DocumentError::PowerPointError(format!("Failed to read notes content: {}", e)))?;
            
            let notes_text = extract_notes_text(&content, options)?;
            if !notes_text.trim().is_empty() {
                all_text.push_str(&format!("\n=== Notes {} ===\n", slide_number - 1));
                all_text.push_str(&notes_text);
                all_text.push('\n');
            }
        }
    }
    
    if all_text.trim().is_empty() {
        return Err(DocumentError::PowerPointError("No text found in presentation".to_string()));
    }
    
    Ok(all_text)
}

/// Parse legacy PowerPoint PPT file
pub fn parse_ppt(content: &[u8], _options: &ParseOptions) -> Result<String> {
    // Legacy PPT format is complex and would require specialized libraries
    // For now, return an error suggesting conversion
    Err(DocumentError::PowerPointError(
        "Legacy PPT format not supported. Please convert to PPTX format.".to_string()
    ))
}

/// Extract text from slide XML content
fn extract_slide_text(xml_content: &str, options: &ParseOptions) -> Result<String> {
    let mut reader = Reader::from_str(xml_content);
    reader.trim_text(true);
    
    let mut text = String::new();
    let mut buf = Vec::new();
    let mut in_text_element = false;
    let mut current_text = String::new();
    
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"a:t" => {
                        in_text_element = true;
                        current_text.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if in_text_element {
                    current_text.push_str(&e.unescape().unwrap_or_default());
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"a:t" => {
                        in_text_element = false;
                        if !current_text.trim().is_empty() {
                            text.push_str(&current_text);
                            text.push(' ');
                        }
                    }
                    b"a:p" => {
                        // End of paragraph
                        if !text.trim().is_empty() && !text.ends_with('\n') {
                            text.push('\n');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(DocumentError::PowerPointError(format!("XML parsing error: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }
    
    Ok(process_slide_text(text, options))
}

/// Extract text from notes XML content
fn extract_notes_text(xml_content: &str, options: &ParseOptions) -> Result<String> {
    // Similar to slide text extraction but for notes
    extract_slide_text(xml_content, options)
}

/// Process extracted slide text
fn process_slide_text(text: String, options: &ParseOptions) -> String {
    let mut processed = text;
    
    // Remove excessive whitespace
    processed = processed
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    
    // Handle bullet points and formatting
    if !options.preserve_formatting {
        processed = normalize_presentation_text(processed);
    }
    
    processed
}

/// Normalize presentation text
fn normalize_presentation_text(text: String) -> String {
    let mut result = String::new();
    let lines: Vec<&str> = text.lines().collect();
    
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        
        // Skip very short lines that might be formatting artifacts
        if trimmed.len() < 2 {
            continue;
        }
        
        // Add line to result
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

/// Extract metadata from PPTX
pub fn extract_pptx_metadata(content: &[u8]) -> Result<HashMap<String, String>> {
    use zip::ZipArchive;
    
    let cursor = Cursor::new(content);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| DocumentError::PowerPointError(format!("Failed to open PPTX: {}", e)))?;
    
    let mut metadata = HashMap::new();
    
    metadata.insert("file_type".to_string(), "pptx".to_string());
    metadata.insert("file_size".to_string(), content.len().to_string());
    
    // Count slides
    let mut slide_count = 0;
    let mut has_notes = false;
    
    for i in 0..archive.len() {
        let file = archive.by_index(i)
            .map_err(|e| DocumentError::PowerPointError(format!("Failed to read archive entry: {}", e)))?;
        
        let name = file.name();
        
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
            slide_count += 1;
        }
        
        if name.starts_with("ppt/notesSlides/") {
            has_notes = true;
        }
    }
    
    metadata.insert("slide_count".to_string(), slide_count.to_string());
    metadata.insert("has_notes".to_string(), has_notes.to_string());
    
    // Try to extract core properties
    if let Ok(mut props_file) = archive.by_name("docProps/core.xml") {
        let mut props_content = String::new();
        if std::io::Read::read_to_string(&mut props_file, &mut props_content).is_ok() {
            if let Ok(props) = extract_core_properties(&props_content) {
                metadata.extend(props);
            }
        }
    }
    
    Ok(metadata)
}

/// Extract core properties from XML
fn extract_core_properties(xml_content: &str) -> Result<HashMap<String, String>> {
    use quick_xml::Reader;
    use quick_xml::events::Event;
    
    let mut reader = Reader::from_str(xml_content);
    reader.trim_text(true);
    
    let mut properties = HashMap::new();
    let mut buf = Vec::new();
    let mut current_element = String::new();
    
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                current_element = String::from_utf8_lossy(e.name().as_ref()).to_string();
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default();
                if !text.trim().is_empty() {
                    match current_element.as_str() {
                        "dc:title" => properties.insert("title".to_string(), text.to_string()),
                        "dc:creator" => properties.insert("creator".to_string(), text.to_string()),
                        "dc:subject" => properties.insert("subject".to_string(), text.to_string()),
                        "dc:description" => properties.insert("description".to_string(), text.to_string()),
                        "dcterms:created" => properties.insert("created".to_string(), text.to_string()),
                        "dcterms:modified" => properties.insert("modified".to_string(), text.to_string()),
                        _ => None,
                    };
                }
            }
            Ok(Event::End(_)) => {
                current_element.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(DocumentError::PowerPointError(format!("XML parsing error: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }
    
    Ok(properties)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_normalize_presentation_text() {
        let input = "Title\nBullet 1\nBullet 2\nConclusion.".to_string();
        let result = normalize_presentation_text(input);
        assert!(result.contains("Title"));
        assert!(result.contains("Bullet 1"));
        assert!(result.contains("Conclusion."));
    }
    
    #[test]
    fn test_extract_core_properties() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">
    <dc:title>Test Presentation</dc:title>
    <dc:creator>John Doe</dc:creator>
</cp:coreProperties>"#;
        
        let result = extract_core_properties(xml).unwrap();
        assert_eq!(result.get("title"), Some(&"Test Presentation".to_string()));
        assert_eq!(result.get("creator"), Some(&"John Doe".to_string()));
    }
}