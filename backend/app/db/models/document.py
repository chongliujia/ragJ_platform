"""
文档数据模型
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.database import Base


class DocumentStatus(enum.Enum):
    """文档处理状态"""
    PENDING = "pending"          # 等待处理
    PROCESSING = "processing"    # 处理中
    COMPLETED = "completed"      # 处理完成
    FAILED = "failed"           # 处理失败


class Document(Base):
    """文档模型"""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    
    # 基本信息
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(10), nullable=False)  # pdf, docx, txt, md等
    file_size = Column(Integer, nullable=False)  # 字节数
    file_path = Column(String(500), nullable=False)  # 存储路径
    
    # 关联信息
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # 处理状态
    status = Column(String(20), default=DocumentStatus.PENDING.value, nullable=False)
    error_message = Column(Text)  # 处理失败时的错误信息
    
    # 内容信息
    title = Column(String(255))  # 文档标题（从内容中提取）
    content_preview = Column(Text)  # 内容预览（前500字符）
    total_chunks = Column(Integer, default=0)  # 分块数量
    
    # 元数据
    doc_metadata = Column(JSON, default={})  # 存储文档的额外元数据
    
    # 向量化信息
    vector_ids = Column(JSON, default=[])  # Milvus中向量的ID列表
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    processed_at = Column(DateTime(timezone=True))  # 处理完成时间
    
    # 关联关系
    knowledge_base = relationship("KnowledgeBase", back_populates="documents")
    uploader = relationship("User")