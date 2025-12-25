"""
完整的工作流API端点
支持工作流的创建、执行、监控和管理
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, root_validator
import json
import asyncio
import uuid
from datetime import datetime
import structlog
from sqlalchemy.orm import Session
import networkx as nx

from app.schemas.workflow import (
    WorkflowDefinition,
    WorkflowNode,
    WorkflowEdge,
    WorkflowExecutionContext,
    WorkflowTemplate,
    DataFlowValidation,
    NodeFunctionSignature,
    NodeInputSchema,
    NodeOutputSchema,
    DataType,
    ExecutionStep,
)
from app.services.workflow_execution_engine import workflow_execution_engine
from app.services.workflow_error_handler import workflow_error_handler, RecoveryStrategy, RetryConfig, RecoveryAction, RetryStrategy
from app.services.workflow_parallel_executor import workflow_parallel_executor
from app.services.workflow_performance_monitor import workflow_performance_monitor, AlertRule, AlertSeverity
from app.services.workflow_persistence_service import workflow_persistence_service
from app.core.dependencies import get_tenant_id, get_current_user
from app.db.models.user import User
from app.db.database import get_db
from app.db.models.workflow import (
    WorkflowDefinition as DBWorkflowDefinition,
    WorkflowExecution as DBWorkflowExecution,
)
from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import get_elasticsearch_service
from app.services.reranking_service import reranking_service, RerankingProvider
from app.utils.kb_collection import resolve_kb_collection_name

logger = structlog.get_logger(__name__)

router = APIRouter()

ADMIN_ROLES = {"super_admin", "tenant_admin"}


def _is_admin(user: User) -> bool:
    return bool(getattr(user, "role", None) in ADMIN_ROLES)


def _can_read_workflow(db_workflow: DBWorkflowDefinition, user: User) -> bool:
    return _is_admin(user) or db_workflow.owner_id == user.id or bool(db_workflow.is_public)


def _can_write_workflow(db_workflow: DBWorkflowDefinition, user: User) -> bool:
    return _is_admin(user) or db_workflow.owner_id == user.id


def _get_db_workflow_or_404(db: Session, tenant_id: int, workflow_id: str) -> DBWorkflowDefinition:
    db_workflow = (
        db.query(DBWorkflowDefinition)
        .filter(
            DBWorkflowDefinition.workflow_id == workflow_id,
            DBWorkflowDefinition.tenant_id == tenant_id,
        )
        .first()
    )
    if not db_workflow:
        raise HTTPException(status_code=404, detail="工作流不存在")
    return db_workflow


def _require_admin(user: User) -> None:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin access required")


class WorkflowCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    global_config: Dict[str, Any] = {}
    metadata: Optional[Dict[str, Any]] = None
    is_public: bool = False


class WorkflowExecuteRequest(BaseModel):
    input_data: Dict[str, Any]
    config: Dict[str, Any] = {}
    debug: bool = False
    enable_parallel: Optional[bool] = None

    @root_validator(pre=True)
    def _coerce_input_alias(cls, values: Any):
        # 兼容历史字段 input -> input_data
        if isinstance(values, dict):
            if values.get("input_data") is None:
                values["input_data"] = {}
            if ("input_data" not in values or values.get("input_data") == {}) and isinstance(values.get("input"), dict):
                values["input_data"] = values.get("input") or {}
        return values


class WorkflowUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    global_config: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    is_public: Optional[bool] = None


class WorkflowTemplateCreateRequest(BaseModel):
    name: str
    description: str = ""
    category: str = "custom"
    subcategory: Optional[str] = None
    tags: List[str] = []
    difficulty: str = "intermediate"
    estimated_time: str = "30分钟"
    use_cases: List[str] = []
    requirements: List[str] = []
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    is_public: bool = False


class WorkflowTemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    tags: Optional[List[str]] = None
    difficulty: Optional[str] = None
    estimated_time: Optional[str] = None
    use_cases: Optional[List[str]] = None
    requirements: Optional[List[str]] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    global_config: Optional[Dict[str, Any]] = None
    is_public: Optional[bool] = None


class WorkflowTemplateSearchRequest(BaseModel):
    query: Optional[str] = None
    category: Optional[str] = None
    difficulty: Optional[str] = None
    tags: Optional[List[str]] = None
    sort_by: str = "popular"
    limit: int = 20
    offset: int = 0


@router.post("/", response_model=Dict[str, Any])
async def create_workflow(
    request: WorkflowCreateRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """创建工作流"""
    try:
        # 转换前端数据到工作流定义
        workflow_definition = await _convert_to_workflow_definition(request)
        
        # 验证工作流
        validation = await workflow_execution_engine._validate_workflow(workflow_definition)
        if not validation.is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"工作流验证失败: {validation.errors}"
            )
        
        # 使用持久化服务保存工作流
        workflow_id = workflow_persistence_service.save_workflow_definition(
            workflow_definition,
            tenant_id,
            current_user.id,
            is_public=bool(request.is_public),
        )
        
        logger.info(
            "工作流创建成功",
            workflow_id=workflow_id,
            name=workflow_definition.name,
            tenant_id=tenant_id,
            user_id=current_user.id
        )
        
        return {
            "id": workflow_id,
            "name": workflow_definition.name,
            "description": workflow_definition.description,
            "created_at": datetime.now().isoformat(),
            "status": "created"
        }
        
    except Exception as e:
        logger.error("工作流创建失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=List[Dict[str, Any]])
async def list_workflows(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0
):
    """获取工作流列表"""
    try:
        workflows = workflow_persistence_service.list_workflow_definitions(
            tenant_id,
            limit,
            offset,
            user_id=current_user.id,
            is_admin=_is_admin(current_user),
            include_public=True,
        )
        
        return workflows
        
    except Exception as e:
        logger.error("获取工作流列表失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{workflow_id}", response_model=Dict[str, Any])
async def get_workflow(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取工作流详情"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权访问该工作流")

        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        # 获取执行历史统计（非 owner 只展示自己的执行）
        exec_query = db.query(DBWorkflowExecution).filter(
            DBWorkflowExecution.tenant_id == tenant_id,
            DBWorkflowExecution.workflow_definition_id == workflow_id,
        )
        if not (_is_admin(current_user) or db_workflow.owner_id == current_user.id):
            exec_query = exec_query.filter(DBWorkflowExecution.executed_by == current_user.id)
        execution_count = exec_query.count()
        
        return {
            "id": workflow_def.id,
            "name": workflow_def.name,
            "description": workflow_def.description,
            "version": workflow_def.version,
            "owner_id": db_workflow.owner_id,
            "is_public": bool(db_workflow.is_public),
            "nodes": [_node_to_dict(node) for node in workflow_def.nodes],
            "edges": [_edge_to_dict(edge) for edge in workflow_def.edges],
            "global_config": workflow_def.global_config,
            "metadata": workflow_def.metadata,
            "execution_count": execution_count,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("获取工作流详情失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{workflow_id}", response_model=Dict[str, Any])
async def update_workflow(
    workflow_id: str,
    request: WorkflowUpdateRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新工作流"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_write_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权修改该工作流")

        # 获取现有定义
        existing = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not existing:
            raise HTTPException(status_code=404, detail="工作流不存在")

        # 构造更新字典
        updates: Dict[str, Any] = {}
        if request.name is not None:
            updates["name"] = request.name
        if request.description is not None:
            updates["description"] = request.description
        if request.global_config is not None:
            updates["global_config"] = request.global_config
        if request.metadata is not None:
            updates["workflow_metadata"] = request.metadata
        if request.is_public is not None:
            updates["is_public"] = bool(request.is_public)
        if request.nodes is not None:
            nodes = await _convert_nodes(request.nodes)
            updates["nodes"] = [n.dict() for n in nodes]
        if request.edges is not None:
            edges = await _convert_edges(request.edges)
            updates["edges"] = [e.dict() for e in edges]

        # 如果节点/边被更新，需要重新校验
        if "nodes" in updates or "edges" in updates or "global_config" in updates:
            new_def = WorkflowDefinition(
                id=existing.id,
                name=updates.get("name", existing.name),
                description=updates.get("description", existing.description),
                nodes=[WorkflowNode(**n) for n in (updates.get("nodes") or [node.dict() for node in existing.nodes])],
                edges=[WorkflowEdge(**e) for e in (updates.get("edges") or [edge.dict() for edge in existing.edges])],
                global_config=updates.get("global_config", existing.global_config),
                version=existing.version,
                metadata=existing.metadata,
            )
            validation = await workflow_execution_engine._validate_workflow(new_def)
            if not validation.is_valid:
                raise HTTPException(status_code=400, detail=f"工作流验证失败: {validation.errors}")

        ok = workflow_persistence_service.update_workflow_definition(workflow_id, tenant_id, updates)
        if not ok:
            raise HTTPException(status_code=500, detail="工作流更新失败")

        logger.info("工作流更新成功", workflow_id=workflow_id, user_id=current_user.id)

        updated = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        return {
            "id": updated.id,
            "name": updated.name,
            "description": updated.description,
            "updated_at": datetime.now().isoformat(),
            "status": "updated",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("工作流更新失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除工作流"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_write_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权删除该工作流")

        ok = workflow_persistence_service.delete_workflow_definition(workflow_id, tenant_id)
        if not ok:
            raise HTTPException(status_code=404, detail="工作流不存在")

        logger.info("工作流删除成功", workflow_id=workflow_id, user_id=current_user.id)
        return {"message": "工作流删除成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("工作流删除失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/execute", response_model=Dict[str, Any])
async def execute_workflow(
    workflow_id: str,
    request: WorkflowExecuteRequest,
    background_tasks: BackgroundTasks,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """执行工作流"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权执行该工作流")

        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        # 后台执行工作流
        # 注入租户/用户上下文信息
        input_data = dict(request.input_data or {})
        # Always enforce authenticated execution context (avoid spoofing tenant/user ids).
        input_data["tenant_id"] = tenant_id
        input_data["user_id"] = current_user.id

        execution_context = await workflow_execution_engine.execute_workflow(
            workflow_definition=workflow_def,
            input_data=input_data,
            debug=request.debug,
            enable_parallel=request.enable_parallel,
            config=request.config,
        )
        
        # 保存执行记录
        workflow_persistence_service.save_workflow_execution(
            execution_context,
            tenant_id,
            current_user.id,
            execution_config=request.config,
            debug=request.debug,
            enable_parallel=request.enable_parallel,
        )
        
        logger.info(
            "工作流执行完成",
            workflow_id=workflow_id,
            execution_id=execution_context.execution_id,
            status=execution_context.status
        )
        
        return {
            "execution_id": execution_context.execution_id,
            "status": execution_context.status,
            "start_time": execution_context.start_time,
            "end_time": execution_context.end_time,
            "output_data": execution_context.output_data,
            "error": execution_context.error,
            "steps": [
                {
                    "step_id": step.step_id,
                    "node_id": step.node_id,
                    "node_name": step.node_name,
                    "status": step.status,
                    "duration": step.duration,
                    "error": step.error
                }
                for step in execution_context.steps
            ],
            "error_statistics": workflow_error_handler.get_error_statistics()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("工作流执行失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/execute/stream")
async def execute_workflow_stream(
    workflow_id: str,
    request: WorkflowExecuteRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """流式执行工作流"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权执行该工作流")

        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        async def stream_execution():
            # Real streaming: emit progress as each step completes.
            q: "asyncio.Queue[dict | None]" = asyncio.Queue()
            include_payload = bool(request.debug)

            def _step_to_dict(step: ExecutionStep) -> Dict[str, Any]:
                base: Dict[str, Any] = {
                    "id": step.step_id,
                    "nodeId": step.node_id,
                    "nodeName": step.node_name,
                    "status": step.status,
                    "startTime": step.start_time,
                    "endTime": step.end_time,
                    "duration": step.duration,
                    "error": step.error,
                    "memory": step.memory_usage,
                }
                if include_payload:
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
                    input_data = dict(request.input_data or {})
                    # Always enforce authenticated execution context (avoid spoofing tenant/user ids).
                    input_data["tenant_id"] = tenant_id
                    input_data["user_id"] = current_user.id

                    # For real-time progress, run serially (parallel executor currently batches steps).
                    execution_context = await workflow_execution_engine.execute_workflow(
                        workflow_definition=workflow_def,
                        input_data=input_data,
                        debug=request.debug,
                        enable_parallel=False,
                        on_step=_on_step,
                        config=request.config,
                    )

                    final_output = execution_context.output_data or {}
                    await q.put(
                        {
                            "type": "complete",
                            "result": {
                                "execution_id": execution_context.execution_id,
                                "status": execution_context.status,
                                "output_data": final_output,
                                "error": execution_context.error,
                                "metrics": execution_context.metrics,
                            },
                        }
                    )

                    try:
                        workflow_persistence_service.save_workflow_execution(
                            execution_context,
                            tenant_id,
                            current_user.id,
                            execution_config=request.config,
                            debug=request.debug,
                            enable_parallel=False,
                        )
                    except Exception as save_error:
                        logger.error("保存执行记录失败", error=str(save_error))
                except Exception as e:
                    logger.error("流式工作流执行异常", error=str(e), exc_info=True)
                    await q.put(
                        {
                            "type": "error",
                            "error": {"message": str(e), "type": type(e).__name__},
                        }
                    )
                finally:
                    await q.put(None)

            task = asyncio.create_task(_runner())

            try:
                # Immediately notify the client that execution started (avoid "no response").
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
        
        return StreamingResponse(
            stream_execution(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "X-Accel-Buffering": "no"  # 防止nginx缓冲
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("流式工作流执行失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{workflow_id}/executions", response_model=Dict[str, Any])
async def get_execution_history(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 20,
    offset: int = 0
):
    """获取执行历史（分页）"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权访问该工作流")

        executed_by = None
        if not (_is_admin(current_user) or db_workflow.owner_id == current_user.id):
            executed_by = current_user.id
        
        executions, total = workflow_persistence_service.list_workflow_executions(
            workflow_id,
            tenant_id,
            limit,
            offset,
            executed_by=executed_by,
        )
        
        return {
            "executions": executions,
            "total": total,
            "limit": limit,
            "offset": offset,
            "workflow_id": workflow_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("获取执行历史失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{workflow_id}/executions/{execution_id}", response_model=Dict[str, Any])
async def get_execution_detail(
    workflow_id: str,
    execution_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取某次执行的完整详情（含步骤 input/output）。"""
    db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
    if not _can_read_workflow(db_workflow, current_user):
        raise HTTPException(status_code=403, detail="无权访问该工作流")

    db_execution = (
        db.query(DBWorkflowExecution)
        .filter(
            DBWorkflowExecution.execution_id == execution_id,
            DBWorkflowExecution.tenant_id == tenant_id,
        )
        .first()
    )
    if not db_execution or db_execution.workflow_definition_id != workflow_id:
        raise HTTPException(status_code=404, detail="执行不存在")

    if not (_is_admin(current_user) or db_workflow.owner_id == current_user.id or db_execution.executed_by == current_user.id):
        raise HTTPException(status_code=403, detail="无权访问该执行详情")

    ctx = workflow_persistence_service.get_workflow_execution(execution_id, tenant_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="执行详情不存在")

    return {
        "execution_id": ctx.execution_id,
        "workflow_id": ctx.workflow_id,
        "status": ctx.status,
        "start_time": ctx.start_time,
        "end_time": ctx.end_time,
        "duration": (ctx.end_time - ctx.start_time) if (ctx.start_time and ctx.end_time) else None,
        "input_data": ctx.input_data,
        "output_data": ctx.output_data,
        "error": ctx.error,
        "metrics": ctx.metrics,
        "steps": [
            {
                "step_id": s.step_id,
                "node_id": s.node_id,
                "node_name": s.node_name,
                "status": s.status,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "duration": s.duration,
                "input": s.input_data,
                "output": s.output_data,
                "error": s.error,
                "memory": s.memory_usage,
                "metrics": s.metrics,
            }
            for s in (ctx.steps or [])
        ],
    }


@router.get("/executions", response_model=Dict[str, Any])
async def get_execution_history_paginated(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    workflow_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
    offset: int = 0
):
    """获取分页的执行历史记录"""
    try:
        if workflow_id:
            db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
            if not _can_read_workflow(db_workflow, current_user):
                raise HTTPException(status_code=403, detail="无权访问该工作流")

        executed_by = None
        if not _is_admin(current_user):
            executed_by = current_user.id

        executions, total = workflow_persistence_service.get_execution_history_paginated(
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            status=status,
            executed_by=executed_by,
            limit=limit,
            offset=offset
        )
        
        return {
            "executions": executions,
            "total": total,
            "limit": limit,
            "offset": offset,
            "filters": {
                "workflow_id": workflow_id,
                "status": status
            }
        }
        
    except Exception as e:
        logger.error("获取分页执行历史失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/executions/{execution_id}/stop")
async def stop_execution(
    workflow_id: str,
    execution_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """停止工作流执行"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权访问该工作流")

        db_execution = (
            db.query(DBWorkflowExecution)
            .filter(
                DBWorkflowExecution.execution_id == execution_id,
                DBWorkflowExecution.tenant_id == tenant_id,
            )
            .first()
        )
        if not db_execution or db_execution.workflow_definition_id != workflow_id:
            raise HTTPException(status_code=404, detail="执行不存在")

        if not (_is_admin(current_user) or db_workflow.owner_id == current_user.id or db_execution.executed_by == current_user.id):
            raise HTTPException(status_code=403, detail="无权停止该执行")

        success = await workflow_execution_engine.stop_execution(execution_id)
        
        if success:
            return {"message": "执行已停止"}
        else:
            raise HTTPException(status_code=404, detail="执行不存在或已完成")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error("停止执行失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{workflow_id}/executions/{execution_id}/steps/{node_id}/retry", response_model=Dict[str, Any])
async def retry_execution_step(
    workflow_id: str,
    execution_id: str,
    node_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """从指定节点及其下游重新执行（单步重试）。"""
    try:
        # 获取工作流与基线执行
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权访问该工作流")

        db_execution = (
            db.query(DBWorkflowExecution)
            .filter(
                DBWorkflowExecution.execution_id == execution_id,
                DBWorkflowExecution.tenant_id == tenant_id,
            )
            .first()
        )
        if not db_execution or db_execution.workflow_definition_id != workflow_id:
            raise HTTPException(status_code=404, detail="基线执行不存在")

        if not (_is_admin(current_user) or db_workflow.owner_id == current_user.id or db_execution.executed_by == current_user.id):
            raise HTTPException(status_code=403, detail="无权重试该执行")

        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")

        base_execution = workflow_persistence_service.get_workflow_execution(execution_id, tenant_id)
        if not base_execution:
            raise HTTPException(status_code=404, detail="基线执行不存在")
        if base_execution.workflow_id != workflow_id:
            raise HTTPException(status_code=400, detail="执行与工作流ID不匹配")

        # 执行部分重试
        new_context = await workflow_execution_engine.retry_from_node(
            workflow_definition=workflow_def,
            base_execution=base_execution,
            start_node_id=node_id,
            debug=False,
        )

        # 持久化此次重试执行
        workflow_persistence_service.save_workflow_execution(
            new_context, tenant_id, current_user.id
        )

        return {
            "execution_id": new_context.execution_id,
            "status": new_context.status,
            "start_time": new_context.start_time,
            "end_time": new_context.end_time,
            "output_data": new_context.output_data,
            "error": new_context.error,
            "steps": [
                {
                    "step_id": s.step_id,
                    "node_id": s.node_id,
                    "node_name": s.node_name,
                    "status": s.status,
                    "duration": s.duration,
                    "error": s.error,
                    "input": s.input_data,
                    "output": s.output_data,
                }
                for s in new_context.steps
            ],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("单步重试失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/validate", response_model=Dict[str, Any])
async def validate_workflow(request: WorkflowCreateRequest):
    """验证工作流定义"""
    try:
        workflow_definition = await _convert_to_workflow_definition(request)
        validation = await workflow_execution_engine._validate_workflow(workflow_definition)
        
        return {
            "is_valid": validation.is_valid,
            "errors": validation.errors,
            "warnings": validation.warnings,
            "suggestions": validation.suggestions
        }
        
    except Exception as e:
        logger.error("工作流验证失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _datatype_to_jsonschema(dt: DataType) -> Dict[str, Any]:
    mapping = {
        DataType.STRING: {"type": "string"},
        DataType.NUMBER: {"type": "number"},
        DataType.BOOLEAN: {"type": "boolean"},
        DataType.ARRAY: {"type": "array"},
        DataType.OBJECT: {"type": "object"},
        DataType.FILE: {"type": "string"},
        DataType.IMAGE: {"type": "string"},
        DataType.AUDIO: {"type": "string"},
        DataType.VIDEO: {"type": "string"},
    }
    return mapping.get(dt, {"type": "string"})


def _node_schema_to_property(s: Any) -> Dict[str, Any]:
    """Convert NodeInputSchema/NodeOutputSchema to a JSONSchema-ish property."""
    try:
        base = _datatype_to_jsonschema(s.type)
    except Exception:
        base = {"type": "object"}
    prop: Dict[str, Any] = {**base}
    if getattr(s, "description", None):
        prop["description"] = s.description
    if getattr(s, "default", None) is not None:
        prop["default"] = s.default
    if getattr(s, "example", None) is not None:
        prop["examples"] = [s.example]
    validation = getattr(s, "validation", None)
    if isinstance(validation, dict):
        for k_in, k_out in [
            ("min", "minimum"),
            ("max", "maximum"),
            ("min_length", "minLength"),
            ("max_length", "maxLength"),
            ("pattern", "pattern"),
        ]:
            if validation.get(k_in) is not None:
                prop[k_out] = validation[k_in]
        if isinstance(validation.get("enum"), list):
            prop["enum"] = validation["enum"]
    return prop


def _resolve_target_input_alias(target_node: WorkflowNode, target_input: str) -> str:
    """Align with engine aliasing behavior so schema inference matches runtime."""
    names = [inp.name for inp in (target_node.function_signature.inputs or [])]
    key = target_input or ""
    if isinstance(key, str) and key.startswith("input"):
        key = "input"
    if key in names and key:
        return key
    # Prefer common carrier keys if present
    priority = ["data", "prompt", "query", "text", "value", "url"]
    for p in priority:
        if p in names:
            return p
    return names[0] if names else key


def _infer_workflow_io_schema(workflow_def: WorkflowDefinition) -> Dict[str, Any]:
    # If user defined workflow-level inputs in metadata, prefer it (Dify-like variable panel).
    try:
        md = workflow_def.metadata or {}
        ui = md.get("ui") if isinstance(md, dict) else {}
        ui_inputs = None
        if isinstance(ui, dict) and isinstance(ui.get("inputs"), list):
            ui_inputs = ui.get("inputs")
        elif isinstance(md, dict) and isinstance(md.get("inputs"), list):
            ui_inputs = md.get("inputs")
        if isinstance(ui_inputs, list) and ui_inputs:
            props: Dict[str, Any] = {}
            required: list[str] = []

            def _t_to_schema(t: Any) -> Dict[str, Any]:
                if isinstance(t, DataType):
                    return _datatype_to_jsonschema(t)
                if isinstance(t, str):
                    tt = t.strip().lower()
                    if tt in ("string", "text"):
                        return {"type": "string"}
                    if tt in ("number", "float", "int", "integer"):
                        return {"type": "number"}
                    if tt in ("boolean", "bool"):
                        return {"type": "boolean"}
                    if tt in ("object", "json", "dict"):
                        return {"type": "object"}
                    if tt in ("array", "list"):
                        return {"type": "array"}
                return {"type": "string"}

            for item in ui_inputs:
                if not isinstance(item, dict):
                    continue
                key = str(item.get("key") or item.get("name") or "").strip()
                if not key:
                    continue
                schema = _t_to_schema(item.get("type"))
                if item.get("description"):
                    schema["description"] = str(item.get("description"))
                if item.get("default") is not None:
                    schema["default"] = item.get("default")
                enum_vals = item.get("enum")
                if isinstance(enum_vals, list) and enum_vals:
                    schema["enum"] = enum_vals
                props[key] = schema
                if bool(item.get("required")):
                    required.append(key)

            # Always keep common convenience fields
            props.setdefault(
                "input",
                {"type": "string", "description": "常用输入文本（Tester 会同时映射到 input/prompt/query/text）。"},
            )
            props.setdefault(
                "data",
                {"type": "object", "description": "结构化输入（JSON 对象），用于透传到 data。"},
            )

            input_schema = {
                "type": "object",
                "title": "WorkflowInput",
                "properties": props,
                "required": sorted(list(set(required))),
                "additionalProperties": True,
            }

            # Output schema still inferred from graph
            base = _infer_workflow_io_schema(WorkflowDefinition(
                id=workflow_def.id,
                name=workflow_def.name,
                description=workflow_def.description,
                version=workflow_def.version,
                nodes=workflow_def.nodes,
                edges=workflow_def.edges,
                global_config=workflow_def.global_config,
                metadata={},  # avoid recursion using metadata path
            ))
            base["input_schema"] = input_schema
            return base
    except Exception:
        pass

    nodes = {n.id: n for n in (workflow_def.nodes or [])}

    graph = nx.DiGraph()
    for n in workflow_def.nodes or []:
        graph.add_node(n.id)
    for e in workflow_def.edges or []:
        graph.add_edge(e.source, e.target, edge=e)

    provided_by_edges: Dict[str, set[str]] = {nid: set() for nid in nodes.keys()}
    for e in workflow_def.edges or []:
        target = nodes.get(e.target)
        if not target:
            continue
        resolved = _resolve_target_input_alias(target, e.target_input)
        provided_by_edges[e.target].add(resolved)

    provided_by_overrides: Dict[str, set[str]] = {nid: set() for nid in nodes.keys()}
    for nid, n in nodes.items():
        cfg = n.config or {}
        overrides = cfg.get("overrides") if isinstance(cfg, dict) else None
        if isinstance(overrides, dict):
            provided_by_overrides[nid] = {str(k) for k in overrides.keys() if k}

    # Compute workflow-level input candidates (best-effort)
    required_props: Dict[str, Dict[str, Any]] = {}
    required_names: set[str] = set()

    for nid, n in nodes.items():
        sig_inputs = list(getattr(n.function_signature, "inputs", []) or [])
        missing_required = []
        for inp in sig_inputs:
            if not getattr(inp, "required", False):
                continue
            name = inp.name
            if not name:
                continue
            if name in provided_by_overrides.get(nid, set()):
                continue
            provided = provided_by_edges.get(nid, set())
            # Heuristic: if 'data' is provided, treat prompt/query/text as satisfied (they can live inside data)
            if name in ("prompt", "query", "text") and "data" in provided:
                continue
            if name in provided:
                continue
            missing_required.append(inp)

        # For nodes without predecessors, required inputs are pulled from workflow input_data
        # For others, missing required likely indicates the workflow expects global input too.
        for inp in missing_required:
            required_names.add(inp.name)
            required_props[inp.name] = _node_schema_to_property(inp)

    # Normalize common text-like required fields into a single `input` entry (Dify-like)
    text_like = {"prompt", "query", "text", "input"}
    if required_names & text_like:
        for k in list(required_props.keys()):
            if k in text_like:
                required_props.pop(k, None)
        required_names -= text_like
        required_names.add("input")
        required_props.setdefault(
            "input",
            {
                "type": "string",
                "description": "常用输入文本（Tester 会同时映射到 input/prompt/query/text）。",
            },
        )

    # Always offer common inputs for convenience (non-required unless inferred)
    props: Dict[str, Any] = {
        "input": {
            "type": "string",
            "description": "常用输入文本（Tester 会同时映射到 input/prompt/query/text）。",
        },
        "text": {
            "type": "string",
            "description": "兼容字段：text（若提供也会映射到 prompt/query/input）。",
        },
        "data": {
            "type": "object",
            "description": "结构化输入（JSON 对象），用于透传到 data。",
        },
    }
    props.update(required_props)

    input_required = sorted(list(required_names)) if required_names else []
    input_schema = {
        "type": "object",
        "title": "WorkflowInput",
        "properties": props,
        "required": input_required,
        "additionalProperties": True,
    }

    # Output schema: prefer output nodes; otherwise last node outputs
    output_nodes = [n for n in (workflow_def.nodes or []) if n.type == "output"]
    output_props: Dict[str, Any] = {}
    output_required: list[str] = []

    if output_nodes:
        for out_node in output_nodes:
            for o in list(getattr(out_node.function_signature, "outputs", []) or []):
                output_props[o.name] = _node_schema_to_property(o)
                if getattr(o, "required", False):
                    output_required.append(o.name)
    else:
        last_node: Optional[WorkflowNode] = None
        try:
            order = list(nx.topological_sort(graph))
            if order:
                last_node = nodes.get(order[-1])
        except Exception:
            last_node = None
        if not last_node and workflow_def.nodes:
            last_node = workflow_def.nodes[-1]
        if last_node:
            for o in list(getattr(last_node.function_signature, "outputs", []) or []):
                output_props[o.name] = _node_schema_to_property(o)
                if getattr(o, "required", False):
                    output_required.append(o.name)

    output_schema = {
        "type": "object",
        "title": "WorkflowOutput",
        "properties": output_props or {"output_data": {"type": "object"}},
        "required": sorted(list(set(output_required))),
        "additionalProperties": True,
    }

    return {
        "workflow_id": workflow_def.id,
        "input_schema": input_schema,
        "output_schema": output_schema,
    }


def _validate_input_against_schema(input_data: Dict[str, Any], schema: Dict[str, Any]) -> List[str]:
    """Validate input_data against inferred input schema (required fields only)."""
    if not isinstance(input_data, dict):
        return ["input_data must be an object"]
    if not isinstance(schema, dict):
        return []

    input_schema = schema.get("input_schema")
    if not isinstance(input_schema, dict):
        return []

    required = input_schema.get("required")
    if not isinstance(required, list):
        return []

    errors: List[str] = []
    for key in required:
        if key not in input_data or input_data.get(key) is None:
            errors.append(f"Missing required field: {key}")
    return errors


@router.get("/{workflow_id}/io-schema", response_model=Dict[str, Any])
async def get_workflow_io_schema(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """推导工作流级入参/出参 schema（用于前端 Tester 自动生成表单）。"""
    db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
    if not _can_read_workflow(db_workflow, current_user):
        raise HTTPException(status_code=403, detail="无权访问该工作流")

    wf = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
    if not wf:
        raise HTTPException(status_code=404, detail="工作流不存在")

    return _infer_workflow_io_schema(wf)


@router.post("/generate-code", response_model=Dict[str, Any])
async def generate_workflow_code(request: WorkflowCreateRequest):
    """生成工作流代码"""
    try:
        workflow_definition = await _convert_to_workflow_definition(request)
        
        # 生成Python代码
        python_code = await _generate_python_code(workflow_definition)
        
        return {
            "python_code": python_code,
            "language": "python",
            "framework": "langgraph"
        }
        
    except Exception as e:
        logger.error("代码生成失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test/retrieve")
async def test_retrieve(
    payload: Dict[str, Any],
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """预览检索结果（不进行 LLM 生成）。

    请求体：
      - knowledge_base: str
      - query: str
      - top_k: int (默认 5)
      - score_threshold: float (可选)
      - rerank: bool (默认 True)
    """
    kb = (payload.get("knowledge_base") or payload.get("kb") or "").strip()
    query = (payload.get("query") or "").strip()
    if not kb:
        raise HTTPException(status_code=400, detail="knowledge_base is required")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    top_k = int(payload.get("top_k") or 5)
    if top_k <= 0:
        top_k = 5
    use_rerank = bool(payload.get("rerank", True))

    # 1) 生成查询向量
    emb = await llm_service.get_embeddings(texts=[query], tenant_id=tenant_id, user_id=current_user.id)
    if not emb.get("success") or not emb.get("embeddings"):
        raise HTTPException(status_code=500, detail=f"Failed to embed query: {emb.get('error')}")
    query_vec = emb["embeddings"][0]

    # 2) Milvus 向量检索
    collection = resolve_kb_collection_name(db, tenant_id, kb_name=kb)
    try:
        vec_results = await milvus_service.search(
            collection_name=collection,
            query_vector=query_vec,
            top_k=top_k * 2,
        )
    except Exception:
        vec_results = []

    # 3) ES 关键词检索（如果可用）
    kw_results = []
    es = await get_elasticsearch_service()
    if es is not None:
        try:
            kw_results = await es.search(
                index_name=collection,
                query=query,
                top_k=top_k * 2,
                filter_query={"tenant_id": tenant_id},
            )
        except Exception:
            kw_results = []

    # 4) 融合 + （可选）重排
    docs = []
    for r in vec_results:
        docs.append({"text": r.get("text", ""), "score": 1.0 / (1.0 + r.get("distance", 0)), "source": "vector"})
    existing = {d["text"] for d in docs}
    for r in kw_results:
        t = r.get("text")
        if t and t not in existing:
            docs.append({"text": t, "score": r.get("score", 0), "source": "keyword"})

    if not docs:
        return {"results": []}

    if use_rerank:
        reranked = await reranking_service.rerank_documents(
            query=query,
            documents=docs,
            provider=RerankingProvider.BGE,
            top_k=top_k,
            tenant_id=tenant_id,
        )
        out = reranked
    else:
        out = sorted(docs, key=lambda x: x.get("score", 0), reverse=True)[:top_k]

    return {"results": out}


# 辅助函数

async def _convert_to_workflow_definition(request: WorkflowCreateRequest) -> WorkflowDefinition:
    """转换请求到工作流定义"""
    import uuid
    
    workflow_id = f"wf_{uuid.uuid4().hex[:8]}"
    
    # 转换节点
    nodes = await _convert_nodes(request.nodes)
    
    # 转换边
    edges = await _convert_edges(request.edges)
    
    return WorkflowDefinition(
        id=workflow_id,
        name=request.name,
        description=request.description,
        nodes=nodes,
        edges=edges,
        global_config=request.global_config,
        metadata=request.metadata or {},
    )


async def _convert_nodes(nodes_data: List[Dict[str, Any]]) -> List[WorkflowNode]:
    """转换节点数据"""
    nodes = []
    
    for node_data in nodes_data:
        # 获取节点类型的函数签名
        function_signature = _get_node_function_signature(node_data.get('type', 'unknown'))
        
        node = WorkflowNode(
            id=node_data['id'],
            type=node_data['type'],
            name=node_data.get('name', node_data['type']),
            description=node_data.get('description'),
            function_signature=function_signature,
            config=node_data.get('config', {}),
            position=node_data.get('position', {})
        )
        
        nodes.append(node)
    
    return nodes


async def _convert_edges(edges_data: List[Dict[str, Any]]) -> List[WorkflowEdge]:
    """转换边数据"""
    edges = []
    
    for edge_data in edges_data:
        edge = WorkflowEdge(
            id=edge_data.get('id', f"edge_{edge_data['source']}_{edge_data['target']}"),
            source=edge_data['source'],
            target=edge_data['target'],
            source_output=edge_data.get('source_output', 'output'),
            target_input=edge_data.get('target_input', 'input'),
            condition=edge_data.get('condition'),
            transform=edge_data.get('transform')
        )
        
        edges.append(edge)
    
    return edges


def _get_node_function_signature(node_type: str) -> NodeFunctionSignature:
    """获取节点函数签名"""
    
    signatures = {
        'llm': NodeFunctionSignature(
            name="llm_chat_completion",
            description="调用大语言模型进行文本生成",
            category="llm",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据对象（可选，用于透传上下文）",
                    required=False
                ),
                NodeInputSchema(
                    name="documents",
                    type=DataType.ARRAY,
                    description="检索到的文档列表（可选，RAG 场景使用）",
                    required=False
                ),
                NodeInputSchema(
                    name="prompt",
                    type=DataType.STRING,
                    description="输入提示",
                    required=True
                ),
                NodeInputSchema(
                    name="system_prompt",
                    type=DataType.STRING,
                    description="系统提示",
                    required=False
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="content",
                    type=DataType.STRING,
                    description="生成的内容",
                    required=True
                ),
                NodeOutputSchema(
                    name="metadata",
                    type=DataType.OBJECT,
                    description="元数据",
                    required=True
                )
            ]
        ),
        'parser': NodeFunctionSignature(
            name="parse_text",
            description="解析文本为结构化数据",
            category="parser",
            inputs=[
                NodeInputSchema(
                    name="text",
                    type=DataType.STRING,
                    description="待解析文本",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="parsed_data",
                    type=DataType.OBJECT,
                    description="解析后的数据",
                    required=True
                ),
                NodeOutputSchema(
                    name="success",
                    type=DataType.BOOLEAN,
                    description="是否解析成功",
                    required=True
                )
            ]
        ),
        'rag_retriever': NodeFunctionSignature(
            name="rag_retrieve",
            description="从知识库检索相关文档",
            category="data",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据对象（可选，用于透传 query 等字段）",
                    required=False
                ),
                NodeInputSchema(
                    name="query",
                    type=DataType.STRING,
                    description="查询文本",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="documents",
                    type=DataType.ARRAY,
                    description="检索到的文档",
                    required=True
                ),
                NodeOutputSchema(
                    name="query",
                    type=DataType.STRING,
                    description="实际使用的 query",
                    required=False
                ),
                NodeOutputSchema(
                    name="total_results",
                    type=DataType.NUMBER,
                    description="结果数量",
                    required=False
                ),
            ]
        ),
        'data_transformer': NodeFunctionSignature(
            name="data_transform",
            description="对输入数据进行转换或提取",
            category="transform",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据对象",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="json_output",
                    type=DataType.STRING,
                    description="JSON字符串输出",
                    required=False
                )
            ]
        ),
        'http_request': NodeFunctionSignature(
            name="http_request",
            description="发起 HTTP 请求（支持 GET/POST/PUT/PATCH）",
            category="tool",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据对象（可选，用于透传上下文或作为请求体 data）",
                    required=False,
                ),
                NodeInputSchema(
                    name="url",
                    type=DataType.STRING,
                    description="请求 URL（可选，若未配置则从节点配置读取）",
                    required=False,
                ),
            ],
            outputs=[
                NodeOutputSchema(
                    name="status_code",
                    type=DataType.NUMBER,
                    description="HTTP 状态码",
                    required=True,
                ),
                NodeOutputSchema(
                    name="response_data",
                    type=DataType.OBJECT,
                    description="响应数据（JSON 或 text）",
                    required=True,
                ),
                NodeOutputSchema(
                    name="headers",
                    type=DataType.OBJECT,
                    description="响应头",
                    required=True,
                ),
                NodeOutputSchema(
                    name="success",
                    type=DataType.BOOLEAN,
                    description="是否成功（status_code < 400）",
                    required=True,
                ),
            ],
        ),
        'classifier': NodeFunctionSignature(
            name="classify_text",
            description="文本分类",
            category="ai",
            inputs=[
                NodeInputSchema(
                    name="text",
                    type=DataType.STRING,
                    description="待分类文本",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="class",
                    type=DataType.STRING,
                    description="分类结果",
                    required=True
                ),
                NodeOutputSchema(
                    name="confidence",
                    type=DataType.NUMBER,
                    description="置信度",
                    required=True
                )
            ]
        ),
        'code_executor': NodeFunctionSignature(
            name="execute_code",
            description="执行用户代码以变换数据",
            category="code",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据对象",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="result",
                    type=DataType.OBJECT,
                    description="执行结果",
                    required=False
                ),
                NodeOutputSchema(
                    name="execution_output",
                    type=DataType.STRING,
                    description="执行输出/状态",
                    required=False
                )
            ]
        ),
        'condition': NodeFunctionSignature(
            name="evaluate_condition",
            description="评估条件",
            category="control",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据对象（可选）",
                    required=False
                ),
                NodeInputSchema(
                    name="value",
                    type=DataType.OBJECT,
                    description="待评估的值（可选；若为空则使用 field_path 从 data 中取值）",
                    required=False
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="condition_result",
                    type=DataType.BOOLEAN,
                    description="条件结果",
                    required=True
                ),
                NodeOutputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="透传数据（用于分支继续处理）",
                    required=False
                )
            ]
        ),
        'input': NodeFunctionSignature(
            name="input_data",
            description="输入数据",
            category="io",
            inputs=[],
            outputs=[
                NodeOutputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据",
                    required=True
                ),
                NodeOutputSchema(
                    name="input",
                    type=DataType.STRING,
                    description="常用字段：input（可选；用于作为 LLM prompt 的默认来源）",
                    required=False
                ),
                NodeOutputSchema(
                    name="prompt",
                    type=DataType.STRING,
                    description="常用字段：prompt（可选）",
                    required=False
                ),
                NodeOutputSchema(
                    name="query",
                    type=DataType.STRING,
                    description="常用字段：query（可选）",
                    required=False
                ),
                NodeOutputSchema(
                    name="text",
                    type=DataType.STRING,
                    description="常用字段：text（可选）",
                    required=False
                )
            ]
        ),
        'output': NodeFunctionSignature(
            name="output_data",
            description="输出数据",
            category="io",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输出数据",
                    required=True
                ),
                NodeInputSchema(
                    name="input",
                    type=DataType.OBJECT,
                    description="兼容字段：input（可选）",
                    required=False
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="result",
                    type=DataType.OBJECT,
                    description="格式化结果",
                    required=True
                )
            ]
        ),
        'embeddings': NodeFunctionSignature(
            name="generate_embeddings",
            description="生成文本嵌入向量",
            category="ai",
            inputs=[
                NodeInputSchema(
                    name="data",
                    type=DataType.OBJECT,
                    description="输入数据对象（可选）",
                    required=False
                ),
                NodeInputSchema(
                    name="text",
                    type=DataType.STRING,
                    description="待嵌入的文本",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="embedding",
                    type=DataType.ARRAY,
                    description="向量表示",
                    required=True
                ),
                NodeOutputSchema(
                    name="dimensions",
                    type=DataType.NUMBER,
                    description="向量维度",
                    required=False
                )
            ]
        ),
        'reranker': NodeFunctionSignature(
            name="rerank_documents",
            description="对文档集合进行重排序",
            category="ai",
            inputs=[
                NodeInputSchema(
                    name="query",
                    type=DataType.STRING,
                    description="查询文本",
                    required=True
                ),
                NodeInputSchema(
                    name="documents",
                    type=DataType.ARRAY,
                    description="待重排文档",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="reranked_documents",
                    type=DataType.ARRAY,
                    description="重排后的文档",
                    required=True
                )
            ]
        ),
    }
    
    return signatures.get(node_type, NodeFunctionSignature(
        name="unknown_function",
        description="未知功能",
        category="unknown",
        inputs=[],
        outputs=[]
    ))


