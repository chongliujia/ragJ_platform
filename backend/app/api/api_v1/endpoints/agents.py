"""
智能体工作流管理API端点
"""

from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import uuid
from datetime import datetime

from app.services.chat_service import ChatService

router = APIRouter()


class WorkflowNode(BaseModel):
    id: str
    type: str
    name: str
    config: Dict[str, Any] = {}


class WorkflowEdge(BaseModel):
    from_node: str
    to_node: str
    condition: Optional[str] = None


class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]
    created_at: datetime
    status: str = "active"


# 简化版本的内存存储
workflows = {}


def get_chat_service() -> ChatService:
    return ChatService()


@router.post("/workflows", response_model=WorkflowResponse)
async def create_workflow(request: WorkflowCreate):
    """
    创建智能体工作流
    """
    workflow_id = f"wf_{uuid.uuid4().hex[:8]}"

    workflow = WorkflowResponse(
        id=workflow_id,
        name=request.name,
        description=request.description,
        nodes=request.nodes,
        edges=request.edges,
        created_at=datetime.now(),
    )

    workflows[workflow_id] = workflow
    return workflow


@router.get("/workflows", response_model=List[WorkflowResponse])
async def list_workflows():
    """
    获取工作流列表
    """
    return list(workflows.values())


@router.get("/workflows/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(workflow_id: str):
    """
    获取工作流详情
    """
    if workflow_id not in workflows:
        raise HTTPException(status_code=404, detail="Workflow not found")

    return workflows[workflow_id]


@router.post("/workflows/{workflow_id}/execute")
async def execute_workflow(
    workflow_id: str,
    request: Dict[str, Any],
    chat_service: ChatService = Depends(get_chat_service),
):
    """
    执行工作流
    """
    if workflow_id not in workflows:
        raise HTTPException(status_code=404, detail="Workflow not found")

    result = await chat_service.execute_workflow(workflow_id, request)
    return result


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str):
    """
    删除工作流
    """
    if workflow_id not in workflows:
        raise HTTPException(status_code=404, detail="Workflow not found")

    del workflows[workflow_id]
    return {"message": "Workflow deleted successfully"}


# 预定义的工作流模板
@router.get("/templates")
async def get_workflow_templates():
    """
    获取工作流模板
    """
    return [
        {
            "id": "customer_service",
            "name": "智能客服",
            "description": "基于知识库的智能客服工作流",
            "nodes": [
                {
                    "id": "intent_detection",
                    "type": "classifier",
                    "name": "意图识别",
                    "config": {"model": "qwen-turbo"},
                },
                {
                    "id": "knowledge_retrieval",
                    "type": "rag_retriever",
                    "name": "知识检索",
                    "config": {"top_k": 5},
                },
                {
                    "id": "response_generation",
                    "type": "generator",
                    "name": "回复生成",
                    "config": {"model": "qwen-turbo"},
                },
            ],
            "edges": [
                {"from_node": "intent_detection", "to_node": "knowledge_retrieval"},
                {"from_node": "knowledge_retrieval", "to_node": "response_generation"},
            ],
        },
        {
            "id": "document_analysis",
            "name": "文档分析",
            "description": "智能文档分析和总结工作流",
            "nodes": [
                {
                    "id": "document_parser",
                    "type": "parser",
                    "name": "文档解析",
                    "config": {},
                },
                {
                    "id": "content_analyzer",
                    "type": "analyzer",
                    "name": "内容分析",
                    "config": {"model": "qwen-turbo"},
                },
                {
                    "id": "summary_generator",
                    "type": "summarizer",
                    "name": "摘要生成",
                    "config": {"model": "qwen-turbo"},
                },
            ],
            "edges": [
                {"from_node": "document_parser", "to_node": "content_analyzer"},
                {"from_node": "content_analyzer", "to_node": "summary_generator"},
            ],
        },
    ]
