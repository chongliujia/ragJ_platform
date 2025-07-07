# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Backend Development
```bash
# Navigate to backend directory
cd backend

# Install dependencies (use virtual environment)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Code formatting and linting
black .
isort .
mypy app/

# Run tests
pytest tests/
```

### Frontend Development
```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Lint code
npm run lint
```

### Docker Development
```bash
# Start Elasticsearch (required for development)
docker-compose up -d

# Stop services
docker-compose down
```

## High-Level Architecture

### Project Structure
- **backend/**: Python FastAPI backend with async support
- **frontend/**: React TypeScript web interface with Material-UI
- **elasticsearch_custom/**: Custom Elasticsearch configurations
- **project_management/**: Documentation and milestone tracking

### Core Technology Stack
- **Backend**: FastAPI + Python 3.9+ with async/await patterns
- **AI Framework**: LangGraph for intelligent workflows
- **Vector Database**: Milvus (primary), Qdrant (secondary)
- **Search Engine**: Elasticsearch for hybrid retrieval
- **Frontend**: React 19 + TypeScript + Material-UI
- **LLM Integration**: Multiple providers (DeepSeek, Qwen/DashScope, SiliconFlow)

### Key Service Architecture
The system follows a microservices pattern with distinct service layers:
- **API Layer**: FastAPI with OpenAPI documentation at `/docs`
- **Service Layer**: Separate services for chat, documents, LLM integration
- **Data Layer**: Multiple storage backends (Milvus, Elasticsearch, PostgreSQL)
- **AI Integration**: Multi-provider LLM support with unified interfaces

### Configuration Management
- Environment variables configured in `backend/.env`
- Multi-provider AI model configuration with presets
- Development uses local Elasticsearch via docker-compose
- Production requires external Milvus instance

### RAG Pipeline Implementation
The platform implements a complete RAG pipeline:
1. **Document Ingestion**: Multi-format support (PDF, DOCX, TXT, MD)
2. **Text Processing**: Chunking and vectorization via embedding models
3. **Hybrid Retrieval**: Combines vector similarity with keyword search
4. **Generation**: Multi-provider LLM integration with prompt templates
5. **Knowledge Base Management**: Organized document collections

### API Design Patterns
- RESTful APIs with consistent `/api/v1/` prefix
- Async request handlers throughout
- Comprehensive error handling and logging
- JWT authentication framework (partially implemented)
- OpenAPI/Swagger documentation auto-generation

### Key Dependencies
- **LangGraph**: For intelligent agent workflows
- **PyMilvus**: Vector database operations
- **DashScope**: Qwen model integration
- **FastAPI**: Modern async web framework
- **SQLAlchemy**: Database ORM
- **Pydantic**: Data validation and serialization

### Development Patterns
- Service-oriented architecture with clear separation of concerns
- Async/await patterns for I/O operations
- Type hints throughout Python codebase
- Environment-based configuration management
- Comprehensive logging with structured output

### Testing Strategy
- **Unit tests**: Using pytest with async support
- **Integration tests**: API endpoint testing
- **Code quality**: Black, isort, mypy for Python; ESLint for TypeScript
- **Performance testing**: Planned for core RAG pipeline

## Important Notes

### Multi-Language Support
- Web interface supports Chinese and English via i18next
- API responses adapt to user language preferences
- Model configurations optimized for Chinese language tasks

### AI Model Configuration
The platform supports multiple AI providers with different optimization strategies:
- **Economic**: DeepSeek + SiliconFlow BGE
- **Premium**: Qwen Max + Qwen Embedding
- **Chinese Optimized**: Qwen Plus + BGE Chinese models

### Development Phases
Current status: **Phase III** (Web interface and production readiness)
- Phase I ✅: Basic framework and API structure
- Phase II ✅: Core RAG pipeline implementation
- Phase III 🚧: Web interface and production features
- Phase IV 📅: Rust integration and advanced workflows
- Phase V 📅: Enterprise features (RBAC, monitoring)

### Required External Services
- **Milvus**: Vector database (local or cloud instance)
- **Elasticsearch**: Full-text search (via docker-compose for dev)
- **AI APIs**: At least one of DeepSeek, Qwen, or SiliconFlow API keys

### Key Configuration Files
- `backend/.env`: Environment variables and API keys
- `backend/app/core/config.py`: Application configuration
- `docker-compose.yml`: Local Elasticsearch setup
- `frontend/src/i18n/`: Internationalization resources