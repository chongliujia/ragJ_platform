"""
高级节点执行器
包含更多专业化的节点类型和执行逻辑
"""

import asyncio
import json
import time
import uuid
import re
import hashlib
from typing import Dict, List, Any, Optional, Union
from datetime import datetime, timedelta
import structlog
import httpx
from PIL import Image
import io
import base64
from urllib.parse import urlparse, urljoin
import requests
from bs4 import BeautifulSoup
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.schemas.workflow import WorkflowNode, WorkflowExecutionContext
from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service

logger = structlog.get_logger(__name__)


class AdvancedNodeExecutors:
    """高级节点执行器集合"""
    
    def __init__(self):
        self.http_client = httpx.AsyncClient(timeout=30.0)
        self.tfidf_vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        
    async def close(self):
        """关闭HTTP客户端"""
        await self.http_client.aclose()
    
    # ==================== 文本处理节点 ====================
    
    async def execute_text_splitter_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """文本分割节点"""
        config = node.config
        text = input_data.get('text', '')
        
        split_type = config.get('split_type', 'sentence')
        max_length = config.get('max_length', 1000)
        overlap = config.get('overlap', 100)
        
        try:
            if split_type == 'sentence':
                # 按句子分割
                sentences = re.split(r'[.!?。！？]+', text)
                chunks = []
                current_chunk = ''
                
                for sentence in sentences:
                    if len(current_chunk) + len(sentence) <= max_length:
                        current_chunk += sentence + '. '
                    else:
                        if current_chunk:
                            chunks.append(current_chunk.strip())
                        current_chunk = sentence + '. '
                
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    
            elif split_type == 'paragraph':
                # 按段落分割
                paragraphs = text.split('\n\n')
                chunks = []
                current_chunk = ''
                
                for paragraph in paragraphs:
                    if len(current_chunk) + len(paragraph) <= max_length:
                        current_chunk += paragraph + '\n\n'
                    else:
                        if current_chunk:
                            chunks.append(current_chunk.strip())
                        current_chunk = paragraph + '\n\n'
                
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    
            else:  # 'fixed_length'
                # 固定长度分割
                chunks = []
                for i in range(0, len(text), max_length - overlap):
                    chunk = text[i:i + max_length]
                    if chunk:
                        chunks.append(chunk)
            
            return {
                'chunks': chunks,
                'chunk_count': len(chunks),
                'original_length': len(text),
                'split_type': split_type
            }
            
        except Exception as e:
            logger.error(f"文本分割失败: {e}")
            return {
                'chunks': [text],
                'chunk_count': 1,
                'original_length': len(text),
                'error': str(e)
            }
    
    async def execute_text_summarizer_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """文本摘要节点"""
        config = node.config
        text = input_data.get('text', '')
        
        summary_type = config.get('summary_type', 'extractive')
        max_length = config.get('max_length', 200)
        
        try:
            if summary_type == 'extractive':
                # 抽取式摘要
                sentences = re.split(r'[.!?。！？]+', text)
                if len(sentences) <= 3:
                    return {
                        'summary': text,
                        'summary_type': summary_type,
                        'compression_ratio': 1.0
                    }
                
                # 计算TF-IDF
                sentence_vectors = self.tfidf_vectorizer.fit_transform(sentences)
                similarity_matrix = cosine_similarity(sentence_vectors)
                
                # 计算句子重要性分数
                scores = similarity_matrix.sum(axis=1)
                ranked_sentences = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
                
                # 选择前几个重要句子
                top_sentences = sorted([idx for idx, _ in ranked_sentences[:3]], key=lambda x: x)
                summary = '. '.join([sentences[idx] for idx in top_sentences])
                
            else:  # 'abstractive'
                # 抽象式摘要（使用LLM）
                prompt = f"""请对以下文本进行摘要，要求简洁明了，不超过{max_length}字：

{text}

摘要："""
                
                response = await llm_service.chat(
                    message=prompt,
                    model=config.get('model', 'qwen-turbo'),
                    max_tokens=max_length,
                    temperature=0.3,
                    tenant_id=(
                        (context.global_context or {}).get("tenant_id")
                        or (context.input_data or {}).get("tenant_id")
                    ),
                    user_id=(
                        (context.global_context or {}).get("user_id")
                        or (context.input_data or {}).get("user_id")
                    ),
                )
                
                if response.get('success'):
                    summary = response['message']
                else:
                    summary = text[:max_length] + '...'
            
            compression_ratio = len(summary) / len(text) if text else 0
            
            return {
                'summary': summary,
                'summary_type': summary_type,
                'compression_ratio': compression_ratio,
                'original_length': len(text),
                'summary_length': len(summary)
            }
            
        except Exception as e:
            logger.error(f"文本摘要失败: {e}")
            return {
                'summary': text[:max_length] + '...' if len(text) > max_length else text,
                'summary_type': summary_type,
                'compression_ratio': 1.0,
                'error': str(e)
            }
    
    async def execute_sentiment_analyzer_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """情感分析节点"""
        config = node.config
        text = input_data.get('text', '')
        
        try:
            # 使用LLM进行情感分析
            prompt = f"""请分析以下文本的情感倾向，返回JSON格式：

文本：{text}

请返回包含以下字段的JSON：
- sentiment: "positive", "negative", "neutral"
- confidence: 0-1之间的置信度
- emotions: 检测到的具体情感列表
- explanation: 简短解释

JSON："""
            
            response = await llm_service.chat(
                message=prompt,
                model=config.get('model', 'qwen-turbo'),
                temperature=0.1,
                max_tokens=500,
                tenant_id=(
                    (context.global_context or {}).get("tenant_id")
                    or (context.input_data or {}).get("tenant_id")
                ),
                user_id=(
                    (context.global_context or {}).get("user_id")
                    or (context.input_data or {}).get("user_id")
                ),
            )
            
            if response.get('success'):
                try:
                    result = json.loads(response['message'])
                    return {
                        'sentiment': result.get('sentiment', 'neutral'),
                        'confidence': result.get('confidence', 0.5),
                        'emotions': result.get('emotions', []),
                        'explanation': result.get('explanation', ''),
                        'text_length': len(text)
                    }
                except json.JSONDecodeError:
                    # 如果JSON解析失败，使用简单的关键词分析
                    positive_words = ['好', '棒', '优秀', '满意', '喜欢', 'good', 'great', 'excellent']
                    negative_words = ['坏', '差', '糟糕', '不满', '讨厌', 'bad', 'terrible', 'awful']
                    
                    text_lower = text.lower()
                    pos_count = sum(1 for word in positive_words if word in text_lower)
                    neg_count = sum(1 for word in negative_words if word in text_lower)
                    
                    if pos_count > neg_count:
                        sentiment = 'positive'
                        confidence = min(0.8, pos_count / (pos_count + neg_count + 1))
                    elif neg_count > pos_count:
                        sentiment = 'negative'
                        confidence = min(0.8, neg_count / (pos_count + neg_count + 1))
                    else:
                        sentiment = 'neutral'
                        confidence = 0.5
                    
                    return {
                        'sentiment': sentiment,
                        'confidence': confidence,
                        'emotions': [],
                        'explanation': f'基于关键词分析：正面词{pos_count}个，负面词{neg_count}个',
                        'text_length': len(text)
                    }
            else:
                raise Exception(f"LLM调用失败: {response.get('error', 'Unknown error')}")
                
        except Exception as e:
            logger.error(f"情感分析失败: {e}")
            return {
                'sentiment': 'neutral',
                'confidence': 0.0,
                'emotions': [],
                'explanation': f'分析失败: {str(e)}',
                'text_length': len(text),
                'error': str(e)
            }
    
    # ==================== 数据处理节点 ====================
    
    async def execute_data_filter_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """数据过滤节点"""
        config = node.config
        data = input_data.get('data', [])
        
        filter_type = config.get('filter_type', 'condition')
        filter_condition = config.get('filter_condition', '')
        
        try:
            if not isinstance(data, list):
                data = [data]
            
            filtered_data = []
            
            if filter_type == 'condition':
                # 条件过滤
                for item in data:
                    try:
                        # 创建安全的执行环境
                        safe_globals = {
                            'item': item,
                            'len': len,
                            'str': str,
                            'int': int,
                            'float': float,
                            'bool': bool,
                            'list': list,
                            'dict': dict,
                        }
                        
                        # 执行过滤条件
                        if eval(filter_condition, safe_globals):
                            filtered_data.append(item)
                    except Exception as e:
                        logger.warning(f"过滤条件执行失败: {e}")
                        continue
                        
            elif filter_type == 'key_exists':
                # 键存在过滤
                key = config.get('key', '')
                for item in data:
                    if isinstance(item, dict) and key in item:
                        filtered_data.append(item)
                        
            elif filter_type == 'value_range':
                # 值范围过滤
                key = config.get('key', '')
                min_val = config.get('min_value', float('-inf'))
                max_val = config.get('max_value', float('inf'))
                
                for item in data:
                    if isinstance(item, dict) and key in item:
                        try:
                            value = float(item[key])
                            if min_val <= value <= max_val:
                                filtered_data.append(item)
                        except (ValueError, TypeError):
                            continue
                            
            elif filter_type == 'unique':
                # 去重过滤
                seen = set()
                key = config.get('key', None)
                
                for item in data:
                    if key and isinstance(item, dict):
                        identifier = item.get(key)
                    else:
                        identifier = json.dumps(item, sort_keys=True)
                    
                    if identifier not in seen:
                        seen.add(identifier)
                        filtered_data.append(item)
            
            return {
                'filtered_data': filtered_data,
                'original_count': len(data),
                'filtered_count': len(filtered_data),
                'filter_type': filter_type,
                'filter_condition': filter_condition
            }
            
        except Exception as e:
            logger.error(f"数据过滤失败: {e}")
            return {
                'filtered_data': data,
                'original_count': len(data),
                'filtered_count': len(data),
                'filter_type': filter_type,
                'error': str(e)
            }
    
    async def execute_data_aggregator_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """数据聚合节点"""
        config = node.config
        data = input_data.get('data', [])
        
        aggregation_type = config.get('aggregation_type', 'count')
        group_by = config.get('group_by', None)
        
        try:
            if not isinstance(data, list):
                data = [data]
            
            if not data:
                return {
                    'aggregated_data': {},
                    'total_count': 0,
                    'aggregation_type': aggregation_type
                }
            
            # 转换为DataFrame进行聚合
            df = pd.DataFrame(data)
            
            if group_by and group_by in df.columns:
                # 按字段分组聚合
                if aggregation_type == 'count':
                    result = df.groupby(group_by).size().to_dict()
                elif aggregation_type == 'sum':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    if numeric_cols.empty:
                        result = df.groupby(group_by).size().to_dict()
                    else:
                        result = df.groupby(group_by)[numeric_cols].sum().to_dict()
                elif aggregation_type == 'avg':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    if numeric_cols.empty:
                        result = df.groupby(group_by).size().to_dict()
                    else:
                        result = df.groupby(group_by)[numeric_cols].mean().to_dict()
                elif aggregation_type == 'max':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    if numeric_cols.empty:
                        result = df.groupby(group_by).size().to_dict()
                    else:
                        result = df.groupby(group_by)[numeric_cols].max().to_dict()
                elif aggregation_type == 'min':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    if numeric_cols.empty:
                        result = df.groupby(group_by).size().to_dict()
                    else:
                        result = df.groupby(group_by)[numeric_cols].min().to_dict()
                else:
                    result = df.groupby(group_by).size().to_dict()
            else:
                # 全局聚合
                if aggregation_type == 'count':
                    result = {'total': len(df)}
                elif aggregation_type == 'sum':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    result = df[numeric_cols].sum().to_dict() if not numeric_cols.empty else {'total': len(df)}
                elif aggregation_type == 'avg':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    result = df[numeric_cols].mean().to_dict() if not numeric_cols.empty else {'total': len(df)}
                elif aggregation_type == 'max':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    result = df[numeric_cols].max().to_dict() if not numeric_cols.empty else {'total': len(df)}
                elif aggregation_type == 'min':
                    numeric_cols = df.select_dtypes(include=[np.number]).columns
                    result = df[numeric_cols].min().to_dict() if not numeric_cols.empty else {'total': len(df)}
                else:
                    result = {'total': len(df)}
            
            return {
                'aggregated_data': result,
                'total_count': len(data),
                'aggregation_type': aggregation_type,
                'group_by': group_by
            }
            
        except Exception as e:
            logger.error(f"数据聚合失败: {e}")
            return {
                'aggregated_data': {'total': len(data)},
                'total_count': len(data),
                'aggregation_type': aggregation_type,
                'error': str(e)
            }
    
    # ==================== 网络请求节点 ====================
    
    async def execute_http_request_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """HTTP请求节点"""
        config = node.config
        
        url = config.get('url', input_data.get('url', ''))
        method = config.get('method', 'GET').upper()
        headers = config.get('headers', {})
        params = config.get('params', {})
        data = config.get('data', input_data.get('data', {}))
        timeout = config.get('timeout', 30)
        
        try:
            # 构建请求参数
            request_kwargs = {
                'url': url,
                'headers': headers,
                'params': params,
                'timeout': timeout
            }
            
            if method in ['POST', 'PUT', 'PATCH']:
                if isinstance(data, dict):
                    request_kwargs['json'] = data
                else:
                    request_kwargs['data'] = data
            
            # 发送请求
            response = await self.http_client.request(method, **request_kwargs)
            
            # 尝试解析JSON响应
            try:
                response_data = response.json()
            except:
                response_data = response.text
            
            return {
                'status_code': response.status_code,
                'response_data': response_data,
                'headers': dict(response.headers),
                'success': response.status_code < 400,
                'url': url,
                'method': method
            }
            
        except Exception as e:
            logger.error(f"HTTP请求失败: {e}")
            return {
                'status_code': 0,
                'response_data': None,
                'headers': {},
                'success': False,
                'url': url,
                'method': method,
                'error': str(e)
            }
    
    async def execute_web_scraper_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """网页爬虫节点"""
        config = node.config
        
        url = config.get('url', input_data.get('url', ''))
        selector = config.get('selector', 'body')
        extract_type = config.get('extract_type', 'text')
        
        try:
            # 发送请求获取网页内容
            response = await self.http_client.get(url, timeout=30)
            response.raise_for_status()
            
            # 解析HTML
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 根据选择器提取内容
            elements = soup.select(selector)
            
            extracted_data = []
            for element in elements:
                if extract_type == 'text':
                    extracted_data.append(element.get_text().strip())
                elif extract_type == 'html':
                    extracted_data.append(str(element))
                elif extract_type == 'attributes':
                    extracted_data.append(dict(element.attrs))
                elif extract_type == 'links':
                    links = element.find_all('a', href=True)
                    for link in links:
                        href = link['href']
                        if href.startswith('/'):
                            href = urljoin(url, href)
                        extracted_data.append({
                            'text': link.get_text().strip(),
                            'url': href
                        })
                elif extract_type == 'images':
                    images = element.find_all('img', src=True)
                    for img in images:
                        src = img['src']
                        if src.startswith('/'):
                            src = urljoin(url, src)
                        extracted_data.append({
                            'alt': img.get('alt', ''),
                            'src': src
                        })
            
            return {
                'extracted_data': extracted_data,
                'element_count': len(elements),
                'url': url,
                'selector': selector,
                'extract_type': extract_type,
                'success': True
            }
            
        except Exception as e:
            logger.error(f"网页爬虫失败: {e}")
            return {
                'extracted_data': [],
                'element_count': 0,
                'url': url,
                'selector': selector,
                'extract_type': extract_type,
                'success': False,
                'error': str(e)
            }
    
    # ==================== 文件处理节点 ====================
    
    async def execute_file_processor_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """文件处理节点"""
        config = node.config
        
        file_path = config.get('file_path', input_data.get('file_path', ''))
        operation = config.get('operation', 'read')
        encoding = config.get('encoding', 'utf-8')
        
        try:
            if operation == 'read':
                # 读取文件
                with open(file_path, 'r', encoding=encoding) as f:
                    content = f.read()
                
                return {
                    'content': content,
                    'file_path': file_path,
                    'operation': operation,
                    'file_size': len(content),
                    'success': True
                }
                
            elif operation == 'write':
                # 写入文件
                content = input_data.get('content', '')
                with open(file_path, 'w', encoding=encoding) as f:
                    f.write(content)
                
                return {
                    'file_path': file_path,
                    'operation': operation,
                    'bytes_written': len(content.encode(encoding)),
                    'success': True
                }
                
            elif operation == 'append':
                # 追加到文件
                content = input_data.get('content', '')
                with open(file_path, 'a', encoding=encoding) as f:
                    f.write(content)
                
                return {
                    'file_path': file_path,
                    'operation': operation,
                    'bytes_appended': len(content.encode(encoding)),
                    'success': True
                }
                
            elif operation == 'delete':
                # 删除文件
                import os
                os.remove(file_path)
                
                return {
                    'file_path': file_path,
                    'operation': operation,
                    'success': True
                }
                
            else:
                raise ValueError(f"不支持的操作: {operation}")
                
        except Exception as e:
            logger.error(f"文件处理失败: {e}")
            return {
                'file_path': file_path,
                'operation': operation,
                'success': False,
                'error': str(e)
            }
    
    async def execute_json_processor_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """JSON处理节点"""
        config = node.config
        
        operation = config.get('operation', 'parse')
        json_data = input_data.get('json_data', '')
        
        try:
            if operation == 'parse':
                # 解析JSON字符串
                if isinstance(json_data, str):
                    parsed_data = json.loads(json_data)
                else:
                    parsed_data = json_data
                
                return {
                    'parsed_data': parsed_data,
                    'operation': operation,
                    'data_type': type(parsed_data).__name__,
                    'success': True
                }
                
            elif operation == 'stringify':
                # 将对象转换为JSON字符串
                json_string = json.dumps(
                    json_data,
                    ensure_ascii=False,
                    indent=config.get('indent', None)
                )
                
                return {
                    'json_string': json_string,
                    'operation': operation,
                    'string_length': len(json_string),
                    'success': True
                }
                
            elif operation == 'extract':
                # 提取JSON中的特定字段
                path = config.get('path', '')
                if isinstance(json_data, str):
                    data = json.loads(json_data)
                else:
                    data = json_data
                
                # 支持点表示法路径
                keys = path.split('.')
                current = data
                for key in keys:
                    if isinstance(current, dict) and key in current:
                        current = current[key]
                    elif isinstance(current, list) and key.isdigit():
                        index = int(key)
                        if 0 <= index < len(current):
                            current = current[index]
                        else:
                            current = None
                            break
                    else:
                        current = None
                        break
                
                return {
                    'extracted_value': current,
                    'operation': operation,
                    'path': path,
                    'success': True
                }
                
            elif operation == 'merge':
                # 合并多个JSON对象
                base_data = json_data if isinstance(json_data, dict) else {}
                merge_data = input_data.get('merge_data', {})
                
                if isinstance(merge_data, str):
                    merge_data = json.loads(merge_data)
                
                merged_data = {**base_data, **merge_data}
                
                return {
                    'merged_data': merged_data,
                    'operation': operation,
                    'success': True
                }
                
            else:
                raise ValueError(f"不支持的操作: {operation}")
                
        except Exception as e:
            logger.error(f"JSON处理失败: {e}")
            return {
                'operation': operation,
                'success': False,
                'error': str(e)
            }
    
    # ==================== 图像处理节点 ====================
    
    async def execute_image_processor_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """图像处理节点"""
        config = node.config
        
        image_data = input_data.get('image_data', '')
        operation = config.get('operation', 'info')
        
        try:
            # 解码图像数据
            if isinstance(image_data, str):
                if image_data.startswith('data:image'):
                    # Base64 data URL
                    image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
            else:
                image_bytes = image_data
            
            # 打开图像
            image = Image.open(io.BytesIO(image_bytes))
            
            if operation == 'info':
                # 获取图像信息
                return {
                    'width': image.width,
                    'height': image.height,
                    'format': image.format,
                    'mode': image.mode,
                    'size_bytes': len(image_bytes),
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'resize':
                # 调整图像大小
                width = config.get('width', 800)
                height = config.get('height', 600)
                
                resized_image = image.resize((width, height), Image.LANCZOS)
                
                # 转换为base64
                buffer = io.BytesIO()
                resized_image.save(buffer, format='PNG')
                resized_data = base64.b64encode(buffer.getvalue()).decode()
                
                return {
                    'processed_image': f"data:image/png;base64,{resized_data}",
                    'original_size': (image.width, image.height),
                    'new_size': (width, height),
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'crop':
                # 裁剪图像
                x = config.get('x', 0)
                y = config.get('y', 0)
                width = config.get('width', image.width)
                height = config.get('height', image.height)
                
                cropped_image = image.crop((x, y, x + width, y + height))
                
                # 转换为base64
                buffer = io.BytesIO()
                cropped_image.save(buffer, format='PNG')
                cropped_data = base64.b64encode(buffer.getvalue()).decode()
                
                return {
                    'processed_image': f"data:image/png;base64,{cropped_data}",
                    'original_size': (image.width, image.height),
                    'crop_area': (x, y, width, height),
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'rotate':
                # 旋转图像
                angle = config.get('angle', 90)
                
                rotated_image = image.rotate(angle, expand=True)
                
                # 转换为base64
                buffer = io.BytesIO()
                rotated_image.save(buffer, format='PNG')
                rotated_data = base64.b64encode(buffer.getvalue()).decode()
                
                return {
                    'processed_image': f"data:image/png;base64,{rotated_data}",
                    'original_size': (image.width, image.height),
                    'new_size': (rotated_image.width, rotated_image.height),
                    'angle': angle,
                    'operation': operation,
                    'success': True
                }
                
            else:
                raise ValueError(f"不支持的操作: {operation}")
                
        except Exception as e:
            logger.error(f"图像处理失败: {e}")
            return {
                'operation': operation,
                'success': False,
                'error': str(e)
            }
    
    # ==================== 时间处理节点 ====================
    
    async def execute_datetime_processor_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """日期时间处理节点"""
        config = node.config
        
        operation = config.get('operation', 'current')
        
        try:
            if operation == 'current':
                # 获取当前时间
                now = datetime.now()
                
                return {
                    'timestamp': now.timestamp(),
                    'iso_format': now.isoformat(),
                    'formatted': now.strftime(config.get('format', '%Y-%m-%d %H:%M:%S')),
                    'timezone': str(now.tzinfo),
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'parse':
                # 解析时间字符串
                time_string = input_data.get('time_string', '')
                time_format = config.get('format', '%Y-%m-%d %H:%M:%S')
                
                parsed_time = datetime.strptime(time_string, time_format)
                
                return {
                    'timestamp': parsed_time.timestamp(),
                    'iso_format': parsed_time.isoformat(),
                    'formatted': parsed_time.strftime('%Y-%m-%d %H:%M:%S'),
                    'year': parsed_time.year,
                    'month': parsed_time.month,
                    'day': parsed_time.day,
                    'hour': parsed_time.hour,
                    'minute': parsed_time.minute,
                    'second': parsed_time.second,
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'add':
                # 时间加法
                base_time = input_data.get('base_time', datetime.now())
                if isinstance(base_time, str):
                    base_time = datetime.fromisoformat(base_time)
                elif isinstance(base_time, (int, float)):
                    base_time = datetime.fromtimestamp(base_time)
                
                days = config.get('days', 0)
                hours = config.get('hours', 0)
                minutes = config.get('minutes', 0)
                seconds = config.get('seconds', 0)
                
                result_time = base_time + timedelta(
                    days=days,
                    hours=hours,
                    minutes=minutes,
                    seconds=seconds
                )
                
                return {
                    'timestamp': result_time.timestamp(),
                    'iso_format': result_time.isoformat(),
                    'formatted': result_time.strftime('%Y-%m-%d %H:%M:%S'),
                    'base_time': base_time.isoformat(),
                    'delta': {'days': days, 'hours': hours, 'minutes': minutes, 'seconds': seconds},
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'diff':
                # 时间差计算
                time1 = input_data.get('time1', datetime.now())
                time2 = input_data.get('time2', datetime.now())
                
                if isinstance(time1, str):
                    time1 = datetime.fromisoformat(time1)
                elif isinstance(time1, (int, float)):
                    time1 = datetime.fromtimestamp(time1)
                
                if isinstance(time2, str):
                    time2 = datetime.fromisoformat(time2)
                elif isinstance(time2, (int, float)):
                    time2 = datetime.fromtimestamp(time2)
                
                diff = time2 - time1
                
                return {
                    'total_seconds': diff.total_seconds(),
                    'days': diff.days,
                    'hours': diff.seconds // 3600,
                    'minutes': (diff.seconds % 3600) // 60,
                    'seconds': diff.seconds % 60,
                    'time1': time1.isoformat(),
                    'time2': time2.isoformat(),
                    'operation': operation,
                    'success': True
                }
                
            else:
                raise ValueError(f"不支持的操作: {operation}")
                
        except Exception as e:
            logger.error(f"时间处理失败: {e}")
            return {
                'operation': operation,
                'success': False,
                'error': str(e)
            }
    
    # ==================== 密码学节点 ====================
    
    async def execute_crypto_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """密码学处理节点"""
        config = node.config
        
        operation = config.get('operation', 'hash')
        data = input_data.get('data', '')
        
        try:
            if operation == 'hash':
                # 哈希运算
                algorithm = config.get('algorithm', 'sha256')
                
                if isinstance(data, str):
                    data_bytes = data.encode('utf-8')
                else:
                    data_bytes = str(data).encode('utf-8')
                
                if algorithm == 'md5':
                    hash_obj = hashlib.md5(data_bytes)
                elif algorithm == 'sha1':
                    hash_obj = hashlib.sha1(data_bytes)
                elif algorithm == 'sha256':
                    hash_obj = hashlib.sha256(data_bytes)
                elif algorithm == 'sha512':
                    hash_obj = hashlib.sha512(data_bytes)
                else:
                    raise ValueError(f"不支持的哈希算法: {algorithm}")
                
                return {
                    'hash_value': hash_obj.hexdigest(),
                    'algorithm': algorithm,
                    'input_length': len(data_bytes),
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'base64_encode':
                # Base64编码
                if isinstance(data, str):
                    data_bytes = data.encode('utf-8')
                else:
                    data_bytes = str(data).encode('utf-8')
                
                encoded_data = base64.b64encode(data_bytes).decode('utf-8')
                
                return {
                    'encoded_data': encoded_data,
                    'input_length': len(data_bytes),
                    'output_length': len(encoded_data),
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'base64_decode':
                # Base64解码
                try:
                    decoded_bytes = base64.b64decode(data)
                    decoded_data = decoded_bytes.decode('utf-8')
                except:
                    decoded_data = decoded_bytes.hex()
                
                return {
                    'decoded_data': decoded_data,
                    'input_length': len(data),
                    'output_length': len(decoded_bytes),
                    'operation': operation,
                    'success': True
                }
                
            elif operation == 'uuid':
                # 生成UUID
                import uuid
                
                version = config.get('version', 4)
                
                if version == 1:
                    generated_uuid = str(uuid.uuid1())
                elif version == 4:
                    generated_uuid = str(uuid.uuid4())
                else:
                    raise ValueError(f"不支持的UUID版本: {version}")
                
                return {
                    'uuid': generated_uuid,
                    'version': version,
                    'operation': operation,
                    'success': True
                }
                
            else:
                raise ValueError(f"不支持的操作: {operation}")
                
        except Exception as e:
            logger.error(f"密码学处理失败: {e}")
            return {
                'operation': operation,
                'success': False,
                'error': str(e)
            }


# 全局高级执行器实例
advanced_executors = AdvancedNodeExecutors()