def _node_to_dict(node: WorkflowNode) -> Dict[str, Any]:
    """将节点转换为字典"""
    return {
        "id": node.id,
        "type": node.type,
        "name": node.name,
        "description": node.description,
        "config": node.config,
        "position": node.position,
        "enabled": node.enabled,
        "function_signature": {
            "name": node.function_signature.name,
            "description": node.function_signature.description,
            "category": node.function_signature.category,
            "inputs": [
                {
                    "name": inp.name,
                    "type": inp.type,
                    "description": inp.description,
                    "required": inp.required,
                    "default": inp.default
                }
                for inp in node.function_signature.inputs
            ],
            "outputs": [
                {
                    "name": out.name,
                    "type": out.type,
                    "description": out.description,
                    "required": out.required
                }
                for out in node.function_signature.outputs
            ]
        }
    }


def _edge_to_dict(edge: WorkflowEdge) -> Dict[str, Any]:
    """将边转换为字典"""
    return {
        "id": edge.id,
        "source": edge.source,
        "target": edge.target,
        "source_output": edge.source_output,
        "target_input": edge.target_input,
        "condition": edge.condition,
        "transform": edge.transform
    }


async def _generate_python_code(workflow_def: WorkflowDefinition) -> str:
    """生成Python代码"""
    
    code_template = f'''"""
自动生成的工作流代码
工作流名称: {workflow_def.name}
工作流描述: {workflow_def.description}
"""

import asyncio
from typing import Dict, Any, List
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class WorkflowState:
    """工作流状态"""
    def __init__(self):
        self.data: Dict[str, Any] = {{}}
        self.context: Dict[str, Any] = {{}}

class {workflow_def.name.replace(" ", "")}Workflow:
    """
    {workflow_def.description}
    """
    
    def __init__(self):
        self.graph = self._build_graph()
    
    def _build_graph(self):
        """构建工作流图"""
        workflow = StateGraph(WorkflowState)
        
        # 添加节点
{_generate_node_code(workflow_def.nodes)}
        
        # 添加边
{_generate_edge_code(workflow_def.edges)}
        
        return workflow.compile()
    
    async def execute(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """执行工作流"""
        initial_state = WorkflowState()
        initial_state.data = input_data
        
        result = await self.graph.ainvoke(initial_state)
        return result.data

# 工作流实例
workflow = {workflow_def.name.replace(" ", "")}Workflow()

# 使用示例
async def main():
    input_data = {{
        "message": "Hello, world!",
        "context": {{}}
    }}
    
    result = await workflow.execute(input_data)
    print(result)

if __name__ == "__main__":
    asyncio.run(main())
'''
    
    return code_template


