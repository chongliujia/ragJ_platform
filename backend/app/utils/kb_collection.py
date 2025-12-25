"""
Knowledge base collection/index name resolution.
"""

from typing import Optional
from sqlalchemy.orm import Session

from app.db.models.knowledge_base import KnowledgeBase as KBModel


def resolve_kb_collection_name(
    db: Session,
    tenant_id: int,
    *,
    kb_name: Optional[str] = None,
    kb_id: Optional[int] = None,
) -> str:
    """Resolve stable collection/index name for a knowledge base."""
    query = db.query(KBModel).filter(KBModel.tenant_id == tenant_id)
    if kb_id is not None:
        query = query.filter(KBModel.id == kb_id)
    elif kb_name is not None:
        query = query.filter(KBModel.name == kb_name)
    kb = query.first()
    if kb and kb.milvus_collection_name:
        return kb.milvus_collection_name
    if kb_name:
        return f"tenant_{tenant_id}_{kb_name}"
    return f"tenant_{tenant_id}_unknown"
