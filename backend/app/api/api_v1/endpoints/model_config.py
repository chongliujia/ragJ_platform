"""
模型配置管理API端点
"""

import logging
import httpx
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services.model_config_service import (
    model_config_service,
    ModelConfig,
    ProviderConfig,
    ModelType,
    ProviderType,
)
from app.core.dependencies import get_tenant_id, require_tenant_admin, get_current_user, optional_permission
from app.db.database import get_db
from app.db.models.user import User
from app.db.models.tenant import Tenant
from app.db.models.permission import PermissionType
from app.services.user_model_config_service import user_model_config_service

router = APIRouter()
logger = logging.getLogger(__name__)

ADMIN_ROLES = {"super_admin", "tenant_admin"}


def _tenant_shared_model_policy(db: Session, tenant_id: int) -> tuple[bool, set[int]]:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    settings = tenant.settings if tenant and isinstance(tenant.settings, dict) else {}
    allow_shared = bool((settings or {}).get("allow_shared_models", False))
    raw_ids = (settings or {}).get("shared_model_user_ids") or []
    ids: set[int] = set()
    for x in raw_ids:
        try:
            ids.add(int(x))
        except Exception:
            continue
    return allow_shared, ids


def _effective_allow_shared_models(
    db: Session,
    tenant_id: int,
    current_user: User,
    allow_shared_permission: bool,
) -> bool:
    if getattr(current_user, "role", None) in ADMIN_ROLES:
        return True
    allow_shared, allowlist = _tenant_shared_model_policy(db, tenant_id)
    if not allow_shared:
        return False
    return bool(allow_shared_permission) or (current_user.id in allowlist)


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
    requires_api_key: bool
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

    api_key: str = ""  # 允许为空，保持现有密钥
    api_base: str = None
    enabled: bool = True


