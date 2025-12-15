"""
团队管理API端点
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import uuid
from datetime import datetime, timedelta
from pydantic import BaseModel

from app.db.database import get_db
from app.db.models import User, Tenant, UserTenant, TeamInvitation, TeamType, MemberType, UserTenantRole
from app.utils.team_rbac import (
    get_user_current_team, is_team_member, is_team_owner, is_team_admin,
    has_team_permission, get_team_members, switch_user_team
)
from app.schemas.team import (
    TeamCreate, TeamUpdate, TeamResponse, TeamMemberResponse,
    TeamInvitationCreate, TeamInvitationResponse, JoinTeamRequest
)
from app.core.dependencies import get_current_user, get_tenant_id

router = APIRouter()

DEFAULT_TENANT_SETTINGS = {
    "allow_shared_models": False,
    "shared_model_user_ids": [],
}


class TeamSettingsResponse(BaseModel):
    allow_shared_models: bool = False
    shared_model_user_ids: List[int] = []


class TeamSettingsUpdate(BaseModel):
    allow_shared_models: Optional[bool] = None
    shared_model_user_ids: Optional[List[int]] = None


def _normalize_team_settings(settings: dict | None) -> dict:
    s = settings if isinstance(settings, dict) else {}
    out = {**DEFAULT_TENANT_SETTINGS, **s}
    # sanitize
    out["allow_shared_models"] = bool(out.get("allow_shared_models", False))
    raw_ids = out.get("shared_model_user_ids") or []
    ids: list[int] = []
    for x in raw_ids:
        try:
            ids.append(int(x))
        except Exception:
            continue
    out["shared_model_user_ids"] = sorted(set(ids))
    return out


@router.post("/", response_model=TeamResponse)
async def create_team(
    team_data: TeamCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建新团队"""
    
    # 检查团队名称是否已存在
    existing_team = db.query(Tenant).filter(
        Tenant.name == team_data.name,
        Tenant.is_active == True
    ).first()
    
    if existing_team:
        raise HTTPException(
            status_code=400,
            detail="团队名称已存在"
        )
    
    # 创建团队（租户）
    new_team = Tenant(
        name=team_data.name,
        slug=team_data.name.lower().replace(' ', '-'),
        description=team_data.description,
        team_type=team_data.team_type or TeamType.COLLABORATIVE.value,
        max_members=team_data.max_members or 100,
        created_by=current_user.id,
        is_private=team_data.is_private if team_data.is_private is not None else True,
        is_active=True
    )
    
    db.add(new_team)
    db.flush()  # 获取新创建的团队ID
    
    # 让创建者离开当前团队，加入新团队作为Owner
    switch_user_team(current_user.id, new_team.id, None, db)
    
    # 更新新创建的团队成员记录为Owner
    db.query(UserTenant).filter(
        UserTenant.user_id == current_user.id,
        UserTenant.tenant_id == new_team.id
    ).update({
        'role': UserTenantRole.OWNER.value,
        'member_type': MemberType.OWNER.value
    })
    
    db.commit()
    
    return TeamResponse(
        id=new_team.id,
        name=new_team.name,
        description=new_team.description,
        team_type=new_team.team_type,
        max_members=new_team.max_members,
        member_count=1,
        created_by=new_team.created_by,
        created_at=new_team.created_at,
        my_role=UserTenantRole.OWNER.value,
        my_member_type=MemberType.OWNER.value,
        is_private=new_team.is_private
    )


