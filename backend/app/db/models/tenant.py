"""
租户数据模型
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class Tenant(Base):
    """租户模型 - 用于多租户隔离"""

    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)

    # 基本信息
    name = Column(String(100), nullable=False)
    slug = Column(
        String(50), unique=True, index=True, nullable=False
    )  # URL友好的标识符
    description = Column(Text)

    # 状态
    is_active = Column(Boolean, default=True, nullable=False)

    # 配置信息
    max_users = Column(Integer, default=10)  # 最大用户数限制
    max_knowledge_bases = Column(Integer, default=5)  # 最大知识库数限制
    max_documents = Column(Integer, default=1000)  # 最大文档数限制
    storage_quota_mb = Column(Integer, default=1024)  # 存储配额(MB)

    # 自定义配置
    settings = Column(JSON, default={})

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关联关系
    users = relationship("User", back_populates="tenant")
    knowledge_bases = relationship("KnowledgeBase", back_populates="tenant")
