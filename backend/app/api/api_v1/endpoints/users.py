"""
用户管理API端点
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from pydantic import BaseModel

from app.db.database import get_db
from app.db.models.user import User, UserRole, UserConfig
from app.db.models.tenant import Tenant
from app.db.models.knowledge_base import KnowledgeBase
from app.db.models.document import Document
from app.core.dependencies import (
    get_current_active_user,
    require_super_admin,
    require_admin,
    require_tenant_admin,
)
from app.core.security import get_password_hash
from datetime import datetime

router = APIRouter()


class UserConfigUpdate(BaseModel):
    preferred_chat_model: Optional[str] = None
    preferred_embedding_model: Optional[str] = None
    preferred_rerank_model: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[str] = None
    top_p: Optional[str] = None
    retrieval_top_k: Optional[int] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    theme: Optional[str] = None
    language: Optional[str] = None
    custom_settings: Optional[dict] = None


class UserConfigResponse(BaseModel):
    id: int
    user_id: int
    preferred_chat_model: str
    preferred_embedding_model: str
    preferred_rerank_model: str
    max_tokens: int
    temperature: str
    top_p: str
    retrieval_top_k: int
    chunk_size: int
    chunk_overlap: int
    theme: str
    language: str
    custom_settings: dict
    created_at: str
    updated_at: str


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class UserListResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    tenant_id: int
    tenant_name: str
    knowledge_bases_count: int
    documents_count: int
    created_at: str
    last_login_at: Optional[str] = None


class UserStatsResponse(BaseModel):
    total_users: int
    active_users: int
    admin_users: int
    new_users_this_month: int


@router.get("/config", response_model=UserConfigResponse)
async def get_user_config(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """获取当前用户配置"""
    config = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).first()
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User configuration not found"
        )

    return UserConfigResponse(
        id=config.id,
        user_id=config.user_id,
        preferred_chat_model=config.preferred_chat_model,
        preferred_embedding_model=config.preferred_embedding_model,
        preferred_rerank_model=config.preferred_rerank_model,
        max_tokens=config.max_tokens,
        temperature=config.temperature,
        top_p=config.top_p,
        retrieval_top_k=config.retrieval_top_k,
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
        theme=config.theme,
        language=config.language,
        custom_settings=config.custom_settings or {},
        created_at=config.created_at.isoformat(),
        updated_at=(
            config.updated_at.isoformat()
            if config.updated_at
            else config.created_at.isoformat()
        ),
    )


@router.put("/config", response_model=UserConfigResponse)
async def update_user_config(
    config_update: UserConfigUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """更新当前用户配置"""
    config = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).first()
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User configuration not found"
        )

    # 更新配置
    update_data = config_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        if hasattr(config, field):
            setattr(config, field, value)

    db.commit()
    db.refresh(config)

    return UserConfigResponse(
        id=config.id,
        user_id=config.user_id,
        preferred_chat_model=config.preferred_chat_model,
        preferred_embedding_model=config.preferred_embedding_model,
        preferred_rerank_model=config.preferred_rerank_model,
        max_tokens=config.max_tokens,
        temperature=config.temperature,
        top_p=config.top_p,
        retrieval_top_k=config.retrieval_top_k,
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
        theme=config.theme,
        language=config.language,
        custom_settings=config.custom_settings or {},
        created_at=config.created_at.isoformat(),
        updated_at=(
            config.updated_at.isoformat()
            if config.updated_at
            else config.created_at.isoformat()
        ),
    )


@router.get("/stats", response_model=UserStatsResponse)
async def get_user_stats(
    current_user: User = Depends(require_tenant_admin()), db: Session = Depends(get_db)
):
    """获取用户统计信息（管理员功能）"""
    # 根据用户角色限制访问范围
    if current_user.role == "super_admin":
        # 超级管理员可以查看所有用户统计
        total_users = db.query(User).count()
        active_users = db.query(User).filter(User.is_active == True).count()
        admin_users = (
            db.query(User)
            .filter(User.role.in_(["super_admin", "tenant_admin"]))
            .count()
        )
        # 本月新用户
        from datetime import datetime, timedelta
        this_month = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        new_users_this_month = (
            db.query(User)
            .filter(User.created_at >= this_month)
            .count()
        )
    else:
        # 租户管理员只能查看本租户统计
        tenant_id = current_user.tenant_id
        total_users = db.query(User).filter(User.tenant_id == tenant_id).count()
        active_users = (
            db.query(User)
            .filter(User.tenant_id == tenant_id, User.is_active == True)
            .count()
        )
        admin_users = (
            db.query(User)
            .filter(
                User.tenant_id == tenant_id,
                User.role.in_(["super_admin", "tenant_admin"])
            )
            .count()
        )
        # 本月新用户
        from datetime import datetime, timedelta
        this_month = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        new_users_this_month = (
            db.query(User)
            .filter(User.tenant_id == tenant_id, User.created_at >= this_month)
            .count()
        )

    return UserStatsResponse(
        total_users=total_users,
        active_users=active_users,
        admin_users=admin_users,
        new_users_this_month=new_users_this_month,
    )


@router.get("/", response_model=List[UserListResponse])
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    current_user: User = Depends(require_tenant_admin()),
    db: Session = Depends(get_db),
):
    """获取用户列表（管理员功能）"""
    query = db.query(User).join(Tenant, User.tenant_id == Tenant.id)

    # 超级管理员可以查看所有用户，租户管理员只能查看同租户用户
    if current_user.role != "super_admin":
        query = query.filter(User.tenant_id == current_user.tenant_id)

    # 搜索过滤
    if search:
        query = query.filter(
            or_(
                User.username.contains(search),
                User.email.contains(search),
                User.full_name.contains(search),
            )
        )

    # 角色过滤
    if role:
        query = query.filter(User.role == role)

    # 状态过滤
    if is_active is not None:
        query = query.filter(User.is_active == is_active)

    # 分页
    users = query.offset(skip).limit(limit).all()

    result = []
    for user in users:
        # 统计用户的知识库和文档数量
        knowledge_bases_count = (
            db.query(KnowledgeBase).filter(KnowledgeBase.owner_id == user.id).count()
        )
        documents_count = (
            db.query(Document).filter(Document.uploaded_by == user.id).count()
        )

        result.append(
            UserListResponse(
                id=user.id,
                username=user.username,
                email=user.email,
                full_name=user.full_name or "",
                role=user.role,
                is_active=user.is_active,
                tenant_id=user.tenant_id,
                tenant_name=user.tenant.name,
                knowledge_bases_count=knowledge_bases_count,
                documents_count=documents_count,
                created_at=user.created_at.isoformat(),
                last_login_at=(
                    user.last_login_at.isoformat() if user.last_login_at else None
                ),
            )
        )

    return result


@router.get("/{user_id}", response_model=UserListResponse)
async def get_user(
    user_id: int,
    current_user: User = Depends(require_tenant_admin()),
    db: Session = Depends(get_db),
):
    """获取指定用户信息"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # 权限检查：租户管理员只能查看同租户用户
    if current_user.role != "super_admin" and user.tenant_id != current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied"
        )

    # 统计用户的知识库和文档数量
    knowledge_bases_count = (
        db.query(KnowledgeBase).filter(KnowledgeBase.owner_id == user.id).count()
    )
    documents_count = db.query(Document).filter(Document.uploaded_by == user.id).count()

    return UserListResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name or "",
        role=user.role,
        is_active=user.is_active,
        tenant_id=user.tenant_id,
        tenant_name=user.tenant.name,
        knowledge_bases_count=knowledge_bases_count,
        documents_count=documents_count,
        created_at=user.created_at.isoformat(),
        last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
    )