@router.get("/providers", response_model=List[ProviderConfigResponse])
async def get_providers(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
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
                    requires_api_key=bool(getattr(provider_config, "requires_api_key", True)),
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
    provider: str,
    model_type: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
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
async def get_active_models(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
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
    model_type: str,
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
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
            provider_enum, model_type_enum, tenant_id=tenant_id
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
        
        # 如果API密钥为空或者是掩码：
        # - 若仍为同一 provider，则保持原有 model-level key
        # - 否则尝试使用 provider-level key；若也没有则要求用户输入
        api_key = request.api_key
        if isinstance(api_key, str):
            api_key = api_key.strip()
        if not api_key or "*" in api_key:
            if (
                existing_config
                and existing_config.api_key
                and existing_config.provider == provider_enum
            ):
                api_key = existing_config.api_key
            else:
                p_cfg = model_config_service.get_provider(provider_enum, tenant_id=tenant_id)
                requires_key = bool(getattr(p_cfg, "requires_api_key", True)) if p_cfg else True
                if p_cfg and (p_cfg.api_key or not requires_key):
                    api_key = None
                else:
                    raise HTTPException(
                        status_code=400,
                        detail="API key is required for new configuration",
                    )
        if isinstance(api_key, str):
            api_key = api_key.strip()
            if not api_key:
                api_key = None

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
        api_key = request.api_key
        if isinstance(api_key, str):
            api_key = api_key.strip()
        if not api_key or "*" in api_key:
            api_key = provider_config.api_key
        if not api_key and bool(getattr(provider_config, "requires_api_key", True)):
            raise HTTPException(status_code=400, detail="API key is required")
        provider_config.api_key = api_key
        if request.api_base:
            api_base = request.api_base.strip()
            # Normalize OpenAI-compatible base URL: ensure it ends with /v1
            if provider_enum in (ProviderType.LOCAL, ProviderType.OPENAI, ProviderType.SILICONFLOW, ProviderType.DEEPSEEK):
                api_base = api_base.rstrip("/")
                if api_base and not api_base.endswith("/v1"):
                    api_base = api_base + "/v1"
            provider_config.api_base = api_base
        provider_config.enabled = request.enabled

        model_config_service.update_provider(provider_enum, provider_config, tenant_id=tenant_id)

        return {"message": f"Provider '{provider}' updated successfully"}

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {e}")
    except Exception as e:
        logger.error(f"Failed to update provider: {e}")
        raise HTTPException(status_code=500, detail="Failed to update provider")


@router.get("/summary")
async def get_config_summary(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
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

        if not provider_config:
            raise HTTPException(
                status_code=400, detail="Provider not configured"
            )
        if not provider_config.enabled:
            raise HTTPException(status_code=400, detail="Provider is disabled")
        requires_key = bool(getattr(provider_config, "requires_api_key", True))
        if requires_key and not provider_config.api_key:
            raise HTTPException(status_code=400, detail="Provider missing API key")

        # Choose a lightweight test per provider.
        # NOTE: This runs from backend container; ensure it has outbound network access.
        chat_models = (provider_config.models or {}).get(ModelType.CHAT, []) or []
        probe_chat_model = chat_models[0] if chat_models else None

        if provider_enum in {ProviderType.OPENAI, ProviderType.SILICONFLOW, ProviderType.LOCAL}:
            base = (provider_config.api_base or "").rstrip("/")
            url = f"{base}/models" if base else ""
            if not url:
                raise HTTPException(status_code=400, detail="Provider api_base not configured")
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    url,
                    headers=(
                        {"Authorization": f"Bearer {provider_config.api_key}"}
                        if provider_config.api_key
                        else {}
                    ),
                )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=400,
                    detail=f"Provider test failed ({resp.status_code}): {resp.text}",
                )
            return {"provider": provider, "status": "connected", "message": "Connection test successful"}

        if provider_enum == ProviderType.DEEPSEEK:
            base = (provider_config.api_base or "").rstrip("/")
            if not base:
                raise HTTPException(status_code=400, detail="Provider api_base not configured")
            model_name = probe_chat_model or "deepseek-chat"
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{base}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {provider_config.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model_name,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5,
                    },
                )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=400,
                    detail=f"Provider test failed ({resp.status_code}): {resp.text}",
                )
            return {"provider": provider, "status": "connected", "message": "Connection test successful"}

        if provider_enum == ProviderType.QWEN:
            # DashScope native API via QwenAPIService
            from app.services.llm_service import QwenAPIService

            svc = QwenAPIService()
            svc.api_key = provider_config.api_key
            if provider_config.api_base:
                svc.base_url = provider_config.api_base
            if probe_chat_model:
                svc.model = probe_chat_model
            result = await svc.test_connection()
            if not result.get("success"):
                raise HTTPException(status_code=400, detail=str(result))
            return {"provider": provider, "status": "connected", "message": "Connection test successful"}

        raise HTTPException(status_code=501, detail=f"Provider '{provider}' test not implemented")

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
async def get_available_chat_models(
    tenant_id: int = Depends(get_tenant_id),
    current_user: User = Depends(require_tenant_admin()),
):
    """获取可用的聊天模型列表（返回已可用的提供商/模型；本地提供商可无密钥）。"""
    try:
        available_models = []
        
        # 直接检查当前活跃的聊天模型配置
        chat_config = model_config_service.get_active_model(
            ModelType.CHAT, tenant_id=tenant_id
        )
        logger.info(f"DEBUG: Current chat config: {chat_config}")
        
        if chat_config:
            provider_config = model_config_service.get_provider(
                chat_config.provider, tenant_id=tenant_id
            )
            provider_display_name = (
                provider_config.display_name
                if provider_config is not None
                else chat_config.provider.value
            )
            requires_key = bool(getattr(provider_config, "requires_api_key", True))
            has_effective_key = bool(chat_config.api_key) or bool(
                provider_config.api_key if provider_config is not None else False
            ) or (not requires_key)

            # 如果活跃配置可用，返回该配置
            if has_effective_key and (provider_config is None or provider_config.enabled):
                available_models.append({
                    "model_name": chat_config.model_name,
                    "provider": chat_config.provider.value,
                    "provider_display_name": provider_display_name,
                    "model_display_name": f"{provider_display_name} - {chat_config.model_name}"
                })

            # 额外返回同一提供商的其他可用 chat 模型（若提供商可用）
            if provider_config and provider_config.enabled and (provider_config.api_key or not requires_key):
                chat_models = provider_config.models.get(ModelType.CHAT, [])
                logger.info(f"DEBUG: Provider {chat_config.provider.value} has models: {chat_models}")
                for model_name in chat_models:
                    if model_name != chat_config.model_name:
                        available_models.append({
                            "model_name": model_name,
                            "provider": chat_config.provider.value,
                            "provider_display_name": provider_display_name,
                            "model_display_name": f"{provider_display_name} - {model_name}"
                        })
        else:
            provider_config = None

        if not available_models:
            # 如果没有可用的活跃配置，检查所有可用的提供商（有 key 或不需要 key）
            providers = model_config_service.get_providers(tenant_id=tenant_id)
            logger.info(f"DEBUG: No active chat config, checking {len(providers)} providers")
            
            for provider_type, p_cfg in providers.items():
                requires_key = bool(getattr(p_cfg, "requires_api_key", True))
                logger.info(
                    f"DEBUG: Provider {provider_type.value}: requires_key={requires_key}, api_key={bool(p_cfg.api_key)}, enabled={p_cfg.enabled}"
                )
                
                if not p_cfg.enabled:
                    continue
                if requires_key and not p_cfg.api_key:
                    continue

                chat_models = p_cfg.models.get(ModelType.CHAT, [])
                logger.info(f"DEBUG: Provider {provider_type.value} has {len(chat_models)} chat models: {chat_models}")
                for model_name in chat_models:
                    available_models.append({
                        "model_name": model_name,
                        "provider": provider_type.value,
                        "provider_display_name": p_cfg.display_name,
                        "model_display_name": f"{p_cfg.display_name} - {model_name}"
                    })

        logger.info(f"Found {len(available_models)} available chat models: {[m['model_name'] for m in available_models]}")
        return {"models": available_models}
        
    except Exception as e:
        logger.error(f"Failed to get available chat models: {e}")
        raise HTTPException(status_code=500, detail="Failed to get available chat models")


