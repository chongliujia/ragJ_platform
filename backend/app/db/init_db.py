"""
数据库初始化
"""

import structlog
from sqlalchemy.orm import Session

from app.db.database import engine, get_db
from app.db.models import Base
from app.db.models.user import User, UserRole, UserConfig
from app.db.models.tenant import Tenant
from app.db.models.permission import Permission, RolePermission, PermissionType, DEFAULT_ROLE_PERMISSIONS
from app.core.security import get_password_hash

logger = structlog.get_logger(__name__)


async def init_db():
    """
    初始化数据库连接和表结构
    """
    try:
        logger.info("开始初始化数据库...")
        
        # 创建所有表
        Base.metadata.create_all(bind=engine)
        logger.info("数据库表创建完成")
        
        # 初始化基础数据
        db = next(get_db())
        try:
            await init_permissions(db)
            await init_default_tenant(db)
            await init_super_admin(db)
            logger.info("基础数据初始化完成")
        finally:
            db.close()
        
        logger.info("数据库初始化完成")
        
    except Exception as e:
        logger.error("数据库初始化失败", error=str(e))
        raise


async def init_permissions(db: Session):
    """初始化权限数据"""
    logger.info("初始化权限数据...")
    
    # 权限定义
    permissions_data = [
        # 系统级权限
        ("system_admin", "系统管理员", "拥有系统的完全控制权限", "system"),
        ("tenant_manage", "租户管理", "管理租户的创建、编辑和删除", "system"),
        ("user_manage", "用户管理", "管理用户的创建、编辑和删除", "system"),
        
        # 知识库权限
        ("kb_create", "创建知识库", "创建新的知识库", "knowledge_base"),
        ("kb_read", "读取知识库", "查看知识库内容", "knowledge_base"),
        ("kb_update", "更新知识库", "编辑知识库信息", "knowledge_base"),
        ("kb_delete", "删除知识库", "删除知识库", "knowledge_base"),
        ("kb_manage", "管理知识库", "完全管理知识库", "knowledge_base"),
        
        # 文档权限
        ("doc_upload", "上传文档", "上传文档到知识库", "document"),
        ("doc_read", "读取文档", "查看文档内容", "document"),
        ("doc_update", "更新文档", "编辑文档信息", "document"),
        ("doc_delete", "删除文档", "删除文档", "document"),
        
        # 聊天权限
        ("chat_create", "创建聊天", "创建新的聊天会话", "chat"),
        ("chat_read", "读取聊天", "查看聊天记录", "chat"),
        ("chat_delete", "删除聊天", "删除聊天记录", "chat"),
        
        # 配置权限
        ("config_read", "读取配置", "查看配置信息", "config"),
        ("config_update", "更新配置", "修改配置信息", "config"),
    ]
    
    # 检查权限是否已存在
    existing_permissions = db.query(Permission).all()
    existing_names = {p.name for p in existing_permissions}
    
    # 添加不存在的权限
    for name, display_name, description, category in permissions_data:
        if name not in existing_names:
            permission = Permission(
                name=name,
                display_name=display_name,
                description=description,
                category=category
            )
            db.add(permission)
    
    db.commit()
    logger.info("权限数据初始化完成")
    
    # 初始化角色权限关联
    await init_role_permissions(db)


async def init_role_permissions(db: Session):
    """初始化角色权限关联"""
    logger.info("初始化角色权限关联...")
    
    # 清除现有的角色权限关联
    db.query(RolePermission).delete()
    
    # 获取所有权限
    permissions = db.query(Permission).all()
    permission_map = {p.name: p.id for p in permissions}
    
    # 为每个角色分配权限
    for role, permission_names in DEFAULT_ROLE_PERMISSIONS.items():
        for permission_name in permission_names:
            if permission_name in permission_map:
                role_permission = RolePermission(
                    role=role,
                    permission_id=permission_map[permission_name]
                )
                db.add(role_permission)
    
    db.commit()
    logger.info("角色权限关联初始化完成")


async def init_default_tenant(db: Session):
    """初始化默认租户"""
    logger.info("初始化默认租户...")
    
    # 检查是否已存在默认租户
    existing_tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
    if existing_tenant:
        logger.info("默认租户已存在")
        return
    
    # 创建默认租户
    default_tenant = Tenant(
        name="默认租户",
        slug="default",
        description="系统默认租户",
        max_users=100,
        max_knowledge_bases=50,
        max_documents=10000,
        storage_quota_mb=10240  # 10GB
    )
    
    db.add(default_tenant)
    db.commit()
    logger.info("默认租户创建完成")


async def init_super_admin(db: Session):
    """初始化超级管理员账户"""
    logger.info("初始化超级管理员账户...")
    
    # 检查是否已存在超级管理员
    existing_admin = db.query(User).filter(User.username == "admin").first()
    if existing_admin:
        logger.info("超级管理员账户已存在")
        return
    
    # 获取默认租户
    default_tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
    if not default_tenant:
        raise Exception("默认租户不存在，无法创建超级管理员")
    
    # 创建超级管理员
    admin_user = User(
        username="admin",
        email="admin@example.com",
        hashed_password=get_password_hash("admin123"),
        full_name="超级管理员",
        role=UserRole.SUPER_ADMIN.value,
        is_active=True,
        is_verified=True,
        tenant_id=default_tenant.id
    )
    
    db.add(admin_user)
    db.commit()
    db.refresh(admin_user)
    
    # 创建默认配置
    admin_config = UserConfig(
        user_id=admin_user.id,
        preferred_chat_model="deepseek-chat",
        preferred_embedding_model="text-embedding-v2",
        preferred_rerank_model="gte-rerank",
        theme="light",
        language="zh"
    )
    
    db.add(admin_config)
    db.commit()
    
    logger.info("超级管理员账户创建完成 - 用户名: admin, 密码: admin123") 