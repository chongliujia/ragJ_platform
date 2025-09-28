"""
Document Management API Endpoints
Handles document uploads and processing within a knowledge base.
"""

import logging
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, BackgroundTasks, status, Form, HTTPException, Depends, Path
import os
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services.document_service import document_service
from app.services.chunking_service import ChunkingStrategy, chunking_service
from app.db.database import get_db
from app.db.models.document import Document, DocumentStatus as DocumentStatusEnum
from app.core.dependencies import get_current_user, get_tenant_id
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


class DocumentUploadResponse(BaseModel):
    """Response model for a successful document upload."""

    filename: str
    content_type: str
    message: str


class DocumentInfo(BaseModel):
    """Document information response model."""
    
    id: int
    filename: str
    original_filename: str
    file_type: str
    file_size: int
    status: str
    error_message: Optional[str]
    title: Optional[str]
    content_preview: Optional[str]
    total_chunks: int
    created_at: str
    processed_at: Optional[str]


class DocumentStatus(BaseModel):
    """Document status response model."""
    
    id: int
    filename: str
    status: str
    error_message: Optional[str]
    progress: Optional[dict] = None


class DocumentChunk(BaseModel):
    """Document chunk response model."""

    id: int
    chunk_index: int
    text: str


class BatchDeleteRequest(BaseModel):
    """Batch delete request payload."""

    document_ids: List[int]

class BatchDeleteResult(BaseModel):
    deleted: int


