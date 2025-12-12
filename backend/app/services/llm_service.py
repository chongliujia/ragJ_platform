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

    async def get_embeddings(self, texts: list[str]) -> dict[str, Any]:
        """
        Generate text embeddings using DeepSeek API
        Note: DeepSeek may not have a dedicated embedding endpoint,
        so this is a placeholder that returns mock embeddings for testing
        """
        if not self.api_key:
            return {"success": False, "error": "DEEPSEEK_API_KEY not configured"}

        if not texts:
            return {"success": True, "embeddings": []}

        # DeepSeek doesn't have a dedicated embedding API, so we'll generate mock embeddings
        # In a real implementation, you might want to use a different embedding service
        # or implement a workaround
        logger.warning(
            "DeepSeek doesn't provide embedding API, generating mock embeddings for testing"
        )

        import random

        mock_embeddings = []
        for text in texts:
            # Generate a deterministic mock embedding based on text hash
            random.seed(hash(text) % (2**32))
            embedding = [
                random.random() for _ in range(1536)
            ]  # 1536 dimensions like OpenAI
            mock_embeddings.append(embedding)

        return {
            "success": True,
            "embeddings": mock_embeddings,
            "usage": {"total_tokens": sum(len(text.split()) for text in texts)},
        }


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

    async def get_embeddings(self, texts: list[str]) -> dict[str, Any]:
        """
        Generate text embeddings using the Qwen embedding model.

        Args:
            texts: A list of text strings to embed.

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
                        "model": settings.QWEN_EMBEDDING_MODEL,
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
        self, query: str, documents: list[str], top_n: int = 5
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
                        "model": settings.QWEN_RERANK_MODEL,
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
        # Use configured provider and model if not specified
        if model is None:
            # 优先使用模型配置服务（含API Key与Base URL）
            try:
                from app.services.model_config_service import (
                    model_config_service,
                    ModelType,
                )

                chat_config = model_config_service.get_active_model(
                    ModelType.CHAT, tenant_id=tenant_id
                )
                logger.info(f"DEBUG: Got chat config from service: {chat_config}")
                if chat_config:
                    provider = chat_config.provider.value
                    model = chat_config.model_name

                    # 将保存的密钥与base url注入到对应服务
                    if provider == "deepseek":
                        if chat_config.api_key:
                            self.deepseek.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.deepseek.base_url = chat_config.api_base
                        # DeepSeek服务内部使用 self.model
                        self.deepseek.model = model
                    elif provider == "qwen":
                        if chat_config.api_key:
                            self.qwen.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.qwen.base_url = chat_config.api_base
                        self.qwen.model = model
                    elif provider == "openai":
                        if chat_config.api_key:
                            self.openai.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.openai.base_url = chat_config.api_base

                    # 使用用户保存的默认推理参数（如有）
                    if chat_config.temperature is not None:
                        temperature = chat_config.temperature
                    if chat_config.max_tokens is not None:
                        max_tokens = chat_config.max_tokens

                    logger.info(f"Using model config service chat model: {provider}/{model}")
                else:
                    # 回退到环境变量配置
                    provider = settings.CHAT_MODEL_PROVIDER
                    model = settings.CHAT_MODEL_NAME
                    logger.info(f"No config service data, using settings chat model: {provider}/{model}")
            except Exception as e:
                logger.warning(f"Failed to get model config, using settings: {e}")
                provider = settings.CHAT_MODEL_PROVIDER
                model = settings.CHAT_MODEL_NAME
                logger.info(f"Exception fallback chat model: {provider}/{model}")
        else:
            # 当指定了具体模型时，根据模型名称确定提供商，但需要加载API密钥配置
            logger.info(f"Using specified model: {model}")
            if model.startswith("deepseek"):
                provider = "deepseek"
            elif model.startswith("qwen"):
                provider = "qwen" 
            elif model.startswith("gpt"):
                provider = "openai"
            else:
                # 对于未知模型，尝试从配置服务获取默认提供商
                try:
                    from app.services.model_config_service import (
                        model_config_service,
                        ModelType,
                    )
                    chat_config = model_config_service.get_active_model(
                        ModelType.CHAT, tenant_id=tenant_id
                    )
                    if chat_config:
                        provider = chat_config.provider.value
                        logger.info(f"Unknown model '{model}', using default provider: {provider}")
                    else:
                        provider = settings.CHAT_MODEL_PROVIDER
                        logger.info(f"Unknown model '{model}', fallback to settings provider: {provider}")
                except Exception:
                    provider = settings.CHAT_MODEL_PROVIDER
                    logger.info(f"Unknown model '{model}', fallback to settings provider: {provider}")
            
            # 为指定的模型加载API密钥配置，但不覆盖模型名称
            try:
                from app.services.model_config_service import (
                    model_config_service,
                    ModelType,
                )
                chat_config = model_config_service.get_active_model(
                    ModelType.CHAT, tenant_id=tenant_id
                )
                if chat_config and chat_config.provider.value == provider:
                    # 只有当配置服务的提供商与推断的提供商一致时，才使用其API密钥
                    if provider == "deepseek":
                        if chat_config.api_key:
                            self.deepseek.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.deepseek.base_url = chat_config.api_base
                        # 设置指定的模型名称而不是配置服务的默认模型
                        self.deepseek.model = model
                    elif provider == "qwen":
                        if chat_config.api_key:
                            self.qwen.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.qwen.base_url = chat_config.api_base
                        # 设置指定的模型名称而不是配置服务的默认模型
                        self.qwen.model = model
                    elif provider == "openai":
                        if chat_config.api_key:
                            self.openai.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.openai.base_url = chat_config.api_base
                    logger.info(f"Loaded API keys for provider '{provider}' with specified model '{model}'")
                else:
                    logger.warning(f"No matching API config found for provider '{provider}', using environment variables")
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
            else:
                return {
                    "success": False,
                    "error": f"Provider {provider} not supported",
                    "message": "Supported providers: deepseek, qwen, openai",
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
        # Use configured provider and model if not specified
        logger.info(f"STREAM_DEBUG: Starting model selection for streaming, model={model}")
        if model is None:
            # 优先使用配置文件中的密钥与基础URL
            try:
                from app.services.model_config_service import (
                    model_config_service,
                    ModelType,
                )

                chat_config = model_config_service.get_active_model(
                    ModelType.CHAT, tenant_id=tenant_id
                )
                logger.info(f"DEBUG: Got chat config from service: {chat_config}")
                if chat_config:
                    provider = chat_config.provider.value
                    model = chat_config.model_name

                    if provider == "deepseek":
                        if chat_config.api_key:
                            self.deepseek.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.deepseek.base_url = chat_config.api_base
                        self.deepseek.model = model
                    elif provider == "qwen":
                        if chat_config.api_key:
                            self.qwen.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.qwen.base_url = chat_config.api_base
                        self.qwen.model = model
                    elif provider == "openai":
                        if chat_config.api_key:
                            self.openai.api_key = chat_config.api_key
                        if chat_config.api_base:
                            self.openai.base_url = chat_config.api_base

                    # 使用用户保存的默认推理参数（如有）
                    if chat_config.temperature is not None:
                        temperature = chat_config.temperature
                    if chat_config.max_tokens is not None:
                        max_tokens = chat_config.max_tokens

                    logger.info(f"Using model config service chat model for streaming: {provider}/{model}")
                else:
                    provider = settings.CHAT_MODEL_PROVIDER
                    model = settings.CHAT_MODEL_NAME
                    logger.info(f"No config service data, using settings chat model for streaming: {provider}/{model}")
            except Exception as e:
                logger.warning(f"Failed to get model config, using settings: {e}")
                provider = settings.CHAT_MODEL_PROVIDER
                model = settings.CHAT_MODEL_NAME
                logger.info(f"Exception fallback chat model for streaming: {provider}/{model}")
        else:
            # Determine provider from model name
            if model.startswith("deepseek"):
                provider = "deepseek"
            elif model.startswith("qwen"):
                provider = "qwen"
            elif model.startswith("gpt"):
                provider = "openai"
            else:
                provider = settings.CHAT_MODEL_PROVIDER

        logger.info(f"Using streaming chat provider: {provider}, model: {model}")

        try:
            if provider == "qwen":
                async for chunk in self.qwen.stream_chat_completion(message, temperature, max_tokens):
                    yield chunk
            elif provider == "deepseek":
                # For deepseek, fallback to regular chat but simulate streaming
                logger.info(f"Using deepseek provider with simulated streaming")
                result = await self.chat(
                    message, model, temperature, max_tokens, tenant_id=tenant_id
                )
                logger.info(f"DEEPSEEK_DEBUG: Got result: {result}")
                if result.get("success"):
                    # Split content into chunks for better streaming effect  
                    content = result.get("message", "") or result.get("content", "")
                    logger.info(f"DEEPSEEK_DEBUG: Content length: {len(content)}, content: {content[:100]}...")
                    chunk_size = 20  # characters per chunk
                    for i in range(0, len(content), chunk_size):
                        chunk_content = content[i:i+chunk_size]
                        logger.info(f"DEEPSEEK_DEBUG: Yielding chunk: {chunk_content}")
                        yield {"success": True, "content": chunk_content}
                        # Small delay to simulate streaming
                        await asyncio.sleep(0.1)
                else:
                    logger.error(f"DEEPSEEK_DEBUG: Chat failed: {result}")
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
            else:
                # For other non-streaming providers, fallback to regular chat
                logger.warning(f"Streaming not supported for provider {provider}, falling back to regular chat")
                result = await self.chat(
                    message, model, temperature, max_tokens, tenant_id=tenant_id
                )
                if result.get("success"):
                    yield {"success": True, "content": result.get("content", "")}
                else:
                    yield {"success": False, "error": result.get("error", "Unknown error")}
        except Exception as e:
            logger.error(f"Streaming chat failed with provider {provider}", error=str(e))
            yield {"success": False, "error": str(e)}

    async def get_embeddings(
        self, texts: list[str], model: str = None, tenant_id: int = None
    ) -> dict[str, Any]:
        """
        Get text embeddings using configured provider.
        """
        # Use configured provider and model if not specified
        if model is None:
            # 优先使用模型配置文件中的设置
            try:
                from app.services.model_config_service import (
                    model_config_service,
                    ModelType,
                )
                
                embedding_config = model_config_service.get_active_model(
                    ModelType.EMBEDDING, tenant_id=tenant_id
                )
                if embedding_config:
                    provider = embedding_config.provider.value
                    model = embedding_config.model_name
                    
                    # 如果配置中有API密钥和基础URL，临时更新服务实例
                    if provider == "siliconflow" and embedding_config.api_key:
                        self.siliconflow.api_key = embedding_config.api_key
                        if embedding_config.api_base:
                            self.siliconflow.base_url = embedding_config.api_base
                    elif provider == "openai" and embedding_config.api_key:
                        self.openai.api_key = embedding_config.api_key
                        if embedding_config.api_base:
                            self.openai.base_url = embedding_config.api_base
                    elif provider == "qwen" and embedding_config.api_key:
                        self.qwen.api_key = embedding_config.api_key
                    elif provider == "deepseek" and embedding_config.api_key:
                        self.deepseek.api_key = embedding_config.api_key
                        if embedding_config.api_base:
                            self.deepseek.base_url = embedding_config.api_base
                    
                    logger.info(f"Using configured embedding model: {provider}/{model}")
                else:
                    # 回退到环境变量
                    provider = settings.EMBEDDING_MODEL_PROVIDER
                    model = settings.EMBEDDING_MODEL_NAME
                    logger.info(f"Using default embedding model: {provider}/{model}")
            except Exception as e:
                logger.warning(f"Failed to get embedding model config, using default: {e}")
                provider = settings.EMBEDDING_MODEL_PROVIDER
                model = settings.EMBEDDING_MODEL_NAME
        else:
            # Determine provider from model name
            if "deepseek" in model:
                provider = "deepseek"
            elif "qwen" in model or "text-embedding" in model:
                provider = "qwen"
            elif "text-embedding-3" in model or "text-embedding-ada" in model:
                provider = "openai"
            elif "BAAI/bge" in model or "sentence-transformers" in model:
                provider = "siliconflow"
            else:
                provider = settings.EMBEDDING_MODEL_PROVIDER

        logger.info(f"Using embedding provider: {provider}, model: {model}")

        try:
            if provider == "openai":
                return await self.openai.get_embeddings(texts, model)
            elif provider == "qwen":
                return await self.qwen.get_embeddings(texts)
            elif provider == "deepseek":
                return await self.deepseek.get_embeddings(texts)
            elif provider == "siliconflow":
                return await self.siliconflow.get_embeddings(texts, model)
            else:
                logger.warning(
                    f"Unsupported embedding provider: {provider}. Falling back to OpenAI."
                )
                return await self.openai.get_embeddings(texts, model)
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
    ) -> dict[str, Any]:
        """
        Reranks documents using configured provider.
        """
        # Use configured provider and model if not specified
        if model is None:
            # 优先从模型配置服务读取（允许不同提供商）
            try:
                from app.services.model_config_service import (
                    model_config_service,
                    ModelType,
                )
                rerank_config = model_config_service.get_active_model(
                    ModelType.RERANKING, tenant_id=tenant_id
                )
                if rerank_config:
                    provider = rerank_config.provider.value
                    model = rerank_config.model_name
                    if provider == "qwen" and rerank_config.api_key:
                        self.qwen.api_key = rerank_config.api_key
                        if rerank_config.api_base:
                            self.qwen.base_url = rerank_config.api_base
                else:
                    provider = settings.RERANK_MODEL_PROVIDER
                    model = settings.RERANK_MODEL_NAME
            except Exception:
                provider = settings.RERANK_MODEL_PROVIDER
                model = settings.RERANK_MODEL_NAME
        else:
            # Determine provider from model name
            if "qwen" in model or "gte-rerank" in model:
                provider = "qwen"
            else:
                provider = settings.RERANK_MODEL_PROVIDER

        logger.info(f"Using rerank provider: {provider}, model: {model}")

        try:
            if provider == "qwen":
                # 若Qwen服务支持选择模型，可在服务内读取 settings 或扩展函数参数
                return await self.qwen.rerank(query, documents, top_n)
            else:
                logger.warning(
                    f"Unsupported rerank provider: {provider}. Falling back to Qwen."
                )
                return await self.qwen.rerank(query, documents, top_n)
        except Exception as e:
            logger.error(f"Reranking failed with provider {provider}", error=str(e))
            return {"success": False, "error": str(e)}


# Singleton instance of the main service
llm_service = LLMService()
