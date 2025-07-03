"""
聊天API端点
支持文本消息、文件上传和工作流执行
"""

from typing import Optional, List, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import StreamingResponse
import json
import structlog

from app.schemas.chat import (
    ChatRequest, 
    ChatResponse, 
    ChatMessage,
    FileUploadResponse
)
from app.services.chat_service import ChatService
from app.services.file_service import FileService

router = APIRouter()
logger = structlog.get_logger(__name__)

# 依赖注入
def get_chat_service() -> ChatService:
    return ChatService()

def get_file_service() -> FileService:
    return FileService()


@router.post("/completions", response_model=ChatResponse)
async def chat_completions(
    request: ChatRequest,
    chat_service: ChatService = Depends(get_chat_service)
):
    """
    聊天补全接口
    支持基于知识库的RAG问答和LangGraph工作流
    """
    try:
        logger.info("收到聊天请求", 
                   message=request.message[:100], 
                   knowledge_base_id=request.knowledge_base_id)
        
        # 执行聊天
        if request.stream:
            # 流式响应
            return StreamingResponse(
                chat_service.stream_chat(request),
                media_type="text/plain"
            )
        else:
            # 普通响应
            response = await chat_service.chat(request)
            return response
            
    except Exception as e:
        logger.error("聊天处理失败", error=str(e))
        raise HTTPException(status_code=500, detail=f"聊天处理失败: {str(e)}")


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    knowledge_base_id: Optional[str] = Form(None),
    chat_id: Optional[str] = Form(None),
    file_service: FileService = Depends(get_file_service)
):
    """
    文件上传接口
    支持上传文档到知识库或聊天中使用
    """
    try:
        logger.info("收到文件上传", 
                   filename=file.filename, 
                   content_type=file.content_type,
                   knowledge_base_id=knowledge_base_id)
        
        # 验证文件类型和大小
        if not await file_service.validate_file(file):
            raise HTTPException(status_code=400, detail="不支持的文件类型或文件过大")
        
        # 处理文件上传
        result = await file_service.upload_file(
            file=file,
            knowledge_base_id=knowledge_base_id,
            chat_id=chat_id
        )
        
        return result
        
    except Exception as e:
        logger.error("文件上传失败", error=str(e))
        raise HTTPException(status_code=500, detail=f"文件上传失败: {str(e)}")


@router.get("/history/{chat_id}")
async def get_chat_history(
    chat_id: str,
    limit: int = 50,
    chat_service: ChatService = Depends(get_chat_service)
):
    """获取聊天历史"""
    try:
        history = await chat_service.get_chat_history(chat_id, limit)
        return {"chat_id": chat_id, "messages": history}
        
    except Exception as e:
        logger.error("获取聊天历史失败", error=str(e))
        raise HTTPException(status_code=500, detail=f"获取聊天历史失败: {str(e)}")


@router.delete("/history/{chat_id}")
async def clear_chat_history(
    chat_id: str,
    chat_service: ChatService = Depends(get_chat_service)
):
    """清除聊天历史"""
    try:
        await chat_service.clear_chat_history(chat_id)
        return {"message": "聊天历史已清除", "chat_id": chat_id}
        
    except Exception as e:
        logger.error("清除聊天历史失败", error=str(e))
        raise HTTPException(status_code=500, detail=f"清除聊天历史失败: {str(e)}")


@router.post("/workflows/{workflow_id}/execute")
async def execute_workflow(
    workflow_id: str,
    request: dict,
    chat_service: ChatService = Depends(get_chat_service)
):
    """
    执行LangGraph工作流
    """
    try:
        logger.info("执行工作流", workflow_id=workflow_id)
        
        result = await chat_service.execute_workflow(workflow_id, request)
        return result
        
    except Exception as e:
        logger.error("工作流执行失败", error=str(e))
        raise HTTPException(status_code=500, detail=f"工作流执行失败: {str(e)}") 