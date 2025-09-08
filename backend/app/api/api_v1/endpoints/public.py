"""
Public API endpoints (x-api-key)
 - Chat (non-stream and stream)
 - Workflow execute (non-stream)

Allows embedding and server-to-server integration without user login.
"""

from typing import Dict, Any, Optional, AsyncGenerator
from dataclasses import dataclass
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json
import structlog

from app.db.database import get_db
from app.db.models.api_key import ApiKey
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService
from app.services.workflow_execution_engine import workflow_execution_engine
from app.services.workflow_persistence_service import workflow_persistence_service


router = APIRouter()
logger = structlog.get_logger(__name__)
chat_service = ChatService()


@dataclass
class PublicContext:
    tenant_id: int
    scopes: str
    allowed_kb: Optional[str]
    allowed_workflow_id: Optional[str]


def _get_api_key_from_request(x_api_key: Optional[str], api_key_q: Optional[str]) -> Optional[str]:
    return x_api_key or api_key_q


async def get_public_context(
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
    api_key_q: Optional[str] = Query(default=None, alias="api_key"),
) -> PublicContext:
    key = _get_api_key_from_request(x_api_key, api_key_q)
    if not key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing API key")

    record = db.query(ApiKey).filter(ApiKey.key == key).first()
    if not record or record.revoked:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    if record.expires_at is not None:
        from datetime import datetime
        if record.expires_at < datetime.utcnow():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key expired")

    return PublicContext(
        tenant_id=record.tenant_id,
        scopes=record.scopes or "",
        allowed_kb=record.allowed_kb,
        allowed_workflow_id=record.allowed_workflow_id,
    )


def _check_scope(ctx: PublicContext, scope: str):
    scopes = [s.strip() for s in (ctx.scopes or "").split(",")]
    if scope not in scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Missing scope: {scope}")


@router.post("/chat", response_model=ChatResponse)
async def public_chat(
    request: ChatRequest,
    ctx: PublicContext = Depends(get_public_context),
):
    """Public non-stream chat. Supports RAG if knowledge_base_id provided."""
    _check_scope(ctx, "chat")

    # Optional KB restriction
    if request.knowledge_base_id and ctx.allowed_kb and ctx.allowed_kb != request.knowledge_base_id:
        raise HTTPException(status_code=403, detail="KB not allowed by API key")

    # For RAG, pass tenant_id/user_id (use 0 as system user)
    if request.knowledge_base_id:
        return await chat_service.chat(request, tenant_id=ctx.tenant_id, user_id=0)
    return await chat_service.chat(request)


@router.post("/chat/stream")
async def public_chat_stream(
    request: ChatRequest,
    ctx: PublicContext = Depends(get_public_context),
):
    """Public streaming chat via SSE."""
    _check_scope(ctx, "chat")

    if request.knowledge_base_id and ctx.allowed_kb and ctx.allowed_kb != request.knowledge_base_id:
        raise HTTPException(status_code=403, detail="KB not allowed by API key")

    async def event_stream() -> AsyncGenerator[str, None]:
        # For RAG stream, tenant_id is required; non-RAG is fine without
        tenant = ctx.tenant_id if request.knowledge_base_id else None
        async for chunk in chat_service.stream_chat(request, tenant_id=tenant, user_id=0):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/workflows/{workflow_id}/execute")
async def public_execute_workflow(
    workflow_id: str,
    payload: Dict[str, Any],
    ctx: PublicContext = Depends(get_public_context),
):
    """Public workflow execution (non-stream)."""
    _check_scope(ctx, "workflow")

    if ctx.allowed_workflow_id and ctx.allowed_workflow_id != workflow_id:
        raise HTTPException(status_code=403, detail="Workflow not allowed by API key")

    wf = workflow_persistence_service.get_workflow_definition(workflow_id, ctx.tenant_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    input_data = payload.get("input_data") or payload.get("input") or {}
    # Inject tenant context
    input_data.setdefault("tenant_id", ctx.tenant_id)
    input_data.setdefault("user_id", 0)

    context = await workflow_execution_engine.execute_workflow(
        workflow_definition=wf,
        input_data=input_data,
        debug=bool(payload.get("debug")),
        enable_parallel=payload.get("enable_parallel"),
    )

    return {
        "execution_id": context.execution_id,
        "status": context.status,
        "start_time": context.start_time,
        "end_time": context.end_time,
        "output_data": context.output_data,
        "error": context.error,
    }

