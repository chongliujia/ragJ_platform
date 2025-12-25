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
    model_config,
    users,
    admin,
    teams,
    workflows,
    public,
    api_keys,
    evaluations,
)

api_router = APIRouter()

# Register endpoint routers
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(admin.router, prefix="/admin", tags=["Admin"])
api_router.include_router(chat.router, prefix="/chat", tags=["Chat"])
api_router.include_router(agents.router, prefix="/agents", tags=["Agents"])

# Mount documents router under knowledge bases
knowledge_bases.router.include_router(
    documents.router, prefix="/{kb_name}/documents", tags=["Documents"]
)
api_router.include_router(
    knowledge_bases.router, prefix="/knowledge-bases", tags=["Knowledge Bases"]
)

# Add separate documents endpoints for global operations
api_router.include_router(
    documents.router, prefix="/documents", tags=["Documents Global"]
)

# Add model configuration endpoints
api_router.include_router(
    model_config.router, prefix="/model-config", tags=["Model Configuration"]
)

# Add team management endpoints
api_router.include_router(
    teams.router, prefix="/teams", tags=["Team Management"]
)

# Add workflow management endpoints
api_router.include_router(
    workflows.router, prefix="/workflows", tags=["Workflow Management"]
)

# Public API (x-api-key) for embedding/integration
api_router.include_router(
    public.router, prefix="/public", tags=["Public API"]
)

# Admin: API keys management
api_router.include_router(
    api_keys.router, prefix="/admin", tags=["Admin"]
)

# Evaluation datasets and runs
api_router.include_router(
    evaluations.router, prefix="/evaluations", tags=["Evaluations"]
)
