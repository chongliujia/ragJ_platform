# RAG Platform (ragJ_platform)

An open-source, high-performance RAG (Retrieval-Augmented Generation) platform built with Python and Rust, designed for enterprise-level document-based AI assistants.

## 🚀 Project Overview

This project aims to create a powerful RAG platform, inspired by systems like Dify, but with a focus on performance by leveraging Rust for core data processing tasks. The platform uses a microservices architecture, combining Rust's performance for document handling with Python's flexibility for business logic and API services.

### Core Features

-   🧠 **Intelligent Q&A**: Perform complex question-answering on your documents using a RAG pipeline.
-   📚 **Knowledge Base Management**: Easily create and manage distinct knowledge bases.
-   📄 **Multi-Format Document Support**: Upload and process various document formats (starting with `.txt` and `.md`).
-   🔌 **Flexible API**: A straightforward RESTful API for integration with any application.
-   🤖 **Multi-Model Support**: Supports DeepSeek, Qwen, and SiliconFlow APIs for different use cases.
-   ⚡ **High-Performance Backend**: FastAPI-based backend for asynchronous request handling.
-   🎨 **Modern Web Interface**: React-based frontend with Material-UI for intuitive management.
-   ⚙️ **Flexible Configuration**: Easy model switching and configuration management.
-   🌍 **Internationalization**: Support for Chinese and English language switching.

## 🏗️ System Architecture

## 🌐 Public API & Embedding

The platform exposes a simple public API (x-api-key) so you can validate workflows via chat and embed the assistant into any web page.

- Public endpoints (no login, require `x-api-key`):
  - `POST /api/v1/public/chat` — non-stream chat, request body is `ChatRequest`.
  - `POST /api/v1/public/chat/stream` — streaming chat (SSE), suitable for web embeds.
  - `POST /api/v1/public/workflows/{workflow_id}/execute` — run a saved workflow with input payload.

- Admin endpoints for API key management:
  - `POST /api/v1/admin/api-keys` — create a key (scopes: `chat`, `workflow`; optional `allowed_kb`, `allowed_workflow_id`).
  - `GET /api/v1/admin/api-keys` — list keys for your tenant.
  - `DELETE /api/v1/admin/api-keys/{id}` — revoke key.

### Embedding example

Option 1: iframe

```html
<iframe
  src="https://your-host/embed.html?api_key=YOUR_KEY&kb=your_kb&api_base=https://your-host"
  style="width: 100%; height: 560px; border: 1px solid #eee; border-radius: 8px"
></iframe>
```

Option 2: fetch from your own widget

```js
const res = await fetch('https://your-host/api/v1/public/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'YOUR_KEY' },
  body: JSON.stringify({ message: 'Hello', knowledge_base_id: 'your_kb' }),
});
// Read SSE chunks from res.body and render progressively.
```

Notes:
- Public chat supports RAG with `knowledge_base_id` and will route to your tenant’s KB automatically.
- Public workflow execution injects `tenant_id` and a system user for isolation and auditing.

The system is designed with a clean separation of concerns:

-   **FastAPI Backend (Python)**: Handles all API requests, business logic, and orchestration.
-   **React Frontend (TypeScript)**: Modern web interface with Material-UI components.
-   **Milvus**: Acts as the vector database for storing and retrieving document embeddings.
-   **Elasticsearch**: Provides full-text search capabilities for hybrid retrieval.
-   **Multi-Model Support**: Integrates with DeepSeek, Qwen, and SiliconFlow APIs.

## 📦 Quick Start

This guide will help you get the Python backend up and running from the source code.

### Prerequisites

-   Python 3.9+
-   An available Milvus instance.
-   A Dashscope API Key for the Qwen models.

### Local Setup

1.  **Clone the Repository**
    ```bash
    git clone <your-repo-url>
    cd ragJ_platform/backend
    ```

2.  **Configure Environment Variables**
    Create a `.env` file in the `backend/` directory by copying the example:
    ```bash
    cp .env.example .env
    ```
    Now, edit the `.env` file and set your credentials:
    ```
    # backend/.env

    # Your Dashscope API Key for Qwen models
    DASHSCOPE_API_KEY="your_sk_key_here"

    # Connection details for your Milvus instance
    MILVUS_HOST="localhost"
    MILVUS_PORT="19530"
    ```

