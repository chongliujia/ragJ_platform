use pyo3::prelude::*;
use pyo3::types::PyDict;
use std::collections::HashMap;

mod parsers;
mod error;
mod utils;
mod text_processor;

pub use error::{DocumentError, Result};
pub use parsers::*;
pub use text_processor::*;

#[pymodule]
fn document_processor(_py: Python, m: &PyModule) -> PyResult<()> {
    // Register the main parser function
    m.add_function(wrap_pyfunction!(parse_document, m)?)?;
    m.add_function(wrap_pyfunction!(get_supported_formats, m)?)?;
    m.add_function(wrap_pyfunction!(extract_metadata, m)?)?;
    m.add_function(wrap_pyfunction!(process_batch_documents, m)?)?;
    
    // Register text processing functions
    m.add_function(wrap_pyfunction!(clean_text, m)?)?;
    m.add_function(wrap_pyfunction!(chunk_text, m)?)?;
    m.add_function(wrap_pyfunction!(detect_language, m)?)?;
    
    Ok(())
}

/// Parse a document from bytes and return extracted text
#[pyfunction]
fn parse_document(
    content: &[u8],
    filename: &str,
    options: Option<&PyDict>,
) -> PyResult<String> {
    let opts = options.map(|d| parse_options(d)).transpose()?;
    
    match parsers::parse_document(content, filename, opts.as_ref()) {
        Ok(text) => Ok(text),
        Err(e) => Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("Document parsing failed: {}", e))),
    }
}

/// Get list of supported file formats
#[pyfunction]
fn get_supported_formats() -> PyResult<Vec<String>> {
    Ok(parsers::get_supported_formats())
}

/// Extract metadata from document
#[pyfunction]
fn extract_metadata(
    content: &[u8],
    filename: &str,
) -> PyResult<HashMap<String, String>> {
    match parsers::extract_metadata(content, filename) {
        Ok(metadata) => Ok(metadata),
        Err(e) => Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("Metadata extraction failed: {}", e))),
    }
}

/// Process multiple documents in batch
#[pyfunction]
fn process_batch_documents(
    documents: Vec<(Vec<u8>, String)>,
    options: Option<&PyDict>,
) -> PyResult<Vec<PyResult<String>>> {
    let opts = options.map(|d| parse_options(d)).transpose()?;
    
    let results: Vec<PyResult<String>> = documents
        .into_iter()
        .map(|(content, filename)| {
            match parsers::parse_document(&content, &filename, opts.as_ref()) {
                Ok(text) => Ok(text),
                Err(e) => Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("Document parsing failed: {}", e))),
            }
        })
        .collect();
    
    Ok(results)
}

/// Clean and normalize text
#[pyfunction]
fn clean_text(text: &str, options: Option<&PyDict>) -> PyResult<String> {
    let opts = options.map(|d| parse_text_options(d)).transpose()?;
    Ok(text_processor::clean_text(text, opts.as_ref()))
}

/// Chunk text into segments
#[pyfunction]
fn chunk_text(
    text: &str,
    chunk_size: usize,
    overlap: usize,
    options: Option<&PyDict>,
) -> PyResult<Vec<String>> {
    let opts = options.map(|d| parse_chunk_options(d)).transpose()?;
    Ok(text_processor::chunk_text(text, chunk_size, overlap, opts.as_ref()))
}

/// Detect text language
#[pyfunction]
fn detect_language(text: &str) -> PyResult<String> {
    Ok(text_processor::detect_language(text))
}

fn parse_options(dict: &PyDict) -> PyResult<parsers::ParseOptions> {
    let mut options = parsers::ParseOptions::default();
    
    if let Some(ocr) = dict.get_item("enable_ocr")? {
        options.enable_ocr = ocr.extract()?;
    }
    
    if let Some(tables) = dict.get_item("extract_tables")? {
        options.extract_tables = tables.extract()?;
    }
    
    if let Some(images) = dict.get_item("extract_images")? {
        options.extract_images = images.extract()?;
    }
    
    if let Some(lang) = dict.get_item("language")? {
        options.language = Some(lang.extract()?);
    }
    
    Ok(options)
}

fn parse_text_options(dict: &PyDict) -> PyResult<text_processor::CleanOptions> {
    let mut options = text_processor::CleanOptions::default();
    
    if let Some(normalize) = dict.get_item("normalize_unicode")? {
        options.normalize_unicode = normalize.extract()?;
    }
    
    if let Some(remove_extra) = dict.get_item("remove_extra_whitespace")? {
        options.remove_extra_whitespace = remove_extra.extract()?;
    }
    
    if let Some(fix_encoding) = dict.get_item("fix_encoding")? {
        options.fix_encoding = fix_encoding.extract()?;
    }
    
    Ok(options)
}

fn parse_chunk_options(dict: &PyDict) -> PyResult<text_processor::ChunkOptions> {
    let mut options = text_processor::ChunkOptions::default();
    
    if let Some(respect_sentences) = dict.get_item("respect_sentences")? {
        options.respect_sentences = respect_sentences.extract()?;
    }
    
    if let Some(respect_paragraphs) = dict.get_item("respect_paragraphs")? {
        options.respect_paragraphs = respect_paragraphs.extract()?;
    }
    
    Ok(options)
}