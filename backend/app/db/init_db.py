"""
数据库初始化
"""

import structlog
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy import text
import asyncio

from app.db.database import engine, get_db
from app.db.models import Base
from app.db.models.user import User, UserRole, UserConfig
from app.db.models.tenant import Tenant
from app.db.models.permission import (
    Permission,
    RolePermission,
    PermissionType,
    DEFAULT_ROLE_PERMISSIONS,
)
from app.core.security import get_password_hash

logger = structlog.get_logger(__name__)


async def _wait_for_db_ready(max_wait_seconds: int = 60):
    """在 MySQL 下等待数据库可用，避免容器启动竞态。"""
    if not engine.dialect.name.startswith("mysql"):
        return

    delay = 0.5
    deadline = max_wait_seconds
    attempts = 0
    while deadline > 0:
        attempts += 1
        try:
            conn = engine.connect()
            try:
                conn.execute(text("SELECT 1"))
                logger.info("MySQL ready", attempts=attempts)
                return
            finally:
                conn.close()
        except OperationalError as e:
            msg = str(e).lower()
            if (
                "can't connect to mysql server" in msg
                or "connection refused" in msg
                or "server has gone away" in msg
            ):
                logger.warning(
                    "MySQL not ready yet, retrying",
                    attempts=attempts,
                    next_delay=delay,
                )
                await asyncio.sleep(delay)
                deadline -= delay
                delay = min(delay * 2, 5.0)
                continue
            raise

    raise RuntimeError("MySQL not ready after waiting")


async def init_db():
    """
    初始化数据库连接和表结构
    """
    lock_conn = None
    acquired_lock = False
    try:
        logger.info("开始初始化数据库...")

        # 等待 MySQL 容器就绪
        await _wait_for_db_ready()

        # 在 MySQL 下使用 advisory lock 串行化初始化，避免 reload 并发导致锁等待
        if engine.dialect.name.startswith("mysql"):
            try:
                lock_conn = engine.connect()
                res = lock_conn.execute(
                    text("SELECT GET_LOCK(:name, :timeout)"),
                    {"name": "ragj_platform_init_db", "timeout": 30},
                ).scalar()
                acquired_lock = res == 1
                if acquired_lock:
                    logger.info("已获取 init_db 锁")
                else:
                    logger.warning("未获取 init_db 锁，可能有另一个实例正在初始化")
                    # 若锁超时未获取，则跳过本次初始化，避免并发写导致锁等待
                    return
            except Exception as e:
                logger.warning(f"获取 init_db 锁失败，继续无锁初始化: {e}")

        # 创建所有表
        Base.metadata.create_all(bind=engine)
        logger.info("数据库表创建完成")

        # 迁移/补齐历史表字段（向后兼容旧 SQLite 文件）
        try:
            _safe_migrate_documents_table()
            _safe_migrate_users_table()
            _safe_migrate_tenants_table()
        except Exception as mig_err:
            logger.warning(f"文档表迁移检查失败: {mig_err}")

        # 初始化基础数据
        db = next(get_db())
        try:
            try:
                await init_permissions(db)
            except (OperationalError, SQLAlchemyError) as e:
                db.rollback()
                logger.warning(f"初始化权限失败，已跳过: {e}")

            try:
                await init_default_tenant(db)
            except (OperationalError, SQLAlchemyError) as e:
                db.rollback()
                logger.warning(f"初始化默认租户失败，已跳过: {e}")

            try:
                await init_super_admin(db)
            except (OperationalError, SQLAlchemyError) as e:
                db.rollback()
                logger.warning(f"初始化超级管理员失败，已跳过: {e}")
            logger.info("基础数据初始化完成")
        finally:
            db.close()

        logger.info("数据库初始化完成")

    except Exception as e:
        logger.error("数据库初始化失败", error=str(e))
        raise
    finally:
        if lock_conn is not None:
            if acquired_lock:
                try:
                    lock_conn.execute(
                        text("SELECT RELEASE_LOCK(:name)"),
                        {"name": "ragj_platform_init_db"},
                    )
                    logger.info("已释放 init_db 锁")
                except Exception:
                    pass
            lock_conn.close()