3.  **Install Dependencies**
    It is highly recommended to use a virtual environment.
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    ```

4.  **Run the Server**
    ```bash
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    ```

5.  **Access the API**
    Once the server is running, you can access the interactive API documentation at:
    [http://localhost:8000/docs](http://localhost:8000/docs)

### Frontend Setup

The platform includes a modern React-based web interface for easy management.

1.  **Navigate to Frontend Directory**
    ```bash
    cd frontend
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Start Development Server**
    ```bash
    npm run dev
    ```

4.  **Access Web Interface**
    The frontend will be available at:
    [http://localhost:5173](http://localhost:5173)

### Web Interface Features

-   📊 **Dashboard**: System overview and statistics
-   📚 **Knowledge Base Management**: Create, delete, and manage knowledge bases
-   💬 **Intelligent Chat**: Interactive chat interface with knowledge base selection
-   ⚙️ **Model Configuration**: Easy setup for DeepSeek, Qwen, and SiliconFlow APIs
-   📝 **Document Management**: Upload and manage documents (coming soon)
-   🌍 **Language Support**: Switch between Chinese and English interface

## 🔧 API Usage Guide

Here is how to use the core RAG pipeline via the API.

### Step 1: Create a Knowledge Base

First, create a new knowledge base. This corresponds to a new "collection" in Milvus.

```bash
curl -X 'POST' \
  'http://localhost:8000/api/v1/knowledge-bases/' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my_first_kb",
    "description": "A knowledge base for testing."
  }'
```

A successful response will confirm that the knowledge base was created.

### Step 2: Upload a Document

Next, upload a document (`.txt` or `.md`) to your new knowledge base. The system will process it in the background (chunking, embedding, and indexing).

**Note:** Make sure you have a file named `sample.txt` in your current directory.

```bash
curl -X 'POST' \
  'http://localhost:8000/api/v1/knowledge-bases/my_first_kb/documents/' \
  -H 'accept: application/json' \
  -F 'file=@sample.txt;type=text/plain'
```

The API will respond immediately, confirming that the file has been accepted for processing.

### Step 3: Chat with Your Knowledge Base

Once the document has been processed, you can start asking questions. The system will retrieve relevant context from your documents to generate an answer.

```bash
curl -X 'POST' \
  'http://localhost:8000/api/v1/chat/' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "What is this document about?",
    "knowledge_base_id": "my_first_kb",
    "model": "qwen-turbo"
  }'
```

The response will contain the AI's answer, generated based on the content of the document you uploaded.

## 🤖 Model Configuration

The platform supports multiple AI model providers for different use cases:

### Supported Providers

#### DeepSeek
- **Best for**: Code generation, technical documentation
- **Models**: `deepseek-chat`, `deepseek-coder`
- **API**: https://api.deepseek.com/v1

#### Qwen (通义千问)
- **Best for**: Chinese language tasks, comprehensive AI capabilities
- **Models**: `qwen-turbo`, `qwen-plus`, `qwen-max`
- **API**: https://dashscope.aliyuncs.com/compatible-mode/v1

#### SiliconFlow (硅基流动)
- **Best for**: Cost-effective embedding and reranking
- **Models**: Various open-source models including BGE series
- **API**: https://api.siliconflow.cn/v1

### Configuration Presets

The web interface provides three pre-configured setups:

1. **Economic Configuration** (经济配置)
   - Chat: DeepSeek
   - Embedding: SiliconFlow BGE
   - Rerank: SiliconFlow BGE

2. **Premium Configuration** (高质量配置)
   - Chat: Qwen Max
   - Embedding: Qwen Embedding
   - Rerank: Qwen Rerank

3. **Chinese Optimized** (中文优化)
   - Chat: Qwen Plus
   - Embedding: SiliconFlow BGE Chinese
   - Rerank: SiliconFlow BGE Reranker

### API Key Setup

To configure your models:

1. Visit the **Settings** page in the web interface
2. Choose a preset or configure manually
3. Add your API keys for each provider
4. Test the connections
5. Save the configuration

### Language Support

The web interface supports both Chinese and English:

- **Language Switching**: Click the language switcher in the sidebar to change between Chinese (中文) and English
- **Auto Detection**: The system automatically detects your browser language preference
- **Persistent Settings**: Your language preference is saved locally and remembered across sessions

#### Supported Languages

- **Chinese (中文)**: Full interface translation for Chinese users
- **English**: Complete English interface for international users

All interface elements, including:
- Navigation menus
- Form labels and buttons
- Error messages and notifications
- Help text and descriptions
- Model configuration options

Are fully translated and localized for both languages.

## 📚 功能模块

### 1. 文档处理
- **支持格式**: PDF、DOCX、TXT、Markdown、HTML
- **处理能力**: 文本提取、结构化分析、元数据提取
- **分块策略**: 智能分块、固定长度、语义分割

### 2. 向量化服务
- **嵌入模型**: OpenAI、Hugging Face、本地模型
- **向量存储**: 高效索引和检索优化
- **相似性搜索**: 混合搜索（语义+关键词）

### 3. 问答系统
- **RAG流程**: 检索+生成的完整流程
- **模型支持**: GPT-4、Claude、开源LLM
- **上下文管理**: 多轮对话支持

### 3. LangGraph智能体系统
- **工作流构建**: 基于图的智能体工作流设计
- **状态管理**: 持久化的对话和任务状态
- **多智能体协作**: 支持智能体间的协作和通信
- **条件路由**: 基于条件的智能工作流路由

### 4. 知识库管理
- **组织结构**: 层级化知识库管理
- **权限控制**: 细粒度访问权限
- **版本控制**: 文档版本管理

## 🔒 安全配置

### API认证
```python
# 生成API密钥
from backend.app.core.security import generate_api_key

api_key = generate_api_key(user_id="user_123")
```

### 权限配置
```yaml
# config/permissions.yml
roles:
  admin:
    - knowledge_base:*
    - document:*
    - user:*
  user:
    - knowledge_base:read
    - document:upload
    - chat:query
```

## 🚀 部署配置

### 生产环境变量

```bash
# .env.production
DATABASE_URL=postgresql://user:pass@db:5432/ragj_platform
REDIS_URL=redis://redis:6379/0
QDRANT_URL=http://qdrant:6333
MINIO_ENDPOINT=minio:9000

# LLM配置
OPENAI_API_KEY=your_openai_key
OPENAI_BASE_URL=https://api.openai.com/v1

# 安全配置
SECRET_KEY=your_super_secret_key
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# 服务配置
API_V1_STR=/api/v1
PROJECT_NAME=RAG Platform
DEBUG=false
```

### 监控配置

```yaml
# docker-compose.monitoring.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
  
  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
```

## 📈 性能优化

### Rust服务优化
- 并发文档处理
- 内存映射文件读取
- SIMD向量计算优化

### 数据库优化
```sql
-- 向量检索索引
CREATE INDEX idx_embeddings_vector ON document_chunks 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 元数据查询索引
CREATE INDEX idx_documents_kb_id ON documents(knowledge_base_id);
CREATE INDEX idx_chunks_doc_id ON document_chunks(document_id);
```

### 缓存策略
- Redis缓存热点查询
- 嵌入向量缓存
- 文档处理结果缓存

## 🛠️ 开发指南

### 本地开发环境

```bash
# 安装开发依赖
pip install -r requirements-dev.txt

# 代码格式化
black backend/
rustfmt rust_services/src/**/*.rs

# 类型检查
mypy backend/app/

# 测试
pytest backend/tests/
cargo test --manifest-path rust_services/Cargo.toml
```

### API文档生成

```bash
# 启动服务后访问
http://localhost:8000/docs        # Swagger UI
http://localhost:8000/redoc       # ReDoc
http://localhost:8000/openapi.json # OpenAPI规范
```

## 🤝 贡献指南

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

## 📄 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🆘 支持与帮助

- 📧 邮箱: support@ragj-platform.com
- 💬 社区讨论: [GitHub Discussions](https://github.com/your-org/ragJ_platform/discussions)
- 🐛 问题反馈: [GitHub Issues](https://github.com/your-org/ragJ_platform/issues)
- 📖 完整文档: [Documentation](https://docs.ragj-platform.com)

## 🗺️ 开发路线图

- [x] 基础RAG功能实现
- [x] Rust高性能文档处理
- [x] API接口设计
- [ ] Web管理界面
- [ ] 多租户支持
- [ ] 企业级权限管理
- [ ] 性能监控与告警
- [ ] 插件系统
- [ ] 多语言支持

---

**注意**: 这是一个基础版本的实现，适用于学习和小规模部署。生产环境使用请根据实际需求进行安全加固和性能优化。
