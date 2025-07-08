use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse RTF content
pub fn parse_rtf(content: &[u8], _options: &ParseOptions) -> Result<String> {
    // RTF parsing is complex and would require specialized libraries
    // For now, try to extract plain text using simple pattern matching
    let rtf_str = String::from_utf8_lossy(content);
    
    if !rtf_str.starts_with("{\\rtf") {
        return Err(DocumentError::RtfError("Not a valid RTF file".to_string()));
    }
    
    // Simple RTF text extraction
    let text = extract_rtf_text(&rtf_str)?;
    
    if text.trim().is_empty() {
        return Err(DocumentError::RtfError("No text found in RTF file".to_string()));
    }
    
    Ok(text)
}

/// Extract text from RTF content (simplified)
fn extract_rtf_text(rtf: &str) -> Result<String> {
    let mut text = String::new();
    let mut chars = rtf.chars().peekable();
    let mut in_control_word = false;
    let mut brace_level = 0;
    
    while let Some(ch) = chars.next() {
        match ch {
            '{' => {
                brace_level += 1;
            }
            '}' => {
                brace_level -= 1;
                in_control_word = false;
            }
            '\\' => {
                in_control_word = true;
                // Skip control words
                while let Some(&next_ch) = chars.peek() {
                    if next_ch.is_alphabetic() || next_ch.is_ascii_digit() || next_ch == '-' {
                        chars.next();
                    } else {
                        break;
                    }
                }
                
                // Skip space after control word
                if let Some(&' ') = chars.peek() {
                    chars.next();
                }
                
                in_control_word = false;
            }
            _ => {
                if !in_control_word && brace_level > 0 && ch.is_ascii() && !ch.is_control() {
                    text.push(ch);
                }
            }
        }
    }
    
    Ok(clean_rtf_text(text))
}

/// Clean extracted RTF text
fn clean_rtf_text(text: String) -> String {
    text.lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_rtf_text() {
        let rtf = r#"{\rtf1\ansi\deff0 {\fonttbl {\f0 Times New Roman;}}
\f0\fs24 Hello, World!}"#;
        
        let result = extract_rtf_text(rtf).unwrap();
        assert!(result.contains("Hello, World!"));
    }
}