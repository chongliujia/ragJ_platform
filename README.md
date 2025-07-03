# RAG Platform (ragJ_platform)

基于Rust和Python构建的高性能RAG（检索增强生成）平台，提供企业级文档智能问答和AI助手服务。

## 🚀 项目概述

RAG Platform是一个模仿Dify但使用Rust优化核心性能的开源RAG平台，旨在为企业提供高效、可扩展的文档智能服务。平台采用微服务架构，结合Rust的高性能文档处理能力和Python的灵活业务逻辑处理。

### 核心特性

- 🚀 **高性能文档处理**: 使用Rust实现文档解析、分块和向量化
- 🧠 **智能问答系统**: 基于RAG技术的文档问答
- 🤖 **LangGraph智能体**: 支持复杂的多智能体工作流和状态管理
- 🔄 **工作流编排**: 可视化的智能体工作流设计和执行
- 🔌 **灵活的API接口**: 支持多种LLM模型，易于集成
- 📚 **多格式支持**: PDF、DOCX、TXT、Markdown等文档格式
- 🎯 **企业级部署**: 支持容器化部署和水平扩展
- 🌐 **Web管理界面**: 直观的知识库管理和配置界面

## 🏗️ 系统架构

```
用户界面 → API网关 → Python后端 ← Rust服务
                        ↓
                    关系型数据库
                        ↓
                    向量数据库 ← LLM服务
```

### 技术栈

**后端服务**:
- Python: FastAPI、SQLAlchemy、Celery、LangGraph
- Rust: 文档处理、向量操作、gRPC服务

**数据存储**:
- PostgreSQL: 元数据存储
- Qdrant/Milvus: 向量数据库
- MinIO/S3: 文档存储

**其他组件**:
- Docker: 容器化部署
- gRPC: 服务间通信
- Redis: 缓存和消息队列

## 📦 快速开始

### 环境要求

- Python 3.8+
- Rust 1.70+
- Docker & Docker Compose
- PostgreSQL 12+
- Redis 6+

### 源码部署

1. **克隆项目**
```bash
git clone <your-repo-url>
cd ragJ_platform
```

2. **环境配置**
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库连接等信息
```

3. **启动基础服务**
```bash
# 启动数据库和缓存服务
docker-compose up -d postgres redis minio qdrant
```

4. **构建Rust服务**
```bash
cd rust_services
cargo build --release
```

5. **安装Python依赖**
```bash
cd backend
pip install -r requirements.txt
```

6. **数据库初始化**
```bash
cd backend
python -m alembic upgrade head
```

7. **启动服务**
```bash
# 启动Python后端
cd backend
python main.py

# 启动Rust文档处理服务（新终端）
cd rust_services/document_processor
cargo run --release

# 启动Rust向量存储服务（新终端）
cd rust_services/vector_store_service
cargo run --release
```

8. **访问服务**
- API文档: http://localhost:8000/docs
- 管理界面: http://localhost:3000 (需要启动前端)

### Docker Compose部署

```bash
# 一键启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

## 🔧 API使用指南

### AI助手接口

平台提供标准的RESTful API，方便网站集成AI助手功能。

#### 1. 文档上传

```bash
curl -X POST "http://localhost:8000/api/v1/documents/upload" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@document.pdf" \
  -F "knowledge_base_id=kb_123"
```

#### 2. 知识库问答

```bash
curl -X POST "http://localhost:8000/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "knowledge_base_id": "kb_123",
    "message": "什么是人工智能？",
    "model": "gpt-3.5-turbo",
    "stream": false
  }'
```

#### 3. 创建知识库

```bash
curl -X POST "http://localhost:8000/api/v1/knowledge-bases" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "我的知识库",
    "description": "企业文档知识库",
    "embedding_model": "text-embedding-ada-002"
  }'
```

#### 4. 创建智能体工作流

```bash
curl -X POST "http://localhost:8000/api/v1/agents/workflows" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "客服助手工作流",
    "description": "基于知识库的智能客服",
    "graph": {
      "nodes": [
        {
          "id": "intent_detection",
          "type": "classifier",
          "config": {"model": "gpt-3.5-turbo"}
        },
        {
          "id": "knowledge_retrieval", 
          "type": "rag_retriever",
          "config": {"knowledge_base_id": "kb_123"}
        },
        {
          "id": "response_generation",
          "type": "generator",
          "config": {"model": "gpt-4"}
        }
      ],
      "edges": [
        {"from": "intent_detection", "to": "knowledge_retrieval"},
        {"from": "knowledge_retrieval", "to": "response_generation"}
      ]
    }
  }'
```

#### 5. 执行智能体工作流

```bash
curl -X POST "http://localhost:8000/api/v1/agents/workflows/{workflow_id}/execute" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "input": {
      "message": "如何退换货？",
      "context": {"user_id": "user_123", "session_id": "session_456"}
    },
    "config": {
      "stream": true,
      "debug": false
    }
  }'
```

### JavaScript SDK示例

```javascript
// 安装: npm install @ragj/platform-sdk

import { RAGClient } from '@ragj/platform-sdk';

const client = new RAGClient({
  baseURL: 'http://localhost:8000',
  apiKey: 'YOUR_API_KEY'
});

// 问答对话
const response = await client.chat({
  knowledgeBaseId: 'kb_123',
  message: '什么是RAG技术？',
  stream: true
});

// 流式响应处理
for await (const chunk of response) {
  console.log(chunk.content);
}
```

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
