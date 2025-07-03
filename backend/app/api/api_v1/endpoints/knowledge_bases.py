"""
知识库管理API端点
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import uuid
from datetime import datetime

router = APIRouter()


class KnowledgeBaseCreate(BaseModel):
    name: str
    description: Optional[str] = None
    embedding_model: str = "text-embedding-v2"


class KnowledgeBaseResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    embedding_model: str
    created_at: datetime
    document_count: int = 0
    size: int = 0


# 简化版本的内存存储
knowledge_bases = {}


@router.post("/", response_model=KnowledgeBaseResponse)
async def create_knowledge_base(request: KnowledgeBaseCreate):
    """
    创建知识库
    """
    kb_id = f"kb_{uuid.uuid4().hex[:8]}"
    
    kb = KnowledgeBaseResponse(
        id=kb_id,
        name=request.name,
        description=request.description,
        embedding_model=request.embedding_model,
        created_at=datetime.now()
    )
    
    knowledge_bases[kb_id] = kb
    return kb


@router.get("/", response_model=List[KnowledgeBaseResponse])
async def list_knowledge_bases():
    """
    获取知识库列表
    """
    return list(knowledge_bases.values())


@router.get("/{kb_id}", response_model=KnowledgeBaseResponse)
async def get_knowledge_base(kb_id: str):
    """
    获取知识库详情
    """
    if kb_id not in knowledge_bases:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    
    return knowledge_bases[kb_id]


@router.delete("/{kb_id}")
async def delete_knowledge_base(kb_id: str):
    """
    删除知识库
    """
    if kb_id not in knowledge_bases:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    
    del knowledge_bases[kb_id]
    return {"message": "Knowledge base deleted successfully"} 