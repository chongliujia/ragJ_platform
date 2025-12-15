"""
Per-user model/provider configuration service.

By default, normal users operate on their own model keys/configs.
Optionally, callers can allow fallback to tenant-shared configs (e.g. when user has permission).
"""

import logging
from typing import Dict, Optional, List

from app.db.database import SessionLocal
from app.db.models.user_model_config import UserProviderConfig, UserModelConfig
from app.services.model_config_service import (
    model_config_service,
    ProviderType,
    ProviderConfig,
    ModelType,
    ModelConfig,
)

logger = logging.getLogger(__name__)


class UserModelConfigService:
    def get_providers(self, user_id: int) -> Dict[ProviderType, ProviderConfig]:
        """Get provider configs with user overrides applied."""
        base = model_config_service.get_providers(tenant_id=None)
        db = SessionLocal()
        try:
            rows = (
                db.query(UserProviderConfig)
                .filter(UserProviderConfig.user_id == user_id)
                .all()
            )
            overrides = {r.provider: r for r in rows}

            result: Dict[ProviderType, ProviderConfig] = {}
            for p_type, p_cfg in base.items():
                cfg = p_cfg.copy(deep=True)
                ov = overrides.get(p_type.value)
                if ov:
                    if ov.api_key is not None:
                        cfg.api_key = ov.api_key
                    if ov.api_base:
                        cfg.api_base = ov.api_base
                    cfg.enabled = bool(ov.enabled)
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

    def get_provider(self, provider: ProviderType, user_id: int) -> Optional[ProviderConfig]:
        providers = self.get_providers(user_id=user_id)
        return providers.get(provider)

    def update_provider(self, provider: ProviderType, config: ProviderConfig, user_id: int) -> None:
        """Persist provider API key/base/enabled for user."""
        db = SessionLocal()
        try:
            row = (
                db.query(UserProviderConfig)
                .filter(
                    UserProviderConfig.user_id == user_id,
                    UserProviderConfig.provider == provider.value,
                )
                .first()
            )
            if row is None:
                row = UserProviderConfig(user_id=user_id, provider=provider.value, custom_models={})
                db.add(row)
            row.api_key = config.api_key
            row.api_base = config.api_base
            row.enabled = bool(config.enabled)
            db.commit()
        finally:
            db.close()

    def add_custom_model(self, provider: ProviderType, model_type: ModelType, model_name: str, user_id: int) -> bool:
        """Add a custom model name to user's provider config list."""
        db = SessionLocal()
        try:
            row = (
                db.query(UserProviderConfig)
                .filter(
                    UserProviderConfig.user_id == user_id,
                    UserProviderConfig.provider == provider.value,
                )
                .first()
            )
            if row is None:
                row = UserProviderConfig(user_id=user_id, provider=provider.value, custom_models={})
                db.add(row)
                db.flush()
            cm = dict(row.custom_models or {})
            key = model_type.value
            existing = list(cm.get(key) or [])
            if model_name not in existing:
                existing.append(model_name)
            cm[key] = existing
            row.custom_models = cm
            db.commit()
            return True
        finally:
            db.close()

    def get_active_model(
        self,
        model_type: ModelType,
        user_id: int,
        *,
        tenant_id: Optional[int] = None,
        allow_tenant_fallback: bool = False,
    ) -> Optional[ModelConfig]:
        """Get active model config for user; optionally fallback to tenant-shared config."""
        db = SessionLocal()
        try:
            row = (
                db.query(UserModelConfig)
                .filter(
                    UserModelConfig.user_id == user_id,
                    UserModelConfig.model_type == model_type.value,
                )
                .first()
            )
            if row is None:
                if allow_tenant_fallback and tenant_id is not None:
                    return model_config_service.get_active_model(model_type, tenant_id=tenant_id)
                return None

            try:
                provider_enum = ProviderType(row.provider)
            except Exception:
                provider_enum = ProviderType.DEEPSEEK

            p_cfg = self.get_provider(provider_enum, user_id=user_id)
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

    def set_active_model(self, model_type: ModelType, config: ModelConfig, user_id: int) -> None:
        """Persist active model config for user."""
        db = SessionLocal()
        try:
            row = (
                db.query(UserModelConfig)
                .filter(
                    UserModelConfig.user_id == user_id,
                    UserModelConfig.model_type == model_type.value,
                )
                .first()
            )
            if row is None:
                row = UserModelConfig(user_id=user_id, model_type=model_type.value)
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


user_model_config_service = UserModelConfigService()

