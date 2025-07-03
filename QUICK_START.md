# RAG Platform 快速启动指南

本指南将帮助您快速启动RAG Platform的第一个版本，包含基础的聊天接口和文件上传功能。

## 🎯 第一版功能概述

✅ **已实现的功能**:
- 🗨️ 基础聊天接口（支持流式和非流式响应）
- 📁 文件上传接口（支持PDF、DOCX、TXT等格式）
- 📚 知识库管理（创建、查询、删除）
- 📄 文档管理（上传、列表、删除）
- 🤖 智能体工作流框架（基于LangGraph，预留接口）
- 🔐 简单认证系统
- 📖 完整的API文档（Swagger UI）

🚧 **预留功能**:
- Milvus向量数据库集成
- 通义千问API集成（嵌入模型 + 重排序）
- Rust文档处理服务
- 真实的LLM模型调用
- 数据库持久化

## 📋 环境要求

- **Python**: 3.8 或更高版本
- **操作系统**: macOS/Linux/Windows
- **内存**: 建议4GB以上

## 🚀 快速启动

### 步骤1: 克隆并设置项目

```bash
# 1. 进入项目目录
cd ragJ_platform

# 2. 复制环境配置文件
cp .env.example .env

# 3. 根据需要编辑配置（可选）
# vim .env
```

### 步骤2: 安装Python依赖

```bash
# 创建虚拟环境（推荐）
python -m venv venv

# 激活虚拟环境
# macOS/Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# 安装依赖
cd backend
pip install -r requirements.txt
```

### 步骤3: 启动服务

```bash
# 在backend目录下启动FastAPI服务
python -m app.main

# 或者使用uvicorn直接启动
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 步骤4: 验证服务

启动成功后，您将看到类似的输出：
```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
{"event": "启动 RAG Platform...", "timestamp": "2024-01-01T12:00:00.000Z"}
{"event": "数据库初始化完成", "timestamp": "2024-01-01T12:00:00.100Z"}
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

## 🔗 访问服务

- **API文档**: http://localhost:8000/api/v1/docs
- **ReDoc文档**: http://localhost:8000/api/v1/redoc
- **健康检查**: http://localhost:8000/health

## 🧪 测试API接口

### 1. 基础聊天测试

```bash
curl -X POST "http://localhost:8000/api/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好，请介绍一下你自己",
    "model": "gpt-3.5-turbo",
    "stream": false
  }'
```

**预期响应**:
```json
{
  "message": "针对您的问题：你好，请介绍一下你自己，我的回答是：这是一个基础的AI助手响应。在完整版本中，这里会集成真正的LLM模型。",
  "chat_id": "chat_12345678",
  "model": "gpt-3.5-turbo",
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  },
  "timestamp": "2024-01-01T12:00:00"
}
```

### 2. 文件上传测试

```bash
curl -X POST "http://localhost:8000/api/v1/chat/upload" \
  -F "file=@test_document.pdf" \
  -F "knowledge_base_id=kb_test"
```

**预期响应**:
```json
{
  "file_id": "file_123456789012",
  "filename": "test_document.pdf",
  "file_size": 1024000,
  "file_type": "pdf",
  "knowledge_base_id": "kb_test",
  "status": "uploaded",
  "message": "文件上传成功"
}
```

### 3. 知识库管理测试

```bash
# 创建知识库
curl -X POST "http://localhost:8000/api/v1/knowledge-bases/" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试知识库",
    "description": "这是一个测试用的知识库",
    "embedding_model": "text-embedding-v2"
  }'

# 查看知识库列表
curl -X GET "http://localhost:8000/api/v1/knowledge-bases/"
```

### 4. 工作流模板查看

```bash
curl -X GET "http://localhost:8000/api/v1/agents/templates"
```

## 🌐 使用Swagger UI测试

1. 打开浏览器访问: http://localhost:8000/api/v1/docs
2. 您会看到完整的API文档界面
3. 点击任意端点的"Try it out"按钮
4. 填写参数并点击"Execute"测试

## 📱 集成到您的网站

### JavaScript示例

