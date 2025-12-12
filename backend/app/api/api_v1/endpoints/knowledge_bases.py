"""
Knowledge Base Management API Endpoints
"""

import logging
import re
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.orm import Session
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
from app.services import parser_service
from app.services.chunking_service import chunking_service, ChunkingStrategy

router = APIRouter()
logger = logging.getLogger(__name__)


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
        milvus_service.create_collection(collection_name=tenant_collection_name)

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
                    milvus_service.drop_collection(tenant_collection_name)
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
                    settings={},
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
        kb_rows = (
            db.query(KBModel)
            .filter(KBModel.tenant_id == tenant_id, KBModel.is_active == True)
            .order_by(KBModel.created_at.desc())
            .all()
        )
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
                    # Safety: only read existing files
                    import os

                    if not os.path.exists(doc.file_path):
                        continue
                    with open(doc.file_path, "rb") as f:
                        content = f.read()
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

    tenant_collection_name = kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
    tenant_index_name = tenant_collection_name

    try:
        # Drop and recreate Milvus collection
        if milvus_service.has_collection(tenant_collection_name):
            milvus_service.drop_collection(tenant_collection_name)
        # Recreate with default dimension from settings
        milvus_service.create_collection(tenant_collection_name)

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
    current_user: User = Depends(
        require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)
    ),
):
    """
    Clear Milvus vectors for ALL knowledge bases under current tenant.

    - Drops and recreates Milvus collections for KBs found in DB so that KBs remain visible.
    - Drops stray Milvus collections not present in DB (with tenant prefix).
    - Resets all document.vector_ids and total_chunks to 0 for this tenant.
    - Optionally clears Elasticsearch indices and recreates for DB KBs.
    """
    try:
        tenant_prefix = f"tenant_{tenant_id}_"

        # Load KB names from DB
        kb_rows = db.query(KBModel).filter(KBModel.tenant_id == tenant_id).all()
        kb_names_in_db = {kb.name for kb in kb_rows}

        # List all Milvus collections and identify those for this tenant
        all_collections = milvus_service.list_collections()
        tenant_collections = [c for c in all_collections if c.startswith(tenant_prefix)]

        # Drop stray collections (not in DB)
        for coll in tenant_collections:
            kb_name = coll[len(tenant_prefix):]
            if kb_name not in kb_names_in_db:
                try:
                    milvus_service.drop_collection(coll)
                except Exception as e:
                    logger.warning(f"Failed to drop stray collection '{coll}': {e}")

        # For KBs in DB: drop and recreate their collections
        for kb_name in kb_names_in_db:
            coll_name = f"{tenant_prefix}{kb_name}"
            if milvus_service.has_collection(coll_name):
                try:
                    milvus_service.drop_collection(coll_name)
                except Exception as e:
                    logger.warning(f"Failed to drop collection '{coll_name}': {e}")
            # Recreate with default dimension
            try:
                milvus_service.create_collection(coll_name)
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
            for kb_name in kb_names_in_db:
                idx = f"{tenant_prefix}{kb_name}"
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
            milvus_service.drop_collection(tenant_collection_name)

        if es_exists and es_service is not None:
            await es_service.delete_index(tenant_collection_name)
        elif es_exists and settings.ENABLE_ELASTICSEARCH:
            logger.warning(
                f"Elasticsearch enabled but unavailable; could not delete index '{tenant_collection_name}'."
            )

        # Delete documents rows in DB (best-effort)
        try:
            from app.db.models.document import Document
            db.query(Document).filter(
                Document.knowledge_base_name == kb_name,
                Document.tenant_id == tenant_id,
            ).delete()
            db.commit()
        except Exception as dbe:
            logger.warning(f"Failed to delete KB documents from DB: {dbe}")

        # Delete from DB if exists (by name + tenant)
        try:
            kb_row = (
                db.query(KBModel)
                .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id)
                .first()
            )
            if kb_row:
                db.delete(kb_row)
                db.commit()
        except Exception as dbe:
            logger.warning(f"Failed to delete KB row from DB: {dbe}")

        return
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete knowledge base: {e}",
        )