# ==================== Per-user ("me") model config ====================


@router.get("/me/providers", response_model=List[ProviderConfigResponse])
async def get_my_providers(current_user: User = Depends(get_current_user)):
    """获取当前用户的提供商配置（个人配置）。"""
    providers = user_model_config_service.get_providers(user_id=current_user.id)
    response = []
    for provider_type, provider_config in providers.items():
        response.append(
            ProviderConfigResponse(
                provider=provider_type.value,
                display_name=provider_config.display_name,
                api_base=provider_config.api_base,
                has_api_key=bool(provider_config.api_key),
                requires_api_key=bool(getattr(provider_config, "requires_api_key", True)),
                enabled=provider_config.enabled,
                available_models={
                    model_type.value: models
                    for model_type, models in provider_config.models.items()
                },
                description=provider_config.description,
            )
        )
    return response


@router.get("/me/providers/{provider}/models/{model_type}")
async def get_my_provider_models(
    provider: str,
    model_type: str,
    current_user: User = Depends(get_current_user),
):
    """获取当前用户（个人配置）的指定提供商模型列表（含个人自定义模型）。"""
    provider_enum = ProviderType(provider)
    model_type_enum = ModelType(model_type)
    p_cfg = user_model_config_service.get_provider(provider_enum, user_id=current_user.id)
    if not p_cfg:
        raise HTTPException(status_code=404, detail="Provider not found")
    models = (p_cfg.models or {}).get(model_type_enum, []) or []
    return {"provider": provider, "model_type": model_type, "models": models}


