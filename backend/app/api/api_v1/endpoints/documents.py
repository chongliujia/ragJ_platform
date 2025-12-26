"""
Document Management API Endpoints
Handles document uploads and processing within a knowledge base.
"""

import hashlib
import logging
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, BackgroundTasks, status, Form, HTTPException, Depends, Path
import os
import uuid

import aiofiles
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func

from app.services.document_service import document_service
from app.services.chunking_service import ChunkingStrategy, chunking_service
from app.db.database import get_db
from app.db.models.document import Document, DocumentStatus as DocumentStatusEnum
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.models.permission import PermissionType
from app.core.dependencies import get_current_user, get_tenant_id, require_permission
from app.core.config import settings
from app.services.storage_service import storage_service
from app.services.elasticsearch_service import get_elasticsearch_service

router = APIRouter()
logger = logging.getLogger(__name__)
UPLOAD_CHUNK_SIZE = 1024 * 1024

ALLOWED_DUPLICATE_POLICIES = {"allow", "skip", "replace", "version"}

def _normalize_vector_ids(value) -> list[int]:
    """Normalize vector id storage across DB backends (JSON/list vs TEXT/JSON-string)."""
    if value is None:
        return []
    if isinstance(value, list):
        out: list[int] = []
        for v in value:
            try:
                out.append(int(v))
            except Exception:
                continue
        return out
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        try:
            import json

            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return _normalize_vector_ids(parsed)
        except Exception:
            pass
        try:
            import ast

            parsed = ast.literal_eval(raw)
            if isinstance(parsed, list):
                return _normalize_vector_ids(parsed)
        except Exception:
            pass
        # Best-effort: comma-separated ids like "1,2,3" or "[1, 2, 3]"
        cleaned = raw.strip("[](){}")
        parts = [p.strip() for p in cleaned.split(",") if p.strip()]
        out: list[int] = []
        for p in parts:
            try:
                out.append(int(p))
            except Exception:
                continue
        return out
    return []

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


def _get_file_hash(doc: Document) -> Optional[str]:
    try:
        meta = doc.doc_metadata or {}
        value = meta.get("file_hash")
        return str(value) if value else None
    except Exception:
        return None


def _prune_semantic_candidates_for_documents(
    *,
    db: Session,
    kb_row: KBModel,
    tenant_id: int,
    document_ids: list[int],
) -> None:
    if not document_ids:
        return
    from app.db.models.semantic_candidate import SemanticCandidate

    doc_id_set = {int(doc_id) for doc_id in document_ids if doc_id is not None}
    if not doc_id_set:
        return

    candidates = (
        db.query(SemanticCandidate)
        .filter(
            SemanticCandidate.tenant_id == tenant_id,
            SemanticCandidate.knowledge_base_id == kb_row.id,
        )
        .all()
    )
    for candidate in candidates:
        evidence = candidate.evidence or []
        if not isinstance(evidence, list):
            continue
        filtered: list[dict] = []
        removed = False
        for item in evidence:
            if not isinstance(item, dict):
                filtered.append(item)
                continue
            raw_doc_id = item.get("document_id")
            try:
                doc_id = int(raw_doc_id)
            except Exception:
                doc_id = None
            if doc_id in doc_id_set:
                removed = True
                continue
            filtered.append(item)
        if not removed:
            continue
        if filtered:
            candidate.evidence = filtered
        else:
            db.delete(candidate)


