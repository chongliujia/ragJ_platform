"""
依赖注入相关功能
"""

from typing import Optional, Tuple
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models.user import User
from app.db.models.permission import RolePermission, Permission
from app.core.security import verify_token
from app.core.config import settings

# HTTP Bearer认证方案
security = HTTPBearer(auto_error=False)  # 允许没有认证头


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """获取当前用户 - 开发模式下可选"""
    
    # 开发模式下禁用认证
    if settings.DISABLE_AUTH:
        # 返回一个默认的开发用户
        return User(
            id=1,
            username="dev_user",
            email="dev@example.com",
            full_name="Development User",
            is_active=True,
            role="super_admin",
            tenant_id=1,
            is_verified=True,
        )
    
    if not credentials:
        return None
        
    token = credentials.credentials
    user_id = verify_token(token)

    if user_id is None:
        return None

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        return None

    return user


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """获取当前用户"""
    # 开发模式下禁用认证
    if settings.DISABLE_AUTH:
        # 返回一个默认的开发用户
        return User(
            id=1,
            username="dev_user",
            email="dev@example.com",
            full_name="Development User",
            is_active=True,
            role="super_admin",
            tenant_id=1,
            is_verified=True,
        )
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not credentials:
        raise credentials_exception

    token = credentials.credentials
    user_id = verify_token(token)

    if user_id is None:
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )

    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """获取当前活跃用户"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )
    return current_user


async def get_current_user_with_tenant(
    current_user: User = Depends(get_current_user),
) -> Tuple[User, int]:
    """获取当前用户及其租户ID"""
    return current_user, current_user.tenant_id


async def get_tenant_id(
    current_user: User = Depends(get_current_user),
) -> int:
    """获取当前用户的租户ID"""
    # 开发模式下返回默认租户ID
    if settings.DISABLE_AUTH:
        return 1
    # 容错：若用户记录缺少租户ID，回退到默认租户
    if current_user.tenant_id is not None:
        return current_user.tenant_id
    try:
        from app.db.models.tenant import Tenant
        from app.db.database import SessionLocal
        db = SessionLocal()
        try:
            default = db.query(Tenant).filter(Tenant.slug == "default").first()
            if default:
                return default.id
            any_tenant = db.query(Tenant).first()
            if any_tenant:
                return any_tenant.id
        finally:
            db.close()
    except Exception:
        pass
    # 最终退回 1（可能无效，但不致使调用方崩溃）
    return 1


def require_permission(permission_name: str):
    """权限检查装饰器"""

    def permission_checker(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        # 超级管理员拥有所有权限
        if current_user.role == "super_admin":
            return current_user

        # 查询用户角色是否拥有指定权限
        user_permissions = (
            db.query(Permission)
            .join(RolePermission, Permission.id == RolePermission.permission_id)
            .filter(
                RolePermission.role == current_user.role,
                Permission.name == permission_name,
                Permission.is_active == True,
            )
            .first()
        )

        if not user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission_name}",
            )

        return current_user

    return permission_checker


def optional_permission(permission_name: str):
    """Return True/False depending on whether current user has a permission (never raises 403)."""

    def permission_checker(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ) -> bool:
        if current_user.role == "super_admin":
            return True
        user_permissions = (
            db.query(Permission)
            .join(RolePermission, Permission.id == RolePermission.permission_id)
            .filter(
                RolePermission.role == current_user.role,
                Permission.name == permission_name,
                Permission.is_active == True,
            )
            .first()
        )
        return bool(user_permissions)

    return permission_checker


def require_super_admin():
    """超级管理员权限检查"""

    def super_admin_checker(current_user: User = Depends(get_current_active_user)):
        if current_user.role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Super admin access required",
            )
        return current_user

    return super_admin_checker


def require_admin():
    """管理员权限检查（包括超级管理员和租户管理员）"""

    def admin_checker(current_user: User = Depends(get_current_active_user)):
        if current_user.role not in ["super_admin", "tenant_admin"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
            )
        return current_user

    return admin_checker


def require_tenant_admin():
    """租户管理员权限检查（包括超级管理员和租户管理员）"""

    def tenant_admin_checker(current_user: User = Depends(get_current_active_user)):
        if current_user.role not in ["super_admin", "tenant_admin"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tenant admin access required",
            )
        return current_user

    return tenant_admin_checker


def check_tenant_access(
    current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """检查租户访问权限"""
    # 超级管理员可以访问所有租户
    if current_user.role == "super_admin":
        return current_user

    # 普通用户只能访问自己租户的数据
    # 这个检查会在具体的业务逻辑中实现
    return current_user


def validate_tenant_access(
    resource_tenant_id: int,
    current_user: User = Depends(get_current_active_user)
):
    """验证用户是否有权限访问指定租户的资源"""
    # 超级管理员可以访问所有租户的资源
    if current_user.role == "super_admin":
        return True
    
    # 普通用户只能访问自己租户的资源
    if current_user.tenant_id != resource_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You can only access resources in your own tenant"
        )
    
    return True
