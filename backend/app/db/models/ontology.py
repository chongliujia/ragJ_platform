"""
Ontology models for KB-scoped schema drafts and versions.
"""

from sqlalchemy import Column, Integer, String, DateTime, Float, ForeignKey, JSON
from sqlalchemy.sql import func

from app.db.database import Base


class OntologyVersion(Base):
    __tablename__ = "ontology_versions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False, index=True)

    name = Column(String(120), nullable=False)
    status = Column(String(20), default="draft", nullable=False)  # draft | active | archived
    source = Column(String(20), default="auto", nullable=False)  # auto | manual
    created_by = Column(Integer, ForeignKey("users.id"))
    config = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class OntologyItem(Base):
    __tablename__ = "ontology_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False, index=True)
    version_id = Column(Integer, ForeignKey("ontology_versions.id"), nullable=False, index=True)

    kind = Column(String(32), nullable=False)  # entity_type | relation_type | attribute_type | structure_type
    name = Column(String(255), nullable=False)
    description = Column(String(500))
    aliases = Column(JSON, default=list)
    constraints = Column(JSON, default=dict)
    confidence = Column(Float, default=0.5)
    evidence = Column(JSON, default=list)
    status = Column(String(20), default="pending", nullable=False)  # pending | approved | rejected
    meta = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
