"""
Document Management API Endpoints
Handles document uploads and processing within a knowledge base.
"""

import logging
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, BackgroundTasks, status, Form, HTTPException, Depends, Path
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services.document_service import document_service
from app.services.chunking_service import ChunkingStrategy, chunking_service
from app.db.database import get_db
from app.db.models.document import Document, DocumentStatus as DocumentStatusEnum
from app.core.dependencies import get_current_user, get_tenant_id

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

    content = await file.read()

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

    # Add the processing task to the background
    background_tasks.add_task(
        document_service.process_document,
        content,
        file.filename,
        kb_name,
        tenant_id,
        current_user.id,
        strategy,
        params,
    )

    return {
        "filename": file.filename,
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
        
        # Remove from vector database
        if document.vector_ids:
            try:
                tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"
                from app.services.milvus_service import milvus_service
                milvus_service.delete_vectors(tenant_collection_name, document.vector_ids)
            except Exception as e:
                logger.warning(f"Failed to delete vectors for document {document_id}: {e}")
        
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
