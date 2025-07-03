# RAG Platform Development Standards

This document outlines the development standards and coding conventions for the RAG Platform project.

## 📋 Code Style & Formatting

### Python Code Standards

#### Code Formatting
- **Formatter**: Use Black for automatic code formatting
- **Line Length**: Maximum 88 characters (Black default)
- **Import Sorting**: Use isort to organize imports
- **PEP 8 Compliance**: Follow PEP 8 style guide

#### Type Hints
- **Mandatory**: All function parameters and return values must have type hints
- **Import Style**: Use `from typing import` for type annotations
- **Complex Types**: Use proper generic types (List[str], Dict[str, Any], etc.)

**Example**:
```python
from typing import List, Optional, Dict, Any

async def process_document(
    file_path: str,
    chunk_size: int = 1000,
    metadata: Optional[Dict[str, Any]] = None
) -> List[str]:
    """
    Process a document and return text chunks.
    
    Args:
        file_path: Path to the document file
        chunk_size: Size of each text chunk
        metadata: Additional metadata for processing
        
    Returns:
        List of processed text chunks
        
    Raises:
        FileNotFoundError: If the file doesn't exist
        ValueError: If chunk_size is invalid
    """
    # Implementation here
    pass
```

### Rust Code Standards

#### Code Formatting
- **Formatter**: Use rustfmt with default settings
- **Linting**: Use clippy for additional code quality checks
- **Edition**: Use Rust 2021 edition

#### Naming Conventions
- **Functions/Variables**: snake_case
- **Types/Structs**: PascalCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Modules**: snake_case

**Example**:
```rust
use std::collections::HashMap;

/// Represents a document chunk with metadata
#[derive(Debug, Clone)]
pub struct DocumentChunk {
    pub content: String,
    pub metadata: HashMap<String, String>,
    pub embedding: Option<Vec<f32>>,
}

impl DocumentChunk {
    /// Creates a new document chunk
    /// 
    /// # Arguments
    /// 
    /// * `content` - The text content of the chunk
    /// * `metadata` - Additional metadata for the chunk
    /// 
    /// # Returns
    /// 
    /// A new DocumentChunk instance
    pub fn new(content: String, metadata: HashMap<String, String>) -> Self {
        Self {
            content,
            metadata,
            embedding: None,
        }
    }
}
```

## 💬 Comment and Documentation Standards

### 🌍 Language Requirements
**IMPORTANT**: All code comments and documentation must be written in **English**.

#### Code Comments
- **Language**: English only
- **Style**: Clear, concise, and professional
- **Purpose**: Explain the "why", not the "what"
- **Frequency**: Comment complex logic, algorithms, and business rules

**Good Examples**:
```python
# Calculate similarity score using cosine distance
# This helps rank documents by relevance to the query
similarity_score = cosine_similarity(query_vector, doc_vector)

# Retry mechanism for API calls with exponential backoff
# Handles temporary network issues and rate limiting
for attempt in range(max_retries):
    try:
        response = await api_client.call()
        break
    except TemporaryError:
        await asyncio.sleep(2 ** attempt)
```

**Bad Examples**:
```python
# 计算相似度分数 (Chinese - not allowed)
similarity_score = cosine_similarity(query_vector, doc_vector)

# Add 1 to counter (obvious - unnecessary comment)
counter += 1
```

#### Function/Class Documentation
- **Language**: English only
- **Format**: Follow language-specific documentation standards
- **Content**: Include purpose, parameters, return values, and exceptions

**Python Docstring Example**:
```python
def embed_text(text: str, model: str = "text-embedding-v2") -> List[float]:
    """
    Generate text embeddings using the specified model.
    
    This function processes the input text and returns a vector representation
    suitable for semantic similarity calculations.
    
    Args:
        text: The input text to embed. Must be non-empty.
        model: The embedding model to use. Defaults to "text-embedding-v2".
        
    Returns:
        A list of floating-point numbers representing the text embedding.
        The vector dimension depends on the chosen model.
        
    Raises:
        ValueError: If text is empty or model is not supported.
        APIError: If the embedding service is unavailable.
        
    Example:
        >>> embedding = embed_text("Hello world")
        >>> len(embedding)
        1536
    """
    pass
```