async def _purge_documents(
    *,
    db: Session,
    docs: list[Document],
    kb_row: KBModel,
    tenant_id: int,
    es_service: Optional["ElasticsearchService"],
) -> None:
    if not docs:
        return
    from app.services.milvus_service import milvus_service
    from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel

    tenant_collection_name = (
        kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_row.name}"
    )

    for doc in docs:
        try:
            ids = []
            if doc.vector_ids:
                try:
                    ids = [int(i) for i in doc.vector_ids]
                except Exception:
                    ids = []
            if ids:
                deleted = await milvus_service.async_delete_vectors(tenant_collection_name, ids)
                if deleted == 0:
                    await milvus_service.async_delete_by_filters(
                        tenant_collection_name,
                        {
                            "tenant_id": tenant_id,
                            "document_name": doc.filename,
                            "knowledge_base": kb_row.name,
                        },
                    )
            else:
                await milvus_service.async_delete_by_filters(
                    tenant_collection_name,
                    {
                        "tenant_id": tenant_id,
                        "document_name": doc.filename,
                        "knowledge_base": kb_row.name,
                    },
                )
        except Exception as e:
            logger.warning(f"Failed to delete vectors for document {doc.id}: {e}")

        try:
            db.query(DocumentChunkModel).filter(
                DocumentChunkModel.document_id == doc.id,
                DocumentChunkModel.tenant_id == tenant_id,
            ).delete(synchronize_session=False)
        except Exception as e:
            logger.warning(f"Failed to delete persisted chunks for document {doc.id}: {e}")

        try:
            if es_service is not None:
                await es_service.delete_by_query(
                    index_name=tenant_collection_name,
                    term_filters={
                        "tenant_id": tenant_id,
                        "document_name": doc.filename,
                        "knowledge_base": kb_row.name,
                    },
                )
        except Exception as e:
            logger.warning(f"Failed to delete ES docs for document {doc.id}: {e}")

        try:
            if doc.file_path:
                storage_service.delete(doc.file_path)
        except Exception as e:
            logger.warning(f"Failed to delete storage file {doc.file_path}: {e}")

        try:
            db.delete(doc)
        except Exception as e:
            logger.warning(f"Failed to delete DB row for document {doc.id}: {e}")

    try:
        _prune_semantic_candidates_for_documents(
            db=db,
            kb_row=kb_row,
            tenant_id=tenant_id,
            document_ids=[doc.id for doc in docs],
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


async def _stream_upload_to_disk(
    file: UploadFile,
    file_path: str,
    max_size: int,
) -> tuple[int, str]:
    """Save upload to disk in chunks while computing size/hash."""
    size = 0
    hasher = hashlib.sha256()
    too_large = False

    async with aiofiles.open(file_path, "wb") as out:
        while True:
            chunk = await file.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            if max_size and size > max_size:
                too_large = True
                break
            hasher.update(chunk)
            await out.write(chunk)

    if too_large:
        try:
            os.remove(file_path)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Max size: {max_size} bytes",
        )

    return size, hasher.hexdigest()


class DocumentUploadResponse(BaseModel):
    """Response model for a successful document upload."""

    filename: str
    content_type: str
    message: str
    document_id: Optional[int] = None


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
    created_at: Optional[str]
    processed_at: Optional[str]
    progress: Optional[dict] = None


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


class DocumentChunkPreview(BaseModel):
    """Preview chunk response model."""

    chunk_index: int
    text: str


class DocumentChunkPreviewResponse(BaseModel):
    """Preview chunks response model."""

    total_chunks: int
    chunks: List[DocumentChunkPreview]


class BatchDeleteRequest(BaseModel):
    """Batch delete request payload."""

    document_ids: List[int]

class BatchDeleteResult(BaseModel):
    deleted: int


