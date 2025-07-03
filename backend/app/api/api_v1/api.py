"""
API v1 路由管理
"""

from fastapi import APIRouter

from app.api.api_v1.endpoints import (
    chat,
    knowledge_bases,
    documents,
    agents,
    auth,
    test
)

api_router = APIRouter()

# 注册各个端点路由
api_router.include_router(auth.router, prefix="/auth", tags=["认证"])
api_router.include_router(chat.router, prefix="/chat", tags=["聊天"])
api_router.include_router(knowledge_bases.router, prefix="/knowledge-bases", tags=["知识库"])
api_router.include_router(documents.router, prefix="/documents", tags=["文档"])
api_router.include_router(agents.router, prefix="/agents", tags=["智能体"])
api_router.include_router(test.router, prefix="/test", tags=["测试"]) 