use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;
use std::collections::HashMap;
use std::io::Cursor;

/// Parse DOCX document
pub fn parse_docx(content: &[u8], options: &ParseOptions) -> Result<String> {
    use docx_rs::*;
    
    let cursor = Cursor::new(content);
    
    match read_docx(cursor) {
        Ok(docx) => {
            let mut text = String::new();
            extract_text_from_docx(&docx, &mut text, options)?;
            
            if text.trim().is_empty() {
                return Err(DocumentError::docx_error("No text found in document"));
            }
            
            Ok(process_docx_text(text, options))
        }
        Err(e) => Err(DocumentError::docx_error(format!("Failed to parse DOCX: {}", e))),
    }
}

/// Parse legacy DOC document
pub fn parse_doc(content: &[u8], _options: &ParseOptions) -> Result<String> {
    // Legacy DOC format is more complex and would require additional libraries
    // For now, return an error suggesting conversion
    Err(DocumentError::docx_error(
        "Legacy DOC format not supported. Please convert to DOCX format."
    ))
}

/// Extract text from DOCX document structure
fn extract_text_from_docx(docx: &Docx, text: &mut String, options: &ParseOptions) -> Result<()> {
    // Extract text from document body
    for child in &docx.document.body.children {
        extract_text_from_document_child(child, text, options);
    }
    
    // Extract text from headers and footers if requested
    if options.extract_metadata {
        extract_text_from_headers_footers(docx, text);
    }
    
    Ok(())
}

/// Extract text from document child elements
fn extract_text_from_document_child(child: &DocumentChild, text: &mut String, options: &ParseOptions) {
    match child {
        DocumentChild::Paragraph(para) => {
            let mut para_text = String::new();
            extract_text_from_paragraph(para, &mut para_text, options);
            
            if !para_text.trim().is_empty() {
                text.push_str(&para_text);
                text.push('\n');
            }
        }
        DocumentChild::Table(table) => {
            if options.extract_tables {
                extract_text_from_table(table, text, options);
            }
        }
        DocumentChild::BookmarkStart(_) | DocumentChild::BookmarkEnd(_) => {
            // Skip bookmarks
        }
        DocumentChild::CommentRangeStart(_) | DocumentChild::CommentRangeEnd(_) => {
            // Skip comment ranges
        }
        DocumentChild::StructuredDataTag(sdt) => {
            // Extract text from structured data tags
            for sdt_child in &sdt.children {
                extract_text_from_document_child(sdt_child, text, options);
            }
        }
    }
}

/// Extract text from paragraph
fn extract_text_from_paragraph(para: &Paragraph, text: &mut String, options: &ParseOptions) {
    for child in &para.children {
        match child {
            ParagraphChild::Run(run) => {
                extract_text_from_run(run, text, options);
            }
            ParagraphChild::Insert(insert) => {
                for run in &insert.children {
                    extract_text_from_run(run, text, options);
                }
            }
            ParagraphChild::Delete(_) => {
                // Skip deleted text
            }
            ParagraphChild::Hyperlink(link) => {
                for run in &link.children {
                    extract_text_from_run(run, text, options);
                }
            }
            ParagraphChild::BookmarkStart(_) | ParagraphChild::BookmarkEnd(_) => {
                // Skip bookmarks
            }
            ParagraphChild::CommentRangeStart(_) | ParagraphChild::CommentRangeEnd(_) => {
                // Skip comment ranges
            }
            ParagraphChild::CommentReference(_) => {
                // Skip comment references
            }
        }
    }
}

/// Extract text from run
fn extract_text_from_run(run: &Run, text: &mut String, _options: &ParseOptions) {
    for child in &run.children {
        match child {
            RunChild::Text(t) => {
                text.push_str(&t.text);
            }
            RunChild::Tab(_) => {
                text.push('\t');
            }
            RunChild::Break(_) => {
                text.push('\n');
            }
            RunChild::DeletedText(_) => {
                // Skip deleted text
            }
            _ => {
                // Skip other run children like images, symbols, etc.
            }
        }
    }
}

