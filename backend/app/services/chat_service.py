"""
Chat Service
Implements RAG Q&A and LangGraph workflow functionalities.
"""

import json
import uuid
from typing import Optional, List, Dict, Any, AsyncGenerator
from datetime import datetime
import structlog
import asyncio

from app.schemas.chat import ChatRequest, ChatResponse, ChatMessage
from app.core.config import settings
from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import elasticsearch_service
from app.services.reranking_service import reranking_service, RerankingProvider

logger = structlog.get_logger(__name__)


class ChatService:
    """Chat Service Class"""

    def __init__(self):
        """Initializes the chat service"""
        self.chat_history: Dict[str, List[ChatMessage]] = {}
        self.workflows: Dict[str, Any] = {}

    async def chat(
        self, request: ChatRequest, tenant_id: int = None, user_id: int = None
    ) -> ChatResponse:
        """
        Handles a chat request, dispatching it to the appropriate handler
        (e.g., RAG or a standard LLM call).
        """
        # If a knowledge_base_id is provided, use the RAG pipeline
        if request.knowledge_base_id:
            if tenant_id is None or user_id is None:
                raise ValueError("tenant_id and user_id are required for RAG chat.")
            logger.info(
                f"Dispatching to RAG chat for knowledge base '{request.knowledge_base_id}'."
            )
            try:
                return await self.rag_chat(request, tenant_id, user_id)
            except Exception as e:
                logger.error(
                    "RAG chat failed, returning fallback message",
                    error=str(e),
                    exc_info=True,
                )
                return ChatResponse(
                    message="抱歉，我暂时无法获取有效的回答，请稍后再试。",
                    chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                    model=request.model,
                    usage={},
                    timestamp=datetime.now(),
                )

        # Otherwise, perform a standard chat completion
        logger.info("Performing standard chat completion.")
        try:
            llm_response = await llm_service.chat(
                message=request.message, model=request.model
            )

            if not llm_response.get("success"):
                logger.warning(
                    "LLM service failed: %s. Returning fallback message.",
                    llm_response.get("error"),
                )
                return ChatResponse(
                    message="抱歉，我暂时无法获取有效的回答，请稍后再试。",
                    chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                    model=request.model,
                    usage={},
                    timestamp=datetime.now(),
                )

            return ChatResponse(
                message=llm_response.get("message", ""),
                chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                model=llm_response.get("model", request.model),
                usage=llm_response.get("usage", {}),
                timestamp=datetime.now(),
            )
        except Exception as e:
            logger.error("Standard chat processing failed", error=str(e), exc_info=True)
            raise

    async def rag_chat(
        self,
        request: ChatRequest,
        tenant_id: int,
        user_id: int,
        rerank_provider: RerankingProvider = RerankingProvider.BGE,
    ) -> ChatResponse:
        """
        Handles a chat request using the RAG (Retrieval-Augmented Generation) pipeline.
        """
        if not request.knowledge_base_id:
            raise ValueError("knowledge_base_id is required for RAG chat.")

        try:
            logger.info("Generating embedding for the query...")
            embedding_response = await llm_service.get_embeddings(
                texts=[request.message]
            )
            if not embedding_response.get("success") or not embedding_response.get(
                "embeddings", []
            ):
                logger.warning(
                    "Query embedding failed (success=%s). Falling back to standard chat.",
                    embedding_response.get("success"),
                )
                # Fallback to a normal chat without RAG
                fallback_request = ChatRequest(
                    message=request.message,
                    model=request.model,
                    chat_id=request.chat_id,
                )
                return await self.chat(fallback_request)
            query_vector = embedding_response["embeddings"][0]

            kb_name = request.knowledge_base_id
            query_text = request.message
            top_k = 5  # Retrieve more results for hybrid search

            # Create tenant-specific collection and index names
            tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"
            tenant_index_name = f"tenant_{tenant_id}_{kb_name}"

            logger.info(
                f"Performing hybrid search in tenant-specific knowledge base '{tenant_collection_name}'..."
            )

            # --- Hybrid Search with Tenant Isolation ---
            # 1. Perform vector search and keyword search in parallel with tenant filtering
            vector_search_task = asyncio.create_task(
                milvus_service.search(
                    collection_name=tenant_collection_name,
                    query_vector=query_vector,
                    top_k=top_k,
                    filter_expr=f"tenant_id == {tenant_id}",
                )
            )
            keyword_search_task = asyncio.create_task(
                elasticsearch_service.search(
                    index_name=tenant_index_name,
                    query=query_text,
                    top_k=top_k,
                    filter_query={"term": {"tenant_id": tenant_id}},
                )
            )

            vector_results, keyword_results = await asyncio.gather(
                vector_search_task, keyword_search_task
            )

            # 2. Fuse the results
            # Convert results to unified format for reranking
            unified_docs = []

            # Add vector search results
            for res in vector_results:
                unified_docs.append(
                    {
                        "text": res["text"],
                        "score": 1.0
                        / (
                            1.0 + res.get("distance", 0)
                        ),  # Convert distance to similarity
                        "source": "vector",
                    }
                )

            # Add keyword search results (avoid duplicates)
            existing_texts = {doc["text"] for doc in unified_docs}
            for res in keyword_results:
                if res["text"] not in existing_texts:
                    unified_docs.append(
                        {
                            "text": res["text"],
                            "score": res.get("score", 0),
                            "source": "keyword",
                        }
                    )

            if not unified_docs:
                logger.warning(
                    "No documents found after fusion. Falling back to standard chat."
                )
                return await self.chat(
                    ChatRequest(
                        message=request.message,
                        model=request.model,
                        chat_id=request.chat_id,
                    )
                )

            # 3. Rerank the fused results using the new reranking service
            logger.info(
                f"Reranking {len(unified_docs)} fused documents using {rerank_provider.value}..."
            )
            reranked_docs = await reranking_service.rerank_documents(
                query=query_text,
                documents=unified_docs,
                provider=rerank_provider,
                top_k=3,
            )

            final_docs = [doc["text"] for doc in reranked_docs]

            context = "\n\n---\n\n".join(final_docs)

            if not context:
                logger.warning(
                    "No relevant context found after reranking. Falling back to standard chat."
                )
                return await self.chat(
                    ChatRequest(
                        message=request.message,
                        model=request.model,
                        chat_id=request.chat_id,
                    )
                )

            prompt = self._construct_rag_prompt(request.message, context)
            logger.info(
                "Generating final response from LLM with reranked RAG context..."
            )
            llm_response = await llm_service.chat(message=prompt, model=request.model)

            if not llm_response.get("success"):
                raise Exception("Failed to get a valid response from the LLM.")

            return ChatResponse(
                message=llm_response["message"],
                chat_id=request.chat_id or f"chat_{uuid.uuid4().hex[:8]}",
                model=llm_response["model"],
                usage=llm_response["usage"],
                timestamp=datetime.now(),
            )
        except Exception as e:
            logger.error("RAG chat processing failed", error=str(e), exc_info=True)
            raise

    def _construct_rag_prompt(self, query: str, context: str) -> str:
        """Constructs a prompt for the LLM using the retrieved context."""
        prompt_template = """
You are a professional AI assistant. Your task is to answer the user's question based on the provided context.
If the context does not contain the answer, state that you could not find the information in the provided documents.
Do not use any external knowledge.

## Context
{context}

## User Question
{query}

## Your Answer
"""
        return prompt_template.format(context=context, query=query)

    async def stream_chat(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        """Streaming chat response"""
        logger.info("Initiating stream chat.")
        # This is a simplified stream that directly calls the LLM service
        async for chunk in llm_service.stream_chat(
            message=request.message, model=request.model
        ):
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
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
