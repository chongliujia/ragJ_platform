"""
Public API endpoints (x-api-key)
 - Chat (non-stream and stream)
 - Workflow execute (non-stream)

Allows embedding and server-to-server integration without user login.
"""

from typing import Dict, Any, Optional, AsyncGenerator
from dataclasses import dataclass
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json
import asyncio
import structlog
import time
from pydantic import BaseModel, root_validator

from app.db.database import get_db
from app.db.models.api_key import ApiKey
from app.db.models.workflow import WorkflowDefinition as DBWorkflowDefinition
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService
from app.services.langgraph_chat_service import langgraph_chat_service
from app.services.workflow_execution_engine import workflow_execution_engine
from app.services.workflow_persistence_service import workflow_persistence_service
from app.schemas.workflow import ExecutionStep
from app.api.api_v1.endpoints.workflows import _infer_workflow_io_schema, _validate_input_against_schema
from app.services.api_key_usage_service import api_key_rate_limiter, record_api_key_usage


router = APIRouter()
logger = structlog.get_logger(__name__)
chat_service = ChatService()


@dataclass
class PublicContext:
    tenant_id: int
    api_key_id: int
    scopes: str
    allowed_kb: Optional[str]
    allowed_workflow_id: Optional[str]
    rate_limit_per_min: int


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

    limit = int(record.rate_limit_per_min or 0)
    if limit > 0 and not api_key_rate_limiter.allow(record.key, limit):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")

    return PublicContext(
        tenant_id=record.tenant_id,
        api_key_id=record.id,
        scopes=record.scopes or "",
        allowed_kb=record.allowed_kb,
        allowed_workflow_id=record.allowed_workflow_id,
        rate_limit_per_min=limit,
    )


def _check_scope(ctx: PublicContext, scope: str):
    scopes = [s.strip() for s in (ctx.scopes or "").split(",")]
    if scope not in scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Missing scope: {scope}")


def _extract_total_tokens(usage: Optional[Dict[str, Any]]) -> Optional[int]:
    if not isinstance(usage, dict):
        return None
    for key in ("total_tokens", "totalTokens"):
        if key in usage:
            try:
                return int(usage.get(key))
            except Exception:
                return None
    return None

class PublicWorkflowRunRequest(BaseModel):
    input_data: Dict[str, Any] = {}
    config: Dict[str, Any] = {}
    debug: bool = False
    enable_parallel: Optional[bool] = None

    @root_validator(pre=True)
    def _coerce_input_alias(cls, values: Any):
        if isinstance(values, dict):
            if values.get("input_data") is None:
                values["input_data"] = {}
            if ("input_data" not in values or values.get("input_data") == {}) and isinstance(values.get("input"), dict):
                values["input_data"] = values.get("input") or {}
        return values


def _resolve_workflow_record_for_public(
    db: Session, workflow_id: str, ctx: PublicContext
) -> DBWorkflowDefinition:
    record = db.query(DBWorkflowDefinition).filter(DBWorkflowDefinition.workflow_id == workflow_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Key-level restriction always applies (if set).
    if ctx.allowed_workflow_id and ctx.allowed_workflow_id != workflow_id:
        raise HTTPException(status_code=403, detail="Workflow not allowed by API key")

    # Same-tenant key can access private workflows; cross-tenant only if public.
    if record.tenant_id != ctx.tenant_id:
        if not bool(record.is_public):
            raise HTTPException(status_code=403, detail="Workflow is not public")
        # Cross-tenant execution requires explicitly binding the key to this workflow
        # to avoid turning an API key into a global "public workflow runner".
        if not ctx.allowed_workflow_id:
            raise HTTPException(status_code=403, detail="Cross-tenant public workflow requires allowed_workflow_id on the API key")

    return record


def _build_public_input_data(
    raw_input: Dict[str, Any], workflow_tenant_id: int, caller_tenant_id: int
) -> Dict[str, Any]:
    input_data = dict(raw_input or {})
    # Force execution tenant/user context.
    input_data["tenant_id"] = workflow_tenant_id
    input_data["user_id"] = 0
    input_data.setdefault("caller_tenant_id", caller_tenant_id)
    return input_data


def _validate_public_input(workflow_def, raw_input: Dict[str, Any]) -> None:
    schema = _infer_workflow_io_schema(workflow_def)
    errors = _validate_input_against_schema(raw_input or {}, schema)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "Input validation failed", "errors": errors},
        )