@router.get("/current", response_model=Optional[TeamResponse])
async def get_current_team(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取当前用户所属的团队"""
    
    current_team = get_user_current_team(current_user.id, db)
    
    if not current_team:
        return None
    
    # 获取用户在团队中的角色
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == current_user.id,
        UserTenant.tenant_id == current_team.id,
        UserTenant.status == '1'
    ).first()
    
    # 获取团队成员数
    member_count = db.query(UserTenant).filter(
        UserTenant.tenant_id == current_team.id,
        UserTenant.status == '1'
    ).count()
    
    return TeamResponse(
        id=current_team.id,
        name=current_team.name,
        description=current_team.description,
        team_type=current_team.team_type,
        max_members=current_team.max_members,
        member_count=member_count,
        created_by=current_team.created_by,
        created_at=current_team.created_at,
        my_role=user_tenant.role if user_tenant else None,
        my_member_type=user_tenant.member_type if user_tenant else None,
        is_private=current_team.is_private
    )


@router.get("/current/settings", response_model=TeamSettingsResponse)
async def get_current_team_settings(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前团队 settings（包括共享模型开关/白名单）。"""
    # Any authenticated member can read its current team's settings.
    team = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.is_active == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")
    s = _normalize_team_settings(team.settings)
    return TeamSettingsResponse(
        allow_shared_models=bool(s.get("allow_shared_models", False)),
        shared_model_user_ids=list(s.get("shared_model_user_ids") or []),
    )


@router.put("/current/settings", response_model=TeamSettingsResponse)
async def update_current_team_settings(
    payload: TeamSettingsUpdate,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新当前团队 settings（需要团队管理员/Owner）。"""
    if not is_team_admin(current_user.id, tenant_id, db):
        raise HTTPException(status_code=403, detail="无权修改团队设置")

    team = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.is_active == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")

    settings = _normalize_team_settings(team.settings)

    if payload.allow_shared_models is not None:
        settings["allow_shared_models"] = bool(payload.allow_shared_models)

    if payload.shared_model_user_ids is not None:
        # Only allow users in this tenant
        wanted = {int(x) for x in payload.shared_model_user_ids if isinstance(x, int) or str(x).isdigit()}
        if wanted:
            existing = (
                db.query(User.id)
                .filter(User.tenant_id == tenant_id, User.id.in_(list(wanted)))
                .all()
            )
            allowed_ids = sorted({row[0] for row in existing})
        else:
            allowed_ids = []
        settings["shared_model_user_ids"] = allowed_ids

    team.settings = settings
    db.commit()

    return TeamSettingsResponse(
        allow_shared_models=bool(settings.get("allow_shared_models", False)),
        shared_model_user_ids=list(settings.get("shared_model_user_ids") or []),
    )


@router.post("/current/settings/shared-model-users/{user_id}", response_model=TeamSettingsResponse)
async def add_shared_model_user(
    user_id: int,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """将用户加入“可使用共享模型”的白名单（需要团队管理员/Owner）。"""
    if not is_team_admin(current_user.id, tenant_id, db):
        raise HTTPException(status_code=403, detail="无权修改团队设置")

    team = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.is_active == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")

    target = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    settings = _normalize_team_settings(team.settings)
    ids = set(settings.get("shared_model_user_ids") or [])
    ids.add(int(user_id))
    settings["shared_model_user_ids"] = sorted(ids)
    team.settings = settings
    db.commit()

    return TeamSettingsResponse(
        allow_shared_models=bool(settings.get("allow_shared_models", False)),
        shared_model_user_ids=list(settings.get("shared_model_user_ids") or []),
    )


@router.delete("/current/settings/shared-model-users/{user_id}", response_model=TeamSettingsResponse)
async def remove_shared_model_user(
    user_id: int,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """将用户移出“可使用共享模型”的白名单（需要团队管理员/Owner）。"""
    if not is_team_admin(current_user.id, tenant_id, db):
        raise HTTPException(status_code=403, detail="无权修改团队设置")

    team = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.is_active == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="团队不存在")

    settings = _normalize_team_settings(team.settings)
    ids = set(settings.get("shared_model_user_ids") or [])
    ids.discard(int(user_id))
    settings["shared_model_user_ids"] = sorted(ids)
    team.settings = settings
    db.commit()

    return TeamSettingsResponse(
        allow_shared_models=bool(settings.get("allow_shared_models", False)),
        shared_model_user_ids=list(settings.get("shared_model_user_ids") or []),
    )


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取团队详情"""
    
    # 检查权限
    if not has_team_permission(current_user.id, team_id, 'team:read', db):
        raise HTTPException(
            status_code=403,
            detail="无权访问该团队"
        )
    
    team = db.query(Tenant).filter(
        Tenant.id == team_id,
        Tenant.is_active == True
    ).first()
    
    if not team:
        raise HTTPException(
            status_code=404,
            detail="团队不存在"
        )
    
    # 获取用户在团队中的角色
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == current_user.id,
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).first()
    
    # 获取团队成员数
    member_count = db.query(UserTenant).filter(
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).count()
    
    return TeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        team_type=team.team_type,
        max_members=team.max_members,
        member_count=member_count,
        created_by=team.created_by,
        created_at=team.created_at,
        my_role=user_tenant.role if user_tenant else None,
        my_member_type=user_tenant.member_type if user_tenant else None,
        is_private=team.is_private
    )