**Rust Documentation Example**:
```rust
/// Processes documents and extracts text chunks
/// 
/// This function handles various document formats including PDF, DOCX, and TXT.
/// It automatically detects the format and applies appropriate parsing strategies.
/// 
/// # Arguments
/// 
/// * `file_path` - Path to the document file
/// * `chunk_size` - Maximum size of each text chunk in characters
/// * `overlap` - Number of overlapping characters between chunks
/// 
/// # Returns
/// 
/// A Result containing a vector of DocumentChunk objects on success,
/// or an error if processing fails.
/// 
/// # Errors
/// 
/// This function will return an error if:
/// * The file cannot be read
/// * The document format is not supported
/// * The chunk_size is less than 1
/// 
/// # Examples
/// 
/// ```
/// let chunks = process_document("document.pdf", 1000, 100)?;
/// println!("Extracted {} chunks", chunks.len());
/// ```
pub fn process_document(
    file_path: &str, 
    chunk_size: usize, 
    overlap: usize
) -> Result<Vec<DocumentChunk>, ProcessingError> {
    // Implementation here
}
```

## 🗂️ File and Directory Naming

### General Rules
- **Language**: English only
- **Style**: Use clear, descriptive names
- **Format**: snake_case for files, kebab-case for directories (when needed)

### Python Files
```
good_examples/
├── chat_service.py
├── document_processor.py
├── embedding_models.py
└── vector_database.py

bad_examples/
├── chatService.py          # Wrong case
├── 聊天服务.py             # Non-English
├── temp.py                 # Not descriptive
└── utils.py                # Too generic
```

### Rust Files
```
good_examples/
├── document_parser.rs
├── vector_store.rs
├── embedding_service.rs
└── grpc_server.rs
```

## 🔧 API Design Standards

### Endpoint Naming
- **Language**: English only
- **Style**: RESTful conventions
- **Format**: kebab-case for multi-word resources

**Good Examples**:
```
GET /api/v1/knowledge-bases
POST /api/v1/chat/completions
PUT /api/v1/documents/{doc_id}
DELETE /api/v1/workflows/{workflow_id}
```

### Request/Response Models
- **Field Names**: English, camelCase for JSON
- **Documentation**: English descriptions

**Example**:
```python
class ChatRequest(BaseModel):
    """Request model for chat completions."""
    
    message: str = Field(..., description="User input message")
    knowledge_base_id: Optional[str] = Field(
        None, 
        description="ID of knowledge base to query"
    )
    model: str = Field(
        default="qwen-turbo",
        description="Language model to use for response generation"
    )
    temperature: float = Field(
        default=0.7,
        ge=0.0,
        le=2.0,
        description="Randomness in model responses (0.0 to 2.0)"
    )
```

## 🧪 Testing Standards

### Test Naming
- **Language**: English only
- **Convention**: `test_<functionality>_<condition>_<expected_result>`

**Examples**:
```python
def test_chat_completion_with_valid_input_returns_response():
    """Test that chat completion returns valid response for valid input."""
    pass

def test_file_upload_with_large_file_raises_error():
    """Test that uploading oversized files raises appropriate error."""
    pass

def test_embedding_generation_with_empty_text_returns_error():
    """Test that empty text input returns validation error."""
    pass
```

### Test Documentation
```python
class TestDocumentProcessor:
    """Test cases for document processing functionality."""
    
    def test_pdf_parsing_extracts_text_correctly(self):
        """
        Test that PDF files are parsed correctly.
        
        Verifies that:
        - Text content is extracted accurately
        - Metadata is preserved
        - Page numbers are tracked
        """
        pass
