use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;

/// Parse CSV content
pub fn parse_csv(content: &[u8], options: &ParseOptions) -> Result<String> {
    let csv_str = String::from_utf8_lossy(content);
    
    let mut reader = csv::Reader::from_reader(csv_str.as_bytes());
    let mut text = String::new();
    
    // Extract headers if available
    if let Ok(headers) = reader.headers() {
        if options.preserve_formatting {
            text.push_str(&format!("Headers: {}\n\n", headers.iter().collect::<Vec<_>>().join(", ")));
        }
    }
    
    // Extract data rows
    let mut row_count = 0;
    for result in reader.records() {
        match result {
            Ok(record) => {
                if options.preserve_formatting {
                    // Tab-separated for structured output
                    text.push_str(&record.iter().collect::<Vec<_>>().join("\t"));
                } else {
                    // Space-separated for natural text
                    text.push_str(&record.iter().collect::<Vec<_>>().join(" "));
                }
                text.push('\n');
                row_count += 1;
                
                // Limit output for very large CSV files
                if row_count > 10000 {
                    text.push_str("... (truncated, too many rows)\n");
                    break;
                }
            }
            Err(e) => {
                return Err(DocumentError::CsvError(format!("CSV parsing error: {}", e)));
            }
        }
    }
    
    if text.trim().is_empty() {
        return Err(DocumentError::CsvError("No data found in CSV".to_string()));
    }
    
    Ok(text)
}