def _generate_node_code(nodes: List[WorkflowNode]) -> str:
    """生成节点代码"""
    code_lines = []
    
    for node in nodes:
        code_lines.append(f'        workflow.add_node("{node.id}", self._{node.id})')
    
    return '\n'.join(code_lines)


def _generate_edge_code(edges: List[WorkflowEdge]) -> str:
    """生成边代码"""
    code_lines = []
    
    for edge in edges:
        if edge.condition:
            code_lines.append(f'        workflow.add_conditional_edges("{edge.source}", self._condition_{edge.id}, {{"yes": "{edge.target}", "no": END}})')
        else:
            code_lines.append(f'        workflow.add_edge("{edge.source}", "{edge.target}")')
    
    return '\n'.join(code_lines)


# 初始化一些示例模板
async def _init_templates():
    """初始化模板"""
    # 这里可以添加一些预定义的模板
    pass

# 错误处理和恢复相关的端点

@router.post("/execution/{execution_id}/retry")
async def retry_execution(
    execution_id: str,
    current_user: User = Depends(get_current_user),
):
    """重试执行"""
    try:
        _require_admin(current_user)
        # 重置错误处理器
        workflow_execution_engine.reset_error_handler()
        
        return {"message": "执行重试已启动", "execution_id": execution_id}
        
    except Exception as e:
        logger.error(f"重试执行失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/execution/{execution_id}/metrics")
