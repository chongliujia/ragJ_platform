"""
团队邀请数据模型
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.db.database import Base


class TeamInvitation(Base):
    """团队邀请模型"""

    __tablename__ = "team_invitations"

    id = Column(String(128), primary_key=True, default=lambda: str(uuid.uuid4()))
    
    # 团队和邀请信息
    team_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)  # 团队ID(租户ID)
    inviter_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 邀请人ID
    invitee_email = Column(String(128), nullable=False)  # 被邀请人邮箱
    invite_code = Column(String(128), unique=True, nullable=False)  # 邀请码
    
    # 目标角色和权限
    target_role = Column(String(32), default='USER', nullable=False)  # 目标角色: OWNER/ADMIN/USER
    target_member_type = Column(String(20), default='member', nullable=False)  # 目标成员类型: owner/admin/member
    
    # 邀请详情
    message = Column(Text)  # 邀请消息
    expire_time = Column(DateTime(timezone=True))  # 过期时间
    
    # 使用状态
    used_time = Column(DateTime(timezone=True))  # 使用时间
    used_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # 使用人ID
    status = Column(String(1), default='1', nullable=False)  # 状态: 0-过期 1-有效 2-已使用
    
    # 时间戳
    create_time = Column(DateTime(timezone=True), server_default=func.now())
    update_time = Column(DateTime(timezone=True), onupdate=func.now())
    create_date = Column(String(19))  # 创建日期字符串（保持与现有表一致）
    update_date = Column(String(19))  # 更新日期字符串

    # 关联关系
    team = relationship("Tenant")
    inviter = relationship("User", foreign_keys=[inviter_id])
    user = relationship("User", foreign_keys=[used_by])

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # 自动生成邀请码
        if not self.invite_code:
            self.invite_code = str(uuid.uuid4()).replace('-', '')[:16]
        # 自动设置日期字符串
        from datetime import datetime
        now = datetime.now()
        if not self.create_date:
            self.create_date = now.strftime('%Y-%m-%d %H:%M:%S')
        if not self.update_date:
            self.update_date = now.strftime('%Y-%m-%d %H:%M:%S')