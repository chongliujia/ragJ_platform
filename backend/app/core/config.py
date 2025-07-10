"""
应用配置管理
使用 Pydantic Settings 管理环境变量配置
"""

from typing import Optional, List
from pydantic_settings import BaseSettings
from pydantic import validator
import secrets


class Settings(BaseSettings):
    """应用配置类"""

    # 基础配置
    PROJECT_NAME: str = "RAG Platform"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    DEBUG: bool = False

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
    DEEPSEEK_API_KEY: Optional[str] = "sk-5cf6176d48e248e9a58cebd792196add"
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

    class Config:
        env_file = "../../../.env"  # 指向项目根目录的.env文件
        case_sensitive = True


# 全局配置实例
settings = Settings()
