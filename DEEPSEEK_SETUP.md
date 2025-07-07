# 多模型 API 集成配置指南

## 1. 概述

本系统支持分离配置不同功能的 AI 模型：
- **聊天模型**: 用于对话生成
- **Embedding 模型**: 用于文本向量化
- **Rerank 模型**: 用于搜索结果重排序

您可以混合使用不同提供商的服务，例如：
- 使用 DeepSeek 进行聊天
- 使用 OpenAI 进行 embedding
- 使用 通义千问 进行 rerank

## 2. 获取 API Keys

### DeepSeek API Key
1. 访问 [DeepSeek 官网](https://platform.deepseek.com/)
2. 注册账号并登录
3. 在控制台中创建 API Key

### OpenAI API Key
1. 访问 [OpenAI 官网](https://platform.openai.com/)
2. 注册账号并登录
3. 在 API Keys 页面创建新的 API Key

### 通义千问 API Key
1. 访问 [阿里云 DashScope](https://dashscope.aliyun.com/)
2. 注册账号并登录
3. 在控制台中获取 API Key

## 3. 配置环境变量

### 方法一：直接设置环境变量

```bash
# DeepSeek API (用于聊天)
export DEEPSEEK_API_KEY="your_deepseek_api_key_here"

# OpenAI API (用于 embedding)
export OPENAI_API_KEY="your_openai_api_key_here"

# 通义千问 API (用于 rerank)
export DASHSCOPE_API_KEY="your_dashscope_api_key_here"

# 模型配置
export CHAT_MODEL_PROVIDER="deepseek"
export CHAT_MODEL_NAME="deepseek-chat"
export EMBEDDING_MODEL_PROVIDER="openai"
export EMBEDDING_MODEL_NAME="text-embedding-3-small"
export RERANK_MODEL_PROVIDER="qwen"
export RERANK_MODEL_NAME="gte-rerank"
```

### 方法二：创建 .env 文件

在项目根目录创建 `.env` 文件：

```bash
# API Keys
DEEPSEEK_API_KEY=your_deepseek_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
DASHSCOPE_API_KEY=your_dashscope_api_key_here

# 模型服务配置
CHAT_MODEL_PROVIDER=deepseek
CHAT_MODEL_NAME=deepseek-chat
EMBEDDING_MODEL_PROVIDER=openai
EMBEDDING_MODEL_NAME=text-embedding-3-small
RERANK_MODEL_PROVIDER=qwen
RERANK_MODEL_NAME=gte-rerank

# 其他可选配置
DEBUG=true
LOG_LEVEL=INFO
```

## 4. 验证配置

启动后端服务后，您可以通过以下方式验证所有 API 是否正确配置：

```bash
curl -X GET "http://localhost:8000/api/v1/llm/test-connections"
```

## 5. 配置选项说明

### 聊天模型提供商
- **deepseek**: DeepSeek 聊天模型，性价比高
- **qwen**: 通义千问聊天模型，中文能力强
- **openai**: OpenAI GPT 模型，能力全面

### Embedding 模型提供商
- **openai**: OpenAI embedding 模型，质量高
- **qwen**: 通义千问 embedding 模型，中文效果好
- **deepseek**: DeepSeek embedding（模拟，仅测试用）

### Rerank 模型提供商
- **qwen**: 通义千问 rerank 模型，效果好

## 6. 推荐配置

### 经济型配置
```bash
CHAT_MODEL_PROVIDER=deepseek          # 聊天成本低
EMBEDDING_MODEL_PROVIDER=qwen         # 免费额度
RERANK_MODEL_PROVIDER=qwen           # 免费额度
```

### 高质量配置
```bash
CHAT_MODEL_PROVIDER=openai           # GPT-4 高质量
EMBEDDING_MODEL_PROVIDER=openai      # 高质量 embedding
RERANK_MODEL_PROVIDER=qwen          # 专业 rerank
```

### 中文优化配置
```bash
CHAT_MODEL_PROVIDER=qwen             # 中文能力强
EMBEDDING_MODEL_PROVIDER=qwen        # 中文 embedding
RERANK_MODEL_PROVIDER=qwen          # 中文 rerank
```

## 7. 费用说明

- **DeepSeek**: 按使用量计费，价格较低
- **OpenAI**: 按 token 计费，功能强大但成本较高
- **通义千问**: 有免费额度，超出后按量计费

## 8. 注意事项

- 请保护好您的 API Key，不要在代码中直接写入
- 建议根据实际需求选择合适的模型配置
- 可以随时通过修改环境变量来切换不同的模型提供商 