```javascript
// 基础聊天功能
async function chatWithAI(message, knowledgeBaseId = null) {
  const response = await fetch('http://localhost:8000/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message,
      knowledge_base_id: knowledgeBaseId,
      stream: false
    })
  });
  
  const data = await response.json();
  return data.message;
}

// 文件上传功能
async function uploadFile(file, knowledgeBaseId) {
  const formData = new FormData();
  formData.append('file', file);
  if (knowledgeBaseId) {
    formData.append('knowledge_base_id', knowledgeBaseId);
  }
  
  const response = await fetch('http://localhost:8000/api/v1/chat/upload', {
    method: 'POST',
    body: formData
  });
  
  return await response.json();
}

// 使用示例
const aiResponse = await chatWithAI("什么是人工智能？");
console.log(aiResponse);
```

### HTML示例页面

```html
<!DOCTYPE html>
<html>
<head>
    <title>RAG Platform 测试</title>
    <style>
        .chat-container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
        .user { background-color: #e3f2fd; text-align: right; }
        .assistant { background-color: #f5f5f5; }
        input, button { margin: 5px; padding: 10px; }
        #messageInput { width: 70%; }
        #sendButton { width: 20%; }
    </style>
</head>
<body>
    <div class="chat-container">
        <h1>RAG Platform 聊天测试</h1>
        <div id="chatMessages"></div>
        <div>
            <input type="text" id="messageInput" placeholder="输入您的问题..." />
            <button id="sendButton" onclick="sendMessage()">发送</button>
        </div>
        <div>
            <input type="file" id="fileInput" accept=".pdf,.docx,.txt,.md" />
            <button onclick="uploadFile()">上传文件</button>
        </div>
    </div>

    <script>
        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            if (!message) return;

            // 显示用户消息
            addMessage(message, 'user');
            input.value = '';

            try {
                // 调用API
                const response = await fetch('http://localhost:8000/api/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: message })
                });
                
                const data = await response.json();
                addMessage(data.message, 'assistant');
            } catch (error) {
                addMessage('抱歉，发生了错误: ' + error.message, 'assistant');
            }
        }

        function addMessage(content, role) {
            const messagesDiv = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${role}`;
            messageDiv.textContent = content;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        async function uploadFile() {
            const fileInput = document.getElementById('fileInput');
            const file = fileInput.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('http://localhost:8000/api/v1/chat/upload', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                addMessage(`文件上传成功: ${data.filename}`, 'assistant');
            } catch (error) {
                addMessage('文件上传失败: ' + error.message, 'assistant');
            }
        }

        // 回车发送消息
        document.getElementById('messageInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    </script>
</body>
</html>
```

## 🔧 常见问题

### Q1: 启动时提示端口被占用
```bash
# 查看端口占用
lsof -i :8000

# 使用其他端口启动
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### Q2: 依赖安装失败
```bash
# 更新pip
pip install --upgrade pip

# 清理缓存后重新安装
pip cache purge
pip install -r requirements.txt
```

### Q3: 文件上传失败
- 检查文件大小是否超过100MB限制
- 确认文件格式是否在支持列表中（pdf, docx, txt, md, html）
- 检查uploads目录是否有写权限

### Q4: API响应慢
- 当前版本是模拟响应，在真实环境中集成LLM后会有所改善
- 可以启用流式响应减少等待感知

## 📖 日志查看

服务运行时会输出结构化日志，包含：
- 请求处理信息
- 文件操作状态  
- 错误详情

示例日志：
```json
{"event": "收到聊天请求", "message": "你好，请介绍一下你自己", "knowledge_base_id": null, "timestamp": "2024-01-01T12:00:00.000Z", "logger": "app.api.api_v1.endpoints.chat"}
```

## 🎯 下一步计划

在第一版基础上，接下来将实现：

1. **Milvus集成**: 真实的向量数据库支持
2. **通义千问集成**: 嵌入模型和重排序模型
3. **Rust服务**: 高性能文档处理
4. **真实LLM**: 替换模拟响应
5. **数据库**: PostgreSQL持久化存储
6. **Web界面**: 管理后台

## 🆘 获取帮助

- 查看完整文档: 访问 http://localhost:8000/api/v1/docs
- 检查日志输出排查问题
- 参考代码注释了解实现细节

---

**恭喜！** 🎉 您已经成功启动了RAG Platform的第一个版本。现在可以开始测试聊天接口和文件上传功能了！ 