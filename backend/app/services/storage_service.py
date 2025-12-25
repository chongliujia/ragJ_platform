"""
Storage service for local filesystem or S3-compatible backends (e.g., SeaweedFS).
"""

from __future__ import annotations

import io
import os
from typing import Optional
from urllib.parse import urlparse

import logging
import boto3
from botocore.exceptions import ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)


class StorageService:
    """Abstraction over local and S3-compatible object storage."""

    def __init__(self) -> None:
        backend = (settings.STORAGE_BACKEND or "local").strip().lower()
        self.backend = backend
        self._client = None
        self.bucket = self._resolve_bucket()

    def is_object_storage(self) -> bool:
        return self.backend in {"s3", "seaweedfs"}

    def _resolve_bucket(self) -> Optional[str]:
        return settings.S3_BUCKET_NAME or None

    def _resolve_endpoint(self) -> Optional[str]:
        endpoint = settings.S3_ENDPOINT
        if not endpoint:
            return None
        if endpoint.startswith("http://") or endpoint.startswith("https://"):
            parsed = urlparse(endpoint)
            return parsed.netloc
        return endpoint

    def _resolve_secure(self) -> bool:
        if settings.S3_SECURE is not None:
            return bool(settings.S3_SECURE)
        endpoint = settings.S3_ENDPOINT or ""
        if endpoint.startswith("https://"):
            return True
        return False

    def _get_client(self):
        if self._client is not None:
            return self._client
        endpoint = self._resolve_endpoint()
        if not endpoint:
            raise RuntimeError("S3 endpoint not configured")
        access_key = settings.S3_ACCESS_KEY
        secret_key = settings.S3_SECRET_KEY
        if not access_key or not secret_key:
            raise RuntimeError("S3 credentials not configured")
        secure = self._resolve_secure()
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=settings.S3_REGION,
            use_ssl=secure,
        )
        return self._client

    def _ensure_bucket(self) -> None:
        if not self.bucket:
            raise RuntimeError("S3 bucket not configured")
        client = self._get_client()
        try:
            client.head_bucket(Bucket=self.bucket)
        except ClientError as e:
            code = str(e.response.get("Error", {}).get("Code", ""))
            if code not in {"404", "NoSuchBucket", "NotFound"}:
                raise
            try:
                client.create_bucket(Bucket=self.bucket)
            except ClientError as e2:
                code2 = str(e2.response.get("Error", {}).get("Code", ""))
                if code2 not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                    raise

    def upload_file(
        self,
        local_path: str,
        object_key: str,
        content_type: Optional[str] = None,
    ) -> None:
        """Upload a local file to object storage."""
        if not self.is_object_storage():
            return
        self._ensure_bucket()
        client = self._get_client()
        extra = {"ContentType": content_type} if content_type else None
        if extra:
            client.upload_file(local_path, self.bucket, object_key, ExtraArgs=extra)
        else:
            client.upload_file(local_path, self.bucket, object_key)

    def upload_bytes(
        self,
        payload: bytes,
        object_key: str,
        content_type: Optional[str] = None,
    ) -> None:
        """Upload in-memory content to object storage."""
        if not self.is_object_storage():
            return
        self._ensure_bucket()
        client = self._get_client()
        data = io.BytesIO(payload)
        extra = {"ContentType": content_type} if content_type else None
        if extra:
            client.upload_fileobj(data, self.bucket, object_key, ExtraArgs=extra)
        else:
            client.upload_fileobj(data, self.bucket, object_key)

    def read_bytes(self, storage_path: str) -> bytes:
        """Read content from storage."""
        if not storage_path:
            raise FileNotFoundError("storage path is empty")
        if not self.is_object_storage():
            with open(storage_path, "rb") as f:
                return f.read()
        self._ensure_bucket()
        client = self._get_client()
        obj = client.get_object(Bucket=self.bucket, Key=storage_path)
        try:
            return obj["Body"].read()
        finally:
            try:
                obj["Body"].close()
            except Exception:
                pass

    def delete(self, storage_path: str) -> None:
        """Delete a file/object from storage."""
        if not storage_path:
            return
        if not self.is_object_storage():
            if os.path.exists(storage_path):
                os.remove(storage_path)
            return
        self._ensure_bucket()
        client = self._get_client()
        try:
            client.delete_object(Bucket=self.bucket, Key=storage_path)
        except ClientError:
            pass

    def exists(self, storage_path: str) -> bool:
        if not storage_path:
            return False
        if not self.is_object_storage():
            return os.path.exists(storage_path)
        self._ensure_bucket()
        client = self._get_client()
        try:
            client.head_object(Bucket=self.bucket, Key=storage_path)
            return True
        except ClientError:
            return False


storage_service = StorageService()
