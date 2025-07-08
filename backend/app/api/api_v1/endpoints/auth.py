"""
认证相关的API端点
"""

from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.database import get_db
from app.db.models.user import User, UserRole, UserConfig
from app.db.models.tenant import Tenant
from app.core.security import authenticate_user, create_access_token, get_password_hash
from app.core.dependencies import get_current_active_user
from app.core.config import settings

router = APIRouter()
security = HTTPBearer()


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: str = ""
    tenant_slug: str = "default"


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600
    user: dict


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    tenant_id: int
    tenant_name: str
    created_at: str


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """
    用户登录
    """
    user = authenticate_user(db, request.username, request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )

    # 更新最后登录时间
    from datetime import datetime

    user.last_login_at = datetime.utcnow()
    db.commit()

    # 创建访问令牌
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.id, expires_delta=access_token_expires
    )

    return AuthResponse(
        access_token=access_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "tenant_id": user.tenant_id,
        },
    )


@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest, db: Session = Depends(get_db)):
    """
    用户注册
    """
    # 检查用户名是否已存在
    if db.query(User).filter(User.username == request.username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    # 检查邮箱是否已存在
    if db.query(User).filter(User.email == request.email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )

    # 获取租户
    tenant = db.query(Tenant).filter(Tenant.slug == request.tenant_slug).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant not found"
        )

    # 检查租户用户数量限制
    user_count = db.query(User).filter(User.tenant_id == tenant.id).count()
    if user_count >= tenant.max_users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant user limit exceeded"
        )

    # 创建用户
    user = User(
        username=request.username,
        email=request.email,
        hashed_password=get_password_hash(request.password),
        full_name=request.full_name,
        role=UserRole.USER.value,
        tenant_id=tenant.id,
        is_active=True,
        is_verified=False,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    # 创建用户配置
    user_config = UserConfig(
        user_id=user.id,
        preferred_chat_model="deepseek-chat",
        preferred_embedding_model="text-embedding-v2",
        preferred_rerank_model="gte-rerank",
        theme="light",
        language="zh",
    )

    db.add(user_config)
    db.commit()

    # 创建访问令牌
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.id, expires_delta=access_token_expires
    )

    return AuthResponse(
        access_token=access_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "tenant_id": user.tenant_id,
        },
    )


@router.post("/logout")
async def logout():
    """
    用户登出
    """
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """
    获取当前用户信息
    """
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name or "",
        role=current_user.role,
        is_active=current_user.is_active,
        tenant_id=current_user.tenant_id,
        tenant_name=current_user.tenant.name,
        created_at=current_user.created_at.isoformat(),
    )


@router.get("/permissions")
async def get_user_permissions(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """
    获取当前用户的权限列表
    """
    from app.db.models.permission import Permission, RolePermission

    if current_user.role == "super_admin":
        # 超级管理员拥有所有权限
        permissions = db.query(Permission).filter(Permission.is_active == True).all()
    else:
        # 根据角色获取权限
        permissions = (
            db.query(Permission)
            .join(RolePermission, Permission.id == RolePermission.permission_id)
            .filter(
                RolePermission.role == current_user.role, Permission.is_active == True
            )
            .all()
        )

    return {
        "permissions": [
            {
                "name": p.name,
                "display_name": p.display_name,
                "description": p.description,
                "category": p.category,
            }
            for p in permissions
        ]
    }
