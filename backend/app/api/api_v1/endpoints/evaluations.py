"""
Evaluation datasets and runs API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_active_user, get_tenant_id
from app.db.database import get_db
from app.db.models.evaluation import EvaluationDataset, EvaluationRun
from app.db.models.knowledge_base import KnowledgeBase as KBModel
from app.db.models.user import User
from app.services.evaluation_service import run_evaluation

router = APIRouter()


class EvaluationItem(BaseModel):
    query: str
    knowledge_base_id: Optional[str] = None
    expected_answer: Optional[Any] = None
    expected_sources: Optional[List[str]] = None


class EvaluationDatasetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    items: List[EvaluationItem]


class EvaluationDatasetSummary(BaseModel):
    id: int
    name: str
    description: Optional[str]
    items_count: int
    created_at: datetime


class EvaluationDatasetDetail(EvaluationDatasetSummary):
    items: List[EvaluationItem]


class EvaluationRunRequest(BaseModel):
    dataset_id: int
    knowledge_base_id: Optional[str] = None
    max_items: Optional[int] = None


class EvaluationRunResponse(BaseModel):
    id: int
    dataset_id: int
    status: str
    summary: Dict[str, Any]
    results: List[Dict[str, Any]]
    created_at: datetime
    completed_at: Optional[datetime]


def _can_read_kb(kb_row: KBModel, user: User) -> bool:
    if user.role in ("super_admin", "tenant_admin"):
        return True
    if kb_row.owner_id == user.id:
        return True
    return bool(getattr(kb_row, "is_public", False))


@router.post("/datasets", response_model=EvaluationDatasetSummary, status_code=status.HTTP_201_CREATED)
async def create_evaluation_dataset(
    payload: EvaluationDatasetCreate,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    dataset = EvaluationDataset(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        items=[item.dict() for item in payload.items],
        created_by=current_user.id,
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return EvaluationDatasetSummary(
        id=dataset.id,
        name=dataset.name,
        description=dataset.description,
        items_count=len(dataset.items or []),
        created_at=dataset.created_at or datetime.utcnow(),
    )


@router.get("/datasets", response_model=List[EvaluationDatasetSummary])
async def list_evaluation_datasets(
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    rows = (
        db.query(EvaluationDataset)
        .filter(EvaluationDataset.tenant_id == tenant_id)
        .order_by(EvaluationDataset.created_at.desc())
        .all()
    )
    return [
        EvaluationDatasetSummary(
            id=row.id,
            name=row.name,
            description=row.description,
            items_count=len(row.items or []),
            created_at=row.created_at or datetime.utcnow(),
        )
        for row in rows
    ]


@router.get("/datasets/{dataset_id}", response_model=EvaluationDatasetDetail)
async def get_evaluation_dataset(
    dataset_id: int,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    row = (
        db.query(EvaluationDataset)
        .filter(EvaluationDataset.id == dataset_id, EvaluationDataset.tenant_id == tenant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation dataset not found")
    items = [EvaluationItem(**item) for item in (row.items or [])]
    return EvaluationDatasetDetail(
        id=row.id,
        name=row.name,
        description=row.description,
        items_count=len(items),
        created_at=row.created_at or datetime.utcnow(),
        items=items,
    )


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_evaluation_dataset(
    dataset_id: int,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    row = (
        db.query(EvaluationDataset)
        .filter(EvaluationDataset.id == dataset_id, EvaluationDataset.tenant_id == tenant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation dataset not found")
    db.delete(row)
    db.commit()
    return None


@router.post("/runs", response_model=EvaluationRunResponse)
async def run_evaluation_dataset(
    payload: EvaluationRunRequest,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    dataset = (
        db.query(EvaluationDataset)
        .filter(EvaluationDataset.id == payload.dataset_id, EvaluationDataset.tenant_id == tenant_id)
        .first()
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Evaluation dataset not found")

    # Optional KB access check (when override provided)
    if payload.knowledge_base_id:
        kb_row = (
            db.query(KBModel)
            .filter(
                KBModel.name == payload.knowledge_base_id,
                KBModel.tenant_id == tenant_id,
                KBModel.is_active == True,
            )
            .first()
        )
        if kb_row is None or not _can_read_kb(kb_row, current_user):
            raise HTTPException(status_code=403, detail="Knowledge base not accessible")

    run = EvaluationRun(
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        created_by=current_user.id,
        status="running",
        config={
            "knowledge_base_id": payload.knowledge_base_id,
            "max_items": payload.max_items,
        },
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    max_items = payload.max_items if payload.max_items and payload.max_items > 0 else None
    evaluation = await run_evaluation(
        items=dataset.items or [],
        tenant_id=tenant_id,
        user_id=current_user.id,
        knowledge_base_override=payload.knowledge_base_id,
        max_items=max_items,
    )

    run.status = "completed"
    run.results = evaluation.get("results", [])
    run.summary = evaluation.get("summary", {})
    run.completed_at = datetime.utcnow()
    db.add(run)
    db.commit()
    db.refresh(run)

    return EvaluationRunResponse(
        id=run.id,
        dataset_id=run.dataset_id,
        status=run.status,
        summary=run.summary or {},
        results=run.results or [],
        created_at=run.created_at or datetime.utcnow(),
        completed_at=run.completed_at,
    )


@router.get("/runs", response_model=List[EvaluationRunResponse])
async def list_evaluation_runs(
    dataset_id: Optional[int] = Query(None),
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(EvaluationRun).filter(EvaluationRun.tenant_id == tenant_id)
    if dataset_id is not None:
        query = query.filter(EvaluationRun.dataset_id == dataset_id)
    runs = query.order_by(EvaluationRun.created_at.desc()).all()
    return [
        EvaluationRunResponse(
            id=run.id,
            dataset_id=run.dataset_id,
            status=run.status,
            summary=run.summary or {},
            results=run.results or [],
            created_at=run.created_at or datetime.utcnow(),
            completed_at=run.completed_at,
        )
        for run in runs
    ]


@router.get("/runs/{run_id}", response_model=EvaluationRunResponse)
async def get_evaluation_run(
    run_id: int,
    tenant_id: int = Depends(get_tenant_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    run = (
        db.query(EvaluationRun)
        .filter(EvaluationRun.id == run_id, EvaluationRun.tenant_id == tenant_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Evaluation run not found")
    return EvaluationRunResponse(
        id=run.id,
        dataset_id=run.dataset_id,
        status=run.status,
        summary=run.summary or {},
        results=run.results or [],
        created_at=run.created_at or datetime.utcnow(),
        completed_at=run.completed_at,
    )
