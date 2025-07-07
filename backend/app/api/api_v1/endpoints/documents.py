"""
Document Management API Endpoints
Handles document uploads and processing within a knowledge base.
"""
import logging
from typing import Optional
from fastapi import APIRouter, UploadFile, File, BackgroundTasks, status, Form
from pydantic import BaseModel

from app.services.document_service import document_service
from app.services.chunking_service import ChunkingStrategy, chunking_service

router = APIRouter()
logger = logging.getLogger(__name__)


class DocumentUploadResponse(BaseModel):
    """Response model for a successful document upload."""
    filename: str
    content_type: str
    message: str


@router.post("/", response_model=DocumentUploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    kb_name: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    chunking_strategy: Optional[str] = Form(ChunkingStrategy.RECURSIVE.value),
    chunking_params: Optional[str] = Form(None)
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
    logger.info(f"Received file '{file.filename}' for knowledge base '{kb_name}' with strategy '{chunking_strategy}'.")

    content = await file.read()

    # Parse chunking strategy
    try:
        strategy = ChunkingStrategy(chunking_strategy)
    except ValueError:
        strategy = ChunkingStrategy.RECURSIVE
        logger.warning(f"Unknown chunking strategy '{chunking_strategy}', falling back to recursive.")

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
        strategy,
        params
    )

    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "message": "File accepted and is being processed in the background."
    }


@router.get("/chunking-strategies")
async def get_chunking_strategies():
    """
    Get available chunking strategies and their parameters.
    """
    return {
        "strategies": chunking_service.get_available_strategies()
    } 