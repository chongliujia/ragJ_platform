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
    test,
    llm_test
)

api_router = APIRouter()

# Register endpoint routers
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(chat.router, prefix="/chat", tags=["Chat"])
api_router.include_router(agents.router, prefix="/agents", tags=["Agents"])
api_router.include_router(test.router, prefix="/test", tags=["Testing"])
api_router.include_router(llm_test.router, prefix="/llm", tags=["LLM Testing"])

# Mount documents router under knowledge bases
knowledge_bases.router.include_router(documents.router, prefix="/{kb_name}/documents", tags=["Documents"])
api_router.include_router(knowledge_bases.router, prefix="/knowledge-bases", tags=["Knowledge Bases"]) 