"""
Knowledge Base Management API Endpoints
"""

import logging
import re
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import (
    ElasticsearchService,
    get_elasticsearch_service,
)
from app.core.config import settings
from app.schemas.knowledge_base import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseCreateResponse,
)
from app.core.dependencies import get_tenant_id, get_current_user, require_permission
from app.db.database import get_db
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.models.permission import PermissionType
from app.db.models.document import Document
from app.db.models.semantic_candidate import SemanticCandidate
from app.services import parser_service
from app.services.storage_service import storage_service
from app.services.chunking_service import chunking_service, ChunkingStrategy

router = APIRouter()
logger = logging.getLogger(__name__)


class KnowledgeBaseSettingsUpdate(BaseModel):
    embedding_model: Optional[str] = None
    chunking_strategy: Optional[str] = None
    chunking_params: Optional[Dict[str, Any]] = None
    retrieval_top_k: Optional[int] = None
    rerank_enabled: Optional[bool] = None
    rerank_top_k: Optional[int] = None


class KnowledgeBaseSettingsResponse(BaseModel):
    embedding_model: str
    chunk_size: int
    chunk_overlap: int
    chunking_strategy: str
    chunking_params: Dict[str, Any]
    retrieval_top_k: int
    rerank_enabled: bool
    rerank_top_k: int
    config_version: int
    updated_at: Optional[str]


class KnowledgeBaseReindexRequest(BaseModel):
    document_ids: Optional[List[int]] = None
    chunking_strategy: Optional[str] = None
    chunking_params: Optional[Dict[str, Any]] = None
    use_kb_config: bool = True


class KnowledgeBaseConsistencyRequest(BaseModel):
    delete_missing: bool = False


class KnowledgeBaseConsistencyResponse(BaseModel):
    scanned_documents: int
    missing_files: int
    updated_documents: int
    deleted_documents: int
    document_count: int
    total_chunks: int
    total_size_bytes: int


class KnowledgeBaseSemanticCleanupRequest(BaseModel):
    delete_orphan_candidates: bool = True
    dry_run: bool = False


class KnowledgeBaseSemanticCleanupResponse(BaseModel):
    scanned_candidates: int
    evidence_removed: int
    candidates_deleted: int

def _can_read_kb(kb_row: KBModel, user: User) -> bool:
    if user.role in ("super_admin", "tenant_admin"):
        return True
    if kb_row.owner_id == user.id:
        return True
    return bool(getattr(kb_row, "is_public", False))


def _can_write_kb(kb_row: KBModel, user: User) -> bool:
    if user.role in ("super_admin", "tenant_admin"):
        return True
    return kb_row.owner_id == user.id


def validate_collection_name(name: str) -> bool:
    """
    Validate collection name for Milvus requirements:
    - Can only contain numbers, letters and underscores
    - Length should be reasonable (1-255 characters)
    """
    if not name:
        return False
    if len(name) > 255:
        return False
    # Only alphanumeric characters and underscores allowed
    return bool(re.match(r"^[a-zA-Z0-9_]+$", name))


def _build_kb_settings_payload(kb_row: KBModel) -> KnowledgeBaseSettingsResponse:
    raw = kb_row.settings or {}
    chunking_params = raw.get("chunking_params") if isinstance(raw.get("chunking_params"), dict) else {}
    chunk_size = int(getattr(kb_row, "chunk_size", 0) or chunking_params.get("chunk_size") or settings.CHUNK_SIZE)
    chunk_overlap = int(getattr(kb_row, "chunk_overlap", 0) or chunking_params.get("chunk_overlap") or settings.CHUNK_OVERLAP)
    chunking_params = dict(chunking_params or {})
    chunking_params.setdefault("chunk_size", chunk_size)
    chunking_params.setdefault("chunk_overlap", chunk_overlap)
    return KnowledgeBaseSettingsResponse(
        embedding_model=str(getattr(kb_row, "embedding_model", "") or "text-embedding-v2"),
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        chunking_strategy=str(raw.get("chunking_strategy") or ChunkingStrategy.RECURSIVE.value),
        chunking_params=chunking_params,
        retrieval_top_k=int(raw.get("retrieval_top_k") or 3),
        rerank_enabled=bool(raw.get("rerank_enabled", True)),
        rerank_top_k=int(raw.get("rerank_top_k") or 2),
        config_version=int(raw.get("config_version") or 0),
        updated_at=str(raw.get("updated_at")) if raw.get("updated_at") else None,
    )


