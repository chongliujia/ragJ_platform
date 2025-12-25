"""
This service handles the entire document processing pipeline, from ingestion
to chunking, embedding, and indexing.
"""

import logging
from datetime import datetime
from typing import Optional
import os
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from fastapi import UploadFile

from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import get_elasticsearch_service
from app.services.chunking_service import chunking_service, ChunkingStrategy
from app.services import parser_service
from app.services.storage_service import storage_service
from app.core.config import settings
from app.db.database import SessionLocal
from app.db.models.document import Document, DocumentStatus
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.db.models.document_chunk import DocumentChunk
from app.utils.kb_collection import resolve_kb_collection_name

logger = logging.getLogger(__name__)


class DocumentService:
    """
    Orchestrates the document processing workflow.
    """

    def _update_document_progress(
        self,
        db: Session,
        document_id: int,
        *,
        stage: str,
        percentage: int,
        message: Optional[str] = None,
        extra: Optional[dict] = None,
    ) -> None:
        """Best-effort progress reporting stored in Document.doc_metadata.

        This avoids schema migrations while enabling UI polling via `/documents/{id}/status`.
        """
        try:
            document = db.query(Document).filter(Document.id == document_id).first()
            if not document:
                return
            meta = dict(document.doc_metadata or {})
            payload: dict = {
                "stage": str(stage),
                "percentage": max(0, min(int(percentage), 100)),
                "updated_at": datetime.utcnow().isoformat(),
            }
            if message:
                payload["message"] = str(message)
            if isinstance(extra, dict) and extra:
                payload["extra"] = extra
            meta["processing_progress"] = payload
            document.doc_metadata = meta
            db.add(document)
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

    def _save_document_record(
        self,
        db: Session,
        filename: str,
        file_type: str,
        file_size: int,
        file_path: str,
        kb_name: str,
        tenant_id: int,
        user_id: int,
        content_preview: Optional[str] = None,
        title: Optional[str] = None,
        original_filename: Optional[str] = None,
        doc_metadata: Optional[dict] = None,
    ) -> Document:
        """Create and save document record to database."""
        # Ensure KB record exists, get its id
        kb = (
            db.query(KBModel)
            .filter(KBModel.name == kb_name, KBModel.tenant_id == tenant_id)
            .first()
        )
        if kb is None:
            raise ValueError(
                f"Knowledge base '{kb_name}' not found for tenant {tenant_id}"
            )
        document = Document(
            filename=filename,
            original_filename=original_filename or filename,
            file_type=file_type,
            file_size=file_size,
            file_path=file_path,
            knowledge_base_name=kb_name,
            knowledge_base_id=kb.id,
            tenant_id=tenant_id,
            uploaded_by=user_id,
            status=DocumentStatus.PENDING.value,
            title=title,
            content_preview=content_preview,
            total_chunks=0,
            vector_ids=[],
            doc_metadata=doc_metadata or {},
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        return document
    
    def _update_document_status(
        self,
        db: Session,
        document_id: int,
        status: DocumentStatus,
        error_message: Optional[str] = None,
        total_chunks: Optional[int] = None,
        vector_ids: Optional[list] = None
    ):
        """Update document processing status."""
        document = db.query(Document).filter(Document.id == document_id).first()
        if document:
            document.status = status.value
            document.error_message = error_message
            if total_chunks is not None:
                document.total_chunks = total_chunks
            if vector_ids is not None:
                document.vector_ids = vector_ids
            if status == DocumentStatus.COMPLETED:
                document.processed_at = datetime.utcnow()
                # update KB counters best-effort
                try:
                    kb = (
                        db.query(KBModel)
                        .filter(
                            KBModel.name == document.knowledge_base_name,
                            KBModel.tenant_id == document.tenant_id,
                        )
                        .first()
                    )
                    if kb:
                        kb.document_count = (kb.document_count or 0) + 1
                        kb.total_chunks = (kb.total_chunks or 0) + (total_chunks or 0)
                        kb.total_size_bytes = (kb.total_size_bytes or 0) + (document.file_size or 0)
                        db.add(kb)
                except Exception as e:
                    logger.warning(f"update KB counters failed: {e}")
            db.commit()

    async def process_document(
        self,
        content: Optional[bytes],
        filename: str,
        kb_name: str,
        tenant_id: int,
        user_id: int,
        chunking_strategy: ChunkingStrategy = ChunkingStrategy.RECURSIVE,
        chunking_params: dict = None,
        file_system_path: Optional[str] = None,
        doc_metadata: Optional[dict] = None,
        original_filename: Optional[str] = None,
    ):
        """
        Process an uploaded document with proper status tracking.
        """
        db = SessionLocal()
        document_record = None
        es_service = None
        
        try:
            if content is None:
                if not file_system_path:
                    raise Exception("File content missing and storage path not provided")
                content = storage_service.read_bytes(file_system_path)

            # Save initial document record
            file_type = filename.split('.')[-1].lower() if '.' in filename else 'unknown'
            file_size = len(content)
            
            # Create or reuse file path (in production, save to proper storage)
            if file_system_path:
                file_path = file_system_path
            else:
                upload_dir = os.path.join(settings.UPLOAD_DIR or "/tmp/uploads", str(tenant_id))
                os.makedirs(upload_dir, exist_ok=True)
                file_path = os.path.join(upload_dir, filename)
                # Save file to disk
                with open(file_path, 'wb') as f:
                    f.write(content)
            
            # Parse content to extract title and preview
            document_text = parser_service.parse_document(content, filename)
            if not document_text:
                raise Exception(f"Failed to parse text from {filename}")
                
            # Extract title (first line) and preview (first 500 chars)
            lines = document_text.split('\n')
            title = lines[0][:255] if lines else filename
            content_preview = document_text[:500] if document_text else None
            
            # Create document record
            document_record = self._save_document_record(
                db=db,
                filename=filename,
                file_type=file_type,
                file_size=file_size,
                file_path=file_path,
                kb_name=kb_name,
                tenant_id=tenant_id,
                user_id=user_id,
                content_preview=content_preview,
                title=title,
                original_filename=original_filename,
                doc_metadata=doc_metadata,
            )
            self._update_document_progress(
                db,
                document_record.id,
                stage="queued",
                percentage=0,
                message="Document accepted",
            )
            # Store chunking config for future retries/debugging
            try:
                meta = dict(document_record.doc_metadata or {})
                meta["chunking_strategy"] = getattr(chunking_strategy, "value", str(chunking_strategy))
                meta["chunking_params"] = chunking_params or {}
                document_record.doc_metadata = meta
                db.add(document_record)
                db.commit()
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass
            
            # Update status to PROCESSING
            self._update_document_status(db, document_record.id, DocumentStatus.PROCESSING)
            self._update_document_progress(
                db,
                document_record.id,
                stage="processing",
                percentage=5,
                message="Starting processing",
            )
            
            es_service = await get_elasticsearch_service()
            
            # Split document into chunks using specified strategy
            if chunking_params is None:
                chunking_params = {}

            chunks = await chunking_service.chunk_document(
                text=document_text, strategy=chunking_strategy, **chunking_params
            )
            self._update_document_progress(
                db,
                document_record.id,
                stage="chunking",
                percentage=30,
                message="Chunking completed",
                extra={"chunks": len(chunks)},
            )

            # Get embeddings for chunks
            embedding_response = await llm_service.get_embeddings(
                texts=chunks, tenant_id=tenant_id, user_id=user_id
            )

            if not embedding_response.get("success"):
                details = embedding_response.get("details")
                error_msg = f"Embedding generation failed: {embedding_response.get('error')}"
                if details:
                    # Provider may return useful JSON/text with reasons like invalid key/quota/model not allowed
                    error_msg = f"{error_msg}; details: {details}"
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="failed",
                    percentage=30,
                    message=error_msg,
                )
                logger.error(error_msg)
                return

            # If the embedding layer split inputs to satisfy provider constraints (e.g. max tokens),
            # we must use the adjusted chunk list for downstream indexing.
            adjusted_inputs = embedding_response.get("input_texts")
            if isinstance(adjusted_inputs, list) and adjusted_inputs:
                chunks = [str(x) for x in adjusted_inputs]

            embeddings = embedding_response.get("embeddings", [])

            if len(embeddings) != len(chunks):
                error_msg = f"Number of embeddings ({len(embeddings)}) does not match chunks ({len(chunks)})"
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="failed",
                    percentage=60,
                    message=error_msg,
                )
                logger.error(error_msg)
                return
            self._update_document_progress(
                db,
                document_record.id,
                stage="embedding",
                percentage=60,
                message="Embeddings generated",
                extra={"chunks": len(chunks), "vectors": len(embeddings)},
            )

            # Prepare entities for Milvus insertion with tenant/user metadata
            entities = [
                {
                    "text": chunk,
                    "vector": vector,
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "document_name": filename,
                    "knowledge_base": kb_name,
                }
                for chunk, vector in zip(chunks, embeddings)
            ]

            # Create tenant-specific collection name
            tenant_collection_name = resolve_kb_collection_name(
                db, tenant_id, kb_name=kb_name
            )

            # Insert into Milvus (synchronous call)
            try:
                vector_ids = await milvus_service.async_insert(
                    collection_name=tenant_collection_name, entities=entities
                )
            except Exception as milvus_err:
                error_msg = f"Milvus insert failed: {milvus_err}"
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="failed",
                    percentage=70,
                    message=error_msg,
                )
                logger.error(error_msg)
                return
            self._update_document_progress(
                db,
                document_record.id,
                stage="vector_index",
                percentage=80,
                message="Vectors stored",
                extra={"vector_ids": len(vector_ids) if isinstance(vector_ids, list) else 0},
            )

            # Persist chunks for UI display / pagination (source-of-truth for "查看分片").
            # Keep it best-effort; failures should not invalidate a successful vector insert.
            def _persist_chunks_once() -> None:
                # Clear any existing chunks for this document (re-upload/replace cases)
                db.query(DocumentChunk).filter(
                    DocumentChunk.document_id == document_record.id,
                    DocumentChunk.tenant_id == tenant_id,
                ).delete(synchronize_session=False)
                db.commit()

                rows: list[DocumentChunk] = []
                if isinstance(vector_ids, list) and len(vector_ids) == len(chunks):
                    for i, (txt, pk) in enumerate(zip(chunks, vector_ids)):
                        rows.append(
                            DocumentChunk(
                                tenant_id=tenant_id,
                                document_id=document_record.id,
                                knowledge_base_name=kb_name,
                                chunk_index=int(i),
                                text=str(txt or ""),
                                milvus_pk=int(pk) if pk is not None else None,
                            )
                        )
                else:
                    for i, txt in enumerate(chunks):
                        rows.append(
                            DocumentChunk(
                                tenant_id=tenant_id,
                                document_id=document_record.id,
                                knowledge_base_name=kb_name,
                                chunk_index=int(i),
                                text=str(txt or ""),
                                milvus_pk=None,
                            )
                        )
                if rows:
                    db.bulk_save_objects(rows)
                    db.commit()

            try:
                _persist_chunks_once()
            except Exception as e:
                db.rollback()
                # Common case: table not created yet (dev hot-reload without restart).
                # Try to create it once and retry.
                try:
                    DocumentChunk.__table__.create(bind=db.get_bind(), checkfirst=True)  # type: ignore[attr-defined]
                    _persist_chunks_once()
                except SQLAlchemyError as e2:
                    db.rollback()
                    logger.warning(
                        f"Failed to persist document chunks for doc {document_record.id}: {e2}"
                    )
                except Exception as e2:
                    db.rollback()
                    logger.warning(
                        f"Failed to persist document chunks for doc {document_record.id}: {e2}"
                    )
            else:
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="persist_chunks",
                    percentage=88,
                    message="Chunk texts persisted",
                )

            # Index documents in Elasticsearch with tenant isolation
            tenant_index_name = tenant_collection_name
            es_docs = [
                {
                    "text": chunk,
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "document_name": filename,
                    "knowledge_base": kb_name,
                }
                for chunk in chunks
            ]
            # Index in Elasticsearch if available; otherwise continue without failing
            try:
                if es_service is not None:
                    await es_service.bulk_index_documents(
                        index_name=tenant_index_name, documents=es_docs
                    )
                else:
                    logger.warning("Elasticsearch service not available; skipping ES indexing for document chunks")
            except Exception as es_err:
                # Log but do not fail the whole pipeline after vectors are stored
                logger.error(f"Elasticsearch indexing failed: {es_err}")
            else:
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="keyword_index",
                    percentage=95,
                    message="Keyword index updated",
                )

            # Update status to COMPLETED (use actual inserted vector count)
            try:
                self._update_document_status(
                    db,
                    document_record.id,
                    DocumentStatus.COMPLETED,
                    total_chunks=len(vector_ids) if isinstance(vector_ids, list) else 0,
                    vector_ids=vector_ids,
                )
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="completed",
                    percentage=100,
                    message="Processing completed",
                )
            except Exception as db_err:
                # Attempt rollback and mark failed with reason
                logger.error(f"Failed to finalize document status: {db_err}")
                try:
                    db.rollback()
                except Exception:
                    pass
                error_msg = f"Finalize status failed: {db_err}"
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="failed",
                    percentage=95,
                    message=error_msg,
                )
            
            logger.info(f"Successfully processed and indexed document {filename}")

        except Exception as e:
            error_msg = f"Error processing document {filename}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            
            if document_record:
                try:
                    db.rollback()
                except Exception:
                    pass
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
                self._update_document_progress(
                    db,
                    document_record.id,
                    stage="failed",
                    percentage=0,
                    message=error_msg,
                )
        finally:
            db.close()

    async def reprocess_document(
        self,
        document_id: int,
        tenant_id: int,
        user_id: int,
        chunking_strategy: ChunkingStrategy = ChunkingStrategy.RECURSIVE,
        chunking_params: dict | None = None,
    ) -> None:
        """Retry processing for an existing document row (no re-upload)."""
        await self._rebuild_document(
            document_id=document_id,
            tenant_id=tenant_id,
            user_id=user_id,
            chunking_strategy=chunking_strategy,
            chunking_params=chunking_params,
            require_failed=True,
        )

    async def reindex_document(
        self,
        document_id: int,
        tenant_id: int,
        user_id: int,
        chunking_strategy: ChunkingStrategy = ChunkingStrategy.RECURSIVE,
        chunking_params: dict | None = None,
    ) -> None:
        """Reindex an existing document (recompute chunks/vectors)."""
        await self._rebuild_document(
            document_id=document_id,
            tenant_id=tenant_id,
            user_id=user_id,
            chunking_strategy=chunking_strategy,
            chunking_params=chunking_params,
            require_failed=False,
        )

    async def _rebuild_document(
        self,
        *,
        document_id: int,
        tenant_id: int,
        user_id: int,
        chunking_strategy: ChunkingStrategy,
        chunking_params: dict | None,
        require_failed: bool,
    ) -> None:
        db = SessionLocal()
        try:
            document = (
                db.query(Document)
                .filter(Document.id == document_id, Document.tenant_id == tenant_id)
                .first()
            )
            if document is None:
                raise ValueError("Document not found")
            if require_failed and document.status != DocumentStatus.FAILED.value:
                raise ValueError("Only failed documents can be retried")
            if not require_failed and document.status == DocumentStatus.PROCESSING.value:
                raise ValueError("Document is currently processing")
            if not document.file_path or not storage_service.exists(document.file_path):
                raise ValueError("Document file not found in storage")

            old_total_chunks = int(document.total_chunks or 0)
            kb_name = document.knowledge_base_name
            tenant_collection_name = resolve_kb_collection_name(
                db,
                tenant_id,
                kb_name=kb_name,
                kb_id=document.knowledge_base_id,
            )

            # best-effort cleanup previous artifacts
            try:
                from app.services.milvus_service import milvus_service

                ids = []
                if document.vector_ids:
                    try:
                        ids = [int(i) for i in (document.vector_ids or [])]
                    except Exception:
                        ids = []
                if ids:
                    await milvus_service.async_delete_vectors(tenant_collection_name, ids)
                else:
                    await milvus_service.async_delete_by_filters(
                        tenant_collection_name,
                        {
                            "tenant_id": tenant_id,
                            "document_name": document.filename,
                            "knowledge_base": kb_name,
                        },
                    )
            except Exception as e:
                logger.warning(f"Rebuild cleanup milvus failed: {e}")

            try:
                from app.services.elasticsearch_service import get_elasticsearch_service

                es_service = await get_elasticsearch_service()
                if es_service is not None:
                    tenant_index_name = tenant_collection_name
                    await es_service.delete_by_query(
                        index_name=tenant_index_name,
                        term_filters={
                            "tenant_id": tenant_id,
                            "document_name": document.filename,
                            "knowledge_base": kb_name,
                        },
                    )
            except Exception as e:
                logger.warning(f"Rebuild cleanup elasticsearch failed: {e}")

            try:
                db.query(DocumentChunk).filter(
                    DocumentChunk.document_id == document.id,
                    DocumentChunk.tenant_id == tenant_id,
                ).delete(synchronize_session=False)
                db.commit()
            except Exception as e:
                db.rollback()
                logger.warning(f"Rebuild cleanup document_chunks failed: {e}")

            # reset doc status/fields
            document.status = DocumentStatus.PROCESSING.value
            document.error_message = None
            document.total_chunks = 0
            document.vector_ids = []
            document.processed_at = None
            try:
                meta = dict(document.doc_metadata or {})
                meta["chunking_strategy"] = getattr(chunking_strategy, "value", str(chunking_strategy))
                meta["chunking_params"] = chunking_params or {}
                document.doc_metadata = meta
            except Exception:
                pass
            db.add(document)
            db.commit()
            self._update_document_progress(
                db,
                document.id,
                stage="processing",
                percentage=5,
                message="Rebuild started" if not require_failed else "Retry started",
            )

            if chunking_params is None:
                chunking_params = {}

            content = storage_service.read_bytes(document.file_path)

            # Parse content
            document_text = parser_service.parse_document(content, document.filename)
            if not document_text:
                raise Exception(f"Failed to parse text from {document.filename}")

            chunks = await chunking_service.chunk_document(
                text=document_text, strategy=chunking_strategy, **chunking_params
            )
            self._update_document_progress(
                db,
                document.id,
                stage="chunking",
                percentage=30,
                message="Chunking completed",
                extra={"chunks": len(chunks)},
            )

            embedding_response = await llm_service.get_embeddings(
                texts=chunks, tenant_id=tenant_id, user_id=user_id
            )
            if not embedding_response.get("success"):
                details = embedding_response.get("details")
                error_msg = f"Embedding generation failed: {embedding_response.get('error')}"
                if details:
                    error_msg = f"{error_msg}; details: {details}"
                document.status = DocumentStatus.FAILED.value
                document.error_message = error_msg
                db.add(document)
                db.commit()
                self._update_document_progress(
                    db,
                    document.id,
                    stage="failed",
                    percentage=30,
                    message=error_msg,
                )
                return

            adjusted_inputs = embedding_response.get("input_texts")
            if isinstance(adjusted_inputs, list) and adjusted_inputs:
                chunks = [str(x) for x in adjusted_inputs]

            embeddings = embedding_response.get("embeddings", [])
            if len(embeddings) != len(chunks):
                error_msg = f"Number of embeddings ({len(embeddings)}) does not match chunks ({len(chunks)})"
                document.status = DocumentStatus.FAILED.value
                document.error_message = error_msg
                db.add(document)
                db.commit()
                self._update_document_progress(
                    db,
                    document.id,
                    stage="failed",
                    percentage=60,
                    message=error_msg,
                )
                return
            self._update_document_progress(
                db,
                document.id,
                stage="embedding",
                percentage=60,
                message="Embeddings generated",
                extra={"chunks": len(chunks), "vectors": len(embeddings)},
            )

            entities = [
                {
                    "text": chunk,
                    "vector": vector,
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "document_name": document.filename,
                    "knowledge_base": kb_name,
                }
                for chunk, vector in zip(chunks, embeddings)
            ]

            vector_ids = await milvus_service.async_insert(
                collection_name=tenant_collection_name, entities=entities
            )
            self._update_document_progress(
                db,
                document.id,
                stage="vector_index",
                percentage=80,
                message="Vectors stored",
                extra={"vector_ids": len(vector_ids) if isinstance(vector_ids, list) else 0},
            )

            # Persist chunks (best-effort)
            try:
                DocumentChunk.__table__.create(bind=db.get_bind(), checkfirst=True)  # type: ignore[attr-defined]
                rows: list[DocumentChunk] = []
                if isinstance(vector_ids, list) and len(vector_ids) == len(chunks):
                    for i, (txt, pk) in enumerate(zip(chunks, vector_ids)):
                        rows.append(
                            DocumentChunk(
                                tenant_id=tenant_id,
                                document_id=document.id,
                                knowledge_base_name=kb_name,
                                chunk_index=int(i),
                                text=str(txt or ""),
                                milvus_pk=int(pk) if pk is not None else None,
                            )
                        )
                else:
                    for i, txt in enumerate(chunks):
                        rows.append(
                            DocumentChunk(
                                tenant_id=tenant_id,
                                document_id=document.id,
                                knowledge_base_name=kb_name,
                                chunk_index=int(i),
                                text=str(txt or ""),
                                milvus_pk=None,
                            )
                        )
                if rows:
                    db.bulk_save_objects(rows)
                    db.commit()
            except Exception as e:
                db.rollback()
                logger.warning(f"Rebuild persist document_chunks failed: {e}")
            else:
                self._update_document_progress(
                    db,
                    document.id,
                    stage="persist_chunks",
                    percentage=88,
                    message="Chunk texts persisted",
                )

            # Update final fields
            document.status = DocumentStatus.COMPLETED.value
            document.error_message = None
            document.vector_ids = vector_ids if isinstance(vector_ids, list) else []
            document.total_chunks = len(document.vector_ids or [])
            document.processed_at = datetime.utcnow()
            db.add(document)
            db.commit()
            self._update_document_progress(
                db,
                document.id,
                stage="completed",
                percentage=100,
                message="Processing completed",
            )

            # Best-effort update KB totals (adjust by delta)
            try:
                kb = (
                    db.query(KBModel)
                    .filter(KBModel.id == document.knowledge_base_id, KBModel.tenant_id == tenant_id)
                    .first()
                )
                if kb is not None:
                    new_total_chunks = int(document.total_chunks or 0)
                    delta = new_total_chunks - old_total_chunks
                    kb.total_chunks = max(0, int(kb.total_chunks or 0) + delta)
                    db.add(kb)
                    db.commit()
            except Exception as e:
                db.rollback()
                logger.warning(f"Rebuild update KB totals failed: {e}")
        except Exception as e:
            try:
                db.rollback()
            except Exception:
                pass
            try:
                document = (
                    db.query(Document)
                    .filter(Document.id == document_id, Document.tenant_id == tenant_id)
                    .first()
                )
                if document is not None:
                    prefix = "Retry failed" if require_failed else "Reindex failed"
                    document.status = DocumentStatus.FAILED.value
                    document.error_message = f"{prefix}: {e}"
                    db.add(document)
                    db.commit()
                    self._update_document_progress(
                        db,
                        document.id,
                        stage="failed",
                        percentage=0,
                        message=str(e),
                    )
            except Exception:
                pass
            logger.error(f"Rebuild processing failed for document {document_id}: {e}", exc_info=True)
        finally:
            db.close()


# Singleton instance of the service
document_service = DocumentService()
