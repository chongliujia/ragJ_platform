use crate::error::{DocumentError, Result};
use crate::parsers::ParseOptions;
use std::collections::HashMap;
use std::io::Cursor;

/// Parse Excel XLSX file
pub fn parse_xlsx(content: &[u8], options: &ParseOptions) -> Result<String> {
    use calamine::{Reader, Xlsx, open_workbook_from_rs};
    
    let cursor = Cursor::new(content);
    
    match open_workbook_from_rs::<Xlsx<_>, _>(cursor) {
        Ok(mut workbook) => {
            let mut all_text = String::new();
            
            // Get all worksheet names
            let sheet_names: Vec<String> = workbook.sheet_names().to_vec();
            
            for sheet_name in sheet_names {
                if let Some(range) = workbook.worksheet_range(&sheet_name) {
                    match range {
                        Ok(range) => {
                            let sheet_text = extract_sheet_text(&range, &sheet_name, options);
                            if !sheet_text.trim().is_empty() {
                                all_text.push_str(&format!("\n=== {} ===\n", sheet_name));
                                all_text.push_str(&sheet_text);
                                all_text.push('\n');
                            }
                        }
                        Err(e) => {
                            eprintln!("Warning: Could not read sheet '{}': {}", sheet_name, e);
                        }
                    }
                }
            }
            
            if all_text.trim().is_empty() {
                return Err(DocumentError::ExcelError("No data found in Excel file".to_string()));
            }
            
            Ok(all_text)
        }
        Err(e) => Err(DocumentError::ExcelError(format!("Failed to open Excel file: {}", e))),
    }
}

/// Parse legacy Excel XLS file
pub fn parse_xls(content: &[u8], options: &ParseOptions) -> Result<String> {
    use calamine::{Reader, Xls, open_workbook_from_rs};
    
    let cursor = Cursor::new(content);
    
    match open_workbook_from_rs::<Xls<_>, _>(cursor) {
        Ok(mut workbook) => {
            let mut all_text = String::new();
            
            // Get all worksheet names
            let sheet_names: Vec<String> = workbook.sheet_names().to_vec();
            
            for sheet_name in sheet_names {
                if let Some(range) = workbook.worksheet_range(&sheet_name) {
                    match range {
                        Ok(range) => {
                            let sheet_text = extract_sheet_text(&range, &sheet_name, options);
                            if !sheet_text.trim().is_empty() {
                                all_text.push_str(&format!("\n=== {} ===\n", sheet_name));
                                all_text.push_str(&sheet_text);
                                all_text.push('\n');
                            }
                        }
                        Err(e) => {
                            eprintln!("Warning: Could not read sheet '{}': {}", sheet_name, e);
                        }
                    }
                }
            }
            
            if all_text.trim().is_empty() {
                return Err(DocumentError::ExcelError("No data found in Excel file".to_string()));
            }
            
            Ok(all_text)
        }
        Err(e) => Err(DocumentError::ExcelError(format!("Failed to open Excel file: {}", e))),
    }
}

/// Extract text from worksheet range
fn extract_sheet_text(range: &calamine::Range<calamine::DataType>, sheet_name: &str, options: &ParseOptions) -> String {
    let mut text = String::new();
    
    if range.is_empty() {
        return text;
    }
    
    let (start_row, start_col) = range.start().unwrap_or((0, 0));
    let (end_row, end_col) = range.end().unwrap_or((0, 0));
    
    // Extract data row by row
    for row in start_row..=end_row {
        let mut row_data = Vec::new();
        let mut has_data = false;
        
        for col in start_col..=end_col {
            if let Some(cell) = range.get_value((row, col)) {
                let cell_text = format_cell_value(cell);
                row_data.push(cell_text);
                if !cell_text.trim().is_empty() {
                    has_data = true;
                }
            } else {
                row_data.push(String::new());
            }
        }
        
        // Only add row if it has data
        if has_data {
            if options.preserve_formatting {
                // Use tab separation for structured data
                text.push_str(&row_data.join("\t"));
            } else {
                // Use space separation for more natural text
                text.push_str(&row_data.join(" "));
            }
            text.push('\n');
        }
    }
    
    text
}

