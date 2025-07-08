use crate::error::{DocumentError, Result};
use crate::utils;
use std::collections::HashMap;

pub mod pdf;
pub mod docx;
pub mod excel;
pub mod powerpoint;
pub mod text;
pub mod html;
pub mod rtf;
pub mod csv;
pub mod json;
pub mod xml;
pub mod markdown;
pub mod epub;
pub mod odt;

#[derive(Debug, Clone)]
pub struct ParseOptions {
    pub enable_ocr: bool,
    pub extract_tables: bool,
    pub extract_images: bool,
    pub language: Option<String>,
    pub max_pages: Option<usize>,
    pub extract_metadata: bool,
    pub preserve_formatting: bool,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            enable_ocr: false,
            extract_tables: true,
            extract_images: false,
            language: None,
            max_pages: None,
            extract_metadata: true,
            preserve_formatting: false,
        }
    }
}

/// Main document parsing function
pub fn parse_document(
    content: &[u8],
    filename: &str,
    options: Option<&ParseOptions>,
) -> Result<String> {
    let opts = options.unwrap_or(&ParseOptions::default());
    
    // Validate file size (100MB limit)
    utils::validate_file_size(content, 100 * 1024 * 1024)?;
    
    // Detect file type
    let file_type = utils::detect_file_type(filename, content)?;
    
    // Parse based on file type
    match file_type.as_str() {
        "pdf" => pdf::parse_pdf(content, opts),
        "docx" => docx::parse_docx(content, opts),
        "doc" => docx::parse_doc(content, opts),
        "xlsx" => excel::parse_xlsx(content, opts),
        "xls" => excel::parse_xls(content, opts),
        "pptx" => powerpoint::parse_pptx(content, opts),
        "ppt" => powerpoint::parse_ppt(content, opts),
        "txt" => text::parse_txt(content, opts),
        "markdown" => markdown::parse_markdown(content, opts),
        "html" => html::parse_html(content, opts),
        "rtf" => rtf::parse_rtf(content, opts),
        "csv" => csv::parse_csv(content, opts),
        "json" => json::parse_json(content, opts),
        "xml" => xml::parse_xml(content, opts),
        "yaml" => text::parse_yaml(content, opts),
        "epub" => epub::parse_epub(content, opts),
        "odt" => odt::parse_odt(content, opts),
        "ods" => odt::parse_ods(content, opts),
        "odp" => odt::parse_odp(content, opts),
        _ => Err(DocumentError::UnsupportedFormat { 
            format: file_type 
        }),
    }
}

/// Extract metadata from document
pub fn extract_metadata(content: &[u8], filename: &str) -> Result<HashMap<String, String>> {
    let file_type = utils::detect_file_type(filename, content)?;
    
    match file_type.as_str() {
        "pdf" => pdf::extract_pdf_metadata(content),
        "docx" => docx::extract_docx_metadata(content),
        "xlsx" => excel::extract_excel_metadata(content),
        "pptx" => powerpoint::extract_pptx_metadata(content),
        _ => {
            let mut metadata = HashMap::new();
            metadata.insert("file_type".to_string(), file_type);
            metadata.insert("file_size".to_string(), content.len().to_string());
            Ok(metadata)
        }
    }
}

/// Get list of supported file formats
pub fn get_supported_formats() -> Vec<String> {
    vec![
        "pdf".to_string(),
        "docx".to_string(),
        "doc".to_string(),
        "xlsx".to_string(),
        "xls".to_string(),
        "pptx".to_string(),
        "ppt".to_string(),
        "txt".to_string(),
        "markdown".to_string(),
        "html".to_string(),
        "rtf".to_string(),
        "csv".to_string(),
        "json".to_string(),
        "xml".to_string(),
        "yaml".to_string(),
        "epub".to_string(),
        "odt".to_string(),
        "ods".to_string(),
        "odp".to_string(),
    ]
}