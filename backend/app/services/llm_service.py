"""
LLM Service for integrating with various language models
Currently supports Qwen (通义千问) API for testing
"""

import asyncio
import json
import re
from typing import Optional, Dict, Any, AsyncGenerator
import structlog
import httpx

from app.core.config import settings

logger = structlog.get_logger(__name__)


class OpenAIAPIService:
    """Service for OpenAI API integration"""

    def __init__(self):
        """Initialize OpenAI API service"""
        self.api_key = settings.OPENAI_API_KEY
        self.base_url = settings.OPENAI_BASE_URL

    async def test_connection(self) -> Dict[str, Any]:
        """Test connection to OpenAI API"""
        if not self.api_key:
            return {
                "success": False,
                "error": "OPENAI_API_KEY not configured",
                "message": "Please set OPENAI_API_KEY in environment variables",
            }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "gpt-3.5-turbo",
                        "messages": [{"role": "user", "content": "Hello"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )

                if response.status_code == 200:
                    return {
                        "success": True,
                        "message": "OpenAI API connection successful",
                        "model": "gpt-3.5-turbo",
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": response.text,
                    }

        except Exception as e:
            logger.error("OpenAI API connection test failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to connect to OpenAI API",
            }

    async def get_embeddings(
        self, texts: list[str], model: str = "text-embedding-3-small"
    ) -> dict[str, Any]:
        """Generate text embeddings using OpenAI API"""
        if not self.api_key:
            return {"success": False, "error": "OPENAI_API_KEY not configured"}

        if not texts:
            return {"success": True, "embeddings": []}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"model": model, "input": texts},
                    timeout=60.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    embeddings = [item["embedding"] for item in result["data"]]
                    return {
                        "success": True,
                        "embeddings": embeddings,
                        "usage": result.get("usage", {}),
                    }
                else:
                    error_detail = response.text
                    logger.error(
                        "OpenAI Embedding API error",
                        status=response.status_code,
                        detail=error_detail,
                    )
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail,
                    }
        except Exception as e:
            logger.error(
                "OpenAI embedding generation failed", error=str(e), exc_info=True
            )
            return {"success": False, "error": str(e)}

    async def chat_completion(
        self,
        message: str,
        model: str = "gpt-3.5-turbo",
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> Dict[str, Any]:
        """Generate chat completion using OpenAI API"""
        if not self.api_key:
            return {"success": False, "error": "OPENAI_API_KEY not configured"}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": message}],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                    timeout=60.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    return {
                        "success": True,
                        "message": result["choices"][0]["message"]["content"],
                        "model": model,
                        "usage": result.get("usage", {}),
                        "request_id": result.get("id", ""),
                    }
                else:
                    error_detail = response.text
                    logger.error(
                        "OpenAI API error",
                        status=response.status_code,
                        detail=error_detail,
                    )
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail,
                    }

        except Exception as e:
            logger.error("OpenAI chat completion failed", error=str(e))
            return {"success": False, "error": str(e)}

    async def stream_chat_completion(
        self,
        message: str,
        model: str = "gpt-4o-mini",
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream chat completion using OpenAI-compatible SSE."""
        if not self.api_key:
            yield {"success": False, "error": "OPENAI_API_KEY not configured"}
            return

        try:
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": message}],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                        "stream": True,
                    },
                    timeout=60.0,
                ) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        yield {
                            "success": False,
                            "error": f"API error {response.status_code}",
                            "details": body.decode(errors="ignore"),
                        }
                        return

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data = line[6:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                            delta = obj.get("choices", [{}])[0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                yield {"success": True, "content": delta["content"]}
                        except Exception:
                            continue
        except Exception as e:
            logger.error("OpenAI streaming failed", error=str(e))
            yield {"success": False, "error": str(e)}


class DeepSeekAPIService:
    """Service for DeepSeek API integration"""

    def __init__(self):
        """Initialize DeepSeek API service"""
        self.api_key = settings.DEEPSEEK_API_KEY
        self.base_url = settings.DEEPSEEK_BASE_URL
        self.model = settings.DEEPSEEK_CHAT_MODEL

    async def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to DeepSeek API

        Returns:
            Dict with connection test results
        """
        if not self.api_key:
            return {
                "success": False,
                "error": "DEEPSEEK_API_KEY not configured",
                "message": "Please set DEEPSEEK_API_KEY in environment variables",
            }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": "Hello"}],
                        "max_tokens": 10,
                    },
                    timeout=30.0,
                )

                if response.status_code == 200:
                    return {
                        "success": True,
                        "message": "DeepSeek API connection successful",
                        "model": self.model,
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": response.text,
                    }

        except Exception as e:
            logger.error("DeepSeek API connection test failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to connect to DeepSeek API",
            }

    async def chat_completion(
        self, message: str, temperature: float = 0.7, max_tokens: int = 1000
    ) -> Dict[str, Any]:
        """
        Generate chat completion using DeepSeek API

        Args:
            message: User input message
            temperature: Randomness in responses (0.0 to 2.0)
            max_tokens: Maximum tokens to generate

        Returns:
            Dict with response data
        """
        if not self.api_key:
            return {"success": False, "error": "DEEPSEEK_API_KEY not configured"}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": message}],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                    timeout=60.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    return {
                        "success": True,
                        "message": result["choices"][0]["message"]["content"],
                        "model": self.model,
                        "usage": result.get("usage", {}),
                        "request_id": result.get("id", ""),
                    }
                else:
                    error_detail = response.text
                    logger.error(
                        "DeepSeek API error",
                        status=response.status_code,
                        detail=error_detail,
                    )
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail,
                    }

        except Exception as e:
            logger.error("DeepSeek chat completion failed", error=str(e))
            return {"success": False, "error": str(e)}

    async def get_embeddings(
        self, texts: list[str], model: str | None = None
    ) -> dict[str, Any]:
        """
        Generate text embeddings using DeepSeek API
        """
        if not self.api_key:
            return {"success": False, "error": "DEEPSEEK_API_KEY not configured"}

        if not texts:
            return {"success": True, "embeddings": []}

        return {
            "success": False,
            "error": "DeepSeek embedding is not supported; configure an embedding provider (e.g., SiliconFlow/OpenAI/Qwen/Local).",
        }


class CohereAPIService:
    """Service for Cohere API integration"""

    def __init__(self):
        self.api_key = getattr(settings, "COHERE_API_KEY", None)
        self.base_url = "https://api.cohere.ai/v1"

    async def test_connection(self) -> Dict[str, Any]:
        if not self.api_key:
            return {
                "success": False,
                "error": "COHERE_API_KEY not configured",
                "message": "Please set COHERE_API_KEY in environment variables",
            }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
            if resp.status_code == 200:
                return {"success": True, "message": "Cohere API connection successful"}
            return {
                "success": False,
                "error": f"API error {resp.status_code}",
                "details": resp.text,
            }
        except Exception as e:
            logger.error("Cohere API connection test failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to connect to Cohere API",
            }

    async def chat_completion(
        self,
        message: str,
        model: str = "command-r",
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> Dict[str, Any]:
        if not self.api_key:
            return {"success": False, "error": "COHERE_API_KEY not configured"}

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.base_url}/chat",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "message": message,
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                )
            if resp.status_code == 200:
                obj = resp.json()
                text = obj.get("text") or ""
                return {
                    "success": True,
                    "message": text,
                    "model": model,
                    "usage": obj.get("usage", {}),
                }
            return {
                "success": False,
                "error": f"API error {resp.status_code}",
                "details": resp.text,
            }
        except Exception as e:
            logger.error("Cohere chat completion failed", error=str(e))
            return {"success": False, "error": str(e)}

    async def get_embeddings(
        self, texts: list[str], model: str = "embed-multilingual-v3.0"
    ) -> dict[str, Any]:
        if not self.api_key:
            return {"success": False, "error": "COHERE_API_KEY not configured"}

        if not texts:
            return {"success": True, "embeddings": []}

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.base_url}/embed",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "texts": texts,
                        "input_type": "search_document",
                    },
                )
            if resp.status_code == 200:
                obj = resp.json()
                embeddings = obj.get("embeddings") or []
                return {"success": True, "embeddings": embeddings}
            return {
                "success": False,
                "error": f"API error {resp.status_code}",
                "details": resp.text,
            }
        except Exception as e:
            logger.error("Cohere embedding generation failed", error=str(e))
            return {"success": False, "error": str(e)}