/// Extract text from table
fn extract_text_from_table(table: &Table, text: &mut String, options: &ParseOptions) {
    text.push_str("\n[TABLE]\n");
    
    for row in &table.rows {
        let mut row_text = String::new();
        
        for cell in &row.cells {
            let mut cell_text = String::new();
            
            for child in &cell.children {
                match child {
                    TableCellChild::Paragraph(para) => {
                        extract_text_from_paragraph(para, &mut cell_text, options);
                    }
                    TableCellChild::Table(nested_table) => {
                        extract_text_from_table(nested_table, &mut cell_text, options);
                    }
                }
            }
            
            if !row_text.is_empty() {
                row_text.push('\t');
            }
            row_text.push_str(&cell_text.trim().replace('\n', " "));
        }
        
        if !row_text.trim().is_empty() {
            text.push_str(&row_text);
            text.push('\n');
        }
    }
    
    text.push_str("[/TABLE]\n");
}

/// Extract text from headers and footers
fn extract_text_from_headers_footers(docx: &Docx, text: &mut String) {
    // This would require accessing the document relationships
    // For now, skip header/footer extraction
    // A full implementation would parse header.xml and footer.xml files
}

/// Process extracted DOCX text
fn process_docx_text(text: String, options: &ParseOptions) -> String {
    let mut processed = text;
    
    // Remove excessive whitespace
    processed = processed
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    
    // Handle paragraph breaks
    if !options.preserve_formatting {
        processed = normalize_paragraph_breaks(processed);
    }
    
    processed
}

/// Normalize paragraph breaks
fn normalize_paragraph_breaks(text: String) -> String {
    // Replace multiple newlines with double newlines for paragraph breaks
    let mut result = String::new();
    let lines: Vec<&str> = text.lines().collect();
    
    for (i, line) in lines.iter().enumerate() {
        result.push_str(line);
        
        if i < lines.len() - 1 {
            // Add appropriate line breaks
            if line.ends_with('.') || line.ends_with('!') || line.ends_with('?') {
                result.push_str("\n\n");
            } else {
                result.push('\n');
            }
        }
    }
    
    result
}

/// Extract metadata from DOCX
pub fn extract_docx_metadata(content: &[u8]) -> Result<HashMap<String, String>> {
    let cursor = Cursor::new(content);
    
    match read_docx(cursor) {
        Ok(docx) => {
            let mut metadata = HashMap::new();
            
            metadata.insert("file_type".to_string(), "docx".to_string());
            metadata.insert("file_size".to_string(), content.len().to_string());
            
            // Extract core properties if available
            if let Some(core_props) = &docx.doc_props.core {
                if let Some(title) = &core_props.title {
                    metadata.insert("title".to_string(), title.clone());
                }
                if let Some(creator) = &core_props.creator {
                    metadata.insert("creator".to_string(), creator.clone());
                }
                if let Some(subject) = &core_props.subject {
                    metadata.insert("subject".to_string(), subject.clone());
                }
                if let Some(description) = &core_props.description {
                    metadata.insert("description".to_string(), description.clone());
                }
                if let Some(created) = &core_props.created {
                    metadata.insert("created".to_string(), created.clone());
                }
                if let Some(modified) = &core_props.modified {
                    metadata.insert("modified".to_string(), modified.clone());
                }
            }
            
            // Count paragraphs and estimate word count
            let mut text = String::new();
            let options = ParseOptions::default();
            if extract_text_from_docx(&docx, &mut text, &options).is_ok() {
                metadata.insert("character_count".to_string(), text.len().to_string());
                metadata.insert("word_count".to_string(), text.split_whitespace().count().to_string());
                metadata.insert("paragraph_count".to_string(), text.lines().count().to_string());
            }
            
            Ok(metadata)
        }
        Err(e) => Err(DocumentError::docx_error(format!("Failed to extract metadata: {}", e))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_normalize_paragraph_breaks() {
        let input = "First sentence.\nSecond sentence.\nThird sentence.".to_string();
        let result = normalize_paragraph_breaks(input);
        assert!(result.contains("\n\n"));
    }
}