def _safe_migrate_documents_table():
    """补齐 documents 表的新增字段，兼容旧版本 SQLite 文件。

    新增字段：
      - knowledge_base_name TEXT NOT NULL DEFAULT ''
      - doc_metadata TEXT DEFAULT '{}'
      - vector_ids TEXT DEFAULT '[]'
      - tenant_id INTEGER NOT NULL DEFAULT 1
      - uploaded_by INTEGER NOT NULL DEFAULT 0
    """
    from sqlalchemy import text
    conn = engine.connect()
    try:
        dialect_name = engine.dialect.name
        if dialect_name != 'sqlite':
            # 仅在 SQLite 下做轻量迁移；其他数据库建议通过正式迁移工具
            return

        cols = conn.execute(text("PRAGMA table_info('documents')")).fetchall()
        existing = {c[1] for c in cols}  # name at index 1

        to_add = []
        if 'knowledge_base_name' not in existing:
            to_add.append("ALTER TABLE documents ADD COLUMN knowledge_base_name TEXT NOT NULL DEFAULT ''")
        if 'doc_metadata' not in existing:
            to_add.append("ALTER TABLE documents ADD COLUMN doc_metadata TEXT DEFAULT '{}' ")
        if 'vector_ids' not in existing:
            to_add.append("ALTER TABLE documents ADD COLUMN vector_ids TEXT DEFAULT '[]' ")
        if 'tenant_id' not in existing:
            to_add.append("ALTER TABLE documents ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1")
        if 'uploaded_by' not in existing:
            to_add.append("ALTER TABLE documents ADD COLUMN uploaded_by INTEGER NOT NULL DEFAULT 0")

        for sql in to_add:
            logger.info(f"迁移 documents 表：执行 {sql}")
            conn.execute(text(sql))
        if to_add:
            logger.info("documents 表字段补齐完成")
    finally:
        conn.close()


def _safe_migrate_users_table():
    """补齐 users 表的新增字段，兼容旧版本 SQLite 文件。"""
    from sqlalchemy import text
    conn = engine.connect()
    try:
        if engine.dialect.name != "sqlite":
            return

        cols = conn.execute(text("PRAGMA table_info('users')")).fetchall()
        if not cols:
            return
        existing = {c[1] for c in cols}

        to_add = []
        if "full_name" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN full_name TEXT")
        if "role" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
        if "is_active" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1")
        if "is_verified" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT 0")
        if "tenant_id" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1")
        if "last_login_at" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN last_login_at DATETIME")
        if "created_at" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN created_at DATETIME")
        if "updated_at" not in existing:
            to_add.append("ALTER TABLE users ADD COLUMN updated_at DATETIME")

        for sql in to_add:
            logger.info(f"迁移 users 表：执行 {sql}")
            conn.execute(text(sql))
        if to_add:
            logger.info("users 表字段补齐完成")
    finally:
        conn.close()


def _safe_migrate_tenants_table():
    """补齐 tenants 表的新增字段，兼容旧版本 SQLite 文件。"""
    from sqlalchemy import text
    conn = engine.connect()
    try:
        if engine.dialect.name != "sqlite":
            return

        cols = conn.execute(text("PRAGMA table_info('tenants')")).fetchall()
        if not cols:
            return
        existing = {c[1] for c in cols}

        to_add = []
        if "description" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN description TEXT")
        if "is_active" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1")
        if "max_users" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN max_users INTEGER DEFAULT 10")
        if "max_knowledge_bases" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN max_knowledge_bases INTEGER DEFAULT 5")
        if "max_documents" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN max_documents INTEGER DEFAULT 1000")
        if "storage_quota_mb" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN storage_quota_mb INTEGER DEFAULT 1024")
        if "settings" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN settings TEXT DEFAULT '{}' ")
        if "team_type" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN team_type TEXT NOT NULL DEFAULT 'personal'")
        if "max_members" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN max_members INTEGER DEFAULT 100")
        if "created_by" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN created_by INTEGER")
        if "team_avatar" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN team_avatar TEXT")
        if "is_private" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 1")
        if "created_at" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN created_at DATETIME")
        if "updated_at" not in existing:
            to_add.append("ALTER TABLE tenants ADD COLUMN updated_at DATETIME")

        for sql in to_add:
            logger.info(f"迁移 tenants 表：执行 {sql}")
            conn.execute(text(sql))
        if to_add:
            logger.info("tenants 表字段补齐完成")
    finally:
        conn.close()

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
                category=category,
            )
            db.add(permission)

    db.commit()
    logger.info("权限数据初始化完成")

    # 初始化角色权限关联
    await init_role_permissions(db)


