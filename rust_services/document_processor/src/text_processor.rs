use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Clone)]
pub struct CleanOptions {
    pub normalize_unicode: bool,
    pub remove_extra_whitespace: bool,
    pub fix_encoding: bool,
    pub remove_control_chars: bool,
    pub normalize_line_endings: bool,
}

impl Default for CleanOptions {
    fn default() -> Self {
        Self {
            normalize_unicode: true,
            remove_extra_whitespace: true,
            fix_encoding: true,
            remove_control_chars: true,
            normalize_line_endings: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChunkOptions {
    pub respect_sentences: bool,
    pub respect_paragraphs: bool,
    pub min_chunk_size: usize,
    pub max_chunk_size: usize,
}

impl Default for ChunkOptions {
    fn default() -> Self {
        Self {
            respect_sentences: true,
            respect_paragraphs: true,
            min_chunk_size: 100,
            max_chunk_size: 2000,
        }
    }
}

/// Clean and normalize text
pub fn clean_text(text: &str, options: Option<&CleanOptions>) -> String {
    let opts = options.unwrap_or(&CleanOptions::default());
    let mut result = text.to_string();
    
    // Normalize Unicode
    if opts.normalize_unicode {
        result = result.nfc().collect::<String>();
    }
    
    // Fix common encoding issues
    if opts.fix_encoding {
        result = fix_encoding_issues(result);
    }
    
    // Remove control characters
    if opts.remove_control_chars {
        result = remove_control_characters(result);
    }
    
    // Normalize line endings
    if opts.normalize_line_endings {
        result = normalize_line_endings(result);
    }
    
    // Remove extra whitespace
    if opts.remove_extra_whitespace {
        result = normalize_whitespace(result);
    }
    
    result
}

/// Chunk text into segments
pub fn chunk_text(
    text: &str,
    chunk_size: usize,
    overlap: usize,
    options: Option<&ChunkOptions>,
) -> Vec<String> {
    let opts = options.unwrap_or(&ChunkOptions::default());
    
    if text.len() <= chunk_size {
        return vec![text.to_string()];
    }
    
    if opts.respect_paragraphs {
        chunk_by_paragraphs(text, chunk_size, overlap, opts)
    } else if opts.respect_sentences {
        chunk_by_sentences(text, chunk_size, overlap, opts)
    } else {
        chunk_by_characters(text, chunk_size, overlap)
    }
}

/// Detect text language
pub fn detect_language(text: &str) -> String {
    // Simple language detection based on character sets and common words
    
    // Check for Chinese characters
    if text.chars().any(|c| {
        matches!(c, '\u{4e00}'..='\u{9fff}' | '\u{3400}'..='\u{4dbf}' | '\u{20000}'..='\u{2a6df}')
    }) {
        return "zh".to_string();
    }
    
    // Check for Japanese characters
    if text.chars().any(|c| {
        matches!(c, '\u{3040}'..='\u{309f}' | '\u{30a0}'..='\u{30ff}')
    }) {
        return "ja".to_string();
    }
    
    // Check for Korean characters
    if text.chars().any(|c| {
        matches!(c, '\u{ac00}'..='\u{d7af}')
    }) {
        return "ko".to_string();
    }
    
    // Check for Cyrillic (Russian)
    if text.chars().any(|c| {
        matches!(c, '\u{0400}'..='\u{04ff}')
    }) {
        return "ru".to_string();
    }
    
    // Check for Arabic
    if text.chars().any(|c| {
        matches!(c, '\u{0600}'..='\u{06ff}')
    }) {
        return "ar".to_string();
    }
    
    // For Latin-based languages, use word frequency
    detect_latin_language(text)
}

/// Fix common encoding issues
fn fix_encoding_issues(text: String) -> String {
    let mut result = text;
    
    // Fix common UTF-8 encoding issues
    let replacements = [
        ("â€™", "'"),       // Right single quotation mark
        ("â€œ", "\""),      // Left double quotation mark
        ("â€", "\""),       // Right double quotation mark
        ("â€"", "—"),       // Em dash
        ("â€"", "–"),       // En dash
        ("â€¢", "•"),       // Bullet
        ("Ã¡", "á"),        // á with encoding issue
        ("Ã©", "é"),        // é with encoding issue
        ("Ã­", "í"),        // í with encoding issue
        ("Ã³", "ó"),        // ó with encoding issue
        ("Ãº", "ú"),        // ú with encoding issue
    ];
    
    for (wrong, correct) in replacements {
        result = result.replace(wrong, correct);
    }
    
    result
}

/// Remove control characters
fn remove_control_characters(text: String) -> String {
    text.chars()
        .filter(|c| !c.is_control() || matches!(*c, '\n' | '\t' | '\r'))
        .collect()
}

/// Normalize line endings
fn normalize_line_endings(text: String) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Normalize whitespace
fn normalize_whitespace(text: String) -> String {
    use regex::Regex;
    
    let mut result = text;
    
    // Replace multiple spaces with single space
    if let Ok(space_regex) = Regex::new(r"[ \t]+") {
        result = space_regex.replace_all(&result, " ").to_string();
    }
    
    // Replace multiple newlines with double newlines (paragraph breaks)
    if let Ok(newline_regex) = Regex::new(r"\n{3,}") {
        result = newline_regex.replace_all(&result, "\n\n").to_string();
    }
    
    // Trim lines
    result = result
        .lines()
        .map(|line| line.trim())
        .collect::<Vec<_>>()
        .join("\n");
    
    result.trim().to_string()
}

/// Chunk text by paragraphs
fn chunk_by_paragraphs(text: &str, chunk_size: usize, overlap: usize, opts: &ChunkOptions) -> Vec<String> {
    let paragraphs: Vec<&str> = text.split("\n\n").collect();
    let mut chunks = Vec::new();
    let mut current_chunk = String::new();
    
    for paragraph in paragraphs {
        let para_len = paragraph.len();
        
        // If paragraph alone exceeds chunk size, split it further
        if para_len > chunk_size {
            // Finish current chunk if it has content
            if !current_chunk.is_empty() {
                chunks.push(current_chunk.trim().to_string());
                current_chunk.clear();
            }
            
            // Split large paragraph by sentences
            let para_chunks = if opts.respect_sentences {
                chunk_by_sentences(paragraph, chunk_size, overlap, opts)
            } else {
                chunk_by_characters(paragraph, chunk_size, overlap)
            };
            
            chunks.extend(para_chunks);
            continue;
        }
        
        // Check if adding this paragraph would exceed chunk size
        if current_chunk.len() + para_len + 2 > chunk_size && !current_chunk.is_empty() {
            chunks.push(current_chunk.trim().to_string());
            
            // Handle overlap
            if overlap > 0 && chunks.len() > 1 {
                let overlap_text = get_text_overlap(&current_chunk, overlap);
                current_chunk = overlap_text + "\n\n" + paragraph;
            } else {
                current_chunk = paragraph.to_string();
            }
        } else {
            if !current_chunk.is_empty() {
                current_chunk.push_str("\n\n");
            }
            current_chunk.push_str(paragraph);
        }
    }
    
    // Add remaining chunk
    if !current_chunk.trim().is_empty() {
        chunks.push(current_chunk.trim().to_string());
    }
    
    // Filter out chunks that are too small
    chunks.into_iter()
        .filter(|chunk| chunk.len() >= opts.min_chunk_size)
        .collect()
}

/// Chunk text by sentences
fn chunk_by_sentences(text: &str, chunk_size: usize, overlap: usize, opts: &ChunkOptions) -> Vec<String> {
    let sentences = split_into_sentences(text);
    let mut chunks = Vec::new();
    let mut current_chunk = String::new();
    
    for sentence in sentences {
        let sentence_len = sentence.len();
        
        // If sentence alone exceeds chunk size, split by characters
        if sentence_len > chunk_size {
            // Finish current chunk if it has content
            if !current_chunk.is_empty() {
                chunks.push(current_chunk.trim().to_string());
                current_chunk.clear();
            }
            
            let sentence_chunks = chunk_by_characters(&sentence, chunk_size, overlap);
            chunks.extend(sentence_chunks);
            continue;
        }
        
        // Check if adding this sentence would exceed chunk size
        if current_chunk.len() + sentence_len + 1 > chunk_size && !current_chunk.is_empty() {
            chunks.push(current_chunk.trim().to_string());
            
            // Handle overlap
            if overlap > 0 && chunks.len() > 1 {
                let overlap_text = get_text_overlap(&current_chunk, overlap);
                current_chunk = overlap_text + " " + &sentence;
            } else {
                current_chunk = sentence.to_string();
            }
        } else {
            if !current_chunk.is_empty() {
                current_chunk.push(' ');
            }
            current_chunk.push_str(&sentence);
        }
    }
    
    // Add remaining chunk
    if !current_chunk.trim().is_empty() {
        chunks.push(current_chunk.trim().to_string());
    }
    
    // Filter out chunks that are too small
    chunks.into_iter()
        .filter(|chunk| chunk.len() >= opts.min_chunk_size)
        .collect()
}

/// Chunk text by characters
fn chunk_by_characters(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    if text.len() <= chunk_size {
        return vec![text.to_string()];
    }
    
    let mut chunks = Vec::new();
    let mut start = 0;
    
    while start < text.len() {
        let end = std::cmp::min(start + chunk_size, text.len());
        let mut chunk_end = end;
        
        // Try to break at word boundary
        if end < text.len() {
            if let Some(space_pos) = text[start..end].rfind(' ') {
                chunk_end = start + space_pos;
            }
        }
        
        let chunk = text[start..chunk_end].trim().to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }
        
        // Move start position with overlap consideration
        start = if overlap > 0 && chunk_end > overlap {
            chunk_end - overlap
        } else {
            chunk_end
        };
        
        // Skip whitespace
        while start < text.len() && text.chars().nth(start).unwrap().is_whitespace() {
            start += 1;
        }
    }
    
    chunks
}

/// Split text into sentences
fn split_into_sentences(text: &str) -> Vec<String> {
    use regex::Regex;
    
    // More sophisticated sentence splitting
    if let Ok(sentence_regex) = Regex::new(r"(?<=[.!?])\s+(?=[A-Z])") {
        sentence_regex
            .split(text)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        // Fallback to simple splitting
        text.split('.')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }
}

/// Get text overlap from the end of a chunk
fn get_text_overlap(text: &str, overlap_size: usize) -> String {
    if text.len() <= overlap_size {
        return text.to_string();
    }
    
    let start_pos = text.len() - overlap_size;
    
    // Try to start at word boundary
    if let Some(space_pos) = text[start_pos..].find(' ') {
        text[start_pos + space_pos..].trim().to_string()
    } else {
        text[start_pos..].to_string()
    }
}

/// Detect Latin-based language using word frequency
fn detect_latin_language(text: &str) -> String {
    let text_lower = text.to_lowercase();
    
    // English common words
    let english_words = ["the", "and", "of", "to", "a", "in", "is", "it", "you", "that"];
    let english_score = english_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // Spanish common words
    let spanish_words = ["el", "la", "de", "que", "y", "a", "en", "un", "es", "se"];
    let spanish_score = spanish_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // French common words
    let french_words = ["le", "de", "et", "à", "un", "il", "être", "et", "en", "avoir"];
    let french_score = french_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // German common words
    let german_words = ["der", "die", "und", "in", "den", "von", "zu", "das", "mit", "sich"];
    let german_score = german_words.iter()
        .map(|word| text_lower.matches(word).count())
        .sum::<usize>();
    
    // Return language with highest score
    let scores = vec![
        ("en", english_score),
        ("es", spanish_score),
        ("fr", french_score),
        ("de", german_score),
    ];
    
    scores.into_iter()
        .max_by_key(|(_, score)| *score)
        .map(|(lang, _)| lang.to_string())
        .unwrap_or_else(|| "en".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_clean_text() {
        let input = "Hello   world!\r\nThis is a test.";
        let result = clean_text(input, None);
        assert_eq!(result, "Hello world!\nThis is a test.");
    }
    
    #[test]
    fn test_chunk_text() {
        let text = "This is sentence one. This is sentence two. This is sentence three.";
        let chunks = chunk_text(text, 30, 5, None);
        assert!(chunks.len() > 1);
        assert!(chunks[0].len() <= 30);
    }
    
    #[test]
    fn test_detect_language() {
        assert_eq!(detect_language("Hello world"), "en");
        assert_eq!(detect_language("你好世界"), "zh");
        assert_eq!(detect_language("こんにちは"), "ja");
        assert_eq!(detect_language("안녕하세요"), "ko");
    }
    
    #[test]
    fn test_split_into_sentences() {
        let text = "This is first. This is second! Is this third?";
        let sentences = split_into_sentences(text);
        assert_eq!(sentences.len(), 3);
    }
    
    #[test]
    fn test_normalize_whitespace() {
        let input = "Hello    world\n\n\n\nNext paragraph".to_string();
        let result = normalize_whitespace(input);
        assert_eq!(result, "Hello world\n\nNext paragraph");
    }
}