@router.post("/chat", response_model=ChatResponse)
async def public_chat(
    request: ChatRequest,
    ctx: PublicContext = Depends(get_public_context),
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    """Public non-stream chat. Supports RAG if knowledge_base_id provided."""
    _check_scope(ctx, "chat")
    start_time = time.time()
    response: Optional[ChatResponse] = None
    error_status: Optional[int] = None

    # Optional KB restriction
    if request.knowledge_base_id and ctx.allowed_kb and ctx.allowed_kb != request.knowledge_base_id:
        raise HTTPException(status_code=403, detail="KB not allowed by API key")

    # For RAG, pass tenant_id/user_id (use 0 as system user)
    try:
        if request.knowledge_base_id:
            response = await langgraph_chat_service.chat(request, tenant_id=ctx.tenant_id, user_id=0)
        else:
            response = await chat_service.chat(request)
        return response
    except HTTPException as e:
        error_status = e.status_code
        raise
    except Exception:
        error_status = status.HTTP_500_INTERNAL_SERVER_ERROR
        raise
    finally:
        duration_ms = int((time.time() - start_time) * 1000)
        try:
            record_api_key_usage(
                api_key_id=ctx.api_key_id,
                tenant_id=ctx.tenant_id,
                path=str(http_request.url.path if http_request else "/api/v1/public/chat"),
                method=str(http_request.method if http_request else "POST"),
                status_code=error_status or 200,
                tokens=_extract_total_tokens(response.usage) if response else None,
                model=response.model if response else None,
                duration_ms=duration_ms,
                db=db,
            )
        except Exception:
            pass


@router.post("/chat/stream")
async def public_chat_stream(
    request: ChatRequest,
    ctx: PublicContext = Depends(get_public_context),
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    """Public streaming chat via SSE."""
    _check_scope(ctx, "chat")

    if request.knowledge_base_id and ctx.allowed_kb and ctx.allowed_kb != request.knowledge_base_id:
        raise HTTPException(status_code=403, detail="KB not allowed by API key")

    async def event_stream() -> AsyncGenerator[str, None]:
        start_time = time.time()
        status_code = 200
        try:
            if request.knowledge_base_id:
                async for chunk in langgraph_chat_service.stream_chat(
                    request, tenant_id=ctx.tenant_id, user_id=0
                ):
                    yield chunk
            else:
                async for chunk in chat_service.stream_chat(request):
                    yield chunk
        except Exception:
            status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
            raise
        finally:
            duration_ms = int((time.time() - start_time) * 1000)
            try:
                record_api_key_usage(
                    api_key_id=ctx.api_key_id,
                    tenant_id=ctx.tenant_id,
                    path=str(http_request.url.path if http_request else "/api/v1/public/chat/stream"),
                    method=str(http_request.method if http_request else "POST"),
                    status_code=status_code,
                    tokens=None,
                    model=request.model,
                    duration_ms=duration_ms,
                    db=db,
                )
            except Exception:
                pass

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
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    """Public workflow execution (non-stream)."""
    _check_scope(ctx, "workflow")

    record = _resolve_workflow_record_for_public(db, workflow_id, ctx)
    wf = workflow_persistence_service.get_workflow_definition(workflow_id, record.tenant_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    raw_input = payload.get("input_data") or payload.get("input") or {}
    _validate_public_input(wf, raw_input)
    input_data = _build_public_input_data(raw_input, record.tenant_id, ctx.tenant_id)
    raw_config = payload.get("config")
    run_config = raw_config if isinstance(raw_config, dict) else {}

    context = await workflow_execution_engine.execute_workflow(
        workflow_definition=wf,
        input_data=input_data,
        debug=bool(payload.get("debug")),
        enable_parallel=payload.get("enable_parallel"),
        config=run_config,
    )

    workflow_persistence_service.save_workflow_execution(
        context,
        record.tenant_id,
        record.owner_id,
        execution_config=run_config,
        debug=bool(payload.get("debug")),
        enable_parallel=payload.get("enable_parallel"),
    )

    result = {
        "execution_id": context.execution_id,
        "status": context.status,
        "start_time": context.start_time,
        "end_time": context.end_time,
        "output_data": context.output_data,
        "error": context.error,
    }
    try:
        record_api_key_usage(
            api_key_id=ctx.api_key_id,
            tenant_id=ctx.tenant_id,
            path=str(http_request.url.path if http_request else f"/api/v1/public/workflows/{workflow_id}/execute"),
            method=str(http_request.method if http_request else "POST"),
            status_code=200,
            tokens=None,
            model=None,
            duration_ms=None,
            db=db,
        )
    except Exception:
        pass
    return result


@router.post("/workflows/{workflow_id}/run")
async def public_run_workflow(
    workflow_id: str,
    request: PublicWorkflowRunRequest,
    ctx: PublicContext = Depends(get_public_context),
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    """Public workflow execution (non-stream, stable API)."""
    _check_scope(ctx, "workflow")

    record = _resolve_workflow_record_for_public(db, workflow_id, ctx)
    wf = workflow_persistence_service.get_workflow_definition(workflow_id, record.tenant_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    _validate_public_input(wf, request.input_data or {})
    input_data = _build_public_input_data(request.input_data or {}, record.tenant_id, ctx.tenant_id)
    execution_context = await workflow_execution_engine.execute_workflow(
        workflow_definition=wf,
        input_data=input_data,
        debug=bool(request.debug),
        enable_parallel=request.enable_parallel,
        config=request.config,
    )

    workflow_persistence_service.save_workflow_execution(
        execution_context,
        record.tenant_id,
        record.owner_id,
        execution_config=request.config,
        debug=bool(request.debug),
        enable_parallel=request.enable_parallel,
    )

    result = {
        "execution_id": execution_context.execution_id,
        "status": execution_context.status,
        "output_data": execution_context.output_data,
        "error": execution_context.error,
        "metrics": execution_context.metrics,
    }
    try:
        record_api_key_usage(
            api_key_id=ctx.api_key_id,
            tenant_id=ctx.tenant_id,
            path=str(http_request.url.path if http_request else f"/api/v1/public/workflows/{workflow_id}/run"),
            method=str(http_request.method if http_request else "POST"),
            status_code=200,
            tokens=None,
            model=None,
            duration_ms=None,
            db=db,
        )
    except Exception:
        pass
    return result


@router.post("/workflows/{workflow_id}/run/stream")
async def public_run_workflow_stream(
    workflow_id: str,
    request: PublicWorkflowRunRequest,
    ctx: PublicContext = Depends(get_public_context),
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    """Public workflow execution (streaming SSE). Emits started/progress/complete then [DONE]."""
    _check_scope(ctx, "workflow")

    record = _resolve_workflow_record_for_public(db, workflow_id, ctx)
    wf = workflow_persistence_service.get_workflow_definition(workflow_id, record.tenant_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    async def event_stream() -> AsyncGenerator[str, None]:
        start_time = time.time()
        status_code = {"value": 200}
        q: asyncio.Queue[Optional[dict]] = asyncio.Queue()

        def _step_to_dict(step: ExecutionStep) -> Dict[str, Any]:
            base: Dict[str, Any] = {
                "step_id": step.step_id,
                "node_id": step.node_id,
                "node_name": step.node_name,
                "status": step.status,
                "duration": step.duration,
                "error": getattr(step, "error", None),
            }
            if request.debug:
                base["input"] = step.input_data
                base["output"] = step.output_data
            else:
                try:
                    base["outputKeys"] = list((step.output_data or {}).keys())
                except Exception:
                    base["outputKeys"] = []
            return base

        async def _on_step(step: ExecutionStep, current: int, total: int) -> None:
            await q.put(
                {
                    "type": "progress",
                    "step": _step_to_dict(step),
                    "progress": {"current": current, "total": total},
                }
            )

        async def _runner() -> None:
            try:
                _validate_public_input(wf, request.input_data or {})
                input_data = _build_public_input_data(request.input_data or {}, record.tenant_id, ctx.tenant_id)
                # For real-time progress, run serially for now.
                execution_context = await workflow_execution_engine.execute_workflow(
                    workflow_definition=wf,
                    input_data=input_data,
                    debug=bool(request.debug),
                    enable_parallel=False,
                    on_step=_on_step,
                    config=request.config,
                )
                workflow_persistence_service.save_workflow_execution(
                    execution_context,
                    record.tenant_id,
                    record.owner_id,
                    execution_config=request.config,
                    debug=bool(request.debug),
                    enable_parallel=False,
                )
                await q.put(
                    {
                        "type": "complete",
                        "result": {
                            "execution_id": execution_context.execution_id,
                            "status": execution_context.status,
                            "output_data": execution_context.output_data or {},
                            "error": execution_context.error,
                            "metrics": execution_context.metrics,
                        },
                    }
                )
            except Exception as e:
                logger.error("public workflow stream failed", error=str(e), exc_info=True)
                status_code["value"] = status.HTTP_500_INTERNAL_SERVER_ERROR
                await q.put({"type": "error", "error": {"message": str(e), "type": type(e).__name__}})
            finally:
                await q.put(None)

        task = asyncio.create_task(_runner())
        try:
            yield f"data: {json.dumps({'type': 'started'})}\n\n"
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
            yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            task.cancel()
            raise
        finally:
            try:
                await task
            except Exception:
                pass
            duration_ms = int((time.time() - start_time) * 1000)
            try:
                record_api_key_usage(
                    api_key_id=ctx.api_key_id,
                    tenant_id=ctx.tenant_id,
                    path=str(http_request.url.path if http_request else f"/api/v1/public/workflows/{workflow_id}/run/stream"),
                    method=str(http_request.method if http_request else "POST"),
                    status_code=status_code["value"],
                    tokens=None,
                    model=None,
                    duration_ms=duration_ms,
                    db=db,
                )
            except Exception:
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/workflows/{workflow_id}/io-schema")
async def public_workflow_io_schema(
    workflow_id: str,
    ctx: PublicContext = Depends(get_public_context),
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    """Public workflow IO schema. Same-tenant key can read private; cross-tenant only public."""
    _check_scope(ctx, "workflow")
    record = _resolve_workflow_record_for_public(db, workflow_id, ctx)
    wf = workflow_persistence_service.get_workflow_definition(workflow_id, record.tenant_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    schema = _infer_workflow_io_schema(wf)
    try:
        record_api_key_usage(
            api_key_id=ctx.api_key_id,
            tenant_id=ctx.tenant_id,
            path=str(http_request.url.path if http_request else f"/api/v1/public/workflows/{workflow_id}/io-schema"),
            method=str(http_request.method if http_request else "GET"),
            status_code=200,
            tokens=None,
            model=None,
            duration_ms=None,
            db=db,
        )
    except Exception:
        pass
    return schema
