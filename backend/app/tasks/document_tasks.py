"""
Celery tasks for document processing.
"""

from typing import Optional, Dict, Any
from app.celery_app import celery_app
from app.services.document_service import document_service
from app.services.chunking_service import ChunkingStrategy
from app.services.storage_service import storage_service


@celery_app.task(name="process_document_task")
def process_document_task(
    file_path: str,
    filename: str,
    kb_name: str,
    tenant_id: int,
    user_id: int,
    chunking_strategy: str = ChunkingStrategy.RECURSIVE.value,
    chunking_params: Optional[Dict[str, Any]] = None,
    doc_metadata: Optional[Dict[str, Any]] = None,
    original_filename: Optional[str] = None,
):
    """Process a document from a saved file path (worker context)."""
    if not storage_service.exists(file_path):
        return {"success": False, "error": f"File not found: {file_path}"}

    # Dispatch to async service via loop run
    import asyncio

    async def _run():
        try:
            await document_service.process_document(
                content=None,
                filename=filename,
                kb_name=kb_name,
                tenant_id=tenant_id,
                user_id=user_id,
                chunking_strategy=ChunkingStrategy(chunking_strategy),
                chunking_params=chunking_params or {},
                file_system_path=file_path,
                doc_metadata=doc_metadata,
                original_filename=original_filename,
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return asyncio.run(_run())
