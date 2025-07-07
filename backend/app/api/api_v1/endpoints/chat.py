"""
Chat API Endpoints
Handles regular and RAG-based chat completions, both streaming and non-streaming.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import structlog

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService

# Use a single instance of the service
chat_service = ChatService()

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.post("/", response_model=ChatResponse)
async def handle_chat(request: ChatRequest):
    """
    Main chat endpoint for non-streaming responses.
    Dispatches to RAG or standard chat based on the request.
    """
    try:
        logger.info("Handling non-streaming chat request", knowledge_base_id=request.knowledge_base_id)
        response = await chat_service.chat(request)
        return response
    except Exception as e:
        logger.error("Chat completion failed", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"An error occurred during chat processing: {e}")


@router.post("/stream")
async def handle_stream_chat(request: ChatRequest):
    """
    Chat endpoint for streaming responses.
    """
    try:
        logger.info("Handling streaming chat request", knowledge_base_id=request.knowledge_base_id)
        return StreamingResponse(
            chat_service.stream_chat(request),
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error("Streaming chat failed", error=str(e), exc_info=True)
        return StreamingResponse(None, status_code=500)


@router.get("/history/{chat_id}")
async def get_history(chat_id: str):
    """Get chat history."""
    try:
        history = await chat_service.get_chat_history(chat_id)
        return {"chat_id": chat_id, "messages": history}
    except Exception as e:
        logger.error("Failed to get chat history", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve chat history.")


@router.delete("/history/{chat_id}")
async def clear_history(chat_id: str):
    """Clear chat history."""
    try:
        await chat_service.clear_chat_history(chat_id)
        return {"message": "Chat history cleared successfully", "chat_id": chat_id}
    except Exception as e:
        logger.error("Failed to clear chat history", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to clear chat history.")


@router.post("/workflows/{workflow_id}/execute")
async def execute_workflow(
    workflow_id: str,
    request: dict
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