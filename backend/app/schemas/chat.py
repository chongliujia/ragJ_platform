"""
聊天相关的数据模型
定义请求和响应的数据结构
"""

from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from datetime import datetime


class ChatMessage(BaseModel):
    """聊天消息"""

    role: str = Field(..., description="消息角色: user/assistant/system")
    content: str = Field(..., description="消息内容")
    timestamp: Optional[datetime] = Field(default=None, description="时间戳")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="元数据")


class ChatRequest(BaseModel):
    """聊天请求"""

    message: str = Field(..., description="用户消息")
    chat_id: Optional[str] = Field(default=None, description="聊天会话ID")
    knowledge_base_id: Optional[str] = Field(default=None, description="知识库ID")
    workflow_id: Optional[str] = Field(default=None, description="工作流ID")
    model: Optional[str] = Field(default=None, description="使用的模型")
    temperature: float = Field(default=0.7, description="模型温度参数")
    max_tokens: Optional[int] = Field(default=None, description="最大生成token数")
    stream: bool = Field(default=False, description="是否流式响应")
    context: Optional[Dict[str, Any]] = Field(default=None, description="上下文信息")
    system_prompt: Optional[str] = Field(default=None, description="可选系统提示词")

    class Config:
        json_schema_extra = {
            "example": {
                "message": "Hello, what is RAG?",
                "knowledge_base_id": "kb_12345",
                "model": "qwen-turbo",
                "temperature": 0.7,
                "stream": False,
            }
        }


class ChatResponse(BaseModel):
    """聊天响应"""

    message: str = Field(..., description="AI回复内容")
    chat_id: str = Field(..., description="聊天会话ID")
    model: str = Field(..., description="使用的模型")
    usage: Optional[Dict[str, Any]] = Field(default=None, description="token使用统计")
    sources: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="引用来源"
    )
    workflow_state: Optional[Dict[str, Any]] = Field(
        default=None, description="工作流状态"
    )
    timestamp: datetime = Field(default_factory=datetime.now, description="响应时间")

    class Config:
        json_schema_extra = {
            "example": {
                "message": "人工智能是...",
                "chat_id": "chat_456",
                "model": "gpt-3.5-turbo",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 50,
                    "total_tokens": 60,
                },
                "sources": [{"title": "AI入门", "score": 0.95}],
            }
        }


class FileUploadRequest(BaseModel):
    """文件上传请求"""

    knowledge_base_id: Optional[str] = Field(default=None, description="知识库ID")
    chat_id: Optional[str] = Field(default=None, description="聊天会话ID")
    auto_process: bool = Field(default=True, description="是否自动处理文件")


class FileUploadResponse(BaseModel):
    """文件上传响应"""

    file_id: str = Field(..., description="文件ID")
    filename: str = Field(..., description="文件名")
    file_size: int = Field(..., description="文件大小")
    file_type: str = Field(..., description="文件类型")
    upload_time: datetime = Field(default_factory=datetime.now, description="上传时间")
    status: str = Field(default="uploaded", description="处理状态")
    knowledge_base_id: Optional[str] = Field(default=None, description="知识库ID")
    message: str = Field(default="文件上传成功", description="状态消息")

    class Config:
        json_schema_extra = {
            "example": {
                "file_id": "file_789",
                "filename": "document.pdf",
                "file_size": 1024000,
                "file_type": "pdf",
                "status": "uploaded",
                "message": "文件上传成功",
            }
        }


class WorkflowConfig(BaseModel):
    """工作流配置"""

    workflow_id: str = Field(..., description="工作流ID")
    name: str = Field(..., description="工作流名称")
    description: Optional[str] = Field(default=None, description="工作流描述")
    nodes: List[Dict[str, Any]] = Field(..., description="工作流节点")
    edges: List[Dict[str, str]] = Field(..., description="工作流边")
    config: Optional[Dict[str, Any]] = Field(default=None, description="工作流配置")


class WorkflowExecuteRequest(BaseModel):
    """工作流执行请求"""

    input: Dict[str, Any] = Field(..., description="输入数据")
    config: Optional[Dict[str, Any]] = Field(default=None, description="执行配置")


class WorkflowExecuteResponse(BaseModel):
    """工作流执行响应"""

    output: Dict[str, Any] = Field(..., description="输出数据")
    execution_id: str = Field(..., description="执行ID")
    status: str = Field(..., description="执行状态")
    start_time: datetime = Field(..., description="开始时间")
    end_time: Optional[datetime] = Field(default=None, description="结束时间")
    duration: Optional[float] = Field(default=None, description="执行时长(秒)")
