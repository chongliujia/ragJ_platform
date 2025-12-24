import ast
import json
import logging
from typing import Optional

from sqlalchemy import func

from app.db.database import SessionLocal
from app.db.models.document import Document
from app.db.models.document_chunk import DocumentChunk
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.services.milvus_service import milvus_service

logger = logging.getLogger(__name__)


def _normalize_vector_ids(value) -> list[int]:
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
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return _normalize_vector_ids(parsed)
        except Exception:
            pass
        try:
            parsed = ast.literal_eval(raw)
            if isinstance(parsed, list):
                return _normalize_vector_ids(parsed)
        except Exception:
            pass
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


async def _fetch_chunks_from_milvus(
    collection_name: str,
    vector_ids: list[int],
    tenant_id: int,
    filename: str,
    kb_name: str,
) -> list[dict]:
    if vector_ids:
        rows = await milvus_service.async_get_texts_by_ids(collection_name, vector_ids)
        if rows:
            text_by_id = {
                int(r.get("id", 0)): str(r.get("text", "") or "") for r in rows
            }
            ordered = [{"id": int(i), "text": text_by_id.get(int(i), "")} for i in vector_ids]
            if any(r.get("text") for r in ordered):
                return ordered
    rows = await milvus_service.async_query_texts_by_filters(
        collection_name,
        {"tenant_id": tenant_id, "document_name": filename, "knowledge_base": kb_name},
        limit=16384,
    )
    return rows or []


def _iter_documents(
    db,
    tenant_id: Optional[int],
    kb_name: Optional[str],
    document_id: Optional[int],
) -> list[Document]:
    q = db.query(Document)
    if document_id is not None:
        q = q.filter(Document.id == document_id)
    if tenant_id is not None:
        q = q.filter(Document.tenant_id == tenant_id)
    if kb_name:
        q = q.filter(Document.knowledge_base_name == kb_name)
    return q.order_by(Document.id.asc()).all()


async def run_backfill(
    tenant_id: Optional[int] = None,
    kb_name: Optional[str] = None,
    document_id: Optional[int] = None,
    force: bool = False,
    dry_run: bool = False,
    recompute_kb_totals: bool = False,
) -> int:
    if not milvus_service.ensure_connected():
        logger.warning("Backfill: Milvus not available, skipping.")
        return 0
    db = SessionLocal()
    updated = 0
    try:
        if not dry_run:
            DocumentChunk.__table__.create(bind=db.get_bind(), checkfirst=True)  # type: ignore[attr-defined]

        docs = _iter_documents(db, tenant_id, kb_name, document_id)
        if not docs:
            logger.info("Backfill: no documents matched the filters.")
            return 0

        kb_cache: dict[tuple[int, str], KBModel] = {}
        for doc in docs:
            key = (doc.tenant_id, doc.knowledge_base_name)
            if key not in kb_cache:
                kb_row = (
                    db.query(KBModel)
                    .filter(
                        KBModel.tenant_id == doc.tenant_id,
                        KBModel.name == doc.knowledge_base_name,
                    )
                    .first()
                )
                if kb_row is None:
                    logger.warning(
                        "Backfill: skip doc %s, KB not found (%s).",
                        doc.id,
                        doc.knowledge_base_name,
                    )
                    continue
                kb_cache[key] = kb_row

            kb_row = kb_cache[key]
            collection_name = (
                kb_row.milvus_collection_name or f"tenant_{doc.tenant_id}_{doc.knowledge_base_name}"
            )

            existing_count = (
                db.query(func.count(DocumentChunk.id))
                .filter(
                    DocumentChunk.document_id == doc.id,
                    DocumentChunk.tenant_id == doc.tenant_id,
                )
                .scalar()
                or 0
            )
            if existing_count > 0 and not force:
                logger.info(
                    "Backfill: skip doc %s, %s chunks already persisted.",
                    doc.id,
                    existing_count,
                )
                continue

            vector_ids = _normalize_vector_ids(doc.vector_ids)
            rows = await _fetch_chunks_from_milvus(
                collection_name, vector_ids, doc.tenant_id, doc.filename, doc.knowledge_base_name
            )
            if not rows or not any(str(r.get("text", "") or "") for r in rows):
                logger.info("Backfill: skip doc %s, no chunk text found in Milvus.", doc.id)
                continue

            if dry_run:
                logger.info(
                    "Backfill: [dry-run] doc %s would persist %s chunks.",
                    doc.id,
                    len(rows),
                )
                continue

            try:
                if force and existing_count > 0:
                    db.query(DocumentChunk).filter(
                        DocumentChunk.document_id == doc.id,
                        DocumentChunk.tenant_id == doc.tenant_id,
                    ).delete(synchronize_session=False)
                    db.commit()

                chunk_rows = []
                for i, row in enumerate(rows):
                    chunk_rows.append(
                        DocumentChunk(
                            tenant_id=doc.tenant_id,
                            document_id=doc.id,
                            knowledge_base_name=doc.knowledge_base_name,
                            chunk_index=int(i),
                            text=str(row.get("text", "") or ""),
                            milvus_pk=int(row.get("id", 0)) if row.get("id") is not None else None,
                        )
                    )
                db.bulk_save_objects(chunk_rows)
                doc.total_chunks = len(chunk_rows)
                db.add(doc)
                db.commit()
                updated += 1
                logger.info("Backfill: doc %s persisted %s chunks.", doc.id, len(chunk_rows))
            except Exception as e:
                db.rollback()
                logger.warning("Backfill: doc %s failed to persist chunks: %s", doc.id, e)

        if recompute_kb_totals and not dry_run:
            affected_keys = {(d.tenant_id, d.knowledge_base_name) for d in docs}
            for t_id, name in affected_keys:
                total = (
                    db.query(func.coalesce(func.sum(Document.total_chunks), 0))
                    .filter(Document.tenant_id == t_id, Document.knowledge_base_name == name)
                    .scalar()
                    or 0
                )
                kb_row = (
                    db.query(KBModel)
                    .filter(KBModel.tenant_id == t_id, KBModel.name == name)
                    .first()
                )
                if kb_row:
                    kb_row.total_chunks = int(total)
                    db.add(kb_row)
            db.commit()
            logger.info("Backfill: recomputed KB total_chunks.")
    finally:
        db.close()
    return updated
