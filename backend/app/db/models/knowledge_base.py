"""
知识库数据模型
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    Text,
    ForeignKey,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class KnowledgeBase(Base):
    """知识库模型"""

    __tablename__ = "knowledge_bases"

    id = Column(Integer, primary_key=True, index=True)

    # 基本信息
    name = Column(String(100), nullable=False)
    description = Column(Text)

    # 所有者和租户
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)

    # 状态和配置
    is_active = Column(Boolean, default=True, nullable=False)
    is_public = Column(
        Boolean, default=False, nullable=False
    )  # 是否对租户内其他用户公开

    # 向量化配置
    embedding_model = Column(String(100), default="text-embedding-v2")
    chunk_size = Column(Integer, default=1000)
    chunk_overlap = Column(Integer, default=200)

    # 统计信息
    document_count = Column(Integer, default=0)
    total_chunks = Column(Integer, default=0)
    total_size_bytes = Column(Integer, default=0)

    # Milvus集合名称（每个知识库对应一个独立的集合）
    milvus_collection_name = Column(String(100), unique=True, nullable=False)

    # 自定义设置
    settings = Column(JSON, default={})

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关联关系
    owner = relationship("User", back_populates="knowledge_bases")
    tenant = relationship("Tenant", back_populates="knowledge_bases")
    documents = relationship(
        "Document", back_populates="knowledge_base", cascade="all, delete-orphan"
    )
