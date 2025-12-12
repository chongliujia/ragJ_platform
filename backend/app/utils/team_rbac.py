"""
团队权限控制工具函数
"""

from typing import Optional, List
from functools import wraps
from sqlalchemy.orm import Session
from fastapi import HTTPException, Request, Depends

from app.db.models import User, Tenant, UserTenant, UserTenantRole, MemberType
from app.db.database import get_db


def get_user_current_team(user_id: int, db: Session) -> Optional[Tenant]:
    """获取用户当前所属的团队（一个用户只能属于一个团队）"""
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == user_id,
        UserTenant.status == '1'
    ).first()
    
    if user_tenant:
        return db.query(Tenant).filter(
            Tenant.id == user_tenant.tenant_id,
            Tenant.is_active == True
        ).first()
    return None


def is_team_member(user_id: int, team_id: int, db: Session) -> bool:
    """检查是否为团队成员"""
    return db.query(UserTenant).filter(
        UserTenant.user_id == user_id,
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).first() is not None


def is_team_owner(user_id: int, team_id: int, db: Session) -> bool:
    """检查是否为团队所有者"""
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == user_id,
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).first()
    
    return user_tenant and user_tenant.member_type == MemberType.OWNER.value


def is_team_admin(user_id: int, team_id: int, db: Session) -> bool:
    """检查是否为团队管理员或所有者"""
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == user_id,
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).first()
    
    return user_tenant and user_tenant.member_type in [MemberType.OWNER.value, MemberType.ADMIN.value]


def is_super_admin(user_id: int, db: Session) -> bool:
    """检查是否为超级管理员"""
    user = db.query(User).filter(User.id == user_id).first()
    return user and user.role == 'super_admin'


def has_team_permission(user_id: int, team_id: int, permission_code: str, db: Session) -> bool:
    """检查用户在团队中的权限"""
    
    # 1. 超级管理员直接通过
    if is_super_admin(user_id, db):
        return True
    
    # 2. 检查是否为团队成员
    if not is_team_member(user_id, team_id, db):
        return False
    
    # 3. 团队Owner拥有所有权限
    if is_team_owner(user_id, team_id, db):
        return True
    
    # 4. 根据权限代码检查具体权限
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == user_id,
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).first()
    
    if not user_tenant:
        return False
    
    # 根据成员类型和权限代码判断
    if user_tenant.member_type == MemberType.ADMIN.value:
        # 管理员权限列表
        admin_permissions = [
            'team:read', 'team:member:add', 'team:member:remove',
            'team:member:update', 'team:resource:manage'
        ]
        return permission_code in admin_permissions
    
    elif user_tenant.member_type == MemberType.MEMBER.value:
        # 普通成员权限列表
        member_permissions = [
            'team:read', 'team:resource:read'
        ]
        return permission_code in member_permissions
    
    return False


def get_user_teams(user_id: int, db: Session) -> List[Tenant]:
    """获取用户参与的所有团队"""
    user_tenants = db.query(UserTenant).filter(
        UserTenant.user_id == user_id,
        UserTenant.status == '1'
    ).all()
    
    team_ids = [ut.tenant_id for ut in user_tenants]
    
    return db.query(Tenant).filter(
        Tenant.id.in_(team_ids),
        Tenant.is_active == True
    ).all()


def get_team_members(team_id: int, db: Session) -> List[dict]:
    """获取团队成员列表"""
    members = db.query(UserTenant, User).join(
        User, UserTenant.user_id == User.id
    ).filter(
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).all()
    
    result = []
    for user_tenant, user in members:
        result.append({
            'user_id': user.id,
            'username': user.username,
            'email': user.email,
            'full_name': user.full_name,
            'role': user_tenant.role,
            'member_type': user_tenant.member_type,
            'join_time': user_tenant.join_time,
            'invited_by': user_tenant.invited_by
        })
    
    return result


def switch_user_team(user_id: int, new_team_id: int, invited_by: Optional[int], db: Session) -> bool:
    """切换用户所属团队（离开当前团队，加入新团队）"""
    try:
        # 1. 禁用用户在所有团队中的成员关系
        db.query(UserTenant).filter(
            UserTenant.user_id == user_id
        ).update({'status': '0'})
        
        # 2. 检查是否已有该团队的成员记录
        existing = db.query(UserTenant).filter(
            UserTenant.user_id == user_id,
            UserTenant.tenant_id == new_team_id
        ).first()
        
        if existing:
            # 重新激活现有记录
            existing.status = '1'
            existing.invited_by = invited_by
        else:
            # 创建新的成员记录
            new_user_tenant = UserTenant(
                user_id=user_id,
                tenant_id=new_team_id,
                role=UserTenantRole.USER.value,
                member_type=MemberType.MEMBER.value,
                status='1',
                invited_by=invited_by
            )
            db.add(new_user_tenant)

        # 3. 同步用户当前租户（资源访问范围）到新团队
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            user.tenant_id = new_team_id
        
        db.commit()
        return True
        
    except Exception as e:
        db.rollback()
        print(f"切换团队失败: {e}")
        return False


def team_permission_required(permission_code: str):
    """团队权限检查装饰器"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 从请求中获取team_id和用户信息
            request = None
            db = None
            current_user = None
            
            # 从函数参数中提取依赖
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                elif isinstance(arg, Session):
                    db = arg
                elif isinstance(arg, User):
                    current_user = arg
            
            # 从kwargs中提取
            team_id = kwargs.get('team_id')
            if not team_id and request:
                team_id = request.path_params.get('team_id')
            
            if not all([team_id, current_user, db]):
                raise HTTPException(status_code=400, detail="缺少必要参数")
            
            # 检查权限
            if not has_team_permission(current_user.id, team_id, permission_code, db):
                raise HTTPException(status_code=403, detail="权限不足")
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator
