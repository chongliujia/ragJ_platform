"""
智能体管理API端点（按租户隔离并落库）
"""

from typing import List, Optional, Dict, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_tenant_id
from app.db.database import get_db
from app.db.models.agent import Agent as AgentModel
from app.db.models.user import User
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService

router = APIRouter()
chat_service = ChatService()


class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 1000
    knowledge_bases: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    workflow_id: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    knowledge_bases: Optional[List[str]] = None
    tools: Optional[List[str]] = None
    workflow_id: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    status: Optional[str] = None


class AgentResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    system_prompt: Optional[str]
    model: str
    temperature: float
    max_tokens: int
    knowledge_bases: List[str]
    tools: List[str]
    workflow_id: Optional[str]
    config: Dict[str, Any]
    status: str
    conversations_count: int
    created_at: datetime
    updated_at: Optional[datetime]


class AgentChatRequest(BaseModel):
    message: str
    knowledge_base_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


def _agent_to_response(agent: AgentModel) -> AgentResponse:
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        system_prompt=agent.system_prompt,
        model=agent.model or "qwen-turbo",
        temperature=float(agent.temperature or 0.7),
        max_tokens=agent.max_tokens or 1000,
        knowledge_bases=agent.knowledge_bases or [],
        tools=agent.tools or [],
        workflow_id=agent.workflow_id,
        config=agent.config or {},
        status=agent.status or "active",
        conversations_count=agent.conversations_count or 0,
        created_at=agent.created_at or datetime.utcnow(),
        updated_at=agent.updated_at,
    )


def _get_agent_or_404(
    db: Session, agent_id: int, tenant_id: int
) -> AgentModel:
    agent = (
        db.query(AgentModel)
        .filter(AgentModel.id == agent_id, AgentModel.tenant_id == tenant_id)
        .first()
    )
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


# 预定义的智能体模板（全局）
@router.get("/templates")
async def get_agent_templates():
    return [
        {
            "id": "customer_service_agent",
            "name": "智能客服",
            "description": "基于知识库的智能客服助手",
            "system_prompt": "你是一个专业的客服助手，请根据知识库内容为用户提供准确、友好的帮助。",
            "model": "qwen-turbo",
            "temperature": 0.3,
            "max_tokens": 1000,
            "knowledge_bases": [],
            "tools": ["knowledge_search", "faq"],
        },
        {
            "id": "document_analyst",
            "name": "文档分析师",
            "description": "专业的文档分析和总结助手",
            "system_prompt": "你是一个文档分析专家，擅长分析、总结和提取文档中的关键信息。",
            "model": "qwen-turbo",
            "temperature": 0.2,
            "max_tokens": 1500,
            "knowledge_bases": [],
            "tools": ["document_parse", "summarize"],
        },
        {
            "id": "code_assistant",
            "name": "编程助手",
            "description": "代码编写、调试和优化助手",
            "system_prompt": "你是一个专业的编程助手，能帮助用户编写、调试和优化代码。",
            "model": "qwen-turbo",
            "temperature": 0.1,
            "max_tokens": 2000,
            "knowledge_bases": [],
            "tools": ["code_execute", "code_review"],
        },
    ]


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(
    request: AgentCreate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    agent = AgentModel(
        name=request.name,
        description=request.description or "",
        system_prompt=request.system_prompt,
        model=request.model or "qwen-turbo",
        temperature=request.temperature,
        max_tokens=request.max_tokens,
        knowledge_bases=request.knowledge_bases,
        tools=request.tools,
        workflow_id=request.workflow_id,
        config=request.config or {},
        tenant_id=tenant_id,
        owner_id=current_user.id,
        status="active",
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _agent_to_response(agent)


@router.get("", response_model=List[AgentResponse])
async def list_agents(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    agents = (
        db.query(AgentModel)
        .filter(AgentModel.tenant_id == tenant_id)
        .order_by(AgentModel.created_at.desc())
        .all()
    )
    return [_agent_to_response(a) for a in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_404(db, agent_id, tenant_id)
    return _agent_to_response(agent)


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: int,
    request: AgentUpdate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_404(db, agent_id, tenant_id)
    data = request.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(agent, k, v)
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _agent_to_response(agent)


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_404(db, agent_id, tenant_id)
    db.delete(agent)
    db.commit()
    return {"message": "Agent deleted successfully"}


@router.post("/{agent_id}/chat", response_model=ChatResponse)
async def chat_with_agent(
    agent_id: int,
    request: AgentChatRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_404(db, agent_id, tenant_id)

    message = request.message
    if agent.system_prompt:
        message = f"{agent.system_prompt}\n\n{message}"

    kb_id = request.knowledge_base_id
    if kb_id is None and agent.knowledge_bases:
        kb_id = agent.knowledge_bases[0]

    chat_req = ChatRequest(
        message=message,
        knowledge_base_id=kb_id,
        model=agent.model,
        temperature=float(agent.temperature or 0.7),
        max_tokens=agent.max_tokens or 1000,
        context=request.context,
    )

    resp = await chat_service.chat(chat_req, tenant_id=tenant_id, user_id=current_user.id)

    try:
        agent.conversations_count = (agent.conversations_count or 0) + 1
        db.add(agent)
        db.commit()
    except Exception:
        db.rollback()

    return resp


@router.post("/{agent_id}/chat/stream")
async def stream_chat_with_agent(
    agent_id: int,
    request: AgentChatRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_404(db, agent_id, tenant_id)

    message = request.message
    if agent.system_prompt:
        message = f"{agent.system_prompt}\n\n{message}"

    kb_id = request.knowledge_base_id
    if kb_id is None and agent.knowledge_bases:
        kb_id = agent.knowledge_bases[0]

    chat_req = ChatRequest(
        message=message,
        knowledge_base_id=kb_id,
        model=agent.model,
        temperature=float(agent.temperature or 0.7),
        max_tokens=agent.max_tokens or 1000,
        stream=True,
        context=request.context,
    )

    try:
        agent.conversations_count = (agent.conversations_count or 0) + 1
        db.add(agent)
        db.commit()
    except Exception:
        db.rollback()

    generator = chat_service.stream_chat(chat_req, tenant_id=tenant_id, user_id=current_user.id)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