class LocalOpenAICompatibleService:
    """Service for local/self-hosted OpenAI-compatible endpoints (e.g., Ollama, vLLM)."""

    def __init__(self):
        self.api_key: Optional[str] = getattr(settings, "LOCAL_MODEL_API_KEY", None)
        self.base_url: str = getattr(settings, "LOCAL_MODEL_ENDPOINT", None) or "http://localhost:11434/v1"

    async def test_connection(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self.base_url.rstrip('/')}/models",
                    headers=({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
                )
            if resp.status_code == 200:
                return {"success": True, "message": "Local OpenAI-compatible endpoint reachable"}
            return {"success": False, "error": f"API error {resp.status_code}", "details": resp.text}
        except Exception as e:
            return {"success": False, "error": str(e), "message": "Failed to reach local endpoint"}

    async def chat_completion(
        self,
        message: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.base_url.rstrip('/')}/chat/completions",
                    headers={
                        **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": message}],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                )
            if resp.status_code == 200:
                obj = resp.json()
                return {
                    "success": True,
                    "message": obj["choices"][0]["message"]["content"],
                    "model": model,
                    "usage": obj.get("usage", {}),
                    "request_id": obj.get("id", ""),
                }
            return {"success": False, "error": f"API error {resp.status_code}", "details": resp.text}
        except Exception as e:
            logger.error("Local chat completion failed", error=str(e))
            return {"success": False, "error": str(e)}

    async def get_embeddings(self, texts: list[str], model: str) -> dict[str, Any]:
        if not texts:
            return {"success": True, "embeddings": []}
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.base_url.rstrip('/')}/embeddings",
                    headers={
                        **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
                        "Content-Type": "application/json",
                    },
                    json={"model": model, "input": texts},
                )
            if resp.status_code == 200:
                obj = resp.json()
                embeddings = [item["embedding"] for item in obj.get("data", [])]
                return {"success": True, "embeddings": embeddings, "usage": obj.get("usage", {})}
            return {"success": False, "error": f"API error {resp.status_code}", "details": resp.text}
        except Exception as e:
            logger.error("Local embedding generation failed", error=str(e))
            return {"success": False, "error": str(e)}

    async def stream_chat_completion(
        self,
        message: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream chat completion using OpenAI-compatible SSE from a local/self-hosted endpoint."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url.rstrip('/')}/chat/completions",
                    headers={
                        **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": message}],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                        "stream": True,
                    },
                ) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        yield {
                            "success": False,
                            "error": f"API error {response.status_code}",
                            "details": body.decode(errors="ignore"),
                        }
                        return

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            data = line[6:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                obj = json.loads(data)
                            except Exception:
                                continue
                            delta = (
                                obj.get("choices", [{}])[0]
                                .get("delta", {})
                                .get("content")
                            )
                            if delta:
                                yield {"success": True, "content": delta}
        except Exception as e:
            logger.error("Local streaming chat failed", error=str(e))
            yield {"success": False, "error": str(e)}


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
                "message": "Please set DASHSCOPE_API_KEY in environment variables",
            }

        try:
            # Simple test request to verify API connectivity
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/services/aigc/text-generation/generation",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "input": {
                            "messages": [
                                {
                                    "role": "user",
                                    "content": "Hello, this is a connection test.",
                                }
                            ]
                        },
                        "parameters": {"max_tokens": 50},
                    },
                    timeout=30.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    return {
                        "success": True,
                        "model": self.model,
                        "response": result.get("output", {}).get("text", ""),
                        "usage": result.get("usage", {}),
                        "message": "Connection successful",
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API returned status {response.status_code}",
                        "details": response.text,
                        "message": "API connection failed",
                    }

        except httpx.TimeoutException:
            return {
                "success": False,
                "error": "Request timeout",
                "message": "API request timed out after 30 seconds",
            }
        except Exception as e:
            logger.error("Qwen API test failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "message": "Unexpected error during API test",
            }

    async def chat_completion(
        self, message: str, temperature: float = 0.7, max_tokens: int = 1000
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
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "input": {"messages": [{"role": "user", "content": message}]},
                        "parameters": {
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            "top_p": 0.8,
                        },
                    },
                    timeout=60.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    return {
                        "success": True,
                        "message": result.get("output", {}).get("text", ""),
                        "model": self.model,
                        "usage": result.get("usage", {}),
                        "request_id": result.get("request_id", ""),
                    }
                else:
                    error_detail = response.text
                    logger.error(
                        "Qwen API error",
                        status=response.status_code,
                        detail=error_detail,
                    )
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail,
                    }

        except Exception as e:
            logger.error("Chat completion failed", error=str(e))
            return {"success": False, "error": str(e)}

    async def stream_chat_completion(
        self, message: str, temperature: float = 0.7, max_tokens: int = 1000
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
            yield {"success": False, "error": "DASHSCOPE_API_KEY not configured"}
            return

        try:
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/services/aigc/text-generation/generation",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream",
                    },
                    json={
                        "model": self.model,
                        "input": {"messages": [{"role": "user", "content": message}]},
                        "parameters": {
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            "top_p": 0.8,
                            "incremental_output": True,
                        },
                    },
                    timeout=60.0,
                ) as response:

                    if response.status_code != 200:
                        yield {
                            "success": False,
                            "error": f"API error {response.status_code}",
                            "details": await response.aread(),
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
                                        "finish_reason": data["output"].get(
                                            "finish_reason"
                                        ),
                                        "model": self.model,
                                    }
                            except json.JSONDecodeError:
                                continue

        except Exception as e:
            logger.error("Streaming chat failed", error=str(e))
            yield {"success": False, "error": str(e)}

    async def get_embeddings(
        self, texts: list[str], model: str | None = None
    ) -> dict[str, Any]:
        """
        Generate text embeddings using the Qwen embedding model.

        Args:
            texts: A list of text strings to embed.
            model: Optional embedding model name (defaults to settings.QWEN_EMBEDDING_MODEL).

        Returns:
            A dictionary containing the embedding results or an error.
        """
        if not self.api_key:
            return {"success": False, "error": "DASHSCOPE_API_KEY not configured"}

        if not texts:
            return {"success": True, "embeddings": []}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/services/embeddings/text-embedding/text-embedding",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model or settings.QWEN_EMBEDDING_MODEL,
                        "input": {"texts": texts},
                    },
                    timeout=60.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    # The API returns embeddings in a specific structure
                    embeddings_data = result.get("output", {}).get("embeddings", [])
                    embeddings = [item["embedding"] for item in embeddings_data]
                    return {
                        "success": True,
                        "embeddings": embeddings,
                        "usage": result.get("usage", {}),
                    }
                else:
                    error_detail = response.text
                    logger.error(
                        "Qwen Embedding API error",
                        status=response.status_code,
                        detail=error_detail,
                    )
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail,
                    }
        except Exception as e:
            logger.error("Embedding generation failed", error=str(e), exc_info=True)
            return {"success": False, "error": str(e)}

    async def rerank(
        self, query: str, documents: list[str], top_n: int = 5, model: str | None = None
    ) -> dict[str, Any]:
        """
        Reranks a list of documents based on a query using the Qwen rerank model.

        Args:
            query: The user's query.
            documents: A list of document texts to be reranked.
            top_n: The number of top documents to return.

        Returns:
            A dictionary containing the reranked documents or an error.
        """
        if not self.api_key:
            return {"success": False, "error": "DASHSCOPE_API_KEY not configured"}

        if not documents:
            return {"success": True, "documents": []}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/services/retrieval/rerank",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model or settings.QWEN_RERANK_MODEL,
                        "query": query,
                        "documents": documents,
                        "top_n": top_n,
                    },
                    timeout=30.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    # The API returns documents with scores
                    reranked_docs = result.get("output", {}).get("documents", [])
                    return {
                        "success": True,
                        "documents": reranked_docs,
                        "usage": result.get("usage", {}),
                    }
                else:
                    error_detail = response.text
                    logger.error(
                        "Qwen Rerank API error",
                        status=response.status_code,
                        detail=error_detail,
                    )
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail,
                    }
        except Exception as e:
            logger.error("Reranking failed", error=str(e), exc_info=True)
            return {"success": False, "error": str(e)}


