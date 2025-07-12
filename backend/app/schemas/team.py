"""
团队管理相关的Pydantic模型
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, EmailStr


class TeamCreate(BaseModel):
    """创建团队的请求模型"""
    name: str
    description: Optional[str] = None
    team_type: Optional[str] = "collaborative"  # personal, collaborative, project
    max_members: Optional[int] = 100
    is_private: Optional[bool] = True


class TeamUpdate(BaseModel):
    """更新团队的请求模型"""
    name: Optional[str] = None
    description: Optional[str] = None
    team_type: Optional[str] = None
    max_members: Optional[int] = None
    is_private: Optional[bool] = None


class TeamResponse(BaseModel):
    """团队信息响应模型"""
    id: int
    name: str
    description: Optional[str] = None
    team_type: str
    max_members: int
    member_count: int
    created_by: Optional[int] = None
    created_at: datetime
    my_role: Optional[str] = None
    my_member_type: Optional[str] = None
    is_private: bool

    class Config:
        from_attributes = True


class TeamMemberResponse(BaseModel):
    """团队成员信息响应模型"""
    user_id: int
    username: str
    email: str
    full_name: Optional[str] = None
    role: str
    member_type: str
    join_time: datetime
    invited_by: Optional[int] = None

    class Config:
        from_attributes = True


class TeamInvitationCreate(BaseModel):
    """创建团队邀请的请求模型"""
    email: EmailStr
    target_role: Optional[str] = "USER"
    target_member_type: Optional[str] = "member"
    message: Optional[str] = None


class TeamInvitationResponse(BaseModel):
    """团队邀请响应模型"""
    id: str
    team_id: int
    team_name: str
    inviter_id: int
    inviter_name: str
    invitee_email: str
    invite_code: str
    target_role: str
    target_member_type: str
    message: Optional[str] = None
    expire_time: Optional[datetime] = None
    status: str
    create_time: datetime

    class Config:
        from_attributes = True


class TeamMemberUpdate(BaseModel):
    """更新团队成员的请求模型"""
    role: Optional[str] = None
    member_type: Optional[str] = None


class JoinTeamRequest(BaseModel):
    """加入团队的请求模型"""
    invite_code: str

class TeamJoinRequest(BaseModel):
    """加入团队的请求模型（别名）"""
    invite_code: str


class TeamSwitchRequest(BaseModel):
    """切换团队的请求模型"""
    team_id: int


class TeamPermissionCheck(BaseModel):
    """团队权限检查的请求模型"""
    user_id: int
    team_id: int
    permission: str


class TeamStats(BaseModel):
    """团队统计信息"""
    total_members: int
    active_members: int
    knowledge_bases: int
    documents: int
    storage_used_mb: int
    storage_quota_mb: int

    class Config:
        from_attributes = True