/// Format cell value to string
fn format_cell_value(cell: &calamine::DataType) -> String {
    use calamine::DataType;
    
    match cell {
        DataType::Empty => String::new(),
        DataType::String(s) => s.clone(),
        DataType::Float(f) => {
            // Format numbers nicely
            if f.fract() == 0.0 {
                format!("{:.0}", f)
            } else {
                format!("{:.2}", f)
            }
        }
        DataType::Int(i) => i.to_string(),
        DataType::Bool(b) => b.to_string(),
        DataType::DateTime(dt) => {
            // Format datetime as ISO string
            format!("{:.0}", dt)
        }
        DataType::Error(e) => format!("ERROR: {:?}", e),
        DataType::DateTimeIso(dt) => dt.clone(),
        DataType::DurationIso(d) => d.clone(),
    }
}

/// Extract metadata from Excel file
pub fn extract_excel_metadata(content: &[u8]) -> Result<HashMap<String, String>> {
    use calamine::{Reader, Xlsx, open_workbook_from_rs};
    
    let cursor = Cursor::new(content);
    
    match open_workbook_from_rs::<Xlsx<_>, _>(cursor) {
        Ok(mut workbook) => {
            let mut metadata = HashMap::new();
            
            metadata.insert("file_type".to_string(), "xlsx".to_string());
            metadata.insert("file_size".to_string(), content.len().to_string());
            
            // Get worksheet information
            let sheet_names: Vec<String> = workbook.sheet_names().to_vec();
            metadata.insert("sheet_count".to_string(), sheet_names.len().to_string());
            metadata.insert("sheet_names".to_string(), sheet_names.join(", "));
            
            // Count total cells with data
            let mut total_cells = 0;
            let mut total_rows = 0;
            
            for sheet_name in sheet_names {
                if let Some(range) = workbook.worksheet_range(&sheet_name) {
                    if let Ok(range) = range {
                        if !range.is_empty() {
                            let (start_row, start_col) = range.start().unwrap_or((0, 0));
                            let (end_row, end_col) = range.end().unwrap_or((0, 0));
                            
                            total_rows += end_row - start_row + 1;
                            
                            for row in start_row..=end_row {
                                for col in start_col..=end_col {
                                    if let Some(cell) = range.get_value((row, col)) {
                                        if !matches!(cell, calamine::DataType::Empty) {
                                            total_cells += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            metadata.insert("total_cells".to_string(), total_cells.to_string());
            metadata.insert("total_rows".to_string(), total_rows.to_string());
            
            Ok(metadata)
        }
        Err(e) => Err(DocumentError::ExcelError(format!("Failed to extract metadata: {}", e))),
    }
}

/// Check if Excel file has formulas
pub fn has_formulas(content: &[u8]) -> bool {
    // This would require more detailed analysis of the Excel file structure
    // For now, return false as a placeholder
    false
}

/// Extract formulas from Excel file
pub fn extract_formulas(content: &[u8]) -> Result<Vec<String>> {
    // This would require accessing the formula data in Excel files
    // For now, return empty vector
    Ok(vec![])
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::DataType;
    
    #[test]
    fn test_format_cell_value() {
        assert_eq!(format_cell_value(&DataType::String("test".to_string())), "test");
        assert_eq!(format_cell_value(&DataType::Float(42.0)), "42");
        assert_eq!(format_cell_value(&DataType::Float(42.5)), "42.50");
        assert_eq!(format_cell_value(&DataType::Int(42)), "42");
        assert_eq!(format_cell_value(&DataType::Bool(true)), "true");
        assert_eq!(format_cell_value(&DataType::Empty), "");
    }
}