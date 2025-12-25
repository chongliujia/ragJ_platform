"""
Evaluation service for running RAG regression tests.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from app.schemas.chat import ChatRequest
from app.services.langgraph_chat_service import langgraph_chat_service


def _normalize_expected_answer(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    return [str(value)]


def _normalize_expected_sources(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    return [str(value)]


async def run_evaluation(
    *,
    items: List[Dict[str, Any]],
    tenant_id: int,
    user_id: int,
    knowledge_base_override: Optional[str] = None,
    max_items: Optional[int] = None,
) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    total_tokens = 0
    total_latency_ms = 0
    answer_match_count = 0
    source_match_count = 0
    evaluated = 0

    sliced_items = items[: max_items] if max_items else items

    for idx, item in enumerate(sliced_items):
        query = str(item.get("query") or item.get("question") or "").strip()
        kb_id = (
            knowledge_base_override
            or item.get("knowledge_base_id")
            or item.get("knowledge_base")
        )
        expected_answer = _normalize_expected_answer(item.get("expected_answer"))
        expected_sources = _normalize_expected_sources(item.get("expected_sources"))

        if not query or not kb_id:
            results.append(
                {
                    "index": idx,
                    "query": query,
                    "knowledge_base_id": kb_id,
                    "status": "skipped",
                    "error": "missing query or knowledge_base_id",
                }
            )
            continue

        start = time.time()
        try:
            response = await langgraph_chat_service.chat(
                ChatRequest(message=query, knowledge_base_id=str(kb_id)),
                tenant_id=tenant_id,
                user_id=user_id,
            )
            latency_ms = int((time.time() - start) * 1000)
            total_latency_ms += latency_ms
            evaluated += 1

            usage = response.usage or {}
            try:
                total_tokens += int(usage.get("total_tokens") or 0)
            except Exception:
                pass

            answer_match = None
            if expected_answer:
                answer_lower = (response.message or "").lower()
                answer_match = any(exp.lower() in answer_lower for exp in expected_answer)
                if answer_match:
                    answer_match_count += 1

            source_match = None
            if expected_sources:
                names = []
                for src in response.sources or []:
                    name = src.get("document_name") or src.get("title")
                    if name:
                        names.append(str(name))
                source_match = any(
                    exp.lower() in " ".join(names).lower() for exp in expected_sources
                )
                if source_match:
                    source_match_count += 1

            results.append(
                {
                    "index": idx,
                    "query": query,
                    "knowledge_base_id": kb_id,
                    "status": "completed",
                    "response": response.message,
                    "answer_match": answer_match,
                    "source_match": source_match,
                    "latency_ms": latency_ms,
                    "tokens": usage.get("total_tokens"),
                    "sources": response.sources or [],
                }
            )
        except Exception as e:
            results.append(
                {
                    "index": idx,
                    "query": query,
                    "knowledge_base_id": kb_id,
                    "status": "error",
                    "error": str(e),
                }
            )

    summary = {
        "total_items": len(sliced_items),
        "evaluated": evaluated,
        "answer_match_count": answer_match_count,
        "source_match_count": source_match_count,
        "answer_match_rate": (answer_match_count / evaluated) if evaluated else 0,
        "source_match_rate": (source_match_count / evaluated) if evaluated else 0,
        "avg_latency_ms": int(total_latency_ms / evaluated) if evaluated else 0,
        "total_tokens": total_tokens,
    }

    return {"results": results, "summary": summary}