def _cleanup_semantic_candidates(
    db: Session,
    kb_row: KBModel,
    tenant_id: int,
    *,
    delete_orphan_candidates: bool,
    dry_run: bool,
) -> KnowledgeBaseSemanticCleanupResponse:
    doc_ids = {
        int(row[0])
        for row in db.query(Document.id)
        .filter(
            Document.knowledge_base_name == kb_row.name,
            Document.tenant_id == tenant_id,
        )
        .all()
    }

    candidates = (
        db.query(SemanticCandidate)
        .filter(
            SemanticCandidate.tenant_id == tenant_id,
            SemanticCandidate.knowledge_base_id == kb_row.id,
        )
        .all()
    )
    evidence_removed = 0
    candidates_deleted = 0

    for candidate in candidates:
        evidence = candidate.evidence or []
        if not isinstance(evidence, list):
            continue
        filtered: list[dict] = []
        removed = 0
        for item in evidence:
            if not isinstance(item, dict):
                filtered.append(item)
                continue
            raw_doc_id = item.get("document_id")
            if raw_doc_id is None:
                filtered.append(item)
                continue
            try:
                doc_id = int(raw_doc_id)
            except Exception:
                filtered.append(item)
                continue
            if doc_id in doc_ids:
                filtered.append(item)
            else:
                removed += 1
        if removed == 0:
            continue
        evidence_removed += removed
        if filtered:
            if not dry_run:
                candidate.evidence = filtered
        else:
            candidates_deleted += 1
            if delete_orphan_candidates and not dry_run:
                db.delete(candidate)
            elif not dry_run:
                candidate.evidence = []

    if not dry_run:
        db.commit()

    return KnowledgeBaseSemanticCleanupResponse(
        scanned_candidates=len(candidates),
        evidence_removed=evidence_removed,
        candidates_deleted=candidates_deleted if delete_orphan_candidates else 0,
    )


@router.post(
    "/", response_model=KnowledgeBaseCreateResponse, status_code=status.HTTP_201_CREATED
)
async def create_knowledge_base(
    kb_create: KnowledgeBaseCreate,
    tenant_id: int = Depends(get_tenant_id),
    es_service: Optional[ElasticsearchService] = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_CREATE.value)),
):
    """
    Create a new Knowledge Base.
    This will create a new collection in Milvus and a new index in Elasticsearch.
    - **name**: The name of the knowledge base. Must be a valid Milvus collection name.
    """
    kb_name = kb_create.name
    
    tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"

    # Validate collection name
    if not validate_collection_name(kb_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid knowledge base name. Name can only contain letters, numbers, and underscores.",
        )

    # Enforce tenant KB quota
    tenant_row = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant_row is not None:
        max_kbs = int(tenant_row.max_knowledge_bases or 0)
        if max_kbs > 0:
            current_kbs = (
                db.query(KBModel).filter(KBModel.tenant_id == tenant_id).count()
            )
            if current_kbs >= max_kbs:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Knowledge base quota exceeded for this tenant",
                )

    if not milvus_service.ensure_connected():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Milvus service not available",
        )

    try:
        # Check for existence in Milvus and (optionally) Elasticsearch
        es_exists = False
        if es_service is not None:
            try:
                es_exists = await es_service.index_exists(tenant_collection_name)
            except Exception as e:
                logger.warning(
                    f"Failed to check Elasticsearch index existence for '{tenant_collection_name}': {e}"
                )

        if milvus_service.has_collection(tenant_collection_name) or es_exists:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Knowledge base '{kb_name}' already exists in Milvus or Elasticsearch.",
            )

        # Create in Milvus with tenant-specific name
        await milvus_service.async_create_collection(collection_name=tenant_collection_name)

        # Create in Elasticsearch with tenant-specific name (optional)
        es_created = False
        if settings.ENABLE_ELASTICSEARCH:
            if es_service is None:
                logger.warning(
                    f"Elasticsearch enabled but unavailable; skipping index creation for '{kb_name}'."
                )
            else:
                try:
                    await es_service.create_index(index_name=tenant_collection_name)
                    es_created = True
                except Exception as es_err:
                    # Rollback Milvus collection if ES index creation fails
                    logger.error(
                        f"Failed to create Elasticsearch index for '{kb_name}', rolling back Milvus collection. Error: {es_err}"
                    )
                    await milvus_service.async_drop_collection(tenant_collection_name)
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=f"Failed to create Elasticsearch index: {es_err}",
                    )

        # Persist Knowledge Base in DB (upsert by name+tenant)
        try:
            existing = (
                db.query(KBModel)
                .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id)
                .first()
            )
            if existing is None:
                default_settings = {
                    "config_version": 1,
                    "chunking_strategy": ChunkingStrategy.RECURSIVE.value,
                    "chunking_params": {
                        "chunk_size": 1000,
                        "chunk_overlap": 200,
                    },
                    "retrieval_top_k": 3,
                    "rerank_enabled": True,
                    "rerank_top_k": 2,
                    "updated_at": datetime.utcnow().isoformat(),
                }
                kb_row = KBModel(
                    name=kb_name,
                    description=kb_create.description or "",
                    owner_id=current_user.id,
                    tenant_id=tenant_id,
                    is_active=True,
                    is_public=False,
                    embedding_model="text-embedding-v2",
                    chunk_size=1000,
                    chunk_overlap=200,
                    document_count=0,
                    total_chunks=0,
                    total_size_bytes=0,
                    milvus_collection_name=tenant_collection_name,
                    settings=default_settings,
                )
                db.add(kb_row)
                db.commit()
            else:
                # 更新集合名（避免漂移）
                existing.milvus_collection_name = tenant_collection_name
                db.add(existing)
                db.commit()
        except Exception as dbe:
            logger.error(f"Failed to persist KB in DB: {dbe}")

        # Create knowledge base object for response
        kb = KnowledgeBase(
            id=kb_name,
            name=kb_name,
            description=kb_create.description or "",
            document_count=0,
            created_at=datetime.now(),
            status="active",
        )

        return KnowledgeBaseCreateResponse(
            data=kb,
            msg=(
                "Knowledge base created successfully in Milvus and Elasticsearch"
                if es_created
                else (
                    "Knowledge base created successfully in Milvus; Elasticsearch unavailable"
                    if settings.ENABLE_ELASTICSEARCH
                    else "Knowledge base created successfully in Milvus; Elasticsearch disabled"
                )
            ),
        )
    except HTTPException as http_exc:
        raise http_exc  # Re-raise HTTPException to preserve status code and detail
    except Exception as e:
        logger.error(f"Failed to create knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {e}",
        )


