# LangGraph RAG API 文档

## 概述

LangGraph RAG API 提供了一个基于 LangGraph 的智能对话系统，支持知识库检索增强生成（RAG）功能。该系统通过状态图工作流管理整个对话过程，提供更好的可控性和可观察性。

## 核心特性

### 🔄 状态管理
- 自动管理对话状态和上下文
- 支持复杂的对话流程控制
- 状态持久化和恢复

### 🌊 工作流控制
- 条件分支和错误处理
- 并行处理支持
- 优雅的降级机制

### 📊 可观察性
- 每个步骤的执行状态跟踪
- 详细的性能指标
- 错误诊断和调试信息

## API 端点

### 1. 标准聊天端点

```http
POST /api/v1/chat/
```

**功能**: 智能路由聊天请求，自动选择RAG或标准聊天模式

**请求体**:
```json
{
  "message": "什么是RAG技术？",
  "knowledge_base_id": "test1",
  "model": "deepseek-chat",
  "chat_id": "optional_chat_id"
}
```

**响应**:
```json
{
  "message": "RAG（检索增强生成）是一种结合了信息检索和文本生成的AI技术...",
  "chat_id": "chat_12345",
  "model": "deepseek-chat",
  "usage": {
    "tokens": 150
  },
  "timestamp": "2025-07-09T20:30:00Z"
}
```

### 2. 专用RAG端点

```http
POST /api/v1/chat/rag
```

**功能**: 专门用于RAG对话的LangGraph端点

**请求体**:
```json
{
  "message": "请解释一下深度学习的基本原理",
  "knowledge_base_id": "ml_knowledge_base",
  "model": "deepseek-chat",
  "chat_id": "rag_chat_001"
}
```

**响应**:
```json
{
  "message": "深度学习是机器学习的一个分支，基于人工神经网络...\n\n📚 参考文档：深度学习基础.pdf、神经网络原理.docx",
  "chat_id": "rag_chat_001",
  "model": "deepseek-chat",
  "usage": {
    "tokens": 300,
    "retrieved_docs": 5,
    "reranked_docs": 3
  },
  "timestamp": "2025-07-09T20:30:00Z"
}
```

## 工作流步骤

### 1. analyze_query
- **功能**: 分析用户查询的意图和复杂度
- **输入**: 用户查询文本
- **输出**: 查询分析结果（意图、复杂度、语言等）

### 2. generate_embedding
- **功能**: 为用户查询生成向量嵌入
- **输入**: 查询文本
- **输出**: 查询向量或错误状态

### 3. retrieve_documents
- **功能**: 使用混合搜索检索相关文档
- **输入**: 查询向量、查询文本
- **输出**: 检索到的文档列表

### 4. rerank_documents
- **功能**: 对检索到的文档进行重新排序
- **输入**: 文档列表、查询文本
- **输出**: 重新排序的文档

### 5. generate_response
- **功能**: 基于上下文生成最终回答
- **输入**: 重新排序的文档、查询文本
- **输出**: AI回答

### 6. fallback_response
- **功能**: 当RAG失败时的备用回答
- **输入**: 查询文本
- **输出**: 备用回答

## 决策点

### should_retrieve
- **条件**: 检查向量嵌入是否生成成功
- **路径**: 
  - `retrieve`: 嵌入生成成功 → 执行文档检索
  - `fallback`: 嵌入生成失败 → 执行备用回答

### should_rerank
- **条件**: 检查是否检索到文档
- **路径**:
  - `rerank`: 检索到文档 → 执行重新排序
  - `fallback`: 未检索到文档 → 执行备用回答

## 使用示例

### Python SDK 示例

```python
import asyncio
from app.services.langgraph_chat_service import langgraph_chat_service
from app.schemas.chat import ChatRequest

async def chat_with_knowledge_base():
    request = ChatRequest(
        message="什么是深度学习？",
        knowledge_base_id="ml_kb",
        model="deepseek-chat"
    )
    
    response = await langgraph_chat_service.chat(
        request=request,
        tenant_id=1,
        user_id=1
    )
    
    print(f"AI回答: {response.message}")
    print(f"使用统计: {response.usage}")

asyncio.run(chat_with_knowledge_base())
```

### cURL 示例

