"""
RAG Platform - FastAPI 应用入口
基于 LangGraph 的智能体平台主服务
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import structlog

from app.core.config import settings
from app.core.logging import configure_logging
from app.api.api_v1.api import api_router
from app.db.init_db import init_db
from app.services.elasticsearch_service import startup_es_service, shutdown_es_service

# 配置日志
configure_logging()
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时执行
    logger.info("启动 RAG Platform...")

    # 安全检查：SECRET_KEY 与 CORS 配置
    if not settings.DEBUG:
        if not settings.SECRET_KEY:
            logger.error("生产环境必须设置 SECRET_KEY 环境变量")
            raise RuntimeError("SECRET_KEY is required in production")
        allowed = settings.get_allowed_origins()
        if (not allowed) or ("*" in allowed):
            logger.error(
                "生产环境必须显式配置 ALLOWED_ORIGINS（逗号分隔），且不得包含 *"
            )
            raise RuntimeError(
                "In production, ALLOWED_ORIGINS must be set to a comma-separated whitelist without *"
            )
    else:
        # 开发环境采用固定的非机密密钥，避免重启导致 token 失效
        if not settings.SECRET_KEY:
            settings.SECRET_KEY = "dev-insecure-secret-key"

    # 初始化数据库
    try:
        await init_db()
        logger.info("数据库初始化完成")
    except Exception as e:
        logger.error("数据库初始化失败", error=str(e))
        raise

    # 启动 Elasticsearch 服务（可禁用）
    try:
        if settings.ENABLE_ELASTICSEARCH:
            await startup_es_service()
            logger.info("Elasticsearch 服务启动完成")
        else:
            logger.info("Elasticsearch 已禁用，跳过连接")
    except Exception as e:
        logger.error("Elasticsearch 服务启动失败", error=str(e))

    yield

    # 关闭时执行
    logger.info("关闭 RAG Platform...")
    await shutdown_es_service()


def create_application() -> FastAPI:
    """创建 FastAPI 应用实例"""

    app = FastAPI(
        title=settings.PROJECT_NAME,
        description="基于 Rust + Python + LangGraph 的高性能 RAG 平台",
        version="1.0.0",
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        docs_url=f"{settings.API_V1_STR}/docs",
        redoc_url=f"{settings.API_V1_STR}/redoc",
        lifespan=lifespan,
    )

    # CORS中间件
    if settings.DEBUG:
        allow_origins = ["*"]
    else:
        allow_origins = settings.get_allowed_origins()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册路由
    app.include_router(api_router, prefix=settings.API_V1_STR)

    # 静态文件服务
    app.mount("/static", StaticFiles(directory="static"), name="static")

    @app.get("/")
    async def root():
        """根路径健康检查"""
        return {
            "message": "RAG Platform API",
            "version": "1.0.0",
            "docs": f"{settings.API_V1_STR}/docs",
        }

    @app.get("/health")
    async def health_check():
        """健康检查接口"""
        return {"status": "healthy", "service": "ragj_platform"}

    return app


# 创建应用实例
app = create_application()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app", host="0.0.0.0", port=8000, reload=settings.DEBUG, log_level="info"
    )
