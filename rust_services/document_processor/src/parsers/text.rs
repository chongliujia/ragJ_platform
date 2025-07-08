use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;
use encoding_rs::*;

/// Parse plain text file
pub fn parse_txt(content: &[u8], options: &ParseOptions) -> Result<String> {
    let text = decode_text(content)?;
    Ok(process_text(text, options))
}

/// Parse YAML file
pub fn parse_yaml(content: &[u8], options: &ParseOptions) -> Result<String> {
    let text = decode_text(content)?;
    
    // For YAML, we might want to extract just the values or preserve structure
    if options.preserve_formatting {
        Ok(process_text(text, options))
    } else {
        Ok(extract_yaml_values(text, options))
    }
}

/// Decode text with proper encoding detection
fn decode_text(content: &[u8]) -> Result<String> {
    // Try UTF-8 first
    if let Ok(text) = std::str::from_utf8(content) {
        return Ok(text.to_string());
    }
    
    // Try to detect encoding
    let (decoded, encoding, had_errors) = UTF_8.decode(content);
    
    if had_errors {
        // Try common encodings
        for encoding in &[WINDOWS_1252, ISO_8859_1, GBK, BIG5] {
            let (decoded, _, had_errors) = encoding.decode(content);
            if !had_errors {
                return Ok(decoded.to_string());
            }
        }
        
        // Fallback to UTF-8 with replacement characters
        return Ok(String::from_utf8_lossy(content).to_string());
    }
    
    Ok(decoded.to_string())
}

/// Process plain text
fn process_text(text: String, options: &ParseOptions) -> String {
    let mut processed = text;
    
    // Remove control characters except newlines and tabs
    processed = processed
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();
    
    // Normalize line endings
    processed = processed.replace("\r\n", "\n").replace('\r', "\n");
    
    // Remove excessive whitespace if not preserving formatting
    if !options.preserve_formatting {
        processed = normalize_whitespace(processed);
    }
    
    processed
}

/// Extract values from YAML content
fn extract_yaml_values(text: String, _options: &ParseOptions) -> String {
    let mut values = Vec::new();
    
    for line in text.lines() {
        let trimmed = line.trim();
        
        // Skip comments and empty lines
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        
        // Extract values from key-value pairs
        if let Some(colon_pos) = trimmed.find(':') {
            let value = trimmed[colon_pos + 1..].trim();
            if !value.is_empty() && value != "null" && value != "~" {
                // Remove quotes if present
                let clean_value = value.trim_matches('"').trim_matches('\'');
                if !clean_value.is_empty() {
                    values.push(clean_value.to_string());
                }
            }
        }
        // Handle list items
        else if trimmed.starts_with('-') {
            let value = trimmed[1..].trim();
            if !value.is_empty() {
                values.push(value.to_string());
            }
        }
    }
    
    values.join("\n")
}

/// Normalize whitespace
fn normalize_whitespace(text: String) -> String {
    // Replace multiple whitespace with single space
    let mut result = String::new();
    let mut prev_was_space = false;
    
    for c in text.chars() {
        if c.is_whitespace() {
            if !prev_was_space {
                if c == '\n' {
                    result.push('\n');
                } else {
                    result.push(' ');
                }
                prev_was_space = true;
            }
        } else {
            result.push(c);
            prev_was_space = false;
        }
    }
    
    result
}

