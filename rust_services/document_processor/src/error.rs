use thiserror::Error;

pub type Result<T> = std::result::Result<T, DocumentError>;

#[derive(Error, Debug)]
pub enum DocumentError {
    #[error("Unsupported file format: {format}")]
    UnsupportedFormat { format: String },
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("PDF parsing error: {0}")]
    PdfError(String),
    
    #[error("DOCX parsing error: {0}")]
    DocxError(String),
    
    #[error("Excel parsing error: {0}")]
    ExcelError(String),
    
    #[error("PowerPoint parsing error: {0}")]
    PowerPointError(String),
    
    #[error("RTF parsing error: {0}")]
    RtfError(String),
    
    #[error("HTML parsing error: {0}")]
    HtmlError(String),
    
    #[error("XML parsing error: {0}")]
    XmlError(String),
    
    #[error("CSV parsing error: {0}")]
    CsvError(String),
    
    #[error("JSON parsing error: {0}")]
    JsonError(#[from] serde_json::Error),
    
    #[error("Text encoding error: {0}")]
    EncodingError(String),
    
    #[error("OCR error: {0}")]
    OcrError(String),
    
    #[error("Archive error: {0}")]
    ArchiveError(String),
    
    #[error("Empty document")]
    EmptyDocument,
    
    #[error("Corrupted document: {reason}")]
    CorruptedDocument { reason: String },
    
    #[error("Document too large: {size} bytes (max: {max_size} bytes)")]
    DocumentTooLarge { size: usize, max_size: usize },
    
    #[error("Processing timeout")]
    Timeout,
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("Memory allocation error")]
    OutOfMemory,
    
    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl DocumentError {
    pub fn pdf_error<S: Into<String>>(msg: S) -> Self {
        Self::PdfError(msg.into())
    }
    
    pub fn docx_error<S: Into<String>>(msg: S) -> Self {
        Self::DocxError(msg.into())
    }
    
    pub fn encoding_error<S: Into<String>>(msg: S) -> Self {
        Self::EncodingError(msg.into())
    }
    
    pub fn corrupted_document<S: Into<String>>(reason: S) -> Self {
        Self::CorruptedDocument { reason: reason.into() }
    }
}