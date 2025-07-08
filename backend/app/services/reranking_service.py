"""
重排模型服务
提供多种重排模型的支持，用于改善检索结果的质量
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from enum import Enum
from abc import ABC, abstractmethod
import requests
import json
from app.core.config import settings
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)


class RerankingProvider(Enum):
    """重排模型提供商"""

    BGE = "bge"
    COHERE = "cohere"
    QWEN = "qwen"
    LOCAL = "local"
    NONE = "none"


class BaseReranker(ABC):
    """重排器基类"""

    @abstractmethod
    async def rerank(
        self, query: str, documents: List[Dict[str, Any]], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        重排文档

        Args:
            query: 查询文本
            documents: 文档列表，每个文档包含text和score字段
            top_k: 返回的top-k结果

        Returns:
            重排后的文档列表
        """
        pass


class NoReranker(BaseReranker):
    """无重排器（直接返回原始结果）"""

    async def rerank(
        self, query: str, documents: List[Dict[str, Any]], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """直接返回原始文档，按现有分数排序"""
        sorted_docs = sorted(documents, key=lambda x: x.get("score", 0), reverse=True)
        return sorted_docs[:top_k]


class BGEReranker(BaseReranker):
    """BGE重排器"""

    def __init__(self):
        self.model_name = "BAAI/bge-reranker-v2-m3"

    def _get_config(self):
        """动态获取配置"""
        try:
            from app.services.model_config_service import (
                model_config_service,
                ModelType,
                ProviderType,
            )

            # 尝试从模型配置服务获取重排模型配置
            rerank_config = model_config_service.get_active_model(ModelType.RERANKING)
            if rerank_config and rerank_config.provider == ProviderType.SILICONFLOW:
                return (
                    rerank_config.api_base or "https://api.siliconflow.cn/v1",
                    rerank_config.api_key,
                )

            # 回退到环境变量或默认值
            api_url = getattr(
                settings, "SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1"
            )
            api_key = getattr(settings, "SILICONFLOW_API_KEY", None)
            return api_url, api_key

        except Exception:
            # 最终回退
            return "https://api.siliconflow.cn/v1", None

    async def rerank(
        self, query: str, documents: List[Dict[str, Any]], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """使用BGE重排器重排文档"""
        try:
            # 动态获取配置
            api_url, api_key = self._get_config()

            if not api_key:
                logger.warning(
                    "BGE reranking API key not configured, falling back to no reranking"
                )
                return await NoReranker().rerank(query, documents, top_k)

            # 准备请求数据
            doc_texts = [doc.get("text", "") for doc in documents]

            # 构造重排请求
            payload = {
                "model": self.model_name,
                "query": query,
                "documents": doc_texts,
                "top_k": min(top_k, len(documents)),
            }

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            # 发送请求
            response = requests.post(
                f"{api_url}/v1/rerank", headers=headers, json=payload, timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                reranked_docs = []

                # 解析重排结果
                for item in result.get("results", []):
                    index = item.get("index", 0)
                    relevance_score = item.get("relevance_score", 0)

                    if index < len(documents):
                        doc = documents[index].copy()
                        doc["rerank_score"] = relevance_score
                        doc["original_score"] = doc.get("score", 0)
                        doc["score"] = relevance_score
                        reranked_docs.append(doc)

                return reranked_docs
            else:
                logger.error(
                    f"BGE reranking failed: {response.status_code} - {response.text}"
                )
                # 回退到原始排序
                return await NoReranker().rerank(query, documents, top_k)

        except Exception as e:
            logger.error(f"BGE reranking error: {e}")
            # 回退到原始排序
            return await NoReranker().rerank(query, documents, top_k)


class CohereReranker(BaseReranker):
    """Cohere重排器"""

    def __init__(self):
        self.model_name = "rerank-multilingual-v3.0"
        self.api_url = "https://api.cohere.ai/v1/rerank"

    def _get_config(self):
        """动态获取配置"""
        try:
            from app.services.model_config_service import (
                model_config_service,
                ModelType,
                ProviderType,
            )

            # 尝试从模型配置服务获取重排模型配置
            rerank_config = model_config_service.get_active_model(ModelType.RERANKING)
            if rerank_config and rerank_config.provider == ProviderType.COHERE:
                return rerank_config.api_key

            # 回退到环境变量
            return getattr(settings, "COHERE_API_KEY", None)

        except Exception:
            return None

    async def rerank(
        self, query: str, documents: List[Dict[str, Any]], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """使用Cohere重排器重排文档"""
        api_key = self._get_config()

        if not api_key:
            logger.warning(
                "Cohere API key not configured, falling back to no reranking"
            )
            return await NoReranker().rerank(query, documents, top_k)

        try:
            # 准备请求数据
            doc_texts = [doc.get("text", "") for doc in documents]

            payload = {
                "model": self.model_name,
                "query": query,
                "documents": doc_texts,
                "top_k": min(top_k, len(documents)),
            }

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            response = requests.post(
                self.api_url, headers=headers, json=payload, timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                reranked_docs = []

                for item in result.get("results", []):
                    index = item.get("index", 0)
                    relevance_score = item.get("relevance_score", 0)

                    if index < len(documents):
                        doc = documents[index].copy()
                        doc["rerank_score"] = relevance_score
                        doc["original_score"] = doc.get("score", 0)
                        doc["score"] = relevance_score
                        reranked_docs.append(doc)

                return reranked_docs
            else:
                logger.error(
                    f"Cohere reranking failed: {response.status_code} - {response.text}"
                )
                return await NoReranker().rerank(query, documents, top_k)

        except Exception as e:
            logger.error(f"Cohere reranking error: {e}")
            return await NoReranker().rerank(query, documents, top_k)


class QwenReranker(BaseReranker):
    """Qwen重排器"""

    def __init__(self):
        self.model_name = "gte-rerank"
        self.api_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"

    def _get_config(self):
        """动态获取配置"""
        try:
            from app.services.model_config_service import (
                model_config_service,
                ModelType,
                ProviderType,
            )

            # 尝试从模型配置服务获取重排模型配置
            rerank_config = model_config_service.get_active_model(ModelType.RERANKING)
            if rerank_config and rerank_config.provider == ProviderType.QWEN:
                return rerank_config.api_key

            # 回退到环境变量
            return getattr(settings, "DASHSCOPE_API_KEY", None)

        except Exception:
            return None

    async def rerank(
        self, query: str, documents: List[Dict[str, Any]], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """使用Qwen重排器重排文档"""
        api_key = self._get_config()

        if not api_key:
            logger.warning("Qwen API key not configured, falling back to no reranking")
            return await NoReranker().rerank(query, documents, top_k)

        try:
            # 使用简单的文本相似度计算作为Qwen重排的替代方案
            # 实际实现中应该调用Qwen的重排API
            doc_texts = [doc.get("text", "") for doc in documents]

            # 使用现有的嵌入服务计算相似度
            embedding_response = await llm_service.get_embeddings(
                texts=[query] + doc_texts
            )

            if not embedding_response.get("success"):
                logger.error("Failed to get embeddings for reranking")
                return await NoReranker().rerank(query, documents, top_k)

            embeddings = embedding_response.get("embeddings", [])
            if len(embeddings) < len(doc_texts) + 1:
                logger.error("Insufficient embeddings for reranking")
                return await NoReranker().rerank(query, documents, top_k)

            query_embedding = embeddings[0]
            doc_embeddings = embeddings[1:]

            # 计算余弦相似度
            reranked_docs = []
            for i, doc in enumerate(documents):
                if i < len(doc_embeddings):
                    similarity = self._cosine_similarity(
                        query_embedding, doc_embeddings[i]
                    )
                    doc_copy = doc.copy()
                    doc_copy["rerank_score"] = similarity
                    doc_copy["original_score"] = doc.get("score", 0)
                    doc_copy["score"] = similarity
                    reranked_docs.append(doc_copy)

            # 按重排分数排序
            reranked_docs.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
            return reranked_docs[:top_k]

        except Exception as e:
            logger.error(f"Qwen reranking error: {e}")
            return await NoReranker().rerank(query, documents, top_k)

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """计算余弦相似度"""
        import math

        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        magnitude_a = math.sqrt(sum(a * a for a in vec1))
        magnitude_b = math.sqrt(sum(b * b for b in vec2))

        if magnitude_a == 0 or magnitude_b == 0:
            return 0.0

        return dot_product / (magnitude_a * magnitude_b)


class LocalReranker(BaseReranker):
    """本地重排器（基于简单的文本相似度）"""

    async def rerank(
        self, query: str, documents: List[Dict[str, Any]], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """使用本地算法重排文档"""
        try:
            # 简单的TF-IDF或关键词匹配方法
            query_words = set(query.lower().split())

            reranked_docs = []
            for doc in documents:
                text = doc.get("text", "").lower()
                doc_words = set(text.split())

                # 计算关键词重叠度
                overlap = len(query_words.intersection(doc_words))
                total_words = len(query_words.union(doc_words))

                if total_words > 0:
                    jaccard_score = overlap / total_words
                else:
                    jaccard_score = 0

                doc_copy = doc.copy()
                doc_copy["rerank_score"] = jaccard_score
                doc_copy["original_score"] = doc.get("score", 0)
                doc_copy["score"] = jaccard_score
                reranked_docs.append(doc_copy)

            # 按重排分数排序
            reranked_docs.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
            return reranked_docs[:top_k]

        except Exception as e:
            logger.error(f"Local reranking error: {e}")
            return await NoReranker().rerank(query, documents, top_k)


class RerankingService:
    """重排服务"""

    def __init__(self):
        self.rerankers = {
            RerankingProvider.NONE: NoReranker(),
            RerankingProvider.BGE: BGEReranker(),
            RerankingProvider.COHERE: CohereReranker(),
            RerankingProvider.QWEN: QwenReranker(),
            RerankingProvider.LOCAL: LocalReranker(),
        }

    async def rerank_documents(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        provider: RerankingProvider = RerankingProvider.NONE,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        重排文档

        Args:
            query: 查询文本
            documents: 文档列表
            provider: 重排提供商
            top_k: 返回的top-k结果

        Returns:
            重排后的文档列表
        """
        if not documents:
            return []

        reranker = self.rerankers.get(provider)
        if not reranker:
            logger.warning(
                f"Unknown reranking provider: {provider}, using no reranking"
            )
            reranker = self.rerankers[RerankingProvider.NONE]

        try:
            return await reranker.rerank(query, documents, top_k)
        except Exception as e:
            logger.error(f"Reranking failed: {e}")
            # 回退到无重排
            return await self.rerankers[RerankingProvider.NONE].rerank(
                query, documents, top_k
            )

    def get_available_providers(self) -> List[Dict[str, Any]]:
        """获取可用的重排提供商"""
        return [
            {
                "value": RerankingProvider.NONE.value,
                "label": "无重排",
                "description": "直接返回原始搜索结果",
                "available": True,
            },
            {
                "value": RerankingProvider.BGE.value,
                "label": "BGE重排",
                "description": "使用BGE重排模型提升结果质量",
                "available": bool(settings.SILICONFLOW_API_KEY),
            },
            {
                "value": RerankingProvider.COHERE.value,
                "label": "Cohere重排",
                "description": "使用Cohere重排模型（多语言支持）",
                "available": hasattr(settings, "COHERE_API_KEY")
                and bool(settings.COHERE_API_KEY),
            },
            {
                "value": RerankingProvider.QWEN.value,
                "label": "Qwen重排",
                "description": "使用Qwen重排模型（中文优化）",
                "available": bool(settings.DASHSCOPE_API_KEY),
            },
            {
                "value": RerankingProvider.LOCAL.value,
                "label": "本地重排",
                "description": "使用本地算法重排（基于关键词匹配）",
                "available": True,
            },
        ]


# 单例实例
reranking_service = RerankingService()
