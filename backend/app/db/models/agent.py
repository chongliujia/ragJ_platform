"""
智能体数据模型
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Text,
    ForeignKey,
    JSON,
    Float,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class Agent(Base):
    """智能体模型（按租户隔离）"""

    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)

    # 租户与所有者
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # 基本信息
    name = Column(String(255), nullable=False)
    description = Column(Text)
    system_prompt = Column(Text)

    # 与工作流/自定义配置兼容字段
    workflow_id = Column(String(255), nullable=True)
    config = Column(JSON, default=dict)

    # LLM 配置
    model = Column(String(100), default="qwen-turbo")
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=1000)
    knowledge_bases = Column(JSON, default=list)
    tools = Column(JSON, default=list)

    # 状态与统计
    status = Column(String(20), default="active", nullable=False)
    conversations_count = Column(Integer, default=0)

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关联关系
    owner = relationship("User")
    tenant = relationship("Tenant")

