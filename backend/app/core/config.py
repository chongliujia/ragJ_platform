"""
应用配置管理（Pydantic v2）
 - 统一处理环境变量与 .env 文件加载（多候选路径）
 - 提供更安全的默认值与便捷的解析工具
"""

from typing import Optional, List
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
import os


class Settings(BaseSettings):
    """应用配置类"""

    # Pydantic v2 配置
    model_config = SettingsConfigDict(case_sensitive=True)

    # 基础配置
    PROJECT_NAME: str = "RAG Platform"
    API_V1_STR: str = "/api/v1"
    # 生产环境必须显式设置，开发环境会在启动时回落到安全的固定值
    SECRET_KEY: Optional[str] = None
    DEBUG: bool = False

    # CORS 白名单（逗号分隔），例如：
    # http://localhost:5173,https://your-domain.com
    ALLOWED_ORIGINS: Optional[str] = None

    # 开发模式配置
    DISABLE_AUTH: bool = False  # 开发模式下可以禁用认证

    # 数据库配置
    DATABASE_URL: str = "sqlite:///./ragj_platform.db"

    # Redis配置
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # 向量数据库配置 - Milvus
    MILVUS_HOST: str = "localhost"
    MILVUS_PORT: int = 19530
    MILVUS_USER: Optional[str] = None
    MILVUS_PASSWORD: Optional[str] = None
    MILVUS_DATABASE: str = "ragj_platform"

    # 备用Qdrant配置
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: Optional[str] = None

    # Elasticsearch配置
    ELASTICSEARCH_HOSTS: list[str] = ["http://localhost:9200"]
    ENABLE_ELASTICSEARCH: bool = False

    # 对象存储配置
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET_NAME: str = "ragj-documents"
    MINIO_SECURE: bool = False

    # LLM配置
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    ANTHROPIC_API_KEY: Optional[str] = None

    # DeepSeek配置
    DEEPSEEK_API_KEY: Optional[str] = None
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_CHAT_MODEL: str = "deepseek-chat"

    # 通义千问配置
    DASHSCOPE_API_KEY: Optional[str] = None
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v2"
    QWEN_RERANK_MODEL: str = "gte-rerank"
    QWEN_CHAT_MODEL: str = "qwen-turbo"

    # 硅基流动配置
    SILICONFLOW_API_KEY: Optional[str] = None
    SILICONFLOW_BASE_URL: str = "https://api.siliconflow.cn/v1"

    # 模型服务配置 - 分别指定不同功能使用的服务
    # 聊天模型配置（将使用模型配置文件中的设置）
    CHAT_MODEL_PROVIDER: str = "deepseek"  # deepseek, qwen, openai
    CHAT_MODEL_NAME: str = "deepseek-chat"

    # Embedding模型配置（将使用模型配置文件中的设置）
    EMBEDDING_MODEL_PROVIDER: str = "siliconflow"  # openai, qwen, deepseek, siliconflow
    EMBEDDING_MODEL_NAME: str = "BAAI/bge-m3"

    # Rerank模型配置
    RERANK_MODEL_PROVIDER: str = "qwen"  # qwen, cohere, jina
    RERANK_MODEL_NAME: str = "gte-rerank"

    # Hugging Face配置
    HUGGINGFACE_API_KEY: Optional[str] = None
    LOCAL_MODEL_ENDPOINT: Optional[str] = None

    # JWT配置
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24小时

    # Rust服务配置
    RUST_DOCUMENT_PROCESSOR_URL: str = "http://localhost:8001"
    RUST_VECTOR_STORE_URL: str = "http://localhost:8002"

    # 文档处理配置
    MAX_FILE_SIZE: int = 104857600  # 100MB
    SUPPORTED_FILE_TYPES: str = "pdf,docx,txt,md,html"  # 改为字符串类型
    CHUNK_SIZE: int = 1000
    CHUNK_OVERLAP: int = 200

    # 嵌入模型配置
    DEFAULT_EMBEDDING_MODEL: str = "BAAI/bge-m3"  # BGE-M3嵌入模型
    EMBEDDING_DIMENSION: int = 1024  # BGE-M3的维度
    DEFAULT_RERANK_MODEL: str = "gte-rerank"  # 通义千问重排序模型

    # LangGraph配置
    LANGGRAPH_STATE_BACKEND: str = "redis"
    LANGGRAPH_CHECKPOINT_NAMESPACE: str = "ragj_platform"

    # 日志配置
    LOG_LEVEL: str = "INFO"

    def get_supported_file_types(self) -> List[str]:
        """Get supported file types as a list"""
        return [ext.strip() for ext in self.SUPPORTED_FILE_TYPES.split(",")]

    def get_allowed_origins(self) -> List[str]:
        """解析 CORS 允许的来源列表（支持逗号分隔或空）"""
        if not self.ALLOWED_ORIGINS:
            return []
        # 支持逗号分隔，去除空白
        parts = [p.strip() for p in self.ALLOWED_ORIGINS.split(",")]
        return [p for p in parts if p]


def _detect_env_files() -> List[Path]:
    """按优先级寻找可能的 .env 文件路径。

    优先级：
    1. backend/.env
    2. 项目根目录 /.env
    3. backend/.env.dev（仅作为兜底）
    """
    here = Path(__file__).resolve()
    backend_dir = here.parents[2]  # backend/
    project_root = here.parents[3]  # 仓库根目录

    candidates = [
        backend_dir / ".env",
        project_root / ".env",
        backend_dir / ".env.dev",
    ]
    return [p for p in candidates if p.exists()]


# 全局配置实例（支持多候选 .env）
_env_files = _detect_env_files()
settings = Settings(_env_file=_env_files or None)