@router.get("/", response_model=List[KnowledgeBase])
async def list_knowledge_bases(
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)
    ),
):
    """
    List all Knowledge Bases for the current tenant.

    Rule: KBs are source-of-truth in DB; do not infer or auto-create from Milvus.
    """
    try:
        q = db.query(KBModel).filter(
            KBModel.tenant_id == tenant_id, KBModel.is_active == True
        )
        if current_user.role not in ("super_admin", "tenant_admin"):
            from sqlalchemy import or_

            q = q.filter(
                or_(
                    KBModel.owner_id == current_user.id,
                    KBModel.is_public == True,
                )
            )

        kb_rows = q.order_by(KBModel.created_at.desc()).all()
        kbs: List[KnowledgeBase] = []
        for row in kb_rows:
            kb_name = row.name
            tenant_collection_name = (
                row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
            )

            # Get metrics from DB documents table
            try:
                from app.db.models.document import Document
                from sqlalchemy import func as sa_func

                count = (
                    db.query(Document)
                    .filter(
                        Document.knowledge_base_name == kb_name,
                        Document.tenant_id == tenant_id,
                    )
                    .count()
                )
                totals = (
                    db.query(
                        sa_func.coalesce(sa_func.sum(Document.total_chunks), 0),
                        sa_func.coalesce(sa_func.sum(Document.file_size), 0),
                    )
                    .filter(
                        Document.knowledge_base_name == kb_name,
                        Document.tenant_id == tenant_id,
                    )
                    .first()
                )
                total_chunks = int(totals[0] or 0)
                total_size_bytes = int(totals[1] or 0)
            except Exception:
                count = 0
                total_chunks = 0
                total_size_bytes = 0

            milvus_exists = milvus_service.has_collection(tenant_collection_name)
            kb = KnowledgeBase(
                id=kb_name,
                name=kb_name,
                description=row.description or f"Knowledge base: {kb_name}",
                document_count=count,
                total_chunks=total_chunks,
                total_size_bytes=total_size_bytes,
                created_at=row.created_at or datetime.now(),
                status="active" if milvus_exists else "error",
            )
            kbs.append(kb)

        return kbs
    except Exception as e:
        logger.error(f"Failed to list knowledge bases: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve knowledge bases.",
        )


