"""
API key rate limiting and usage tracking.
"""

from __future__ import annotations

import time
import threading
from collections import defaultdict, deque
from typing import Optional

import redis

from app.core.config import settings
from app.db.database import SessionLocal
from app.db.models.api_key_usage import ApiKeyUsage


class ApiKeyRateLimiter:
    """Best-effort rate limiter with Redis primary and in-memory fallback."""

    def __init__(self) -> None:
        self._redis = None
        self._lock = threading.Lock()
        self._memory: dict[str, deque[float]] = defaultdict(deque)

    def _get_redis(self):
        if self._redis is not None:
            return self._redis
        try:
            self._redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            self._redis = None
        return self._redis

    def allow(self, api_key: str, limit_per_min: int) -> bool:
        if limit_per_min <= 0:
            return True

        now = int(time.time())
        bucket = now // 60
        client = self._get_redis()
        if client is not None:
            try:
                key = f"rate_limit:{api_key}:{bucket}"
                count = client.incr(key)
                if count == 1:
                    client.expire(key, 120)
                return int(count) <= int(limit_per_min)
            except Exception:
                # Fall back to in-memory limiter
                pass

        with self._lock:
            dq = self._memory[api_key]
            cutoff = time.time() - 60
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= int(limit_per_min):
                return False
            dq.append(time.time())
            return True


api_key_rate_limiter = ApiKeyRateLimiter()


def record_api_key_usage(
    *,
    api_key_id: int,
    tenant_id: int,
    path: str,
    method: str,
    status_code: int,
    tokens: Optional[int] = None,
    model: Optional[str] = None,
    duration_ms: Optional[int] = None,
    db=None,
) -> None:
    """Persist a usage record (best-effort)."""
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    try:
        row = ApiKeyUsage(
            api_key_id=api_key_id,
            tenant_id=tenant_id,
            path=path,
            method=method,
            status_code=status_code,
            tokens=int(tokens) if tokens is not None else None,
            model=model,
            duration_ms=int(duration_ms) if duration_ms is not None else None,
        )
        db.add(row)
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        if close_db:
            db.close()