```

## 📚 Database and Schema Design

### Table/Collection Naming
- **Language**: English only
- **Style**: snake_case for SQL, camelCase for NoSQL
- **Format**: Descriptive and plural for collections

**SQL Examples**:
```sql
-- Good
CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(id),
    content TEXT NOT NULL,
    embedding VECTOR(1536)
);
```

### Field Documentation
```sql
-- Add comments to explain business logic
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,  -- References users table
    created_at TIMESTAMP DEFAULT NOW(),
    -- Soft delete: keep sessions for audit purposes
    deleted_at TIMESTAMP NULL,
    -- JSON metadata for session configuration
    metadata JSONB DEFAULT '{}'::jsonb
);
```

## 🔄 Git Commit Standards

### Commit Message Format
- **Language**: English only
- **Format**: Conventional Commits specification

**Structure**:
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Examples**:
```
feat(chat): add streaming response support

Implement server-sent events for real-time chat responses.
This improves user experience by showing partial responses
as they are generated.

Closes #123

fix(auth): resolve token validation issue

The JWT token validation was failing for tokens with
custom claims. Updated the validation logic to properly
handle all token types.

docs(api): update chat endpoint documentation

Add examples for streaming and non-streaming requests
to improve API usability.
```

### Commit Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, etc.)
- **refactor**: Code refactoring
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

## 🚀 Code Review Guidelines

### Review Checklist
- [ ] All comments and documentation are in English
- [ ] Code follows established style guidelines
- [ ] Functions have proper type hints and documentation
- [ ] Variable and function names are descriptive and in English
- [ ] No hardcoded strings in non-English languages
- [ ] Error messages are in English
- [ ] Test cases are comprehensive and well-named

### Review Comments
- **Language**: English only
- **Tone**: Constructive and professional
- **Format**: Clear suggestions with examples

**Good Review Comments**:
```
Consider using a more descriptive variable name:
```python
# Instead of:
data = process(input)

# Use:
embedding_vectors = generate_embeddings(text_chunks)
```

The error handling could be more specific:
```python
# Add specific exception types
try:
    result = api_call()
except APITimeoutError:
    logger.warning("API timeout, retrying...")
except APIRateLimitError:
    logger.error("Rate limit exceeded")
```

## 📊 Performance Standards

### Code Performance
- **Async/Await**: Use for I/O operations
- **Type Checking**: Enable strict mode
- **Memory**: Avoid memory leaks in long-running processes

### Documentation Performance
- **Clarity**: Comments should improve code readability
- **Maintenance**: Update documentation when code changes
- **Examples**: Include practical examples in docstrings

## 🔧 Tool Configuration

### Python Tools
```toml
# pyproject.toml
[tool.black]
line-length = 88
target-version = ['py38']

[tool.isort]
profile = "black"
line_length = 88

[tool.mypy]
python_version = "3.8"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
```

### Rust Tools
```toml
# Cargo.toml
[package]
edition = "2021"

[dependencies]
# Add dependencies here
```

## 📝 Documentation Templates

### Function Template
```python
def function_name(param1: Type1, param2: Type2) -> ReturnType:
    """
    Brief description of what the function does.
    
    Longer description if needed, explaining the algorithm,
    business logic, or important implementation details.
    
    Args:
        param1: Description of parameter 1
        param2: Description of parameter 2
        
    Returns:
        Description of return value
        
    Raises:
        ExceptionType: Description of when this is raised
        
    Example:
        >>> result = function_name("input", 42)
        >>> print(result)
        "expected output"
    """
    pass
```

---

## 📝 Enforcement

### Automated Checks
- **Pre-commit hooks**: Enforce formatting and linting
- **CI/CD**: Run checks on every pull request
- **Code review**: Manual verification of standards

### Violations
- **First violation**: Gentle reminder in code review
- **Repeated violations**: Discussion with team lead
- **Consistent issues**: Additional training or pair programming

---

**Document Version**: 1.0  
**Last Updated**: December 2024  
**Next Review**: January 2025

This document is a living standard and will be updated as the project evolves. 