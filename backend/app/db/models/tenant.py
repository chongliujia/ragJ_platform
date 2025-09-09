"""
租户数据模型
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.database import Base


class TeamType(enum.Enum):
    """团队类型枚举"""
    PERSONAL = "personal"  # 个人团队
    COLLABORATIVE = "collaborative"  # 协作团队
    PROJECT = "project"  # 项目团队


class Tenant(Base):
    """租户模型 - 用于多租户隔离（现在等同于团队）"""

    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)

    # 基本信息
    name = Column(String(100), nullable=False)
    slug = Column(
        String(50), unique=True, index=True, nullable=False
    )  # URL友好的标识符
    description = Column(Text)

    # 团队特有字段
    team_type = Column(String(20), default=TeamType.PERSONAL.value, nullable=False)
    max_members = Column(Integer, default=100)  # 最大成员数
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # 创建人ID
    team_avatar = Column(Text)  # 团队头像
    is_private = Column(Boolean, default=True, nullable=False)  # 是否私有团队

    # 状态
    is_active = Column(Boolean, default=True, nullable=False)

    # 配置信息
    max_users = Column(Integer, default=10)  # 最大用户数限制（保持向后兼容）
    max_knowledge_bases = Column(Integer, default=5)  # 最大知识库数限制
    max_documents = Column(Integer, default=1000)  # 最大文档数限制
    storage_quota_mb = Column(Integer, default=1024)  # 存储配额(MB)

    # 自定义配置
    settings = Column(JSON, default=dict)

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关联关系
    users = relationship("User", foreign_keys="User.tenant_id", back_populates="tenant")  # 明确指定外键
    knowledge_bases = relationship("KnowledgeBase", back_populates="tenant")
    creator = relationship("User", foreign_keys=[created_by])  # 创建人关系
    user_tenants = relationship("UserTenant", back_populates="tenant")  # 新的多对多关系
