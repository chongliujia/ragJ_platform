"""
Semantic layer endpoints (candidate discovery and review).
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Literal
import asyncio
import hashlib
import json
import math
import re
import time
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
from app.db.models.semantic_candidate import SemanticCandidate
from app.db.models.user import User, UserConfig
from app.db.models.ontology import OntologyVersion, OntologyItem
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
EXTRACTION_DEFAULT_DISCOVERY_MODE = "facts"
INSIGHT_DEFAULT_SCOPE = "document"
INSIGHT_DEFAULT_DOMAIN = "general"
INSIGHT_DEFAULT_MAX_CHUNKS = 8
INSIGHT_DEFAULT_MAX_TEXT_CHARS = 2600
INSIGHT_DEFAULT_MAX_ITEMS = 16
INSIGHT_DEFAULT_CHUNK_STRATEGY = "diverse"
INSIGHT_MAX_SEGMENTS = 60
STRUCTURE_RELATION_LABEL = "PART_OF"
STRUCTURE_DEFAULT_MAX_ITEMS = 12
INSIGHT_TYPES = (
    "causal",
    "logical",
    "implied",
    "risk",
    "contradiction",
    "trend",
    "dependency",
)
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
EXTRACTION_DEFAULT_BATCH_SIZE = 1
EXTRACTION_FULL_SCAN_BATCH_SIZE = 3
EXTRACTION_MAX_BATCH_SIZE = 6
EXTRACTION_DEFAULT_CONCURRENCY = 3
EXTRACTION_FULL_SCAN_CONCURRENCY = 5
EXTRACTION_MAX_BATCH_CHARS = 6000
EXTRACTION_MAX_CONCURRENCY = 8
NOISE_DOI_PATTERN = re.compile(r"\b10\.\d{4,9}/\S+\b", re.IGNORECASE)
NOISE_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
NOISE_ISBN_PATTERN = re.compile(r"\b97[89][- ]?\d{1,5}[- ]?\d{1,7}[- ]?\d{1,7}[- ]?\d\b")
NOISE_FILE_PATTERN = re.compile(r"\b\w+\.(pdf|docx|pptx|xlsx|csv|txt|md|json|xml|yaml|yml)\b", re.IGNORECASE)


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
    scope: Literal["all", "recent", "selected"] = "all"
    include_relations: bool = True
    reset: bool = False
    resume: Optional[bool] = None
    document_limit: Optional[int] = None
    document_ids: Optional[List[int]] = None
    max_chunks: Optional[int] = None
    max_text_chars: Optional[int] = None
    max_items: Optional[int] = None
    full_chunk_scan: Optional[bool] = None
    batch_size: Optional[int] = None
    batch_concurrency: Optional[int] = None
    auto_chunking: Optional[bool] = None
    chunk_strategy: Optional[str] = None
    mode: Optional[str] = None
    progressive_enabled: Optional[bool] = None
    progressive_min_items: Optional[int] = None
    progressive_step: Optional[int] = None
    summary_max_chars: Optional[int] = None
    entity_types: Optional[List[str]] = None
    relation_types: Optional[List[str]] = None
    discovery_mode: Optional[str] = None
    insight_scope: Optional[str] = None
    insight_domain: Optional[str] = None
    run_async: Optional[bool] = None


class SemanticDiscoveryResponse(BaseModel):
    created: int
    skipped: int
    total: int


class SemanticDiscoveryProgressResponse(BaseModel):
    status: Literal["idle", "running", "completed", "failed", "cancelled"]
    current: int
    total: int
    current_chunks: Optional[int] = None
    total_chunks: Optional[int] = None
    processed_chunks_total: Optional[int] = None
    planned_chunks_total: Optional[int] = None
    document_label: Optional[str] = None
    last_chunk_index: Optional[int] = None
    cancel_requested: Optional[bool] = None
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


def _get_active_ontology_items(
    db: Session, kb_id: int, tenant_id: int
) -> Dict[str, List[OntologyItem]]:
    version = (
        db.query(OntologyVersion)
        .filter(
            OntologyVersion.tenant_id == tenant_id,
            OntologyVersion.knowledge_base_id == kb_id,
            OntologyVersion.status == "active",
        )
        .order_by(OntologyVersion.id.desc())
        .first()
    )
    if not version:
        return {}
    items = (
        db.query(OntologyItem)
        .filter(
            OntologyItem.tenant_id == tenant_id,
            OntologyItem.knowledge_base_id == kb_id,
            OntologyItem.version_id == version.id,
            OntologyItem.status == "approved",
        )
        .all()
    )
    grouped: Dict[str, List[OntologyItem]] = {}
    for item in items:
        grouped.setdefault(item.kind, []).append(item)
    return grouped


def _collect_ontology_constraints(items: List[OntologyItem]) -> tuple[List[str], bool]:
    allowed: List[str] = []
    enforce = False
    for item in items:
        name = str(item.name or "").strip()
        if not name:
            continue
        allowed.append(name)
        strength = _parse_constraint_strength(
            (item.constraints or {}).get("strength") if isinstance(item.constraints, dict) else None
        )
        if strength == "hard":
            enforce = True
    return allowed, enforce


def _build_discovery_signature(payload: Dict[str, Any]) -> str:
    try:
        return json.dumps(payload, ensure_ascii=True, sort_keys=True, default=str)
    except Exception:
        return ""


def _set_discovery_progress(
    db: Session, kb_row: KBModel, payload: Dict[str, Any]
) -> Dict[str, Any]:
    raw = dict(kb_row.settings or {})
    existing = raw.get("semantic_discovery_progress")
    if isinstance(existing, dict):
        if (
            existing.get("cancel_requested")
            and existing.get("run_id")
            and existing.get("run_id") == payload.get("run_id")
        ):
            payload["cancel_requested"] = True
    raw["semantic_discovery_progress"] = payload
    kb_row.settings = raw
    db.commit()
    return payload


class DiscoveryCancelled(RuntimeError):
    """Raised when discovery is cancelled by user."""


class DiscoverySuperseded(RuntimeError):
    """Raised when discovery is superseded by another run."""


def _get_discovery_abort_reason(db: Session, kb_row: KBModel, run_id: str) -> Optional[str]:
    try:
        db.refresh(kb_row)
    except Exception:
        try:
            db.expire(kb_row)
        except Exception:
            return None
    progress = _get_discovery_progress(kb_row)
    if not progress:
        return None
    current_run_id = progress.get("run_id")
    if current_run_id and current_run_id != run_id:
        return "superseded"
    if progress.get("cancel_requested") and current_run_id == run_id:
        return "cancelled"
    status_value = progress.get("status")
    if status_value == "cancelled":
        return "cancelled"
    return None


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


def _normalize_chunk_text(text: str) -> str:
    return " ".join((text or "").split()).strip().lower()


def _iter_batches(items: List[Any], batch_size: int) -> List[List[Any]]:
    if batch_size <= 1:
        return [[item] for item in items]
    return [items[i : i + batch_size] for i in range(0, len(items), batch_size)]


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


def _coerce_discovery_mode(value: Optional[str], default: str) -> str:
    if value in ("facts", "insights"):
        return value
    return default


def _coerce_insight_scope(value: Optional[str], default: str) -> str:
    if value in ("document", "cross"):
        return value
    return default


def _coerce_insight_domain(value: Optional[str], default: str) -> str:
    cleaned = str(value or "").strip().lower()
    if cleaned:
        return cleaned
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


def _normalize_candidate_key(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip().lower()
    cleaned = cleaned.strip(".,;:/\\|")
    return cleaned


def _merge_aliases(existing: Optional[List[str]], incoming: Optional[List[str]], name: str) -> List[str]:
    merged: List[str] = []
    seen = set()

    def push(value: str) -> None:
        cleaned = str(value or "").strip()
        if not cleaned:
            return
        key = cleaned.lower()
        if key in seen:
            return
        if _normalize_candidate_key(cleaned) == _normalize_candidate_key(name):
            return
        seen.add(key)
        merged.append(cleaned)

    for item in existing or []:
        push(item)
    for item in incoming or []:
        push(item)
    return merged


def _merge_evidence(
    existing: Optional[List[Dict[str, Any]]],
    incoming: Optional[List[Dict[str, Any]]],
    limit: int = 8,
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[tuple[Any, Any, str]] = set()

    def add(item: Any) -> None:
        if not isinstance(item, dict):
            return
        doc_id = item.get("document_id")
        chunk_index = item.get("chunk_index")
        snippet = str(item.get("snippet") or "").strip()
        key = (doc_id, chunk_index, snippet[:120])
        if key in seen:
            return
        seen.add(key)
        merged.append(item)

    for item in existing or []:
        add(item)
    for item in incoming or []:
        add(item)
    return merged[:limit]


def _parse_constraint_strength(raw: Any) -> str:
    value = str(raw or "").strip().lower()
    if value in ("soft", "warn", "advisory", "weak"):
        return "soft"
    if value in ("hard", "strict", "force", "required", "strong"):
        return "hard"
    return "hard"


def _is_noise_name(value: str) -> bool:
    cleaned = (value or "").strip()
    if not cleaned:
        return True
    if NOISE_URL_PATTERN.search(cleaned):
        return True
    if NOISE_DOI_PATTERN.search(cleaned):
        return True
    if NOISE_ISBN_PATTERN.search(cleaned):
        return True
    if NOISE_FILE_PATTERN.search(cleaned):
        return True
    return False


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


def _build_insight_ref(doc_id: Optional[int], chunk_index: Optional[int]) -> str:
    if doc_id is None:
        return ""
    idx = chunk_index if chunk_index is not None else 0
    return f"D{doc_id}-C{idx}"


def _parse_refs(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        refs = [str(v).strip() for v in value if str(v).strip()]
    else:
        text = str(value or "").strip()
        refs = [ref.strip() for ref in re.split(r"[,\s]+", text) if ref.strip()]
    seen = set()
    cleaned: List[str] = []
    for ref in refs:
        if ref in seen:
            continue
        seen.add(ref)
        cleaned.append(ref)
    return cleaned


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


def _find_first_json_array(raw: str) -> Optional[str]:
    start = raw.find("[")
    if start < 0:
        return None
    depth = 0
    for idx in range(start, len(raw)):
        ch = raw[idx]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return raw[start : idx + 1]
    return None


def _find_last_json_array(raw: str) -> Optional[str]:
    end = raw.rfind("]")
    if end < 0:
        return None
    depth = 0
    for idx in range(end, -1, -1):
        ch = raw[idx]
        if ch == "]":
            depth += 1
        elif ch == "[":
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


def _extract_json_array(raw: str) -> Optional[List[Any]]:
    if not raw:
        return None
    text = raw.strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass
    fence = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if fence:
        try:
            parsed = json.loads(fence.group(1))
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    candidate = _find_first_json_array(text)
    if candidate:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
    candidate = _find_last_json_array(text)
    if not candidate:
        return None
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        return None
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


def _build_insight_prompt(
    segments: List[Dict[str, str]],
    *,
    max_items: int,
    domain: str,
    scope: str,
) -> str:
    schema = (
        '{"insights":[{"statement":"","type":"","confidence":0.0,'
        '"relation":{"source":"","relation":"","target":""},"refs":[""],"notes":""}]}'
    )
    domain_note = (
        "Use domain-appropriate reasoning but do not provide legal/medical advice. "
        "Mark uncertainty explicitly."
    )
    instructions = [
        "Identify causal, logical, and implied relationships plus latent insights.",
        "Prefer multi-step reasoning over surface restatements.",
        "Only use the provided text; do not add external knowledge.",
        f"Limit to {max_items} insights. If none, return an empty list.",
        f"Allowed types: {', '.join(INSIGHT_TYPES)}.",
        "If an insight is a relationship between entities, fill the relation object; otherwise leave it empty.",
        "Use refs to cite which segments support the insight.",
        "In notes, give a brief reasoning chain (premise -> inference -> conclusion) and mention assumptions.",
        "If evidence is weak, lower confidence and explain the uncertainty in notes.",
        domain_note,
        f"Domain: {domain}. Scope: {scope}.",
        f"Return ONLY valid JSON using this schema: {schema}",
    ]
    blocks = []
    for seg in segments:
        ref = seg.get("ref") or ""
        text = seg.get("text") or ""
        source = seg.get("source") or ""
        header = f"[{ref} | {source}]".strip()
        blocks.append(f"{header}\n{text}")
    joined = "\n\n".join(blocks)
    return f"{chr(10).join(instructions)}\n\nSegments:\n{joined}"


def _build_structure_prompt(
    segments: List[Dict[str, str]],
    *,
    max_items: int,
    domain: str,
) -> str:
    schema = (
        '{"structures":[{"title":"","level":1,"parent":"","summary":"",'
        '"confidence":0.0,"refs":[""]}]}'
    )
    instructions = [
        "Build a concise outline of the document structure.",
        "Use only the provided text; do not invent sections.",
        f"Limit to {max_items} structure nodes.",
        "Use levels 1-4. Use parent to express hierarchy (leave empty for top level).",
        "Use refs to cite which segments support the structure node.",
        f"Domain: {domain}.",
        f"Return ONLY valid JSON using this schema: {schema}",
    ]
    blocks = []
    for seg in segments:
        ref = seg.get("ref") or ""
        text = seg.get("text") or ""
        source = seg.get("source") or ""
        header = f"[{ref} | {source}]".strip()
        blocks.append(f"{header}\n{text}")
    joined = "\n\n".join(blocks)
    return f"{chr(10).join(instructions)}\n\nSegments:\n{joined}"


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


async def _ensure_document_chunks(
    db: Session,
    kb: KBModel,
    doc: Document,
    tenant_id: int,
) -> int:
    existing = (
        db.query(func.count(DocumentChunk.id))
        .filter(
            DocumentChunk.document_id == doc.id,
            DocumentChunk.tenant_id == tenant_id,
        )
        .scalar()
        or 0
    )
    if existing > 0:
        if int(getattr(doc, "total_chunks", 0) or 0) != int(existing):
            doc.total_chunks = int(existing)
            db.add(doc)
            db.commit()
        return int(existing)

    try:
        from app.services.backfill_service import run_backfill

        await run_backfill(
            tenant_id=tenant_id,
            kb_name=doc.knowledge_base_name,
            document_id=doc.id,
            force=False,
            dry_run=False,
        )
    except Exception as exc:
        logger.warning("Semantic discovery backfill from Milvus failed", error=str(exc), doc_id=doc.id)

    existing = (
        db.query(func.count(DocumentChunk.id))
        .filter(
            DocumentChunk.document_id == doc.id,
            DocumentChunk.tenant_id == tenant_id,
        )
        .scalar()
        or 0
    )
    if existing > 0:
        doc.total_chunks = int(existing)
        db.add(doc)
        db.commit()
        return int(existing)

    try:
        from app.core.config import settings
        from app.services import parser_service
        from app.services.chunking_service import ChunkingStrategy, chunking_service
        from app.services.storage_service import storage_service

        if doc.file_path and storage_service.exists(doc.file_path):
            raw = storage_service.read_bytes(doc.file_path)
            text = parser_service.parse_document(raw, doc.filename)
            chunk_size = int(getattr(kb, "chunk_size", 0) or settings.CHUNK_SIZE)
            chunk_overlap = int(getattr(kb, "chunk_overlap", 0) or settings.CHUNK_OVERLAP)
            chunks_all = await chunking_service.chunk_document(
                text=text,
                strategy=ChunkingStrategy.RECURSIVE,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )
            if chunks_all:
                try:
                    DocumentChunk.__table__.create(  # type: ignore[attr-defined]
                        bind=db.get_bind(),
                        checkfirst=True,
                    )
                except Exception:
                    pass
                rows = [
                    DocumentChunk(
                        tenant_id=tenant_id,
                        document_id=doc.id,
                        knowledge_base_name=doc.knowledge_base_name,
                        chunk_index=i,
                        text=str(t or ""),
                        milvus_pk=None,
                    )
                    for i, t in enumerate(chunks_all)
                ]
                db.bulk_save_objects(rows)
                doc.total_chunks = len(rows)
                db.add(doc)
                db.commit()
                return len(rows)
    except Exception as exc:
        logger.warning("Semantic discovery backfill from file failed", error=str(exc), doc_id=doc.id)

    return 0


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
    if status_value not in ("idle", "running", "completed", "failed", "cancelled"):
        status_value = "idle"
    return SemanticDiscoveryProgressResponse(
        status=str(status_value or "idle"),
        current=int(progress.get("current") or 0),
        total=int(progress.get("total") or 0),
        current_chunks=progress.get("current_chunks"),
        total_chunks=progress.get("total_chunks"),
        processed_chunks_total=progress.get("processed_chunks_total"),
        planned_chunks_total=progress.get("planned_chunks_total"),
        document_label=progress.get("document_label"),
        last_chunk_index=progress.get("last_chunk_index"),
        cancel_requested=progress.get("cancel_requested"),
        run_id=progress.get("run_id"),
        started_at=progress.get("started_at"),
        updated_at=progress.get("updated_at"),
        message=progress.get("message"),
    )


@router.post("/discover/cancel")
def cancel_discovery(
    kb_name: str,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    progress = _get_discovery_progress(kb)
    if not progress:
        return {"status": "idle"}
    status_value = progress.get("status")
    if status_value != "running":
        return {"status": status_value or "idle"}
    progress["cancel_requested"] = True
    progress["updated_at"] = _now_iso()
    progress["message"] = "已请求终止，等待当前请求结束后停止"
    _set_discovery_progress(db, kb, progress)
    return {"status": "cancelling"}


async def _discover_candidates_background(
    request_payload: Dict[str, Any],
    kb_name: str,
    tenant_id: int,
    user_id: int,
) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            logger.warning("Semantic discovery background aborted: user missing", user_id=user_id)
            return
        request = SemanticDiscoveryRequest(**request_payload)
        await discover_candidates(
            request=request,
            kb_name=kb_name,
            tenant_id=tenant_id,
            db=db,
            current_user=user,
            background_tasks=BackgroundTasks(),
        )
    except Exception as exc:
        logger.warning("Semantic discovery background failed", error=str(exc))
    finally:
        db.close()


@router.post("/discover", response_model=SemanticDiscoveryResponse)
async def discover_candidates(
    request: SemanticDiscoveryRequest,
    kb_name: str,
    background_tasks: BackgroundTasks,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(PermissionType.KNOWLEDGE_BASE_UPDATE.value)),
):
    kb = _get_kb(db, tenant_id, kb_name)
    if not _can_write_kb(kb, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    if request.run_async:
        progress_payload = {
            "status": "running",
            "current": 0,
            "total": 0,
            "current_chunks": 0,
            "total_chunks": 0,
            "processed_chunks_total": 0,
            "planned_chunks_total": 0,
            "document_label": None,
            "last_chunk_index": None,
            "cancel_requested": False,
            "run_id": uuid.uuid4().hex,
            "started_at": _now_iso(),
            "updated_at": _now_iso(),
            "message": "Queued",
        }
        _set_discovery_progress(db, kb, progress_payload)
        payload = request.dict()
        payload["run_async"] = False
        background_tasks.add_task(
            _discover_candidates_background,
            payload,
            kb_name,
            tenant_id,
            current_user.id,
        )
        return SemanticDiscoveryResponse(created=0, skipped=0, total=0)

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
    full_chunk_scan = bool(request.full_chunk_scan)
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
    if request.max_chunks is not None or full_chunk_scan:
        auto_chunking = False
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
    default_batch_size = (
        EXTRACTION_FULL_SCAN_BATCH_SIZE if full_chunk_scan else EXTRACTION_DEFAULT_BATCH_SIZE
    )
    batch_size = _coerce_int(
        request.batch_size,
        default_batch_size,
        1,
        EXTRACTION_MAX_BATCH_SIZE,
    )
    default_concurrency = (
        EXTRACTION_FULL_SCAN_CONCURRENCY if full_chunk_scan else EXTRACTION_DEFAULT_CONCURRENCY
    )
    batch_concurrency = _coerce_int(
        request.batch_concurrency,
        default_concurrency,
        1,
        EXTRACTION_MAX_CONCURRENCY,
    )
    if progressive_enabled:
        batch_size = 1
        batch_concurrency = 1
    entity_type_whitelist = _parse_whitelist(
        request.entity_types if request.entity_types is not None else config_entity_whitelist
    )
    relation_type_whitelist = _parse_whitelist(
        request.relation_types
        if request.relation_types is not None
        else config_relation_whitelist
    )
    allowed_attribute_keys: Optional[set[str]] = None
    enforce_entity_types = False
    enforce_relation_types = False
    enforce_attribute_keys = False
    reference_entity_types: List[str] = []
    reference_relation_types: List[str] = []
    reference_attribute_keys: List[str] = []
    ontology_items = _get_active_ontology_items(db, kb.id, tenant_id)
    if ontology_items:
        ontology_entity_types, enforce_entity_types = _collect_ontology_constraints(
            ontology_items.get("entity_type", [])
        )
        ontology_relation_types, enforce_relation_types = _collect_ontology_constraints(
            ontology_items.get("relation_type", [])
        )
        ontology_attribute_keys, enforce_attribute_keys = _collect_ontology_constraints(
            ontology_items.get("attribute_type", [])
        )
        if ontology_entity_types:
            reference_entity_types = ontology_entity_types
            if enforce_entity_types:
                if entity_type_whitelist:
                    allowed = {_normalize_type(item) for item in ontology_entity_types}
                    entity_type_whitelist = [
                        item for item in entity_type_whitelist if _normalize_type(item) in allowed
                    ]
                else:
                    entity_type_whitelist = ontology_entity_types
        if ontology_relation_types:
            reference_relation_types = ontology_relation_types
            if enforce_relation_types:
                if relation_type_whitelist:
                    allowed = {_normalize_type(item) for item in ontology_relation_types}
                    relation_type_whitelist = [
                        item for item in relation_type_whitelist if _normalize_type(item) in allowed
                    ]
                else:
                    relation_type_whitelist = ontology_relation_types
        if ontology_attribute_keys:
            reference_attribute_keys = ontology_attribute_keys
            if enforce_attribute_keys:
                allowed_attribute_keys = {_normalize_type(item) for item in ontology_attribute_keys}
    entity_type_set = {_normalize_type(item) for item in entity_type_whitelist}
    relation_type_set = {_normalize_type(item) for item in relation_type_whitelist}
    reference_entity_type_set = {_normalize_type(item) for item in reference_entity_types}
    reference_relation_type_set = {_normalize_type(item) for item in reference_relation_types}
    reference_attribute_key_set = {_normalize_type(item) for item in reference_attribute_keys}
    discovery_mode = _coerce_discovery_mode(
        request.discovery_mode, EXTRACTION_DEFAULT_DISCOVERY_MODE
    )
    insight_scope = _coerce_insight_scope(request.insight_scope, INSIGHT_DEFAULT_SCOPE)
    if discovery_mode == "insights" and request.insight_scope not in ("document", "cross"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Insight scope is required",
        )
    insight_domain = _coerce_insight_domain(request.insight_domain, INSIGHT_DEFAULT_DOMAIN)
    insight_adaptive_chunks = False
    config_max_chunks_is_default = True
    config_max_text_chars_is_default = True
    config_max_items_is_default = True
    config_chunk_strategy_is_default = True
    try:
        config_max_chunks_is_default = (
            config_max_chunks is None
            or int(config_max_chunks) == EXTRACTION_DEFAULT_MAX_CHUNKS
        )
    except Exception:
        config_max_chunks_is_default = True
    try:
        config_max_text_chars_is_default = (
            config_max_text_chars is None
            or int(config_max_text_chars) == EXTRACTION_DEFAULT_MAX_TEXT_CHARS
        )
    except Exception:
        config_max_text_chars_is_default = True
    try:
        config_max_items_is_default = (
            config_max_items is None or int(config_max_items) == EXTRACTION_DEFAULT_MAX_ITEMS
        )
    except Exception:
        config_max_items_is_default = True
    config_chunk_strategy_is_default = (
        config_chunk_strategy is None
        or str(config_chunk_strategy).strip().lower() == EXTRACTION_DEFAULT_CHUNK_STRATEGY
    )
    if discovery_mode == "insights":
        if request.max_chunks is None and config_max_chunks_is_default:
            max_chunks = _coerce_int(
                INSIGHT_DEFAULT_MAX_CHUNKS,
                max_chunks,
                EXTRACTION_MIN_CHUNKS,
                EXTRACTION_MAX_CHUNKS_LIMIT,
            )
            insight_adaptive_chunks = True
        if request.max_text_chars is None and config_max_text_chars_is_default:
            max_text_chars = _coerce_int(
                INSIGHT_DEFAULT_MAX_TEXT_CHARS,
                max_text_chars,
                EXTRACTION_MIN_TEXT_CHARS,
                EXTRACTION_MAX_TEXT_CHARS_LIMIT,
            )
        if request.max_items is None and config_max_items_is_default:
            max_items = _coerce_int(
                INSIGHT_DEFAULT_MAX_ITEMS,
                max_items,
                EXTRACTION_MIN_ITEMS,
                EXTRACTION_MAX_ITEMS_LIMIT,
            )
        if request.chunk_strategy is None and config_chunk_strategy_is_default:
            chunk_strategy = INSIGHT_DEFAULT_CHUNK_STRATEGY

    document_ids: List[int] = []
    if request.document_ids:
        for raw in request.document_ids:
            try:
                document_ids.append(int(raw))
            except Exception:
                continue
    if document_ids:
        document_ids = sorted(set(document_ids))

    if request.scope == "selected" and not document_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No documents selected")
    if discovery_mode == "insights" and insight_scope == "document":
        if len(document_ids) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insight single-document mode requires exactly one document",
            )

    signature_payload = {
        "scope": request.scope,
        "document_ids": document_ids,
        "document_limit": document_limit,
        "include_relations": request.include_relations,
        "max_chunks": max_chunks,
        "max_text_chars": max_text_chars,
        "max_items": max_items,
        "full_chunk_scan": full_chunk_scan,
        "batch_size": batch_size,
        "batch_concurrency": batch_concurrency,
        "auto_chunking": auto_chunking,
        "chunk_strategy": chunk_strategy,
        "mode": extraction_mode,
        "progressive_enabled": progressive_enabled,
        "progressive_min_items": progressive_min_items,
        "progressive_step": progressive_step,
        "summary_max_chars": summary_max_chars,
        "entity_types": sorted(entity_type_whitelist),
        "relation_types": sorted(relation_type_whitelist),
        "discovery_mode": discovery_mode,
        "insight_scope": insight_scope,
        "insight_domain": insight_domain,
    }
    request_signature = _build_discovery_signature(signature_payload)
    resume_enabled = request.resume if request.resume is not None else True
    resume_doc_ids: Optional[List[int]] = None
    resume_last_document_id: Optional[int] = None
    resume_last_chunk_index: Optional[int] = None
    resume_processed_chunks_total = 0
    if resume_enabled and not request.reset:
        progress_state = _get_discovery_progress(kb)
        if str(progress_state.get("status") or "") in ("failed", "cancelled"):
            prev_signature = progress_state.get("request_signature")
            if prev_signature and prev_signature == request_signature:
                prev_doc_ids = progress_state.get("document_ids")
                if isinstance(prev_doc_ids, list) and prev_doc_ids:
                    resume_doc_ids = []
                    for raw in prev_doc_ids:
                        try:
                            resume_doc_ids.append(int(raw))
                        except Exception:
                            continue
                if resume_doc_ids:
                    raw_last_doc = progress_state.get("last_document_id")
                    if raw_last_doc is not None:
                        try:
                            resume_last_document_id = int(raw_last_doc)
                        except Exception:
                            resume_last_document_id = None
                    raw_last_chunk = progress_state.get("last_chunk_index")
                    if raw_last_chunk is not None:
                        try:
                            resume_last_chunk_index = int(raw_last_chunk)
                        except Exception:
                            resume_last_chunk_index = None
                raw_processed_chunks = progress_state.get("processed_chunks_total")
                if raw_processed_chunks is not None:
                    try:
                        resume_processed_chunks_total = int(raw_processed_chunks)
                    except Exception:
                        resume_processed_chunks_total = 0

    if resume_doc_ids:
        document_ids = resume_doc_ids

    q = db.query(Document).filter(
        Document.tenant_id == tenant_id,
        Document.knowledge_base_name == kb.name,
    )
    if document_ids:
        q = q.filter(Document.id.in_(document_ids)).order_by(Document.created_at.asc())
    else:
        if request.scope == "recent":
            cutoff = datetime.utcnow() - timedelta(days=30)
            q = q.filter(Document.created_at >= cutoff).order_by(Document.created_at.desc())
        else:
            q = q.order_by(Document.created_at.asc())
        if document_limit:
            q = q.limit(max(1, int(document_limit)))
    docs = q.all()
    if document_ids and not docs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected documents not found")
    if resume_doc_ids:
        order_map = {doc_id: idx for idx, doc_id in enumerate(resume_doc_ids)}
        docs.sort(key=lambda doc: order_map.get(doc.id, len(order_map)))
        docs = [doc for doc in docs if doc.id in order_map]
    doc_ids = [doc.id for doc in docs]
    total_docs = len(doc_ids)
    resume_offset = 0
    if resume_doc_ids and resume_last_document_id is not None:
        try:
            resume_offset = doc_ids.index(resume_last_document_id)
            if resume_last_chunk_index is None:
                resume_offset += 1
        except ValueError:
            resume_offset = 0
            resume_last_document_id = None
            resume_last_chunk_index = None
    if discovery_mode == "insights" and insight_scope == "cross":
        resume_offset = 0
        resume_last_document_id = None
        resume_last_chunk_index = None

    run_id = uuid.uuid4().hex
    progress_payload = {
        "status": "running",
        "current": resume_offset,
        "total": total_docs,
        "current_chunks": 0,
        "total_chunks": 0,
        "processed_chunks_total": resume_processed_chunks_total,
        "planned_chunks_total": 0,
        "document_label": None,
        "document_ids": doc_ids,
        "last_document_id": resume_last_document_id,
        "last_chunk_index": resume_last_chunk_index,
        "cancel_requested": False,
        "request_signature": request_signature,
        "run_id": run_id,
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "message": None,
    }
    _set_discovery_progress(db, kb, progress_payload)
    last_progress_update = 0.0
    last_cancel_check = 0.0
    processed_chunks = 0
    planned_chunks = 0
    processed_chunks_total = resume_processed_chunks_total
    planned_chunks_total = 0
    processed_chunks_total_base = resume_processed_chunks_total
    last_chunk_index: Optional[int] = resume_last_chunk_index

    def check_cancelled(force: bool = False) -> None:
        nonlocal last_cancel_check
        now = time.monotonic()
        if not force and (now - last_cancel_check) < 0.8:
            return
        last_cancel_check = now
        reason = _get_discovery_abort_reason(db, kb, run_id)
        if reason == "cancelled":
            raise DiscoveryCancelled()
        if reason == "superseded":
            raise DiscoverySuperseded()

    def bump_processed_chunks() -> None:
        nonlocal processed_chunks, processed_chunks_total
        processed_chunks = min(planned_chunks, processed_chunks + 1)
        processed_chunks_total = processed_chunks_total_base + processed_chunks
        maybe_update_progress()

    def update_last_chunk_index(evidence_list: List[Dict[str, Any]]) -> None:
        nonlocal last_chunk_index
        for item in evidence_list:
            if not isinstance(item, dict):
                continue
            idx = item.get("chunk_index")
            if idx is None:
                continue
            try:
                idx_value = int(idx)
            except Exception:
                continue
            last_chunk_index = (
                idx_value if last_chunk_index is None else max(last_chunk_index, idx_value)
            )
            return

    def maybe_update_progress(force: bool = False) -> None:
        nonlocal last_progress_update
        check_cancelled()
        now = time.monotonic()
        if not force and (now - last_progress_update) < 0.8:
            return
        last_progress_update = now
        progress_payload["current_chunks"] = processed_chunks
        progress_payload["total_chunks"] = planned_chunks
        progress_payload["processed_chunks_total"] = processed_chunks_total
        progress_payload["planned_chunks_total"] = planned_chunks_total
        progress_payload["last_chunk_index"] = last_chunk_index
        progress_payload["updated_at"] = _now_iso()
        _set_discovery_progress(db, kb, progress_payload)
    if total_docs == 0 or resume_offset >= total_docs:
        progress_payload["status"] = "completed"
        progress_payload["updated_at"] = _now_iso()
        progress_payload["processed_chunks_total"] = 0
        progress_payload["planned_chunks_total"] = 0
        progress_payload["last_chunk_index"] = None
        progress_payload["cancel_requested"] = False
        _set_discovery_progress(db, kb, progress_payload)
        total = (
            db.query(SemanticCandidate)
            .filter(
                SemanticCandidate.tenant_id == tenant_id,
                SemanticCandidate.knowledge_base_id == kb.id,
            )
            .count()
        )
        return SemanticDiscoveryResponse(created=0, skipped=0, total=total)

    existing_candidates = {
        (c.type, _normalize_candidate_key(c.name)): c
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
    updated_existing = False

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
        nonlocal created, skipped, updated_existing
        cleaned = (name or "").strip()
        if not cleaned:
            return False
        cleaned = cleaned[:255]
        key = (candidate_type, _normalize_candidate_key(cleaned))
        if key in existing_candidates:
            candidate = existing_candidates[key]
            updated = False
            if evidence:
                merged = _merge_evidence(candidate.evidence, evidence)
                if merged != (candidate.evidence or []):
                    candidate.evidence = merged
                    updated = True
            if aliases:
                merged_aliases = _merge_aliases(candidate.aliases, aliases, candidate.name or cleaned)
                if merged_aliases != (candidate.aliases or []):
                    candidate.aliases = merged_aliases
                    updated = True
            if relation and not candidate.relation:
                candidate.relation = relation
                updated = True
            if attributes:
                current_attrs = candidate.attributes or {}
                next_attrs = dict(current_attrs)
                for key_name, value in attributes.items():
                    if value is None:
                        continue
                    if key_name not in next_attrs or next_attrs.get(key_name) in (None, ""):
                        next_attrs[key_name] = value
                if candidate_type == "entity":
                    existing_type = str(next_attrs.get("entity_type") or "").strip()
                    new_type = str(attributes.get("entity_type") or "").strip()
                    if new_type and existing_type and _normalize_type(existing_type) != _normalize_type(new_type):
                        conflicts = list(next_attrs.get("type_conflicts") or [])
                        if new_type not in conflicts:
                            conflicts.append(new_type)
                            next_attrs["type_conflicts"] = conflicts
                    elif new_type and not existing_type:
                        next_attrs["entity_type"] = new_type
                if candidate_type == "attribute":
                    new_value = attributes.get("value")
                    existing_value = next_attrs.get("value")
                    if new_value is not None and existing_value is not None and str(existing_value) != str(new_value):
                        conflicts = list(next_attrs.get("value_conflicts") or [])
                        conflicts.append({"value": new_value})
                        next_attrs["value_conflicts"] = conflicts
                    elif new_value is not None and existing_value is None:
                        next_attrs["value"] = new_value
                if next_attrs != current_attrs:
                    candidate.attributes = next_attrs
                    updated = True
            if confidence is not None:
                if candidate.confidence is None:
                    candidate.confidence = float(confidence)
                    updated = True
                else:
                    next_confidence = max(float(candidate.confidence), float(confidence))
                    if next_confidence != candidate.confidence:
                        candidate.confidence = next_confidence
                        updated = True
            if updated and candidate.id is not None:
                updated_existing = True
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
        existing_candidates[key] = candidate
        created += 1
        return True

    def flush_candidates() -> None:
        nonlocal updated_existing
        if not candidates_to_add and not updated_existing:
            return
        if candidates_to_add:
            db.add_all(candidates_to_add)
        db.commit()
        candidates_to_add.clear()
        updated_existing = False

    def flush_candidates_safe() -> None:
        nonlocal updated_existing
        if not candidates_to_add and not updated_existing:
            return
        try:
            if candidates_to_add:
                db.add_all(candidates_to_add)
            db.commit()
        except Exception:
            db.rollback()
        finally:
            candidates_to_add.clear()
            updated_existing = False

    def append_constraint_violation(
        attributes_payload: Dict[str, Any],
        *,
        kind: str,
        value: str,
        allowed: List[str],
    ) -> None:
        if not value or not allowed:
            return
        violations = list(attributes_payload.get("constraint_violations") or [])
        violations.append(
            {
                "kind": kind,
                "value": value,
                "allowed_sample": allowed[:5],
                "allowed_total": len(allowed),
                "strength": "soft",
            }
        )
        attributes_payload["constraint_violations"] = violations

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

    async def build_segments(
        sources: List[tuple[str, List[Dict[str, Any]]]],
        *,
        max_chars: int,
        track_progress: bool = False,
    ) -> tuple[List[Dict[str, str]], Dict[str, Dict[str, Any]]]:
        segments: List[Dict[str, str]] = []
        evidence_map: Dict[str, Dict[str, Any]] = {}
        nonlocal processed_chunks
        for text, evidence in sources:
            if track_progress:
                update_last_chunk_index(evidence)
                bump_processed_chunks()
            if not evidence:
                continue
            base_ev = evidence[0]
            ref = _build_insight_ref(base_ev.get("document_id"), base_ev.get("chunk_index"))
            if not ref:
                continue
            segment_text = await summarize_text(text)
            segment_text = _truncate_text(segment_text, max_chars)
            if not segment_text:
                continue
            segments.append(
                {
                    "ref": ref,
                    "text": segment_text,
                    "source": str(base_ev.get("source") or ""),
                }
            )
            evidence_map[ref] = base_ev
        return segments, evidence_map

    async def extract_insights(
        segments: List[Dict[str, str]],
        evidence_map: Dict[str, Dict[str, Any]],
        scope: str,
    ) -> bool:
        if not segments:
            return False
        prompt = _build_insight_prompt(
            segments,
            max_items=max_items,
            domain=insight_domain,
            scope=scope,
        )
        try:
            llm_response = await llm_service.chat(
                message=prompt,
                model=model_name,
                temperature=0.2,
                max_tokens=1200,
                tenant_id=tenant_id,
                user_id=current_user.id,
            )
        except Exception as exc:
            logger.warning("LLM insight extraction failed", error=str(exc))
            return False
        if not llm_response.get("success"):
            logger.warning(
                "LLM insight extraction returned failure",
                error=str(llm_response.get("error") or llm_response.get("message")),
            )
            return False
        raw_message = llm_response.get("message") or ""
        payload = _extract_json_payload(raw_message)
        insights: Any = []
        if isinstance(payload, dict):
            insights = payload.get("insights") or payload.get("items") or payload.get("data") or []
            if isinstance(insights, dict):
                insights = insights.get("insights") or insights.get("items") or []
        elif isinstance(payload, list):
            insights = payload
        if not isinstance(insights, list):
            insights = []
        if not insights:
            alt = _extract_json_array(raw_message)
            if isinstance(alt, list):
                insights = alt
        if not isinstance(insights, list) or not insights:
            return False
        extracted_any = False
        fallback_evidence = list(evidence_map.values())[:1]
        for item in insights[:max_items]:
            if not isinstance(item, dict):
                continue
            statement = str(item.get("statement") or item.get("summary") or "").strip()
            if not statement:
                continue
            insight_type = str(item.get("type") or "").strip().lower()
            if insight_type not in INSIGHT_TYPES:
                insight_type = "implied"
            confidence = coerce_confidence(item.get("confidence"), 0.6)
            refs = _parse_refs(item.get("refs"))
            evidence: List[Dict[str, Any]] = []
            for ref in refs:
                ev = evidence_map.get(ref)
                if ev:
                    evidence.append(dict(ev))
            if not evidence and fallback_evidence:
                evidence = [dict(fallback_evidence[0])]
            relation_payload = None
            if isinstance(item.get("relation"), dict):
                rel = item.get("relation") or {}
                source = str(rel.get("source") or "").strip()
                target = str(rel.get("target") or "").strip()
                relation_name = str(rel.get("relation") or "").strip()
                if source and target:
                    relation_payload = {
                        "source": source,
                        "relation": relation_name or "RELATED_TO",
                        "target": target,
                    }
            attributes = {
                "insight_type": insight_type,
                "scope": scope,
            }
            notes = item.get("notes") or item.get("reason")
            if isinstance(notes, str) and notes.strip():
                attributes["notes"] = notes.strip()
            if refs:
                attributes["refs"] = refs
            if add_candidate(
                "insight",
                statement,
                evidence,
                confidence=confidence,
                relation=relation_payload,
                attributes=attributes,
            ):
                extracted_any = True
        return extracted_any

    async def extract_structures(
        segments: List[Dict[str, str]],
        evidence_map: Dict[str, Dict[str, Any]],
        *,
        doc_label: str,
        doc_id: int,
    ) -> bool:
        if not segments:
            return False
        prompt = _build_structure_prompt(
            segments,
            max_items=min(max_items, STRUCTURE_DEFAULT_MAX_ITEMS),
            domain=insight_domain,
        )
        try:
            llm_response = await llm_service.chat(
                message=prompt,
                model=model_name,
                temperature=0.2,
                max_tokens=700,
                tenant_id=tenant_id,
                user_id=current_user.id,
            )
        except Exception as exc:
            logger.warning("LLM structure extraction failed", error=str(exc))
            return False
        if not llm_response.get("success"):
            logger.warning(
                "LLM structure extraction returned failure",
                error=str(llm_response.get("error") or llm_response.get("message")),
            )
            return False

        raw_message = llm_response.get("message") or ""
        payload = _extract_json_payload(raw_message)
        structures: Any = []
        if isinstance(payload, dict):
            structures = payload.get("structures") or payload.get("items") or payload.get("data") or []
        elif isinstance(payload, list):
            structures = payload
        if not isinstance(structures, list) or not structures:
            alt = _extract_json_array(raw_message)
            if isinstance(alt, list):
                structures = alt
        if not isinstance(structures, list) or not structures:
            return False

        extracted_any = False
        fallback_evidence = list(evidence_map.values())[:1]
        for item in structures[: max_items]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            level = item.get("level")
            try:
                level_value = int(level)
            except Exception:
                level_value = None
            parent = str(item.get("parent") or "").strip()
            summary = str(item.get("summary") or "").strip()
            confidence = coerce_confidence(item.get("confidence"), 0.6)
            refs = _parse_refs(item.get("refs"))
            evidence: List[Dict[str, Any]] = []
            for ref in refs:
                ev = evidence_map.get(ref)
                if ev:
                    evidence.append(ev)
            if not evidence:
                evidence = fallback_evidence
            raw_name = f"{doc_label} / {title}"
            name = raw_name[:255].strip()
            if add_candidate(
                "structure",
                name,
                evidence,
                confidence=confidence,
                attributes={
                    "title": title,
                    "level": level_value,
                    "parent": parent or None,
                    "summary": summary or None,
                    "doc_id": doc_id,
                    "doc": doc_label,
                },
            ):
                extracted_any = True
            if parent and request.include_relations:
                raw_parent = f"{doc_label} / {parent}"
                parent_name = raw_parent[:255].strip()
                rel_name = f"{name} -> {STRUCTURE_RELATION_LABEL} -> {parent_name}"
                add_candidate(
                    "relation",
                    rel_name,
                    evidence,
                    confidence=max(0.5, confidence),
                    relation={
                        "source": name,
                        "relation": STRUCTURE_RELATION_LABEL,
                        "target": parent_name,
                    },
                    attributes={"relation_kind": "structure"},
                )
        return extracted_any

    docs = docs[resume_offset:]
    doc_start_index = resume_offset + 1

    cross_segments: List[Dict[str, str]] = []
    cross_evidence_map: Dict[str, Dict[str, Any]] = {}

    try:
        for doc_index, doc in enumerate(docs, start=doc_start_index):
            check_cancelled()
            if resume_last_document_id is not None and doc.id == resume_last_document_id:
                last_chunk_index = resume_last_chunk_index
            else:
                last_chunk_index = None
            chunk_q = (
                db.query(DocumentChunk)
                .filter(
                    DocumentChunk.document_id == doc.id,
                    DocumentChunk.tenant_id == tenant_id,
                )
                .order_by(DocumentChunk.chunk_index.asc())
            )
            existing_count = int(
                db.query(func.count(DocumentChunk.id))
                .filter(
                    DocumentChunk.document_id == doc.id,
                    DocumentChunk.tenant_id == tenant_id,
                )
                .scalar()
                or 0
            )
            if existing_count <= 0:
                existing_count = await _ensure_document_chunks(db, kb, doc, tenant_id)
            elif int(getattr(doc, "total_chunks", 0) or 0) != existing_count:
                doc.total_chunks = existing_count
                db.add(doc)
                db.commit()
            total_chunks = existing_count
            chunk_plan: List[DocumentChunk] = []
            if total_chunks > 0:
                if full_chunk_scan:
                    chunk_plan = chunk_q.all()
                else:
                    effective_max_chunks = min(max_chunks, total_chunks) if max_chunks else total_chunks
                    if discovery_mode == "insights" and insight_adaptive_chunks:
                        auto_target = max(
                            INSIGHT_DEFAULT_MAX_CHUNKS,
                            int(round(math.sqrt(total_chunks))),
                        )
                        auto_target = min(auto_target, EXTRACTION_MAX_CHUNKS_LIMIT)
                        effective_max_chunks = min(total_chunks, max(effective_max_chunks, auto_target))
                    elif auto_chunking:
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

            if chunk_plan:
                chunk_plan.sort(key=lambda chunk: chunk.chunk_index)
                if resume_last_document_id is not None and doc.id == resume_last_document_id:
                    if last_chunk_index is not None:
                        chunk_plan = [
                            chunk
                            for chunk in chunk_plan
                            if chunk.chunk_index is None or chunk.chunk_index > last_chunk_index
                        ]

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

            if chunk_sources:
                deduped_sources: List[tuple[str, List[Dict[str, Any]]]] = []
                deduped_keys: set[str] = set()
                for text, evidence in chunk_sources:
                    normalized = _normalize_chunk_text(text)
                    if not normalized:
                        continue
                    key = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
                    if key in deduped_keys:
                        continue
                    deduped_keys.add(key)
                    deduped_sources.append((text, evidence))
                chunk_sources = deduped_sources

            doc_label = doc.original_filename or doc.filename or f"doc-{doc.id}"
            progress_payload["document_label"] = doc_label
            progress_payload["message"] = f"Processing {doc_index}/{total_docs} documents"
            processed_chunks = 0
            planned_chunks = len(chunk_sources)
            planned_chunks_total += planned_chunks
            processed_chunks_total_base = processed_chunks_total
            maybe_update_progress(force=True)
            check_cancelled()
            structure_segments, structure_evidence_map = await build_segments(
                chunk_sources, max_chars=max_text_chars
            )
            if structure_segments:
                await extract_structures(
                    structure_segments,
                    structure_evidence_map,
                    doc_label=doc_label,
                    doc_id=doc.id,
                )

            if discovery_mode == "insights":
                check_cancelled()
                segments, evidence_map = await build_segments(
                    chunk_sources, max_chars=max_text_chars, track_progress=True
                )

                if insight_scope == "document":
                    await extract_insights(segments, evidence_map, "document")
                else:
                    cross_segments.extend(segments)
                    cross_evidence_map.update(evidence_map)

                check_cancelled()
                processed_chunks = planned_chunks
                processed_chunks_total = processed_chunks_total_base + planned_chunks
                maybe_update_progress(force=True)
                flush_candidates()
                progress_payload["current"] = doc_index
                progress_payload["last_document_id"] = doc.id
                progress_payload["last_chunk_index"] = None
                progress_payload["updated_at"] = _now_iso()
                progress_payload["message"] = f"Processed {doc_index}/{total_docs} documents"
                _set_discovery_progress(db, kb, progress_payload)
                continue

            extracted_any = False
            extracted_items = 0

            if not chunk_sources:
                extracted_any = False
            else:
                if progressive_enabled:
                    step = max(EXTRACTION_MIN_PROGRESSIVE_STEP, progressive_step)
                    batches = [
                        chunk_sources[i : i + step] for i in range(0, len(chunk_sources), step)
                    ]
                else:
                    batches = _iter_batches(chunk_sources, batch_size)

                def merge_evidence(batch: List[tuple[str, List[Dict[str, Any]]]]) -> List[Dict[str, Any]]:
                    merged: List[Dict[str, Any]] = []
                    seen: set[tuple[Any, Any]] = set()
                    for _, ev_list in batch:
                        for ev in ev_list:
                            key = (ev.get("document_id"), ev.get("chunk_index"))
                            if key in seen:
                                continue
                            seen.add(key)
                            merged.append(ev)
                            if len(merged) >= 4:
                                return merged
                    return merged

                async def process_batch(
                    batch: List[tuple[str, List[Dict[str, Any]]]],
                ) -> int:
                    texts = [text for text, _ in batch if text]
                    if not texts:
                        return 0
                    batch_char_budget = min(
                        EXTRACTION_MAX_BATCH_CHARS,
                        max_text_chars * max(1, len(texts)),
                    )
                    combined = _truncate_text("\n\n".join(texts), batch_char_budget)
                    if not combined:
                        return 0
                    extract_text = await summarize_text(combined)
                    extract_text = _truncate_text(extract_text, batch_char_budget)
                    if not extract_text:
                        return 0
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
                        return 0

                    if not llm_response.get("success"):
                        logger.warning(
                            "LLM extraction returned failure",
                            error=str(llm_response.get("error") or llm_response.get("message")),
                        )
                        return 0

                    payload = _extract_json_payload(llm_response.get("message") or "")
                    if not payload:
                        return 0

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

                    batch_evidence = merge_evidence(batch)
                    update_last_chunk_index(batch_evidence)
                    items_found = 0
                    for item in entities[:max_items]:
                        if not isinstance(item, dict):
                            continue
                        name = str(item.get("name") or "").strip()
                        if not name:
                            continue
                        if _is_noise_name(name):
                            continue
                        entity_type = str(item.get("type") or "").strip()
                        if enforce_entity_types and _normalize_type(entity_type) not in entity_type_set:
                            continue
                        aliases = (
                            item.get("aliases") if isinstance(item.get("aliases"), list) else []
                        )
                        aliases = [str(a).strip() for a in aliases if str(a).strip()]
                        confidence = coerce_confidence(item.get("confidence"), 0.75)
                        attributes_payload = {"entity_type": entity_type} if entity_type else {}
                        if (
                            not enforce_entity_types
                            and entity_type
                            and reference_entity_type_set
                            and _normalize_type(entity_type) not in reference_entity_type_set
                        ):
                            append_constraint_violation(
                                attributes_payload,
                                kind="entity_type",
                                value=entity_type,
                                allowed=reference_entity_types,
                            )
                        if add_candidate(
                            "entity",
                            name,
                            batch_evidence,
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
                        if _is_noise_name(source) or _is_noise_name(target):
                            continue
                        if enforce_relation_types and _normalize_type(rel) not in relation_type_set:
                            continue
                        rel_name = f"{source} -> {rel} -> {target}"
                        confidence = coerce_confidence(item.get("confidence"), 0.65)
                        relation_attrs: Dict[str, Any] = {}
                        if (
                            not enforce_relation_types
                            and reference_relation_type_set
                            and _normalize_type(rel) not in reference_relation_type_set
                        ):
                            append_constraint_violation(
                                relation_attrs,
                                kind="relation_type",
                                value=rel,
                                allowed=reference_relation_types,
                            )
                        if add_candidate(
                            "relation",
                            rel_name,
                            batch_evidence,
                            confidence=confidence,
                            relation={"source": source, "relation": rel, "target": target},
                            attributes=relation_attrs or None,
                        ):
                            items_found += 1
                        if add_candidate(
                            "entity",
                            source,
                            batch_evidence,
                            confidence=0.55,
                            attributes={"inferred_from": "relation"},
                        ):
                            items_found += 1
                        if add_candidate(
                            "entity",
                            target,
                            batch_evidence,
                            confidence=0.55,
                            attributes={"inferred_from": "relation"},
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
                        if enforce_attribute_keys and _normalize_type(key) not in allowed_attribute_keys:
                            continue
                        attr_name = f"{entity}.{key}"
                        confidence = coerce_confidence(item.get("confidence"), 0.6)
                        attribute_payload: Dict[str, Any] = {"entity": entity, "key": key, "value": value}
                        if (
                            not enforce_attribute_keys
                            and reference_attribute_key_set
                            and _normalize_type(key) not in reference_attribute_key_set
                        ):
                            append_constraint_violation(
                                attribute_payload,
                                kind="attribute_key",
                                value=key,
                                allowed=reference_attribute_keys,
                            )
                        if add_candidate(
                            "attribute",
                            attr_name,
                            batch_evidence,
                            confidence=confidence,
                            attributes=attribute_payload,
                        ):
                            items_found += 1
                        if add_candidate(
                            "entity",
                            entity,
                            batch_evidence,
                            confidence=0.55,
                            attributes={"inferred_from": "attribute"},
                        ):
                            items_found += 1
                    return items_found

                async def process_batches_sequential() -> None:
                    nonlocal extracted_any, extracted_items, processed_chunks, processed_chunks_total
                    for batch in batches:
                        check_cancelled()
                        items_found = await process_batch(batch)
                        processed_chunks = min(planned_chunks, processed_chunks + len(batch))
                        processed_chunks_total = processed_chunks_total_base + processed_chunks
                        maybe_update_progress()
                        if items_found > 0:
                            extracted_any = True
                            extracted_items += items_found
                        if progressive_enabled and extracted_items >= progressive_min_items:
                            break

                async def process_batches_parallel() -> None:
                    nonlocal extracted_any, extracted_items, processed_chunks, processed_chunks_total
                    semaphore = asyncio.Semaphore(max(1, batch_concurrency))

                    async def run_with_sem(
                        batch: List[tuple[str, List[Dict[str, Any]]]]
                    ) -> tuple[int, int]:
                        async with semaphore:
                            items_found = await process_batch(batch)
                            return len(batch), items_found

                    tasks: List[asyncio.Task[tuple[int, int]]] = []
                    for batch in batches:
                        check_cancelled()
                        tasks.append(asyncio.create_task(run_with_sem(batch)))
                    try:
                        for task in asyncio.as_completed(tasks):
                            batch_len = 0
                            items_found = 0
                            try:
                                batch_len, items_found = await task
                            except Exception as exc:
                                logger.warning("LLM batch extraction failed", error=str(exc))
                            processed_chunks = min(planned_chunks, processed_chunks + batch_len)
                            processed_chunks_total = processed_chunks_total_base + processed_chunks
                            maybe_update_progress()
                            if items_found > 0:
                                extracted_any = True
                                extracted_items += items_found
                            check_cancelled()
                    except (DiscoveryCancelled, DiscoverySuperseded):
                        for task in tasks:
                            task.cancel()
                        raise

                if batch_concurrency > 1 and not progressive_enabled:
                    await process_batches_parallel()
                else:
                    await process_batches_sequential()

            if extracted_any:
                check_cancelled()
                processed_chunks = planned_chunks
                processed_chunks_total = processed_chunks_total_base + planned_chunks
                maybe_update_progress(force=True)
                flush_candidates()
                progress_payload["current"] = doc_index
                progress_payload["last_document_id"] = doc.id
                progress_payload["last_chunk_index"] = None
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
            processed_chunks = planned_chunks
            processed_chunks_total = processed_chunks_total_base + planned_chunks
            maybe_update_progress(force=True)
            flush_candidates()
            check_cancelled()
            progress_payload["current"] = doc_index
            progress_payload["last_document_id"] = doc.id
            progress_payload["last_chunk_index"] = None
            progress_payload["updated_at"] = _now_iso()
            progress_payload["message"] = f"Processed {doc_index}/{total_docs} documents"
            _set_discovery_progress(db, kb, progress_payload)

        check_cancelled()
        if discovery_mode == "insights" and insight_scope == "cross" and cross_segments:
            max_segments = max(EXTRACTION_AUTO_MIN_CHUNKS, max_chunks * 4)
            max_segments = min(max_segments, INSIGHT_MAX_SEGMENTS)
            if len(cross_segments) > max_segments:
                indices = _select_chunk_indices(len(cross_segments), max_segments, "uniform")
                if indices:
                    cross_segments = [cross_segments[i] for i in indices]
                    next_map: Dict[str, Dict[str, Any]] = {}
                    for seg in cross_segments:
                        ref = seg.get("ref")
                        if not ref:
                            continue
                        ev = cross_evidence_map.get(ref)
                    if ev:
                        next_map[ref] = ev
                cross_evidence_map = next_map
            await extract_insights(cross_segments, cross_evidence_map, "cross")
            check_cancelled()

        flush_candidates()
        check_cancelled()
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
        progress_payload["document_label"] = None
        progress_payload["current_chunks"] = 0
        progress_payload["total_chunks"] = 0
        progress_payload["processed_chunks_total"] = processed_chunks_total
        progress_payload["planned_chunks_total"] = planned_chunks_total
        progress_payload["last_chunk_index"] = None
        progress_payload["updated_at"] = _now_iso()
        progress_payload["message"] = None
        progress_payload["cancel_requested"] = False
        _set_discovery_progress(db, kb, progress_payload)
        return SemanticDiscoveryResponse(created=created, skipped=skipped, total=total)
    except DiscoverySuperseded:
        candidates_to_add.clear()
        updated_existing = False
        total = (
            db.query(SemanticCandidate)
            .filter(
                SemanticCandidate.tenant_id == tenant_id,
                SemanticCandidate.knowledge_base_id == kb.id,
            )
            .count()
        )
        return SemanticDiscoveryResponse(created=created, skipped=skipped, total=total)
    except DiscoveryCancelled:
        flush_candidates_safe()
        total = (
            db.query(SemanticCandidate)
            .filter(
                SemanticCandidate.tenant_id == tenant_id,
                SemanticCandidate.knowledge_base_id == kb.id,
            )
            .count()
        )
        progress_payload["status"] = "cancelled"
        progress_payload["updated_at"] = _now_iso()
        progress_payload["message"] = "已终止"
        progress_payload["cancel_requested"] = True
        _set_discovery_progress(db, kb, progress_payload)
        return SemanticDiscoveryResponse(created=created, skipped=skipped, total=total)
    except Exception as exc:
        flush_candidates_safe()
        progress_payload["status"] = "failed"
        progress_payload["document_label"] = None
        progress_payload["processed_chunks_total"] = processed_chunks_total
        progress_payload["planned_chunks_total"] = planned_chunks_total
        progress_payload["updated_at"] = _now_iso()
        progress_payload["message"] = str(exc)
        progress_payload["cancel_requested"] = False
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
