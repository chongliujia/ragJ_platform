"""
Per-user model/provider configuration.

Stores active model settings and provider API keys per user.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    Float,
    Text,
    ForeignKey,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class UserProviderConfig(Base):
    """API key/base URL and custom models for a provider within a user scope."""

    __tablename__ = "user_provider_configs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String(32), nullable=False)

    api_key = Column(Text, nullable=True)
    api_base = Column(String(255), nullable=True)
    enabled = Column(Boolean, default=True, nullable=False)

    # Per-user custom models, keyed by model_type (e.g. {"chat": ["foo"]})
    custom_models = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_user_provider"),
    )


class UserModelConfig(Base):
    """Active model configuration per user and model type."""

    __tablename__ = "user_model_configs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    model_type = Column(String(32), nullable=False)  # chat/embedding/reranking

    provider = Column(String(32), nullable=False)
    model_name = Column(String(200), nullable=False)

    # Optional overrides (if absent, provider-level values are used)
    api_key = Column(Text, nullable=True)
    api_base = Column(String(255), nullable=True)

    max_tokens = Column(Integer, nullable=True)
    temperature = Column(Float, nullable=True)
    top_p = Column(Float, nullable=True)
    enabled = Column(Boolean, default=True, nullable=False)

    custom_params = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("user_id", "model_type", name="uq_user_model_type"),
    )