async def init_role_permissions(db: Session):
    """初始化角色权限关联"""
    logger.info("初始化角色权限关联...")

    # 获取所有权限
    permissions = db.query(Permission).all()
    permission_map = {p.name: p.id for p in permissions}

    # 计算期望的 (role, permission_id) 集合
    desired_pairs: set[tuple[str, int]] = set()
    for role, permission_names in DEFAULT_ROLE_PERMISSIONS.items():
        for permission_name in permission_names:
            pid = permission_map.get(permission_name)
            if pid:
                desired_pairs.add((role, pid))

    existing_pairs = {
        (rp.role, rp.permission_id) for rp in db.query(RolePermission).all()
    }
    to_add = desired_pairs - existing_pairs
    to_remove = existing_pairs - desired_pairs

    # 删除过期关联（可选、尽量不阻塞启动）
    if to_remove:
        try:
            for role, pid in to_remove:
                db.query(RolePermission).filter(
                    RolePermission.role == role,
                    RolePermission.permission_id == pid,
                ).delete(synchronize_session=False)
            db.commit()
        except (OperationalError, SQLAlchemyError) as e:
            db.rollback()
            logger.warning(f"删除过期角色权限关联失败，已跳过: {e}")

    # 为每个角色分配权限
    try:
        for role, pid in to_add:
            db.add(RolePermission(role=role, permission_id=pid))
        db.commit()
        logger.info(
            "角色权限关联初始化完成",
            added=len(to_add),
            removed=len(to_remove) if to_remove else 0,
        )
    except (OperationalError, SQLAlchemyError) as e:
        db.rollback()
        logger.warning(f"角色权限关联写入失败（可能并发启动），已跳过: {e}")


async def init_default_tenant(db: Session):
    """初始化默认租户"""
    logger.info("初始化默认租户...")

    for attempt in range(5):
        existing_tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
        if existing_tenant:
            logger.info("默认租户已存在")
            return

        default_tenant = Tenant(
            name="默认租户",
            slug="default",
            description="系统默认租户",
            max_users=100,
            max_knowledge_bases=50,
            max_documents=10000,
            storage_quota_mb=10240,  # 10GB
        )

        try:
            db.add(default_tenant)
            db.commit()
            logger.info("默认租户创建完成")
            return
        except OperationalError as e:
            db.rollback()
            msg = str(e).lower()
            if ("lock wait timeout" in msg or "deadlock" in msg) and attempt < 4:
                await asyncio.sleep(0.5 * (2**attempt))
                continue
            logger.warning(f"默认租户创建失败，已跳过: {e}")
            return
        except SQLAlchemyError as e:
            db.rollback()
            logger.warning(f"默认租户创建失败，已跳过: {e}")
            return


async def init_super_admin(db: Session):
    """初始化超级管理员账户"""
    logger.info("初始化超级管理员账户...")

    for attempt in range(5):
        existing_admin = db.query(User).filter(User.username == "admin").first()
        if existing_admin:
            logger.info("超级管理员账户已存在")
            return

        default_tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
        if not default_tenant:
            logger.warning("默认租户不存在，跳过超级管理员创建")
            return

        admin_user = User(
            username="admin",
            email="admin@example.com",
            hashed_password=get_password_hash("admin123"),
            full_name="超级管理员",
            role=UserRole.SUPER_ADMIN.value,
            is_active=True,
            is_verified=True,
            tenant_id=default_tenant.id,
        )

        try:
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            break
        except OperationalError as e:
            db.rollback()
            msg = str(e).lower()
            if ("lock wait timeout" in msg or "deadlock" in msg) and attempt < 4:
                await asyncio.sleep(0.5 * (2**attempt))
                continue
            logger.warning(f"超级管理员创建失败，已跳过: {e}")
            return
        except SQLAlchemyError as e:
            db.rollback()
            logger.warning(f"超级管理员创建失败，已跳过: {e}")
            return

    if not admin_user or not getattr(admin_user, "id", None):
        return

    # 创建默认配置（幂等）
    existing_cfg = db.query(UserConfig).filter(UserConfig.user_id == admin_user.id).first()
    if existing_cfg is None:
        admin_config = UserConfig(
            user_id=admin_user.id,
            preferred_chat_model="deepseek-chat",
            preferred_embedding_model="text-embedding-v2",
            preferred_rerank_model="gte-rerank",
            theme="light",
            language="zh",
        )
        try:
            db.add(admin_config)
            db.commit()
        except SQLAlchemyError:
            db.rollback()

    logger.info("超级管理员账户创建完成 - 用户名: admin, 密码: admin123")
