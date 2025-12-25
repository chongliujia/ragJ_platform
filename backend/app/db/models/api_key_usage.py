"""
API key usage tracking.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from app.db.database import Base


class ApiKeyUsage(Base):
    __tablename__ = "api_key_usages"

    id = Column(Integer, primary_key=True, index=True)
    api_key_id = Column(Integer, ForeignKey("api_keys.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    path = Column(String(255), nullable=False)
    method = Column(String(10), nullable=False)
    status_code = Column(Integer, nullable=False)
    tokens = Column(Integer, nullable=True)
    model = Column(String(100), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    api_key = relationship("ApiKey")
    tenant = relationship("Tenant")

    __table_args__ = (
        Index("idx_api_key_usage_key_time", "api_key_id", "created_at"),
        Index("idx_api_key_usage_tenant_time", "tenant_id", "created_at"),
    )
