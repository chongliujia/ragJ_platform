"""
This service handles the entire document processing pipeline, from ingestion
to chunking, embedding, and indexing.
"""

import logging
from datetime import datetime
from typing import Optional
import os
from sqlalchemy.orm import Session
from fastapi import UploadFile

from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import get_elasticsearch_service
from app.services.chunking_service import chunking_service, ChunkingStrategy
from app.services import parser_service
from app.core.config import settings
from app.db.database import SessionLocal
from app.db.models.document import Document, DocumentStatus

logger = logging.getLogger(__name__)


class DocumentService:
    """
    Orchestrates the document processing workflow.
    """
    
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
        title: Optional[str] = None
    ) -> Document:
        """Create and save document record to database."""
        document = Document(
            filename=filename,
            original_filename=filename,
            file_type=file_type,
            file_size=file_size,
            file_path=file_path,
            knowledge_base_name=kb_name,
            tenant_id=tenant_id,
            uploaded_by=user_id,
            status=DocumentStatus.PENDING.value,
            title=title,
            content_preview=content_preview,
            total_chunks=0,
            vector_ids=[]
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
            db.commit()

    async def process_document(
        self,
        content: bytes,
        filename: str,
        kb_name: str,
        tenant_id: int,
        user_id: int,
        chunking_strategy: ChunkingStrategy = ChunkingStrategy.RECURSIVE,
        chunking_params: dict = None,
    ):
        """
        Process an uploaded document with proper status tracking.
        """
        db = SessionLocal()
        document_record = None
        es_service = None
        
        try:
            # Save initial document record
            file_type = filename.split('.')[-1].lower() if '.' in filename else 'unknown'
            file_size = len(content)
            
            # Create temporary file path (in production, save to proper storage)
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
                title=title
            )
            
            # Update status to PROCESSING
            self._update_document_status(db, document_record.id, DocumentStatus.PROCESSING)
            
            es_service = await get_elasticsearch_service()
            
            # Split document into chunks using specified strategy
            if chunking_params is None:
                chunking_params = {}

            chunks = await chunking_service.chunk_document(
                text=document_text, strategy=chunking_strategy, **chunking_params
            )

            # Get embeddings for chunks
            embedding_response = await llm_service.get_embeddings(texts=chunks)

            if not embedding_response.get("success"):
                error_msg = f"Embedding generation failed: {embedding_response.get('error')}"
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
                logger.error(error_msg)
                return

            embeddings = embedding_response.get("embeddings", [])

            if len(embeddings) != len(chunks):
                error_msg = f"Number of embeddings ({len(embeddings)}) does not match chunks ({len(chunks)})"
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
                logger.error(error_msg)
                return

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
            tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"

            # Insert into Milvus (synchronous call)
            vector_ids = milvus_service.insert(
                collection_name=tenant_collection_name, entities=entities
            )

            # Index documents in Elasticsearch with tenant isolation
            tenant_index_name = f"tenant_{tenant_id}_{kb_name}"
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
            await es_service.bulk_index_documents(
                index_name=tenant_index_name, documents=es_docs
            )

            # Update status to COMPLETED
            self._update_document_status(
                db, 
                document_record.id, 
                DocumentStatus.COMPLETED,
                total_chunks=len(chunks),
                vector_ids=vector_ids
            )
            
            logger.info(f"Successfully processed and indexed document {filename}")

        except Exception as e:
            error_msg = f"Error processing document {filename}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            
            if document_record:
                self._update_document_status(db, document_record.id, DocumentStatus.FAILED, error_msg)
        finally:
            db.close()


# Singleton instance of the service
document_service = DocumentService()
