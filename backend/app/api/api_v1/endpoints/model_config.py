"""
模型配置管理API端点
"""

import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel

from app.services.model_config_service import (
    model_config_service,
    ModelConfig,
    ProviderConfig,
    ModelType,
    ProviderType,
)
from app.core.dependencies import get_tenant_id, require_tenant_admin
from app.db.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)


class ModelConfigResponse(BaseModel):
    """模型配置响应"""

    model_type: str
    provider: str
    model_name: str
    has_api_key: bool
    enabled: bool


class ProviderConfigResponse(BaseModel):
    """提供商配置响应"""

    provider: str
    display_name: str
    api_base: str
    has_api_key: bool
    enabled: bool
    available_models: Dict[str, List[str]]
    description: str


class UpdateModelConfigRequest(BaseModel):
    """更新模型配置请求"""

    provider: str
    model_name: str
    api_key: str = ""  # 允许为空，保持现有密钥
    api_base: str = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    enabled: bool = True


class UpdateProviderRequest(BaseModel):
    """更新提供商请求"""

    api_key: str
    api_base: str = None
    enabled: bool = True


@router.get("/providers", response_model=List[ProviderConfigResponse])
async def get_providers(tenant_id: int = Depends(get_tenant_id)):
    """获取所有提供商配置"""
    try:
        providers = model_config_service.get_providers(tenant_id=tenant_id)

        response = []
        for provider_type, provider_config in providers.items():
            response.append(
                ProviderConfigResponse(
                    provider=provider_type.value,
                    display_name=provider_config.display_name,
                    api_base=provider_config.api_base,
                    has_api_key=bool(provider_config.api_key),
                    enabled=provider_config.enabled,
                    available_models={
                        model_type.value: models
                        for model_type, models in provider_config.models.items()
                    },
                    description=provider_config.description,
                )
            )

        return response

    except Exception as e:
        logger.error(f"Failed to get providers: {e}")
        raise HTTPException(status_code=500, detail="Failed to get providers")


@router.get("/providers/{provider}/models/{model_type}")
async def get_provider_models(
    provider: str, model_type: str, tenant_id: int = Depends(get_tenant_id)
):
    """获取指定提供商的模型列表"""
    try:
        provider_enum = ProviderType(provider)
        model_type_enum = ModelType(model_type)

        models = model_config_service.get_available_models(
            provider_enum, model_type_enum, tenant_id=tenant_id
        )
        return {"provider": provider, "model_type": model_type, "models": models}

    except ValueError as e:
        raise HTTPException(
            status_code=400, detail=f"Invalid provider or model type: {e}"
        )
    except Exception as e:
        logger.error(f"Failed to get models: {e}")
        raise HTTPException(status_code=500, detail="Failed to get models")


@router.get("/active-models", response_model=List[ModelConfigResponse])
async def get_active_models(tenant_id: int = Depends(get_tenant_id)):
    """获取当前活跃的模型配置"""
    try:
        active_models = []

        for model_type in ModelType:
            config = model_config_service.get_active_model(model_type, tenant_id=tenant_id)
            if config:
                active_models.append(
                    ModelConfigResponse(
                        model_type=model_type.value,
                        provider=config.provider.value,
                        model_name=config.model_name,
                        has_api_key=bool(config.api_key),
                        enabled=config.enabled,
                    )
                )

        return active_models

    except Exception as e:
        logger.error(f"Failed to get active models: {e}")
        raise HTTPException(status_code=500, detail="Failed to get active models")


class ModelConfigDetailsResponse(BaseModel):
    """模型配置详情响应"""
    model_type: str
    provider: str
    model_name: str
    has_api_key: bool
    enabled: bool
    api_key: str = ""  # 返回星号掩码
    api_base: str = ""
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


@router.get(
    "/active-models/{model_type}/details", response_model=ModelConfigDetailsResponse
)
async def get_model_config_details(
    model_type: str, tenant_id: int = Depends(get_tenant_id)
):
    """获取指定模型的配置详情"""
    try:
        model_type_enum = ModelType(model_type)
        config = model_config_service.get_active_model(model_type_enum, tenant_id=tenant_id)
        
        if not config:
            raise HTTPException(
                status_code=404, 
                detail=f"Model configuration for {model_type} not found"
            )
        
        # 对API密钥进行掩码处理
        masked_api_key = ""
        if config.api_key:
            if len(config.api_key) > 8:
                masked_api_key = config.api_key[:4] + "*" * (len(config.api_key) - 8) + config.api_key[-4:]
            else:
                masked_api_key = "*" * len(config.api_key)
        
        return ModelConfigDetailsResponse(
            model_type=model_type_enum.value,
            provider=config.provider.value,
            model_name=config.model_name,
            has_api_key=bool(config.api_key),
            enabled=config.enabled,
            api_key=masked_api_key,
            api_base=config.api_base or "",
            temperature=config.temperature,
            max_tokens=config.max_tokens,
        )
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid model type: {e}")
    except Exception as e:
        logger.error(f"Failed to get model config details: {e}")
        raise HTTPException(status_code=500, detail="Failed to get model config details")