@router.post("/{kb_name}/maintenance/rebuild-es-index")
async def rebuild_es_index(
    kb_name: str,
    reindex: bool = False,
    tenant_id: int = Depends(get_tenant_id),
    es_service: Optional[ElasticsearchService] = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)
    ),
):
    """
    Maintenance: Drop and recreate the Elasticsearch index for this KB (tenant-scoped).

    - If `reindex=true`, attempts to reindex existing documents into ES from original files.
      Reindexing parses and chunks the original file again; chunk boundaries may differ from
      the existing Milvus vectors.
    """
    # Validate KB exists in DB for tenant
    kb_row = (
        db.query(KBModel)
        .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id, KBModel.is_active == True)
        .first()
    )
    if kb_row is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not _can_write_kb(kb_row, current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage this knowledge base")

    if es_service is None:
        raise HTTPException(status_code=503, detail="Elasticsearch service not available")

    tenant_index = kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"

    try:
        # Drop if exists
        if await es_service.index_exists(tenant_index):
            await es_service.delete_index(tenant_index)

        # Recreate with latest mapping
        await es_service.create_index(tenant_index)

        indexed = 0
        if reindex:
            # Fetch documents for this KB/tenant
            from app.db.models.document import Document

            documents = (
                db.query(Document)
                .filter(
                    Document.knowledge_base_name == kb_name,
                    Document.tenant_id == tenant_id,
                )
                .all()
            )

            batch: list[dict] = []
            BATCH_SIZE = 200

            for doc in documents:
                try:
                    # Read file
                    if not doc.file_path:
                        continue
                    if not storage_service.exists(doc.file_path):
                        continue
                    content = storage_service.read_bytes(doc.file_path)
                    # Parse and chunk with default recursive strategy
                    text = parser_service.parse_document(content, doc.filename)
                    if not text:
                        continue
                    chunks = await chunking_service.chunk_document(
                        text=text,
                        strategy=ChunkingStrategy.RECURSIVE,
                        chunk_size=1000,
                        chunk_overlap=200,
                    )
                    # Accumulate ES docs
                    for ch in chunks:
                        batch.append(
                            {
                                "text": ch,
                                "tenant_id": tenant_id,
                                "user_id": doc.uploaded_by,
                                "document_name": doc.filename,
                                "knowledge_base": kb_name,
                            }
                        )
                        if len(batch) >= BATCH_SIZE:
                            await es_service.bulk_index_documents(tenant_index, batch)
                            indexed += len(batch)
                            batch = []
                except Exception as dbe:
                    logger.warning(f"Reindex failed for document {doc.id}: {dbe}")

            if batch:
                await es_service.bulk_index_documents(tenant_index, batch)
                indexed += len(batch)

        return {
            "message": "Elasticsearch index recreated",
            "index": tenant_index,
            "reindexed_docs": indexed,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rebuild ES index failed for KB '{kb_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_name}", response_model=KnowledgeBase)
async def get_knowledge_base(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)
    ),
):
    """
    Get details of a specific Knowledge Base.
    """
    try:
        kb_row = (
            db.query(KBModel)
            .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id, KBModel.is_active == True)
            .first()
        )
        if kb_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge base '{kb_name}' not found.",
            )
        if not _can_read_kb(kb_row, current_user):
            raise HTTPException(status_code=404, detail=f"Knowledge base '{kb_name}' not found.")

        tenant_collection_name = (
            kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
        )
        milvus_exists = milvus_service.has_collection(tenant_collection_name)

        # Get metrics from DB
        try:
            from app.db.models.document import Document
            from sqlalchemy import func as sa_func
            count = db.query(Document).filter(
                Document.knowledge_base_name == kb_name,
                Document.tenant_id == tenant_id,
            ).count()
            totals = db.query(
                sa_func.coalesce(sa_func.sum(Document.total_chunks), 0),
                sa_func.coalesce(sa_func.sum(Document.file_size), 0),
            ).filter(
                Document.knowledge_base_name == kb_name,
                Document.tenant_id == tenant_id,
            ).first()
            total_chunks = int(totals[0] or 0)
            total_size_bytes = int(totals[1] or 0)
        except Exception:
            count = 0
            total_chunks = 0
            total_size_bytes = 0

        # Create knowledge base object
        kb = KnowledgeBase(
            id=kb_name,
            name=kb_name,
            description=kb_row.description or f"Knowledge base: {kb_name}",
            document_count=count,
            total_chunks=total_chunks,
            total_size_bytes=total_size_bytes,
            created_at=kb_row.created_at or datetime.now(),
            status="active" if milvus_exists else "error",
        )

        return kb
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Failed to get knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve knowledge base details from Milvus.",
        )


@router.get("/{kb_name}/settings", response_model=KnowledgeBaseSettingsResponse)
async def get_knowledge_base_settings(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)
    ),
):
    """Get knowledge base settings."""
    kb_row = (
        db.query(KBModel)
        .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id, KBModel.is_active == True)
        .first()
    )
    if kb_row is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not _can_read_kb(kb_row, current_user):
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return _build_kb_settings_payload(kb_row)


