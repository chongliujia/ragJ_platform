"""
Celery tasks for document processing.
"""

import os
from typing import Optional, Dict, Any
from app.celery_app import celery_app
from app.services.document_service import document_service
from app.services.chunking_service import ChunkingStrategy


@celery_app.task(name="process_document_task")
def process_document_task(
    file_path: str,
    filename: str,
    kb_name: str,
    tenant_id: int,
    user_id: int,
    chunking_strategy: str = ChunkingStrategy.RECURSIVE.value,
    chunking_params: Optional[Dict[str, Any]] = None,
):
    """Process a document from a saved file path (worker context)."""
    if not os.path.exists(file_path):
        return {"success": False, "error": f"File not found: {file_path}"}

    # Read file content in worker (kept simple; can be optimized)
    with open(file_path, "rb") as f:
        content = f.read()

    # Dispatch to async service via loop run
    import asyncio

    async def _run():
        try:
            await document_service.process_document(
                content=content,
                filename=filename,
                kb_name=kb_name,
                tenant_id=tenant_id,
                user_id=user_id,
                chunking_strategy=ChunkingStrategy(chunking_strategy),
                chunking_params=chunking_params or {},
                file_system_path=file_path,
            )
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return asyncio.run(_run())