@router.post(
    "/", response_model=DocumentUploadResponse, status_code=status.HTTP_202_ACCEPTED
)
async def upload_document(
    kb_name: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    chunking_strategy: Optional[str] = Form(ChunkingStrategy.RECURSIVE.value),
    chunking_params: Optional[str] = Form(None),
    tenant_id: int = Depends(get_tenant_id),
    current_user = Depends(get_current_user)
):
    """
    Upload a document to a specified knowledge base for processing.

    The document processing (chunking, embedding, indexing) is done in the background.
    The API returns immediately after accepting the file.

    - **kb_name**: The name of the target knowledge base.
    - **file**: The document file to be uploaded.
    - **chunking_strategy**: The chunking strategy to use (recursive, semantic, sliding_window, sentence, token_based).
    - **chunking_params**: JSON string containing chunking parameters.
    """
    logger.info(
        f"Received file '{file.filename}' for knowledge base '{kb_name}' with strategy '{chunking_strategy}'."
    )

    # Sanitize filename to prevent path traversal
    original_filename = file.filename or "uploaded_file"
    safe_filename = os.path.basename(original_filename)
    if not safe_filename:
        safe_filename = "uploaded_file"

    # Validate extension against allowed list
    ext = safe_filename.rsplit('.', 1)[-1].lower() if '.' in safe_filename else ''
    allowed_exts = set(ext.strip().lower() for ext in settings.get_supported_file_types())
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: .{ext}. Allowed: {', '.join(sorted(allowed_exts))}",
        )

    # Read content and validate size
    content = await file.read()
    if len(content) > settings.MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Max size: {settings.MAX_FILE_SIZE} bytes",
        )

    # Parse chunking strategy
    try:
        strategy = ChunkingStrategy(chunking_strategy)
    except ValueError:
        strategy = ChunkingStrategy.RECURSIVE
        logger.warning(
            f"Unknown chunking strategy '{chunking_strategy}', falling back to recursive."
        )

    # Parse chunking parameters
    params = {}
    if chunking_params:
        try:
            import json

            params = json.loads(chunking_params)
        except Exception as e:
            logger.warning(f"Failed to parse chunking params: {e}")
            params = {}

    # TODO: Add validation for file type based on settings.SUPPORTED_FILE_TYPES
    # For example, check file.content_type or filename extension

    # Dispatch processing: Celery (if enabled) or local background task
    if settings.USE_CELERY:
        # Save file to disk first; Celery task will read from path
        upload_dir = os.path.join(settings.UPLOAD_DIR or "/tmp/uploads", str(tenant_id))
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, safe_filename)
        try:
            with open(file_path, 'wb') as f:
                f.write(content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

        try:
            from app.tasks.document_tasks import process_document_task
            process_document_task.delay(
                file_path,
                safe_filename,
                kb_name,
                tenant_id,
                current_user.id,
                strategy.value,
                params,
            )
        except Exception as e:
            logger.error(f"Failed to enqueue Celery task: {e}")
            raise HTTPException(status_code=500, detail="Failed to enqueue processing task")
    else:
        # Add the processing task to the background
        background_tasks.add_task(
            document_service.process_document,
            content,
            safe_filename,
            kb_name,
            tenant_id,
            current_user.id,
            strategy,
            params,
        )

    return {
        "filename": safe_filename,
        "content_type": file.content_type,
        "message": "File accepted and is being processed in the background.",
    }


@router.get("/chunking-strategies")
async def get_chunking_strategies():
    """
    Get available chunking strategies and their parameters.
    """
    return {"strategies": chunking_service.get_available_strategies()}


@router.get("/", response_model=List[DocumentInfo])
async def list_knowledge_base_documents(
    kb_name: str,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user = Depends(get_current_user)
):
    """
    Get list of documents in a knowledge base.
    Returns all documents with their processing status and metadata.
    """
    try:
        tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"
        
        # Query documents from database
        documents = db.query(Document).filter(
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id
        ).all()
        
        result = []
        for doc in documents:
            result.append(DocumentInfo(
                id=doc.id,
                filename=doc.filename,
                original_filename=doc.original_filename,
                file_type=doc.file_type,
                file_size=doc.file_size,
                status=doc.status,
                error_message=doc.error_message,
                title=doc.title,
                content_preview=doc.content_preview,
                total_chunks=doc.total_chunks,
                created_at=doc.created_at.isoformat() if doc.created_at else None,
                processed_at=doc.processed_at.isoformat() if doc.processed_at else None,
            ))
        
        return result
        
    except Exception as e:
        logger.error(f"Failed to list documents for knowledge base '{kb_name}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve documents: {e}"
        )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    kb_name: str,
    document_id: int = Path(..., description="Document ID to delete"),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user = Depends(get_current_user)
):
    """
    Delete a document from the knowledge base.
    This removes the document from both database and vector storage.
    """
    try:        
        # Find document in database
        document = db.query(Document).filter(
            Document.id == document_id,
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id
        ).first()
        
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Document with id {document_id} not found in knowledge base '{kb_name}'"
            )
        
        # Remove from vector database (prefer pk deletion; fallback to filters)
        try:
            tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"
            from app.services.milvus_service import milvus_service
            ids = []
            if document.vector_ids:
                try:
                    ids = [int(i) for i in document.vector_ids]
                except Exception:
                    ids = []
            deleted = 0
            if ids:
                deleted = milvus_service.delete_vectors(tenant_collection_name, ids)
                if deleted == 0:
                    logger.warning(
                        f"Delete by ids returned 0 for document {document_id}. Falling back to filter deletion."
                    )
            if not ids or deleted == 0:
                milvus_service.delete_by_filters(
                    tenant_collection_name,
                    {
                        "tenant_id": tenant_id,
                        "document_name": document.filename,
                        "knowledge_base": kb_name,
                    },
                )
        except Exception as e:
            logger.warning(f"Failed to delete vectors for document {document_id}: {e}")

        # Remove from Elasticsearch
        try:
            from app.services.elasticsearch_service import get_elasticsearch_service
            es_service = await get_elasticsearch_service()
            if es_service is not None:
                tenant_index_name = f"tenant_{tenant_id}_{kb_name}"
                await es_service.delete_by_query(
                    index_name=tenant_index_name,
                    term_filters={
                        "tenant_id": tenant_id,
                        "document_name": document.filename,
                        "knowledge_base": kb_name,
                    },
                )
        except Exception as e:
            logger.warning(f"Failed to delete Elasticsearch docs for document {document_id}: {e}")
        
        # Remove file if it exists
        if document.file_path:
            try:
                import os
                if os.path.exists(document.file_path):
                    os.remove(document.file_path)
            except Exception as e:
                logger.warning(f"Failed to delete file {document.file_path}: {e}")
        
        # Remove from database
        db.delete(document)
        db.commit()
        
        logger.info(f"Successfully deleted document {document_id} from knowledge base '{kb_name}'")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete document {document_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete document: {e}"
        )