@router.post(
    "/", response_model=DocumentUploadResponse, status_code=status.HTTP_202_ACCEPTED
)
@router.post(
    "",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    include_in_schema=False,
)
async def upload_document(
    kb_name: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    chunking_strategy: Optional[str] = Form(None),
    chunking_params: Optional[str] = Form(None),
    duplicate_policy: Optional[str] = Form(None),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_UPLOAD.value)),
    db: Session = Depends(get_db),
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

    # Validate KB exists for tenant (no auto-create)
    kb_row = (
        db.query(KBModel)
        .filter(
            KBModel.name == kb_name,
            KBModel.tenant_id == tenant_id,
            KBModel.is_active == True,
        )
        .first()
    )
    if kb_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Knowledge base '{kb_name}' not found",
        )
    if not _can_write_kb(kb_row, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to upload to this knowledge base",
        )

    # Sanitize filename to prevent path traversal
    raw_filename = file.filename or "uploaded_file"
    original_filename = os.path.basename(raw_filename) or "uploaded_file"
    safe_filename = original_filename

    # Validate extension against allowed list
    ext = safe_filename.rsplit('.', 1)[-1].lower() if '.' in safe_filename else ''
    allowed_exts = set(ext.strip().lower() for ext in settings.get_supported_file_types())
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: .{ext}. Allowed: {', '.join(sorted(allowed_exts))}",
        )

    # Validate MIME type when provided (best-effort; some clients send octet-stream)
    try:
        content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    except Exception:
        content_type = ""

    allowed_mimes_by_ext = {
        "pdf": {"application/pdf"},
        "docx": {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/zip",  # some clients mislabel docx
        },
        "txt": {"text/plain"},
        "md": {
            "text/markdown",
            "text/plain",
            "text/x-markdown",
            "application/markdown",
            "application/x-markdown",
        },
        "xlsx": {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/octet-stream",
        },
        "xls": {
            "application/vnd.ms-excel",
            "application/octet-stream",
        },
        "html": {"text/html", "application/xhtml+xml"},
    }

    if content_type and content_type not in {"application/octet-stream"}:
        allowed_mimes = allowed_mimes_by_ext.get(ext)
        # If we don't recognize the ext in the mapping, fall back to extension-only.
        if allowed_mimes and content_type not in allowed_mimes:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Unsupported content-type '{content_type}' for .{ext}",
            )

    # Enforce tenant quotas (count limit before reading file)
    tenant_row = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant_row is not None:
        max_docs = int(tenant_row.max_documents or 0)
        if max_docs > 0:
            current_docs = (
                db.query(Document).filter(Document.tenant_id == tenant_id).count()
            )
            if current_docs >= max_docs:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Document quota exceeded for this tenant",
                )

    # Persist upload to disk to avoid loading large files into memory
    upload_root = settings.UPLOAD_DIR or "/tmp/uploads"
    upload_dir = os.path.join(upload_root, str(tenant_id))
    os.makedirs(upload_dir, exist_ok=True)
    stored_filename = f"{uuid.uuid4().hex}_{safe_filename}"
    file_path = os.path.join(upload_dir, stored_filename)

    try:
        file_size, file_hash = await _stream_upload_to_disk(
            file=file,
            file_path=file_path,
            max_size=settings.MAX_FILE_SIZE,
        )
    except HTTPException:
        raise
    except Exception as e:
        try:
            os.remove(file_path)
        except Exception:
            pass
        logger.error(f"Failed to save upload: {e}")
        raise HTTPException(status_code=500, detail="Failed to save file")

    # Enforce tenant storage quota after size is known
    if tenant_row is not None:
        quota_bytes = int(tenant_row.storage_quota_mb or 0) * 1024 * 1024
        if quota_bytes > 0:
            used_bytes = (
                db.query(sa_func.coalesce(sa_func.sum(Document.file_size), 0))
                .filter(Document.tenant_id == tenant_id)
                .scalar()
                or 0
            )
            if used_bytes + file_size > quota_bytes:
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Storage quota exceeded for this tenant",
                )

    policy = (duplicate_policy or "allow").strip().lower()
    if policy not in ALLOWED_DUPLICATE_POLICIES:
        try:
            os.remove(file_path)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported duplicate_policy '{duplicate_policy}'",
        )

    # Check duplicates before uploading to object storage
    existing_docs = (
        db.query(Document)
        .filter(
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id,
        )
        .all()
    )
    existing_by_hash = [
        d for d in existing_docs if _get_file_hash(d) == file_hash
    ]
    existing_by_name = [
        d for d in existing_docs if d.original_filename == original_filename
    ]

    if policy == "skip" and existing_by_hash:
        try:
            os.remove(file_path)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Duplicate file detected; upload skipped.",
        )

    if policy == "replace" and existing_by_name:
        es_service = await get_elasticsearch_service()
        try:
            await _purge_documents(
                db=db,
                docs=existing_by_name,
                kb_row=kb_row,
                tenant_id=tenant_id,
                es_service=es_service,
            )
        except Exception as e:
            try:
                os.remove(file_path)
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to replace existing documents: {e}",
            )

    storage_path = file_path
    if storage_service.is_object_storage():
        storage_key = f"tenant_{tenant_id}/{stored_filename}"
        try:
            storage_service.upload_file(file_path, storage_key, content_type=content_type or None)
            storage_path = storage_key
            try:
                os.remove(file_path)
            except Exception:
                pass
        except Exception as e:
            try:
                os.remove(file_path)
            except Exception:
                pass
            logger.error(f"Failed to upload to object storage: {e}")
            raise HTTPException(status_code=500, detail="Failed to store file")

    doc_metadata = {
        "file_hash": file_hash,
        "storage_backend": storage_service.backend,
        "duplicate_policy": policy,
    }
    if storage_service.bucket:
        doc_metadata["storage_bucket"] = storage_service.bucket
    if policy == "replace" and existing_by_name:
        doc_metadata["replaces_document_ids"] = [d.id for d in existing_by_name]
    if policy == "version" and existing_by_name:
        doc_metadata["version_of"] = existing_by_name[0].id
        doc_metadata["version_index"] = len(existing_by_name) + 1

    document_record = None
    try:
        display_title = (original_filename or safe_filename).strip() or safe_filename
        if len(display_title) > 255:
            display_title = display_title[:255]
        document_record = Document(
            filename=safe_filename,
            original_filename=original_filename or safe_filename,
            file_type=ext or "unknown",
            file_size=file_size,
            file_path=storage_path,
            knowledge_base_id=kb_row.id,
            knowledge_base_name=kb_name,
            tenant_id=tenant_id,
            uploaded_by=current_user.id,
            status=DocumentStatusEnum.PENDING.value,
            title=display_title,
            content_preview=None,
            total_chunks=0,
            vector_ids=[],
            doc_metadata=doc_metadata or {},
        )
        db.add(document_record)
        db.commit()
        db.refresh(document_record)
    except Exception as e:
        db.rollback()
        try:
            storage_service.delete(storage_path)
        except Exception:
            pass
        logger.error(f"Failed to persist document record: {e}")
        raise HTTPException(status_code=500, detail="Failed to create document record")

    # Parse chunking strategy (fallback to KB settings)
    kb_settings = kb_row.settings or {}
    strategy_value = chunking_strategy or kb_settings.get("chunking_strategy")
    if not strategy_value:
        strategy_value = ChunkingStrategy.RECURSIVE.value
    try:
        strategy = ChunkingStrategy(strategy_value)
    except ValueError:
        strategy = ChunkingStrategy.RECURSIVE
        logger.warning(
            f"Unknown chunking strategy '{strategy_value}', falling back to recursive."
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
    if not params:
        raw_params = kb_settings.get("chunking_params")
        if isinstance(raw_params, dict):
            params = dict(raw_params)
    if not params:
        params = {
            "chunk_size": int(getattr(kb_row, "chunk_size", 0) or settings.CHUNK_SIZE),
            "chunk_overlap": int(getattr(kb_row, "chunk_overlap", 0) or settings.CHUNK_OVERLAP),
        }
    params.setdefault("chunk_size", int(getattr(kb_row, "chunk_size", 0) or settings.CHUNK_SIZE))
    params.setdefault("chunk_overlap", int(getattr(kb_row, "chunk_overlap", 0) or settings.CHUNK_OVERLAP))

    # Dispatch processing: Celery (if enabled) or local background task
    if settings.USE_CELERY:
        try:
            from app.tasks.document_tasks import process_document_task
            process_document_task.delay(
                storage_path,
                safe_filename,
                kb_name,
                tenant_id,
                current_user.id,
                strategy.value,
                params,
                doc_metadata,
                original_filename,
                document_record.id if document_record else None,
            )
        except Exception as e:
            try:
                storage_service.delete(storage_path)
            except Exception:
                pass
            logger.error(f"Failed to enqueue Celery task: {e}")
            raise HTTPException(status_code=500, detail="Failed to enqueue processing task")
    else:
        # Add the processing task to the background
        background_tasks.add_task(
            document_service.process_document,
            None,
            safe_filename,
            kb_name,
            tenant_id,
            current_user.id,
            strategy,
            params,
            storage_path,
            doc_metadata,
            original_filename,
            document_record.id if document_record else None,
        )

    return {
        "filename": safe_filename,
        "content_type": file.content_type,
        "message": "File accepted and is being processed in the background.",
        "document_id": document_record.id if document_record else None,
    }


@router.post("/preview-chunks", response_model=DocumentChunkPreviewResponse)
async def preview_document_chunks(
    kb_name: str,
    file: UploadFile = File(...),
    chunking_strategy: Optional[str] = Form(None),
    chunking_params: Optional[str] = Form(None),
    limit: int = Form(5),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_UPLOAD.value)),
    db: Session = Depends(get_db),
):
    """
    Preview chunks for a document without persisting it.
    """
    kb_row = (
        db.query(KBModel)
        .filter(
            KBModel.name == kb_name,
            KBModel.tenant_id == tenant_id,
            KBModel.is_active == True,
        )
        .first()
    )
    if kb_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Knowledge base '{kb_name}' not found",
        )
    if not _can_write_kb(kb_row, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to upload to this knowledge base",
        )

    original_filename = file.filename or "uploaded_file"
    safe_filename = os.path.basename(original_filename) or "uploaded_file"
    ext = safe_filename.rsplit(".", 1)[-1].lower() if "." in safe_filename else ""
    allowed_exts = set(ext.strip().lower() for ext in settings.get_supported_file_types())
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: .{ext}. Allowed: {', '.join(sorted(allowed_exts))}",
        )

    try:
        content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    except Exception:
        content_type = ""

    allowed_mimes_by_ext = {
        "pdf": {"application/pdf"},
        "docx": {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/zip",
        },
        "txt": {"text/plain"},
        "md": {
            "text/markdown",
            "text/plain",
            "text/x-markdown",
            "application/markdown",
            "application/x-markdown",
        },
        "xlsx": {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/octet-stream",
        },
        "xls": {
            "application/vnd.ms-excel",
            "application/octet-stream",
        },
        "html": {"text/html", "application/xhtml+xml"},
    }
    if content_type and content_type not in {"application/octet-stream"}:
        allowed_mimes = allowed_mimes_by_ext.get(ext)
        if allowed_mimes and content_type not in allowed_mimes:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Unsupported content-type '{content_type}' for .{ext}",
            )

    content = await file.read()
    if len(content) > settings.MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Max size: {settings.MAX_FILE_SIZE} bytes",
        )

    kb_settings = kb_row.settings or {}
    strategy_value = chunking_strategy or kb_settings.get("chunking_strategy")
    if not strategy_value:
        strategy_value = ChunkingStrategy.RECURSIVE.value
    try:
        strategy = ChunkingStrategy(strategy_value)
    except ValueError:
        strategy = ChunkingStrategy.RECURSIVE

    params = {}
    if chunking_params:
        try:
            import json

            params = json.loads(chunking_params)
        except Exception:
            params = {}
    if not params:
        raw_params = kb_settings.get("chunking_params")
        if isinstance(raw_params, dict):
            params = dict(raw_params)
    if not params:
        params = {
            "chunk_size": int(getattr(kb_row, "chunk_size", 0) or settings.CHUNK_SIZE),
            "chunk_overlap": int(getattr(kb_row, "chunk_overlap", 0) or settings.CHUNK_OVERLAP),
        }
    params.setdefault("chunk_size", int(getattr(kb_row, "chunk_size", 0) or settings.CHUNK_SIZE))
    params.setdefault("chunk_overlap", int(getattr(kb_row, "chunk_overlap", 0) or settings.CHUNK_OVERLAP))

    from app.services import parser_service

    text = parser_service.parse_document(content, safe_filename)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to parse document text",
        )

    chunks = await chunking_service.chunk_document(
        text=text, strategy=strategy, **params
    )
    total = len(chunks)
    safe_limit = max(1, min(int(limit or 5), 20))
    preview = [
        DocumentChunkPreview(chunk_index=i, text=str(c or ""))
        for i, c in enumerate(chunks[:safe_limit])
    ]
    return DocumentChunkPreviewResponse(total_chunks=total, chunks=preview)