@router.put("/me/providers/{provider}")
async def update_my_provider(
    provider: str,
    request: UpdateProviderRequest,
    current_user: User = Depends(get_current_user),
):
    """更新当前用户的提供商配置（个人 Key/Base/启用状态）。"""
    provider_enum = ProviderType(provider)
    provider_config = user_model_config_service.get_provider(provider_enum, user_id=current_user.id)
    if not provider_config:
        provider_config = model_config_service.get_provider(provider_enum)
    if not provider_config:
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' not found")

    provider_config = provider_config.copy(deep=True)
    api_key = request.api_key
    if isinstance(api_key, str):
        api_key = api_key.strip()
    if not api_key or "*" in api_key:
        api_key = provider_config.api_key
    if not api_key and bool(getattr(provider_config, "requires_api_key", True)):
        raise HTTPException(status_code=400, detail="API key is required")
    provider_config.api_key = api_key
    if request.api_base:
        api_base = request.api_base.strip().rstrip("/")
        if api_base and not api_base.endswith("/v1") and provider_enum in (
            ProviderType.LOCAL,
            ProviderType.OPENAI,
            ProviderType.SILICONFLOW,
            ProviderType.DEEPSEEK,
        ):
            api_base = api_base + "/v1"
        provider_config.api_base = api_base
    if request.enabled is not None:
        provider_config.enabled = bool(request.enabled)

    user_model_config_service.update_provider(provider_enum, provider_config, user_id=current_user.id)
    return {"message": f"Provider '{provider}' updated successfully"}


@router.post("/me/test/{provider}")
async def test_my_provider_connection(
    provider: str,
    tenant_id: int = Depends(get_tenant_id),
    allow_shared: bool = Depends(optional_permission(PermissionType.MODEL_USE_SHARED.value)),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """测试当前用户的提供商连接（个人配置；有权限时可回退租户共享）。"""
    provider_enum = ProviderType(provider)

    allow_fallback = _effective_allow_shared_models(db, tenant_id, current_user, bool(allow_shared))

    # Prefer user provider config; optionally fallback to tenant-shared provider config.
    provider_config = user_model_config_service.get_provider(provider_enum, user_id=current_user.id)
    if provider_config is None and allow_fallback:
        provider_config = model_config_service.get_provider(provider_enum, tenant_id=tenant_id)
    if provider_config is None:
        provider_config = model_config_service.get_provider(provider_enum)

    if not provider_config:
        raise HTTPException(status_code=400, detail="Provider not configured")
    if not provider_config.enabled:
        raise HTTPException(status_code=400, detail="Provider is disabled")
    requires_key = bool(getattr(provider_config, "requires_api_key", True))
    if requires_key and not provider_config.api_key:
        raise HTTPException(status_code=400, detail="Provider missing API key")

    # Mirror the tenant-admin test logic using the effective provider config.
    chat_models = (provider_config.models or {}).get(ModelType.CHAT, []) or []
    probe_chat_model = chat_models[0] if chat_models else None

    if provider_enum in {ProviderType.OPENAI, ProviderType.SILICONFLOW, ProviderType.LOCAL}:
        base = (provider_config.api_base or "").rstrip("/")
        url = f"{base}/models" if base else ""
        if not url:
            raise HTTPException(status_code=400, detail="Provider api_base not configured")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                url,
                headers=(
                    {"Authorization": f"Bearer {provider_config.api_key}"}
                    if provider_config.api_key
                    else {}
                ),
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Provider test failed ({resp.status_code}): {resp.text}",
            )
        return {"provider": provider, "status": "connected", "message": "Connection test successful"}

    if provider_enum == ProviderType.DEEPSEEK:
        base = (provider_config.api_base or "").rstrip("/")
        if not base:
            raise HTTPException(status_code=400, detail="Provider api_base not configured")
        model_name = probe_chat_model or "deepseek-chat"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {provider_config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_name,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                },
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Provider test failed ({resp.status_code}): {resp.text}",
            )
        return {"provider": provider, "status": "connected", "message": "Connection test successful"}

    if provider_enum == ProviderType.QWEN:
        # DashScope native API via QwenAPIService
        from app.services.llm_service import QwenAPIService

        svc = QwenAPIService()
        svc.api_key = provider_config.api_key
        if provider_config.api_base:
            svc.base_url = provider_config.api_base
        if probe_chat_model:
            svc.model = probe_chat_model
        result = await svc.test_connection()
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=str(result))
        return {"provider": provider, "status": "connected", "message": "Connection test successful"}

    if provider_enum == ProviderType.COHERE:
        base = (provider_config.api_base or "https://api.cohere.ai/v1").rstrip("/")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{base}/models",
                headers={"Authorization": f"Bearer {provider_config.api_key}"},
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Provider test failed ({resp.status_code}): {resp.text}",
            )
        return {"provider": provider, "status": "connected", "message": "Connection test successful"}

    raise HTTPException(status_code=501, detail=f"Provider '{provider}' test not implemented")


