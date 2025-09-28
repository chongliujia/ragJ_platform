"""
完整的工作流API端点
支持工作流的创建、执行、监控和管理
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import uuid
from datetime import datetime
import structlog

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
    DataType
)
from app.services.workflow_execution_engine import workflow_execution_engine
from app.services.workflow_error_handler import workflow_error_handler, RecoveryStrategy, RetryConfig, RecoveryAction, RetryStrategy
from app.services.workflow_parallel_executor import workflow_parallel_executor
from app.services.workflow_performance_monitor import workflow_performance_monitor, AlertRule, AlertSeverity
from app.services.workflow_persistence_service import workflow_persistence_service
from app.core.dependencies import get_tenant_id, get_current_user
from app.db.models.user import User
from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import get_elasticsearch_service
from app.services.reranking_service import reranking_service, RerankingProvider

logger = structlog.get_logger(__name__)

router = APIRouter()


class WorkflowCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    global_config: Dict[str, Any] = {}


class WorkflowExecuteRequest(BaseModel):
    input_data: Dict[str, Any]
    config: Dict[str, Any] = {}
    debug: bool = False
    enable_parallel: Optional[bool] = None


class WorkflowUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    global_config: Optional[Dict[str, Any]] = None


class WorkflowTemplateCreateRequest(BaseModel):
    name: str
    description: str
    category: str
    subcategory: Optional[str] = None
    tags: List[str] = []
    difficulty: str = "intermediate"
    estimated_time: str = "30分钟"
    use_cases: List[str] = []
    requirements: List[str] = []
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    is_public: bool = True


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
    current_user: User = Depends(get_current_user)
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
            workflow_definition, tenant_id, current_user.id
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
            tenant_id, limit, offset
        )
        
        return workflows
        
    except Exception as e:
        logger.error("获取工作流列表失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{workflow_id}", response_model=Dict[str, Any])
async def get_workflow(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user)
):
    """获取工作流详情"""
    try:
        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        # 获取执行历史
        executions = workflow_persistence_service.list_workflow_executions(workflow_id, tenant_id)
        
        return {
            "id": workflow_def.id,
            "name": workflow_def.name,
            "description": workflow_def.description,
            "version": workflow_def.version,
            "nodes": [_node_to_dict(node) for node in workflow_def.nodes],
            "edges": [_edge_to_dict(edge) for edge in workflow_def.edges],
            "global_config": workflow_def.global_config,
            "metadata": workflow_def.metadata,
            "execution_count": len(executions)
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
):
    """更新工作流"""
    try:
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
):
    """删除工作流"""
    try:
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
):
    """执行工作流"""
    try:
        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        # 后台执行工作流
        # 注入租户/用户上下文信息
        input_data = dict(request.input_data or {})
        input_data.setdefault("tenant_id", tenant_id)
        input_data.setdefault("user_id", current_user.id)

        execution_context = await workflow_execution_engine.execute_workflow(
            workflow_definition=workflow_def,
            input_data=input_data,
            debug=request.debug,
            enable_parallel=request.enable_parallel
        )
        
        # 保存执行记录
        workflow_persistence_service.save_workflow_execution(
            execution_context, tenant_id, current_user.id
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
):
    """流式执行工作流"""
    try:
        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        async def stream_execution():
            try:
                # 创建执行上下文
                # 注入租户/用户上下文信息
                input_data = dict(request.input_data or {})
                input_data.setdefault("tenant_id", tenant_id)
                input_data.setdefault("user_id", current_user.id)

                execution_context = await workflow_execution_engine.execute_workflow(
                    workflow_definition=workflow_def,
                    input_data=input_data,
                    debug=request.debug,
                    enable_parallel=request.enable_parallel
                )
                
                # 从步骤中提取最终输出
                final_output = {}
                if execution_context.steps:
                    logger.info(f"处理执行步骤，总数: {len(execution_context.steps)}")
                    
                    # 从最后一个输出节点或LLM节点提取结果
                    for step in reversed(execution_context.steps):
                        logger.info(f"检查步骤: {step.node_name}, 输出数据: {step.output_data}")
                        if step.output_data:
                            # 检查输出节点
                            if step.node_name in ['输出', 'Output', 'output'] and step.output_data.get('result'):
                                result_data = step.output_data.get('result', {})
                                if isinstance(result_data, dict):
                                    final_output = result_data
                                    logger.info(f"从输出节点提取结果: {final_output}")
                                    break
                            # 检查LLM节点
                            elif 'LLM' in step.node_name and step.output_data.get('content'):
                                final_output = step.output_data
                                logger.info(f"从LLM节点提取结果: {final_output}")
                                break
                    
                    # 如果没有找到特定的输出，使用最后一个非空输出
                    if not final_output:
                        logger.info("未找到特定输出，查找最后一个非空输出")
                        for step in reversed(execution_context.steps):
                            if step.output_data and isinstance(step.output_data, dict):
                                if step.output_data.get('content') or step.output_data.get('result'):
                                    final_output = step.output_data
                                    logger.info(f"使用最后一个非空输出: {final_output}")
                                    break
                
                logger.info(f"最终输出数据: {final_output}")
                
                # 更新执行上下文的输出数据
                execution_context.output_data = final_output
                
                # 流式返回执行状态
                for i, step in enumerate(execution_context.steps):
                    progress_data = {
                        "type": "progress",
                        "step": {
                            "id": step.step_id,
                            "nodeId": step.node_id,
                            "nodeName": step.node_name,
                            "status": step.status,
                            "startTime": step.start_time,
                            "endTime": step.end_time,
                            "duration": step.duration,
                            "input": step.input_data,
                            "output": step.output_data,
                            "error": step.error,
                            "memory": step.memory_usage
                        },
                        "progress": {
                            "current": i + 1,
                            "total": len(execution_context.steps)
                        }
                    }
                    
                    yield f"data: {json.dumps(progress_data)}\n\n"
                
                # 返回最终结果
                final_result = {
                    "type": "complete",
                    "result": {
                        "execution_id": execution_context.execution_id,
                        "status": execution_context.status,
                        "output_data": final_output,
                        "error": execution_context.error,
                        "metrics": execution_context.metrics
                    }
                }
                
                logger.info(f"发送完成事件: {final_result}")
                yield f"data: {json.dumps(final_result)}\n\n"
                logger.info("发送 [DONE] 事件")
                yield "data: [DONE]\n\n"
                
                # 保存执行记录
                try:
                    workflow_persistence_service.save_workflow_execution(
                        execution_context, tenant_id, current_user.id
                    )
                except Exception as save_error:
                    logger.error("保存执行记录失败", error=str(save_error))
                
            except Exception as e:
                logger.error("流式工作流执行异常", error=str(e), exc_info=True)
                error_data = {
                    "type": "error",
                    "error": {
                        "message": str(e),
                        "type": type(e).__name__
                    }
                }
                yield f"data: {json.dumps(error_data)}\n\n"
                yield "data: [DONE]\n\n"
        
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
    limit: int = 20,
    offset: int = 0
):
    """获取执行历史（分页）"""
    try:
        # 验证工作流是否存在
        workflow_def = workflow_persistence_service.get_workflow_definition(workflow_id, tenant_id)
        if not workflow_def:
            raise HTTPException(status_code=404, detail="工作流不存在")
        
        executions = workflow_persistence_service.list_workflow_executions(
            workflow_id, tenant_id, limit, offset
        )
        
        return {
            "executions": executions,
            "total": len(executions),  # TODO: 实现真正的总数统计
            "limit": limit,
            "offset": offset,
            "workflow_id": workflow_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("获取执行历史失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/executions", response_model=Dict[str, Any])
async def get_execution_history_paginated(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    workflow_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
    offset: int = 0
):
    """获取分页的执行历史记录"""
    try:
        executions, total = workflow_persistence_service.get_execution_history_paginated(
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            status=status,
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
):
    """停止工作流执行"""
    try:
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
):
    """从指定节点及其下游重新执行（单步重试）。"""
    try:
        # 获取工作流与基线执行
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
    emb = await llm_service.get_embeddings([query])
    if not emb.get("success") or not emb.get("embeddings"):
        raise HTTPException(status_code=500, detail=f"Failed to embed query: {emb.get('error')}")
    query_vec = emb["embeddings"][0]

    # 2) Milvus 向量检索
    collection = f"tenant_{tenant_id}_{kb}"
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
        )
        out = reranked
    else:
        out = sorted(docs, key=lambda x: x.get("score", 0), reverse=True)[:top_k]

    return {"results": out}


@router.get("/workflows/templates", response_model=List[Dict[str, Any]])
async def get_workflow_templates():
    """获取工作流模板"""
    try:
        # 内置模板
        builtin_templates = [
            {
                "id": "customer_service",
                "name": "智能客服助手",
                "description": "基于RAG的智能客服工作流，包含意图识别、知识检索和回复生成",
                "category": "客服",
                "tags": ["RAG", "客服", "智能对话"],
                "node_count": 5,
                "estimated_time": "2-5秒"
            },
            {
                "id": "document_analysis",
                "name": "智能文档分析",
                "description": "自动解析文档，提取关键信息，生成摘要和分析报告",
                "category": "文档处理",
                "tags": ["文档", "分析", "摘要"],
                "node_count": 6,
                "estimated_time": "10-30秒"
            },
            {
                "id": "translation",
                "name": "多语言翻译助手",
                "description": "自动检测语言并翻译为多种目标语言，支持批量处理",
                "category": "翻译",
                "tags": ["翻译", "多语言", "批量"],
                "node_count": 4,
                "estimated_time": "1-3秒"
            }
        ]
        
        # 合并用户自定义模板
        user_templates = [
            {
                "id": template.id,
                "name": template.name,
                "description": template.description,
                "category": template.category,
                "tags": template.tags,
                "node_count": len(template.workflow_definition.nodes),
                "estimated_time": "未知"
            }
            for template in templates_db.values()
        ]
        
        return builtin_templates + user_templates
        
    except Exception as e:
        logger.error("获取模板失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


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
        global_config=request.global_config
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
                )
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
                    name="value",
                    type=DataType.STRING,
                    description="待评估的值",
                    required=True
                )
            ],
            outputs=[
                NodeOutputSchema(
                    name="condition_result",
                    type=DataType.BOOLEAN,
                    description="条件结果",
                    required=True
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
async def retry_execution(execution_id: str):
    """重试执行"""
    try:
        # 重置错误处理器
        workflow_execution_engine.reset_error_handler()
        
        return {"message": "执行重试已启动", "execution_id": execution_id}
        
    except Exception as e:
        logger.error(f"重试执行失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/execution/{execution_id}/metrics")
async def get_execution_metrics(execution_id: str):
    """获取执行指标"""
    try:
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
    strategy_config: Dict[str, Any]
):
    """设置节点错误策略"""
    try:
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
async def reset_error_handler():
    """重置错误处理器"""
    try:
        workflow_error_handler.clear_retry_counts()
        workflow_error_handler.reset_circuit_breakers()
        
        return {"message": "错误处理器已重置"}
        
    except Exception as e:
        logger.error(f"重置错误处理器失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 并行执行相关的端点

@router.post("/configure-parallel-execution")
async def configure_parallel_execution(
    config: Dict[str, Any]
):
    """配置并行执行"""
    try:
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
async def get_parallel_statistics():
    """获取并行执行统计"""
    try:
        return workflow_execution_engine.get_parallel_statistics()
        
    except Exception as e:
        logger.error(f"获取并行统计失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset-parallel-cache")
async def reset_parallel_cache():
    """重置并行执行缓存"""
    try:
        workflow_execution_engine.reset_parallel_cache()
        return {"message": "并行执行缓存已重置"}
        
    except Exception as e:
        logger.error(f"重置并行缓存失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workflow-optimization-analysis/{workflow_id}")
async def analyze_workflow_optimization(
    workflow_id: str,
    tenant_id: int = Depends(get_tenant_id),
):
    """分析工作流优化潜力"""
    try:
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
async def get_performance_dashboard():
    """获取性能仪表板"""
    try:
        return workflow_execution_engine.get_performance_dashboard()
        
    except Exception as e:
        logger.error(f"获取性能仪表板失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workflow/{workflow_id}/performance-report")
async def get_workflow_performance_report(workflow_id: str):
    """获取工作流性能报告"""
    try:
        return workflow_execution_engine.get_workflow_performance_report(workflow_id)
        
    except Exception as e:
        logger.error(f"获取工作流性能报告失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/node/{node_id}/performance-report")
async def get_node_performance_report(node_id: str):
    """获取节点性能报告"""
    try:
        return workflow_execution_engine.get_node_performance_report(node_id)
        
    except Exception as e:
        logger.error(f"获取节点性能报告失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts/summary")
async def get_alert_summary():
    """获取告警摘要"""
    try:
        return workflow_execution_engine.get_alert_summary()
        
    except Exception as e:
        logger.error(f"获取告警摘要失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/configure-performance-monitoring")
async def configure_performance_monitoring(
    config: Dict[str, Any]
):
    """配置性能监控"""
    try:
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
    rule_config: Dict[str, Any]
):
    """添加告警规则"""
    try:
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
    category: Optional[str] = None,
    difficulty: Optional[str] = None,
    sort_by: str = "popular",
    limit: int = 20,
    offset: int = 0
):
    """获取工作流模板列表"""
    try:
        # 模拟模板数据
        templates = _get_sample_templates()
        
        # 过滤
        filtered_templates = templates
        if category:
            filtered_templates = [t for t in filtered_templates if t.get("category") == category or t.get("subcategory") == category]
        if difficulty:
            filtered_templates = [t for t in filtered_templates if t.get("difficulty") == difficulty]
        
        # 排序
        if sort_by == "popular":
            filtered_templates.sort(key=lambda x: x.get("downloads", 0), reverse=True)
        elif sort_by == "newest":
            filtered_templates.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        elif sort_by == "rating":
            filtered_templates.sort(key=lambda x: x.get("rating", 0), reverse=True)
        elif sort_by == "name":
            filtered_templates.sort(key=lambda x: x.get("name", ""))
        
        # 分页
        total = len(filtered_templates)
        templates_page = filtered_templates[offset:offset + limit]
        
        return {
            "templates": templates_page,
            "total": total,
            "offset": offset,
            "limit": limit
        }
        
    except Exception as e:
        logger.error("获取工作流模板失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}", response_model=Dict[str, Any])
async def get_workflow_template(template_id: str):
    """获取工作流模板详情"""
    try:
        templates = _get_sample_templates()
        template = next((t for t in templates if t["id"] == template_id), None)
        
        if not template:
            raise HTTPException(status_code=404, detail="模板不存在")
        
        return template
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("获取工作流模板详情失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates", response_model=Dict[str, Any])
async def create_workflow_template(request: WorkflowTemplateCreateRequest):
    """创建工作流模板"""
    try:
        # 创建模板ID
        template_id = f"template_{uuid.uuid4().hex[:8]}"
        
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
        
        # 创建模板数据
        template_data = {
            "id": template_id,
            "name": request.name,
            "description": request.description,
            "category": request.category,
            "subcategory": request.subcategory,
            "tags": request.tags,
            "difficulty": request.difficulty,
            "estimated_time": request.estimated_time,
            "use_cases": request.use_cases,
            "requirements": request.requirements,
            "nodes": request.nodes,
            "edges": request.edges,
            "is_public": request.is_public,
            "author": "用户",
            "version": "1.0.0",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "downloads": 0,
            "rating": 0.0,
            "rating_count": 0,
            "is_featured": False,
            "is_premium": False,
            "similar_templates": []
        }
        
        # 保存到模板数据库
        templates_db[template_id] = template_data
        
        logger.info(
            "工作流模板创建成功",
            template_id=template_id,
            name=request.name
        )
        
        return {
            "id": template_id,
            "name": request.name,
            "description": request.description,
            "created_at": template_data["created_at"],
            "status": "created"
        }
        
    except Exception as e:
        logger.error("创建工作流模板失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/{template_id}/use", response_model=Dict[str, Any])
async def use_workflow_template(template_id: str, workflow_name: Optional[str] = None):
    """使用工作流模板创建工作流"""
    try:
        # 获取模板
        templates = _get_sample_templates()
        template = next((t for t in templates if t["id"] == template_id), None)
        
        if not template:
            raise HTTPException(status_code=404, detail="模板不存在")
        
        # 创建工作流请求
        workflow_request = WorkflowCreateRequest(
            name=workflow_name or f"{template['name']} - 副本",
            description=template["description"],
            nodes=template["nodes"],
            edges=template["edges"],
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
        
        # 保存工作流
        workflows_db[workflow_definition.id] = workflow_definition
        executions_db[workflow_definition.id] = []
        
        # 更新模板使用次数
        if template_id in templates_db:
            templates_db[template_id]["downloads"] += 1
        
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
async def get_template_categories():
    """获取模板分类列表"""
    try:
        categories = [
            {
                "id": "customer_service",
                "name": "客户服务",
                "color": "#2196f3",
                "count": 12,
                "subcategories": [
                    {"id": "chatbot", "name": "聊天机器人", "color": "#2196f3", "count": 8},
                    {"id": "ticket_system", "name": "工单系统", "color": "#2196f3", "count": 4},
                ]
            },
            {
                "id": "document_processing",
                "name": "文档处理",
                "color": "#4caf50",
                "count": 15,
                "subcategories": [
                    {"id": "document_analysis", "name": "文档分析", "color": "#4caf50", "count": 8},
                    {"id": "translation", "name": "翻译处理", "color": "#4caf50", "count": 7},
                ]
            },
            {
                "id": "ai_assistant",
                "name": "AI助手",
                "color": "#ff9800",
                "count": 10,
                "subcategories": [
                    {"id": "qa_system", "name": "问答系统", "color": "#ff9800", "count": 6},
                    {"id": "writing_assistant", "name": "写作助手", "color": "#ff9800", "count": 4},
                ]
            },
            {
                "id": "data_analysis",
                "name": "数据分析",
                "color": "#9c27b0",
                "count": 8,
                "subcategories": [
                    {"id": "report_generation", "name": "报表生成", "color": "#9c27b0", "count": 5},
                    {"id": "trend_analysis", "name": "趋势分析", "color": "#9c27b0", "count": 3},
                ]
            },
        ]
        
        return categories
        
    except Exception as e:
        logger.error("获取模板分类失败", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/search", response_model=List[Dict[str, Any]])
async def search_workflow_templates(request: WorkflowTemplateSearchRequest):
    """搜索工作流模板"""
    try:
        templates = _get_sample_templates()
        
        # 过滤
        filtered_templates = templates
        
        # 文本搜索
        if request.query:
            query = request.query.lower()
            filtered_templates = [
                t for t in filtered_templates
                if (query in t.get("name", "").lower() or
                    query in t.get("description", "").lower() or
                    any(query in tag.lower() for tag in t.get("tags", [])))
            ]
        
        # 分类过滤
        if request.category:
            filtered_templates = [
                t for t in filtered_templates
                if t.get("category") == request.category or t.get("subcategory") == request.category
            ]
        
        # 难度过滤
        if request.difficulty:
            filtered_templates = [t for t in filtered_templates if t.get("difficulty") == request.difficulty]
        
        # 标签过滤
        if request.tags:
            filtered_templates = [
                t for t in filtered_templates
                if any(tag in t.get("tags", []) for tag in request.tags)
            ]
        
        # 排序
        if request.sort_by == "popular":
            filtered_templates.sort(key=lambda x: x.get("downloads", 0), reverse=True)
        elif request.sort_by == "newest":
            filtered_templates.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        elif request.sort_by == "rating":
            filtered_templates.sort(key=lambda x: x.get("rating", 0), reverse=True)
        elif request.sort_by == "name":
            filtered_templates.sort(key=lambda x: x.get("name", ""))
        
        # 分页
        total = len(filtered_templates)
        templates_page = filtered_templates[request.offset:request.offset + request.limit]
        
        return {
            "templates": templates_page,
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