@router.patch("/{kb_name}/settings", response_model=KnowledgeBaseSettingsResponse)
async def update_knowledge_base_settings(
    kb_name: str,
    payload: KnowledgeBaseSettingsUpdate,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)
    ),
):
    """Update knowledge base settings (with config versioning)."""
    kb_row = (
        db.query(KBModel)
        .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id, KBModel.is_active == True)
        .first()
    )
    if kb_row is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not _can_write_kb(kb_row, current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage this knowledge base")

    raw_settings = dict(kb_row.settings or {})
    updated = False

    if payload.embedding_model is not None:
        kb_row.embedding_model = payload.embedding_model
        raw_settings["embedding_model"] = payload.embedding_model
        updated = True

    if payload.chunking_strategy is not None:
        try:
            strategy = ChunkingStrategy(str(payload.chunking_strategy)).value
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid chunking_strategy")
        raw_settings["chunking_strategy"] = strategy
        updated = True

    if payload.chunking_params is not None:
        if not isinstance(payload.chunking_params, dict):
            raise HTTPException(status_code=400, detail="chunking_params must be an object")
        raw_settings["chunking_params"] = payload.chunking_params
        # Keep legacy columns in sync when available.
        if "chunk_size" in payload.chunking_params:
            try:
                kb_row.chunk_size = int(payload.chunking_params.get("chunk_size") or kb_row.chunk_size)
            except Exception:
                pass
        if "chunk_overlap" in payload.chunking_params:
            try:
                kb_row.chunk_overlap = int(payload.chunking_params.get("chunk_overlap") or kb_row.chunk_overlap)
            except Exception:
                pass
        updated = True

    if payload.retrieval_top_k is not None:
        if int(payload.retrieval_top_k) <= 0:
            raise HTTPException(status_code=400, detail="retrieval_top_k must be > 0")
        raw_settings["retrieval_top_k"] = int(payload.retrieval_top_k)
        updated = True

    if payload.rerank_enabled is not None:
        raw_settings["rerank_enabled"] = bool(payload.rerank_enabled)
        updated = True

    if payload.rerank_top_k is not None:
        if int(payload.rerank_top_k) <= 0:
            raise HTTPException(status_code=400, detail="rerank_top_k must be > 0")
        raw_settings["rerank_top_k"] = int(payload.rerank_top_k)
        updated = True

    if updated:
        raw_settings["config_version"] = int(raw_settings.get("config_version") or 0) + 1
        raw_settings["updated_at"] = datetime.utcnow().isoformat()
        kb_row.settings = raw_settings
        db.add(kb_row)
        db.commit()
        db.refresh(kb_row)

    return _build_kb_settings_payload(kb_row)


@router.post("/{kb_name}/maintenance/reindex")
async def reindex_knowledge_base_documents(
    kb_name: str,
    payload: KnowledgeBaseReindexRequest,
    background_tasks: BackgroundTasks,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)
    ),
):
    """Reindex documents for a knowledge base using current or provided chunking settings."""
    kb_row = (
        db.query(KBModel)
        .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id, KBModel.is_active == True)
        .first()
    )
    if kb_row is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not _can_write_kb(kb_row, current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage this knowledge base")

    # Resolve chunking strategy/params
    raw_settings = kb_row.settings or {}
    strategy_value = payload.chunking_strategy
    if not strategy_value and payload.use_kb_config:
        strategy_value = raw_settings.get("chunking_strategy")
    if not strategy_value:
        strategy_value = ChunkingStrategy.RECURSIVE.value
    try:
        strategy = ChunkingStrategy(str(strategy_value))
    except Exception:
        strategy = ChunkingStrategy.RECURSIVE

    params = payload.chunking_params or {}
    if not params and payload.use_kb_config:
        params = raw_settings.get("chunking_params") if isinstance(raw_settings.get("chunking_params"), dict) else {}
    if not isinstance(params, dict):
        params = {}
    params.setdefault("chunk_size", int(getattr(kb_row, "chunk_size", 0) or settings.CHUNK_SIZE))
    params.setdefault("chunk_overlap", int(getattr(kb_row, "chunk_overlap", 0) or settings.CHUNK_OVERLAP))

    from app.db.models.document import Document as DocModel, DocumentStatus as DocumentStatusEnum
    docs_query = db.query(DocModel).filter(
        DocModel.knowledge_base_name == kb_name,
        DocModel.tenant_id == tenant_id,
    )
    if payload.document_ids:
        docs_query = docs_query.filter(DocModel.id.in_(payload.document_ids))
    docs = docs_query.all()

    from app.services.document_service import document_service
    scheduled = 0
    skipped_processing = 0
    for doc in docs:
        if doc.status == DocumentStatusEnum.PROCESSING.value:
            skipped_processing += 1
            continue
        background_tasks.add_task(
            document_service.reindex_document,
            doc.id,
            tenant_id,
            current_user.id,
            strategy,
            params,
        )
        scheduled += 1

    return {
        "message": "Reindex accepted",
        "scheduled": scheduled,
        "skipped_processing": skipped_processing,
    }

@router.post("/{kb_name}/maintenance/clear-vectors")
async def clear_kb_vectors(
    kb_name: str,
    include_es: bool = False,
    tenant_id: int = Depends(get_tenant_id),
    es_service: Optional[ElasticsearchService] = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)
    ),
):
    """
    Clear all vectors for a KB (tenant-scoped):
    - Drop and recreate the Milvus collection
    - Reset vector_ids/total_chunks for all documents in DB
    - Optionally clear Elasticsearch index when include_es=true
    """
    # Validate KB exists in DB for tenant
    kb_row = (
        db.query(KBModel)
        .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id, KBModel.is_active == True)
        .first()
    )
    if kb_row is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not _can_write_kb(kb_row, current_user):
        raise HTTPException(status_code=403, detail="Not allowed to manage this knowledge base")

    tenant_collection_name = kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
    tenant_index_name = tenant_collection_name

    try:
        # Drop and recreate Milvus collection
        if milvus_service.has_collection(tenant_collection_name):
            await milvus_service.async_drop_collection(tenant_collection_name)
        # Recreate with default dimension from settings
        await milvus_service.async_create_collection(tenant_collection_name)

        # Reset document vector metadata
        from app.db.models.document import Document
        docs = (
            db.query(Document)
            .filter(
                Document.knowledge_base_name == kb_name,
                Document.tenant_id == tenant_id,
            )
            .all()
        )
        for d in docs:
            d.vector_ids = []
            d.total_chunks = 0
        db.commit()

        # Optionally clear ES index
        if include_es:
            if es_service is None:
                raise HTTPException(status_code=503, detail="Elasticsearch service not available")
            if await es_service.index_exists(tenant_index_name):
                await es_service.delete_index(tenant_index_name)
            await es_service.create_index(tenant_index_name)

        # Update KB counters
        kb = (
            db.query(KBModel)
            .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id)
            .first()
        )
        if kb:
            from sqlalchemy import func as sa_func
            from app.db.models.document import Document as DocModel
            totals = db.query(
                sa_func.coalesce(sa_func.sum(DocModel.total_chunks), 0)
            ).filter(
                DocModel.knowledge_base_name == kb_name,
                DocModel.tenant_id == tenant_id,
            ).first()
            kb.total_chunks = int(totals[0] or 0)
            db.add(kb)
            db.commit()

        return {"message": "Vectors cleared", "include_es": include_es}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to clear vectors for KB '{kb_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to clear vectors: {e}")

