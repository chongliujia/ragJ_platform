"""
结构化日志配置
使用 structlog 提供结构化日志记录
"""

import logging
import structlog
from structlog.stdlib import LoggerFactory

from app.core.config import settings


def configure_logging():
    """配置结构化日志"""

    # 配置标准库日志级别
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper()), format="%(message)s"
    )

    # 配置 structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