async def get_execution_metrics(
    execution_id: str,
    current_user: User = Depends(get_current_user),
):
    """获取执行指标"""
    try:
        _require_admin(current_user)
        # 获取执行指标
        execution_metrics = workflow_execution_engine.get_execution_metrics()
        
        # 获取错误统计
        error_stats = workflow_error_handler.get_error_statistics()
        
        return {
            "execution_id": execution_id,
            "execution_metrics": execution_metrics,
            "error_statistics": error_stats
        }
        
    except Exception as e:
        logger.error(f"获取执行指标失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/node/{node_id}/error-strategy")
async def set_node_error_strategy(
    node_id: str,
    strategy_config: Dict[str, Any],
    current_user: User = Depends(get_current_user),
):
    """设置节点错误策略"""
    try:
        _require_admin(current_user)
        # 解析策略配置
        action = RecoveryAction(strategy_config.get("action", "retry"))
        
        retry_config = None
        if "retry_config" in strategy_config:
            retry_config = RetryConfig(
                strategy=RetryStrategy(strategy_config["retry_config"].get("strategy", "exponential_backoff")),
                max_retries=strategy_config["retry_config"].get("max_retries", 3),
                initial_delay=strategy_config["retry_config"].get("initial_delay", 1.0),
                max_delay=strategy_config["retry_config"].get("max_delay", 60.0),
                backoff_multiplier=strategy_config["retry_config"].get("backoff_multiplier", 2.0),
                jitter=strategy_config["retry_config"].get("jitter", True)
            )
        
        strategy = RecoveryStrategy(
            action=action,
            retry_config=retry_config,
            fallback_value=strategy_config.get("fallback_value"),
            timeout_seconds=strategy_config.get("timeout_seconds"),
            circuit_breaker_threshold=strategy_config.get("circuit_breaker_threshold", 5),
            circuit_breaker_timeout=strategy_config.get("circuit_breaker_timeout", 60.0)
        )
        
        # 设置节点策略
        workflow_error_handler.set_node_strategy(node_id, strategy)
        
        return {
            "message": f"节点 {node_id} 错误策略已设置",
            "node_id": node_id,
            "strategy": strategy_config
        }
        
    except Exception as e:
        logger.error(f"设置节点错误策略失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/error-statistics")
