"""
用户相关数据模型
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    Text,
    ForeignKey,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.database import Base


class UserRole(enum.Enum):
    """用户角色枚举"""

    SUPER_ADMIN = "super_admin"  # 系统级超级管理员
    TENANT_ADMIN = "tenant_admin"  # 租户级管理员
    USER = "user"  # 普通用户


class User(Base):
    """用户模型"""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))

    # 角色和状态
    role = Column(String(20), default=UserRole.USER.value, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)

    # 租户关联
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    last_login_at = Column(DateTime(timezone=True))

    # 关联关系
    tenant = relationship("Tenant", foreign_keys=[tenant_id], back_populates="users")  # 明确指定外键
    user_config = relationship("UserConfig", back_populates="user", uselist=False)
    knowledge_bases = relationship("KnowledgeBase", back_populates="owner")
    user_tenants = relationship("UserTenant", foreign_keys="UserTenant.user_id")  # 新的多对多关系


class UserConfig(Base):
    """用户配置模型"""

    __tablename__ = "user_configs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    # AI模型配置
    preferred_chat_model = Column(String(100), default="deepseek-chat")
    preferred_embedding_model = Column(String(100), default="text-embedding-v2")
    preferred_rerank_model = Column(String(100), default="gte-rerank")
    preferred_extraction_model = Column(String(100), default="deepseek-chat")
    # 语义抽取默认限制
    extraction_max_chunks = Column(Integer, default=3)
    extraction_max_text_chars = Column(Integer, default=1800)
    extraction_max_items = Column(Integer, default=12)
    extraction_document_limit = Column(Integer, default=6)
    extraction_auto_chunking = Column(Boolean, default=False)
    extraction_chunk_strategy = Column(String(20), default="uniform")
    extraction_mode = Column(String(20), default="direct")
    extraction_progressive_enabled = Column(Boolean, default=False)
    extraction_progressive_min_items = Column(Integer, default=6)
    extraction_progressive_step = Column(Integer, default=3)
    extraction_summary_max_chars = Column(Integer, default=2000)
    extraction_entity_type_whitelist = Column(Text, default="")
    extraction_relation_type_whitelist = Column(Text, default="")

    # 聊天配置
    max_tokens = Column(Integer, default=2000)
    temperature = Column(String(10), default="0.7")
    top_p = Column(String(10), default="0.9")

    # 检索配置
    retrieval_top_k = Column(Integer, default=5)
    chunk_size = Column(Integer, default=1000)
    chunk_overlap = Column(Integer, default=200)

    # 界面配置
    theme = Column(String(20), default="light")  # light, dark
    language = Column(String(10), default="zh")  # zh, en

    # 自定义配置 (JSON格式存储额外配置)
    custom_settings = Column(JSON, default=dict)

    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关联关系
    user = relationship("User", back_populates="user_config")
