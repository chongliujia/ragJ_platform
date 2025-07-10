"""
Chat API Endpoints
Handles regular and RAG-based chat completions, both streaming and non-streaming.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import structlog
import json

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService
from app.services.langgraph_chat_service import langgraph_chat_service
from app.services.reranking_service import reranking_service

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
        logger.info(
            "Handling non-streaming chat request",
            knowledge_base_id=request.knowledge_base_id,
        )
        
        # Use LangGraph service for RAG chat if knowledge base is specified
        if request.knowledge_base_id:
            # TODO: Get actual tenant_id and user_id from authentication context
            tenant_id = 1  # Default tenant ID for now
            user_id = 1    # Default user ID for now
            
            logger.info("Using LangGraph RAG workflow for knowledge base chat")
            response = await langgraph_chat_service.chat(request, tenant_id, user_id)
        else:
            # Use original chat service for standard chat
            response = await chat_service.chat(request)
            
        return response
    except Exception as e:
        logger.error("Chat completion failed", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"An error occurred during chat processing: {e}"
        )


@router.post("/stream")
async def handle_stream_chat(request: ChatRequest):
    """
    Chat endpoint for streaming responses.
    """
    try:
        logger.info(
            "Handling streaming chat request",
            knowledge_base_id=request.knowledge_base_id,
        )
        return StreamingResponse(
            chat_service.stream_chat(request), 
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    except Exception as e:
        logger.error("Streaming chat failed", error=str(e), exc_info=True)
        
        # Return error as an event stream
        async def error_stream():
            error_data = {
                "success": False,
                "error": str(e),
                "type": "error"
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            error_stream(), 
            media_type="text/event-stream",
            status_code=500
        )


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
async def execute_workflow(workflow_id: str, request: dict):
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


@router.post("/rag", response_model=ChatResponse)
async def handle_rag_chat(request: ChatRequest):
    """
    专门用于RAG对话的LangGraph端点
    """
    try:
        if not request.knowledge_base_id:
            raise HTTPException(
                status_code=400, 
                detail="knowledge_base_id is required for RAG chat"
            )
        
        logger.info(
            "Handling RAG chat with LangGraph workflow",
            knowledge_base_id=request.knowledge_base_id,
        )
        
        # TODO: Get actual tenant_id and user_id from authentication context
        tenant_id = 1  # Default tenant ID for now
        user_id = 1    # Default user ID for now
        
        response = await langgraph_chat_service.chat(request, tenant_id, user_id)
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("RAG chat failed", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"RAG chat processing failed: {e}"
        )


@router.get("/reranking-providers")
async def get_reranking_providers():
    """
    Get available reranking providers.
    """
    return {"providers": reranking_service.get_available_providers()}
