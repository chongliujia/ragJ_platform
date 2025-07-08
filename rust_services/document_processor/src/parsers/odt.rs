use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse OpenDocument Text (ODT) file
pub fn parse_odt(content: &[u8], options: &ParseOptions) -> Result<String> {
    extract_odf_text(content, "odt", options)
}

/// Parse OpenDocument Spreadsheet (ODS) file
pub fn parse_ods(content: &[u8], options: &ParseOptions) -> Result<String> {
    extract_odf_text(content, "ods", options)
}

/// Parse OpenDocument Presentation (ODP) file
pub fn parse_odp(content: &[u8], options: &ParseOptions) -> Result<String> {
    extract_odf_text(content, "odp", options)
}

/// Extract text from OpenDocument Format files
fn extract_odf_text(content: &[u8], doc_type: &str, options: &ParseOptions) -> Result<String> {
    use zip::ZipArchive;
    use std::io::Cursor;
    
    let cursor = Cursor::new(content);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| DocumentError::ArchiveError(format!("Failed to open {} file: {}", doc_type.to_uppercase(), e)))?;
    
    // Extract content.xml
    let mut content_file = archive.by_name("content.xml")
        .map_err(|_| DocumentError::ArchiveError("content.xml not found in ODF file".to_string()))?;
    
    let mut xml_content = String::new();
    std::io::Read::read_to_string(&mut content_file, &mut xml_content)
        .map_err(|e| DocumentError::ArchiveError(format!("Failed to read content.xml: {}", e)))?;
    
    let text = match doc_type {
        "odt" => extract_odt_text_from_xml(&xml_content, options)?,
        "ods" => extract_ods_text_from_xml(&xml_content, options)?,
        "odp" => extract_odp_text_from_xml(&xml_content, options)?,
        _ => return Err(DocumentError::UnsupportedFormat { format: doc_type.to_string() }),
    };
    
    if text.trim().is_empty() {
        return Err(DocumentError::ArchiveError(format!("No text found in {} file", doc_type.to_uppercase())));
    }
    
    Ok(text)
}

/// Extract text from ODT content.xml
fn extract_odt_text_from_xml(xml_content: &str, options: &ParseOptions) -> Result<String> {
    use quick_xml::Reader;
    use quick_xml::events::Event;
    
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
                    b"text:p" | b"text:h" => {
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
                    b"text:p" | b"text:h" => {
                        in_text_element = false;
                        if !current_text.trim().is_empty() {
                            text.push_str(&current_text);
                            text.push('\n');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(DocumentError::XmlError(format!("ODT XML parsing error: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }
    
    Ok(process_odf_text(text, options))
}

/// Extract text from ODS content.xml
fn extract_ods_text_from_xml(xml_content: &str, options: &ParseOptions) -> Result<String> {
    use quick_xml::Reader;
    use quick_xml::events::Event;
    
    let mut reader = Reader::from_str(xml_content);
    reader.trim_text(true);
    
    let mut text = String::new();
    let mut buf = Vec::new();
    let mut in_cell = false;
    let mut current_text = String::new();
    let mut sheet_name = String::new();
    
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"table:table" => {
                        // Extract sheet name
                        if let Ok(name_attr) = e.try_get_attribute("table:name") {
                            if let Some(attr) = name_attr {
                                sheet_name = String::from_utf8_lossy(&attr.value).to_string();
                                text.push_str(&format!("\n=== {} ===\n", sheet_name));
                            }
                        }
                    }
                    b"table:table-cell" => {
                        in_cell = true;
                        current_text.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if in_cell {
                    current_text.push_str(&e.unescape().unwrap_or_default());
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"table:table-cell" => {
                        in_cell = false;
                        if !current_text.trim().is_empty() {
                            text.push_str(&current_text);
                            text.push('\t');
                        }
                    }
                    b"table:table-row" => {
                        text.push('\n');
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(DocumentError::XmlError(format!("ODS XML parsing error: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }
    
    Ok(process_odf_text(text, options))
}

/// Extract text from ODP content.xml
fn extract_odp_text_from_xml(xml_content: &str, options: &ParseOptions) -> Result<String> {
    use quick_xml::Reader;
    use quick_xml::events::Event;
    
    let mut reader = Reader::from_str(xml_content);
    reader.trim_text(true);
    
    let mut text = String::new();
    let mut buf = Vec::new();
    let mut in_text_element = false;
    let mut current_text = String::new();
    let mut slide_number = 1;
    
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"draw:page" => {
                        text.push_str(&format!("\n=== Slide {} ===\n", slide_number));
                        slide_number += 1;
                    }
                    b"text:p" | b"text:h" => {
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
                    b"text:p" | b"text:h" => {
                        in_text_element = false;
                        if !current_text.trim().is_empty() {
                            text.push_str(&current_text);
                            text.push('\n');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(DocumentError::XmlError(format!("ODP XML parsing error: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }
    
    Ok(process_odf_text(text, options))
}

/// Process extracted ODF text
fn process_odf_text(text: String, options: &ParseOptions) -> String {
    let mut processed = text;
    
    // Remove excessive whitespace
    processed = processed
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    
    // Handle formatting
    if !options.preserve_formatting {
        processed = normalize_odf_text(processed);
    }
    
    processed
}

/// Normalize ODF text
fn normalize_odf_text(text: String) -> String {
    text.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && line.len() > 2)
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_normalize_odf_text() {
        let input = "Title\n\nParagraph 1\n\nParagraph 2\n\n".to_string();
        let result = normalize_odf_text(input);
        assert!(result.contains("Title"));
        assert!(result.contains("Paragraph 1"));
        assert!(result.contains("Paragraph 2"));
    }
}