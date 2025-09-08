"""
API密钥模型
用于公开访问（嵌入/集成）的简单密钥控制
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from app.db.database import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    key = Column(String(128), unique=True, nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    scopes = Column(String(200), default="chat,workflow", nullable=False)  # 逗号分隔
    # 可选限制：只允许访问某个知识库或工作流
    allowed_kb = Column(String(200), nullable=True)
    allowed_workflow_id = Column(String(100), nullable=True)
    rate_limit_per_min = Column(Integer, default=60, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)

    tenant = relationship("Tenant")

    __table_args__ = (
        Index("idx_api_key_tenant", "tenant_id"),
    )