@router.get("/me/active-models", response_model=List[ModelConfigResponse])
async def get_my_active_models(
    tenant_id: int = Depends(get_tenant_id),
    allow_shared: bool = Depends(optional_permission(PermissionType.MODEL_USE_SHARED.value)),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户的活跃模型配置（默认个人；有权限时可回退租户共享）。"""
    allow_fallback = _effective_allow_shared_models(db, tenant_id, current_user, bool(allow_shared))
    active_models: list[ModelConfigResponse] = []
    for model_type in ModelType:
        cfg = user_model_config_service.get_active_model(
            model_type,
            user_id=current_user.id,
            tenant_id=tenant_id,
            allow_tenant_fallback=allow_fallback,
        )
        if cfg:
            active_models.append(
                ModelConfigResponse(
                    model_type=model_type.value,
                    provider=cfg.provider.value,
                    model_name=cfg.model_name,
                    has_api_key=bool(cfg.api_key),
                    enabled=cfg.enabled,
                )
            )
    return active_models


@router.get("/me/active-models/{model_type}/details", response_model=ModelConfigDetailsResponse)
async def get_my_model_config_details(
    model_type: str,
    tenant_id: int = Depends(get_tenant_id),
    allow_shared: bool = Depends(optional_permission(PermissionType.MODEL_USE_SHARED.value)),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户指定模型的配置详情（api_key 始终掩码返回）。"""
    model_type_enum = ModelType(model_type)
    allow_fallback = _effective_allow_shared_models(db, tenant_id, current_user, bool(allow_shared))
    cfg = user_model_config_service.get_active_model(
        model_type_enum,
        user_id=current_user.id,
        tenant_id=tenant_id,
        allow_tenant_fallback=allow_fallback,
    )
    if not cfg:
        raise HTTPException(status_code=404, detail="Model configuration not found")

    masked_api_key = ""
    if cfg.api_key:
        if len(cfg.api_key) > 8:
            masked_api_key = cfg.api_key[:4] + "*" * (len(cfg.api_key) - 8) + cfg.api_key[-4:]
        else:
            masked_api_key = "*" * len(cfg.api_key)

    return ModelConfigDetailsResponse(
        model_type=model_type_enum.value,
        provider=cfg.provider.value,
        model_name=cfg.model_name,
        has_api_key=bool(cfg.api_key),
        enabled=cfg.enabled,
        api_key=masked_api_key,
        api_base=cfg.api_base or "",
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
    )


@router.put("/me/active-models/{model_type}")
async def update_my_active_model(
    model_type: str,
    request: UpdateModelConfigRequest,
    current_user: User = Depends(get_current_user),
):
    """更新当前用户指定类型的活跃模型（个人配置）。"""
    model_type_enum = ModelType(model_type)
    provider_enum = ProviderType(request.provider)

    available_models = []
    try:
        p_cfg = user_model_config_service.get_provider(provider_enum, user_id=current_user.id)
        if p_cfg:
            available_models = p_cfg.models.get(model_type_enum, []) or []
    except Exception:
        available_models = []

    if request.model_name not in available_models:
        logger.warning(
            f"Using custom model '{request.model_name}' for provider '{request.provider}' "
            f"(not in predefined list)"
        )

    existing_config = user_model_config_service.get_active_model(
        model_type_enum, user_id=current_user.id, allow_tenant_fallback=False
    )

    api_key = request.api_key
    if isinstance(api_key, str):
        api_key = api_key.strip()
    if not api_key or "*" in api_key:
        if existing_config and existing_config.api_key and existing_config.provider == provider_enum:
            api_key = existing_config.api_key
        else:
            p_cfg = user_model_config_service.get_provider(provider_enum, user_id=current_user.id)
            requires_key = bool(getattr(p_cfg, "requires_api_key", True)) if p_cfg else True
            if p_cfg and (p_cfg.api_key or not requires_key):
                api_key = None
            else:
                raise HTTPException(status_code=400, detail="API key is required for new configuration")
    if isinstance(api_key, str):
        api_key = api_key.strip() or None

    cfg = ModelConfig(
        provider=provider_enum,
        model_name=request.model_name,
        api_key=api_key,
        api_base=request.api_base,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
        enabled=request.enabled,
    )
    user_model_config_service.set_active_model(model_type_enum, cfg, user_id=current_user.id)
    return {"message": f"Active {model_type} model updated successfully"}


@router.post("/me/providers/{provider}/models/{model_type}")
async def add_my_custom_model(
    provider: str,
    model_type: str,
    model_name: str,
    current_user: User = Depends(get_current_user),
):
    """为当前用户的提供商添加自定义模型名称。"""
    provider_enum = ProviderType(provider)
    model_type_enum = ModelType(model_type)
    ok = user_model_config_service.add_custom_model(provider_enum, model_type_enum, model_name, user_id=current_user.id)
    return {"message": "No-op" if not ok else "Custom model added", "provider": provider, "model_type": model_type, "model_name": model_name}


@router.get("/me/available-chat-models")
async def get_my_available_chat_models(
    tenant_id: int = Depends(get_tenant_id),
    allow_shared: bool = Depends(optional_permission(PermissionType.MODEL_USE_SHARED.value)),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户可用的聊天模型列表（个人；有权限时可回退租户共享，不返回明文 key）。"""
    available_models: list[dict] = []

    allow_fallback = _effective_allow_shared_models(db, tenant_id, current_user, bool(allow_shared))
    chat_cfg = user_model_config_service.get_active_model(
        ModelType.CHAT,
        user_id=current_user.id,
        tenant_id=tenant_id,
        allow_tenant_fallback=allow_fallback,
    )
    if chat_cfg:
        provider_cfg = user_model_config_service.get_provider(chat_cfg.provider, user_id=current_user.id)
        # If this config is a tenant fallback, provider_cfg may not carry tenant key; use cfg.api_key as indicator.
        provider_display_name = (
            provider_cfg.display_name if provider_cfg is not None else chat_cfg.provider.value
        )
        requires_key = bool(getattr(provider_cfg, "requires_api_key", True)) if provider_cfg else True
        has_effective_key = bool(chat_cfg.api_key) or (provider_cfg and bool(provider_cfg.api_key)) or (not requires_key)
        if has_effective_key and (provider_cfg is None or provider_cfg.enabled):
            available_models.append(
                {
                    "model_name": chat_cfg.model_name,
                    "provider": chat_cfg.provider.value,
                    "provider_display_name": provider_display_name,
                    "model_display_name": f"{provider_display_name} - {chat_cfg.model_name}",
                }
            )
        if provider_cfg and provider_cfg.enabled and (provider_cfg.api_key or not requires_key):
            for m in (provider_cfg.models.get(ModelType.CHAT, []) or []):
                if m != chat_cfg.model_name:
                    available_models.append(
                        {
                            "model_name": m,
                            "provider": chat_cfg.provider.value,
                            "provider_display_name": provider_display_name,
                            "model_display_name": f"{provider_display_name} - {m}",
                        }
                    )

    if not available_models:
        providers = user_model_config_service.get_providers(user_id=current_user.id)
        for p_type, p_cfg in providers.items():
            if not p_cfg.enabled:
                continue
            requires_key = bool(getattr(p_cfg, "requires_api_key", True))
            if requires_key and not p_cfg.api_key:
                continue
            for m in (p_cfg.models.get(ModelType.CHAT, []) or []):
                available_models.append(
                    {
                        "model_name": m,
                        "provider": p_type.value,
                        "provider_display_name": p_cfg.display_name,
                        "model_display_name": f"{p_cfg.display_name} - {m}",
                    }
                )

    return {"models": available_models}
