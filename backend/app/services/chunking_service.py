"""
文档分片策略服务
提供多种文档分片策略的实现
"""

import logging
from typing import List, Dict, Any
from enum import Enum
from abc import ABC, abstractmethod

from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    CharacterTextSplitter,
)
from app.services.llm_service import llm_service

# Try to import Rust text processor for enhanced performance
try:
    from app.services.rust_document_service import rust_processor

    RUST_TEXT_PROCESSOR_AVAILABLE = rust_processor is not None
except ImportError:
    RUST_TEXT_PROCESSOR_AVAILABLE = False

logger = logging.getLogger(__name__)


class ChunkingStrategy(Enum):
    """文档分片策略枚举"""

    RECURSIVE = "recursive"
    SEMANTIC = "semantic"
    SLIDING_WINDOW = "sliding_window"
    SENTENCE = "sentence"
    TOKEN_BASED = "token_based"


class BaseChunker(ABC):
    """分片器基类"""

    @abstractmethod
    def chunk_text(self, text: str, **kwargs) -> List[str]:
        """
        将文本分割成块

        Args:
            text: 输入文本
            **kwargs: 分片参数

        Returns:
            文本块列表
        """
        pass


class RecursiveChunker(BaseChunker):
    """递归字符分片器"""

    def chunk_text(
        self, text: str, chunk_size: int = 1000, chunk_overlap: int = 200, **kwargs
    ) -> List[str]:
        """递归分片策略"""
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            is_separator_regex=False,
            separators=["\n\n", "\n", " ", ""],
        )
        return splitter.split_text(text)


class SemanticChunker(BaseChunker):
    """语义分片器"""

    def __init__(self):
        # 使用现有的嵌入服务进行语义分片
        pass

    async def chunk_text(
        self, text: str, breakpoint_threshold_type: str = "percentile", **kwargs
    ) -> List[str]:
        """
        语义分片策略

        Args:
            text: 输入文本
            breakpoint_threshold_type: 断点阈值类型 ("percentile", "standard_deviation", "interquartile")
        """
        try:
            # 由于 SemanticChunker 需要 OpenAI embeddings，我们这里实现一个简化版本
            # 按句子分割，然后基于句子长度进行语义分组
            sentences = self._split_into_sentences(text)
            return self._group_sentences_semantically(sentences, **kwargs)
        except Exception as e:
            logger.error(f"Semantic chunking failed: {e}")
            # 回退到递归分片
            recursive_chunker = RecursiveChunker()
            return recursive_chunker.chunk_text(text, **kwargs)

    def _split_into_sentences(self, text: str) -> List[str]:
        """将文本分割成句子"""
        import re

        # 简单的句子分割（可以改进为使用更复杂的NLP库）
        sentences = re.split(r"[.!?]+", text)
        return [s.strip() for s in sentences if s.strip()]

    def _group_sentences_semantically(
        self, sentences: List[str], target_chunk_size: int = 1000, **kwargs
    ) -> List[str]:
        """将句子语义分组"""
        chunks = []
        current_chunk = ""

        for sentence in sentences:
            # 如果添加这个句子不会超过目标大小，就添加
            if len(current_chunk) + len(sentence) <= target_chunk_size:
                current_chunk += sentence + ". "
            else:
                # 否则开始新的块
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence + ". "

        # 添加最后一个块
        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks


class SlidingWindowChunker(BaseChunker):
    """滑动窗口分片器"""

    def chunk_text(
        self, text: str, window_size: int = 1000, step_size: int = 500, **kwargs
    ) -> List[str]:
        """
        滑动窗口分片策略

        Args:
            text: 输入文本
            window_size: 窗口大小
            step_size: 步长
        """
        chunks = []
        start = 0

        while start < len(text):
            end = min(start + window_size, len(text))
            chunk = text[start:end]

            # 尝试在单词边界处截断
            if end < len(text) and not text[end].isspace():
                last_space = chunk.rfind(" ")
                if last_space > start + window_size // 2:  # 确保块不会太小
                    chunk = chunk[:last_space]
                    end = start + last_space

            chunks.append(chunk.strip())
            start += step_size

            # 如果剩余文本太短，直接添加
            if len(text) - start < step_size:
                if start < len(text):
                    chunks.append(text[start:].strip())
                break

        return [chunk for chunk in chunks if chunk]