@router.post("/{document_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_document_processing(
    kb_name: str,
    document_id: int = Path(..., description="Document ID"),
    background_tasks: BackgroundTasks = None,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_UPDATE.value)),
    db: Session = Depends(get_db),
):
    """Retry processing for a failed document without re-uploading the file."""
    doc = (
        db.query(Document)
        .filter(
            Document.id == document_id,
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if doc.status != DocumentStatusEnum.FAILED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only failed documents can be retried")

    # Determine chunking config: reuse stored metadata if present, otherwise use KB defaults.
    strategy = ChunkingStrategy.RECURSIVE
    params: dict = {}
    try:
        meta = doc.doc_metadata or {}
        s = meta.get("chunking_strategy")
        p = meta.get("chunking_params")
        if s:
            try:
                strategy = ChunkingStrategy(str(s))
            except Exception:
                strategy = ChunkingStrategy.RECURSIVE
        if isinstance(p, dict):
            params = p
    except Exception:
        pass

    if not params:
        kb_row = (
            db.query(KBModel)
            .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id)
            .first()
        )
        if kb_row is not None:
            if not _can_write_kb(kb_row, current_user):
                raise HTTPException(status_code=403, detail="Not allowed to manage this knowledge base")
            try:
                params = {
                    "chunk_size": int(getattr(kb_row, "chunk_size", 0) or settings.CHUNK_SIZE),
                    "chunk_overlap": int(getattr(kb_row, "chunk_overlap", 0) or settings.CHUNK_OVERLAP),
                }
            except Exception:
                params = {}

    # Enqueue background retry
    if background_tasks is None:
        background_tasks = BackgroundTasks()
    background_tasks.add_task(
        document_service.reprocess_document,
        document_id,
        tenant_id,
        current_user.id,
        strategy,
        params,
    )
    return {"message": "Retry accepted and is being processed in the background."}


@router.get("/chunking-strategies")
async def get_chunking_strategies():
    """
    Get available chunking strategies and their parameters.
    """
    return {"strategies": chunking_service.get_available_strategies()}


@router.get("/", response_model=List[DocumentInfo])
@router.get("", response_model=List[DocumentInfo], include_in_schema=False)
async def list_knowledge_base_documents(
    kb_name: str,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_READ.value)),
):
    """
    Get list of documents in a knowledge base.
    Returns all documents with their processing status and metadata.
    """
    try:
        kb_row = (
            db.query(KBModel)
            .filter(
                KBModel.name == kb_name,
                KBModel.tenant_id == tenant_id,
                KBModel.is_active == True,
            )
            .first()
        )
        if kb_row is None or not _can_read_kb(kb_row, current_user):
            raise HTTPException(status_code=404, detail="Knowledge base not found")
        
        # Query documents from database
        documents = db.query(Document).filter(
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id
        ).all()
        
        result = []
        for doc in documents:
            progress_info = None
            try:
                meta = doc.doc_metadata or {}
                progress_info = meta.get("processing_progress")
            except Exception:
                progress_info = None
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
                progress=progress_info,
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
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_DELETE.value)),
):
    """
    Delete a document from the knowledge base.
    This removes the document from both database and vector storage.
    """
    try:        
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
            tenant_collection_name = (
                kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
            )
            from app.services.milvus_service import milvus_service
            ids = []
            if document.vector_ids:
                try:
                    ids = [int(i) for i in document.vector_ids]
                except Exception:
                    ids = []
            deleted = 0
            if ids:
                deleted = await milvus_service.async_delete_vectors(tenant_collection_name, ids)
                if deleted == 0:
                    logger.warning(
                        f"Delete by ids returned 0 for document {document_id}. Falling back to filter deletion."
                    )
            if not ids or deleted == 0:
                await milvus_service.async_delete_by_filters(
                    tenant_collection_name,
                    {
                        "tenant_id": tenant_id,
                        "document_name": document.filename,
                        "knowledge_base": kb_name,
                    },
                )
        except Exception as e:
            logger.warning(f"Failed to delete vectors for document {document_id}: {e}")

        # Remove persisted chunks
        try:
            from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel
            db.query(DocumentChunkModel).filter(
                DocumentChunkModel.document_id == document_id,
                DocumentChunkModel.tenant_id == tenant_id,
            ).delete(synchronize_session=False)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"Failed to delete persisted chunks for document {document_id}: {e}")

        # Remove from Elasticsearch
        try:
            from app.services.elasticsearch_service import get_elasticsearch_service
            es_service = await get_elasticsearch_service()
            if es_service is not None:
                tenant_index_name = (
                    kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
                )
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
        
        # Remove file/object if it exists
        if document.file_path:
            try:
                storage_service.delete(document.file_path)
            except Exception as e:
                logger.warning(f"Failed to delete file {document.file_path}: {e}")
        
        # Remove from database
        db.delete(document)
        _prune_semantic_candidates_for_documents(
            db=db,
            kb_row=kb_row,
            tenant_id=tenant_id,
            document_ids=[document.id],
        )
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
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_READ.value)),
):
    """
    Retrieve chunk texts for a specific document, ordered by original insertion order.
    Prefer DB-persisted chunks for reliable pagination; fallback to Milvus by stored vector IDs.
    """
    try:
        kb_row = (
            db.query(KBModel)
            .filter(
                KBModel.name == kb_name,
                KBModel.tenant_id == tenant_id,
                KBModel.is_active == True,
            )
            .first()
        )
        if kb_row is None or not _can_read_kb(kb_row, current_user):
            raise HTTPException(status_code=404, detail="Knowledge base not found")

        document = db.query(Document).filter(
            Document.id == document_id,
            Document.knowledge_base_name == kb_name,
            Document.tenant_id == tenant_id,
        ).first()

        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        # 1) Prefer DB-persisted chunks (stable, does not depend on Milvus schema).
        try:
            from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel

            q = (
                db.query(DocumentChunkModel)
                .filter(
                    DocumentChunkModel.document_id == document_id,
                    DocumentChunkModel.tenant_id == tenant_id,
                )
                .order_by(DocumentChunkModel.chunk_index.asc())
            )
            if offset < 0:
                offset = 0
            if limit <= 0:
                limit = 100
            rows = q.offset(offset).limit(limit).all()
            if rows:
                return [
                    DocumentChunk(
                        id=int(r.id),
                        chunk_index=int(r.chunk_index),
                        text=r.text or "",
                    )
                    for r in rows
                ]
        except Exception:
            # Fall back to Milvus logic below
            pass

        # 1.5) If chunks are not persisted yet, try to backfill from stored file for UI display.
        # This is best-effort and does not affect vector store; it only improves "查看分片" UX.
        try:
            import os
            from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel
            from app.services import parser_service
            from app.services.chunking_service import chunking_service, ChunkingStrategy
            from app.core.config import settings

            if document.file_path and storage_service.exists(document.file_path):
                chunk_size = int(getattr(kb_row, "chunk_size", 0) or settings.CHUNK_SIZE)
                chunk_overlap = int(getattr(kb_row, "chunk_overlap", 0) or settings.CHUNK_OVERLAP)
                raw = storage_service.read_bytes(document.file_path)
                text = parser_service.parse_document(raw, document.filename)
                chunks_all = await chunking_service.chunk_document(
                    text=text,
                    strategy=ChunkingStrategy.RECURSIVE,
                    chunk_size=chunk_size,
                    chunk_overlap=chunk_overlap,
                )
                if chunks_all:
                    # Ensure table exists, then persist
                    try:
                        DocumentChunkModel.__table__.create(bind=db.get_bind(), checkfirst=True)  # type: ignore[attr-defined]
                    except Exception:
                        pass
                    rows = [
                        DocumentChunkModel(
                            tenant_id=tenant_id,
                            document_id=document_id,
                            knowledge_base_name=kb_name,
                            chunk_index=i,
                            text=str(t or ""),
                            milvus_pk=None,
                        )
                        for i, t in enumerate(chunks_all)
                    ]
                    db.bulk_save_objects(rows)
                    db.commit()

                    # Return requested page
                    page_rows = (
                        db.query(DocumentChunkModel)
                        .filter(
                            DocumentChunkModel.document_id == document_id,
                            DocumentChunkModel.tenant_id == tenant_id,
                        )
                        .order_by(DocumentChunkModel.chunk_index.asc())
                        .offset(offset)
                        .limit(limit)
                        .all()
                    )
                    if page_rows:
                        return [
                            DocumentChunk(
                                id=int(r.id),
                                chunk_index=int(r.chunk_index),
                                text=r.text or "",
                            )
                            for r in page_rows
                        ]
        except Exception:
            # If backfill fails, continue to Milvus fallback below.
            try:
                db.rollback()
            except Exception:
                pass

        vector_ids = _normalize_vector_ids(document.vector_ids)

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

        # Fetch from Milvus by IDs (or fallback by filters)
        from app.services.milvus_service import milvus_service
        tenant_collection_name = (
            kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
        )

        # If ids are empty (legacy docs), try query by filters first.
        if not slice_ids:
            try:
                all_rows = await milvus_service.async_query_texts_by_filters(
                    tenant_collection_name,
                    {"tenant_id": tenant_id, "document_name": document.filename, "knowledge_base": kb_name},
                    limit=min(max(int(offset + limit), 2000), 16384),
                )
                page = all_rows[offset : offset + limit] if all_rows else []
                if page:
                    return [
                        DocumentChunk(
                            id=int(r.get("id", 0)),
                            chunk_index=offset + i,
                            text=str(r.get("text", "") or ""),
                        )
                        for i, r in enumerate(page)
                    ]
            except Exception:
                pass

        results = await milvus_service.async_get_texts_by_ids(tenant_collection_name, slice_ids)

        # Build map and preserve order
        text_by_id = {int(r["id"]): r.get("text", "") for r in results}
        chunks: list[DocumentChunk] = []
        for idx, pk in enumerate(slice_ids):
            chunks.append(
                DocumentChunk(id=int(pk), chunk_index=offset + idx, text=text_by_id.get(int(pk), ""))
            )

        if any(c.text for c in chunks):
            return chunks

        # Legacy fallback: vector_ids might be empty/incorrect; query Milvus by filters
        try:
            wanted = max(int(offset + limit), 2000)
            all_rows = await milvus_service.async_query_texts_by_filters(
                tenant_collection_name,
                {"tenant_id": tenant_id, "document_name": document.filename, "knowledge_base": kb_name},
                limit=min(wanted, 16384),
            )
            if all_rows:
                page = all_rows[offset : offset + limit]
                return [
                    DocumentChunk(id=int(r.get("id", 0)), chunk_index=offset + i, text=str(r.get("text", "") or ""))
                    for i, r in enumerate(page)
                ]
        except Exception:
            pass
        return []
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
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_DELETE.value)),
):
    """
    Batch delete multiple documents and their associated vectors and ES entries.
    """
    try:
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
        deleted_doc_ids: list[int] = []
        from app.services.milvus_service import milvus_service
        tenant_collection_name = (
            kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
        )

        # ES service (optional)
        from app.services.elasticsearch_service import get_elasticsearch_service
        es_service = await get_elasticsearch_service()
        tenant_index_name = (
            kb_row.milvus_collection_name or f"tenant_{tenant_id}_{kb_name}"
        )

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
                    did = await milvus_service.async_delete_vectors(tenant_collection_name, vec_ids)
                if not vec_ids or did == 0:
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

            # Delete persisted chunks
            try:
                from app.db.models.document_chunk import DocumentChunk as DocumentChunkModel
                db.query(DocumentChunkModel).filter(
                    DocumentChunkModel.document_id == doc.id,
                    DocumentChunkModel.tenant_id == tenant_id,
                ).delete(synchronize_session=False)
            except Exception as e:
                logger.warning(f"Failed to delete persisted chunks for document {doc.id}: {e}")

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

            # Delete file/object
            try:
                if doc.file_path:
                    storage_service.delete(doc.file_path)
            except Exception as e:
                logger.warning(f"Failed to delete file {doc.file_path}: {e}")

            # Delete DB row
            try:
                db.delete(doc)
                deleted_count += 1
                deleted_doc_ids.append(doc.id)
            except Exception as e:
                logger.warning(f"Failed to delete DB row for document {doc.id}: {e}")

        _prune_semantic_candidates_for_documents(
            db=db,
            kb_row=kb_row,
            tenant_id=tenant_id,
            document_ids=deleted_doc_ids,
        )
        db.commit()
        return BatchDeleteResult(deleted=deleted_count)
    except Exception as e:
        logger.error(f"Batch delete failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {e}")


@router.get("/{document_id}/status", response_model=DocumentStatus)
async def get_document_status(
    document_id: int = Path(..., description="Document ID"),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_permission(PermissionType.DOCUMENT_READ.value)),
):
    """
    Get the processing status of a specific document.
    Returns current status and any error messages.
    """
    try:
        # Find document in database
        document = (
            db.query(Document)
            .filter(Document.id == document_id, Document.tenant_id == tenant_id)
            .first()
        )
        
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Document with id {document_id} not found"
            )

        kb_row = (
            db.query(KBModel)
            .filter(
                KBModel.name == document.knowledge_base_name,
                KBModel.tenant_id == tenant_id,
                KBModel.is_active == True,
            )
            .first()
        )
        if kb_row is None or not _can_read_kb(kb_row, current_user):
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Best-effort progress from doc_metadata (written by document_service)
        progress_info = None
        try:
            meta = document.doc_metadata or {}
            progress_info = meta.get("processing_progress")
        except Exception:
            progress_info = None
        
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