async def get_error_statistics():
    """获取错误统计信息"""
    try:
        return workflow_error_handler.get_error_statistics()
        
    except Exception as e:
        logger.error(f"获取错误统计失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset-error-handler")
async def reset_error_handler(current_user: User = Depends(get_current_user)):
    """重置错误处理器"""
    try:
        _require_admin(current_user)
        workflow_error_handler.clear_retry_counts()
        workflow_error_handler.reset_circuit_breakers()
        
        return {"message": "错误处理器已重置"}
        
    except Exception as e:
        logger.error(f"重置错误处理器失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 并行执行相关的端点

@router.post("/configure-parallel-execution")
async def configure_parallel_execution(
    config: Dict[str, Any],
    current_user: User = Depends(get_current_user),
):
    """配置并行执行"""
    try:
        _require_admin(current_user)
        enable = config.get("enable", True)
        max_workers = config.get("max_workers", 10)
        
        # 资源配置
        resource_config = {}
        if "resource_pool" in config:
            resource_config = config["resource_pool"]
        
        workflow_execution_engine.configure_parallel_execution(
            enable=enable,
            max_workers=max_workers,
            **resource_config
        )
        
        return {
            "message": "并行执行配置已更新",
            "config": {
                "enable": enable,
                "max_workers": max_workers,
                "resource_config": resource_config
            }
        }
        
    except Exception as e:
        logger.error(f"配置并行执行失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/parallel-statistics")
async def get_parallel_statistics(current_user: User = Depends(get_current_user)):
    """获取并行执行统计"""
    try:
        _require_admin(current_user)
        return workflow_execution_engine.get_parallel_statistics()
        
    except Exception as e:
        logger.error(f"获取并行统计失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset-parallel-cache")
async def reset_parallel_cache(current_user: User = Depends(get_current_user)):
    """重置并行执行缓存"""
    try:
        _require_admin(current_user)
        workflow_execution_engine.reset_parallel_cache()
        return {"message": "并行执行缓存已重置"}
        
    except Exception as e:
        logger.error(f"重置并行缓存失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workflow-optimization-analysis/{workflow_id}")
async def analyze_workflow_optimization(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """分析工作流优化潜力"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权访问该工作流")

        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        # 分析工作流结构
        analysis = {
            "workflow_id": workflow_id,
            "total_nodes": len(workflow_def.nodes),
            "total_edges": len(workflow_def.edges),
            "parallelization_potential": _analyze_parallelization_potential(workflow_def),
            "bottlenecks": _identify_bottlenecks(workflow_def),
            "optimization_suggestions": _generate_optimization_suggestions(workflow_def)
        }
        
        return analysis
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"分析工作流优化失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _analyze_parallelization_potential(workflow_def: WorkflowDefinition) -> Dict[str, Any]:
    """分析并行化潜力"""
    
    # 构建依赖图
    dependencies = {}
    for node in workflow_def.nodes:
        dependencies[node.id] = set()
    
    for edge in workflow_def.edges:
        dependencies[edge.target].add(edge.source)
    
    # 计算执行层次
    levels = []
    remaining_nodes = set(node.id for node in workflow_def.nodes)
    
    while remaining_nodes:
        current_level = []
        for node_id in list(remaining_nodes):
            if not dependencies[node_id] or dependencies[node_id].isdisjoint(remaining_nodes):
                current_level.append(node_id)
                remaining_nodes.remove(node_id)
        
        if not current_level:
            break
        
        levels.append(current_level)
        
        # 更新依赖
        for node_id in current_level:
            for remaining_node in remaining_nodes:
                dependencies[remaining_node].discard(node_id)
    
    # 分析结果
    max_parallel_nodes = max(len(level) for level in levels) if levels else 0
    total_parallelizable = sum(len(level) for level in levels if len(level) > 1)
    
    return {
        "execution_levels": len(levels),
        "max_parallel_nodes_per_level": max_parallel_nodes,
        "total_parallelizable_nodes": total_parallelizable,
        "parallelization_ratio": total_parallelizable / len(workflow_def.nodes) if workflow_def.nodes else 0,
        "level_details": [
            {
                "level": i,
                "nodes": level,
                "parallel_count": len(level)
            }
            for i, level in enumerate(levels)
        ]
    }


def _identify_bottlenecks(workflow_def: WorkflowDefinition) -> List[Dict[str, Any]]:
    """识别瓶颈节点"""
    
    bottlenecks = []
    
    # 按类型分类节点
    node_types = {}
    for node in workflow_def.nodes:
        if node.type not in node_types:
            node_types[node.type] = []
        node_types[node.type].append(node)
    
    # 检查资源密集型节点
    resource_intensive_types = ['llm', 'rag_retriever', 'embeddings']
    for node_type in resource_intensive_types:
        if node_type in node_types:
            nodes = node_types[node_type]
            if len(nodes) > 1:
                bottlenecks.append({
                    "type": "resource_contention",
                    "description": f"多个{node_type}节点可能产生资源竞争",
                    "nodes": [node.id for node in nodes],
                    "severity": "high" if len(nodes) > 3 else "medium"
                })
    
    # 检查单点失败
    critical_nodes = []
    for node in workflow_def.nodes:
        if node.type in ['input', 'output'] or node.config.get('critical', False):
            critical_nodes.append(node)
    
    if critical_nodes:
        bottlenecks.append({
            "type": "single_point_of_failure",
            "description": "关键节点失败将导致整个工作流失败",
            "nodes": [node.id for node in critical_nodes],
            "severity": "high"
        })
    
    return bottlenecks


def _generate_optimization_suggestions(workflow_def: WorkflowDefinition) -> List[Dict[str, Any]]:
    """生成优化建议"""
    
    suggestions = []
    
    # 建议启用并行执行
    if len(workflow_def.nodes) > 3:
        suggestions.append({
            "type": "enable_parallel_execution",
            "title": "启用并行执行",
            "description": "工作流包含多个节点，建议启用并行执行以提高性能",
            "impact": "high",
            "implementation": "enable_parallel=True"
        })
    
    # 建议资源优化
    llm_nodes = [node for node in workflow_def.nodes if node.type == 'llm']
    if len(llm_nodes) > 1:
        suggestions.append({
            "type": "resource_optimization",
            "title": "优化LLM节点资源使用",
            "description": f"检测到{len(llm_nodes)}个LLM节点，建议错开执行或使用较小模型",
            "impact": "medium",
            "implementation": "stagger_execution"
        })
    
    # 建议缓存优化
    rag_nodes = [node for node in workflow_def.nodes if node.type == 'rag_retriever']
    if len(rag_nodes) > 0:
        suggestions.append({
            "type": "caching_optimization",
            "title": "启用检索结果缓存",
            "description": "为相似的检索查询启用缓存以减少重复计算",
            "impact": "medium",
            "implementation": "enable_result_caching"
        })
    
    # 建议错误处理优化
    suggestions.append({
        "type": "error_handling",
        "title": "增强错误处理",
        "description": "配置智能错误恢复策略以提高系统健壮性",
        "impact": "high",
        "implementation": "configure_error_recovery"
    })
    
    return suggestions


# 性能监控相关的端点

@router.get("/performance-dashboard")
async def get_performance_dashboard(current_user: User = Depends(get_current_user)):
    """获取性能仪表板"""
    try:
        _require_admin(current_user)
        return workflow_execution_engine.get_performance_dashboard()
        
    except Exception as e:
        logger.error(f"获取性能仪表板失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workflow/{workflow_id}/performance-report")
async def get_workflow_performance_report(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取工作流性能报告"""
    try:
        db_workflow = _get_db_workflow_or_404(db, tenant_id, workflow_id)
        if not _can_read_workflow(db_workflow, current_user):
            raise HTTPException(status_code=403, detail="无权访问该工作流")
        return workflow_execution_engine.get_workflow_performance_report(workflow_id)
        
    except Exception as e:
        logger.error(f"获取工作流性能报告失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/node/{node_id}/performance-report")
async def get_node_performance_report(
    node_id: str,
    current_user: User = Depends(get_current_user),
):
    """获取节点性能报告"""
    try:
        _require_admin(current_user)
        return workflow_execution_engine.get_node_performance_report(node_id)
        
    except Exception as e:
        logger.error(f"获取节点性能报告失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts/summary")
async def get_alert_summary(current_user: User = Depends(get_current_user)):
    """获取告警摘要"""
    try:
        _require_admin(current_user)
        return workflow_execution_engine.get_alert_summary()
        
    except Exception as e:
        logger.error(f"获取告警摘要失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/configure-performance-monitoring")
async def configure_performance_monitoring(
    config: Dict[str, Any],
    current_user: User = Depends(get_current_user),
):
    """配置性能监控"""
    try:
        _require_admin(current_user)
        enable = config.get("enable", True)
        
        # 配置性能监控
        workflow_execution_engine.configure_performance_monitoring(
            enable=enable,
            **config
        )
        
        # 启动或停止监控
        if enable:
            await workflow_execution_engine.start_performance_monitoring()
        else:
            await workflow_execution_engine.stop_performance_monitoring()
        
        return {
            "message": "性能监控配置已更新",
            "config": config
        }
        
    except Exception as e:
        logger.error(f"配置性能监控失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/alerts/rules")
async def add_alert_rule(
    rule_config: Dict[str, Any],
    current_user: User = Depends(get_current_user),
):
    """添加告警规则"""
    try:
        _require_admin(current_user)
        # 解析告警规则配置
        rule = AlertRule(
            name=rule_config["name"],
            metric_name=rule_config["metric_name"],
            threshold=rule_config["threshold"],
            comparison=rule_config["comparison"],
            severity=AlertSeverity(rule_config["severity"]),
            message_template=rule_config["message_template"],
            labels=rule_config.get("labels", {})
        )
        
        # 添加规则
        workflow_performance_monitor.add_alert_rule(rule)
        
        return {
            "message": f"告警规则 {rule.name} 添加成功",
            "rule": {
                "name": rule.name,
                "metric_name": rule.metric_name,
                "threshold": rule.threshold,
                "comparison": rule.comparison,
                "severity": rule.severity.value
            }
        }
        
    except Exception as e:
        logger.error(f"添加告警规则失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/alerts/rules/{rule_name}")
async def remove_alert_rule(rule_name: str):
    """移除告警规则"""
    try:
        workflow_performance_monitor.remove_alert_rule(rule_name)
        return {"message": f"告警规则 {rule_name} 移除成功"}
        
    except Exception as e:
        logger.error(f"移除告警规则失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear-performance-history")
async def clear_performance_history():
    """清空性能历史数据"""
    try:
        workflow_execution_engine.clear_performance_history()
        return {"message": "性能历史数据已清空"}
        
    except Exception as e:
        logger.error(f"清空性能历史数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/system-health")
async def get_system_health():
    """获取系统健康状态"""
    try:
        dashboard = workflow_execution_engine.get_performance_dashboard()
        
        # 提取系统健康指标
        system_stats = dashboard.get("statistics", {}).get("system_statistics", {})
        alerts = dashboard.get("active_alerts", {})
        
        # 计算健康评分
        health_score = 100
        
        # CPU使用率影响
        cpu_usage = system_stats.get("average_cpu_usage", 0)
        if cpu_usage > 80:
            health_score -= 20
        elif cpu_usage > 60:
            health_score -= 10
        
        # 内存使用率影响
        memory_usage = system_stats.get("average_memory_usage", 0)
        if memory_usage > 85:
            health_score -= 20
        elif memory_usage > 70:
            health_score -= 10
        
        # 告警影响
        critical_alerts = alerts.get("critical", 0)
        error_alerts = alerts.get("error", 0)
        warning_alerts = alerts.get("warning", 0)
        
        health_score -= critical_alerts * 15
        health_score -= error_alerts * 10
        health_score -= warning_alerts * 5
        
        health_score = max(0, health_score)
        
        # 确定健康状态
        if health_score >= 80:
            status = "healthy"
        elif health_score >= 60:
            status = "warning"
        elif health_score >= 40:
            status = "degraded"
        else:
            status = "critical"
        
        return {
            "status": status,
            "health_score": health_score,
            "system_metrics": system_stats,
            "alerts": alerts,
            "recommendations": _generate_health_recommendations(system_stats, alerts)
        }
        
    except Exception as e:
        logger.error(f"获取系统健康状态失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _generate_health_recommendations(system_stats: Dict[str, Any], alerts: Dict[str, Any]) -> List[str]:
    """生成健康建议"""
    recommendations = []
    
    # CPU使用率建议
    cpu_usage = system_stats.get("average_cpu_usage", 0)
    if cpu_usage > 80:
        recommendations.append("系统CPU使用率过高，建议优化或扩容资源")
    
    # 内存使用率建议
    memory_usage = system_stats.get("average_memory_usage", 0)
    if memory_usage > 85:
        recommendations.append("系统内存使用率过高，建议清理缓存或增加内存")
    
    # 告警建议
    if alerts.get("critical", 0) > 0:
        recommendations.append("存在严重告警，请立即检查和解决")
    
    if alerts.get("error", 0) > 0:
        recommendations.append("存在错误告警，请及时处理")
    
    if not recommendations:
        recommendations.append("系统运行正常，请继续保持监控")
    
    return recommendations


# 工作流模板相关的API端点

@router.get("/templates", response_model=List[Dict[str, Any]])
async def get_workflow_templates(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    category: Optional[str] = None,
    difficulty: Optional[str] = None,
    sort_by: str = "popular",
    limit: int = 20,
    offset: int = 0,
    query: Optional[str] = None,
    mine: bool = False,
):
    """获取工作流模板列表"""
    try:
        author_id = current_user.id if mine else None
        visible_to_user_id = None if _is_admin(current_user) else current_user.id
        templates, _total = workflow_persistence_service.list_workflow_templates(
            tenant_id=tenant_id,
            limit=limit,
            offset=offset,
            category=category,
            difficulty=difficulty,
            sort_by=sort_by,
            query=query,
            author_id=author_id,
            visible_to_user_id=visible_to_user_id,
        )
        return templates
        
    except Exception as e:
        logger.error("获取工作流模板失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}", response_model=Dict[str, Any])
async def get_workflow_template(
    template_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """获取工作流模板详情"""
    try:
        template = workflow_persistence_service.get_workflow_template(tenant_id=tenant_id, template_id=template_id)
        if not template:
            raise HTTPException(status_code=404, detail="模板不存在")

        if (not _is_admin(current_user)) and (not template.get("is_public")) and template.get("author_id") != current_user.id:
            raise HTTPException(status_code=403, detail="无权访问该模板")

        return template
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("获取工作流模板详情失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates", response_model=Dict[str, Any])
async def create_workflow_template(
    request: WorkflowTemplateCreateRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """创建工作流模板"""
    try:
        template_id = f"tpl_{uuid.uuid4().hex[:12]}"
        
        # 验证节点和边
        nodes = await _convert_nodes(request.nodes)
        edges = await _convert_edges(request.edges)
        
        # 创建临时工作流定义用于验证
        temp_workflow = WorkflowDefinition(
            id=template_id,
            name=request.name,
            description=request.description,
            version="1.0.0",
            nodes=nodes,
            edges=edges,
            global_config={}
        )
        
        # 验证工作流结构
        validation = await workflow_execution_engine._validate_workflow(temp_workflow)
        if not validation.is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"工作流模板验证失败: {validation.errors}"
            )

        workflow_persistence_service.create_workflow_template(
            tenant_id=tenant_id,
            author_id=current_user.id,
            template_id=template_id,
            name=request.name,
            description=request.description or "",
            category=request.category or "custom",
            subcategory=request.subcategory,
            tags=request.tags or [],
            difficulty=request.difficulty or "intermediate",
            estimated_time=request.estimated_time or "",
            use_cases=request.use_cases or [],
            requirements=request.requirements or [],
            nodes=request.nodes,
            edges=request.edges,
            is_public=bool(request.is_public),
            global_config={},
        )
        
        logger.info(
            "工作流模板创建成功",
            template_id=template_id,
            name=request.name
        )
        
        return {
            "id": template_id,
            "name": request.name,
            "description": request.description,
            "created_at": datetime.now().isoformat(),
            "status": "created"
        }
        
    except Exception as e:
        logger.error("创建工作流模板失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/seed", response_model=Dict[str, Any])
async def seed_workflow_templates(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    overwrite: bool = False,
):
    """导入示例模板到当前租户（落库）。

    - 仅管理员（tenant_admin/super_admin）可操作
    - overwrite=True 时会覆盖同 ID 模板的结构与基础信息
    """
    _require_admin(current_user)

    samples = _get_sample_templates()
    created: List[str] = []
    updated: List[str] = []
    skipped: List[str] = []

    for s in samples:
        tid = f"seed_{s.get('id')}"
        existing = workflow_persistence_service.get_workflow_template(tenant_id=tenant_id, template_id=tid)
        if existing and not overwrite:
            skipped.append(tid)
            continue

        # 先验证结构（避免把坏模板落库）
        nodes = await _convert_nodes(s.get("nodes") or [])
        edges = await _convert_edges(s.get("edges") or [])
        tmp = WorkflowDefinition(
            id=tid,
            name=s.get("name") or tid,
            description=s.get("description") or "",
            version="1.0.0",
            nodes=nodes,
            edges=edges,
            global_config={},
        )
        validation = await workflow_execution_engine._validate_workflow(tmp)
        if not validation.is_valid:
            logger.warning("示例模板校验失败，跳过导入", template_id=tid, errors=validation.errors)
            skipped.append(tid)
            continue

        if not existing:
            workflow_persistence_service.create_workflow_template(
                tenant_id=tenant_id,
                author_id=current_user.id,
                template_id=tid,
                name=s.get("name") or tid,
                description=s.get("description") or "",
                category=s.get("category") or "custom",
                subcategory=s.get("subcategory"),
                tags=s.get("tags") or [],
                difficulty=s.get("difficulty") or "intermediate",
                estimated_time=s.get("estimated_time") or "",
                use_cases=s.get("use_cases") or [],
                requirements=s.get("requirements") or [],
                nodes=s.get("nodes") or [],
                edges=s.get("edges") or [],
                is_public=True,
                global_config={},
            )
            created.append(tid)
        else:
            workflow_persistence_service.update_workflow_template(
                tenant_id=tenant_id,
                template_id=tid,
                patch={
                    "name": s.get("name") or tid,
                    "description": s.get("description") or "",
                    "category": s.get("category") or "custom",
                    "subcategory": s.get("subcategory"),
                    "tags": s.get("tags") or [],
                    "difficulty": s.get("difficulty") or "intermediate",
                    "estimated_time": s.get("estimated_time") or "",
                    "use_cases": s.get("use_cases") or [],
                    "requirements": s.get("requirements") or [],
                    "nodes": s.get("nodes") or [],
                    "edges": s.get("edges") or [],
                    "is_public": True,
                },
            )
            updated.append(tid)

    return {"created": created, "updated": updated, "skipped": skipped, "total_samples": len(samples)}


@router.put("/templates/{template_id}", response_model=Dict[str, Any])
async def update_workflow_template(
    template_id: str,
    request: WorkflowTemplateUpdateRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """更新工作流模板（作者/管理员）。"""
    tpl = workflow_persistence_service.get_workflow_template(tenant_id=tenant_id, template_id=template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    if not (_is_admin(current_user) or tpl.get("author_id") == current_user.id):
        raise HTTPException(status_code=403, detail="无权修改该模板")

    patch = {k: v for k, v in request.dict().items() if v is not None}
    if "nodes" in patch or "edges" in patch:
        # 若更新结构，先做一次结构校验
        nodes = await _convert_nodes(patch.get("nodes") or tpl.get("nodes") or [])
        edges = await _convert_edges(patch.get("edges") or tpl.get("edges") or [])
        tmp = WorkflowDefinition(
            id=template_id,
            name=patch.get("name") or tpl.get("name") or template_id,
            description=patch.get("description") or tpl.get("description") or "",
            version="1.0.0",
            nodes=nodes,
            edges=edges,
            global_config={},
        )
        validation = await workflow_execution_engine._validate_workflow(tmp)
        if not validation.is_valid:
            raise HTTPException(status_code=400, detail=f"工作流模板验证失败: {validation.errors}")

    workflow_persistence_service.update_workflow_template(tenant_id=tenant_id, template_id=template_id, patch=patch)
    return {"id": template_id, "status": "updated"}


@router.delete("/templates/{template_id}", response_model=Dict[str, Any])
async def delete_workflow_template(
    template_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """删除工作流模板（作者/管理员）。"""
    tpl = workflow_persistence_service.get_workflow_template(tenant_id=tenant_id, template_id=template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    if not (_is_admin(current_user) or tpl.get("author_id") == current_user.id):
        raise HTTPException(status_code=403, detail="无权删除该模板")

    workflow_persistence_service.delete_workflow_template(tenant_id=tenant_id, template_id=template_id)
    return {"id": template_id, "status": "deleted"}


@router.post("/templates/{template_id}/use", response_model=Dict[str, Any])
async def use_workflow_template(
    template_id: str,
    workflow_name: Optional[str] = None,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """使用工作流模板创建工作流"""
    try:
        template = workflow_persistence_service.get_workflow_template(tenant_id=tenant_id, template_id=template_id)
        if not template:
            raise HTTPException(status_code=404, detail="模板不存在")

        if (not _is_admin(current_user)) and (not template.get("is_public")) and template.get("author_id") != current_user.id:
            raise HTTPException(status_code=403, detail="无权使用该模板")
        
        # 创建工作流请求
        workflow_request = WorkflowCreateRequest(
            name=workflow_name or f"{template.get('name')} - 副本",
            description=template.get("description"),
            nodes=template.get("nodes") or [],
            edges=template.get("edges") or [],
            global_config={}
        )
        
        # 创建工作流
        workflow_definition = await _convert_to_workflow_definition(workflow_request)
        
        # 验证工作流
        validation = await workflow_execution_engine._validate_workflow(workflow_definition)
        if not validation.is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"工作流验证失败: {validation.errors}"
            )
        
        # 保存工作流（落库）
        workflow_persistence_service.save_workflow_definition(
            workflow_definition,
            tenant_id,
            current_user.id,
            is_public=False,
        )

        workflow_persistence_service.bump_template_downloads(tenant_id=tenant_id, template_id=template_id)
        
        logger.info(
            "使用模板创建工作流成功",
            template_id=template_id,
            workflow_id=workflow_definition.id
        )
        
        return {
            "workflow_id": workflow_definition.id,
            "name": workflow_definition.name,
            "description": workflow_definition.description,
            "template_id": template_id,
            "created_at": datetime.now().isoformat(),
            "status": "created"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("使用工作流模板失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/categories", response_model=List[Dict[str, Any]])
async def get_template_categories(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """获取模板分类列表"""
    try:
        visible_to_user_id = None if _is_admin(current_user) else current_user.id
        templates, _ = workflow_persistence_service.list_workflow_templates(
            tenant_id=tenant_id,
            limit=1000,
            offset=0,
            sort_by="popular",
            visible_to_user_id=visible_to_user_id,
        )

        # 统计 category/subcategory
        cat_map: Dict[str, Dict[str, Any]] = {}
        for t in templates:
            cat = t.get("category") or "custom"
            sub = t.get("subcategory")
            if cat not in cat_map:
                cat_map[cat] = {"id": cat, "name": cat, "count": 0, "subcategories": {}}
            cat_map[cat]["count"] += 1
            if sub:
                subs = cat_map[cat]["subcategories"]
                if sub not in subs:
                    subs[sub] = {"id": sub, "name": sub, "count": 0}
                subs[sub]["count"] += 1

        out = []
        for cat, v in sorted(cat_map.items(), key=lambda x: x[0]):
            subs = list(v["subcategories"].values())
            subs.sort(key=lambda x: x["id"])
            out.append({"id": v["id"], "name": v["name"], "count": v["count"], "subcategories": subs})
        return out
        
    except Exception as e:
        logger.error("获取模板分类失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/search", response_model=Dict[str, Any])
async def search_workflow_templates(
    request: WorkflowTemplateSearchRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """搜索工作流模板"""
    try:
        # 保持接口形态，后端统一走 DB 查询
        visible_to_user_id = None if _is_admin(current_user) else current_user.id
        templates, total = workflow_persistence_service.list_workflow_templates(
            tenant_id=tenant_id,
            limit=request.limit,
            offset=request.offset,
            category=request.category,
            difficulty=request.difficulty,
            sort_by=request.sort_by,
            query=request.query,
            tags=request.tags,
            visible_to_user_id=visible_to_user_id,
        )
        
        return {
            "templates": templates,
            "total": total,
            "offset": request.offset,
            "limit": request.limit,
            "query": request.query
        }
        
    except Exception as e:
        logger.error("搜索工作流模板失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _get_sample_templates() -> List[Dict[str, Any]]:
    """获取示例模板数据"""
    return [
        {
            "id": "customer-service-bot",
            "name": "智能客服机器人",
            "description": "基于RAG技术的智能客服系统，支持多轮对话和知识库检索",
            "category": "customer_service",
            "subcategory": "chatbot",
            "tags": ["客服", "RAG", "对话", "知识库"],
            "author": "AI团队",
            "version": "2.1.0",
            "created_at": "2024-01-10T10:00:00Z",
            "updated_at": "2024-01-15T14:30:00Z",
            "downloads": 1247,
            "rating": 4.8,
            "rating_count": 156,
            "is_featured": True,
            "is_premium": False,
            "difficulty": "intermediate",
            "estimated_time": "30分钟",
            "nodes": [
                {"id": "input", "type": "input", "name": "用户输入"},
                {"id": "intent", "type": "classifier", "name": "意图识别"},
                {"id": "rag", "type": "rag_retriever", "name": "知识检索"},
                {"id": "llm", "type": "llm", "name": "回复生成"},
                {"id": "output", "type": "output", "name": "输出回复"},
            ],
            "edges": [
                {"id": "e1", "source": "input", "target": "intent"},
                {"id": "e2", "source": "intent", "target": "rag"},
                {"id": "e3", "source": "rag", "target": "llm"},
                {"id": "e4", "source": "llm", "target": "output"},
            ],
            "use_cases": ["客户咨询", "技术支持", "售后服务"],
            "requirements": ["知识库文档", "LLM API密钥"],
            "similar_templates": ["advanced-chatbot", "multilingual-support"]
        },
        {
            "id": "document-analyzer",
            "name": "文档智能分析",
            "description": "自动提取文档关键信息并生成结构化摘要",
            "category": "document_processing",
            "subcategory": "document_analysis",
            "tags": ["文档", "分析", "摘要", "NLP"],
            "author": "文档处理团队",
            "version": "1.5.0",
            "created_at": "2024-01-08T09:00:00Z",
            "updated_at": "2024-01-12T16:45:00Z",
            "downloads": 892,
            "rating": 4.6,
            "rating_count": 94,
            "is_featured": False,
            "is_premium": True,
            "difficulty": "advanced",
            "estimated_time": "45分钟",
            "nodes": [
                {"id": "upload", "type": "input", "name": "文档上传"},
                {"id": "extract", "type": "parser", "name": "文本提取"},
                {"id": "segment", "type": "data_transformer", "name": "文本分割"},
                {"id": "analyze", "type": "llm", "name": "内容分析"},
                {"id": "summarize", "type": "llm", "name": "摘要生成"},
                {"id": "output", "type": "output", "name": "结果输出"},
            ],
            "edges": [
                {"id": "e1", "source": "upload", "target": "extract"},
                {"id": "e2", "source": "extract", "target": "segment"},
                {"id": "e3", "source": "segment", "target": "analyze"},
                {"id": "e4", "source": "analyze", "target": "summarize"},
                {"id": "e5", "source": "summarize", "target": "output"},
            ],
            "use_cases": ["合同分析", "报告总结", "研究论文摘要"],
            "requirements": ["文档上传功能", "高级LLM模型"],
            "similar_templates": ["contract-reviewer", "research-assistant"]
        },
        {
            "id": "translation-workflow",
            "name": "多语言翻译助手",
            "description": "支持多种语言的智能翻译工作流，包含术语一致性检查",
            "category": "document_processing",
            "subcategory": "translation",
            "tags": ["翻译", "多语言", "术语", "一致性"],
            "author": "国际化团队",
            "version": "1.8.0",
            "created_at": "2024-01-05T11:30:00Z",
            "updated_at": "2024-01-14T10:15:00Z",
            "downloads": 634,
            "rating": 4.4,
            "rating_count": 73,
            "is_featured": True,
            "is_premium": False,
            "difficulty": "beginner",
            "estimated_time": "20分钟",
            "nodes": [
                {"id": "input", "type": "input", "name": "原文输入"},
                {"id": "detect", "type": "classifier", "name": "语言检测"},
                {"id": "translate", "type": "llm", "name": "翻译处理"},
                {"id": "check", "type": "classifier", "name": "术语检查"},
                {"id": "output", "type": "output", "name": "翻译输出"},
            ],
            "edges": [
                {"id": "e1", "source": "input", "target": "detect"},
                {"id": "e2", "source": "detect", "target": "translate"},
                {"id": "e3", "source": "translate", "target": "check"},
                {"id": "e4", "source": "check", "target": "output"},
            ],
            "use_cases": ["技术文档翻译", "产品说明书", "用户界面本地化"],
            "requirements": ["翻译API", "术语词典"],
            "similar_templates": ["localization-helper", "content-translator"]
        },
        {
            "id": "qa-system",
            "name": "企业问答系统",
            "description": "基于企业知识库的智能问答系统，支持复杂查询和上下文理解",
            "category": "ai_assistant",
            "subcategory": "qa_system",
            "tags": ["问答", "知识库", "企业", "上下文"],
            "author": "企业AI团队",
            "version": "3.0.0",
            "created_at": "2024-01-03T14:20:00Z",
            "updated_at": "2024-01-16T09:45:00Z",
            "downloads": 1583,
            "rating": 4.9,
            "rating_count": 201,
            "is_featured": True,
            "is_premium": True,
            "difficulty": "advanced",
            "estimated_time": "60分钟",
            "nodes": [
                {"id": "question", "type": "input", "name": "问题输入"},
                {"id": "understand", "type": "llm", "name": "问题理解"},
                {"id": "search", "type": "rag_retriever", "name": "知识检索"},
                {"id": "rerank", "type": "reranker", "name": "结果重排"},
                {"id": "generate", "type": "llm", "name": "答案生成"},
                {"id": "verify", "type": "classifier", "name": "答案验证"},
                {"id": "output", "type": "output", "name": "答案输出"},
            ],
            "edges": [
                {"id": "e1", "source": "question", "target": "understand"},
                {"id": "e2", "source": "understand", "target": "search"},
                {"id": "e3", "source": "search", "target": "rerank"},
                {"id": "e4", "source": "rerank", "target": "generate"},
                {"id": "e5", "source": "generate", "target": "verify"},
                {"id": "e6", "source": "verify", "target": "output"},
            ],
            "use_cases": ["员工培训", "技术支持", "政策咨询"],
            "requirements": ["企业知识库", "高性能向量数据库", "重排序模型"],
            "similar_templates": ["help-desk-bot", "training-assistant"]
        },
        {
            "id": "data-report-generator",
            "name": "数据报告生成器",
            "description": "自动化数据分析和报告生成，支持多种图表和可视化",
            "category": "data_analysis",
            "subcategory": "report_generation",
            "tags": ["数据分析", "报告", "可视化", "自动化"],
            "author": "数据科学团队",
            "version": "2.3.0",
            "created_at": "2024-01-07T08:15:00Z",
            "updated_at": "2024-01-13T13:20:00Z",
            "downloads": 456,
            "rating": 4.3,
            "rating_count": 52,
            "is_featured": False,
            "is_premium": False,
            "difficulty": "intermediate",
            "estimated_time": "40分钟",
            "nodes": [
                {"id": "data_input", "type": "input", "name": "数据输入"},
                {"id": "clean", "type": "data_transformer", "name": "数据清洗"},
                {"id": "analyze", "type": "code_executor", "name": "统计分析"},
                {"id": "visualize", "type": "code_executor", "name": "图表生成"},
                {"id": "report", "type": "llm", "name": "报告撰写"},
                {"id": "output", "type": "output", "name": "报告输出"},
            ],
            "edges": [
                {"id": "e1", "source": "data_input", "target": "clean"},
                {"id": "e2", "source": "clean", "target": "analyze"},
                {"id": "e3", "source": "analyze", "target": "visualize"},
                {"id": "e4", "source": "visualize", "target": "report"},
                {"id": "e5", "source": "report", "target": "output"},
            ],
            "use_cases": ["销售报告", "用户行为分析", "财务报表"],
            "requirements": ["数据源接口", "图表库", "报告模板"],
            "similar_templates": ["dashboard-generator", "kpi-tracker"]
        },
    ]


# 在模块加载时初始化
asyncio.create_task(_init_templates())
