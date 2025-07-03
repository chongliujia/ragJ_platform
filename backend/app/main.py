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

# 配置日志
configure_logging()
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时执行
    logger.info("启动 RAG Platform...")
    
    # 初始化数据库
    try:
        await init_db()
        logger.info("数据库初始化完成")
    except Exception as e:
        logger.error("数据库初始化失败", error=str(e))
        raise
    
    yield
    
    # 关闭时执行
    logger.info("关闭 RAG Platform...")


def create_application() -> FastAPI:
    """创建 FastAPI 应用实例"""
    
    app = FastAPI(
        title=settings.PROJECT_NAME,
        description="基于 Rust + Python + LangGraph 的高性能 RAG 平台",
        version="1.0.0",
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        docs_url=f"{settings.API_V1_STR}/docs",
        redoc_url=f"{settings.API_V1_STR}/redoc",
        lifespan=lifespan
    )

    # CORS中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # 生产环境应该限制具体域名
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
            "docs": f"{settings.API_V1_STR}/docs"
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
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level="info"
    ) 