@router.put("/{user_id}", response_model=UserListResponse)
async def update_user(
    user_id: int,
    user_update: UserUpdateRequest,
    current_user: User = Depends(require_tenant_admin()),
    db: Session = Depends(get_db),
):
    """更新用户信息"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # 权限检查
    if current_user.role != "super_admin":
        # 租户管理员只能管理同租户用户
        if user.tenant_id != current_user.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied"
            )

        # 租户管理员不能修改超级管理员和其他租户管理员的角色
        if user_update.role and user_update.role != user.role:
            if user.role == "super_admin" or user_update.role == "super_admin":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission denied: cannot change super admin role",
                )
            if user.role == "tenant_admin" and user.id != current_user.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission denied: cannot change other tenant admin role",
                )

    # 更新用户信息
    update_data = user_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        if hasattr(user, field):
            setattr(user, field, value)

    db.commit()
    db.refresh(user)

    # 统计用户的知识库和文档数量
    knowledge_bases_count = (
        db.query(KnowledgeBase).filter(KnowledgeBase.owner_id == user.id).count()
    )
    documents_count = db.query(Document).filter(Document.uploaded_by == user.id).count()

    return UserListResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name or "",
        role=user.role,
        is_active=user.is_active,
        tenant_id=user.tenant_id,
        tenant_name=user.tenant.name,
        knowledge_bases_count=knowledge_bases_count,
        documents_count=documents_count,
        created_at=user.created_at.isoformat(),
        last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
    )


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_tenant_admin()),
    db: Session = Depends(get_db),
):
    """删除用户"""
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # 权限检查
    if current_user.role != "super_admin":
        # 租户管理员只能删除同租户用户
        if user.tenant_id != current_user.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied"
            )

        # 租户管理员不能删除超级管理员和其他租户管理员
        if user.role == "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: cannot delete super admin",
            )
        if user.role == "tenant_admin" and user.id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: cannot delete other tenant admin",
            )

    # 删除用户配置
    db.query(UserConfig).filter(UserConfig.user_id == user_id).delete()

    # 删除用户
    db.delete(user)
    db.commit()

    return {"message": "User deleted successfully"}


@router.get("/{user_id}/config", response_model=UserConfigResponse)
async def get_user_config_by_id(
    user_id: int,
    current_user: User = Depends(require_tenant_admin()),
    db: Session = Depends(get_db),
):
    """获取指定用户的配置（管理员功能）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # 权限检查：租户管理员只能查看同租户用户配置
    if current_user.role != "super_admin" and user.tenant_id != current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied"
        )

    config = db.query(UserConfig).filter(UserConfig.user_id == user_id).first()
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User configuration not found"
        )

    return UserConfigResponse(
        id=config.id,
        user_id=config.user_id,
        preferred_chat_model=config.preferred_chat_model,
        preferred_embedding_model=config.preferred_embedding_model,
        preferred_rerank_model=config.preferred_rerank_model,
        max_tokens=config.max_tokens,
        temperature=config.temperature,
        top_p=config.top_p,
        retrieval_top_k=config.retrieval_top_k,
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
        theme=config.theme,
        language=config.language,
        custom_settings=config.custom_settings or {},
        created_at=config.created_at.isoformat(),
        updated_at=(
            config.updated_at.isoformat()
            if config.updated_at
            else config.created_at.isoformat()
        ),
    )