class SentenceChunker(BaseChunker):
    """句子分片器"""

    def chunk_text(
        self, text: str, sentences_per_chunk: int = 5, **kwargs
    ) -> List[str]:
        """
        基于句子的分片策略

        Args:
            text: 输入文本
            sentences_per_chunk: 每个块包含的句子数
        """
        import re

        # 分割句子
        sentences = re.split(r"[.!?]+", text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks = []
        for i in range(0, len(sentences), sentences_per_chunk):
            chunk_sentences = sentences[i : i + sentences_per_chunk]
            chunk = ". ".join(chunk_sentences) + "."
            chunks.append(chunk)

        return chunks


class TokenBasedChunker(BaseChunker):
    """基于Token的分片器"""

    def chunk_text(
        self, text: str, tokens_per_chunk: int = 500, overlap_tokens: int = 50, **kwargs
    ) -> List[str]:
        """
        基于Token的分片策略

        Args:
            text: 输入文本
            tokens_per_chunk: 每个块的token数
            overlap_tokens: 重叠的token数
        """
        try:
            # 使用简单的空格分词作为token（可以改进为使用tokenizer）
            tokens = text.split()
            chunks = []

            start = 0
            while start < len(tokens):
                end = min(start + tokens_per_chunk, len(tokens))
                chunk_tokens = tokens[start:end]
                chunk = " ".join(chunk_tokens)
                chunks.append(chunk)

                # 计算下一个起始位置（考虑重叠）
                start = end - overlap_tokens
                if start >= len(tokens):
                    break

            return chunks

        except Exception as e:
            logger.error(f"Token-based chunking failed: {e}")
            # 回退到递归分片
            recursive_chunker = RecursiveChunker()
            return recursive_chunker.chunk_text(text, **kwargs)


class ChunkingService:
    """文档分片服务"""

    def __init__(self):
        self.chunkers = {
            ChunkingStrategy.RECURSIVE: RecursiveChunker(),
            ChunkingStrategy.SEMANTIC: SemanticChunker(),
            ChunkingStrategy.SLIDING_WINDOW: SlidingWindowChunker(),
            ChunkingStrategy.SENTENCE: SentenceChunker(),
            ChunkingStrategy.TOKEN_BASED: TokenBasedChunker(),
        }

    async def chunk_document(
        self,
        text: str,
        strategy: ChunkingStrategy = ChunkingStrategy.RECURSIVE,
        **kwargs,
    ) -> List[str]:
        """
        使用指定策略分片文档

        Args:
            text: 输入文本
            strategy: 分片策略
            **kwargs: 分片参数

        Returns:
            文本块列表
        """
        # Try Rust text processor for basic chunking strategies
        if RUST_TEXT_PROCESSOR_AVAILABLE and strategy == ChunkingStrategy.RECURSIVE:
            try:
                chunk_size = kwargs.get("chunk_size", 1000)
                chunk_overlap = kwargs.get("chunk_overlap", 200)

                # Clean text first
                cleaned_text = rust_processor.clean_and_chunk_text(
                    text,
                    chunk_size=chunk_size,
                    overlap=chunk_overlap,
                    clean_options={
                        "normalize_unicode": True,
                        "remove_extra_whitespace": True,
                    },
                    chunk_options={
                        "respect_sentences": True,
                        "respect_paragraphs": True,
                    },
                )

                if cleaned_text:
                    logger.info(
                        f"Used Rust chunking for {len(text)} characters -> {len(cleaned_text)} chunks"
                    )
                    return cleaned_text

            except Exception as e:
                logger.warning(f"Rust chunking failed, falling back to Python: {e}")

        # Fallback to existing Python implementation
        chunker = self.chunkers.get(strategy)
        if not chunker:
            logger.error(f"Unknown chunking strategy: {strategy}")
            # 回退到递归分片
            chunker = self.chunkers[ChunkingStrategy.RECURSIVE]

        try:
            if strategy == ChunkingStrategy.SEMANTIC:
                # 语义分片是异步的
                return await chunker.chunk_text(text, **kwargs)
            else:
                return chunker.chunk_text(text, **kwargs)
        except Exception as e:
            logger.error(f"Chunking failed with strategy {strategy}: {e}")
            # 回退到递归分片
            recursive_chunker = self.chunkers[ChunkingStrategy.RECURSIVE]
            return recursive_chunker.chunk_text(text, **kwargs)

    def get_available_strategies(self) -> List[Dict[str, Any]]:
        """获取可用的分片策略"""
        return [
            {
                "value": ChunkingStrategy.RECURSIVE.value,
                "label": "递归分片",
                "description": "基于分隔符递归分割文本，适用于大多数场景",
                "params": {
                    "chunk_size": {
                        "type": "number",
                        "default": 1000,
                        "min": 100,
                        "max": 4000,
                    },
                    "chunk_overlap": {
                        "type": "number",
                        "default": 200,
                        "min": 0,
                        "max": 1000,
                    },
                },
            },
            {
                "value": ChunkingStrategy.SEMANTIC.value,
                "label": "语义分片",
                "description": "基于语义相似性分割文本，保持语义连贯性",
                "params": {
                    "target_chunk_size": {
                        "type": "number",
                        "default": 1000,
                        "min": 500,
                        "max": 3000,
                    },
                    "breakpoint_threshold_type": {
                        "type": "select",
                        "default": "percentile",
                        "options": [
                            "percentile",
                            "standard_deviation",
                            "interquartile",
                        ],
                    },
                },
            },
            {
                "value": ChunkingStrategy.SLIDING_WINDOW.value,
                "label": "滑动窗口",
                "description": "使用滑动窗口方式分割，适用于需要上下文重叠的场景",
                "params": {
                    "window_size": {
                        "type": "number",
                        "default": 1000,
                        "min": 300,
                        "max": 2000,
                    },
                    "step_size": {
                        "type": "number",
                        "default": 500,
                        "min": 100,
                        "max": 1500,
                    },
                },
            },
            {
                "value": ChunkingStrategy.SENTENCE.value,
                "label": "句子分片",
                "description": "基于句子边界分割，保持句子完整性",
                "params": {
                    "sentences_per_chunk": {
                        "type": "number",
                        "default": 5,
                        "min": 1,
                        "max": 20,
                    }
                },
            },
            {
                "value": ChunkingStrategy.TOKEN_BASED.value,
                "label": "Token分片",
                "description": "基于Token数量分割，精确控制长度",
                "params": {
                    "tokens_per_chunk": {
                        "type": "number",
                        "default": 500,
                        "min": 100,
                        "max": 2000,
                    },
                    "overlap_tokens": {
                        "type": "number",
                        "default": 50,
                        "min": 0,
                        "max": 300,
                    },
                },
            },
        ]


# 单例实例
chunking_service = ChunkingService()
