"""
数据库连接和会话管理
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings

# 创建数据库引擎（仅在内存 SQLite 使用 StaticPool）
database_url = settings.DATABASE_URL
is_sqlite = database_url.startswith("sqlite")
is_memory_sqlite = database_url in {"sqlite://", "sqlite:///:memory:"} or database_url.endswith(":memory:")

engine_kwargs = {
    "echo": settings.DEBUG,
}

if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    if is_memory_sqlite:
        engine_kwargs["poolclass"] = StaticPool
else:
    # 对网络型数据库启用预探测，提升连接可靠性
    engine_kwargs["pool_pre_ping"] = True

engine = create_engine(database_url, **engine_kwargs)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 声明基类
Base = declarative_base()


def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
