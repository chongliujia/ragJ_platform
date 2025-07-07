"""
LLM Testing API Endpoints
"""
import logging
from typing import Dict, Any
from fastapi import APIRouter, HTTPException
from app.services.llm_service import llm_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/test-connections")
async def test_llm_connections():
    """
    Test connections to all configured LLM services
    """
    try:
        results = await llm_service.test_all_connections()
        return {
            "status": "success",
            "results": results
        }
    except Exception as e:
        logger.error(f"Failed to test LLM connections: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to test connections: {str(e)}")


@router.post("/test-chat")
async def test_chat(request: dict):
    """
    Test chat completion with specified model
    """
    try:
        message = request.get("message", "Hello, how are you?")
        model = request.get("model", "deepseek-chat")
        
        response = await llm_service.chat(
            message=message,
            model=model
        )
        
        return {
            "status": "success",
            "response": response
        }
    except Exception as e:
        logger.error(f"Failed to test chat: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to test chat: {str(e)}")


@router.post("/test-embeddings")
async def test_embeddings(request: dict):
    """
    Test embedding generation
    """
    try:
        texts = request.get("texts", ["Hello world", "This is a test"])
        model = request.get("model", "deepseek-embedding")
        
        response = await llm_service.get_embeddings(
            texts=texts,
            model=model
        )
        
        return {
            "status": "success",
            "response": response
        }
    except Exception as e:
        logger.error(f"Failed to test embeddings: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to test embeddings: {str(e)}") 