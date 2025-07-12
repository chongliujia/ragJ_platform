"""
用户-租户关系数据模型
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.database import Base


class UserTenantRole(enum.Enum):
    """用户在租户中的角色枚举"""
    OWNER = "OWNER"  # 所有者
    ADMIN = "ADMIN"  # 管理员
    USER = "USER"    # 普通用户


class MemberType(enum.Enum):
    """成员类型枚举"""
    OWNER = "owner"     # 创建者
    ADMIN = "admin"     # 管理员
    MEMBER = "member"   # 成员


class UserTenant(Base):
    """用户-租户关系模型（用户-团队成员关系）"""

    __tablename__ = "user_tenants"

    id = Column(Integer, primary_key=True, index=True)
    
    # 关联字段
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    
    # 角色和权限
    role = Column(String(32), default=UserTenantRole.USER.value, nullable=False)
    member_type = Column(String(20), default=MemberType.MEMBER.value, nullable=False)
    
    # 状态
    status = Column(String(1), default='1', nullable=False)  # 0-禁用 1-启用
    
    # 加入信息
    join_time = Column(DateTime(timezone=True), server_default=func.now())
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关联关系
    user = relationship("User", foreign_keys=[user_id], overlaps="user_tenants")
    tenant = relationship("Tenant", back_populates="user_tenants")
    inviter = relationship("User", foreign_keys=[invited_by])

    # 组合唯一约束
    __table_args__ = (
        # 确保一个用户在一个租户中只有一个记录
        # 但根据技术方案，用户同时只能属于一个团队，这需要在应用层控制
    )