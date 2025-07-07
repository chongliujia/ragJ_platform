"""
模型配置管理服务
支持动态配置不同的模型提供商，类似于Dify和RAGFlow的架构
"""
import logging
from typing import Dict, Any, Optional, List
from enum import Enum
from pydantic import BaseModel
import json
import os
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
    """模型配置管理服务"""
    
    def __init__(self):
        self.config_file = "model_configs.json"
        self.providers: Dict[ProviderType, ProviderConfig] = {}
        self.active_models: Dict[ModelType, ModelConfig] = {}
        self._load_default_providers()
        self._load_config()
    
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
                    ModelType.EMBEDDING: ["text-embedding-3-large", "text-embedding-3-small", "text-embedding-ada-002"],
                    ModelType.RERANKING: []
                },
                pricing={
                    "chat": {"gpt-4": {"input": 0.03, "output": 0.06}},
                    "embedding": {"text-embedding-3-large": {"input": 0.00013}}
                }
            ),
            ProviderType.DEEPSEEK: ProviderConfig(
                provider=ProviderType.DEEPSEEK,
                display_name="DeepSeek",
                api_base="https://api.deepseek.com/v1",
                description="DeepSeek高性能代码和聊天模型",
                models={
                    ModelType.CHAT: ["deepseek-chat", "deepseek-coder"],
                    ModelType.EMBEDDING: [],
                    ModelType.RERANKING: []
                },
                pricing={
                    "chat": {"deepseek-chat": {"input": 0.0014, "output": 0.0028}}
                }
            ),
            ProviderType.QWEN: ProviderConfig(
                provider=ProviderType.QWEN,
                display_name="通义千问",
                api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
                description="阿里云通义千问全系列模型",
                models={
                    ModelType.CHAT: ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-max-longcontext"],
                    ModelType.EMBEDDING: ["text-embedding-v1", "text-embedding-v2", "text-embedding-v3"],
                    ModelType.RERANKING: ["gte-rerank", "gte-rerank-hybrid"]
                },
                pricing={
                    "chat": {"qwen-max": {"input": 0.02, "output": 0.06}},
                    "embedding": {"text-embedding-v2": {"input": 0.0007}},
                    "reranking": {"gte-rerank": {"input": 0.002}}
                }
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
                        "01-ai/Yi-1.5-34B-Chat-16K"
                    ],
                    ModelType.EMBEDDING: [
                        "BAAI/bge-large-zh-v1.5",
                        "BAAI/bge-m3",
                        "BAAI/bge-large-en-v1.5",
                        "sentence-transformers/all-MiniLM-L6-v2"
                    ],
                    ModelType.RERANKING: [
                        "BAAI/bge-reranker-v2-m3",
                        "BAAI/bge-reranker-large"
                    ]
                },
                pricing={
                    "chat": {"deepseek-ai/DeepSeek-V2.5": {"input": 0.0014, "output": 0.0028}},
                    "embedding": {"BAAI/bge-large-zh-v1.5": {"input": 0.0001}},
                    "reranking": {"BAAI/bge-reranker-v2-m3": {"input": 0.001}}
                }
            ),
            ProviderType.COHERE: ProviderConfig(
                provider=ProviderType.COHERE,
                display_name="Cohere",
                api_base="https://api.cohere.ai/v1",
                description="Cohere多语言模型服务",
                models={
                    ModelType.CHAT: ["command-r", "command-r-plus"],
                    ModelType.EMBEDDING: ["embed-multilingual-v3.0", "embed-english-v3.0"],
                    ModelType.RERANKING: ["rerank-multilingual-v3.0", "rerank-english-v3.0"]
                },
                pricing={
                    "reranking": {"rerank-multilingual-v3.0": {"input": 0.002}}
                }
            ),
            ProviderType.LOCAL: ProviderConfig(
                provider=ProviderType.LOCAL,
                display_name="本地模型",
                api_base="http://localhost:11434/v1",
                description="本地部署的开源模型（如Ollama）",
                models={
                    ModelType.CHAT: ["llama3:8b", "qwen2:7b", "deepseek-coder:6.7b"],
                    ModelType.EMBEDDING: ["nomic-embed-text", "bge-large"],
                    ModelType.RERANKING: ["bge-reranker"]
                },
                pricing={}
            )
        }
        
        self.providers = default_providers
    
    def _load_config(self):
        """从文件加载配置"""
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config_data = json.load(f)
                
                # 加载提供商配置
                if 'providers' in config_data:
                    for provider_data in config_data['providers']:
                        provider = ProviderConfig(**provider_data)
                        self.providers[provider.provider] = provider
                
                # 加载活跃模型配置
                if 'active_models' in config_data:
                    for model_type_str, model_data in config_data['active_models'].items():
                        model_type = ModelType(model_type_str)
                        self.active_models[model_type] = ModelConfig(**model_data)
                
                logger.info("Model configuration loaded successfully")
            else:
                self._set_default_active_models()
                
        except Exception as e:
            logger.error(f"Failed to load model configuration: {e}")
            self._set_default_active_models()
    
    def _set_default_active_models(self):
        """设置默认的活跃模型"""
        # 根据现有环境变量设置默认模型
        self.active_models = {
            ModelType.CHAT: ModelConfig(
                provider=ProviderType.DEEPSEEK,
                model_name="deepseek-chat",
                api_key=getattr(settings, 'DEEPSEEK_API_KEY', None),
                api_base="https://api.deepseek.com/v1",
                temperature=0.7,
                max_tokens=4000
            ),
            ModelType.EMBEDDING: ModelConfig(
                provider=ProviderType.SILICONFLOW,
                model_name="BAAI/bge-large-zh-v1.5",
                api_key=getattr(settings, 'SILICONFLOW_API_KEY', None),
                api_base="https://api.siliconflow.cn/v1"
            ),
            ModelType.RERANKING: ModelConfig(
                provider=ProviderType.QWEN,
                model_name="gte-rerank",
                api_key=getattr(settings, 'DASHSCOPE_API_KEY', None),
                api_base="https://dashscope.aliyuncs.com/compatible-mode/v1"
            )
        }
    
    def save_config(self):
        """保存配置到文件"""
        try:
            config_data = {
                'providers': [provider.dict() for provider in self.providers.values()],
                'active_models': {
                    model_type.value: model_config.dict() 
                    for model_type, model_config in self.active_models.items()
                }
            }
            
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, ensure_ascii=False, indent=2)
            
            logger.info("Model configuration saved successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save model configuration: {e}")
            return False
    
    def get_providers(self) -> Dict[ProviderType, ProviderConfig]:
        """获取所有提供商配置"""
        return self.providers
    
    def get_provider(self, provider: ProviderType) -> Optional[ProviderConfig]:
        """获取指定提供商配置"""
        return self.providers.get(provider)
    
    def update_provider(self, provider: ProviderType, config: ProviderConfig):
        """更新提供商配置"""
        self.providers[provider] = config
        self.save_config()
    
    def get_active_model(self, model_type: ModelType) -> Optional[ModelConfig]:
        """获取指定类型的活跃模型配置"""
        return self.active_models.get(model_type)
    
    def set_active_model(self, model_type: ModelType, config: ModelConfig):
        """设置指定类型的活跃模型"""
        self.active_models[model_type] = config
        self.save_config()
    
    def get_available_models(self, provider: ProviderType, model_type: ModelType) -> List[str]:
        """获取指定提供商的可用模型列表"""
        provider_config = self.providers.get(provider)
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
    
    def get_model_pricing(self, provider: ProviderType, model_type: ModelType, model_name: str) -> Dict[str, Any]:
        """获取模型定价信息"""
        provider_config = self.providers.get(provider)
        if not provider_config:
            return {}
        
        return provider_config.pricing.get(model_type.value, {}).get(model_name, {})
    
    def get_config_summary(self) -> Dict[str, Any]:
        """获取配置摘要"""
        return {
            "providers": {
                provider.value: {
                    "display_name": config.display_name,
                    "enabled": config.enabled,
                    "has_api_key": bool(config.api_key),
                    "model_counts": {
                        model_type.value: len(models) 
                        for model_type, models in config.models.items()
                    }
                }
                for provider, config in self.providers.items()
            },
            "active_models": {
                model_type.value: {
                    "provider": config.provider.value,
                    "model_name": config.model_name,
                    "has_api_key": bool(config.api_key)
                }
                for model_type, config in self.active_models.items()
            }
        }


# 全局模型配置服务实例
model_config_service = ModelConfigService()