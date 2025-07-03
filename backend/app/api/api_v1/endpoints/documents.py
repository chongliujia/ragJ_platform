"""
文档管理API端点
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from pydantic import BaseModel
import uuid
from datetime import datetime

from app.services.file_service import FileService

router = APIRouter()


class DocumentResponse(BaseModel):
    id: str
    filename: str
    file_size: int
    file_type: str
    knowledge_base_id: str
    status: str
    upload_time: datetime
    chunk_count: int = 0


# 简化版本的内存存储
documents = {}


def get_file_service() -> FileService:
    return FileService()


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    knowledge_base_id: str = Form(...),
    file_service: FileService = Depends(get_file_service)
):
    """
    上传文档到知识库
    """
    # 使用文件服务上传
    upload_result = await file_service.upload_file(
        file=file,
        knowledge_base_id=knowledge_base_id
    )
    
    # 创建文档记录
    doc = DocumentResponse(
        id=upload_result.file_id,
        filename=upload_result.filename,
        file_size=upload_result.file_size,
        file_type=upload_result.file_type,
        knowledge_base_id=knowledge_base_id,
        status="uploaded",
        upload_time=upload_result.upload_time
    )
    
    documents[doc.id] = doc
    return doc


@router.get("/", response_model=List[DocumentResponse])
async def list_documents(knowledge_base_id: Optional[str] = None):
    """
    获取文档列表
    """
    if knowledge_base_id:
        return [doc for doc in documents.values() if doc.knowledge_base_id == knowledge_base_id]
    else:
        return list(documents.values())


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: str):
    """
    获取文档详情
    """
    if doc_id not in documents:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return documents[doc_id]


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, file_service: FileService = Depends(get_file_service)):
    """
    删除文档
    """
    if doc_id not in documents:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # 删除文件
    await file_service.delete_file(doc_id)
    
    # 删除记录
    del documents[doc_id]
    return {"message": "Document deleted successfully"} 