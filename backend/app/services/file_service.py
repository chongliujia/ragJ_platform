"""
文件服务
处理文件上传、验证和存储
"""

import os
import uuid
import aiofiles
from typing import Optional
from fastapi import UploadFile
import structlog

from app.schemas.chat import FileUploadResponse
from app.core.config import settings

logger = structlog.get_logger(__name__)


class FileService:
    """文件服务类"""

    def __init__(self):
        """初始化文件服务"""
        # 创建上传目录
        self.upload_dir = "uploads"
        os.makedirs(self.upload_dir, exist_ok=True)

    async def validate_file(self, file: UploadFile) -> bool:
        """验证文件类型和大小"""
        try:
            # 检查文件大小
            if file.size and file.size > settings.MAX_FILE_SIZE:
                logger.warning("文件过大", filename=file.filename, size=file.size)
                return False

            # 检查文件类型
            if file.filename:
                file_ext = file.filename.split(".")[-1].lower()
                supported_types = settings.get_supported_file_types()
                if file_ext not in supported_types:
                    logger.warning(
                        "不支持的文件类型", filename=file.filename, ext=file_ext
                    )
                    return False

            return True

        except Exception as e:
            logger.error("文件验证失败", error=str(e))
            return False

    async def upload_file(
        self,
        file: UploadFile,
        knowledge_base_id: Optional[str] = None,
        chat_id: Optional[str] = None,
    ) -> FileUploadResponse:
        """上传文件"""
        try:
            # 生成文件ID和保存路径
            file_id = f"file_{uuid.uuid4().hex[:12]}"
            file_ext = file.filename.split(".")[-1].lower() if file.filename else "txt"
            saved_filename = f"{file_id}.{file_ext}"
            file_path = os.path.join(self.upload_dir, saved_filename)

            # 保存文件
            async with aiofiles.open(file_path, "wb") as f:
                content = await file.read()
                await f.write(content)
                file_size = len(content)

            logger.info(
                "文件上传成功",
                file_id=file_id,
                filename=file.filename,
                size=file_size,
                path=file_path,
            )

            # 如果指定了知识库，这里可以触发文档处理任务
            if knowledge_base_id:
                logger.info(
                    "将文件添加到知识库",
                    file_id=file_id,
                    knowledge_base_id=knowledge_base_id,
                )
                # TODO: 触发文档处理任务

            return FileUploadResponse(
                file_id=file_id,
                filename=file.filename or "unknown",
                file_size=file_size,
                file_type=file_ext,
                knowledge_base_id=knowledge_base_id,
                status="uploaded",
            )

        except Exception as e:
            logger.error("文件上传失败", error=str(e))
            raise

    async def get_file_info(self, file_id: str) -> Optional[dict]:
        """获取文件信息"""
        # 这里是简化版本，实际应该从数据库查询
        file_path = None
        for filename in os.listdir(self.upload_dir):
            if filename.startswith(file_id):
                file_path = os.path.join(self.upload_dir, filename)
                break

        if file_path and os.path.exists(file_path):
            stat = os.stat(file_path)
            return {
                "file_id": file_id,
                "filename": filename,
                "file_size": stat.st_size,
                "upload_time": stat.st_ctime,
                "file_path": file_path,
            }

        return None

    async def delete_file(self, file_id: str) -> bool:
        """删除文件"""
        try:
            for filename in os.listdir(self.upload_dir):
                if filename.startswith(file_id):
                    file_path = os.path.join(self.upload_dir, filename)
                    os.remove(file_path)
                    logger.info("文件删除成功", file_id=file_id)
                    return True

            logger.warning("文件不存在", file_id=file_id)
            return False

        except Exception as e:
            logger.error("文件删除失败", error=str(e))
            return False