@router.get("/{document_id}/chunks", response_model=List[DocumentChunk])
async def get_document_chunks(
    kb_name: str,
    document_id: int = Path(..., description="Document ID"),
    offset: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user = Depends(get_current_user),
):
    """
    Retrieve chunk texts for a specific document, ordered by original insertion order.
    Uses stored Milvus primary key IDs in the document record to fetch chunk texts.
    """
    try:
        document = db.query(Document).filter(
            Document.id == document_id,
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id,
        ).first()

        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        vector_ids = document.vector_ids or []
        if not isinstance(vector_ids, list):
            vector_ids = []

        # Pagination over stored ids to preserve order
        total = len(vector_ids)
        if offset < 0:
            offset = 0
        if limit <= 0:
            limit = 100
        end = min(offset + limit, total)
        if offset >= end:
            return []

        slice_ids = [int(i) for i in vector_ids[offset:end]]

        # Fetch from Milvus by IDs
        from app.services.milvus_service import milvus_service
        tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"

        results = milvus_service.get_texts_by_ids(tenant_collection_name, slice_ids)

        # Build map and preserve order
        text_by_id = {int(r["id"]): r.get("text", "") for r in results}
        chunks: list[DocumentChunk] = []
        for idx, pk in enumerate(slice_ids):
            chunks.append(
                DocumentChunk(id=int(pk), chunk_index=offset + idx, text=text_by_id.get(int(pk), ""))
            )

        return chunks
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get chunks for document {document_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve document chunks: {e}")


@router.post("/batch-delete", response_model=BatchDeleteResult)
async def batch_delete_documents(
    kb_name: str,
    payload: BatchDeleteRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user = Depends(get_current_user),
):
    """
    Batch delete multiple documents and their associated vectors and ES entries.
    """
    try:
        ids = list({int(i) for i in (payload.document_ids or [])})
        if not ids:
            return BatchDeleteResult(deleted=0)

        # Fetch documents filtered by tenant and KB
        docs = (
            db.query(Document)
            .filter(
                Document.id.in_(ids),
                Document.knowledge_base_name == kb_name,
                Document.tenant_id == tenant_id,
            )
            .all()
        )

        deleted_count = 0
        from app.services.milvus_service import milvus_service
        tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"

        # ES service (optional)
        from app.services.elasticsearch_service import get_elasticsearch_service
        es_service = await get_elasticsearch_service()
        tenant_index_name = f"tenant_{tenant_id}_{kb_name}"

        for doc in docs:
            # Delete vectors: prefer IDs, fallback to filters
            try:
                vec_ids = []
                if doc.vector_ids:
                    try:
                        vec_ids = [int(i) for i in doc.vector_ids]
                    except Exception:
                        vec_ids = []

                did = 0
                if vec_ids:
                    did = milvus_service.delete_vectors(tenant_collection_name, vec_ids)
                if not vec_ids or did == 0:
                    milvus_service.delete_by_filters(
                        tenant_collection_name,
                        {
                            "tenant_id": tenant_id,
                            "document_name": doc.filename,
                            "knowledge_base": kb_name,
                        },
                    )
            except Exception as e:
                logger.warning(f"Failed to delete vectors for document {doc.id}: {e}")

            # Delete ES documents
            try:
                if es_service is not None:
                    await es_service.delete_by_query(
                        index_name=tenant_index_name,
                        term_filters={
                            "tenant_id": tenant_id,
                            "document_name": doc.filename,
                            "knowledge_base": kb_name,
                        },
                    )
            except Exception as e:
                logger.warning(f"Failed to delete ES docs for document {doc.id}: {e}")

            # Delete file
            try:
                if doc.file_path:
                    import os
                    if os.path.exists(doc.file_path):
                        os.remove(doc.file_path)
            except Exception as e:
                logger.warning(f"Failed to delete file {doc.file_path}: {e}")

            # Delete DB row
            try:
                db.delete(doc)
                deleted_count += 1
            except Exception as e:
                logger.warning(f"Failed to delete DB row for document {doc.id}: {e}")

        db.commit()
        return BatchDeleteResult(deleted=deleted_count)
    except Exception as e:
        logger.error(f"Batch delete failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {e}")


@router.get("/{document_id}/status", response_model=DocumentStatus)
async def get_document_status(
    document_id: int = Path(..., description="Document ID"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    Get the processing status of a specific document.
    Returns current status and any error messages.
    """
    try:
        # Find document in database
        document = db.query(Document).filter(Document.id == document_id).first()
        
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Document with id {document_id} not found"
            )
        
        # TODO: Add progress information from processing service
        progress_info = None
        if document.status == DocumentStatusEnum.PROCESSING.value:
            # In a full implementation, you might query a task queue or cache for progress
            progress_info = {"stage": "chunking", "percentage": 50}
        
        return DocumentStatus(
            id=document.id,
            filename=document.filename,
            status=document.status,
            error_message=document.error_message,
            progress=progress_info
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get status for document {document_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get document status: {e}"
        )
