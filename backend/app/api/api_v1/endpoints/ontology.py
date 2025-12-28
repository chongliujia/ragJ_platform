"""
Ontology draft endpoints (KB-scoped).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
import json
import uuid

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.dependencies import get_tenant_id, require_permission
from app.db.database import SessionLocal, get_db
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.db.models.document import Document
from app.db.models.document_chunk import DocumentChunk
from app.db.models.permission import PermissionType
from app.db.models.user import User, UserConfig
from app.db.models.ontology import OntologyVersion, OntologyItem
from app.services.llm_service import llm_service

router = APIRouter()
logger = structlog.get_logger(__name__)

ONTOLOGY_DRAFT_DEFAULT_MAX_CHUNKS = 6
ONTOLOGY_DRAFT_DEFAULT_MAX_TEXT_CHARS = 1200
ONTOLOGY_DRAFT_MIN_CONFIDENCE = 0.7
ONTOLOGY_DRAFT_AUTO_APPROVE_CONFIDENCE = 0.88
ONTOLOGY_DRAFT_AUTO_APPROVE_MIN_DOCS = 2
ONTOLOGY_DRAFT_MAX_ITEMS_PER_DOC = 16


class OntologyDraftRequest(BaseModel):
    run_async: Optional[bool] = True
    max_chunks: Optional[int] = None
    max_text_chars: Optional[int] = None
    min_confidence: Optional[float] = None
    auto_approve_confidence: Optional[float] = None
    auto_approve_min_docs: Optional[int] = None


class OntologyDraftResponse(BaseModel):
    version_id: int
    status: str


class OntologyDraftStatusResponse(BaseModel):
    status: Literal["idle", "running", "completed", "failed"]
    current: int
    total: int
    version_id: Optional[int] = None
    run_id: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    message: Optional[str] = None


class OntologyVersionResponse(BaseModel):
    id: int
    name: str
    status: str
    source: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)
    stats: Dict[str, Any] = Field(default_factory=dict)


class OntologyItemResponse(BaseModel):
    id: int
    kind: str
    name: str
    description: Optional[str] = None
    aliases: List[str] = Field(default_factory=list)
    constraints: Dict[str, Any] = Field(default_factory=dict)
    confidence: float
    evidence: List[Dict[str, Any]] = Field(default_factory=list)
    status: str
    meta: Dict[str, Any] = Field(default_factory=dict)


class OntologyItemStatusUpdate(BaseModel):
    ids: List[int]
    status: Literal["pending", "approved", "rejected"]


class OntologyItemUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    aliases: Optional[List[str]] = None
    constraints: Optional[Dict[str, Any]] = None
    status: Optional[Literal["pending", "approved", "rejected"]] = None
    meta: Optional[Dict[str, Any]] = None


class OntologyItemCreateRequest(BaseModel):
    kind: Literal["entity_type", "relation_type", "attribute_type", "structure_type"]
    name: str
    description: Optional[str] = None
    aliases: Optional[List[str]] = None
    constraints: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    status: Optional[Literal["pending", "approved", "rejected"]] = None


class OntologyPublishRequest(BaseModel):
    version_id: Optional[int] = None
    name: Optional[str] = None


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _truncate_text(text: str, max_chars: int) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars].strip()


def _normalize(value: str) -> str:
    return (value or "").strip().lower()


def _get_kb(db: Session, tenant_id: int, kb_name: str) -> KBModel:
    kb = (
        db.query(KBModel)
        .filter(KBModel.tenant_id == tenant_id, KBModel.name == kb_name, KBModel.is_active == True)
        .first()
    )
    if not kb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found")
    return kb


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


def _get_ontology_progress(kb_row: KBModel) -> Dict[str, Any]:
    raw = kb_row.settings or {}
    progress = raw.get("ontology_draft_progress") if isinstance(raw, dict) else None
    if isinstance(progress, dict):
        return progress
    return {}


def _set_ontology_progress(db: Session, kb_row: KBModel, payload: Dict[str, Any]) -> None:
    raw = dict(kb_row.settings or {})
    raw["ontology_draft_progress"] = payload
    kb_row.settings = raw
    db.commit()


def _build_ontology_prompt(text: str) -> str:
    schema = (
        '{"entity_types":[{"name":"","description":"","aliases":[],"constraints":{},'
        '"confidence":0.0}],'
        '"relation_types":[{"name":"","description":"","source_types":[],"target_types":[],'
        '"constraints":{},"confidence":0.0}],'
        '"attribute_types":[{"name":"","description":"","entity_types":[],"value_type":"",'
        '"constraints":{},"confidence":0.0}]}'
    )
    instructions = [
        "Extract a high-precision ontology draft from the text.",
        "- Focus on stable domain concepts; avoid filenames, URLs, DOI/ISBN, parameters, or code identifiers.",
        "- Use concise canonical names for types and relations.",
        "- Provide short descriptions when possible.",
        "- Only include items explicitly supported by the text.",
        "- If unsure, lower confidence or omit.",
        f"Return ONLY valid JSON using this schema: {schema}",
    ]
    return f"{chr(10).join(instructions)}\n\nText:\n{text}"


def _extract_json_payload(text: str) -> Optional[Dict[str, Any]]:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        candidate = raw[start : end + 1]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _coerce_float(value: Optional[float], default: float, min_value: float, max_value: float) -> float:
    try:
        if value is None:
            return default
        parsed = float(value)
    except Exception:
        return default
    return max(min_value, min(max_value, parsed))


def _coerce_int(value: Optional[int], default: int, min_value: int, max_value: int) -> int:
    try:
        if value is None:
            return default
        parsed = int(value)
    except Exception:
        return default
    return max(min_value, min(max_value, parsed))


def _latest_draft_version(db: Session, kb_id: int, tenant_id: int) -> Optional[OntologyVersion]:
    return (
        db.query(OntologyVersion)
        .filter(
            OntologyVersion.tenant_id == tenant_id,
            OntologyVersion.knowledge_base_id == kb_id,
            OntologyVersion.status == "draft",
        )
        .order_by(OntologyVersion.id.desc())
        .first()
    )


def _build_version_stats(db: Session, tenant_id: int, kb_id: int) -> Dict[int, Dict[str, Any]]:
    rows = (
        db.query(
            OntologyItem.version_id,
            OntologyItem.status,
            OntologyItem.kind,
            func.count(OntologyItem.id),
        )
        .filter(
            OntologyItem.tenant_id == tenant_id,
            OntologyItem.knowledge_base_id == kb_id,
        )
        .group_by(OntologyItem.version_id, OntologyItem.status, OntologyItem.kind)
        .all()
    )
    stats: Dict[int, Dict[str, Any]] = {}
    for version_id, status_value, kind, count in rows:
        version_stats = stats.setdefault(
            int(version_id),
            {
                "total": 0,
                "by_status": {"pending": 0, "approved": 0, "rejected": 0},
                "by_kind": {
                    "entity_type": 0,
                    "relation_type": 0,
                    "attribute_type": 0,
                    "structure_type": 0,
                },
            },
        )
        version_stats["total"] += int(count or 0)
        if status_value in version_stats["by_status"]:
            version_stats["by_status"][status_value] += int(count or 0)
        if kind in version_stats["by_kind"]:
            version_stats["by_kind"][kind] += int(count or 0)
    return stats


async def _generate_ontology_draft(
    *,
    db: Session,
    tenant_id: int,
    kb: KBModel,
    current_user: User,
    version: OntologyVersion,
    max_chunks: int,
    max_text_chars: int,
    min_confidence: float,
    auto_approve_confidence: float,
    auto_approve_min_docs: int,
) -> None:
    docs = (
        db.query(Document)
        .filter(Document.tenant_id == tenant_id, Document.knowledge_base_name == kb.name)
        .order_by(Document.created_at.asc())
        .all()
    )
    total_docs = len(docs)
    progress_payload = {
        "status": "running",
        "current": 0,
        "total": total_docs,
        "version_id": version.id,
        "run_id": uuid.uuid4().hex,
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "message": None,
    }
    _set_ontology_progress(db, kb, progress_payload)

    model_name = None
    try:
        cfg = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).first()
        if cfg:
            model_name = cfg.preferred_extraction_model or cfg.preferred_chat_model
        if isinstance(model_name, str):
            model_name = model_name.strip() or None
    except Exception as exc:
        logger.warning("Failed to load user extraction model for ontology", error=str(exc))

    aggregated: Dict[str, Dict[str, Any]] = {}

    def merge_item(kind: str, item: Dict[str, Any], doc: Document, snippet: str) -> None:
        name = str(item.get("name") or "").strip()
        if not name:
            return
        key = f"{kind}:{_normalize(name)}"
        entry = aggregated.get(key)
        if not entry:
            entry = {
                "kind": kind,
                "name": name,
                "description": str(item.get("description") or "").strip() or None,
                "aliases": set(),
                "constraints": item.get("constraints") if isinstance(item.get("constraints"), dict) else {},
                "meta": {},
                "confidence_sum": 0.0,
                "count": 0,
                "doc_ids": set(),
                "evidence": [],
            }
            aggregated[key] = entry
        aliases = item.get("aliases")
        if isinstance(aliases, list):
            for alias in aliases:
                alias_value = str(alias or "").strip()
                if alias_value:
                    entry["aliases"].add(alias_value)
        confidence = _coerce_float(item.get("confidence"), 0.6, 0.0, 1.0)
        entry["confidence_sum"] += confidence
        entry["count"] += 1
        entry["doc_ids"].add(doc.id)
        if snippet and len(entry["evidence"]) < 4:
            entry["evidence"].append(
                {
                    "document_id": doc.id,
                    "source": doc.original_filename or doc.filename or f"doc-{doc.id}",
                    "snippet": snippet,
                }
            )

        if kind == "relation_type":
            sources = item.get("source_types")
            targets = item.get("target_types")
            meta = entry["meta"]
            if isinstance(sources, list):
                meta.setdefault("source_types", set()).update(
                    [str(s).strip() for s in sources if str(s).strip()]
                )
            if isinstance(targets, list):
                meta.setdefault("target_types", set()).update(
                    [str(t).strip() for t in targets if str(t).strip()]
                )
        if kind == "attribute_type":
            entity_types = item.get("entity_types")
            value_type = str(item.get("value_type") or "").strip()
            meta = entry["meta"]
            if value_type:
                meta["value_type"] = value_type
            if isinstance(entity_types, list):
                meta.setdefault("entity_types", set()).update(
                    [str(e).strip() for e in entity_types if str(e).strip()]
                )

    try:
        for index, doc in enumerate(docs, start=1):
            chunks = (
                db.query(DocumentChunk)
                .filter(DocumentChunk.document_id == doc.id, DocumentChunk.tenant_id == tenant_id)
                .order_by(DocumentChunk.chunk_index.asc())
                .limit(max_chunks)
                .all()
            )
            texts: List[str] = []
            if chunks:
                for chunk in chunks:
                    text = _truncate_text(chunk.text, max_text_chars)
                    if text:
                        texts.append(text)
            if not texts:
                preview = _truncate_text(
                    doc.content_preview or doc.title or doc.original_filename or doc.filename,
                    max_text_chars,
                )
                if preview:
                    texts.append(preview)
            if not texts:
                progress_payload["current"] = index
                progress_payload["updated_at"] = _now_iso()
                _set_ontology_progress(db, kb, progress_payload)
                continue

            joined = "\n\n".join(texts)
            prompt = _build_ontology_prompt(joined)
            try:
                llm_response = await llm_service.chat(
                    message=prompt,
                    model=model_name,
                    temperature=0.2,
                    max_tokens=900,
                    tenant_id=tenant_id,
                    user_id=current_user.id,
                )
            except Exception as exc:
                logger.warning("Ontology draft LLM call failed", error=str(exc))
                progress_payload["current"] = index
                progress_payload["updated_at"] = _now_iso()
                _set_ontology_progress(db, kb, progress_payload)
                continue

            if not llm_response.get("success"):
                progress_payload["current"] = index
                progress_payload["updated_at"] = _now_iso()
                _set_ontology_progress(db, kb, progress_payload)
                continue

            payload = _extract_json_payload(llm_response.get("message") or "")
            if isinstance(payload, dict):
                snippet = texts[0][:160]
                entities = payload.get("entity_types") or []
                relations = payload.get("relation_types") or []
                attributes = payload.get("attribute_types") or []
                if isinstance(entities, list):
                    for item in entities[:ONTOLOGY_DRAFT_MAX_ITEMS_PER_DOC]:
                        if isinstance(item, dict):
                            merge_item("entity_type", item, doc, snippet)
                if isinstance(relations, list):
                    for item in relations[:ONTOLOGY_DRAFT_MAX_ITEMS_PER_DOC]:
                        if isinstance(item, dict):
                            merge_item("relation_type", item, doc, snippet)
                if isinstance(attributes, list):
                    for item in attributes[:ONTOLOGY_DRAFT_MAX_ITEMS_PER_DOC]:
                        if isinstance(item, dict):
                            merge_item("attribute_type", item, doc, snippet)

            progress_payload["current"] = index
            progress_payload["updated_at"] = _now_iso()
            _set_ontology_progress(db, kb, progress_payload)

        items: List[OntologyItem] = []
        for entry in aggregated.values():
            count = max(1, int(entry["count"]))
            avg_confidence = min(1.0, entry["confidence_sum"] / count)
            if avg_confidence < min_confidence:
                continue
            doc_hits = len(entry["doc_ids"])
            status_value = "pending"
            if avg_confidence >= auto_approve_confidence and doc_hits >= auto_approve_min_docs:
                status_value = "approved"
            meta = entry.get("meta") or {}
            if meta:
                next_meta = {}
                for key, value in meta.items():
                    if isinstance(value, set):
                        next_meta[key] = sorted(value)
                    else:
                        next_meta[key] = value
                meta = next_meta
            items.append(
                OntologyItem(
                    tenant_id=tenant_id,
                    knowledge_base_id=kb.id,
                    version_id=version.id,
                    kind=entry["kind"],
                    name=entry["name"],
                    description=entry.get("description"),
                    aliases=sorted(entry["aliases"]),
                    constraints=entry.get("constraints") or {},
                    confidence=avg_confidence,
                    evidence=entry.get("evidence") or [],
                    status=status_value,
                    meta=meta,
                )
            )

        if items:
            db.add_all(items)
            db.commit()

        progress_payload["status"] = "completed"
        progress_payload["updated_at"] = _now_iso()
        progress_payload["message"] = None
        _set_ontology_progress(db, kb, progress_payload)
    except Exception as exc:
        progress_payload["status"] = "failed"
        progress_payload["updated_at"] = _now_iso()
        progress_payload["message"] = str(exc)
        _set_ontology_progress(db, kb, progress_payload)
        raise


async def _generate_ontology_draft_background(
    *,
    kb_name: str,
    tenant_id: int,
    user_id: int,
    version_id: int,
    max_chunks: int,
    max_text_chars: int,
    min_confidence: float,
    auto_approve_confidence: float,
    auto_approve_min_docs: int,
) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            logger.warning("Ontology draft background aborted: user missing", user_id=user_id)
            return
        kb = _get_kb(db, tenant_id, kb_name)
        version = db.query(OntologyVersion).filter(OntologyVersion.id == version_id).first()
        if not version:
            logger.warning("Ontology draft background aborted: version missing", version_id=version_id)
            return
        await _generate_ontology_draft(
            db=db,
            tenant_id=tenant_id,
            kb=kb,
            current_user=user,
            version=version,
            max_chunks=max_chunks,
            max_text_chars=max_text_chars,
            min_confidence=min_confidence,
            auto_approve_confidence=auto_approve_confidence,
            auto_approve_min_docs=auto_approve_min_docs,
        )
    except Exception as exc:
        logger.warning("Ontology draft background failed", error=str(exc))
    finally:
        db.close()


@router.get("/draft/status", response_model=OntologyDraftStatusResponse)
def get_ontology_draft_status(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_read_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    progress = _get_ontology_progress(kb)
    if not progress:
        return OntologyDraftStatusResponse(status="idle", current=0, total=0)
    status_value = progress.get("status")
    if status_value not in ("idle", "running", "completed", "failed"):
        status_value = "idle"
    return OntologyDraftStatusResponse(
        status=str(status_value or "idle"),
        current=int(progress.get("current") or 0),
        total=int(progress.get("total") or 0),
        version_id=progress.get("version_id"),
        run_id=progress.get("run_id"),
        started_at=progress.get("started_at"),
        updated_at=progress.get("updated_at"),
        message=progress.get("message"),
    )


@router.get("/versions", response_model=List[OntologyVersionResponse])
def list_ontology_versions(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_read_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    versions = (
        db.query(OntologyVersion)
        .filter(
            OntologyVersion.tenant_id == tenant_id,
            OntologyVersion.knowledge_base_id == kb.id,
        )
        .order_by(OntologyVersion.created_at.desc())
        .all()
    )
    stats_map = _build_version_stats(db, tenant_id, kb.id)
    return [
        OntologyVersionResponse(
            id=version.id,
            name=version.name,
            status=version.status,
            source=version.source,
            created_at=version.created_at.isoformat() if version.created_at else None,
            updated_at=version.updated_at.isoformat() if version.updated_at else None,
            config=version.config or {},
            stats=stats_map.get(version.id, {}),
        )
        for version in versions
    ]


@router.post("/draft", response_model=OntologyDraftResponse)
async def create_ontology_draft(
    request: OntologyDraftRequest,
    kb_name: str,
    background_tasks: BackgroundTasks,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    progress = _get_ontology_progress(kb)
    if progress.get("status") == "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ontology draft already running")

    max_chunks = _coerce_int(
        request.max_chunks,
        ONTOLOGY_DRAFT_DEFAULT_MAX_CHUNKS,
        1,
        30,
    )
    max_text_chars = _coerce_int(
        request.max_text_chars,
        ONTOLOGY_DRAFT_DEFAULT_MAX_TEXT_CHARS,
        200,
        4000,
    )
    min_confidence = _coerce_float(
        request.min_confidence,
        ONTOLOGY_DRAFT_MIN_CONFIDENCE,
        0.4,
        0.99,
    )
    auto_approve_confidence = _coerce_float(
        request.auto_approve_confidence,
        ONTOLOGY_DRAFT_AUTO_APPROVE_CONFIDENCE,
        0.5,
        0.99,
    )
    auto_approve_min_docs = _coerce_int(
        request.auto_approve_min_docs,
        ONTOLOGY_DRAFT_AUTO_APPROVE_MIN_DOCS,
        1,
        10,
    )

    db.query(OntologyVersion).filter(
        OntologyVersion.tenant_id == tenant_id,
        OntologyVersion.knowledge_base_id == kb.id,
        OntologyVersion.status == "draft",
    ).update({"status": "archived"}, synchronize_session=False)
    db.commit()

    version = OntologyVersion(
        tenant_id=tenant_id,
        knowledge_base_id=kb.id,
        name=f"Draft {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}",
        status="draft",
        source="auto",
        created_by=current_user.id,
        config={
            "max_chunks": max_chunks,
            "max_text_chars": max_text_chars,
            "min_confidence": min_confidence,
            "auto_approve_confidence": auto_approve_confidence,
            "auto_approve_min_docs": auto_approve_min_docs,
        },
    )
    db.add(version)
    db.commit()
    db.refresh(version)

    if request.run_async:
        progress_payload = {
            "status": "running",
            "current": 0,
            "total": 0,
            "version_id": version.id,
            "run_id": uuid.uuid4().hex,
            "started_at": _now_iso(),
            "updated_at": _now_iso(),
            "message": "Queued",
        }
        _set_ontology_progress(db, kb, progress_payload)
        background_tasks.add_task(
            _generate_ontology_draft_background,
            kb_name=kb_name,
            tenant_id=tenant_id,
            user_id=current_user.id,
            version_id=version.id,
            max_chunks=max_chunks,
            max_text_chars=max_text_chars,
            min_confidence=min_confidence,
            auto_approve_confidence=auto_approve_confidence,
            auto_approve_min_docs=auto_approve_min_docs,
        )
        return OntologyDraftResponse(version_id=version.id, status="running")

    await _generate_ontology_draft(
        db=db,
        tenant_id=tenant_id,
        kb=kb,
        current_user=current_user,
        version=version,
        max_chunks=max_chunks,
        max_text_chars=max_text_chars,
        min_confidence=min_confidence,
        auto_approve_confidence=auto_approve_confidence,
        auto_approve_min_docs=auto_approve_min_docs,
    )
    return OntologyDraftResponse(version_id=version.id, status="completed")


@router.get("/draft/items", response_model=List[OntologyItemResponse])
def list_ontology_draft_items(
    kb_name: str,
    version_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    kind: Optional[str] = None,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_read_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    version = None
    if version_id is not None:
        version = (
            db.query(OntologyVersion)
            .filter(
                OntologyVersion.id == version_id,
                OntologyVersion.tenant_id == tenant_id,
                OntologyVersion.knowledge_base_id == kb.id,
            )
            .first()
        )
    else:
        version = _latest_draft_version(db, kb.id, tenant_id)
    if not version:
        return []

    query = db.query(OntologyItem).filter(
        OntologyItem.tenant_id == tenant_id,
        OntologyItem.knowledge_base_id == kb.id,
        OntologyItem.version_id == version.id,
    )
    if status_filter:
        query = query.filter(OntologyItem.status == status_filter)
    if kind:
        query = query.filter(OntologyItem.kind == kind)
    items = query.order_by(OntologyItem.confidence.desc()).all()
    return [
        OntologyItemResponse(
            id=item.id,
            kind=item.kind,
            name=item.name,
            description=item.description,
            aliases=item.aliases or [],
            constraints=item.constraints or {},
            confidence=float(item.confidence or 0.0),
            evidence=item.evidence or [],
            status=item.status,
            meta=item.meta or {},
        )
        for item in items
    ]


@router.post("/draft/items", response_model=OntologyItemResponse)
def create_ontology_draft_item(
    request: OntologyItemCreateRequest,
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    version = _latest_draft_version(db, kb.id, tenant_id)
    if not version:
        version = OntologyVersion(
            tenant_id=tenant_id,
            knowledge_base_id=kb.id,
            name=f"Manual Draft {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}",
            status="draft",
            source="manual",
            created_by=current_user.id,
            config={},
        )
        db.add(version)
        db.commit()
        db.refresh(version)
    item = OntologyItem(
        tenant_id=tenant_id,
        knowledge_base_id=kb.id,
        version_id=version.id,
        kind=request.kind,
        name=request.name.strip(),
        description=(request.description or "").strip() or None,
        aliases=[alias.strip() for alias in (request.aliases or []) if alias.strip()],
        constraints=request.constraints or {},
        confidence=1.0,
        evidence=[],
        status=request.status or "approved",
        meta=request.meta or {},
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return OntologyItemResponse(
        id=item.id,
        kind=item.kind,
        name=item.name,
        description=item.description,
        aliases=item.aliases or [],
        constraints=item.constraints or {},
        confidence=float(item.confidence or 0.0),
        evidence=item.evidence or [],
        status=item.status,
        meta=item.meta or {},
    )


@router.patch("/draft/items/status")
def update_ontology_draft_item_status(
    request: OntologyItemStatusUpdate,
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    if not request.ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No item ids provided")
    updated = (
        db.query(OntologyItem)
        .filter(
            OntologyItem.tenant_id == tenant_id,
            OntologyItem.knowledge_base_id == kb.id,
            OntologyItem.id.in_(request.ids),
        )
        .update({"status": request.status}, synchronize_session=False)
    )
    db.commit()
    return {"updated": updated}


@router.patch("/draft/items/{item_id}", response_model=OntologyItemResponse)
def update_ontology_draft_item(
    item_id: int,
    request: OntologyItemUpdateRequest,
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    item = (
        db.query(OntologyItem)
        .filter(
            OntologyItem.tenant_id == tenant_id,
            OntologyItem.knowledge_base_id == kb.id,
            OntologyItem.id == item_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if request.name is not None:
        item.name = request.name.strip() or item.name
    if request.description is not None:
        item.description = request.description.strip() or None
    if request.aliases is not None:
        item.aliases = [alias.strip() for alias in request.aliases if alias.strip()]
    if request.constraints is not None:
        item.constraints = request.constraints or {}
    if request.meta is not None:
        item.meta = request.meta or {}
    if request.status is not None:
        item.status = request.status
    db.commit()
    db.refresh(item)
    return OntologyItemResponse(
        id=item.id,
        kind=item.kind,
        name=item.name,
        description=item.description,
        aliases=item.aliases or [],
        constraints=item.constraints or {},
        confidence=float(item.confidence or 0.0),
        evidence=item.evidence or [],
        status=item.status,
        meta=item.meta or {},
    )


@router.post("/publish")
def publish_ontology(
    request: OntologyPublishRequest,
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    version = None
    if request.version_id is not None:
        version = (
            db.query(OntologyVersion)
            .filter(
                OntologyVersion.id == request.version_id,
                OntologyVersion.tenant_id == tenant_id,
                OntologyVersion.knowledge_base_id == kb.id,
            )
            .first()
        )
    else:
        version = _latest_draft_version(db, kb.id, tenant_id)
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft version not found")

    db.query(OntologyVersion).filter(
        OntologyVersion.tenant_id == tenant_id,
        OntologyVersion.knowledge_base_id == kb.id,
        OntologyVersion.status == "active",
    ).update({"status": "archived"}, synchronize_session=False)
    version.status = "active"
    if request.name:
        version.name = request.name.strip() or version.name
    db.commit()
    return {"status": "active", "version_id": version.id}