@router.post("/maintenance/clear-all-vectors")
async def clear_all_kb_vectors(
    include_es: bool = False,
    tenant_id: int = Depends(get_tenant_id),
    es_service: Optional[ElasticsearchService] = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_MANAGE.value)),
):
    """
    Clear Milvus vectors for ALL knowledge bases under current tenant.

    - Drops and recreates Milvus collections for KBs found in DB so that KBs remain visible.
    - Drops stray Milvus collections not present in DB (with tenant prefix).
    - Resets all document.vector_ids and total_chunks to 0 for this tenant.
    - Optionally clears Elasticsearch indices and recreates for DB KBs.
    """
    try:
        if current_user.role not in ("super_admin", "tenant_admin"):
            raise HTTPException(status_code=403, detail="Tenant admin access required")
        tenant_prefix = f"tenant_{tenant_id}_"

        # Load KB collection names from DB (stable, not derived from KB name)
        kb_rows = db.query(KBModel).filter(KBModel.tenant_id == tenant_id).all()
        kb_collections_in_db = {
            kb.milvus_collection_name or f"{tenant_prefix}{kb.name}" for kb in kb_rows
        }

        # List all Milvus collections and identify those for this tenant
        all_collections = milvus_service.list_collections()
        tenant_collections = [c for c in all_collections if c.startswith(tenant_prefix)]

        # Drop stray collections (not in DB)
        for coll in tenant_collections:
            if coll not in kb_collections_in_db:
                try:
                    await milvus_service.async_drop_collection(coll)
                except Exception as e:
                    logger.warning(f"Failed to drop stray collection '{coll}': {e}")

        # For KBs in DB: drop and recreate their collections
        for kb in kb_rows:
            coll_name = kb.milvus_collection_name or f"{tenant_prefix}{kb.name}"
            if milvus_service.has_collection(coll_name):
                try:
                    await milvus_service.async_drop_collection(coll_name)
                except Exception as e:
                    logger.warning(f"Failed to drop collection '{coll_name}': {e}")
            # Recreate with default dimension
            try:
                await milvus_service.async_create_collection(coll_name)
            except Exception as e:
                logger.warning(f"Failed to recreate collection '{coll_name}': {e}")

        # Reset documents vector metadata for this tenant
        from app.db.models.document import Document
        docs = db.query(Document).filter(Document.tenant_id == tenant_id).all()
        for d in docs:
            d.vector_ids = []
            d.total_chunks = 0
        db.commit()

        # Optionally clear Elasticsearch indices for KBs in DB
        if include_es:
            if es_service is None:
                raise HTTPException(status_code=503, detail="Elasticsearch service not available")
            for kb in kb_rows:
                idx = kb.milvus_collection_name or f"{tenant_prefix}{kb.name}"
                try:
                    if await es_service.index_exists(idx):
                        await es_service.delete_index(idx)
                    await es_service.create_index(idx)
                except Exception as e:
                    logger.warning(f"Failed to reset ES index '{idx}': {e}")

        # Update aggregated counters on KBs
        for kb in kb_rows:
            kb.total_chunks = 0
            db.add(kb)
        db.commit()

        return {"message": "All vectors cleared for tenant", "include_es": include_es, "kb_count": len(kb_rows)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to clear all vectors: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to clear all vectors: {e}")


@router.post(
    "/{kb_name}/maintenance/consistency",
    response_model=KnowledgeBaseConsistencyResponse,
)
async def reconcile_knowledge_base(
    kb_name: str,
    payload: KnowledgeBaseConsistencyRequest,
    tenant_id: int = Depends(get_tenant_id),
    es_service: Optional[ElasticsearchService] = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)
    ),
):
    """Reconcile storage/doc metadata consistency and recompute KB counters."""
    kb_row = (
        db.query(KBModel)
        .filter(
            KBModel.name == kb_name,
            KBModel.tenant_id == tenant_id,
            KBModel.is_active == True,
        )
        .first()
    )
    if kb_row is None or not _can_write_kb(kb_row, current_user):
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    docs = (
        db.query(Document)
        .filter(
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id,
        )
        .all()
    )

    missing_files = 0
    updated_docs = 0
    deleted_docs = 0

    try:
        from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel
        from sqlalchemy import func as sa_func

        chunk_counts = dict(
            db.query(
                DocumentChunkModel.document_id,
                sa_func.count(DocumentChunkModel.id),
            )
            .filter(
                DocumentChunkModel.tenant_id == tenant_id,
                DocumentChunkModel.knowledge_base_name == kb_name,
            )
            .group_by(DocumentChunkModel.document_id)
            .all()
        )
    except Exception:
        chunk_counts = {}

    for doc in docs:
        storage_ok = bool(doc.file_path) and storage_service.exists(doc.file_path)
        if not storage_ok:
            missing_files += 1
            if payload.delete_missing:
                try:
                    tenant_collection_name = (
                        kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
                    )
                    ids = []
                    if doc.vector_ids:
                        try:
                            ids = [int(i) for i in doc.vector_ids]
                        except Exception:
                            ids = []
                    if ids:
                        await milvus_service.async_delete_vectors(tenant_collection_name, ids)
                    else:
                        await milvus_service.async_delete_by_filters(
                            tenant_collection_name,
                            {
                                "tenant_id": tenant_id,
                                "document_name": doc.filename,
                                "knowledge_base": kb_name,
                            },
                        )
                except Exception as e:
                    logger.warning(f"Failed to delete vectors for document {doc.id}: {e}")

                try:
                    from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel
                    db.query(DocumentChunkModel).filter(
                        DocumentChunkModel.document_id == doc.id,
                        DocumentChunkModel.tenant_id == tenant_id,
                    ).delete(synchronize_session=False)
                except Exception as e:
                    logger.warning(f"Failed to delete chunks for document {doc.id}: {e}")

                try:
                    if es_service is not None:
                        tenant_collection_name = (
                            kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
                        )
                        await es_service.delete_by_query(
                            index_name=tenant_collection_name,
                            term_filters={
                                "tenant_id": tenant_id,
                                "document_name": doc.filename,
                                "knowledge_base": kb_name,
                            },
                        )
                except Exception as e:
                    logger.warning(f"Failed to delete ES docs for document {doc.id}: {e}")

                try:
                    db.delete(doc)
                    deleted_docs += 1
                except Exception as e:
                    logger.warning(f"Failed to delete DB row for document {doc.id}: {e}")
            else:
                doc.status = "failed"
                doc.error_message = "Source file missing in storage"
                try:
                    meta = dict(doc.doc_metadata or {})
                    meta["processing_progress"] = {
                        "stage": "failed",
                        "percentage": 0,
                        "message": "Source file missing in storage",
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                    doc.doc_metadata = meta
                except Exception:
                    pass
                db.add(doc)
                updated_docs += 1
            continue

        expected_chunks = int(chunk_counts.get(doc.id) or 0)
        if expected_chunks and int(doc.total_chunks or 0) != expected_chunks:
            doc.total_chunks = expected_chunks
            db.add(doc)
            updated_docs += 1

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    try:
        from sqlalchemy import func as sa_func

        totals = (
            db.query(
                sa_func.count(Document.id),
                sa_func.coalesce(sa_func.sum(Document.total_chunks), 0),
                sa_func.coalesce(sa_func.sum(Document.file_size), 0),
            )
            .filter(
                Document.knowledge_base_name == kb_name,
                Document.tenant_id == tenant_id,
            )
            .first()
        )
        kb_row.document_count = int(totals[0] or 0)
        kb_row.total_chunks = int(totals[1] or 0)
        kb_row.total_size_bytes = int(totals[2] or 0)
        db.add(kb_row)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"Failed to recompute KB counters for '{kb_name}': {e}")

    return KnowledgeBaseConsistencyResponse(
        scanned_documents=len(docs),
        missing_files=missing_files,
        updated_documents=updated_docs,
        deleted_documents=deleted_docs,
        document_count=int(kb_row.document_count or 0),
        total_chunks=int(kb_row.total_chunks or 0),
        total_size_bytes=int(kb_row.total_size_bytes or 0),
    )