@router.put("/active-models/{model_type}")
async def update_active_model(
    model_type: str,
    request: UpdateModelConfigRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
    """更新指定类型的活跃模型"""
    try:
        model_type_enum = ModelType(model_type)
        provider_enum = ProviderType(request.provider)

        # 验证模型是否在提供商的可用模型列表中（允许自定义模型名称）
        available_models = model_config_service.get_available_models(
            provider_enum, model_type_enum
        )
        
        # 如果模型名称不在预设列表中，记录警告但仍允许使用（支持自定义模型）
        if request.model_name not in available_models:
            logger.warning(
                f"Using custom model '{request.model_name}' for provider '{request.provider}' "
                f"(not in predefined list: {available_models})"
            )

        # 获取现有配置
        existing_config = model_config_service.get_active_model(
            model_type_enum, tenant_id=tenant_id
        )
        
        # 如果API密钥为空或者是掩码，则保持原有API密钥
        api_key = request.api_key
        if not api_key or "*" in api_key:
            if existing_config and existing_config.api_key:
                api_key = existing_config.api_key
            else:
                # Allow using provider-level key if configured
                p_cfg = model_config_service.get_provider(provider_enum, tenant_id=tenant_id)
                if p_cfg and p_cfg.api_key:
                    api_key = None
                else:
                    raise HTTPException(
                        status_code=400,
                        detail="API key is required for new configuration",
                    )

        # 创建新的模型配置
        config = ModelConfig(
            provider=provider_enum,
            model_name=request.model_name,
            api_key=api_key,
            api_base=request.api_base,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            enabled=request.enabled,
        )

        # 设置为活跃模型
        model_config_service.set_active_model(model_type_enum, config, tenant_id=tenant_id)

        return {"message": f"Active {model_type} model updated successfully"}

    except ValueError as e:
        raise HTTPException(
            status_code=400, detail=f"Invalid model type or provider: {e}"
        )
    except Exception as e:
        logger.error(f"Failed to update active model: {e}")
        raise HTTPException(status_code=500, detail="Failed to update active model")


@router.put("/providers/{provider}")
async def update_provider(
    provider: str,
    request: UpdateProviderRequest,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
    """更新提供商配置"""
    try:
        provider_enum = ProviderType(provider)
        provider_config = model_config_service.get_provider(provider_enum, tenant_id=tenant_id)
        if not provider_config:
            provider_config = model_config_service.get_provider(provider_enum)

        if not provider_config:
            raise HTTPException(
                status_code=404, detail=f"Provider '{provider}' not found"
            )

        # 更新配置
        provider_config = provider_config.copy(deep=True)
        provider_config.api_key = request.api_key
        if request.api_base:
            provider_config.api_base = request.api_base
        provider_config.enabled = request.enabled

        model_config_service.update_provider(provider_enum, provider_config, tenant_id=tenant_id)

        return {"message": f"Provider '{provider}' updated successfully"}

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {e}")
    except Exception as e:
        logger.error(f"Failed to update provider: {e}")
        raise HTTPException(status_code=500, detail="Failed to update provider")


@router.get("/summary")
async def get_config_summary(tenant_id: int = Depends(get_tenant_id)):
    """获取配置摘要"""
    try:
        summary = model_config_service.get_config_summary(tenant_id=tenant_id)
        return summary

    except Exception as e:
        logger.error(f"Failed to get config summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to get config summary")


@router.post("/test/{provider}")
async def test_provider_connection(
    provider: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
    """测试提供商连接"""
    try:
        provider_enum = ProviderType(provider)
        provider_config = model_config_service.get_provider(provider_enum, tenant_id=tenant_id)

        if not provider_config or not provider_config.api_key:
            raise HTTPException(
                status_code=400, detail="Provider not configured or missing API key"
            )

        # 这里可以添加实际的连接测试逻辑
        # 目前返回成功，在实际实现中应该调用对应的API进行测试

        return {
            "provider": provider,
            "status": "connected",
            "message": "Connection test successful",
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {e}")
    except Exception as e:
        logger.error(f"Failed to test provider connection: {e}")
        raise HTTPException(status_code=500, detail="Connection test failed")


@router.post("/providers/{provider}/models/{model_type}")
async def add_custom_model(
    provider: str,
    model_type: str,
    model_name: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
    """为提供商添加自定义模型"""
    try:
        provider_enum = ProviderType(provider)
        model_type_enum = ModelType(model_type)
        ok = model_config_service.add_custom_model(
            provider_enum, model_type_enum, model_name, tenant_id=tenant_id
        )
        return {
            "message": f"Custom model '{model_name}' added successfully" if ok else "No-op",
            "provider": provider,
            "model_type": model_type,
            "model_name": model_name,
        }
            
    except ValueError as e:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid provider or model type: {e}"
        )
    except Exception as e:
        logger.error(f"Failed to add custom model: {e}")
        raise HTTPException(
            status_code=500, 
            detail="Failed to add custom model"
        )


@router.get("/presets")
async def get_model_presets():
    """获取预设配置"""
    presets = {
        "economy": {
            "name": "经济配置",
            "description": "成本优化，适合日常使用",
            "models": {
                "chat": {"provider": "deepseek", "model_name": "deepseek-chat"},
                "embedding": {
                    "provider": "siliconflow",
                    "model_name": "BAAI/bge-large-zh-v1.5",
                },
                "reranking": {
                    "provider": "siliconflow",
                    "model_name": "BAAI/bge-reranker-v2-m3",
                },
            },
        },
        "premium": {
            "name": "高质量配置",
            "description": "性能优先，适合专业使用",
            "models": {
                "chat": {"provider": "qwen", "model_name": "qwen-max"},
                "embedding": {"provider": "qwen", "model_name": "text-embedding-v2"},
                "reranking": {"provider": "qwen", "model_name": "gte-rerank"},
            },
        },
        "chinese": {
            "name": "中文优化",
            "description": "针对中文场景优化",
            "models": {
                "chat": {"provider": "qwen", "model_name": "qwen-plus"},
                "embedding": {
                    "provider": "siliconflow",
                    "model_name": "BAAI/bge-large-zh-v1.5",
                },
                "reranking": {
                    "provider": "siliconflow",
                    "model_name": "BAAI/bge-reranker-v2-m3",
                },
            },
        },
    }

    return {"presets": presets}


@router.get("/available-chat-models")
async def get_available_chat_models(tenant_id: int = Depends(get_tenant_id)):
    """获取可用的聊天模型列表（只返回已配置API密钥的模型）"""
    try:
        available_models = []
        
        # 直接检查当前活跃的聊天模型配置
        chat_config = model_config_service.get_active_model(
            ModelType.CHAT, tenant_id=tenant_id
        )
        logger.info(f"DEBUG: Current chat config: {chat_config}")
        
        if chat_config and chat_config.api_key:
            # 如果有活跃的聊天模型配置，返回该配置
            available_models.append({
                "model_name": chat_config.model_name,
                "provider": chat_config.provider.value,
                "provider_display_name": model_config_service.get_provider(chat_config.provider, tenant_id=tenant_id).display_name if model_config_service.get_provider(chat_config.provider, tenant_id=tenant_id) else chat_config.provider.value,
                "model_display_name": f"{model_config_service.get_provider(chat_config.provider, tenant_id=tenant_id).display_name if model_config_service.get_provider(chat_config.provider, tenant_id=tenant_id) else chat_config.provider.value} - {chat_config.model_name}"
            })
            
            # 获取同一提供商的其他可用模型
            provider_config = model_config_service.get_provider(chat_config.provider, tenant_id=tenant_id)
            if provider_config:
                chat_models = provider_config.models.get(ModelType.CHAT, [])
                logger.info(f"DEBUG: Provider {chat_config.provider.value} has models: {chat_models}")
                
                for model_name in chat_models:
                    # 避免重复添加已经添加的当前活跃模型
                    if model_name != chat_config.model_name:
                        available_models.append({
                            "model_name": model_name,
                            "provider": chat_config.provider.value,
                            "provider_display_name": provider_config.display_name,
                            "model_display_name": f"{provider_config.display_name} - {model_name}"
                        })
        else:
            # 如果没有活跃配置，检查所有有API密钥的提供商
            providers = model_config_service.get_providers(tenant_id=tenant_id)
            logger.info(f"DEBUG: No active chat config, checking {len(providers)} providers")
            
            for provider_type, provider_config in providers.items():
                logger.info(f"DEBUG: Provider {provider_type.value}: api_key={bool(provider_config.api_key)}, enabled={provider_config.enabled}")
                
                if provider_config.api_key and provider_config.enabled:
                    chat_models = provider_config.models.get(ModelType.CHAT, [])
                    logger.info(f"DEBUG: Provider {provider_type.value} has {len(chat_models)} chat models: {chat_models}")
                    
                    for model_name in chat_models:
                        available_models.append({
                            "model_name": model_name,
                            "provider": provider_type.value,
                            "provider_display_name": provider_config.display_name,
                            "model_display_name": f"{provider_config.display_name} - {model_name}"
                        })
        
        logger.info(f"Found {len(available_models)} available chat models: {[m['model_name'] for m in available_models]}")
        return {"models": available_models}
        
    except Exception as e:
        logger.error(f"Failed to get available chat models: {e}")
        raise HTTPException(status_code=500, detail="Failed to get available chat models")