/// Detect if text is likely code
pub fn is_likely_code(text: &str) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() < 5 {
        return false;
    }
    
    let mut code_indicators = 0;
    let mut total_lines = 0;
    
    for line in lines.iter().take(50) { // Check first 50 lines
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        
        total_lines += 1;
        
        // Check for code indicators
        if trimmed.contains("function ") 
            || trimmed.contains("def ") 
            || trimmed.contains("class ") 
            || trimmed.contains("import ") 
            || trimmed.contains("from ") 
            || trimmed.contains("const ") 
            || trimmed.contains("var ") 
            || trimmed.contains("let ") 
            || trimmed.contains("public ") 
            || trimmed.contains("private ") 
            || trimmed.contains("protected ") 
            || trimmed.contains("void ") 
            || trimmed.contains("int ") 
            || trimmed.contains("string ") 
            || trimmed.contains("bool ") 
            || trimmed.contains("return ") 
            || trimmed.contains("if (") 
            || trimmed.contains("for (") 
            || trimmed.contains("while (") 
            || trimmed.contains("} else {") 
            || trimmed.contains("};") 
            || trimmed.contains("});") 
            || trimmed.starts_with("//") 
            || trimmed.starts_with("/*") 
            || trimmed.starts_with("*") 
            || trimmed.starts_with("#") 
            || trimmed.starts_with("<?") 
            || trimmed.starts_with("<%") {
            code_indicators += 1;
        }
    }
    
    // If more than 30% of lines have code indicators, likely code
    total_lines > 0 && (code_indicators as f64 / total_lines as f64) > 0.3
}

/// Detect natural language
pub fn detect_natural_language(text: &str) -> String {
    // Simple language detection based on common words
    let text_lower = text.to_lowercase();
    
    // Chinese detection
    if text.chars().any(|c| {
        matches!(c, '\u{4e00}'..='\u{9fff}' | '\u{3400}'..='\u{4dbf}' | '\u{20000}'..='\u{2a6df}')
    }) {
        return "zh".to_string();
    }
    
    // English detection
    let english_words = ["the", "and", "of", "to", "a", "in", "is", "it", "you", "that"];
    let english_count = english_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // Japanese detection
    if text.chars().any(|c| {
        matches!(c, '\u{3040}'..='\u{309f}' | '\u{30a0}'..='\u{30ff}')
    }) {
        return "ja".to_string();
    }
    
    // Korean detection
    if text.chars().any(|c| {
        matches!(c, '\u{ac00}'..='\u{d7af}')
    }) {
        return "ko".to_string();
    }
    
    // French detection
    let french_words = ["le", "de", "et", "à", "un", "il", "être", "et", "en", "avoir"];
    let french_count = french_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // Spanish detection
    let spanish_words = ["el", "la", "de", "que", "y", "a", "en", "un", "es", "se"];
    let spanish_count = spanish_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // German detection
    let german_words = ["der", "die", "und", "in", "den", "von", "zu", "das", "mit", "sich"];
    let german_count = german_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // Return language with highest score
    let scores = vec![
        ("en", english_count),
        ("fr", french_count),
        ("es", spanish_count),
        ("de", german_count),
    ];
    
    scores.into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(lang, _)| lang.to_string())
        .unwrap_or_else(|| "en".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_decode_text() {
        let utf8_text = "Hello, 世界!";
        let result = decode_text(utf8_text.as_bytes()).unwrap();
        assert_eq!(result, utf8_text);
    }
    
    #[test]
    fn test_extract_yaml_values() {
        let yaml = "name: John\nage: 30\n# comment\naddress: 123 Main St";
        let result = extract_yaml_values(yaml.to_string(), &ParseOptions::default());
        assert!(result.contains("John"));
        assert!(result.contains("30"));
        assert!(result.contains("123 Main St"));
        assert!(!result.contains("comment"));
    }
    
    #[test]
    fn test_is_likely_code() {
        let code = "function test() {\n    return 42;\n}\n\nconst x = 5;\nif (x > 0) {\n    console.log('positive');\n}";
        assert!(is_likely_code(code));
        
        let text = "This is a regular text document with normal sentences.";
        assert!(!is_likely_code(text));
    }
    
    #[test]
    fn test_detect_natural_language() {
        let english = "The quick brown fox jumps over the lazy dog.";
        assert_eq!(detect_natural_language(english), "en");
        
        let chinese = "这是一个中文测试文本。";
        assert_eq!(detect_natural_language(chinese), "zh");
    }
}