```bash
# 标准聊天（自动路由）
curl -X POST "http://localhost:8000/api/v1/chat/" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "什么是RAG技术？",
    "knowledge_base_id": "test1",
    "model": "deepseek-chat"
  }'

# 专用RAG端点
curl -X POST "http://localhost:8000/api/v1/chat/rag" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "请解释机器学习的基本概念",
    "knowledge_base_id": "ml_knowledge_base",
    "model": "deepseek-chat"
  }'
```

## 错误处理

### 常见错误

1. **知识库不存在**
   ```json
   {
     "detail": "Knowledge base 'nonexistent_kb' not found"
   }
   ```

2. **向量化失败**
   ```json
   {
     "detail": "Failed to generate embeddings for query"
   }
   ```

3. **检索失败**
   ```json
   {
     "detail": "Document retrieval failed"
   }
   ```

### 错误恢复

- 系统会自动尝试备用方案
- 向量化失败时会使用标准聊天
- 检索失败时会提供通用回答

## 性能优化

### 并发处理
- 向量搜索和关键词搜索并行执行
- 异步处理减少等待时间

### 缓存策略
- 查询向量缓存
- 文档检索结果缓存
- 模型响应缓存

### 监控指标
- 响应时间
- 检索准确率
- 用户满意度
- 系统资源使用率

## 配置选项

### 环境变量
```bash
# 模型配置
DEEPSEEK_API_KEY=your_api_key
SILICONFLOW_API_KEY=your_api_key

# 向量数据库
MILVUS_HOST=localhost
MILVUS_PORT=19530

# 搜索引擎
ELASTICSEARCH_HOST=localhost
ELASTICSEARCH_PORT=9200

# 检索参数
RETRIEVAL_TOP_K=5
RERANK_TOP_K=3
EMBEDDING_DIMENSION=1024
```

### 运行时配置
```python
# 在代码中动态配置
langgraph_chat_service.config.update({
    "retrieval_top_k": 10,
    "rerank_top_k": 5,
    "use_hybrid_search": True,
    "enable_query_expansion": True
})
```

## 最佳实践

1. **知识库管理**
   - 定期更新知识库内容
   - 优化文档分块策略
   - 建立文档质量评估机制

2. **查询优化**
   - 使用清晰、具体的问题
   - 避免过于复杂的复合查询
   - 考虑用户意图和上下文

3. **系统监控**
   - 监控API响应时间
   - 跟踪检索准确率
   - 记录用户反馈

4. **错误处理**
   - 实现优雅的降级机制
   - 提供有意义的错误信息
   - 建立错误恢复策略

## 故障排除

### 常见问题

1. **响应时间过长**
   - 检查向量数据库连接
   - 优化检索参数
   - 考虑增加缓存

2. **检索结果不准确**
   - 检查文档质量
   - 调整重新排序参数
   - 优化嵌入模型

3. **系统资源占用过高**
   - 调整并发参数
   - 优化批处理大小
   - 考虑负载均衡

### 调试工具

```python
# 启用详细日志
import logging
logging.getLogger('app.services.langgraph_chat_service').setLevel(logging.DEBUG)

# 查看工作流状态
from app.services.langgraph_chat_service import langgraph_chat_service
state = await langgraph_chat_service.get_workflow_state(chat_id)
```

## 扩展开发

### 添加新的处理步骤

```python
async def custom_processing_step(state: ChatState) -> ChatState:
    """自定义处理步骤"""
    # 处理逻辑
    state["custom_data"] = "processed"
    return state

# 在工作流中添加新步骤
workflow.add_node("custom_step", custom_processing_step)
workflow.add_edge("analyze_query", "custom_step")
```

### 自定义决策逻辑

```python
def custom_decision(state: ChatState) -> str:
    """自定义决策逻辑"""
    if state["custom_condition"]:
        return "path_a"
    else:
        return "path_b"

workflow.add_conditional_edges(
    "custom_step",
    custom_decision,
    {
        "path_a": "step_a",
        "path_b": "step_b"
    }
)
```

## 总结

LangGraph RAG API 提供了一个强大、灵活的知识库问答解决方案。通过状态图工作流管理，系统能够提供更好的可控性、可观察性和扩展性。无论是简单的知识查询还是复杂的多轮对话，该系统都能提供高质量的服务。