@router.post(
    "/{kb_name}/maintenance/semantic-cleanup",
    response_model=KnowledgeBaseSemanticCleanupResponse,
)
async def cleanup_semantic_candidates(
    kb_name: str,
    payload: KnowledgeBaseSemanticCleanupRequest,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)
    ),
):
    """Remove semantic candidate evidence referencing deleted documents."""
    kb_row = (
        db.query(KBModel)
        .filter(
            KBModel.name == kb_name,
            KBModel.tenant_id == tenant_id,
            KBModel.is_active == True,
        )
        .first()
    )
    if kb_row is None or not _can_write_kb(kb_row, current_user):
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    return _cleanup_semantic_candidates(
        db,
        kb_row,
        tenant_id,
        delete_orphan_candidates=bool(payload.delete_orphan_candidates),
        dry_run=bool(payload.dry_run),
    )

@router.delete("/{kb_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_base(
    kb_name: str, 
    tenant_id: int = Depends(get_tenant_id),
    es_service: Optional[ElasticsearchService] = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_DELETE.value)
    ),
):
    """
    Delete a Knowledge Base.
    This will drop the corresponding collection in Milvus and index in Elasticsearch.
    """
    try:
        kb_row = (
            db.query(KBModel)
            .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id, KBModel.is_active == True)
            .first()
        )
        if kb_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge base '{kb_name}' not found.",
            )
        if not _can_write_kb(kb_row, current_user):
            raise HTTPException(status_code=404, detail=f"Knowledge base '{kb_name}' not found.")

        tenant_collection_name = (
            kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
        )
        
        # We need to check existence before attempting deletion
        milvus_exists = milvus_service.has_collection(tenant_collection_name)
        es_exists = False
        if es_service is not None:
            try:
                es_exists = await es_service.index_exists(tenant_collection_name)
            except Exception as e:
                logger.warning(
                    f"Failed to check Elasticsearch index existence for '{tenant_collection_name}': {e}"
                )

        # It's safer to attempt deletion from both services even if one check fails
        if milvus_exists:
            await milvus_service.async_drop_collection(tenant_collection_name)

        if es_exists and es_service is not None:
            await es_service.delete_index(tenant_collection_name)
        elif es_exists and settings.ENABLE_ELASTICSEARCH:
            logger.warning(
                f"Elasticsearch enabled but unavailable; could not delete index '{tenant_collection_name}'."
            )

        # Delete ontology drafts first to satisfy FK constraints
        try:
            from app.db.models.ontology import OntologyItem, OntologyVersion
            db.query(OntologyItem).filter(
                OntologyItem.knowledge_base_id == kb_row.id,
                OntologyItem.tenant_id == tenant_id,
            ).delete(synchronize_session=False)
            db.query(OntologyVersion).filter(
                OntologyVersion.knowledge_base_id == kb_row.id,
                OntologyVersion.tenant_id == tenant_id,
            ).delete(synchronize_session=False)
            db.commit()
        except Exception as dbe:
            db.rollback()
            logger.error(f"Failed to delete KB ontology drafts from DB: {dbe}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete knowledge base ontology drafts",
            )

        # Delete semantic candidates and evidence
        try:
            db.query(SemanticCandidate).filter(
                SemanticCandidate.knowledge_base_id == kb_row.id,
                SemanticCandidate.tenant_id == tenant_id,
            ).delete(synchronize_session=False)
            db.commit()
        except Exception as dbe:
            db.rollback()
            logger.error(f"Failed to delete KB semantic candidates from DB: {dbe}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete knowledge base semantic candidates",
            )

        # Delete document chunks first to satisfy FK constraints
        try:
            from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel
            db.query(DocumentChunkModel).filter(
                DocumentChunkModel.knowledge_base_name == kb_name,
                DocumentChunkModel.tenant_id == tenant_id,
            ).delete(synchronize_session=False)
            db.commit()
        except Exception as dbe:
            db.rollback()
            logger.error(f"Failed to delete KB document chunks from DB: {dbe}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete knowledge base chunks",
            )

        # Delete document rows in DB
        try:
            from app.db.models.document import Document
            db.query(Document).filter(
                Document.knowledge_base_name == kb_name,
                Document.tenant_id == tenant_id,
            ).delete(synchronize_session=False)
            db.commit()
        except Exception as dbe:
            db.rollback()
            logger.error(f"Failed to delete KB documents from DB: {dbe}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete knowledge base documents",
            )

        # Delete KB rows in DB (by name + tenant)
        try:
            kb_rows = (
                db.query(KBModel)
                .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id)
                .all()
            )
            for row in kb_rows:
                db.delete(row)
            db.commit()
        except Exception as dbe:
            db.rollback()
            logger.error(f"Failed to delete KB row from DB: {dbe}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete knowledge base record",
            )

        return
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete knowledge base: {e}",
        )
