"""
Test cases for LangGraph Chat Service
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock

from app.services.langgraph_chat_service import langgraph_chat_service, ChatState
from app.schemas.chat import ChatRequest, ChatResponse


class TestLangGraphChatService:
    """Test LangGraph Chat Service"""
    
    @pytest.fixture
    def sample_chat_request(self):
        """Sample chat request for testing"""
        return ChatRequest(
            message="什么是RAG？",
            knowledge_base_id="test1",
            model="deepseek-chat",
            chat_id="test_chat_001"
        )
    
    @pytest.fixture
    def sample_state(self):
        """Sample state for testing"""
        return ChatState(
            messages=[],
            query="什么是RAG？",
            knowledge_base_id="test1",
            tenant_id=1,
            user_id=1,
            query_vector=None,
            retrieved_docs=[],
            reranked_docs=[],
            context="",
            final_response="",
            step_info={}
        )
    
    @pytest.mark.asyncio
    async def test_analyze_query(self, sample_state):
        """Test query analysis step"""
        service = langgraph_chat_service
        
        result = await service._analyze_query(sample_state)
        
        assert "query_analysis" in result["step_info"]
        assert result["step_info"]["query_analysis"]["intent"] == "question"
        assert result["step_info"]["query_analysis"]["language"] == "zh"
    
    @pytest.mark.asyncio
    @patch('app.services.llm_service.llm_service.get_embeddings')
    async def test_generate_embedding_success(self, mock_get_embeddings, sample_state):
        """Test successful embedding generation"""
        mock_get_embeddings.return_value = {
            "success": True,
            "embeddings": [[0.1, 0.2, 0.3, 0.4]]
        }
        
        service = langgraph_chat_service
        result = await service._generate_embedding(sample_state)
        
        assert result["query_vector"] == [0.1, 0.2, 0.3, 0.4]
        assert result["step_info"]["embedding_generated"] is True
    
    @pytest.mark.asyncio
    @patch('app.services.llm_service.llm_service.get_embeddings')
    async def test_generate_embedding_failure(self, mock_get_embeddings, sample_state):
        """Test embedding generation failure"""
        mock_get_embeddings.return_value = {
            "success": False,
            "embeddings": []
        }
        
        service = langgraph_chat_service
        result = await service._generate_embedding(sample_state)
        
        assert result["query_vector"] is None
        assert result["step_info"]["embedding_generated"] is False
    
    @pytest.mark.asyncio
    @patch('app.services.milvus_service.milvus_service.search')
    @patch('app.services.langgraph_chat_service.get_elasticsearch_service')
    async def test_retrieve_documents_success(self, mock_get_es_service, mock_milvus_search, sample_state):
        """Test successful document retrieval"""
        # Setup mock responses
        mock_milvus_search.return_value = [
            {
                "text": "RAG是检索增强生成技术",
                "distance": 0.1,
                "document_name": "rag_intro.pdf",
                "knowledge_base": "test1"
            }
        ]
        
        mock_es = AsyncMock()
        mock_es.search = AsyncMock(return_value=[
            {
                "text": "RAG结合了检索和生成",
                "score": 0.9,
                "document_name": "rag_guide.pdf",
                "knowledge_base": "test1"
            }
        ])
        mock_get_es_service.return_value = mock_es
        
        # Set up state with embedding
        sample_state["query_vector"] = [0.1, 0.2, 0.3, 0.4]
        
        service = langgraph_chat_service
        result = await service._retrieve_documents(sample_state)
        
        assert len(result["retrieved_docs"]) == 2
        assert result["step_info"]["docs_retrieved"] == 2
        assert result["retrieved_docs"][0]["source"] == "vector"
        assert result["retrieved_docs"][1]["source"] == "keyword"
    
    @pytest.mark.asyncio
    @patch('app.services.reranking_service.reranking_service.rerank_documents')
    async def test_rerank_documents_success(self, mock_rerank, sample_state):
        """Test successful document reranking"""
        # Setup initial docs
        sample_state["retrieved_docs"] = [
            {
                "text": "RAG是检索增强生成技术",
                "score": 0.9,
                "source": "vector",
                "metadata": {"document_name": "rag_intro.pdf"}
            },
            {
                "text": "RAG结合了检索和生成",
                "score": 0.8,
                "source": "keyword",
                "metadata": {"document_name": "rag_guide.pdf"}
            }
        ]
        
        # Mock reranking response
        mock_rerank.return_value = [
            {
                "text": "RAG是检索增强生成技术",
                "score": 0.95,
                "metadata": {"document_name": "rag_intro.pdf"}
            }
        ]
        
        service = langgraph_chat_service
        result = await service._rerank_documents(sample_state)
        
        assert len(result["reranked_docs"]) == 1
        assert result["step_info"]["docs_reranked"] == 1
        assert "RAG是检索增强生成技术" in result["context"]
    
    @pytest.mark.asyncio
    @patch('app.services.llm_service.llm_service.chat')
    async def test_generate_response_success(self, mock_chat, sample_state):
        """Test successful response generation"""
        # Setup state with context
        sample_state["context"] = "RAG是检索增强生成技术，结合了检索和生成能力"
        sample_state["reranked_docs"] = [
            {
                "text": "RAG是检索增强生成技术",
                "metadata": {"document_name": "rag_intro.pdf"}
            }
        ]
        
        # Mock LLM response
        mock_chat.return_value = {
            "success": True,
            "message": "RAG（检索增强生成）是一种结合了信息检索和文本生成的人工智能技术。",
            "usage": {"tokens": 50}
        }
        
        service = langgraph_chat_service
        result = await service._generate_response(sample_state)
        
        assert "RAG（检索增强生成）" in result["final_response"]
        assert "参考文档：rag_intro.pdf" in result["final_response"]
        assert result["step_info"]["usage"]["tokens"] == 50
    
    @pytest.mark.asyncio
    @patch('app.services.llm_service.llm_service.chat')
    async def test_fallback_response(self, mock_chat, sample_state):
        """Test fallback response generation"""
        mock_chat.return_value = {
            "success": True,
            "message": "我是一个AI助手，很高兴为您服务。",
            "usage": {"tokens": 20}
        }
        
        service = langgraph_chat_service
        result = await service._fallback_response(sample_state)
        
        assert "AI助手" in result["final_response"]
        assert result["step_info"]["usage"]["tokens"] == 20
    
    def test_should_retrieve_decision(self, sample_state):
        """Test retrieval decision logic"""
        service = langgraph_chat_service
        
        # Should retrieve when embedding is generated
        sample_state["step_info"]["embedding_generated"] = True
        assert service._should_retrieve(sample_state) == "retrieve"
        
        # Should fallback when embedding fails
        sample_state["step_info"]["embedding_generated"] = False
        assert service._should_retrieve(sample_state) == "fallback"
    
    def test_should_rerank_decision(self, sample_state):
        """Test reranking decision logic"""
        service = langgraph_chat_service
        
        # Should rerank when docs are retrieved
        sample_state["step_info"]["docs_retrieved"] = 5
        assert service._should_rerank(sample_state) == "rerank"
        
        # Should fallback when no docs retrieved
        sample_state["step_info"]["docs_retrieved"] = 0
        assert service._should_rerank(sample_state) == "fallback"
    
    def test_construct_rag_prompt(self):
        """Test RAG prompt construction"""
        service = langgraph_chat_service
        
        query = "什么是RAG？"
        context = "RAG是检索增强生成技术"
        
        prompt = service._construct_rag_prompt(query, context)
        
        assert "什么是RAG？" in prompt
        assert "RAG是检索增强生成技术" in prompt
        assert "信息：" in prompt
        assert "问题：" in prompt
    
    @pytest.mark.asyncio
    @patch('app.services.langgraph_chat_service.langgraph_chat_service.graph')
    async def test_chat_end_to_end(self, mock_graph, sample_chat_request):
        """Test end-to-end chat flow"""
        # Mock graph execution
        mock_final_state = {
            "final_response": "RAG是检索增强生成技术，它结合了信息检索和文本生成。",
            "step_info": {"usage": {"tokens": 100}}
        }
        mock_graph.ainvoke = AsyncMock(return_value=mock_final_state)
        
        service = langgraph_chat_service
        response = await service.chat(sample_chat_request, tenant_id=1, user_id=1)
        
        assert isinstance(response, ChatResponse)
        assert "RAG是检索增强生成技术" in response.message
        assert response.chat_id == "test_chat_001"
        assert response.usage["tokens"] == 100
    
    @pytest.mark.asyncio
    @patch('app.services.langgraph_chat_service.langgraph_chat_service.graph')
    async def test_chat_workflow_failure(self, mock_graph, sample_chat_request):
        """Test chat workflow failure handling"""
        # Mock graph execution failure
        mock_graph.ainvoke = AsyncMock(side_effect=Exception("Workflow failed"))
        
        service = langgraph_chat_service
        response = await service.chat(sample_chat_request, tenant_id=1, user_id=1)
        
        assert isinstance(response, ChatResponse)
        assert "抱歉，我暂时无法获取有效的回答" in response.message
        assert response.chat_id == "test_chat_001"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
