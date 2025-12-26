"""
Semantic layer endpoints (candidate discovery and review).
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Literal
import json
import math
import re
import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.dependencies import get_tenant_id, require_permission
from app.db.database import get_db
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.db.models.document import Document
from app.db.models.document_chunk import DocumentChunk
from app.db.models.permission import PermissionType
from app.db.models.semantic_candidate import SemanticCandidate
from app.db.models.user import User, UserConfig
from app.services.llm_service import llm_service

router = APIRouter()
logger = structlog.get_logger(__name__)

EXTRACTION_DEFAULT_MAX_CHUNKS = 3
EXTRACTION_DEFAULT_MAX_TEXT_CHARS = 1800
EXTRACTION_DEFAULT_MAX_ITEMS = 12
EXTRACTION_DEFAULT_DOCUMENT_LIMIT = 6
EXTRACTION_DEFAULT_AUTO_CHUNKING = False
EXTRACTION_DEFAULT_CHUNK_STRATEGY = "uniform"
EXTRACTION_DEFAULT_MODE = "direct"
EXTRACTION_DEFAULT_PROGRESSIVE_ENABLED = False
EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS = 6
EXTRACTION_DEFAULT_PROGRESSIVE_STEP = 3
EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS = 2000
EXTRACTION_AUTO_MIN_CHUNKS = 3
EXTRACTION_MIN_CHUNKS = 1
EXTRACTION_MAX_CHUNKS_LIMIT = 50
EXTRACTION_MIN_TEXT_CHARS = 200
EXTRACTION_MAX_TEXT_CHARS_LIMIT = 4000
EXTRACTION_MIN_SUMMARY_CHARS = 200
EXTRACTION_MAX_SUMMARY_CHARS = 4000
EXTRACTION_MIN_ITEMS = 1
EXTRACTION_MAX_ITEMS_LIMIT = 30
EXTRACTION_MIN_PROGRESSIVE_ITEMS = 1
EXTRACTION_MAX_PROGRESSIVE_ITEMS = 50
EXTRACTION_MIN_PROGRESSIVE_STEP = 1
EXTRACTION_MAX_PROGRESSIVE_STEP = 50
EXTRACTION_MIN_DOCUMENT_LIMIT = 1
EXTRACTION_MAX_DOCUMENT_LIMIT = 50


class SemanticEvidence(BaseModel):
    source: str
    snippet: str
    document_id: Optional[int] = None
    chunk_index: Optional[int] = None


class SemanticCandidateResponse(BaseModel):
    id: int
    name: str
    type: str
    status: str
    confidence: float
    aliases: List[str] = Field(default_factory=list)
    relation: Optional[Dict[str, Any]] = None
    attributes: Optional[Dict[str, Any]] = None
    evidence: List[SemanticEvidence] = Field(default_factory=list)
    merge_mode: Optional[str] = None
    merge_target: Optional[str] = None
    merge_alias: Optional[bool] = None


class SemanticDiscoveryRequest(BaseModel):
    scope: Literal["all", "recent"] = "all"
    include_relations: bool = True
    reset: bool = False
    document_limit: Optional[int] = None
    max_chunks: Optional[int] = None
    max_text_chars: Optional[int] = None
    max_items: Optional[int] = None
    auto_chunking: Optional[bool] = None
    chunk_strategy: Optional[str] = None
    mode: Optional[str] = None
    progressive_enabled: Optional[bool] = None
    progressive_min_items: Optional[int] = None
    progressive_step: Optional[int] = None
    summary_max_chars: Optional[int] = None
    entity_types: Optional[List[str]] = None
    relation_types: Optional[List[str]] = None


class SemanticDiscoveryResponse(BaseModel):
    created: int
    skipped: int
    total: int


class SemanticDiscoveryProgressResponse(BaseModel):
    status: Literal["idle", "running", "completed", "failed"]
    current: int
    total: int
    run_id: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    message: Optional[str] = None


class SemanticCandidateStatusUpdate(BaseModel):
    ids: List[int]
    status: Literal["pending", "approved", "rejected"]


class SemanticCandidateMergeRequest(BaseModel):
    mode: Literal["existing", "new"]
    target: str
    alias: bool = True


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


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _get_discovery_progress(kb_row: KBModel) -> Dict[str, Any]:
    raw = kb_row.settings or {}
    progress = raw.get("semantic_discovery_progress") if isinstance(raw, dict) else None
    if isinstance(progress, dict):
        return progress
    return {}


def _set_discovery_progress(
    db: Session, kb_row: KBModel, payload: Dict[str, Any]
) -> Dict[str, Any]:
    raw = dict(kb_row.settings or {})
    raw["semantic_discovery_progress"] = payload
    kb_row.settings = raw
    db.commit()
    return payload


def _safe_entity_name(doc: Document) -> str:
    base = (doc.title or doc.original_filename or doc.filename or "").strip()
    if "." in base:
        base = base.rsplit(".", 1)[0]
    return base[:255]


def _truncate_text(text: str, max_chars: int) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars].strip()


def _coerce_int(value: Optional[int], default: int, min_value: int, max_value: int) -> int:
    try:
        if value is None:
            return default
        parsed = int(value)
    except Exception:
        return default
    return max(min_value, min(max_value, parsed))


def _coerce_chunk_strategy(value: Optional[str], default: str) -> str:
    if value in ("uniform", "leading", "head_tail", "diverse"):
        return value
    return default


def _coerce_extraction_mode(value: Optional[str], default: str) -> str:
    if value in ("direct", "summary"):
        return value
    return default


def _parse_whitelist(raw: Optional[Any]) -> List[str]:
    if raw is None:
        return []
    items: List[str]
    if isinstance(raw, list):
        items = [str(item) for item in raw]
    elif isinstance(raw, str):
        items = re.split(r"[,\n;]+", raw)
    else:
        return []
    cleaned: List[str] = []
    seen = set()
    for item in items:
        value = str(item or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
    return cleaned


def _normalize_type(value: str) -> str:
    return (value or "").strip().lower()


def _tokenize_text(text: str, max_chars: int) -> List[str]:
    cleaned = _truncate_text(text, max_chars)
    if not cleaned:
        return []
    return re.findall(r"[\w\u4e00-\u9fff]+", cleaned.lower())


def _jaccard_similarity(a: List[str], b: List[str]) -> float:
    set_a = set(a)
    set_b = set(b)
    if not set_a and not set_b:
        return 1.0
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def _select_diverse_chunks(
    chunks: List[DocumentChunk], max_chunks: int, max_text_chars: int
) -> List[DocumentChunk]:
    if len(chunks) <= max_chunks:
        return chunks
    token_map = {chunk.id: _tokenize_text(chunk.text or "", max_text_chars) for chunk in chunks}
    remaining = list(chunks)
    remaining.sort(key=lambda chunk: len(token_map.get(chunk.id, [])), reverse=True)
    selected: List[DocumentChunk] = [remaining.pop(0)]
    while remaining and len(selected) < max_chunks:
        best_chunk = None
        best_score = -1.0
        for candidate in remaining:
            candidate_tokens = token_map.get(candidate.id, [])
            max_sim = max(
                _jaccard_similarity(candidate_tokens, token_map.get(ch.id, [])) for ch in selected
            )
            score = 1.0 - max_sim
            if score > best_score:
                best_score = score
                best_chunk = candidate
        if best_chunk is None:
            break
        remaining.remove(best_chunk)
        selected.append(best_chunk)
    return selected


def _select_chunk_indices(total_chunks: int, max_chunks: int, strategy: str) -> List[int]:
    if total_chunks <= 0 or max_chunks <= 0:
        return []
    if total_chunks <= max_chunks:
        return list(range(total_chunks))
    if strategy == "leading":
        return list(range(max_chunks))
    if strategy == "head_tail":
        head = max_chunks // 2
        tail = max_chunks - head
        indices = list(range(head))
        indices.extend(range(max(0, total_chunks - tail), total_chunks))
        return sorted(set(indices))
    if max_chunks == 1:
        return [0]
    step = (total_chunks - 1) / (max_chunks - 1)
    indices = [int(round(step * i)) for i in range(max_chunks)]
    return sorted({min(total_chunks - 1, max(0, idx)) for idx in indices})


def _find_first_json_object(raw: str) -> Optional[str]:
    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    for idx in range(start, len(raw)):
        ch = raw[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start : idx + 1]
    return None


def _find_last_json_object(raw: str) -> Optional[str]:
    end = raw.rfind("}")
    if end < 0:
        return None
    depth = 0
    for idx in range(end, -1, -1):
        ch = raw[idx]
        if ch == "}":
            depth += 1
        elif ch == "{":
            depth -= 1
            if depth == 0:
                return raw[idx : end + 1]
    return None


def _extract_json_payload(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    text = raw.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except Exception:
            pass

    candidate = _find_first_json_object(text)
    if candidate:
        try:
            return json.loads(candidate)
        except Exception:
            pass

    candidate = _find_last_json_object(text)
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except Exception:
        return None


def _build_extraction_prompt(
    text: str, entity_types: List[str], relation_types: List[str]
) -> str:
    schema = (
        '{"entities":[{"name":"","type":"","aliases":[],"confidence":0.0}],'
        '"relations":[{"source":"","relation":"","target":"","confidence":0.0}],'
        '"attributes":[{"entity":"","key":"","value":"","confidence":0.0}]}'
    )
    instructions = [
        "Extract entities, relations, and attributes from the text.",
        "- Only include items explicitly stated in the text.",
        "- Use concise canonical names.",
        "- Provide a short type label for each entity.",
        "- If nothing is found, return empty arrays.",
    ]
    if entity_types:
        allowed = ", ".join(entity_types)
        instructions.append(f"- Entity type must be one of: {allowed}.")
    if relation_types:
        allowed = ", ".join(relation_types)
        instructions.append(f"- Relation type must be one of: {allowed}.")
    instructions.append(f"Return ONLY valid JSON using this schema: {schema}")
    return f"{chr(10).join(instructions)}\n\nText:\n{text}"


def _build_summary_prompt(text: str, max_chars: int) -> str:
    instructions = (
        "Summarize the text into concise bullet points focused on factual entities, "
        "relations, and attributes. Keep the summary within "
        f"{max_chars} characters. Return only plain text."
    )
    return f"{instructions}\n\nText:\n{text}"


def _build_evidence_from_chunk(doc: Document, chunk: DocumentChunk) -> Dict[str, Any]:
    snippet = _truncate_text(chunk.text, 300)
    return {
        "source": doc.original_filename or doc.filename or f"doc-{doc.id}",
        "snippet": snippet,
        "document_id": doc.id,
        "chunk_index": chunk.chunk_index,
    }


def _build_evidence(db: Session, doc: Document) -> Dict[str, Any]:
    chunk = (
        db.query(DocumentChunk)
        .filter(
            DocumentChunk.document_id == doc.id,
            DocumentChunk.tenant_id == doc.tenant_id,
        )
        .order_by(DocumentChunk.chunk_index.asc())
        .first()
    )
    snippet = chunk.text if chunk else (doc.content_preview or doc.filename or "")
    snippet = snippet[:300]
    return {
        "source": doc.original_filename or doc.filename or f"doc-{doc.id}",
        "snippet": snippet,
        "document_id": doc.id,
        "chunk_index": chunk.chunk_index if chunk else None,
    }


def _as_response(candidate: SemanticCandidate) -> SemanticCandidateResponse:
    evidence = candidate.evidence or []
    relation = candidate.relation or None
    attributes = candidate.attributes or None
    return SemanticCandidateResponse(
        id=candidate.id,
        name=candidate.name,
        type=candidate.type,
        status=candidate.status,
        confidence=float(candidate.confidence or 0.0),
        aliases=candidate.aliases or [],
        relation=relation if relation else None,
        attributes=attributes if attributes else None,
        evidence=[
            SemanticEvidence(
                source=str(item.get("source", "")),
                snippet=str(item.get("snippet", "")),
                document_id=item.get("document_id"),
                chunk_index=item.get("chunk_index"),
            )
            for item in evidence
        ],
        merge_mode=candidate.merge_mode,
        merge_target=candidate.merge_target,
        merge_alias=candidate.merge_alias,
    )


@router.get("/candidates", response_model=List[SemanticCandidateResponse])
def list_candidates(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_read_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    candidates = (
        db.query(SemanticCandidate)
        .filter(
            SemanticCandidate.tenant_id == tenant_id,
            SemanticCandidate.knowledge_base_id == kb.id,
        )
        .order_by(SemanticCandidate.id.asc())
        .all()
    )
    return [_as_response(c) for c in candidates]


@router.get("/discover/status", response_model=SemanticDiscoveryProgressResponse)
def get_discovery_status(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_READ.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_read_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    progress = _get_discovery_progress(kb)
    if not progress:
        return SemanticDiscoveryProgressResponse(status="idle", current=0, total=0)
    status_value = progress.get("status")
    if status_value not in ("idle", "running", "completed", "failed"):
        status_value = "idle"
    return SemanticDiscoveryProgressResponse(
        status=str(status_value or "idle"),
        current=int(progress.get("current") or 0),
        total=int(progress.get("total") or 0),
        run_id=progress.get("run_id"),
        started_at=progress.get("started_at"),
        updated_at=progress.get("updated_at"),
        message=progress.get("message"),
    )


@router.post("/discover", response_model=SemanticDiscoveryResponse)
async def discover_candidates(
    request: SemanticDiscoveryRequest,
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    if request.reset:
        db.query(SemanticCandidate).filter(
            SemanticCandidate.tenant_id == tenant_id,
            SemanticCandidate.knowledge_base_id == kb.id,
        ).delete()
        db.commit()

    model_name = None
    config_max_chunks = None
    config_max_text_chars = None
    config_max_items = None
    config_document_limit = None
    config_auto_chunking = None
    config_chunk_strategy = None
    config_mode = None
    config_progressive_enabled = None
    config_progressive_min_items = None
    config_progressive_step = None
    config_summary_max_chars = None
    config_entity_whitelist = None
    config_relation_whitelist = None
    try:
        cfg = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).first()
        if cfg:
            model_name = cfg.preferred_extraction_model or cfg.preferred_chat_model
            config_max_chunks = cfg.extraction_max_chunks
            config_max_text_chars = cfg.extraction_max_text_chars
            config_max_items = cfg.extraction_max_items
            config_document_limit = cfg.extraction_document_limit
            config_auto_chunking = cfg.extraction_auto_chunking
            config_chunk_strategy = cfg.extraction_chunk_strategy
            config_mode = cfg.extraction_mode
            config_progressive_enabled = cfg.extraction_progressive_enabled
            config_progressive_min_items = cfg.extraction_progressive_min_items
            config_progressive_step = cfg.extraction_progressive_step
            config_summary_max_chars = cfg.extraction_summary_max_chars
            config_entity_whitelist = cfg.extraction_entity_type_whitelist
            config_relation_whitelist = cfg.extraction_relation_type_whitelist
        if isinstance(model_name, str):
            model_name = model_name.strip() or None
    except Exception as exc:
        logger.warning("Failed to load user extraction model", error=str(exc))

    default_document_limit = _coerce_int(
        config_document_limit,
        EXTRACTION_DEFAULT_DOCUMENT_LIMIT,
        EXTRACTION_MIN_DOCUMENT_LIMIT,
        EXTRACTION_MAX_DOCUMENT_LIMIT,
    )
    document_limit = _coerce_int(
        request.document_limit,
        default_document_limit,
        EXTRACTION_MIN_DOCUMENT_LIMIT,
        EXTRACTION_MAX_DOCUMENT_LIMIT,
    )
    default_auto_chunking = (
        bool(config_auto_chunking)
        if config_auto_chunking is not None
        else EXTRACTION_DEFAULT_AUTO_CHUNKING
    )
    auto_chunking = (
        request.auto_chunking if request.auto_chunking is not None else default_auto_chunking
    )
    default_chunk_strategy = _coerce_chunk_strategy(
        config_chunk_strategy, EXTRACTION_DEFAULT_CHUNK_STRATEGY
    )
    chunk_strategy = _coerce_chunk_strategy(request.chunk_strategy, default_chunk_strategy)
    default_max_chunks = _coerce_int(
        config_max_chunks,
        EXTRACTION_DEFAULT_MAX_CHUNKS,
        EXTRACTION_MIN_CHUNKS,
        EXTRACTION_MAX_CHUNKS_LIMIT,
    )
    default_max_text_chars = _coerce_int(
        config_max_text_chars,
        EXTRACTION_DEFAULT_MAX_TEXT_CHARS,
        EXTRACTION_MIN_TEXT_CHARS,
        EXTRACTION_MAX_TEXT_CHARS_LIMIT,
    )
    default_max_items = _coerce_int(
        config_max_items,
        EXTRACTION_DEFAULT_MAX_ITEMS,
        EXTRACTION_MIN_ITEMS,
        EXTRACTION_MAX_ITEMS_LIMIT,
    )
    max_chunks = _coerce_int(
        request.max_chunks,
        default_max_chunks,
        EXTRACTION_MIN_CHUNKS,
        EXTRACTION_MAX_CHUNKS_LIMIT,
    )
    max_text_chars = _coerce_int(
        request.max_text_chars,
        default_max_text_chars,
        EXTRACTION_MIN_TEXT_CHARS,
        EXTRACTION_MAX_TEXT_CHARS_LIMIT,
    )
    max_items = _coerce_int(
        request.max_items,
        default_max_items,
        EXTRACTION_MIN_ITEMS,
        EXTRACTION_MAX_ITEMS_LIMIT,
    )
    default_mode = _coerce_extraction_mode(config_mode, EXTRACTION_DEFAULT_MODE)
    extraction_mode = _coerce_extraction_mode(request.mode, default_mode)
    default_progressive_enabled = (
        bool(config_progressive_enabled)
        if config_progressive_enabled is not None
        else EXTRACTION_DEFAULT_PROGRESSIVE_ENABLED
    )
    progressive_enabled = (
        request.progressive_enabled
        if request.progressive_enabled is not None
        else default_progressive_enabled
    )
    default_progressive_min_items = _coerce_int(
        config_progressive_min_items,
        EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS,
        EXTRACTION_MIN_PROGRESSIVE_ITEMS,
        EXTRACTION_MAX_PROGRESSIVE_ITEMS,
    )
    progressive_min_items = _coerce_int(
        request.progressive_min_items,
        default_progressive_min_items,
        EXTRACTION_MIN_PROGRESSIVE_ITEMS,
        EXTRACTION_MAX_PROGRESSIVE_ITEMS,
    )
    default_progressive_step = _coerce_int(
        config_progressive_step,
        EXTRACTION_DEFAULT_PROGRESSIVE_STEP,
        EXTRACTION_MIN_PROGRESSIVE_STEP,
        EXTRACTION_MAX_PROGRESSIVE_STEP,
    )
    progressive_step = _coerce_int(
        request.progressive_step,
        default_progressive_step,
        EXTRACTION_MIN_PROGRESSIVE_STEP,
        EXTRACTION_MAX_PROGRESSIVE_STEP,
    )
    default_summary_max_chars = _coerce_int(
        config_summary_max_chars,
        EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS,
        EXTRACTION_MIN_SUMMARY_CHARS,
        EXTRACTION_MAX_SUMMARY_CHARS,
    )
    summary_max_chars = _coerce_int(
        request.summary_max_chars,
        default_summary_max_chars,
        EXTRACTION_MIN_SUMMARY_CHARS,
        EXTRACTION_MAX_SUMMARY_CHARS,
    )
    entity_type_whitelist = _parse_whitelist(
        request.entity_types if request.entity_types is not None else config_entity_whitelist
    )
    relation_type_whitelist = _parse_whitelist(
        request.relation_types
        if request.relation_types is not None
        else config_relation_whitelist
    )
    entity_type_set = {_normalize_type(item) for item in entity_type_whitelist}
    relation_type_set = {_normalize_type(item) for item in relation_type_whitelist}

    q = db.query(Document).filter(
        Document.tenant_id == tenant_id,
        Document.knowledge_base_name == kb.name,
    )
    if request.scope == "recent":
        cutoff = datetime.utcnow() - timedelta(days=30)
        q = q.filter(Document.created_at >= cutoff).order_by(Document.created_at.desc())
    else:
        q = q.order_by(Document.created_at.asc())
    if document_limit:
        q = q.limit(max(1, int(document_limit)))
    docs = q.all()
    total_docs = len(docs)
    run_id = uuid.uuid4().hex
    progress_payload = {
        "status": "running",
        "current": 0,
        "total": total_docs,
        "run_id": run_id,
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "message": None,
    }
    _set_discovery_progress(db, kb, progress_payload)
    if total_docs == 0:
        progress_payload["status"] = "completed"
        progress_payload["updated_at"] = _now_iso()
        _set_discovery_progress(db, kb, progress_payload)
        return SemanticDiscoveryResponse(created=0, skipped=0, total=0)

    existing = {
        (c.type, (c.name or "").strip().lower())
        for c in db.query(SemanticCandidate)
        .filter(
            SemanticCandidate.tenant_id == tenant_id,
            SemanticCandidate.knowledge_base_id == kb.id,
        )
        .all()
    }
    created = 0
    skipped = 0
    candidates_to_add: List[SemanticCandidate] = []

    def normalize_key(value: str) -> str:
        return (value or "").strip().lower()

    def coerce_confidence(value: Any, default: float) -> float:
        try:
            val = float(value)
        except Exception:
            return default
        if val < 0 or val > 1:
            return default
        return val

    def add_candidate(
        candidate_type: str,
        name: str,
        evidence: List[Dict[str, Any]],
        *,
        confidence: float,
        aliases: Optional[List[str]] = None,
        relation: Optional[Dict[str, Any]] = None,
        attributes: Optional[Dict[str, Any]] = None,
    ) -> bool:
        nonlocal created, skipped
        cleaned = (name or "").strip()
        if not cleaned:
            return False
        cleaned = cleaned[:255]
        key = (candidate_type, normalize_key(cleaned))
        if key in existing:
            skipped += 1
            return False
        candidate = SemanticCandidate(
            tenant_id=tenant_id,
            knowledge_base_id=kb.id,
            knowledge_base_name=kb.name,
            type=candidate_type,
            name=cleaned,
            status="pending",
            confidence=confidence,
            aliases=aliases or [],
            relation=relation or {},
            attributes=attributes or {},
            evidence=evidence,
        )
        candidates_to_add.append(candidate)
        existing.add(key)
        created += 1
        return True

    async def summarize_text(text: str) -> str:
        if extraction_mode != "summary":
            return text
        prompt = _build_summary_prompt(text, summary_max_chars)
        try:
            llm_response = await llm_service.chat(
                message=prompt,
                model=model_name,
                temperature=0.2,
                max_tokens=600,
                tenant_id=tenant_id,
                user_id=current_user.id,
            )
        except Exception as exc:
            logger.warning("LLM summary failed", error=str(exc))
            return text
        if not llm_response.get("success"):
            logger.warning(
                "LLM summary returned failure",
                error=str(llm_response.get("error") or llm_response.get("message")),
            )
            return text
        summary = str(llm_response.get("message") or "").strip()
        summary = _truncate_text(summary, summary_max_chars)
        return summary or text

    try:
        for doc_index, doc in enumerate(docs, start=1):
            chunk_q = (
                db.query(DocumentChunk)
                .filter(
                    DocumentChunk.document_id == doc.id,
                    DocumentChunk.tenant_id == tenant_id,
                )
                .order_by(DocumentChunk.chunk_index.asc())
            )
            total_chunks = int(getattr(doc, "total_chunks", 0) or 0)
            if total_chunks <= 0:
                total_chunks = int(
                    db.query(func.count(DocumentChunk.id))
                    .filter(
                        DocumentChunk.document_id == doc.id,
                        DocumentChunk.tenant_id == tenant_id,
                    )
                    .scalar()
                    or 0
                )
            chunk_plan: List[DocumentChunk] = []
            if total_chunks > 0:
                effective_max_chunks = min(max_chunks, total_chunks) if max_chunks else total_chunks
                if auto_chunking:
                    auto_target = max(
                        EXTRACTION_AUTO_MIN_CHUNKS,
                        int(round(math.sqrt(total_chunks))),
                    )
                    effective_max_chunks = min(effective_max_chunks, auto_target)
                if effective_max_chunks > 0:
                    if chunk_strategy == "diverse":
                        pool_limit = min(
                            total_chunks,
                            max(effective_max_chunks * 4, effective_max_chunks + 5, 12),
                        )
                        indices = _select_chunk_indices(total_chunks, pool_limit, "uniform")
                        if indices:
                            pool_chunks = (
                                chunk_q.filter(DocumentChunk.chunk_index.in_(indices))
                                .order_by(DocumentChunk.chunk_index.asc())
                                .all()
                            )
                        else:
                            pool_chunks = chunk_q.all()
                        if pool_chunks:
                            if effective_max_chunks >= len(pool_chunks):
                                chunk_plan = pool_chunks
                            else:
                                chunk_plan = _select_diverse_chunks(
                                    pool_chunks, effective_max_chunks, max_text_chars
                                )
                    else:
                        if total_chunks > effective_max_chunks:
                            indices = _select_chunk_indices(
                                total_chunks, effective_max_chunks, chunk_strategy
                            )
                            if indices:
                                chunk_plan = (
                                    chunk_q.filter(DocumentChunk.chunk_index.in_(indices))
                                    .order_by(DocumentChunk.chunk_index.asc())
                                    .all()
                                )
                        if not chunk_plan and effective_max_chunks:
                            chunk_plan = chunk_q.limit(effective_max_chunks).all()
            elif max_chunks:
                chunk_plan = chunk_q.limit(max_chunks).all()

            chunk_sources: List[tuple[str, List[Dict[str, Any]]]] = []
            if chunk_plan:
                for chunk in chunk_plan:
                    text = _truncate_text(chunk.text, max_text_chars)
                    if not text:
                        continue
                    chunk_sources.append((text, [_build_evidence_from_chunk(doc, chunk)]))
            else:
                preview = _truncate_text(
                    doc.content_preview or doc.title or doc.original_filename or doc.filename,
                    max_text_chars,
                )
                if preview:
                    chunk_sources.append((preview, [_build_evidence(db, doc)]))

            extracted_any = False
            extracted_items = 0

            if progressive_enabled:
                step = max(EXTRACTION_MIN_PROGRESSIVE_STEP, progressive_step)
                batches = [
                    chunk_sources[i : i + step] for i in range(0, len(chunk_sources), step)
                ]
            else:
                batches = [chunk_sources]

            for batch in batches:
                for text, evidence in batch:
                    extract_text = await summarize_text(text)
                    extract_text = _truncate_text(extract_text, max_text_chars)
                    if not extract_text:
                        continue
                    prompt = _build_extraction_prompt(
                        extract_text, entity_type_whitelist, relation_type_whitelist
                    )
                    try:
                        llm_response = await llm_service.chat(
                            message=prompt,
                            model=model_name,
                            temperature=0.1,
                            max_tokens=900,
                            tenant_id=tenant_id,
                            user_id=current_user.id,
                        )
                    except Exception as exc:
                        logger.warning("LLM extraction failed", error=str(exc))
                        continue

                    if not llm_response.get("success"):
                        logger.warning(
                            "LLM extraction returned failure",
                            error=str(llm_response.get("error") or llm_response.get("message")),
                        )
                        continue

                    payload = _extract_json_payload(llm_response.get("message") or "")
                    if not payload:
                        continue

                    entities = payload.get("entities") or []
                    relations = payload.get("relations") or []
                    attributes = payload.get("attributes") or []

                    if not isinstance(entities, list):
                        entities = []
                    if not isinstance(relations, list):
                        relations = []
                    if not isinstance(attributes, list):
                        attributes = []

                    if not request.include_relations:
                        relations = []

                    items_found = 0
                    for item in entities[:max_items]:
                        if not isinstance(item, dict):
                            continue
                        name = str(item.get("name") or "").strip()
                        if not name:
                            continue
                        entity_type = str(item.get("type") or "").strip()
                        if entity_type_set and _normalize_type(entity_type) not in entity_type_set:
                            continue
                        aliases = (
                            item.get("aliases") if isinstance(item.get("aliases"), list) else []
                        )
                        aliases = [str(a).strip() for a in aliases if str(a).strip()]
                        confidence = coerce_confidence(item.get("confidence"), 0.75)
                        attributes_payload = {"entity_type": entity_type} if entity_type else {}
                        if add_candidate(
                            "entity",
                            name,
                            evidence,
                            confidence=confidence,
                            aliases=aliases,
                            attributes=attributes_payload,
                        ):
                            items_found += 1

                    for item in relations[:max_items]:
                        if not isinstance(item, dict):
                            continue
                        source = str(item.get("source") or "").strip()
                        target = str(item.get("target") or "").strip()
                        rel = str(item.get("relation") or "").strip() or "RELATED_TO"
                        if not source or not target:
                            continue
                        if relation_type_set and _normalize_type(rel) not in relation_type_set:
                            continue
                        rel_name = f"{source} -> {rel} -> {target}"
                        confidence = coerce_confidence(item.get("confidence"), 0.65)
                        if add_candidate(
                            "relation",
                            rel_name,
                            evidence,
                            confidence=confidence,
                            relation={"source": source, "relation": rel, "target": target},
                        ):
                            items_found += 1

                    for item in attributes[:max_items]:
                        if not isinstance(item, dict):
                            continue
                        entity = str(item.get("entity") or "").strip()
                        key = str(item.get("key") or "").strip()
                        value = item.get("value")
                        if not entity or not key:
                            continue
                        attr_name = f"{entity}.{key}"
                        confidence = coerce_confidence(item.get("confidence"), 0.6)
                        if add_candidate(
                            "attribute",
                            attr_name,
                            evidence,
                            confidence=confidence,
                            attributes={"entity": entity, "key": key, "value": value},
                        ):
                            items_found += 1

                    if items_found > 0:
                        extracted_any = True
                        extracted_items += items_found
                    if progressive_enabled and extracted_items >= progressive_min_items:
                        break
                if progressive_enabled and extracted_items >= progressive_min_items:
                    break

            if extracted_any:
                progress_payload["current"] = doc_index
                progress_payload["updated_at"] = _now_iso()
                progress_payload["message"] = f"Processed {doc_index}/{total_docs} documents"
                _set_discovery_progress(db, kb, progress_payload)
                continue

            fallback_name = _safe_entity_name(doc)
            if fallback_name:
                fallback_evidence = [_build_evidence(db, doc)]
                aliases = []
                if doc.original_filename and doc.original_filename != fallback_name:
                    aliases.append(doc.original_filename)
                add_candidate(
                    "entity",
                    fallback_name,
                    fallback_evidence,
                    confidence=0.6,
                    aliases=aliases,
                )
                if doc.file_type:
                    add_candidate(
                        "attribute",
                        f"{fallback_name}.file_type",
                        fallback_evidence,
                        confidence=0.55,
                        attributes={
                            "entity": fallback_name,
                            "key": "file_type",
                            "value": doc.file_type,
                        },
                    )
            progress_payload["current"] = doc_index
            progress_payload["updated_at"] = _now_iso()
            progress_payload["message"] = f"Processed {doc_index}/{total_docs} documents"
            _set_discovery_progress(db, kb, progress_payload)

        if candidates_to_add:
            db.add_all(candidates_to_add)
            db.commit()
        total = (
            db.query(SemanticCandidate)
            .filter(
                SemanticCandidate.tenant_id == tenant_id,
                SemanticCandidate.knowledge_base_id == kb.id,
            )
            .count()
        )
        progress_payload["status"] = "completed"
        progress_payload["current"] = total_docs
        progress_payload["updated_at"] = _now_iso()
        progress_payload["message"] = None
        _set_discovery_progress(db, kb, progress_payload)
        return SemanticDiscoveryResponse(created=created, skipped=skipped, total=total)
    except Exception as exc:
        progress_payload["status"] = "failed"
        progress_payload["updated_at"] = _now_iso()
        progress_payload["message"] = str(exc)
        _set_discovery_progress(db, kb, progress_payload)
        raise


@router.patch("/candidates/status")
def update_candidate_status(
    request: SemanticCandidateStatusUpdate,
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    if not request.ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No candidate ids provided")

    updated = (
        db.query(SemanticCandidate)
        .filter(
            SemanticCandidate.tenant_id == tenant_id,
            SemanticCandidate.knowledge_base_id == kb.id,
            SemanticCandidate.id.in_(request.ids),
        )
        .update({"status": request.status}, synchronize_session=False)
    )
    db.commit()
    return {"updated": updated}


@router.post("/candidates/{candidate_id}/merge")
def merge_candidate(
    request: SemanticCandidateMergeRequest,
    candidate_id: int,
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    candidate = (
        db.query(SemanticCandidate)
        .filter(
            SemanticCandidate.tenant_id == tenant_id,
            SemanticCandidate.knowledge_base_id == kb.id,
            SemanticCandidate.id == candidate_id,
        )
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    candidate.merge_mode = request.mode
    candidate.merge_target = request.target.strip()
    candidate.merge_alias = bool(request.alias)
    candidate.status = "approved"
    db.add(candidate)
    db.commit()
    return {"message": "Candidate merged"}
