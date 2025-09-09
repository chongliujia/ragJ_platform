"""
Knowledge Base Management API Endpoints
"""

import logging
import re
from typing import List
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.orm import Session
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import (
    ElasticsearchService,
    get_elasticsearch_service,
)
from app.schemas.knowledge_base import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseCreateResponse,
)
from app.core.dependencies import get_tenant_id, get_current_user
from app.db.database import get_db
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.db.models.user import User

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
    es_service: ElasticsearchService = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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

    try:
        # Check for existence in both services using tenant-specific names
        if milvus_service.has_collection(tenant_collection_name) or await es_service.index_exists(
            tenant_collection_name
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Knowledge base '{kb_name}' already exists in Milvus or Elasticsearch.",
            )

        # Create in Milvus with tenant-specific name
        milvus_service.create_collection(collection_name=tenant_collection_name)

        # Create in Elasticsearch with tenant-specific name
        try:
            await es_service.create_index(index_name=tenant_collection_name)
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
            msg="Knowledge base created successfully in both Milvus and Elasticsearch",
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
):
    """
    List all available Knowledge Bases for the current tenant.
    This corresponds to listing all collections in Milvus that belong to the tenant.
    """
    try:
        tenant_prefix = f"tenant_{tenant_id}_"
        
        collection_names = milvus_service.list_collections()
        kbs = []
        for name in collection_names:
            # Only include collections that belong to this tenant
            if name.startswith(tenant_prefix):
                # Extract the original KB name by removing the tenant prefix
                kb_name = name[len(tenant_prefix):]
                
                # Get metrics from DB documents table
                try:
                    from app.db.models.document import Document
                    count = db.query(Document).filter(
                        Document.knowledge_base_name == kb_name,
                        Document.tenant_id == tenant_id,
                    ).count()
                    from sqlalchemy import func as sa_func
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

                # Create knowledge base object with original name
                kb = KnowledgeBase(
                    id=kb_name,
                    name=kb_name,
                    description=f"Knowledge base: {kb_name}",
                    document_count=count,
                    total_chunks=total_chunks,
                    total_size_bytes=total_size_bytes,
                    created_at=datetime.now(),  # In a real app, this would be stored in DB
                    status="active",
                )
                kbs.append(kb)

        return kbs
    except Exception as e:
        logger.error(f"Failed to list knowledge bases: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve knowledge bases from Milvus.",
        )


@router.get("/{kb_name}", response_model=KnowledgeBase)
async def get_knowledge_base(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
):
    """
    Get details of a specific Knowledge Base.
    """
    try:
        tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"
        
        if not milvus_service.has_collection(tenant_collection_name):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge base '{kb_name}' not found.",
            )

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
            description=f"Knowledge base: {kb_name}",
            document_count=count,
            total_chunks=total_chunks,
            total_size_bytes=total_size_bytes,
            created_at=datetime.now(),  # In a real app, this would be stored in DB
            status="active",
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


@router.delete("/{kb_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_base(
    kb_name: str, 
    tenant_id: int = Depends(get_tenant_id),
    es_service: ElasticsearchService = Depends(get_elasticsearch_service),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete a Knowledge Base.
    This will drop the corresponding collection in Milvus and index in Elasticsearch.
    """
    try:
        tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"
        
        # We need to check existence before attempting deletion
        milvus_exists = milvus_service.has_collection(tenant_collection_name)
        es_exists = await es_service.index_exists(tenant_collection_name)

        if not milvus_exists and not es_exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge base '{kb_name}' not found in Milvus or Elasticsearch.",
            )

        # It's safer to attempt deletion from both services even if one check fails
        if milvus_exists:
            milvus_service.drop_collection(tenant_collection_name)

        if es_exists:
            await es_service.delete_index(tenant_collection_name)

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
    except Exception as e:
        logger.error(f"Failed to delete knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete knowledge base: {e}",
        )
