"""
LangGraph RAG Chat Service
Implements a sophisticated RAG pipeline using LangGraph for better conversation flow.
"""

import asyncio
import json
import uuid
from typing import Dict, List, Any, Optional, TypedDict, Annotated, AsyncGenerator
from datetime import datetime
import structlog

from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage

from app.schemas.chat import ChatRequest, ChatResponse, ChatMessage
from app.core.config import settings
from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import get_elasticsearch_service
from app.services.reranking_service import reranking_service, RerankingProvider
from app.db.database import SessionLocal
from app.db.models.document import Document

logger = structlog.get_logger(__name__)


class ChatState(TypedDict):
    """State for the RAG chat workflow"""
    messages: Annotated[List[BaseMessage], add_messages]
    query: str
    knowledge_base_id: str
    tenant_id: int
    user_id: int
    model: Optional[str]
    query_vector: Optional[List[float]]
    retrieved_docs: List[Dict[str, Any]]
    reranked_docs: List[Dict[str, Any]]
    context: str
    final_response: str
    step_info: Dict[str, Any]


class LangGraphChatService:
    """LangGraph-based RAG Chat Service"""
    
    def __init__(self):
        self.graph = self._build_graph()
    
    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow"""
        workflow = StateGraph(ChatState)
        
        # Add nodes
        workflow.add_node("analyze_query", self._analyze_query)
        workflow.add_node("generate_embedding", self._generate_embedding)
        workflow.add_node("retrieve_documents", self._retrieve_documents)
        workflow.add_node("rerank_documents", self._rerank_documents)
        workflow.add_node("generate_response", self._generate_response)
        workflow.add_node("fallback_response", self._fallback_response)
        
        # Add edges
        workflow.set_entry_point("analyze_query")
        workflow.add_edge("analyze_query", "generate_embedding")
        workflow.add_conditional_edges(
            "generate_embedding",
            self._should_retrieve,
            {
                "retrieve": "retrieve_documents",
                "fallback": "fallback_response"
            }
        )
        workflow.add_conditional_edges(
            "retrieve_documents",
            self._should_rerank,
            {
                "rerank": "rerank_documents",
                "fallback": "fallback_response"
            }
        )
        workflow.add_edge("rerank_documents", "generate_response")
        workflow.add_edge("generate_response", END)
        workflow.add_edge("fallback_response", END)
        
        return workflow.compile()
    
    async def chat(self, request: ChatRequest, tenant_id: int, user_id: int) -> ChatResponse:
        """Process chat request through LangGraph workflow"""
        chat_id = request.chat_id or f"chat_{uuid.uuid4().hex[:8]}"
        
        # Initialize state
        initial_state = ChatState(
            messages=[HumanMessage(content=request.message)],
            query=request.message,
            knowledge_base_id=request.knowledge_base_id,
            tenant_id=tenant_id,
            user_id=user_id,
            model=request.model,
            query_vector=None,
            retrieved_docs=[],
            reranked_docs=[],
            context="",
            final_response="",
            step_info={}
        )
        
        try:
            # Execute the workflow
            logger.info("Starting LangGraph RAG workflow", chat_id=chat_id)
            final_state = await self.graph.ainvoke(initial_state)

            sources = self._build_sources_payload(
                reranked_docs=final_state.get("reranked_docs") or [],
                tenant_id=tenant_id,
                knowledge_base_id=request.knowledge_base_id,
                limit=3,
            )
            
            return ChatResponse(
                message=final_state["final_response"],
                chat_id=chat_id,
                model=final_state["step_info"].get("model_used") or request.model or settings.CHAT_MODEL_NAME,
                usage=final_state["step_info"].get("usage", {}),
                sources=sources or None,
                timestamp=datetime.now(),
            )
            
        except Exception as e:
            logger.error("LangGraph workflow failed", error=str(e), exc_info=True)
            return ChatResponse(
                message="抱歉，我暂时无法获取有效的回答，请稍后再试。",
                chat_id=chat_id,
                model=request.model or settings.CHAT_MODEL_NAME,
                usage={},
                timestamp=datetime.now(),
            )

    async def stream_chat(
        self, request: ChatRequest, tenant_id: int, user_id: int
    ) -> AsyncGenerator[str, None]:
        """Streaming RAG chat using the same LangGraph retrieval/rerank pipeline."""
        chat_id = request.chat_id or f"chat_{uuid.uuid4().hex[:8]}"
        try:
            state = ChatState(
                messages=[HumanMessage(content=request.message)],
                query=request.message,
                knowledge_base_id=request.knowledge_base_id,
                tenant_id=tenant_id,
                user_id=user_id,
                model=request.model,
                query_vector=None,
                retrieved_docs=[],
                reranked_docs=[],
                context="",
                final_response="",
                step_info={},
            )

            state = await self._generate_embedding(state)
            if not state["step_info"].get("embedding_generated"):
                async for chunk in llm_service.stream_chat(
                    message=request.message,
                    model=request.model,
                    tenant_id=tenant_id,
                    user_id=user_id,
                ):
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

            state = await self._retrieve_documents(state)
            if not state.get("retrieved_docs"):
                async for chunk in llm_service.stream_chat(
                    message=request.message,
                    model=request.model,
                    tenant_id=tenant_id,
                    user_id=user_id,
                ):
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

            state = await self._rerank_documents(state)
            context = state.get("context") or ""
            if not context:
                async for chunk in llm_service.stream_chat(
                    message=request.message,
                    model=request.model,
                    tenant_id=tenant_id,
                    user_id=user_id,
                ):
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

            rag_prompt = self._construct_rag_prompt(request.message, context)
            async for chunk in llm_service.stream_chat(
                message=rag_prompt,
                model=request.model,
                tenant_id=tenant_id,
                user_id=user_id,
            ):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

            # Send sources as a separate event for frontend rendering
            sources = self._build_sources_payload(
                reranked_docs=(state.get("reranked_docs") or []),
                tenant_id=tenant_id,
                knowledge_base_id=request.knowledge_base_id,
                limit=3,
            )
            if sources:
                yield f"data: {json.dumps({'success': True, 'sources': sources, 'type': 'sources'}, ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.error("LangGraph streaming failed", error=str(e), exc_info=True)
            error_chunk = {"success": False, "error": str(e), "type": "error"}
            yield f"data: {json.dumps(error_chunk, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"

    def _build_sources_payload(
        self,
        *,
        reranked_docs: List[Dict[str, Any]],
        tenant_id: int,
        knowledge_base_id: Optional[str],
        limit: int = 3,
    ) -> List[Dict[str, Any]]:
        """Build structured sources payload for the UI.

        Each item tries to include `document_id` (DB) so the frontend can open the chunks dialog.
        """
        kb_name = str(knowledge_base_id or "")
        if not kb_name or not reranked_docs:
            return []

        # De-dup by document name, keep best (first) occurrences
        chosen: list[dict] = []
        seen: set[str] = set()
        for doc in reranked_docs:
            meta = doc.get("metadata") or {}
            name = str(meta.get("document_name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            snippet = str(doc.get("text") or "")
            if len(snippet) > 240:
                snippet = snippet[:240] + "…"
            chosen.append(
                {
                    "document_name": name,
                    "knowledge_base_id": kb_name,
                    "source": doc.get("source"),
                    "score": doc.get("score"),
                    "rerank_score": doc.get("rerank_score"),
                    "snippet": snippet,
                }
            )
            if len(chosen) >= max(1, int(limit)):
                break

        if not chosen:
            return []

        # Resolve document ids in one DB query
        try:
            names = [c["document_name"] for c in chosen if c.get("document_name")]
            if names:
                db = SessionLocal()
                try:
                    rows = (
                        db.query(Document.id, Document.filename, Document.total_chunks)
                        .filter(
                            Document.tenant_id == tenant_id,
                            Document.knowledge_base_name == kb_name,
                            Document.filename.in_(names),
                        )
                        .all()
                    )
                finally:
                    db.close()
                by_name = {str(fn): {"id": int(did), "total_chunks": int(tc or 0)} for did, fn, tc in rows}
                for c in chosen:
                    info = by_name.get(c.get("document_name") or "")
                    if info:
                        c["document_id"] = info["id"]
                        c["total_chunks"] = info["total_chunks"]
        except Exception:
            # Best-effort: sources still work without doc id
            pass

        return chosen
    
    async def _analyze_query(self, state: ChatState) -> ChatState:
        """Analyze the user query for intent and complexity"""
        logger.info("Analyzing query", query=state["query"])
        
        # Simple analysis - in production, this could be more sophisticated
        query_analysis = {
            "intent": "question",
            "complexity": "medium",
            "requires_context": True,
            "language": "zh" if any('\u4e00' <= char <= '\u9fff' for char in state["query"]) else "en"
        }
        
        state["step_info"]["query_analysis"] = query_analysis
        return state
    
    async def _generate_embedding(self, state: ChatState) -> ChatState:
        """Generate embedding for the user query"""
        logger.info("Generating query embedding")
        
        try:
            embedding_response = await llm_service.get_embeddings(
                texts=[state["query"]],
                tenant_id=state["tenant_id"],
                user_id=state.get("user_id"),
            )
            
            if embedding_response.get("success") and embedding_response.get("embeddings"):
                state["query_vector"] = embedding_response["embeddings"][0]
                state["step_info"]["embedding_generated"] = True
                logger.info("Query embedding generated successfully")
            else:
                state["step_info"]["embedding_generated"] = False
                logger.warning("Failed to generate query embedding")
                
        except Exception as e:
            logger.error("Embedding generation failed", error=str(e))
            state["step_info"]["embedding_generated"] = False
            
        return state
    
    async def _retrieve_documents(self, state: ChatState) -> ChatState:
        """Retrieve relevant documents using hybrid search"""
        logger.info("Retrieving documents from knowledge base")
        
        kb_name = state["knowledge_base_id"]
        tenant_id = state["tenant_id"]
        query_vector = state["query_vector"]
        query_text = state["query"]
        
        # Create tenant-specific collection and index names
        tenant_collection_name = f"tenant_{tenant_id}_{kb_name}"
        tenant_index_name = f"tenant_{tenant_id}_{kb_name}"
        
        try:
            # Perform hybrid search - 减少检索数量以提升速度
            top_k = 3
            
            # Vector search with dimension mismatch handling
            async def safe_vector_search():
                try:
                    return await milvus_service.search(
                        collection_name=tenant_collection_name,
                        query_vector=query_vector,
                        top_k=top_k,
                    )
                except Exception as e:
                    if "vector dimension mismatch" in str(e):
                        logger.warning(f"Vector dimension mismatch detected, recreating collection with new dimension")
                        try:
                            # 重新创建集合
                            await milvus_service.async_recreate_collection_with_new_dimension(
                                tenant_collection_name, len(query_vector)
                            )
                            logger.info(f"Collection recreated, retrying search...")
                            return await milvus_service.search(
                                collection_name=tenant_collection_name,
                                query_vector=query_vector,
                                top_k=top_k,
                            )
                        except Exception as recreate_error:
                            logger.error(f"Failed to recreate collection: {recreate_error}")
                            return []
                    else:
                        raise e
            
            vector_task = asyncio.create_task(safe_vector_search())
            
            # Keyword search - check if elasticsearch service is available
            keyword_task = None
            try:
                es_service = await get_elasticsearch_service()
                if es_service is not None:
                    keyword_task = asyncio.create_task(
                        es_service.search(
                            index_name=tenant_index_name,
                            query=query_text,
                            top_k=top_k,
                            filter_query={"tenant_id": tenant_id},
                        )
                    )
                else:
                    logger.warning("Elasticsearch service not available, using vector search only")
            except Exception as e:
                logger.warning(f"Failed to get Elasticsearch service: {e}")
            
            # Gather results
            if keyword_task:
                vector_results, keyword_results = await asyncio.gather(
                    vector_task, keyword_task, return_exceptions=True
                )
            else:
                vector_results = await vector_task
                keyword_results = []
            
            # Handle exceptions
            if isinstance(vector_results, Exception):
                logger.warning("Vector search failed", error=str(vector_results))
                vector_results = []
            
            if isinstance(keyword_results, Exception):
                logger.warning("Keyword search failed", error=str(keyword_results))
                keyword_results = []
            
            # Combine results
            unified_docs = []
            
            # Add vector search results
            for res in vector_results:
                unified_docs.append({
                    "text": res["text"],
                    "score": 1.0 / (1.0 + res.get("distance", 0)),
                    "source": "vector",
                    "metadata": {
                        "document_name": res.get("document_name", ""),
                        "knowledge_base": res.get("knowledge_base", "")
                    }
                })
            
            # Add keyword search results (avoid duplicates)
            existing_texts = {doc["text"] for doc in unified_docs}
            for res in keyword_results:
                if res["text"] not in existing_texts:
                    unified_docs.append({
                        "text": res["text"],
                        "score": res.get("score", 0),
                        "source": "keyword",
                        "metadata": {
                            "document_name": res.get("document_name", ""),
                            "knowledge_base": res.get("knowledge_base", "")
                        }
                    })
            
            state["retrieved_docs"] = unified_docs
            state["step_info"]["docs_retrieved"] = len(unified_docs)
            
            logger.info("Documents retrieved successfully", count=len(unified_docs))
            
        except Exception as e:
            logger.error("Document retrieval failed", error=str(e))
            state["retrieved_docs"] = []
            state["step_info"]["docs_retrieved"] = 0
            
        return state
    
    async def _rerank_documents(self, state: ChatState) -> ChatState:
        """Rerank retrieved documents for better relevance"""
        logger.info("Reranking documents")
        
        if not state["retrieved_docs"]:
            logger.warning("No documents to rerank")
            return state
        
        try:
            reranked_docs = await reranking_service.rerank_documents(
                query=state["query"],
                documents=state["retrieved_docs"],
                provider=RerankingProvider.BGE,
                top_k=2,  # 进一步减少重排文档数量
                tenant_id=state["tenant_id"],
            )
            
            state["reranked_docs"] = reranked_docs
            state["step_info"]["docs_reranked"] = len(reranked_docs)
            
            # Build context from reranked documents
            context_parts = []
            for doc in reranked_docs:
                context_parts.append(f"文档：{doc['metadata'].get('document_name', '未知')}\n{doc['text']}")
            
            state["context"] = "\n\n---\n\n".join(context_parts)
            
            logger.info("Documents reranked successfully", count=len(reranked_docs))
            
        except Exception as e:
            logger.error("Document reranking failed", error=str(e))
            # Fallback to original docs
            state["reranked_docs"] = state["retrieved_docs"][:3]
            state["context"] = "\n\n---\n\n".join([doc["text"] for doc in state["reranked_docs"]])
            
        return state
    
    async def _generate_response(self, state: ChatState) -> ChatState:
        """Generate final response using LLM with context"""
        logger.info("Generating final response")
        
        try:
            prompt = self._construct_rag_prompt(state["query"], state["context"])
            
            model = state.get("model")
            llm_response = await llm_service.chat(
                message=prompt,
                model=model,  # Use requested model if provided, else default
                max_tokens=1500,  # 限制回答长度以提升速度
                temperature=0.3,   # 降低temperature以提升生成速度
                tenant_id=state["tenant_id"],
                user_id=state.get("user_id"),
            )
            
            logger.info(f"LLM response received: success={llm_response.get('success')}, message_length={len(llm_response.get('message', ''))}")
            
            if llm_response.get("success"):
                response_message = llm_response["message"]
                logger.info(f"LLM response message: {response_message[:200]}...")  # 只记录前200字符
                
                state["final_response"] = response_message
                state["step_info"]["usage"] = llm_response.get("usage", {})
                state["step_info"]["model_used"] = llm_response.get("model") or model
                
                # Add context information to the response
                if state["reranked_docs"]:
                    sources = set()
                    for doc in state["reranked_docs"]:
                        doc_name = doc["metadata"].get("document_name", "")
                        if doc_name:
                            sources.add(doc_name)
                    
                    if sources:
                        source_text = "、".join(sources)
                        state["final_response"] += f"\n\n📚 参考文档：{source_text}"
                
                logger.info("Response generated successfully")
            else:
                logger.error(f"LLM response failed: {llm_response}")
                raise Exception("LLM response failed")
                
        except Exception as e:
            logger.error("Response generation failed", error=str(e))
            state["final_response"] = "抱歉，我暂时无法生成有效的回答，请稍后再试。"
            
        return state
    
    async def _fallback_response(self, state: ChatState) -> ChatState:
        """Generate fallback response when RAG fails"""
        logger.info("Generating fallback response")
        
        try:
            # Try standard chat without RAG
            model = state.get("model")
            llm_response = await llm_service.chat(
                message=state["query"],
                model=model,
                tenant_id=state["tenant_id"],
                user_id=state.get("user_id"),
            )
            
            if llm_response.get("success"):
                state["final_response"] = llm_response["message"]
                state["step_info"]["usage"] = llm_response.get("usage", {})
                state["step_info"]["model_used"] = llm_response.get("model") or model
            else:
                state["final_response"] = "抱歉，我暂时无法获取有效的回答，请稍后再试。"
                
        except Exception as e:
            logger.error("Fallback response failed", error=str(e))
            state["final_response"] = "抱歉，我暂时无法获取有效的回答，请稍后再试。"
            
        return state
    
    def _should_retrieve(self, state: ChatState) -> str:
        """Decide whether to retrieve documents or fallback"""
        if state["step_info"].get("embedding_generated", False):
            return "retrieve"
        else:
            return "fallback"
    
    def _should_rerank(self, state: ChatState) -> str:
        """Decide whether to rerank documents or fallback"""
        if state["step_info"].get("docs_retrieved", 0) > 0:
            return "rerank"
        else:
            return "fallback"
    
    def _construct_rag_prompt(self, query: str, context: str) -> str:
        """Construct RAG prompt for LLM - 优化版本，更简洁以提升响应速度"""
        prompt_template = """基于以下信息回答问题。请使用Markdown格式，包括标题、列表、粗体等来组织回答。

信息：
{context}

问题：{query}

请提供结构化的Markdown回答："""
        return prompt_template.format(context=context, query=query)


# Global service instance
langgraph_chat_service = LangGraphChatService()
