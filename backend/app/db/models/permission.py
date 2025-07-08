"""
权限管理数据模型
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.database import Base


class PermissionType(enum.Enum):
    """权限类型枚举"""
    # 系统级权限
    SYSTEM_ADMIN = "system_admin"              # 系统管理员
    TENANT_MANAGE = "tenant_manage"            # 租户管理
    USER_MANAGE = "user_manage"                # 用户管理
    
    # 知识库权限
    KNOWLEDGE_BASE_CREATE = "kb_create"        # 创建知识库
    KNOWLEDGE_BASE_READ = "kb_read"            # 读取知识库
    KNOWLEDGE_BASE_UPDATE = "kb_update"        # 更新知识库
    KNOWLEDGE_BASE_DELETE = "kb_delete"        # 删除知识库
    KNOWLEDGE_BASE_MANAGE = "kb_manage"        # 管理知识库（完全权限）
    
    # 文档权限
    DOCUMENT_UPLOAD = "doc_upload"             # 上传文档
    DOCUMENT_READ = "doc_read"                 # 读取文档
    DOCUMENT_UPDATE = "doc_update"             # 更新文档
    DOCUMENT_DELETE = "doc_delete"             # 删除文档
    
    # 聊天权限
    CHAT_CREATE = "chat_create"                # 创建聊天
    CHAT_READ = "chat_read"                    # 读取聊天记录
    CHAT_DELETE = "chat_delete"                # 删除聊天记录
    
    # 配置权限
    CONFIG_READ = "config_read"                # 读取配置
    CONFIG_UPDATE = "config_update"            # 更新配置


# 删除重复的Table定义，使用模型类代替


class Permission(Base):
    """权限模型"""
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    
    # 权限信息
    name = Column(String(50), unique=True, nullable=False)  # 权限名称（对应PermissionType）
    display_name = Column(String(100), nullable=False)      # 显示名称
    description = Column(Text)                              # 权限描述
    category = Column(String(50), nullable=False)           # 权限分类
    
    # 状态
    is_active = Column(Boolean, default=True, nullable=False)
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class RolePermission(Base):
    """角色权限关联模型"""
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String(20), nullable=False)  # 对应UserRole
    permission_id = Column(Integer, ForeignKey("permissions.id"), nullable=False)
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关联关系
    permission = relationship("Permission")


# 预定义角色权限映射
DEFAULT_ROLE_PERMISSIONS = {
    "super_admin": [
        # 系统级权限
        "system_admin", "tenant_manage", "user_manage",
        # 知识库权限
        "kb_create", "kb_read", "kb_update", "kb_delete", "kb_manage",
        # 文档权限
        "doc_upload", "doc_read", "doc_update", "doc_delete",
        # 聊天权限
        "chat_create", "chat_read", "chat_delete",
        # 配置权限
        "config_read", "config_update"
    ],
    "admin": [
        # 用户管理（租户内）
        "user_manage",
        # 知识库权限
        "kb_create", "kb_read", "kb_update", "kb_delete", "kb_manage",
        # 文档权限
        "doc_upload", "doc_read", "doc_update", "doc_delete",
        # 聊天权限
        "chat_create", "chat_read", "chat_delete",
        # 配置权限
        "config_read", "config_update"
    ],
    "user": [
        # 知识库权限（自己的）
        "kb_create", "kb_read", "kb_update", "kb_delete",
        # 文档权限
        "doc_upload", "doc_read", "doc_update", "doc_delete",
        # 聊天权限
        "chat_create", "chat_read", "chat_delete",
        # 配置权限
        "config_read", "config_update"
    ],
    "guest": [
        # 只读权限
        "kb_read", "doc_read", "chat_read", "config_read"
    ]
}