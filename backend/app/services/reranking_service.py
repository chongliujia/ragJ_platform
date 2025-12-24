"""
重排模型服务
提供多种重排模型的支持，用于改善检索结果的质量
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from enum import Enum
from abc import ABC, abstractmethod
import json
import httpx
from app.core.config import settings
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

async def _post_json(
    url: str,
    *,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    timeout_s: float = 30.0,
) -> tuple[int, str, Optional[Dict[str, Any]]]:
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(url, headers=headers, json=payload)
        text = resp.text
        data: Optional[Dict[str, Any]]
        try:
            data = resp.json()
        except Exception:
            data = None
        return int(resp.status_code), text, data
    except Exception as e:
        return 0, str(e), None


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
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5,
        tenant_id: int = None,
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
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5,
        tenant_id: int = None,
    ) -> List[Dict[str, Any]]:
        """直接返回原始文档，按现有分数排序"""
        sorted_docs = sorted(documents, key=lambda x: x.get("score", 0), reverse=True)
        return sorted_docs[:top_k]


class BGEReranker(BaseReranker):
    """BGE重排器"""

    def __init__(self):
        self.model_name = "BAAI/bge-reranker-v2-m3"

    def _get_config(self, tenant_id: int = None):
        """动态获取配置"""
        try:
            from app.services.model_config_service import (
                model_config_service,
                ModelType,
                ProviderType,
            )

            # 尝试从模型配置服务获取重排模型配置
            rerank_config = model_config_service.get_active_model(
                ModelType.RERANKING, tenant_id=tenant_id
            )
            if rerank_config and rerank_config.provider == ProviderType.SILICONFLOW:
                # 允许 model-level api_key 为空（回退到 provider-level）
                p_cfg = None
                try:
                    p_cfg = model_config_service.get_provider(
                        ProviderType.SILICONFLOW, tenant_id=tenant_id
                    )
                except Exception:
                    p_cfg = None

                api_base = (
                    rerank_config.api_base
                    or (p_cfg.api_base if p_cfg else None)
                    or "https://api.siliconflow.cn/v1"
                )
                api_key = rerank_config.api_key or (p_cfg.api_key if p_cfg else None)
                model_name = rerank_config.model_name or self.model_name
                return (api_base, api_key, model_name)

            # 回退到环境变量或默认值
            api_url = getattr(
                settings, "SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1"
            )
            api_key = getattr(settings, "SILICONFLOW_API_KEY", None)
            return api_url, api_key, self.model_name

        except Exception:
            # 最终回退
            return "https://api.siliconflow.cn/v1", None, self.model_name

    async def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5,
        tenant_id: int = None,
    ) -> List[Dict[str, Any]]:
        """使用BGE重排器重排文档"""
        try:
            # 动态获取配置
            api_url, api_key, model_name = self._get_config(tenant_id=tenant_id)
            
            logger.info(f"BGE reranking configuration - API URL: {api_url}, has API key: {bool(api_key)}")

            if not api_key:
                logger.warning(
                    "BGE reranking API key not configured, falling back to no reranking"
                )
                return await NoReranker().rerank(query, documents, top_k)

            # 准备请求数据
            doc_texts = [doc.get("text", "") for doc in documents]

            # 构造重排请求（按SiliconFlow API格式）
            payload = {
                "model": model_name,
                "query": query,
                "documents": doc_texts,
            }

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            # 发送请求 - 使用正确的SiliconFlow端点
            # 确保正确的URL格式
            if api_url.endswith('/v1'):
                rerank_url = f"{api_url}/rerank"
            elif api_url.endswith('/'):
                rerank_url = f"{api_url}v1/rerank"
            else:
                rerank_url = f"{api_url}/v1/rerank"
                
            logger.info(f"Sending rerank request to: {rerank_url}")
            logger.info(f"Request payload: {payload}")

            status_code, response_text, result = await _post_json(
                rerank_url, headers=headers, payload=payload, timeout_s=30.0
            )

            logger.info(f"Response status code: {status_code}")
            logger.info(f"Response text: {response_text}")

            if status_code == 200 and isinstance(result, dict):
                logger.info(f"Parsed response: {result}")
                reranked_docs = []

                # 解析SiliconFlow重排结果 - 尝试不同的响应格式
                if "results" in result:
                    # 标准格式
                    for item in result["results"]:
                        index = item.get("index", 0)
                        # 尝试不同的分数字段名称
                        relevance_score = item.get("relevance_score", 0) or item.get("score", 0)

                        if index < len(documents):
                            doc = documents[index].copy()
                            doc["rerank_score"] = relevance_score
                            doc["original_score"] = doc.get("score", 0)
                            doc["score"] = relevance_score
                            reranked_docs.append(doc)
                elif "data" in result:
                    # 备用格式
                    for i, item in enumerate(result["data"]):
                        if i < len(documents):
                            relevance_score = item.get("relevance_score", 0) or item.get("score", 0)
                            doc = documents[i].copy()
                            doc["rerank_score"] = relevance_score
                            doc["original_score"] = doc.get("score", 0)
                            doc["score"] = relevance_score
                            reranked_docs.append(doc)
                else:
                    logger.warning(f"Unexpected response format: {result}")
                    return await NoReranker().rerank(query, documents, top_k)

                # 按重排分数排序并返回top_k结果
                reranked_docs.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
                return reranked_docs[:top_k]
            else:
                logger.error(
                    f"BGE reranking failed: {status_code} - {response_text}"
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

    def _get_config(self, tenant_id: int = None):
        """动态获取配置"""
        try:
            from app.services.model_config_service import (
                model_config_service,
                ModelType,
                ProviderType,
            )

            # 尝试从模型配置服务获取重排模型配置
            rerank_config = model_config_service.get_active_model(
                ModelType.RERANKING, tenant_id=tenant_id
            )
            if rerank_config and rerank_config.provider == ProviderType.COHERE:
                p_cfg = None
                try:
                    p_cfg = model_config_service.get_provider(
                        ProviderType.COHERE, tenant_id=tenant_id
                    )
                except Exception:
                    p_cfg = None

                api_key = rerank_config.api_key or (p_cfg.api_key if p_cfg else None)
                api_base = (
                    rerank_config.api_base
                    or (p_cfg.api_base if p_cfg else None)
                    or "https://api.cohere.ai/v1"
                )
                model_name = rerank_config.model_name or self.model_name
                return api_key, api_base, model_name

            # 回退到环境变量
            return (
                getattr(settings, "COHERE_API_KEY", None),
                "https://api.cohere.ai/v1",
                self.model_name,
            )

        except Exception:
            return None, "https://api.cohere.ai/v1", self.model_name

    async def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5,
        tenant_id: int = None,
    ) -> List[Dict[str, Any]]:
        """使用Cohere重排器重排文档"""
        api_key, api_base, model_name = self._get_config(tenant_id=tenant_id)

        if not api_key:
            logger.warning(
                "Cohere API key not configured, falling back to no reranking"
            )
            return await NoReranker().rerank(query, documents, top_k)

        try:
            # 准备请求数据
            doc_texts = [doc.get("text", "") for doc in documents]

            payload = {
                "model": model_name,
                "query": query,
                "documents": doc_texts,
                "top_k": min(top_k, len(documents)),
            }

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            rerank_url = f"{api_base.rstrip('/')}/rerank"
            status_code, response_text, result = await _post_json(
                rerank_url, headers=headers, payload=payload, timeout_s=30.0
            )

            if status_code == 200 and isinstance(result, dict):
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
                    f"Cohere reranking failed: {status_code} - {response_text}"
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

    def _get_config(self, tenant_id: int = None):
        """动态获取配置"""
        try:
            from app.services.model_config_service import (
                model_config_service,
                ModelType,
                ProviderType,
            )

            # 尝试从模型配置服务获取重排模型配置
            rerank_config = model_config_service.get_active_model(
                ModelType.RERANKING, tenant_id=tenant_id
            )
            if rerank_config and rerank_config.provider == ProviderType.QWEN:
                p_cfg = None
                try:
                    p_cfg = model_config_service.get_provider(
                        ProviderType.QWEN, tenant_id=tenant_id
                    )
                except Exception:
                    p_cfg = None

                api_key = rerank_config.api_key or (p_cfg.api_key if p_cfg else None)
                api_base = (
                    rerank_config.api_base
                    or (p_cfg.api_base if p_cfg else None)
                    or "https://dashscope.aliyuncs.com/api/v1"
                )
                model_name = rerank_config.model_name or self.model_name
                return api_key, api_base, model_name

            # 回退到环境变量
            return (
                getattr(settings, "DASHSCOPE_API_KEY", None),
                "https://dashscope.aliyuncs.com/api/v1",
                self.model_name,
            )

        except Exception:
            return None, "https://dashscope.aliyuncs.com/api/v1", self.model_name

    async def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5,
        tenant_id: int = None,
    ) -> List[Dict[str, Any]]:
        """使用Qwen重排器重排文档"""
        api_key, api_base, model_name = self._get_config(tenant_id=tenant_id)

        if not api_key:
            logger.warning("Qwen API key not configured, falling back to no reranking")
            return await NoReranker().rerank(query, documents, top_k)

        try:
            doc_texts = [doc.get("text", "") for doc in documents]

            # 注入 per-tenant 配置后调用真实 Qwen rerank API
            llm_service.qwen.api_key = api_key
            llm_service.qwen.base_url = api_base
            resp = await llm_service.qwen.rerank(
                query=query, documents=doc_texts, top_n=min(top_k, len(doc_texts)), model=model_name
            )
            if not resp.get("success"):
                logger.error(f"Qwen rerank API failed: {resp}")
                return await NoReranker().rerank(query, documents, top_k)

            items = resp.get("documents") or []
            reranked_docs: List[Dict[str, Any]] = []
            for item in items:
                index = item.get("index")
                if index is None:
                    index = item.get("document_index")
                try:
                    index = int(index)
                except Exception:
                    continue

                score = (
                    item.get("relevance_score")
                    if item.get("relevance_score") is not None
                    else item.get("score", 0)
                )
                if 0 <= index < len(documents):
                    doc_copy = documents[index].copy()
                    doc_copy["rerank_score"] = score
                    doc_copy["original_score"] = doc_copy.get("score", 0)
                    doc_copy["score"] = score
                    reranked_docs.append(doc_copy)

            if not reranked_docs:
                return await NoReranker().rerank(query, documents, top_k)

            reranked_docs.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
            return reranked_docs[:top_k]

        except Exception as e:
            logger.error(f"Qwen reranking error: {e}")
            return await NoReranker().rerank(query, documents, top_k)


class LocalReranker(BaseReranker):
    """本地重排器（基于简单的文本相似度）"""

    async def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5,
        tenant_id: int = None,
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
        tenant_id: int = None,
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
            return await reranker.rerank(
                query, documents, top_k=top_k, tenant_id=tenant_id
            )
        except Exception as e:
            logger.error(f"Reranking failed: {e}")
            # 回退到无重排
            return await self.rerankers[RerankingProvider.NONE].rerank(
                query, documents, top_k, tenant_id=tenant_id
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
