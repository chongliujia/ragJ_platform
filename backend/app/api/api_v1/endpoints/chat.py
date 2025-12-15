"""
Chat API Endpoints
Handles regular and RAG-based chat completions, both streaming and non-streaming.
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
import structlog
import json

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService
from app.services.langgraph_chat_service import langgraph_chat_service
from app.services.reranking_service import reranking_service
from app.core.dependencies import get_tenant_id, get_current_user
from app.db.models.user import User
from app.db.database import get_db
from sqlalchemy.orm import Session
from app.db.models.knowledge_base import KnowledgeBase as KBModel

# Use a single instance of the service
chat_service = ChatService()

router = APIRouter()
logger = structlog.get_logger(__name__)

def _can_read_kb(kb_row: KBModel, user: User) -> bool:
    if user.role in ("super_admin", "tenant_admin"):
        return True
    if kb_row.owner_id == user.id:
        return True
    return bool(getattr(kb_row, "is_public", False))


@router.post("/", response_model=ChatResponse)
async def handle_chat(
    request: ChatRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
            kb_row = (
                db.query(KBModel)
                .filter(
                    KBModel.name == request.knowledge_base_id,
                    KBModel.tenant_id == tenant_id,
                    KBModel.is_active == True,
                )
                .first()
            )
            if kb_row is None or not _can_read_kb(kb_row, current_user):
                raise HTTPException(status_code=404, detail="Knowledge base not found")
            logger.info("Using LangGraph RAG workflow for knowledge base chat")
            response = await langgraph_chat_service.chat(request, tenant_id, current_user.id)
        else:
            # Use original chat service for standard chat
            response = await chat_service.chat(
                request, tenant_id=tenant_id, user_id=current_user.id
            )
            
        return response
    except Exception as e:
        logger.error("Chat completion failed", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"An error occurred during chat processing: {e}"
        )


@router.post("/stream")
async def handle_stream_chat(
    request: ChatRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Chat endpoint for streaming responses.
    """
    try:
        logger.info(
            "Handling streaming chat request",
            knowledge_base_id=request.knowledge_base_id,
        )
        if request.knowledge_base_id:
            kb_row = (
                db.query(KBModel)
                .filter(
                    KBModel.name == request.knowledge_base_id,
                    KBModel.tenant_id == tenant_id,
                    KBModel.is_active == True,
                )
                .first()
            )
            if kb_row is None or not _can_read_kb(kb_row, current_user):
                raise HTTPException(status_code=404, detail="Knowledge base not found")
            generator = langgraph_chat_service.stream_chat(
                request, tenant_id=tenant_id, user_id=current_user.id
            )
        else:
            generator = chat_service.stream_chat(
                request, tenant_id=tenant_id, user_id=current_user.id
            )
        return StreamingResponse(
            generator,
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


@router.post("/rag", response_model=ChatResponse)
async def handle_rag_chat(
    request: ChatRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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

        kb_row = (
            db.query(KBModel)
            .filter(
                KBModel.name == request.knowledge_base_id,
                KBModel.tenant_id == tenant_id,
                KBModel.is_active == True,
            )
            .first()
        )
        if kb_row is None or not _can_read_kb(kb_row, current_user):
            raise HTTPException(status_code=404, detail="Knowledge base not found")
        
        response = await langgraph_chat_service.chat(request, tenant_id, current_user.id)
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
