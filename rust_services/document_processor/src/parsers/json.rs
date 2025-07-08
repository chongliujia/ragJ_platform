use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse JSON content
pub fn parse_json(content: &[u8], options: &ParseOptions) -> Result<String> {
    let json_str = String::from_utf8_lossy(content);
    
    // Parse and validate JSON
    let json_value: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| DocumentError::JsonError(e))?;
    
    if options.preserve_formatting {
        // Pretty-print JSON
        Ok(serde_json::to_string_pretty(&json_value)?)
    } else {
        // Extract text values from JSON
        Ok(extract_json_text_values(&json_value))
    }
}

/// Extract text values from JSON structure
fn extract_json_text_values(value: &serde_json::Value) -> String {
    let mut text_values = Vec::new();
    collect_text_values(value, &mut text_values);
    text_values.join("\n")
}

/// Recursively collect text values from JSON
fn collect_text_values(value: &serde_json::Value, text_values: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => {
            if !s.trim().is_empty() {
                text_values.push(s.clone());
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_text_values(item, text_values);
            }
        }
        serde_json::Value::Object(obj) => {
            for (key, val) in obj {
                // Include key names as context
                if is_meaningful_key(key) {
                    text_values.push(format!("{}: ", key));
                }
                collect_text_values(val, text_values);
            }
        }
        serde_json::Value::Number(n) => {
            text_values.push(n.to_string());
        }
        serde_json::Value::Bool(b) => {
            text_values.push(b.to_string());
        }
        serde_json::Value::Null => {
            // Skip null values
        }
    }
}

/// Check if a key name is meaningful for text extraction
fn is_meaningful_key(key: &str) -> bool {
    let meaningful_keys = [
        "title", "name", "description", "content", "text", "message",
        "summary", "body", "comment", "note", "label", "caption",
        "heading", "paragraph", "sentence", "word", "phrase",
    ];
    
    let key_lower = key.to_lowercase();
    meaningful_keys.iter().any(|&mk| key_lower.contains(mk))
}