"""
Knowledge Base Management API Endpoints
"""
import logging
import re
from typing import List
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Depends
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import ElasticsearchService, get_elasticsearch_service
from app.schemas.knowledge_base import KnowledgeBase, KnowledgeBaseCreate, KnowledgeBaseCreateResponse

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
    return bool(re.match(r'^[a-zA-Z0-9_]+$', name))


@router.post("/", response_model=KnowledgeBaseCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_knowledge_base(
    kb_create: KnowledgeBaseCreate,
    es_service: ElasticsearchService = Depends(get_elasticsearch_service)
):
    """
    Create a new Knowledge Base.
    This will create a new collection in Milvus and a new index in Elasticsearch.
    - **name**: The name of the knowledge base. Must be a valid Milvus collection name.
    """
    kb_name = kb_create.name
    
    # Validate collection name
    if not validate_collection_name(kb_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid knowledge base name. Name can only contain letters, numbers, and underscores."
        )
    
    try:
        # Check for existence in both services
        if milvus_service.has_collection(kb_name) or await es_service.index_exists(kb_name):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"Knowledge base '{kb_name}' already exists in Milvus or Elasticsearch.")
        
        # Create in Milvus
        milvus_service.create_collection(collection_name=kb_name)
        
        # Create in Elasticsearch
        try:
            await es_service.create_index(index_name=kb_name)
        except Exception as es_err:
            # Rollback Milvus collection if ES index creation fails
            logger.error(f"Failed to create Elasticsearch index for '{kb_name}', rolling back Milvus collection. Error: {es_err}")
            milvus_service.drop_collection(kb_name)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                                detail=f"Failed to create Elasticsearch index: {es_err}")
        
        # Create knowledge base object for response
        kb = KnowledgeBase(
            id=kb_name,
            name=kb_name,
            description=kb_create.description or "",
            document_count=0,
            created_at=datetime.now(),
            status="active"
        )
                                
        return KnowledgeBaseCreateResponse(
            data=kb,
            msg="Knowledge base created successfully in both Milvus and Elasticsearch"
        )
    except HTTPException as http_exc:
        raise http_exc # Re-raise HTTPException to preserve status code and detail
    except Exception as e:
        logger.error(f"Failed to create knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"An unexpected error occurred: {e}")


@router.get("/", response_model=List[KnowledgeBase])
async def list_knowledge_bases():
    """
    List all available Knowledge Bases.
    This corresponds to listing all collections in Milvus.
    """
    try:
        collection_names = milvus_service.list_collections()
        kbs = []
        for name in collection_names:
            # Get document count from Milvus collection
            try:
                count = milvus_service.get_collection_count(name)
            except Exception:
                count = 0
            
            # Create knowledge base object
            kb = KnowledgeBase(
                id=name,
                name=name,
                description=f"Knowledge base: {name}",
                document_count=count,
                created_at=datetime.now(),  # In a real app, this would be stored in DB
                status="active"
            )
            kbs.append(kb)
        
        return kbs
    except Exception as e:
        logger.error(f"Failed to list knowledge bases: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to retrieve knowledge bases from Milvus.")


@router.get("/{kb_name}", response_model=KnowledgeBase)
async def get_knowledge_base(kb_name: str):
    """
    Get details of a specific Knowledge Base.
    """
    try:
        if not milvus_service.has_collection(kb_name):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Knowledge base '{kb_name}' not found.")
        
        # Get document count from Milvus collection
        try:
            count = milvus_service.get_collection_count(kb_name)
        except Exception:
            count = 0
            
        # Create knowledge base object
        kb = KnowledgeBase(
            id=kb_name,
            name=kb_name,
            description=f"Knowledge base: {kb_name}",
            document_count=count,
            created_at=datetime.now(),  # In a real app, this would be stored in DB
            status="active"
        )
        
        return kb
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Failed to get knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to retrieve knowledge base details from Milvus.")


@router.delete("/{kb_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_base(
    kb_name: str,
    es_service: ElasticsearchService = Depends(get_elasticsearch_service)
):
    """
    Delete a Knowledge Base.
    This will drop the corresponding collection in Milvus and index in Elasticsearch.
    """
    try:
        # We need to check existence before attempting deletion
        milvus_exists = milvus_service.has_collection(kb_name)
        es_exists = await es_service.index_exists(kb_name)

        if not milvus_exists and not es_exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Knowledge base '{kb_name}' not found in Milvus or Elasticsearch.")
        
        # It's safer to attempt deletion from both services even if one check fails
        if milvus_exists:
            milvus_service.drop_collection(kb_name)
        
        if es_exists:
            await es_service.delete_index(kb_name)

        return
    except Exception as e:
        logger.error(f"Failed to delete knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Failed to delete knowledge base: {e}") 