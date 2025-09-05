"""
智能体管理API端点
"""

from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import uuid
from datetime import datetime

from app.services.chat_service import ChatService

router = APIRouter()


class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: str = "qwen-turbo"
    temperature: float = 0.7
    max_tokens: int = 1000
    knowledge_bases: List[str] = []
    tools: List[str] = []


class AgentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    system_prompt: Optional[str]
    model: str
    temperature: float
    max_tokens: int
    knowledge_bases: List[str]
    tools: List[str]
    created_at: datetime
    status: str = "active"


# 简化版本的内存存储
agents = {}


def get_chat_service() -> ChatService:
    return ChatService()


@router.post("", response_model=AgentResponse)
async def create_agent(request: AgentCreate):
    """
    创建智能体
    """
    agent_id = f"agent_{uuid.uuid4().hex[:8]}"

    agent = AgentResponse(
        id=agent_id,
        name=request.name,
        description=request.description,
        system_prompt=request.system_prompt,
        model=request.model,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
        knowledge_bases=request.knowledge_bases,
        tools=request.tools,
        created_at=datetime.now(),
    )

    agents[agent_id] = agent
    return agent


@router.get("", response_model=List[AgentResponse])
async def list_agents():
    """
    获取智能体列表
    """
    return list(agents.values())


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str):
    """
    获取智能体详情
    """
    if agent_id not in agents:
        raise HTTPException(status_code=404, detail="Agent not found")

    return agents[agent_id]


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: str, request: AgentCreate):
    """
    更新智能体
    """
    if agent_id not in agents:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent = agents[agent_id]
    agent.name = request.name
    agent.description = request.description
    agent.system_prompt = request.system_prompt
    agent.model = request.model
    agent.temperature = request.temperature
    agent.max_tokens = request.max_tokens
    agent.knowledge_bases = request.knowledge_bases
    agent.tools = request.tools

    return agent


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str):
    """
    删除智能体
    """
    if agent_id not in agents:
        raise HTTPException(status_code=404, detail="Agent not found")

    del agents[agent_id]
    return {"message": "Agent deleted successfully"}


@router.post("/{agent_id}/chat")
async def chat_with_agent(
    agent_id: str,
    request: Dict[str, Any],
    chat_service: ChatService = Depends(get_chat_service),
):
    """
    与智能体对话
    """
    if agent_id not in agents:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent = agents[agent_id]
    message = request.get("message", "")
    
    # 使用智能体配置进行对话
    result = await chat_service.chat(
        message=message,
        model=agent.model,
        temperature=agent.temperature,
        max_tokens=agent.max_tokens,
        system_prompt=agent.system_prompt,
        knowledge_bases=agent.knowledge_bases
    )
    return result


# 预定义的智能体模板
@router.get("/templates")
async def get_agent_templates():
    """
    获取智能体模板
    """
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
            "tools": ["knowledge_search", "faq"]
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
            "tools": ["document_parse", "summarize"]
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
            "tools": ["code_execute", "code_review"]
        }
    ]
