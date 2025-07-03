"""
LLM Service for integrating with various language models
Currently supports Qwen (通义千问) API for testing
"""

import asyncio
import json
from typing import Optional, Dict, Any, AsyncGenerator
import structlog
import httpx

from app.core.config import settings

logger = structlog.get_logger(__name__)


class QwenAPIService:
    """Service for Qwen (通义千问) API integration"""
    
    def __init__(self):
        """Initialize Qwen API service"""
        self.api_key = settings.DASHSCOPE_API_KEY
        self.base_url = "https://dashscope.aliyuncs.com/api/v1"
        self.model = settings.QWEN_CHAT_MODEL
        
    async def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to Qwen API
        
        Returns:
            Dict with connection test results
        """
        if not self.api_key:
            return {
                "success": False,
                "error": "DASHSCOPE_API_KEY not configured",
                "message": "Please set DASHSCOPE_API_KEY in environment variables"
            }
        
        try:
            # Simple test request to verify API connectivity
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/services/aigc/text-generation/generation",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "input": {
                            "messages": [
                                {
                                    "role": "user",
                                    "content": "Hello, this is a connection test."
                                }
                            ]
                        },
                        "parameters": {
                            "max_tokens": 50
                        }
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return {
                        "success": True,
                        "model": self.model,
                        "response": result.get("output", {}).get("text", ""),
                        "usage": result.get("usage", {}),
                        "message": "Connection successful"
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API returned status {response.status_code}",
                        "details": response.text,
                        "message": "API connection failed"
                    }
                    
        except httpx.TimeoutException:
            return {
                "success": False,
                "error": "Request timeout",
                "message": "API request timed out after 30 seconds"
            }
        except Exception as e:
            logger.error("Qwen API test failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "message": "Unexpected error during API test"
            }
    
    async def chat_completion(
        self, 
        message: str, 
        temperature: float = 0.7,
        max_tokens: int = 1000
    ) -> Dict[str, Any]:
        """
        Generate chat completion using Qwen API
        
        Args:
            message: User input message
            temperature: Randomness in responses (0.0 to 2.0)
            max_tokens: Maximum tokens to generate
            
        Returns:
            Dict with response data
        """
        if not self.api_key:
            raise ValueError("DASHSCOPE_API_KEY not configured")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/services/aigc/text-generation/generation",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "input": {
                            "messages": [
                                {
                                    "role": "user",
                                    "content": message
                                }
                            ]
                        },
                        "parameters": {
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            "top_p": 0.8
                        }
                    },
                    timeout=60.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return {
                        "success": True,
                        "message": result.get("output", {}).get("text", ""),
                        "model": self.model,
                        "usage": result.get("usage", {}),
                        "request_id": result.get("request_id", "")
                    }
                else:
                    error_detail = response.text
                    logger.error("Qwen API error", 
                               status=response.status_code, 
                               detail=error_detail)
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail
                    }
                    
        except Exception as e:
            logger.error("Chat completion failed", error=str(e))
            return {
                "success": False,
                "error": str(e)
            }
    
    async def stream_chat_completion(
        self, 
        message: str, 
        temperature: float = 0.7,
        max_tokens: int = 1000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Generate streaming chat completion using Qwen API
        
        Args:
            message: User input message
            temperature: Randomness in responses
            max_tokens: Maximum tokens to generate
            
        Yields:
            Dict with streaming response chunks
        """
        if not self.api_key:
            yield {
                "success": False,
                "error": "DASHSCOPE_API_KEY not configured"
            }
            return
        
        try:
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/services/aigc/text-generation/generation",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream"
                    },
                    json={
                        "model": self.model,
                        "input": {
                            "messages": [
                                {
                                    "role": "user", 
                                    "content": message
                                }
                            ]
                        },
                        "parameters": {
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            "top_p": 0.8,
                            "incremental_output": True
                        }
                    },
                    timeout=60.0
                ) as response:
                    
                    if response.status_code != 200:
                        yield {
                            "success": False,
                            "error": f"API error {response.status_code}",
                            "details": await response.aread()
                        }
                        return
                    
                    async for chunk in response.aiter_lines():
                        if chunk.startswith("data: "):
                            try:
                                data = json.loads(chunk[6:])  # Remove "data: " prefix
                                if "output" in data:
                                    yield {
                                        "success": True,
                                        "content": data["output"].get("text", ""),
                                        "finish_reason": data["output"].get("finish_reason"),
                                        "model": self.model
                                    }
                            except json.JSONDecodeError:
                                continue
                                
        except Exception as e:
            logger.error("Streaming chat failed", error=str(e))
            yield {
                "success": False,
                "error": str(e)
            }


class LLMService:
    """
    Main LLM service that orchestrates different AI models
    """
    
    def __init__(self):
        """Initialize LLM service with available providers"""
        self.qwen = QwenAPIService()
        
    async def test_all_connections(self) -> Dict[str, Any]:
        """
        Test connections to all configured LLM services
        
        Returns:
            Dict with test results for all providers
        """
        results = {}
        
        # Test Qwen API
        logger.info("Testing Qwen API connection...")
        qwen_result = await self.qwen.test_connection()
        results["qwen"] = qwen_result
        
        # Summary
        all_success = all(r.get("success", False) for r in results.values())
        results["summary"] = {
            "all_connected": all_success,
            "total_providers": len(results) - 1,  # Exclude summary itself
            "connected_providers": sum(1 for r in results.values() 
                                     if isinstance(r, dict) and r.get("success", False))
        }
        
        return results
    
    async def chat(
        self, 
        message: str, 
        model: str = "qwen-turbo",
        temperature: float = 0.7,
        max_tokens: int = 1000
    ) -> Dict[str, Any]:
        """
        Generate chat response using specified model
        
        Args:
            message: User input message
            model: Model to use (currently only qwen-turbo supported)
            temperature: Response randomness
            max_tokens: Maximum response length
            
        Returns:
            Dict with chat response
        """
        if model.startswith("qwen"):
            return await self.qwen.chat_completion(message, temperature, max_tokens)
        else:
            return {
                "success": False,
                "error": f"Model {model} not supported yet",
                "message": "Currently only Qwen models are supported"
            } 