"""
Test endpoints for LLM connectivity and functionality
"""

from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import structlog

from app.services.llm_service import LLMService

router = APIRouter()
logger = structlog.get_logger(__name__)


class LLMTestRequest(BaseModel):
    """Request model for LLM testing"""
    message: str = "Hello, this is a test message."
    model: str = "qwen-turbo"
    temperature: float = 0.7
    max_tokens: int = 100


def get_llm_service() -> LLMService:
    """Dependency injection for LLM service"""
    return LLMService()


@router.get("/llm/connectivity")
async def test_llm_connectivity(
    llm_service: LLMService = Depends(get_llm_service)
) -> Dict[str, Any]:
    """
    Test connectivity to all configured LLM providers
    
    Returns:
        Connection test results for all providers
    """
    try:
        logger.info("Starting LLM connectivity test")
        results = await llm_service.test_all_connections()
        
        # Log summary
        summary = results.get("summary", {})
        if summary.get("all_connected"):
            logger.info("All LLM providers connected successfully")
        else:
            logger.warning("Some LLM providers failed to connect", 
                         connected=summary.get("connected_providers"),
                         total=summary.get("total_providers"))
        
        return {
            "status": "completed",
            "results": results,
            "timestamp": "2024-12-01T00:00:00Z"  # Will be replaced with actual timestamp
        }
        
    except Exception as e:
        logger.error("LLM connectivity test failed", error=str(e))
        raise HTTPException(
            status_code=500, 
            detail=f"Connectivity test failed: {str(e)}"
        )


@router.post("/llm/chat")
async def test_llm_chat(
    request: LLMTestRequest,
    llm_service: LLMService = Depends(get_llm_service)
) -> Dict[str, Any]:
    """
    Test chat completion with LLM
    
    This endpoint allows you to test actual chat functionality
    with the configured LLM providers.
    """
    try:
        logger.info("Testing LLM chat completion", 
                   message=request.message[:50],
                   model=request.model)
        
        result = await llm_service.chat(
            message=request.message,
            model=request.model,
            temperature=request.temperature,
            max_tokens=request.max_tokens
        )
        
        if result.get("success"):
            logger.info("LLM chat test successful", 
                       model=request.model,
                       response_length=len(result.get("message", "")))
            return {
                "status": "success",
                "request": {
                    "message": request.message,
                    "model": request.model,
                    "temperature": request.temperature,
                    "max_tokens": request.max_tokens
                },
                "response": result
            }
        else:
            logger.error("LLM chat test failed", 
                        model=request.model,
                        error=result.get("error"))
            return {
                "status": "failed",
                "request": {
                    "message": request.message,
                    "model": request.model
                },
                "error": result.get("error"),
                "details": result.get("details")
            }
            
    except Exception as e:
        logger.error("LLM chat test exception", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Chat test failed: {str(e)}"
        )


@router.get("/config")
async def get_test_config() -> Dict[str, Any]:
    """
    Get current test configuration and available models
    """
    from app.core.config import settings
    
    return {
        "available_models": {
            "qwen": {
                "chat_model": settings.QWEN_CHAT_MODEL,
                "embedding_model": settings.QWEN_EMBEDDING_MODEL,
                "rerank_model": settings.QWEN_RERANK_MODEL,
                "configured": bool(settings.DASHSCOPE_API_KEY)
            }
        },
        "default_parameters": {
            "temperature": 0.7,
            "max_tokens": 1000,
            "top_p": 0.8
        },
        "api_endpoints": {
            "connectivity_test": "/api/v1/test/llm/connectivity",
            "chat_test": "/api/v1/test/llm/chat",
            "config": "/api/v1/test/config"
        },
        "instructions": {
            "setup": "Set DASHSCOPE_API_KEY in your .env file",
            "test_connectivity": "Call GET /api/v1/test/llm/connectivity",
            "test_chat": "Call POST /api/v1/test/llm/chat with message"
        }
    } 