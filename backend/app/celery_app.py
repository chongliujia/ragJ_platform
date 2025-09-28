"""
Celery application setup.
"""

from celery import Celery
from app.core.config import settings


def create_celery_app() -> Celery:
    app = Celery(
        "ragj_platform",
        broker=settings.CELERY_BROKER_URL,
        backend=settings.CELERY_RESULT_BACKEND,
    )
    # Use JSON serializer to remain compatible; tasks should avoid large binary payloads
    app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="UTC",
        task_track_started=True,
    )
    return app


celery_app = create_celery_app()

