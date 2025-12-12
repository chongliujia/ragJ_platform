"""
认证相关的API端点
"""

from datetime import timedelta
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError

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
    try:
        user = authenticate_user(db, request.username, request.password)
    except Exception as e:
        # 兼容错误：数据库/密码后端异常
        raise HTTPException(
            status_code=500,
            detail=str(e) if settings.DEBUG else "Internal authentication error",
        ) from e
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
    try:
        db.commit()
    except SQLAlchemyError as e:
        # 旧数据库缺字段时允许继续登录
        db.rollback()
        logger = None
        try:
            import structlog
            logger = structlog.get_logger(__name__)
            logger.warning("Failed to update last_login_at, continuing", error=str(e))
        except Exception:
            pass

    # 创建访问令牌
    try:
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            subject=user.id, expires_delta=access_token_expires
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e) if settings.DEBUG else "Token generation error",
        ) from e

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
    max_users = int(getattr(tenant, "max_users", 0) or 0)
    if max_users > 0:
        user_count = db.query(User).filter(User.tenant_id == tenant.id).count()
        if user_count >= max_users:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tenant user limit exceeded",
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
    try:
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Database error while creating user",
        ) from e

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
    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        # 用户已创建但配置失败，不阻断注册
        try:
            import structlog
            structlog.get_logger(__name__).warning(
                "UserConfig create failed, continuing", error=str(e)
            )
        except Exception:
            pass

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
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    获取当前用户信息
    """
    # 获取租户信息（容错：当前用户缺少租户ID时回退默认租户）
    tenant_id = current_user.tenant_id
    tenant = None
    if tenant_id is not None:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    else:
        tenant = db.query(Tenant).filter(Tenant.slug == "default").first() or db.query(Tenant).first()
        tenant_id = tenant.id if tenant else 0

    tenant_name = tenant.name if tenant else "Unknown Tenant"

    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name or "",
        role=current_user.role,
        is_active=current_user.is_active,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        created_at=current_user.created_at.isoformat() if current_user.created_at else "",
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