@router.put("/{team_id}", response_model=TeamResponse)
async def update_team(
    team_id: int,
    team_data: TeamUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新团队信息"""
    
    # 检查权限（需要管理员权限）
    if not is_team_admin(current_user.id, team_id, db):
        raise HTTPException(
            status_code=403,
            detail="无权修改团队信息"
        )
    
    team = db.query(Tenant).filter(
        Tenant.id == team_id,
        Tenant.is_active == True
    ).first()
    
    if not team:
        raise HTTPException(
            status_code=404,
            detail="团队不存在"
        )
    
    # 更新团队信息
    update_data = team_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        if hasattr(team, field):
            setattr(team, field, value)
    
    db.commit()
    
    return await get_team(team_id, current_user, db)


@router.delete("/{team_id}")
async def delete_team(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除团队"""
    
    # 只有团队Owner才能删除团队
    if not is_team_owner(current_user.id, team_id, db):
        raise HTTPException(
            status_code=403,
            detail="只有团队创建者才能删除团队"
        )
    
    team = db.query(Tenant).filter(
        Tenant.id == team_id,
        Tenant.is_active == True
    ).first()
    
    if not team:
        raise HTTPException(
            status_code=404,
            detail="团队不存在"
        )
    
    # 软删除团队
    team.is_active = False
    
    # 禁用所有成员关系
    db.query(UserTenant).filter(
        UserTenant.tenant_id == team_id
    ).update({'status': '0'})
    
    db.commit()
    
    return {"message": "团队已删除"}


@router.get("/{team_id}/members", response_model=List[TeamMemberResponse])
async def list_team_members(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取团队成员列表"""
    
    # 检查权限
    if not has_team_permission(current_user.id, team_id, 'team:read', db):
        raise HTTPException(
            status_code=403,
            detail="无权访问该团队"
        )
    
    members = get_team_members(team_id, db)
    
    return [
        TeamMemberResponse(
            user_id=member['user_id'],
            username=member['username'],
            email=member['email'],
            full_name=member['full_name'],
            role=member['role'],
            member_type=member['member_type'],
            join_time=member['join_time'],
            invited_by=member['invited_by']
        )
        for member in members
    ]


@router.post("/{team_id}/invite", response_model=TeamInvitationResponse)
async def invite_user_to_team(
    team_id: int,
    invitation_data: TeamInvitationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """邀请用户加入团队"""
    
    # 检查权限（需要管理员权限）
    if not is_team_admin(current_user.id, team_id, db):
        raise HTTPException(
            status_code=403,
            detail="无权邀请用户加入团队"
        )
    
    # 检查团队是否存在
    team = db.query(Tenant).filter(
        Tenant.id == team_id,
        Tenant.is_active == True
    ).first()
    
    if not team:
        raise HTTPException(
            status_code=404,
            detail="团队不存在"
        )
    
    # 创建邀请记录
    invitation = TeamInvitation(
        id=str(uuid.uuid4()),
        team_id=team_id,
        inviter_id=current_user.id,
        invitee_email=invitation_data.email,
        invite_code=str(uuid.uuid4()).replace('-', '')[:16],
        target_role=invitation_data.target_role or UserTenantRole.USER.value,
        target_member_type=invitation_data.target_member_type or MemberType.MEMBER.value,
        message=invitation_data.message,
        expire_time=datetime.utcnow() + timedelta(days=7),  # 7天过期
        status='1'
    )
    
    db.add(invitation)
    db.commit()
    
    return TeamInvitationResponse(
        id=invitation.id,
        team_id=invitation.team_id,
        team_name=team.name,
        inviter_id=invitation.inviter_id,
        inviter_name=current_user.username,
        invitee_email=invitation.invitee_email,
        invite_code=invitation.invite_code,
        target_role=invitation.target_role,
        target_member_type=invitation.target_member_type,
        message=invitation.message,
        expire_time=invitation.expire_time,
        status=invitation.status,
        create_time=invitation.create_time
    )


@router.post("/join")
async def join_team_by_invite_code(
    request: JoinTeamRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """通过邀请码加入团队"""
    
    # 查找邀请记录
    invitation = db.query(TeamInvitation).filter(
        TeamInvitation.invite_code == request.invite_code,
        TeamInvitation.status == '1'
    ).first()
    
    if not invitation:
        raise HTTPException(
            status_code=404,
            detail="邀请码不存在或已失效"
        )
    
    # 检查是否过期
    if invitation.expire_time and datetime.utcnow() > invitation.expire_time:
        raise HTTPException(
            status_code=400,
            detail="邀请码已过期"
        )
    
    # 检查邮箱是否匹配
    if invitation.invitee_email != current_user.email:
        raise HTTPException(
            status_code=403,
            detail="邀请码与当前用户邮箱不匹配"
        )
    
    # 切换用户所属团队
    if not switch_user_team(current_user.id, invitation.team_id, invitation.inviter_id, db):
        raise HTTPException(
            status_code=500,
            detail="加入团队失败"
        )
    
    # 更新邀请状态
    invitation.status = '2'  # 已使用
    invitation.used_time = datetime.utcnow()
    invitation.used_by = current_user.id
    
    db.commit()
    
    return {"message": "成功加入团队"}


@router.delete("/{team_id}/members/{user_id}")
async def remove_team_member(
    team_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """移除团队成员"""
    
    # 检查权限（需要管理员权限）
    if not is_team_admin(current_user.id, team_id, db):
        raise HTTPException(
            status_code=403,
            detail="无权移除团队成员"
        )
    
    # 不能移除自己
    if user_id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="不能移除自己"
        )
    
    # 检查被移除用户是否在团队中
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == user_id,
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).first()
    
    if not user_tenant:
        raise HTTPException(
            status_code=404,
            detail="用户不在团队中"
        )
    
    # 不能移除团队Owner
    if user_tenant.member_type == MemberType.OWNER.value:
        raise HTTPException(
            status_code=400,
            detail="不能移除团队创建者"
        )
    
    # 禁用成员关系
    user_tenant.status = '0'
    db.commit()
    
    return {"message": "成功移除团队成员"}


@router.post("/{team_id}/leave")
async def leave_team(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """离开团队"""
    
    # 检查是否在团队中
    user_tenant = db.query(UserTenant).filter(
        UserTenant.user_id == current_user.id,
        UserTenant.tenant_id == team_id,
        UserTenant.status == '1'
    ).first()
    
    if not user_tenant:
        raise HTTPException(
            status_code=404,
            detail="您不在该团队中"
        )
    
    # 团队Owner不能通过此接口离开，只能删除团队
    if user_tenant.member_type == MemberType.OWNER.value:
        raise HTTPException(
            status_code=400,
            detail="团队创建者不能离开团队，请删除团队"
        )
    
    # 禁用成员关系
    user_tenant.status = '0'
    db.commit()
    
    return {"message": "成功离开团队"}


@router.get("/invitations/pending")
async def get_pending_invitations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取当前用户的待处理邀请"""
    
    invitations = db.query(TeamInvitation).filter(
        TeamInvitation.invitee_email == current_user.email,
        TeamInvitation.status == '1',
        TeamInvitation.expire_time > datetime.utcnow()
    ).all()
    
    result = []
    for invitation in invitations:
        # 获取团队信息
        team = db.query(Tenant).filter(Tenant.id == invitation.team_id).first()
        # 获取邀请人信息
        inviter = db.query(User).filter(User.id == invitation.inviter_id).first()
        
        result.append({
            "id": invitation.id,
            "team_id": invitation.team_id,
            "team_name": team.name if team else "Unknown Team",
            "inviter_name": inviter.username if inviter else "Unknown User",
            "message": invitation.message,
            "invite_code": invitation.invite_code,
            "expire_time": invitation.expire_time,
            "create_time": invitation.create_time
        })
    
    return {"invitations": result}


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """接受团队邀请"""
    
    # 查找邀请记录
    invitation = db.query(TeamInvitation).filter(
        TeamInvitation.id == invitation_id,
        TeamInvitation.invitee_email == current_user.email,
        TeamInvitation.status == '1'
    ).first()
    
    if not invitation:
        raise HTTPException(
            status_code=404,
            detail="邀请不存在或已失效"
        )
    
    # 检查是否过期
    if invitation.expire_time and datetime.utcnow() > invitation.expire_time:
        raise HTTPException(
            status_code=400,
            detail="邀请已过期"
        )
    
    # 切换用户所属团队
    if not switch_user_team(current_user.id, invitation.team_id, invitation.inviter_id, db):
        raise HTTPException(
            status_code=500,
            detail="接受邀请失败"
        )
    
    # 更新邀请状态
    invitation.status = '2'  # 已使用
    invitation.used_time = datetime.utcnow()
    invitation.used_by = current_user.id
    
    db.commit()
    
    return {"message": "成功接受邀请"}


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """拒绝团队邀请"""
    
    # 查找邀请记录
    invitation = db.query(TeamInvitation).filter(
        TeamInvitation.id == invitation_id,
        TeamInvitation.invitee_email == current_user.email,
        TeamInvitation.status == '1'
    ).first()
    
    if not invitation:
        raise HTTPException(
            status_code=404,
            detail="邀请不存在或已失效"
        )
    
    # 更新邀请状态为过期
    invitation.status = '0'  # 过期/拒绝
    
    db.commit()
    
    return {"message": "已拒绝邀请"}
