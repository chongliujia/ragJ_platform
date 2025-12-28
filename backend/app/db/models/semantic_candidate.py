"""
Semantic candidate model for ontology discovery and review.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Float,
    ForeignKey,
    JSON,
    Boolean,
)
from sqlalchemy.sql import func

from app.db.database import Base


class SemanticCandidate(Base):
    __tablename__ = "semantic_candidates"

    id = Column(Integer, primary_key=True, index=True)

    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False, index=True)
    knowledge_base_name = Column(String(255), nullable=False, index=True)

    type = Column(String(20), nullable=False)  # entity | relation | attribute | structure | insight
    name = Column(String(255), nullable=False)
    status = Column(String(20), default="pending", nullable=False)  # pending | approved | rejected
    confidence = Column(Float, default=0.5)

    aliases = Column(JSON, default=list)
    relation = Column(JSON, default=dict)
    attributes = Column(JSON, default=dict)
    evidence = Column(JSON, default=list)

    merge_mode = Column(String(20))
    merge_target = Column(String(255))
    merge_alias = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
