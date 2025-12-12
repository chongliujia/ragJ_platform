"""
模型配置管理服务
支持动态配置不同的模型提供商，类似于Dify和RAGFlow的架构
"""

import logging
from typing import Dict, Any, Optional, List
from enum import Enum
from pydantic import BaseModel
from app.core.config import settings

logger = logging.getLogger(__name__)


class ModelType(Enum):
    """模型类型"""

    CHAT = "chat"
    EMBEDDING = "embedding"
    RERANKING = "reranking"


class ProviderType(Enum):
    """模型提供商类型"""

    OPENAI = "openai"
    DEEPSEEK = "deepseek"
    QWEN = "qwen"
    SILICONFLOW = "siliconflow"
    COHERE = "cohere"
    LOCAL = "local"


class ModelConfig(BaseModel):
    """单个模型配置"""

    provider: ProviderType
    model_name: str
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    enabled: bool = True
    custom_params: Dict[str, Any] = {}


class ProviderConfig(BaseModel):
    """提供商配置"""

    provider: ProviderType
    display_name: str
    api_base: str
    api_key: Optional[str] = None
    enabled: bool = True
    models: Dict[ModelType, List[str]] = {}
    description: str = ""
    pricing: Dict[str, Any] = {}


class ModelConfigService:
    """模型配置管理服务（支持 per-tenant 配置存储）。"""

    def __init__(self):
        self.providers: Dict[ProviderType, ProviderConfig] = {}
        self.active_models: Dict[ModelType, ModelConfig] = {}
        self._load_default_providers()
        # 仅加载一次全局默认活跃模型（作为租户未配置时的回退）
        self._set_default_active_models()

    def _load_default_providers(self):
        """加载默认的提供商配置"""
        default_providers = {
            ProviderType.OPENAI: ProviderConfig(
                provider=ProviderType.OPENAI,
                display_name="OpenAI",
                api_base="https://api.openai.com/v1",
                description="OpenAI GPT模型和嵌入模型",
                models={
                    ModelType.CHAT: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
                    ModelType.EMBEDDING: [
                        "text-embedding-3-large",
                        "text-embedding-3-small",
                        "text-embedding-ada-002",
                    ],
                    ModelType.RERANKING: [],
                },
                pricing={
                    "chat": {"gpt-4": {"input": 0.03, "output": 0.06}},
                    "embedding": {"text-embedding-3-large": {"input": 0.00013}},
                },
            ),
            ProviderType.DEEPSEEK: ProviderConfig(
                provider=ProviderType.DEEPSEEK,
                display_name="DeepSeek",
                api_base="https://api.deepseek.com/v1",
                description="DeepSeek高性能代码和聊天模型",
                models={
                    ModelType.CHAT: ["deepseek-chat", "deepseek-coder"],
                    ModelType.EMBEDDING: [],
                    ModelType.RERANKING: [],
                },
                pricing={
                    "chat": {"deepseek-chat": {"input": 0.0014, "output": 0.0028}}
                },
            ),
            ProviderType.QWEN: ProviderConfig(
                provider=ProviderType.QWEN,
                display_name="通义千问",
                api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
                description="阿里云通义千问全系列模型",
                models={
                    ModelType.CHAT: [
                        "qwen-turbo",
                        "qwen-plus",
                        "qwen-max",
                        "qwen-max-longcontext",
                    ],
                    ModelType.EMBEDDING: [
                        "text-embedding-v1",
                        "text-embedding-v2",
                        "text-embedding-v3",
                    ],
                    ModelType.RERANKING: ["gte-rerank", "gte-rerank-hybrid"],
                },
                pricing={
                    "chat": {"qwen-max": {"input": 0.02, "output": 0.06}},
                    "embedding": {"text-embedding-v2": {"input": 0.0007}},
                    "reranking": {"gte-rerank": {"input": 0.002}},
                },
            ),
            ProviderType.SILICONFLOW: ProviderConfig(
                provider=ProviderType.SILICONFLOW,
                display_name="硅基流动",
                api_base="https://api.siliconflow.cn/v1",
                description="硅基流动开源模型API服务",
                models={
                    ModelType.CHAT: [
                        "deepseek-ai/DeepSeek-V2.5",
                        "Qwen/Qwen2.5-72B-Instruct",
                        "meta-llama/Meta-Llama-3.1-70B-Instruct",
                        "01-ai/Yi-1.5-34B-Chat-16K",
                    ],
                    ModelType.EMBEDDING: [
                        "BAAI/bge-large-zh-v1.5",
                        "BAAI/bge-m3",
                        "BAAI/bge-large-en-v1.5",
                        "sentence-transformers/all-MiniLM-L6-v2",
                    ],
                    ModelType.RERANKING: [
                        "BAAI/bge-reranker-v2-m3",
                        "BAAI/bge-reranker-large",
                    ],
                },
                pricing={
                    "chat": {
                        "deepseek-ai/DeepSeek-V2.5": {"input": 0.0014, "output": 0.0028}
                    },
                    "embedding": {"BAAI/bge-large-zh-v1.5": {"input": 0.0001}},
                    "reranking": {"BAAI/bge-reranker-v2-m3": {"input": 0.001}},
                },
            ),
            ProviderType.COHERE: ProviderConfig(
                provider=ProviderType.COHERE,
                display_name="Cohere",
                api_base="https://api.cohere.ai/v1",
                description="Cohere多语言模型服务",
                models={
                    ModelType.CHAT: ["command-r", "command-r-plus"],
                    ModelType.EMBEDDING: [
                        "embed-multilingual-v3.0",
                        "embed-english-v3.0",
                    ],
                    ModelType.RERANKING: [
                        "rerank-multilingual-v3.0",
                        "rerank-english-v3.0",
                    ],
                },
                pricing={"reranking": {"rerank-multilingual-v3.0": {"input": 0.002}}},
            ),
            ProviderType.LOCAL: ProviderConfig(
                provider=ProviderType.LOCAL,
                display_name="本地模型",
                api_base="http://localhost:11434/v1",
                description="本地部署的开源模型（如Ollama）",
                models={
                    ModelType.CHAT: ["llama3:8b", "qwen2:7b", "deepseek-coder:6.7b"],
                    ModelType.EMBEDDING: ["nomic-embed-text", "bge-large"],
                    ModelType.RERANKING: ["bge-reranker"],
                },
                pricing={},
            ),
        }

        self.providers = default_providers

    def _set_default_active_models(self):
        """设置默认的活跃模型"""
        # 根据现有环境变量设置默认模型
        self.active_models = {
            ModelType.CHAT: ModelConfig(
                provider=ProviderType.DEEPSEEK,
                model_name="deepseek-chat",
                api_key=getattr(settings, "DEEPSEEK_API_KEY", None),
                api_base="https://api.deepseek.com/v1",
                temperature=0.7,
                max_tokens=4000,
            ),
            ModelType.EMBEDDING: ModelConfig(
                provider=ProviderType.SILICONFLOW,
                model_name="BAAI/bge-large-zh-v1.5",
                api_key=getattr(settings, "SILICONFLOW_API_KEY", None),
                api_base="https://api.siliconflow.cn/v1",
            ),
            ModelType.RERANKING: ModelConfig(
                provider=ProviderType.QWEN,
                model_name="gte-rerank",
                api_key=getattr(settings, "DASHSCOPE_API_KEY", None),
                api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
        }

    def get_providers(self, tenant_id: Optional[int] = None) -> Dict[ProviderType, ProviderConfig]:
        """获取所有提供商配置（可按租户覆盖）。"""
        if tenant_id is None:
            return self.providers

        from app.db.database import SessionLocal
        from app.db.models.tenant_model_config import TenantProviderConfig

        db = SessionLocal()
        try:
            rows = (
                db.query(TenantProviderConfig)
                .filter(TenantProviderConfig.tenant_id == tenant_id)
                .all()
            )
            overrides = {r.provider: r for r in rows}

            result: Dict[ProviderType, ProviderConfig] = {}
            for p_type, base in self.providers.items():
                cfg = base.copy(deep=True)
                ov = overrides.get(p_type.value)
                if ov:
                    if ov.api_key is not None:
                        cfg.api_key = ov.api_key
                    if ov.api_base:
                        cfg.api_base = ov.api_base
                    cfg.enabled = bool(ov.enabled)
                    # merge custom models per tenant
                    for mt_str, models in (ov.custom_models or {}).items():
                        try:
                            mt = ModelType(mt_str)
                        except Exception:
                            continue
                        existing = cfg.models.get(mt, [])
                        merged = list(dict.fromkeys(existing + (models or [])))
                        cfg.models[mt] = merged
                result[p_type] = cfg
            return result
        finally:
            db.close()

    def get_provider(
        self, provider: ProviderType, tenant_id: Optional[int] = None
    ) -> Optional[ProviderConfig]:
        """获取指定提供商配置（可按租户覆盖）。"""
        providers = self.get_providers(tenant_id=tenant_id)
        return providers.get(provider)

    def update_provider(
        self, provider: ProviderType, config: ProviderConfig, tenant_id: Optional[int] = None
    ):
        """更新提供商配置。

        - tenant_id=None: 更新全局默认（内存）配置
        - tenant_id=*: 持久化租户配置（API key/base/enabled）
        """
        if tenant_id is None:
            self.providers[provider] = config
            return

        from app.db.database import SessionLocal
        from app.db.models.tenant_model_config import TenantProviderConfig

        db = SessionLocal()
        try:
            row = (
                db.query(TenantProviderConfig)
                .filter(
                    TenantProviderConfig.tenant_id == tenant_id,
                    TenantProviderConfig.provider == provider.value,
                )
                .first()
            )
            if row is None:
                row = TenantProviderConfig(
                    tenant_id=tenant_id, provider=provider.value, custom_models={}
                )
                db.add(row)
            row.api_key = config.api_key
            row.api_base = config.api_base
            row.enabled = bool(config.enabled)
            db.commit()
        finally:
            db.close()

    def add_custom_model(
        self,
        provider: ProviderType,
        model_type: ModelType,
        model_name: str,
        tenant_id: int,
    ) -> bool:
        """为租户提供商添加自定义模型名称。"""
        from app.db.database import SessionLocal
        from app.db.models.tenant_model_config import TenantProviderConfig

        db = SessionLocal()
        try:
            row = (
                db.query(TenantProviderConfig)
                .filter(
                    TenantProviderConfig.tenant_id == tenant_id,
                    TenantProviderConfig.provider == provider.value,
                )
                .first()
            )
            if row is None:
                row = TenantProviderConfig(
                    tenant_id=tenant_id, provider=provider.value, custom_models={}
                )
                db.add(row)
                db.flush()

            cm = dict(row.custom_models or {})
            mt_key = model_type.value
            existing = list(cm.get(mt_key) or [])
            if model_name not in existing:
                existing.append(model_name)
            cm[mt_key] = existing
            row.custom_models = cm
            db.commit()
            return True
        finally:
            db.close()

    def get_active_model(
        self, model_type: ModelType, tenant_id: Optional[int] = None
    ) -> Optional[ModelConfig]:
        """获取指定类型的活跃模型配置（可按租户覆盖）。"""
        if tenant_id is None:
            return self.active_models.get(model_type)

        from app.db.database import SessionLocal
        from app.db.models.tenant_model_config import TenantModelConfig

        db = SessionLocal()
        try:
            row = (
                db.query(TenantModelConfig)
                .filter(
                    TenantModelConfig.tenant_id == tenant_id,
                    TenantModelConfig.model_type == model_type.value,
                )
                .first()
            )
            if row is None:
                base = self.active_models.get(model_type)
                if base is None:
                    return None
                p_cfg = self.get_provider(base.provider, tenant_id=tenant_id)
                return ModelConfig(
                    provider=base.provider,
                    model_name=base.model_name,
                    api_key=(p_cfg.api_key if p_cfg else base.api_key),
                    api_base=(p_cfg.api_base if p_cfg else base.api_base),
                    max_tokens=base.max_tokens,
                    temperature=base.temperature,
                    top_p=base.top_p,
                    enabled=base.enabled,
                    custom_params=base.custom_params or {},
                )

            try:
                provider_enum = ProviderType(row.provider)
            except Exception:
                provider_enum = ProviderType.DEEPSEEK

            p_cfg = self.get_provider(provider_enum, tenant_id=tenant_id)
            api_key = row.api_key or (p_cfg.api_key if p_cfg else None)
            api_base = row.api_base or (p_cfg.api_base if p_cfg else None)

            return ModelConfig(
                provider=provider_enum,
                model_name=row.model_name,
                api_key=api_key,
                api_base=api_base,
                max_tokens=row.max_tokens,
                temperature=row.temperature,
                top_p=row.top_p,
                enabled=row.enabled,
                custom_params=row.custom_params or {},
            )
        finally:
            db.close()

    def set_active_model(
        self, model_type: ModelType, config: ModelConfig, tenant_id: Optional[int] = None
    ):
        """设置指定类型的活跃模型。

        - tenant_id=None: 更新全局默认（内存）配置
        - tenant_id=*: 持久化租户活跃模型配置
        """
        if tenant_id is None:
            self.active_models[model_type] = config
            return

        from app.db.database import SessionLocal
        from app.db.models.tenant_model_config import TenantModelConfig

        db = SessionLocal()
        try:
            row = (
                db.query(TenantModelConfig)
                .filter(
                    TenantModelConfig.tenant_id == tenant_id,
                    TenantModelConfig.model_type == model_type.value,
                )
                .first()
            )
            if row is None:
                row = TenantModelConfig(
                    tenant_id=tenant_id, model_type=model_type.value
                )
                db.add(row)
            row.provider = config.provider.value
            row.model_name = config.model_name
            row.api_key = config.api_key or None
            row.api_base = config.api_base or None
            row.max_tokens = config.max_tokens
            row.temperature = config.temperature
            row.top_p = config.top_p
            row.enabled = bool(config.enabled)
            row.custom_params = config.custom_params or {}
            db.commit()
        finally:
            db.close()

    def get_available_models(
        self, provider: ProviderType, model_type: ModelType, tenant_id: Optional[int] = None
    ) -> List[str]:
        """获取指定提供商的可用模型列表（含租户自定义模型）。"""
        provider_config = self.get_provider(provider, tenant_id=tenant_id)
        if not provider_config:
            return []
        return provider_config.models.get(model_type, [])

    def validate_model_config(self, config: ModelConfig) -> bool:
        """验证模型配置是否有效"""
        # 检查提供商是否存在
        if config.provider not in self.providers:
            return False

        # 检查API密钥
        if not config.api_key:
            return False

        # 可以添加更多验证逻辑
        return True

    def get_model_pricing(
        self, provider: ProviderType, model_type: ModelType, model_name: str
    ) -> Dict[str, Any]:
        """获取模型定价信息"""
        provider_config = self.providers.get(provider)
        if not provider_config:
            return {}

        return provider_config.pricing.get(model_type.value, {}).get(model_name, {})

    def get_config_summary(self, tenant_id: Optional[int] = None) -> Dict[str, Any]:
        """获取配置摘要（可按租户）。"""
        providers = self.get_providers(tenant_id=tenant_id)
        active_models = {
            mt: self.get_active_model(mt, tenant_id=tenant_id)
            for mt in ModelType
        }
        return {
            "providers": {
                provider.value: {
                    "display_name": config.display_name,
                    "enabled": config.enabled,
                    "has_api_key": bool(config.api_key),
                    "model_counts": {
                        model_type.value: len(models)
                        for model_type, models in config.models.items()
                    },
                }
                for provider, config in providers.items()
            },
            "active_models": {
                model_type.value: {
                    "provider": config.provider.value,
                    "model_name": config.model_name,
                    "has_api_key": bool(config.api_key),
                }
                for model_type, config in active_models.items()
                if config is not None
            },
        }


# 全局模型配置服务实例
model_config_service = ModelConfigService()
