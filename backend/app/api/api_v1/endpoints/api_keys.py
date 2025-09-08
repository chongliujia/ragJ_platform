"""
Admin API for managing public API keys (x-api-key)
"""

import secrets
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models.api_key import ApiKey
from app.core.dependencies import require_admin, get_current_active_user


router = APIRouter()


class ApiKeyCreateRequest(BaseModel):
    name: str
    tenant_id: Optional[int] = None  # 默认当前用户租户
    scopes: str = "chat,workflow"
    allowed_kb: Optional[str] = None
    allowed_workflow_id: Optional[str] = None
    rate_limit_per_min: int = 60
    expire_in_days: Optional[int] = None


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key: str
    tenant_id: int
    scopes: str
    allowed_kb: Optional[str]
    allowed_workflow_id: Optional[str]
    rate_limit_per_min: int
    revoked: bool
    created_at: datetime
    expires_at: Optional[datetime]


@router.post("/api-keys", response_model=ApiKeyResponse, dependencies=[Depends(require_admin())])
async def create_api_key(req: ApiKeyCreateRequest, db: Session = Depends(get_db), current_user = Depends(get_current_active_user)):
    key = secrets.token_urlsafe(48)
    tenant_id = req.tenant_id or current_user.tenant_id
    expires_at = None
    if req.expire_in_days and req.expire_in_days > 0:
        expires_at = datetime.utcnow() + timedelta(days=req.expire_in_days)

    record = ApiKey(
        name=req.name,
        key=key,
        tenant_id=tenant_id,
        scopes=req.scopes,
        allowed_kb=req.allowed_kb,
        allowed_workflow_id=req.allowed_workflow_id,
        rate_limit_per_min=req.rate_limit_per_min,
        expires_at=expires_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return ApiKeyResponse(
        id=record.id,
        name=record.name,
        key=record.key,
        tenant_id=record.tenant_id,
        scopes=record.scopes,
        allowed_kb=record.allowed_kb,
        allowed_workflow_id=record.allowed_workflow_id,
        rate_limit_per_min=record.rate_limit_per_min,
        revoked=record.revoked,
        created_at=record.created_at,
        expires_at=record.expires_at,
    )


@router.get("/api-keys", response_model=List[ApiKeyResponse], dependencies=[Depends(require_admin())])
async def list_api_keys(db: Session = Depends(get_db), current_user = Depends(get_current_active_user)):
    records = db.query(ApiKey).filter(ApiKey.tenant_id == current_user.tenant_id).all()
    return [ApiKeyResponse(
        id=r.id,
        name=r.name,
        key=r.key,
        tenant_id=r.tenant_id,
        scopes=r.scopes,
        allowed_kb=r.allowed_kb,
        allowed_workflow_id=r.allowed_workflow_id,
        rate_limit_per_min=r.rate_limit_per_min,
        revoked=r.revoked,
        created_at=r.created_at,
        expires_at=r.expires_at,
    ) for r in records]


@router.delete("/api-keys/{api_key_id}", dependencies=[Depends(require_admin())])
async def revoke_api_key(api_key_id: int, db: Session = Depends(get_db), current_user = Depends(get_current_active_user)):
    record = db.query(ApiKey).filter(ApiKey.id == api_key_id, ApiKey.tenant_id == current_user.tenant_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="API key not found")
    record.revoked = True
    db.add(record)
    db.commit()
    return {"message": "API key revoked"}

