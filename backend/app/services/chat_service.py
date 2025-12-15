"""
Chat Service
Implements RAG Q&A and LangGraph workflow functionalities.
"""

import json
import uuid
from typing import Optional, List, Dict, Any, AsyncGenerator
from datetime import datetime
import structlog

from app.schemas.chat import ChatRequest, ChatResponse, ChatMessage
from app.core.config import settings
from app.services.llm_service import llm_service
from app.services.langgraph_chat_service import langgraph_chat_service

logger = structlog.get_logger(__name__)


class ChatService:
    """Chat Service Class (standard chat + LangGraph RAG delegation)."""

    def __init__(self):
        """Initializes the chat service"""
        self.chat_history: Dict[str, List[ChatMessage]] = {}

    async def chat(
        self, request: ChatRequest, tenant_id: int = None, user_id: int = None
    ) -> ChatResponse:
        """
        Handles a chat request, dispatching it to the appropriate handler
        (e.g., RAG or a standard LLM call).
        """
        # If a knowledge_base_id is provided, delegate to LangGraph RAG pipeline
        if request.knowledge_base_id:
            if tenant_id is None or user_id is None:
                raise ValueError("tenant_id and user_id are required for RAG chat.")
            logger.info(
                f"Dispatching to RAG chat for knowledge base '{request.knowledge_base_id}'."
            )
            try:
                return await langgraph_chat_service.chat(request, tenant_id, user_id)
            except Exception as e:
                logger.error(
                    "LangGraph RAG chat failed, returning fallback message",
                    error=str(e),
                    exc_info=True,
                )
                return ChatResponse(
                    message="抱歉，我暂时无法获取有效的回答，请稍后再试。",
                    chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                    model=request.model or settings.CHAT_MODEL_NAME,
                    usage={},
                    timestamp=datetime.now(),
                )

        # Otherwise, perform a standard chat completion
        logger.info("Performing standard chat completion.")
        try:
            llm_response = await llm_service.chat(
                message=request.message,
                model=request.model,
                temperature=request.temperature,
                max_tokens=request.max_tokens or 1000,
                tenant_id=tenant_id,
                user_id=user_id,
            )

            if not llm_response.get("success"):
                logger.warning(
                    "LLM service failed: %s. Returning fallback message.",
                    llm_response.get("error"),
                )
                if llm_response.get("error", "").startswith("No ") or llm_response.get("message"):
                    return ChatResponse(
                        message=str(llm_response.get("message") or llm_response.get("error") or "模型未配置"),
                        chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                        model=request.model or settings.CHAT_MODEL_NAME,
                        usage=llm_response.get("usage", {}),
                        timestamp=datetime.now(),
                    )
                return ChatResponse(
                    message="抱歉，我暂时无法获取有效的回答，请稍后再试。",
                    chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                    model=request.model or settings.CHAT_MODEL_NAME,
                    usage={},
                    timestamp=datetime.now(),
                )

            return ChatResponse(
                message=llm_response.get("message", ""),
                chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                model=llm_response.get("model", request.model or settings.CHAT_MODEL_NAME),
                usage=llm_response.get("usage", {}),
                timestamp=datetime.now(),
            )
        except Exception as e:
            logger.error("Standard chat processing failed", error=str(e), exc_info=True)
            raise

    async def stream_chat(
        self, request: ChatRequest, tenant_id: int = None, user_id: int = None
    ) -> AsyncGenerator[str, None]:
        """Streaming chat. RAG requests are delegated to LangGraph."""
        logger.info("Initiating stream chat.")

        try:
            if request.knowledge_base_id:
                if tenant_id is None or user_id is None:
                    raise ValueError("tenant_id and user_id are required for RAG stream chat.")
                async for chunk in langgraph_chat_service.stream_chat(
                    request, tenant_id=tenant_id, user_id=user_id
                ):
                    yield chunk
                return

            async for chunk in llm_service.stream_chat(
                message=request.message,
                model=request.model,
                temperature=request.temperature,
                max_tokens=request.max_tokens or 1000,
                tenant_id=tenant_id,
                user_id=user_id,
            ):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.error("Stream chat failed", error=str(e), exc_info=True)
            error_chunk = {"success": False, "error": str(e), "type": "error"}
            yield f"data: {json.dumps(error_chunk, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"

    # The following methods are for managing chat history, kept for potential future use.
    def _add_message_to_history(self, chat_id: str, message: ChatMessage):
        if chat_id not in self.chat_history:
            self.chat_history[chat_id] = []
        self.chat_history[chat_id].append(message)
        if len(self.chat_history[chat_id]) > 100:
            self.chat_history[chat_id] = self.chat_history[chat_id][-100:]

    async def get_chat_history(
        self, chat_id: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        history = self.chat_history.get(chat_id, [])
        return [msg.dict() for msg in history[-limit:]]

    async def clear_chat_history(self, chat_id: str):
        if chat_id in self.chat_history:
            del self.chat_history[chat_id]

    async def execute_workflow(
        self, workflow_id: str, request: Dict[str, Any]
    ) -> Dict[str, Any]:
        """执行LangGraph工作流（简化版本）"""
        logger.info("Executing workflow", workflow_id=workflow_id)
        # This remains a mock implementation for now
        execution_id = f"exec_{uuid.uuid4().hex[:8]}"
        start_time = datetime.now()
        message = request.get("input", {}).get("message", "")
        output = {"result": f"Workflow {workflow_id} executed with input: {message}"}
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        return {
            "output": output,
            "execution_id": execution_id,
            "workflow_id": workflow_id,
            "status": "completed",
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "duration": duration,
        }
