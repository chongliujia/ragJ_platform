use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse XML content
pub fn parse_xml(content: &[u8], options: &ParseOptions) -> Result<String> {
    let xml_str = String::from_utf8_lossy(content);
    
    if options.preserve_formatting {
        // Return formatted XML
        Ok(format_xml(&xml_str)?)
    } else {
        // Extract text content from XML
        Ok(extract_xml_text(&xml_str)?)
    }
}

/// Extract text content from XML
fn extract_xml_text(xml_str: &str) -> Result<String> {
    use roxmltree::Document;
    
    let doc = Document::parse(xml_str)
        .map_err(|e| DocumentError::XmlError(format!("XML parsing error: {}", e)))?;
    
    let mut text = String::new();
    extract_node_text(doc.root(), &mut text);
    
    if text.trim().is_empty() {
        return Err(DocumentError::XmlError("No text content found in XML".to_string()));
    }
    
    Ok(clean_xml_text(text))
}

/// Recursively extract text from XML nodes
fn extract_node_text(node: roxmltree::Node, text: &mut String) {
    for child in node.children() {
        if child.is_text() {
            if let Some(node_text) = child.text() {
                let trimmed = node_text.trim();
                if !trimmed.is_empty() {
                    text.push_str(trimmed);
                    text.push(' ');
                }
            }
        } else if child.is_element() {
            // Add element name as context for meaningful elements
            if is_meaningful_element(child.tag_name().name()) {
                text.push_str(&format!("[{}] ", child.tag_name().name()));
            }
            extract_node_text(child, text);
            
            // Add line break after block elements
            if is_block_element(child.tag_name().name()) {
                text.push('\n');
            }
        }
    }
}

/// Check if element is meaningful for text extraction
fn is_meaningful_element(tag_name: &str) -> bool {
    let meaningful_tags = [
        "title", "heading", "h1", "h2", "h3", "h4", "h5", "h6",
        "section", "chapter", "article", "abstract", "summary",
        "description", "content", "text", "paragraph", "p",
    ];
    
    let tag_lower = tag_name.to_lowercase();
    meaningful_tags.iter().any(|&tag| tag_lower.contains(tag))
}

/// Check if element should add line break
fn is_block_element(tag_name: &str) -> bool {
    let block_tags = [
        "p", "div", "section", "article", "header", "footer",
        "h1", "h2", "h3", "h4", "h5", "h6", "paragraph",
        "chapter", "section", "item", "entry",
    ];
    
    let tag_lower = tag_name.to_lowercase();
    block_tags.iter().any(|&tag| tag_lower.contains(tag))
}

/// Clean extracted XML text
fn clean_xml_text(text: String) -> String {
    text.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format XML with proper indentation
fn format_xml(xml_str: &str) -> Result<String> {
    // Simple XML formatting - could be improved with a proper formatter
    let mut formatted = String::new();
    let mut indent_level = 0;
    let mut in_tag = false;
    let mut is_closing_tag = false;
    
    for line in xml_str.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        
        // Adjust indentation for closing tags
        if trimmed.starts_with("</") {
            indent_level = indent_level.saturating_sub(1);
        }
        
        // Add indentation
        formatted.push_str(&"  ".repeat(indent_level));
        formatted.push_str(trimmed);
        formatted.push('\n');
        
        // Adjust indentation for opening tags
        if trimmed.starts_with('<') && !trimmed.starts_with("</") && !trimmed.ends_with("/>") {
            indent_level += 1;
        }
    }
    
    Ok(formatted)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_xml_text() {
        let xml = r#"<?xml version="1.0"?>
<document>
    <title>Test Document</title>
    <content>
        <paragraph>This is the first paragraph.</paragraph>
        <paragraph>This is the second paragraph.</paragraph>
    </content>
</document>"#;
        
        let result = extract_xml_text(xml).unwrap();
        assert!(result.contains("Test Document"));
        assert!(result.contains("first paragraph"));
        assert!(result.contains("second paragraph"));
    }
    
    #[test]
    fn test_is_meaningful_element() {
        assert!(is_meaningful_element("title"));
        assert!(is_meaningful_element("paragraph"));
        assert!(is_meaningful_element("heading"));
        assert!(!is_meaningful_element("metadata"));
        assert!(!is_meaningful_element("config"));
    }
    
    #[test]
    fn test_is_block_element() {
        assert!(is_block_element("p"));
        assert!(is_block_element("paragraph"));
        assert!(is_block_element("section"));
        assert!(!is_block_element("span"));
        assert!(!is_block_element("inline"));
    }
}