class SiliconFlowAPIService:
    """Service for SiliconFlow API integration (OpenAI-compatible)"""

    def __init__(self):
        """Initialize SiliconFlow API service"""
        self.api_key = settings.SILICONFLOW_API_KEY
        self.base_url = settings.SILICONFLOW_BASE_URL or "https://api.siliconflow.cn/v1"

    async def get_embeddings(
        self, texts: list[str], model: str = "BAAI/bge-large-zh-v1.5"
    ) -> dict[str, Any]:
        """Generate text embeddings using SiliconFlow API"""
        if not self.api_key:
            return {"success": False, "error": "SILICONFLOW_API_KEY not configured"}

        if not texts:
            return {"success": True, "embeddings": []}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"model": model, "input": texts},
                    timeout=60.0,
                )

                if response.status_code == 200:
                    result = response.json()
                    embeddings = [item["embedding"] for item in result["data"]]
                    return {
                        "success": True,
                        "embeddings": embeddings,
                        "usage": result.get("usage", {}),
                    }
                else:
                    error_detail = response.text
                    logger.error(
                        "SiliconFlow Embedding API error",
                        status=response.status_code,
                        detail=error_detail,
                    )
                    return {
                        "success": False,
                        "error": f"API error {response.status_code}",
                        "details": error_detail,
                    }
        except Exception as e:
            logger.error(
                "SiliconFlow embedding generation failed", error=str(e), exc_info=True
            )
            return {"success": False, "error": str(e)}

    async def test_connection(self) -> Dict[str, Any]:
        """Test connection to SiliconFlow API"""
        if not self.api_key:
            return {
                "success": False,
                "error": "SILICONFLOW_API_KEY not configured",
                "message": "Please set SILICONFLOW_API_KEY in environment variables",
            }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"model": "BAAI/bge-large-zh-v1.5", "input": ["ping"]},
                    timeout=30.0,
                )
                if response.status_code == 200:
                    return {
                        "success": True,
                        "message": "SiliconFlow API connection successful",
                    }
                return {
                    "success": False,
                    "error": f"API error {response.status_code}",
                    "details": response.text,
                }
        except Exception as e:
            logger.error("SiliconFlow API connection test failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to connect to SiliconFlow API",
            }

    async def chat_completion(
        self,
        message: str,
        model: str = "deepseek-ai/DeepSeek-V2.5",
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> Dict[str, Any]:
        """Generate chat completion using SiliconFlow (OpenAI-compatible)."""
        if not self.api_key:
            return {"success": False, "error": "SILICONFLOW_API_KEY not configured"}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": message}],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                    timeout=60.0,
                )
                if response.status_code == 200:
                    result = response.json()
                    return {
                        "success": True,
                        "message": result["choices"][0]["message"]["content"],
                        "model": model,
                        "usage": result.get("usage", {}),
                        "request_id": result.get("id", ""),
                    }
                return {
                    "success": False,
                    "error": f"API error {response.status_code}",
                    "details": response.text,
                }
        except Exception as e:
            logger.error("SiliconFlow chat completion failed", error=str(e))
            return {"success": False, "error": str(e)}

    async def stream_chat_completion(
        self,
        message: str,
        model: str = "deepseek-ai/DeepSeek-V2.5",
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream chat via SiliconFlow (OpenAI-compatible)."""
        if not self.api_key:
            yield {"success": False, "error": "SILICONFLOW_API_KEY not configured"}
            return

        try:
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": message}],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                        "stream": True,
                    },
                    timeout=60.0,
                ) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        yield {
                            "success": False,
                            "error": f"API error {response.status_code}",
                            "details": body.decode(errors="ignore"),
                        }
                        return

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data = line[6:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                            delta = obj.get("choices", [{}])[0].get("delta", {})
                            if "content" in delta and delta["content"]:
                                yield {"success": True, "content": delta["content"]}
                        except Exception:
                            continue
        except Exception as e:
            logger.error("SiliconFlow streaming failed", error=str(e))
            yield {"success": False, "error": str(e)}


class LLMService:
    """
    Main LLM service that orchestrates different AI models
    """

    def __init__(self):
        """Initialize LLM service with available providers"""
        self.qwen = QwenAPIService()
        self.deepseek = DeepSeekAPIService()
        self.openai = OpenAIAPIService()
        self.siliconflow = SiliconFlowAPIService()
        self.cohere = CohereAPIService()
        self.local = LocalOpenAICompatibleService()

    def _estimate_tokens_rough(self, text: str) -> int:
        """Heuristic token estimator (no tokenizer deps).

        We slightly over-estimate to avoid providers rejecting requests due to hard token limits.
        """
        if not text:
            return 0
        cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
        ascii_chars = len(re.findall(r"[\x00-\x7F]", text))
        # Conservative: ~2 ASCII chars per token (avoid under-estimation for dense PDFs).
        ascii_tokens = ascii_chars // 2 if ascii_chars else 0
        words = len(re.findall(r"[A-Za-z0-9_]+", text))
        base = int(cjk + max(ascii_tokens, words))
        # Extra safety: some providers tokenize closer to "non-whitespace characters".
        try:
            non_space = len(re.sub(r"\s+", "", text))
            base = max(base, non_space)
        except Exception:
            pass
        return int(base)

    def _split_text_to_token_limit(self, text: str, max_tokens: int) -> list[str]:
        text = (text or "").strip()
        if not text:
            return []
        if max_tokens <= 0:
            return [text]
        if self._estimate_tokens_rough(text) <= max_tokens:
            return [text]

        # Sentence-like split first.
        units = re.split(r"(?<=[。！？!?；;\n])", text)
        units = [u for u in (u.strip() for u in units) if u]
        if len(units) <= 1:
            units = [text]

        out: list[str] = []
        buf = ""
        buf_tokens = 0

        def _flush():
            nonlocal buf, buf_tokens
            if buf.strip():
                out.append(buf.strip())
            buf = ""
            buf_tokens = 0

        for u in units:
            u_tokens = self._estimate_tokens_rough(u)
            if u_tokens <= max_tokens:
                if buf and buf_tokens + u_tokens <= max_tokens:
                    buf = f"{buf} {u}".strip()
                    buf_tokens = self._estimate_tokens_rough(buf)
                else:
                    _flush()
                    buf = u
                    buf_tokens = u_tokens
                continue

            # Oversized unit: hard split by shrinking window.
            _flush()
            start = 0
            while start < len(u):
                remaining = u[start:]
                remaining_tokens = max(self._estimate_tokens_rough(remaining), 1)
                guess_len = max(64, int(len(remaining) * (max_tokens / remaining_tokens)))
                end = min(len(u), start + guess_len)
                part = u[start:end]
                while end - start > 32 and self._estimate_tokens_rough(part) > max_tokens:
                    end = start + max(32, (end - start) // 2)
                    part = u[start:end]
                if part.strip():
                    out.append(part.strip())
                start = end

        _flush()
        return [x for x in out if x.strip()]

    def _enforce_embedding_token_limit(self, texts: list[str], max_tokens: int) -> list[str]:
        if not texts:
            return []
        if max_tokens <= 0:
            return texts
        out: list[str] = []
        for t in texts:
            out.extend(self._split_text_to_token_limit(t, max_tokens=max_tokens))
        return out

    def _resolve_provider_for_model(
        self,
        model: str,
        tenant_id: int | None,
        model_type: str,
        *,
        user_id: int | None = None,
        allow_tenant_fallback: bool = False,
    ) -> str:
        """
        Resolve provider by looking up the tenant's provider model lists first, then fallback to heuristics.
        model_type: "chat" | "embedding" | "reranking"
        Returns provider string (e.g., "openai").
        """
        try:
            from app.services.model_config_service import model_config_service, ModelType
            from app.services.user_model_config_service import user_model_config_service

            mt = ModelType(model_type)

            if user_id is not None:
                user_providers = user_model_config_service.get_providers(user_id=user_id)
                for p_type, p_cfg in user_providers.items():
                    names = (p_cfg.models or {}).get(mt, []) or []
                    if model in names:
                        return p_type.value

                if allow_tenant_fallback and tenant_id is not None:
                    tenant_providers = model_config_service.get_providers(tenant_id=tenant_id)
                    for p_type, p_cfg in tenant_providers.items():
                        names = (p_cfg.models or {}).get(mt, []) or []
                        if model in names:
                            return p_type.value
            else:
                providers = model_config_service.get_providers(tenant_id=tenant_id)
                for p_type, p_cfg in providers.items():
                    names = (p_cfg.models or {}).get(mt, []) or []
                    if model in names:
                        return p_type.value
        except Exception:
            pass

        # Fallback heuristics
        if model.startswith("deepseek"):
            return "deepseek"
        if model.startswith("qwen") or model.startswith("gte-"):
            return "qwen"
        if model.startswith("gpt"):
            return "openai"
        if model.startswith("command"):
            return "cohere"
        if model_type == "embedding":
            return settings.EMBEDDING_MODEL_PROVIDER
        if model_type == "reranking":
            return settings.RERANK_MODEL_PROVIDER
        return settings.CHAT_MODEL_PROVIDER

    def _get_active_model_config(
        self,
        model_type: "ModelType",
        *,
        tenant_id: int | None,
        user_id: int | None,
        allow_tenant_fallback: bool,
    ):
        from app.services.model_config_service import model_config_service
        from app.services.user_model_config_service import user_model_config_service

        if user_id is not None:
            return user_model_config_service.get_active_model(
                model_type,
                user_id=user_id,
                tenant_id=tenant_id,
                allow_tenant_fallback=allow_tenant_fallback,
            )
        return model_config_service.get_active_model(model_type, tenant_id=tenant_id)

    def _get_provider_config(
        self,
        provider: "ProviderType",
        *,
        tenant_id: int | None,
        user_id: int | None,
        allow_tenant_fallback: bool,
    ):
        from app.services.model_config_service import model_config_service
        from app.services.user_model_config_service import user_model_config_service

        if user_id is not None:
            cfg = user_model_config_service.get_provider(provider, user_id=user_id)
            if cfg is not None:
                return cfg
            if allow_tenant_fallback and tenant_id is not None:
                return model_config_service.get_provider(provider, tenant_id=tenant_id)
            return None
        return model_config_service.get_provider(provider, tenant_id=tenant_id)

    def _resolve_allow_tenant_fallback(
        self,
        user_id: int | None,
        tenant_id: int | None,
        allow_tenant_fallback: bool | None,
    ) -> bool:
        """Determine whether tenant-shared model configs can be used for this user.

        Rules:
        - system/unauthenticated (user_id=None) can use tenant configs
        - admins can always use tenant configs
        - normal users need tenant setting `allow_shared_models=true` AND (role permission OR allowlist)
        """
        if user_id is None:
            return True
        if allow_tenant_fallback is False:
            return False
        if tenant_id is None:
            return False

        try:
            from app.db.database import SessionLocal
            from app.db.models.user import User
            from app.db.models.tenant import Tenant
            from app.db.models.permission import Permission, RolePermission, PermissionType

            db = SessionLocal()
            try:
                u = db.query(User).filter(User.id == user_id).first()
                if not u:
                    return False
                if u.role in ("super_admin", "tenant_admin"):
                    return True

                t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
                settings = (t.settings if t and isinstance(t.settings, dict) else {}) or {}
                if not bool(settings.get("allow_shared_models", False)):
                    return False

                # Explicit allowlist (tenant setting) can grant access to specific users
                allowlist = settings.get("shared_model_user_ids") or []
                try:
                    allowlist_set = {int(x) for x in allowlist if str(x).isdigit()}
                except Exception:
                    allowlist_set = set()
                if user_id in allowlist_set:
                    return True

                # Role-based permission
                perm = (
                    db.query(Permission)
                    .join(RolePermission, Permission.id == RolePermission.permission_id)
                    .filter(
                        RolePermission.role == u.role,
                        Permission.name == PermissionType.MODEL_USE_SHARED.value,
                        Permission.is_active == True,
                    )
                    .first()
                )
                return bool(perm)
            finally:
                db.close()
        except Exception:
            return False

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

        # Test DeepSeek API
        logger.info("Testing DeepSeek API connection...")
        deepseek_result = await self.deepseek.test_connection()
        results["deepseek"] = deepseek_result

        # Test OpenAI API
        logger.info("Testing OpenAI API connection...")
        openai_result = await self.openai.test_connection()
        results["openai"] = openai_result

        # Test SiliconFlow API
        logger.info("Testing SiliconFlow API connection...")
        siliconflow_result = await self.siliconflow.test_connection()
        results["siliconflow"] = siliconflow_result

        # Test Cohere API
        logger.info("Testing Cohere API connection...")
        cohere_result = await self.cohere.test_connection()
        results["cohere"] = cohere_result

        # Test Local endpoint
        logger.info("Testing Local OpenAI-compatible endpoint...")
        local_result = await self.local.test_connection()
        results["local"] = local_result

        # Current configuration
        results["current_config"] = {
            "chat_provider": settings.CHAT_MODEL_PROVIDER,
            "chat_model": settings.CHAT_MODEL_NAME,
            "embedding_provider": settings.EMBEDDING_MODEL_PROVIDER,
            "embedding_model": settings.EMBEDDING_MODEL_NAME,
            "rerank_provider": settings.RERANK_MODEL_PROVIDER,
            "rerank_model": settings.RERANK_MODEL_NAME,
        }

        # Summary
        all_success = all(
            r.get("success", False)
            for r in results.values()
            if isinstance(r, dict) and "success" in r
        )
        results["summary"] = {
            "all_connected": all_success,
            "total_providers": len(
                [r for r in results.values() if isinstance(r, dict) and "success" in r]
            ),
            "connected_providers": sum(
                1
                for r in results.values()
                if isinstance(r, dict) and r.get("success", False)
            ),
        }

        return results

    async def chat(
        self,
        message: str,
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
        tenant_id: int = None,
        user_id: int | None = None,
        allow_tenant_fallback: bool | None = None,
    ) -> Dict[str, Any]:
        """
        Generate chat response using configured provider

        Args:
            message: User input message
            model: Model to use (if None, uses configured default)
            temperature: Response randomness
            max_tokens: Maximum response length

        Returns:
            Dict with chat response
        """
        allow_fallback = self._resolve_allow_tenant_fallback(user_id, tenant_id, allow_tenant_fallback)

        # Use configured provider and model if not specified
        if model is None:
            # 优先使用模型配置服务（个人配置优先；可选回退租户共享配置）
            try:
                from app.services.model_config_service import (
                    ModelType,
                    ProviderType,
                )

                chat_config = self._get_active_model_config(
                    ModelType.CHAT,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                if chat_config:
                    provider = chat_config.provider.value
                    model = chat_config.model_name

                    p_cfg = self._get_provider_config(
                        ProviderType(provider),
                        tenant_id=tenant_id,
                        user_id=user_id,
                        allow_tenant_fallback=allow_fallback,
                    )
                    api_key = chat_config.api_key or (p_cfg.api_key if p_cfg else None)
                    api_base = chat_config.api_base or (p_cfg.api_base if p_cfg else None)

                    # 将保存的密钥与base url注入到对应服务
                    if provider == "deepseek":
                        if api_key:
                            self.deepseek.api_key = api_key
                        if api_base:
                            self.deepseek.base_url = api_base
                        # DeepSeek服务内部使用 self.model
                        self.deepseek.model = model
                    elif provider == "qwen":
                        if api_key:
                            self.qwen.api_key = api_key
                        if api_base:
                            self.qwen.base_url = api_base
                        self.qwen.model = model
                    elif provider == "openai":
                        if api_key:
                            self.openai.api_key = api_key
                        if api_base:
                            self.openai.base_url = api_base
                    elif provider == "siliconflow":
                        if api_key:
                            self.siliconflow.api_key = api_key
                        if api_base:
                            self.siliconflow.base_url = api_base
                    elif provider == "cohere":
                        if api_key:
                            self.cohere.api_key = api_key
                        if api_base:
                            self.cohere.base_url = api_base
                    elif provider == "local":
                        if api_key:
                            self.local.api_key = api_key
                        if api_base:
                            self.local.base_url = api_base

                    # 使用用户保存的默认推理参数（如有）
                    if chat_config.temperature is not None:
                        temperature = chat_config.temperature
                    if chat_config.max_tokens is not None:
                        max_tokens = chat_config.max_tokens

                    logger.info(f"Using model config service chat model: {provider}/{model}")
                else:
                    if user_id is not None and not allow_fallback:
                        return {
                            "success": False,
                            "error": "No chat model configured for current user",
                            "message": "Please configure your personal chat model in Model Settings.",
                        }
                    # 回退到环境变量配置（匿名/内部调用）
                    provider = settings.CHAT_MODEL_PROVIDER
                    model = settings.CHAT_MODEL_NAME
                    logger.info(f"No config service data, using settings chat model: {provider}/{model}")
            except Exception as e:
                logger.warning(f"Failed to get model config, using settings: {e}")
                if user_id is not None and not allow_fallback:
                    return {
                        "success": False,
                        "error": "No chat model configured for current user",
                        "message": "Please configure your personal chat model in Model Settings.",
                    }
                provider = settings.CHAT_MODEL_PROVIDER
                model = settings.CHAT_MODEL_NAME
                logger.info(f"Exception fallback chat model: {provider}/{model}")
        else:
            # 当指定了具体模型时，根据模型名称确定提供商，但需要加载API密钥配置
            logger.info(f"Using specified model: {model}")
            provider = self._resolve_provider_for_model(
                model,
                tenant_id=tenant_id,
                model_type="chat",
                user_id=user_id,
                allow_tenant_fallback=allow_fallback,
            )
            
            # 为指定的模型加载该 provider 的配置（优先租户 provider-level 配置）
            try:
                from app.services.model_config_service import (
                    ProviderType,
                )
                p_cfg = self._get_provider_config(
                    ProviderType(provider),
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                requires_key = bool(getattr(p_cfg, "requires_api_key", True)) if p_cfg else True
                if requires_key and not (p_cfg and p_cfg.api_key):
                    return {
                        "success": False,
                        "error": f"Provider '{provider}' is not configured",
                        "message": "Please configure your personal provider API key/base URL in Model Settings.",
                    }

                if provider == "deepseek":
                    if p_cfg and p_cfg.api_key:
                        self.deepseek.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.deepseek.base_url = p_cfg.api_base
                    self.deepseek.model = model
                elif provider == "qwen":
                    if p_cfg and p_cfg.api_key:
                        self.qwen.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.qwen.base_url = p_cfg.api_base
                    self.qwen.model = model
                elif provider == "openai":
                    if p_cfg and p_cfg.api_key:
                        self.openai.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.openai.base_url = p_cfg.api_base
                elif provider == "siliconflow":
                    if p_cfg and p_cfg.api_key:
                        self.siliconflow.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.siliconflow.base_url = p_cfg.api_base
                elif provider == "cohere":
                    if p_cfg and p_cfg.api_key:
                        self.cohere.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.cohere.base_url = p_cfg.api_base
                elif provider == "local":
                    if p_cfg and p_cfg.api_key:
                        self.local.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.local.base_url = p_cfg.api_base

                logger.info(
                    f"Loaded provider config for '{provider}' with specified model '{model}'"
                )
            except Exception as e:
                logger.warning(f"Failed to load API keys for specified model: {e}")

        logger.info(f"Using chat provider: {provider}, model: {model}")

        try:
            if provider == "deepseek":
                return await self.deepseek.chat_completion(
                    message, temperature, max_tokens
                )
            elif provider == "qwen":
                return await self.qwen.chat_completion(message, temperature, max_tokens)
            elif provider == "openai":
                return await self.openai.chat_completion(
                    message, model, temperature, max_tokens
                )
            elif provider == "siliconflow":
                return await self.siliconflow.chat_completion(
                    message, model, temperature, max_tokens
                )
            elif provider == "cohere":
                return await self.cohere.chat_completion(
                    message, model, temperature, max_tokens
                )
            elif provider == "local":
                return await self.local.chat_completion(
                    message, model, temperature, max_tokens
                )
            else:
                return {
                    "success": False,
                    "error": f"Provider {provider} not supported",
                    "message": "Supported providers: deepseek, qwen, openai, siliconflow, cohere, local",
                }
        except Exception as e:
            logger.error(
                f"Chat completion failed with provider {provider}", error=str(e)
            )
            return {"success": False, "error": str(e)}

    async def stream_chat(
        self,
        message: str,
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
        tenant_id: int = None,
        user_id: int | None = None,
        allow_tenant_fallback: bool | None = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Generate streaming chat response using configured provider
        
        Args:
            message: User input message
            model: Model to use (if None, uses configured default)
            temperature: Response randomness
            max_tokens: Maximum response length
            
        Yields:
            Dict with streaming response chunks
        """
        allow_fallback = self._resolve_allow_tenant_fallback(user_id, tenant_id, allow_tenant_fallback)

        # Use configured provider and model if not specified
        if model is None:
            # 优先使用配置文件中的密钥与基础URL
            try:
                from app.services.model_config_service import (
                    ModelType,
                    ProviderType,
                )

                chat_config = self._get_active_model_config(
                    ModelType.CHAT,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                if chat_config:
                    provider = chat_config.provider.value
                    model = chat_config.model_name

                    p_cfg = self._get_provider_config(
                        ProviderType(provider),
                        tenant_id=tenant_id,
                        user_id=user_id,
                        allow_tenant_fallback=allow_fallback,
                    )
                    api_key = chat_config.api_key or (p_cfg.api_key if p_cfg else None)
                    api_base = chat_config.api_base or (p_cfg.api_base if p_cfg else None)

                    if provider == "deepseek":
                        if api_key:
                            self.deepseek.api_key = api_key
                        if api_base:
                            self.deepseek.base_url = api_base
                        self.deepseek.model = model
                    elif provider == "qwen":
                        if api_key:
                            self.qwen.api_key = api_key
                        if api_base:
                            self.qwen.base_url = api_base
                        self.qwen.model = model
                    elif provider == "openai":
                        if api_key:
                            self.openai.api_key = api_key
                        if api_base:
                            self.openai.base_url = api_base
                    elif provider == "siliconflow":
                        if api_key:
                            self.siliconflow.api_key = api_key
                        if api_base:
                            self.siliconflow.base_url = api_base
                    elif provider == "cohere":
                        if api_key:
                            self.cohere.api_key = api_key
                        if api_base:
                            self.cohere.base_url = api_base
                    elif provider == "local":
                        if api_key:
                            self.local.api_key = api_key
                        if api_base:
                            self.local.base_url = api_base

                    # 使用用户保存的默认推理参数（如有）
                    if chat_config.temperature is not None:
                        temperature = chat_config.temperature
                    if chat_config.max_tokens is not None:
                        max_tokens = chat_config.max_tokens

                    logger.info(f"Using model config service chat model for streaming: {provider}/{model}")
                else:
                    if user_id is not None and not allow_fallback:
                        yield {
                            "success": False,
                            "error": "No chat model configured for current user",
                        }
                        return
                    provider = settings.CHAT_MODEL_PROVIDER
                    model = settings.CHAT_MODEL_NAME
                    logger.info(f"No config service data, using settings chat model for streaming: {provider}/{model}")
            except Exception as e:
                logger.warning(f"Failed to get model config, using settings: {e}")
                if user_id is not None and not allow_fallback:
                    yield {
                        "success": False,
                        "error": "No chat model configured for current user",
                        "message": "Please configure your personal chat model in Model Settings.",
                    }
                    return
                provider = settings.CHAT_MODEL_PROVIDER
                model = settings.CHAT_MODEL_NAME
                logger.info(f"Exception fallback chat model for streaming: {provider}/{model}")
        else:
            provider = self._resolve_provider_for_model(
                model,
                tenant_id=tenant_id,
                model_type="chat",
                user_id=user_id,
                allow_tenant_fallback=allow_fallback,
            )

            # 为指定模型注入 provider-level 配置
            try:
                from app.services.model_config_service import ProviderType
                p_cfg = self._get_provider_config(
                    ProviderType(provider),
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                requires_key = bool(getattr(p_cfg, "requires_api_key", True)) if p_cfg else True
                if requires_key and not (p_cfg and p_cfg.api_key):
                    yield {"success": False, "error": f"Provider '{provider}' is not configured"}
                    return

                if provider == "deepseek":
                    if p_cfg and p_cfg.api_key:
                        self.deepseek.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.deepseek.base_url = p_cfg.api_base
                    self.deepseek.model = model
                elif provider == "qwen":
                    if p_cfg and p_cfg.api_key:
                        self.qwen.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.qwen.base_url = p_cfg.api_base
                    self.qwen.model = model
                elif provider == "openai":
                    if p_cfg and p_cfg.api_key:
                        self.openai.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.openai.base_url = p_cfg.api_base
                elif provider == "siliconflow":
                    if p_cfg and p_cfg.api_key:
                        self.siliconflow.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.siliconflow.base_url = p_cfg.api_base
                elif provider == "cohere":
                    if p_cfg and p_cfg.api_key:
                        self.cohere.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.cohere.base_url = p_cfg.api_base
                elif provider == "local":
                    if p_cfg and p_cfg.api_key:
                        self.local.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.local.base_url = p_cfg.api_base
            except Exception:
                pass

        logger.info(f"Using streaming chat provider: {provider}, model: {model}")

        try:
            if provider == "qwen":
                async for chunk in self.qwen.stream_chat_completion(message, temperature, max_tokens):
                    yield chunk
            elif provider == "deepseek":
                # For deepseek, fallback to regular chat but simulate streaming
                logger.info(f"Using deepseek provider with simulated streaming")
                result = await self.chat(
                    message,
                    model,
                    temperature,
                    max_tokens,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                if result.get("success"):
                    # Split content into chunks for better streaming effect  
                    content = result.get("message", "") or result.get("content", "")
                    chunk_size = 20  # characters per chunk
                    for i in range(0, len(content), chunk_size):
                        chunk_content = content[i:i+chunk_size]
                        yield {"success": True, "content": chunk_content}
                        # Small delay to simulate streaming
                        await asyncio.sleep(0.1)
                else:
                    yield {"success": False, "error": result.get("error", "Unknown error")}
            elif provider == "openai":
                async for chunk in self.openai.stream_chat_completion(
                    message, model, temperature, max_tokens
                ):
                    yield chunk
            elif provider == "siliconflow":
                # SiliconFlow is OpenAI-compatible
                # Reuse OpenAI streaming with SiliconFlow base URL/API key
                async for chunk in self.siliconflow.stream_chat_completion(
                    message, model, temperature, max_tokens
                ):
                    yield chunk
            elif provider == "local":
                async for chunk in self.local.stream_chat_completion(
                    message, model, temperature, max_tokens
                ):
                    yield chunk
            else:
                # For other non-streaming providers, fallback to regular chat
                logger.warning(f"Streaming not supported for provider {provider}, falling back to regular chat")
                result = await self.chat(
                    message,
                    model,
                    temperature,
                    max_tokens,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                if result.get("success"):
                    yield {"success": True, "content": result.get("content", "")}
                else:
                    yield {"success": False, "error": result.get("error", "Unknown error")}
        except Exception as e:
            logger.error(f"Streaming chat failed with provider {provider}", error=str(e))
            yield {"success": False, "error": str(e)}

    async def get_embeddings(
        self,
        texts: list[str],
        model: str = None,
        tenant_id: int = None,
        user_id: int | None = None,
        allow_tenant_fallback: bool | None = None,
    ) -> dict[str, Any]:
        """
        Get text embeddings using configured provider.
        """
        allow_fallback = self._resolve_allow_tenant_fallback(user_id, tenant_id, allow_tenant_fallback)

        # Use configured provider and model if not specified
        embedding_custom_params: dict[str, Any] | None = None
        if model is None:
            # 优先使用模型配置文件中的设置
            try:
                from app.services.model_config_service import (
                    ModelType,
                    ProviderType,
                )
                
                embedding_config = self._get_active_model_config(
                    ModelType.EMBEDDING,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                if embedding_config:
                    provider = embedding_config.provider.value
                    model = embedding_config.model_name
                    embedding_custom_params = (
                        embedding_config.custom_params
                        if isinstance(embedding_config.custom_params, dict)
                        else None
                    )

                    p_cfg = self._get_provider_config(
                        ProviderType(provider),
                        tenant_id=tenant_id,
                        user_id=user_id,
                        allow_tenant_fallback=allow_fallback,
                    )
                    
                    # 如果配置中有API密钥和基础URL，临时更新服务实例
                    api_key = embedding_config.api_key or (p_cfg.api_key if p_cfg else None)
                    api_base = embedding_config.api_base or (p_cfg.api_base if p_cfg else None)

                    if provider == "siliconflow":
                        if api_key:
                            self.siliconflow.api_key = api_key
                        if api_base:
                            self.siliconflow.base_url = api_base
                    elif provider == "openai":
                        if api_key:
                            self.openai.api_key = api_key
                        if api_base:
                            self.openai.base_url = api_base
                    elif provider == "qwen":
                        if api_key:
                            self.qwen.api_key = api_key
                        if api_base:
                            self.qwen.base_url = api_base
                    elif provider == "deepseek":
                        if api_key:
                            self.deepseek.api_key = api_key
                        if api_base:
                            self.deepseek.base_url = api_base
                    elif provider == "cohere":
                        if api_key:
                            self.cohere.api_key = api_key
                        if api_base:
                            self.cohere.base_url = api_base
                    elif provider == "local":
                        if api_key:
                            self.local.api_key = api_key
                        if api_base:
                            self.local.base_url = api_base
                    
                    logger.info(f"Using configured embedding model: {provider}/{model}")
                else:
                    if user_id is not None and not allow_fallback:
                        return {
                            "success": False,
                            "error": "No embedding model configured for current user",
                            "message": "Please configure your personal embedding model in Model Settings.",
                        }
                    # 回退到环境变量（匿名/内部调用）
                    provider = settings.EMBEDDING_MODEL_PROVIDER
                    model = settings.EMBEDDING_MODEL_NAME
                    logger.info(f"Using default embedding model: {provider}/{model}")
            except Exception as e:
                logger.warning(f"Failed to get embedding model config, using default: {e}")
                if user_id is not None and not allow_fallback:
                    return {
                        "success": False,
                        "error": "No embedding model configured for current user",
                        "message": "Please configure your personal embedding model in Model Settings.",
                    }
                provider = settings.EMBEDDING_MODEL_PROVIDER
                model = settings.EMBEDDING_MODEL_NAME
        else:
            provider = self._resolve_provider_for_model(
                model,
                tenant_id=tenant_id,
                model_type="embedding",
                user_id=user_id,
                allow_tenant_fallback=allow_fallback,
            )

            # 对指定 model，也加载 provider-level 配置（便于 key/base 复用）
            try:
                from app.services.model_config_service import ProviderType
                p_cfg = self._get_provider_config(
                    ProviderType(provider),
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                requires_key = bool(getattr(p_cfg, "requires_api_key", True)) if p_cfg else True
                if requires_key and not (p_cfg and p_cfg.api_key):
                    return {
                        "success": False,
                        "error": f"Provider '{provider}' is not configured",
                        "message": "Please configure your personal provider API key/base URL in Model Settings.",
                    }

                if provider == "siliconflow":
                    if p_cfg and p_cfg.api_key:
                        self.siliconflow.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.siliconflow.base_url = p_cfg.api_base
                elif provider == "openai":
                    if p_cfg and p_cfg.api_key:
                        self.openai.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.openai.base_url = p_cfg.api_base
                elif provider == "qwen":
                    if p_cfg and p_cfg.api_key:
                        self.qwen.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.qwen.base_url = p_cfg.api_base
                elif provider == "deepseek":
                    if p_cfg and p_cfg.api_key:
                        self.deepseek.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.deepseek.base_url = p_cfg.api_base
                elif provider == "cohere":
                    if p_cfg and p_cfg.api_key:
                        self.cohere.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.cohere.base_url = p_cfg.api_base
                elif provider == "local":
                    if p_cfg and p_cfg.api_key:
                        self.local.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.local.base_url = p_cfg.api_base
            except Exception:
                pass

        # Enforce per-input max token limit for some providers (e.g. SiliconFlow bge: 512 tokens).
        texts_to_embed = list(texts or [])
        max_input_tokens: int | None = None
        if provider == "siliconflow":
            max_input_tokens = 512
        if embedding_custom_params:
            v = embedding_custom_params.get("max_input_tokens") or embedding_custom_params.get(
                "max_input_tokens_per_item"
            )
            if v is not None:
                try:
                    max_input_tokens = int(v)
                except Exception:
                    pass
        if max_input_tokens:
            texts_to_embed = self._enforce_embedding_token_limit(texts_to_embed, max_input_tokens)

        logger.info(
            f"Using embedding provider: {provider}, model: {model}",
            inputs=len(texts_to_embed),
        )

        try:
            async def _call_provider(batch: list[str]) -> dict[str, Any]:
                if provider == "openai":
                    return await self.openai.get_embeddings(batch, model)
                if provider == "qwen":
                    return await self.qwen.get_embeddings(batch, model=model)
                if provider == "deepseek":
                    return await self.deepseek.get_embeddings(batch)
                if provider == "siliconflow":
                    return await self.siliconflow.get_embeddings(batch, model)
                if provider == "cohere":
                    return await self.cohere.get_embeddings(batch, model)
                if provider == "local":
                    return await self.local.get_embeddings(batch, model)
                logger.warning(
                    f"Unsupported embedding provider: {provider}. Falling back to OpenAI."
                )
                return await self.openai.get_embeddings(batch, model)

            # Provider-side batch limits exist (e.g., SiliconFlow max batch size=32).
            # Keep batches modest to avoid hard failures while preserving ordering.
            batch_size = 32 if provider == "siliconflow" else 128
            if len(texts_to_embed) <= batch_size:
                resp = await _call_provider(texts_to_embed)
                if resp.get("success"):
                    resp["provider"] = provider
                    resp["model"] = model
                    resp["input_texts"] = texts_to_embed
                    return resp

                # Retry once if provider reports a token limit error
                details = resp.get("details")
                m = re.search(r"less than\\s+(\\d+)\\s+tokens", str(details), re.IGNORECASE)
                if m:
                    limit = int(m.group(1))
                    # Apply a small safety margin to reduce the chance of still hitting the hard limit.
                    retry_limit = max(64, limit - 16)
                    retry_texts = self._enforce_embedding_token_limit(list(texts or []), retry_limit)
                    retry = await _call_provider(retry_texts)
                    if retry.get("success"):
                        retry["provider"] = provider
                        retry["model"] = model
                        retry["input_texts"] = retry_texts
                        return retry

                    # Last resort for SiliconFlow: split more aggressively and retry once.
                    if provider == "siliconflow":
                        retry2_limit = max(64, (retry_limit * 3) // 4)
                        retry2_texts = self._enforce_embedding_token_limit(list(texts or []), retry2_limit)
                        retry2 = await _call_provider(retry2_texts)
                        if retry2.get("success"):
                            retry2["provider"] = provider
                            retry2["model"] = model
                            retry2["input_texts"] = retry2_texts
                        return retry2
                    return retry

                return {
                    "success": False,
                    "error": resp.get("error") or "Embedding generation failed",
                    "details": details,
                    "provider": provider,
                    "model": model,
                    "input_texts": texts_to_embed,
                }

            all_embeddings: list[Any] = []
            usage_total: dict[str, Any] = {}

            def _merge_usage(total: dict[str, Any], part: dict[str, Any]) -> dict[str, Any]:
                merged = dict(total or {})
                for k, v in (part or {}).items():
                    if isinstance(v, (int, float)) and isinstance(merged.get(k), (int, float)):
                        merged[k] = merged[k] + v
                    elif isinstance(v, (int, float)) and k not in merged:
                        merged[k] = v
                return merged

            for start in range(0, len(texts_to_embed), batch_size):
                batch = texts_to_embed[start : start + batch_size]
                resp = await _call_provider(batch)
                if not resp.get("success"):
                    # Retry once if provider reports a token limit error
                    details = resp.get("details")
                    m = re.search(r"less than\\s+(\\d+)\\s+tokens", str(details), re.IGNORECASE)
                    if m:
                        limit = int(m.group(1))
                        retry_limit = max(64, limit - 16)
                        retry_texts = self._enforce_embedding_token_limit(list(texts or []), retry_limit)
                        all_embeddings = []
                        usage_total = {}
                        for start2 in range(0, len(retry_texts), batch_size):
                            batch2 = retry_texts[start2 : start2 + batch_size]
                            resp2 = await _call_provider(batch2)
                            if not resp2.get("success"):
                                # Last resort for SiliconFlow: split more aggressively and retry once.
                                if provider == "siliconflow":
                                    retry2_limit = max(64, (retry_limit * 3) // 4)
                                    retry2_texts = self._enforce_embedding_token_limit(list(texts or []), retry2_limit)
                                    all_embeddings = []
                                    usage_total = {}
                                    for start3 in range(0, len(retry2_texts), batch_size):
                                        batch3 = retry2_texts[start3 : start3 + batch_size]
                                        resp3 = await _call_provider(batch3)
                                        if not resp3.get("success"):
                                            return {
                                                "success": False,
                                                "error": resp3.get("error") or "Embedding generation failed",
                                                "details": resp3.get("details"),
                                                "provider": provider,
                                                "model": model,
                                                "failed_batch": {"start": start3, "size": len(batch3)},
                                                "input_texts": retry2_texts,
                                            }
                                        all_embeddings.extend(resp3.get("embeddings") or [])
                                        usage_total = _merge_usage(usage_total, resp3.get("usage") or {})
                                    return {
                                        "success": True,
                                        "embeddings": all_embeddings,
                                        "usage": usage_total,
                                        "provider": provider,
                                        "model": model,
                                        "input_texts": retry2_texts,
                                    }
                                return {
                                    "success": False,
                                    "error": resp2.get("error") or "Embedding generation failed",
                                    "details": resp2.get("details"),
                                    "provider": provider,
                                    "model": model,
                                    "failed_batch": {"start": start2, "size": len(batch2)},
                                    "input_texts": retry_texts,
                                }
                            all_embeddings.extend(resp2.get("embeddings") or [])
                            usage_total = _merge_usage(usage_total, resp2.get("usage") or {})
                        return {
                            "success": True,
                            "embeddings": all_embeddings,
                            "usage": usage_total,
                            "provider": provider,
                            "model": model,
                            "input_texts": retry_texts,
                        }

                    return {
                        "success": False,
                        "error": resp.get("error") or "Embedding generation failed",
                        "details": details,
                        "provider": provider,
                        "model": model,
                        "failed_batch": {"start": start, "size": len(batch)},
                        "input_texts": texts_to_embed,
                    }
                all_embeddings.extend(resp.get("embeddings") or [])
                usage_total = _merge_usage(usage_total, resp.get("usage") or {})

            return {
                "success": True,
                "embeddings": all_embeddings,
                "usage": usage_total,
                "provider": provider,
                "model": model,
                "input_texts": texts_to_embed,
            }
        except Exception as e:
            logger.error(
                f"Embedding generation failed with provider {provider}", error=str(e)
            )
            return {"success": False, "error": str(e)}

    async def rerank(
        self,
        query: str,
        documents: list[str],
        model: str = None,
        top_n: int = 5,
        tenant_id: int = None,
        user_id: int | None = None,
        allow_tenant_fallback: bool | None = None,
    ) -> dict[str, Any]:
        """
        Reranks documents using configured provider.
        """
        allow_fallback = self._resolve_allow_tenant_fallback(user_id, tenant_id, allow_tenant_fallback)

        # Use configured provider and model if not specified
        if model is None:
            # 优先从模型配置服务读取（个人配置优先；可选回退租户共享配置）
            try:
                from app.services.model_config_service import (
                    ModelType,
                    ProviderType,
                )
                rerank_config = self._get_active_model_config(
                    ModelType.RERANKING,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                if rerank_config:
                    provider = rerank_config.provider.value
                    model = rerank_config.model_name
                    p_cfg = self._get_provider_config(
                        ProviderType(provider),
                        tenant_id=tenant_id,
                        user_id=user_id,
                        allow_tenant_fallback=allow_fallback,
                    )
                    api_key = rerank_config.api_key or (p_cfg.api_key if p_cfg else None)
                    api_base = rerank_config.api_base or (p_cfg.api_base if p_cfg else None)
                    if provider == "qwen":
                        if api_key:
                            self.qwen.api_key = api_key
                        if api_base:
                            self.qwen.base_url = api_base
                else:
                    if user_id is not None and not allow_fallback:
                        return {
                            "success": False,
                            "error": "No reranking model configured for current user",
                            "message": "Please configure your personal reranking model in Model Settings.",
                        }
                    provider = settings.RERANK_MODEL_PROVIDER
                    model = settings.RERANK_MODEL_NAME
            except Exception:
                if user_id is not None and not allow_fallback:
                    return {
                        "success": False,
                        "error": "No reranking model configured for current user",
                        "message": "Please configure your personal reranking model in Model Settings.",
                    }
                provider = settings.RERANK_MODEL_PROVIDER
                model = settings.RERANK_MODEL_NAME
        else:
            provider = self._resolve_provider_for_model(
                model,
                tenant_id=tenant_id,
                model_type="reranking",
                user_id=user_id,
                allow_tenant_fallback=allow_fallback,
            )

            # Inject provider-level config for specified model
            try:
                from app.services.model_config_service import ProviderType
                p_cfg = self._get_provider_config(
                    ProviderType(provider),
                    tenant_id=tenant_id,
                    user_id=user_id,
                    allow_tenant_fallback=allow_fallback,
                )
                requires_key = bool(getattr(p_cfg, "requires_api_key", True)) if p_cfg else True
                if requires_key and not (p_cfg and p_cfg.api_key):
                    return {
                        "success": False,
                        "error": f"Provider '{provider}' is not configured",
                        "message": "Please configure your personal provider API key/base URL in Model Settings.",
                    }
                if provider == "qwen":
                    if p_cfg and p_cfg.api_key:
                        self.qwen.api_key = p_cfg.api_key
                    if p_cfg and p_cfg.api_base:
                        self.qwen.base_url = p_cfg.api_base
            except Exception:
                pass

        logger.info(f"Using rerank provider: {provider}, model: {model}")

        try:
            if provider == "qwen":
                return await self.qwen.rerank(query, documents, top_n, model=model)
            else:
                logger.warning(
                    f"Unsupported rerank provider: {provider}. Falling back to Qwen."
                )
                return await self.qwen.rerank(query, documents, top_n, model=model)
        except Exception as e:
            logger.error(f"Reranking failed with provider {provider}", error=str(e))
            return {"success": False, "error": str(e)}


# Singleton instance of the main service
llm_service = LLMService()
