"""
This service handles the entire document processing pipeline, from ingestion
to chunking, embedding, and indexing.
"""
import logging
from fastapi import UploadFile
from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import get_elasticsearch_service
from app.services import parser_service
from app.core.config import settings
from langchain.text_splitter import RecursiveCharacterTextSplitter
import os

logger = logging.getLogger(__name__)

class DocumentService:
    """
    Orchestrates the document processing workflow.
    """
    async def process_document(self, content: bytes, filename: str, kb_name: str):
        """
        Process an uploaded document.
        """
        es_service = None
        try:
            es_service = await get_elasticsearch_service()
            # 1. Get file extension and select parser
            _, extension = os.path.splitext(filename)
            extension = extension.lower()

            parser = None
            if extension == ".pdf":
                parser = parser_service.parse_pdf
            elif extension == ".docx":
                parser = parser_service.parse_docx
            elif extension == ".txt":
                parser = parser_service.parse_txt
            else:
                logger.error(f"Unsupported file type: {extension} for file {filename}")
                return

            # 2. Parse content to text
            document_text = parser(content)
            if not document_text:
                logger.error(f"Failed to parse text from {filename}")
                return

            # 3. Split document into chunks
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200,
                length_function=len,
                is_separator_regex=False,
            )
            chunks = text_splitter.split_text(document_text)

            # 4. Get embeddings for chunks
            embedding_response = await llm_service.get_embeddings(texts=chunks)

            if not embedding_response.get("success"):
                logger.error(
                    "Embedding generation failed for document %s: %s",
                    filename,
                    embedding_response.get("error"),
                )
                return

            embeddings = embedding_response.get("embeddings", [])

            if len(embeddings) != len(chunks):
                logger.error(
                    "Number of embeddings (%d) does not match chunks (%d) for document %s",
                    len(embeddings),
                    len(chunks),
                    filename,
                )
                return

            # 5. Prepare entities for Milvus insertion
            entities = [
                {"text": chunk, "vector": vector}
                for chunk, vector in zip(chunks, embeddings)
            ]

            # 6. Insert into Milvus (synchronous call)
            milvus_service.insert(collection_name=kb_name, entities=entities)

            # 7. Index documents in Elasticsearch
            es_docs = [{"text": chunk} for chunk in chunks]
            await es_service.bulk_index_documents(index_name=kb_name, documents=es_docs)

            logger.info(f"Successfully processed and indexed document {filename}")

        except Exception as e:
            logger.error(f"Error processing document {filename}: {e}", exc_info=True)
            # We should not re-raise here as it will crash the background task worker
        finally:
            # The global ES service is managed by the app's lifespan,
            # but if we create one just for this task, it should be closed.
            # However, our get_instance is a singleton, so we don't close it here
            # to avoid affecting other running tasks. The app's lifespan shutdown will handle it.
            pass

# Singleton instance of the service
document_service = DocumentService() 