@router.get("/stats", response_model=UserStatsResponse)
async def get_user_stats(
    current_user: User = Depends(require_tenant_admin()), db: Session = Depends(get_db)
):
    """获取用户统计信息（管理员功能）"""
    # 根据用户角色限制访问范围
    if current_user.role == "super_admin":
        # 超级管理员可以查看所有用户统计
        total_users = db.query(User).count()
        active_users = db.query(User).filter(User.is_active == True).count()
        admin_users = (
            db.query(User)
            .filter(User.role.in_(["super_admin", "tenant_admin"]))
            .count()
        )

        # 计算本月新增用户
        current_date = datetime.now()
        first_day_of_month = current_date.replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        new_users_this_month = (
            db.query(User).filter(User.created_at >= first_day_of_month).count()
        )
    else:
        # 租户管理员只能查看同租户用户统计
        total_users = (
            db.query(User).filter(User.tenant_id == current_user.tenant_id).count()
        )
        active_users = (
            db.query(User)
            .filter(User.tenant_id == current_user.tenant_id, User.is_active == True)
            .count()
        )
        admin_users = (
            db.query(User)
            .filter(
                User.tenant_id == current_user.tenant_id,
                User.role.in_(["super_admin", "tenant_admin"]),
            )
            .count()
        )

        # 计算本月新增用户
        current_date = datetime.now()
        first_day_of_month = current_date.replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        new_users_this_month = (
            db.query(User)
            .filter(
                User.tenant_id == current_user.tenant_id,
                User.created_at >= first_day_of_month,
            )
            .count()
        )

    return UserStatsResponse(
        total_users=total_users,
        active_users=active_users,
        admin_users=admin_users,
        new_users_this_month=new_users_this_month,
    )
