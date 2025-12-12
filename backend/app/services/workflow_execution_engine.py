"""
工作流执行引擎
支持节点间数据流传递、状态管理、错误处理等
"""

import asyncio
import json
import time
import uuid
from typing import Dict, List, Any, Optional, Callable, Tuple
from datetime import datetime
import structlog
from concurrent.futures import ThreadPoolExecutor
import networkx as nx

from app.schemas.workflow import (
    WorkflowDefinition,
    WorkflowNode,
    WorkflowEdge,
    WorkflowExecutionContext,
    ExecutionStep,
    DataFlowValidation,
    DataType
)
from app.services.llm_service import llm_service
from app.services.milvus_service import milvus_service
from app.services.elasticsearch_service import get_elasticsearch_service
from app.services.reranking_service import reranking_service, RerankingProvider
from app.services.workflow_error_handler import workflow_error_handler, WorkflowError, ErrorType
from app.services.workflow_parallel_executor import workflow_parallel_executor
from app.services.workflow_performance_monitor import workflow_performance_monitor

logger = structlog.get_logger(__name__)


class WorkflowExecutionEngine:
    """工作流执行引擎"""
    
    def __init__(self):
        self.node_executors = self._register_node_executors()
        self.thread_pool = ThreadPoolExecutor(max_workers=10)
        self.active_executions: Dict[str, WorkflowExecutionContext] = {}
        self.error_handler = workflow_error_handler
        self.node_cache: Dict[str, Dict[str, Any]] = {}  # 节点结果缓存
        self.execution_metrics: Dict[str, Dict[str, Any]] = {}  # 执行指标
        self.parallel_executor = workflow_parallel_executor
        self.enable_parallel_execution = True  # 是否启用并行执行
        self.performance_monitor = workflow_performance_monitor
        self.enable_performance_monitoring = True  # 是否启用性能监控
        
    def _register_node_executors(self) -> Dict[str, Callable]:
        """注册节点执行器"""
        return {
            'llm': self._execute_llm_node,
            'rag_retriever': self._execute_rag_retriever_node,
            'hybrid_retriever': self._execute_hybrid_retriever_node,
            'retriever': self._execute_retriever_node,
            'classifier': self._execute_classifier_node,
            'parser': self._execute_parser_node,
            'condition': self._execute_condition_node,
            'code_executor': self._execute_code_node,
            'input': self._execute_input_node,
            'output': self._execute_output_node,
            'data_transformer': self._execute_data_transformer_node,
            'embeddings': self._execute_embeddings_node,
            'reranker': self._execute_reranker_node,
        }
    
    async def execute_workflow(
        self,
        workflow_definition: WorkflowDefinition,
        input_data: Dict[str, Any],
        execution_id: Optional[str] = None,
        debug: bool = False,
        enable_parallel: Optional[bool] = None
    ) -> WorkflowExecutionContext:
        """执行工作流"""
        
        if not execution_id:
            execution_id = f"exec_{uuid.uuid4().hex[:8]}"
        
        # 创建执行上下文
        context = WorkflowExecutionContext(
            execution_id=execution_id,
            workflow_id=workflow_definition.id,
            start_time=time.time(),
            input_data=input_data,
            global_context=workflow_definition.global_config.copy()
        )
        
        self.active_executions[execution_id] = context
        
        try:
            # 验证工作流
            validation = await self._validate_workflow(workflow_definition)
            if not validation.is_valid:
                raise ValueError(f"工作流验证失败: {validation.errors}")
            
            # 构建执行图
            execution_graph = self._build_execution_graph(workflow_definition)
            
            # 决定执行方式
            use_parallel = enable_parallel if enable_parallel is not None else self.enable_parallel_execution
            
            if use_parallel and len(workflow_definition.nodes) > 2:
                # 使用并行执行
                await self.parallel_executor.execute_workflow_parallel(
                    workflow_definition,
                    context,
                    self,
                    debug
                )
            else:
                # 使用串行执行
                await self._execute_workflow_graph(
                    execution_graph,
                    workflow_definition,
                    context,
                    debug
                )
            
            context.status = "completed"
            context.end_time = time.time()
            
            logger.info(
                "工作流执行完成",
                execution_id=execution_id,
                duration=context.end_time - context.start_time
            )
            
            # 记录性能指标
            if self.enable_performance_monitoring:
                self.performance_monitor.record_workflow_execution(context)
            
        except Exception as e:
            context.status = "error"
            context.error = str(e)
            context.end_time = time.time()
            
            logger.error(
                "工作流执行失败",
                execution_id=execution_id,
                error=str(e),
                exc_info=True
            )
            
            # 记录性能指标
            if self.enable_performance_monitoring:
                self.performance_monitor.record_workflow_execution(context)
            
        finally:
            # 清理资源
            if execution_id in self.active_executions:
                del self.active_executions[execution_id]
            
            # 清理缓存
            self.clear_cache(execution_id)
            
            # 清理重试计数
            self.error_handler.clear_retry_counts()
            
            # 清理并行执行缓存
            if self.enable_parallel_execution:
                self.parallel_executor.reset_performance_cache()
            
            # 清理性能监控数据
            if self.enable_performance_monitoring:
                self.performance_monitor.clear_history()
        
        return context

    async def retry_from_node(
        self,
        workflow_definition: WorkflowDefinition,
        base_execution: WorkflowExecutionContext,
        start_node_id: str,
        debug: bool = False,
    ) -> WorkflowExecutionContext:
        """基于已有执行，从指定节点及其下游进行部分重试。

        逻辑：
        - 使用上一次执行的输出作为未受影响节点的输入缓存
        - 只重跑 start_node 及其所有下游节点
        - 保持与 execute_workflow 相同的步骤记录结构
        """
        import time as _time
        import uuid as _uuid
        
        new_execution_id = f"exec_{_uuid.uuid4().hex[:8]}"
        context = WorkflowExecutionContext(
            execution_id=new_execution_id,
            workflow_id=workflow_definition.id,
            start_time=_time.time(),
            input_data=base_execution.input_data.copy() if base_execution.input_data else {},
            global_context=workflow_definition.global_config.copy(),
        )

        try:
            # 验证工作流
            validation = await self._validate_workflow(workflow_definition)
            if not validation.is_valid:
                raise ValueError(f"工作流验证失败: {validation.errors}")

            # 构建执行图
            graph = self._build_execution_graph(workflow_definition)

            if start_node_id not in graph.nodes:
                raise ValueError(f"起始节点不存在: {start_node_id}")

            # 计算受影响节点集合（起始节点 + 所有下游）
            affected = set()
            try:
                import networkx as _nx
                affected = set(_nx.descendants(graph, start_node_id))
            except Exception:
                affected = set()
            affected.add(start_node_id)

            # 预填充节点输出（未受影响节点使用历史输出）
            preserved_outputs: Dict[str, Dict[str, Any]] = {}
            for step in base_execution.steps or []:
                if step.node_id not in affected and isinstance(step.output_data, dict):
                    preserved_outputs[step.node_id] = step.output_data

            node_data: Dict[str, Dict[str, Any]] = {}
            node_data.update(preserved_outputs)

            # 使用拓扑顺序，只对受影响节点执行
            execution_order = list(nx.topological_sort(graph))
            for node_id in execution_order:
                if node_id not in affected:
                    # 未受影响节点跳过执行（使用保留的输出）
                    continue

                node: WorkflowNode = graph.nodes[node_id]['node']

                # 收集输入（会从 node_data 中获取未受影响前驱的输出）
                input_payload = await self._collect_node_input_data(
                    node_id, graph, node_data, context
                )

                # 记录步骤
                step = ExecutionStep(
                    step_id=f"step_{len(context.steps)}",
                    node_id=node_id,
                    node_name=node.name,
                    input_data=input_payload,
                    start_time=_time.time(),
                )
                context.steps.append(step)

                # 执行节点（带错误处理）
                output_payload = await self._execute_node_with_error_handling(
                    node, input_payload, context, step, debug
                )

                # 存储、缓存
                node_data[node_id] = output_payload
                cache_key = f"{node_id}_{context.execution_id}"
                self.node_cache[cache_key] = output_payload

                if debug:
                    logger.info(
                        "部分重试：节点执行完成",
                        node_id=node_id,
                        duration=step.duration,
                        output_keys=list(output_payload.keys()),
                    )

            # 组装最终输出（优先输出节点，否则最后一个受影响节点）
            output_nodes = [n for n in workflow_definition.nodes if n.type == 'output']
            if output_nodes:
                final_output: Dict[str, Any] = {}
                for out_node in output_nodes:
                    if out_node.id in node_data:
                        final_output.update(node_data[out_node.id])
                    elif out_node.id in preserved_outputs:
                        final_output.update(preserved_outputs[out_node.id])
                context.output_data = final_output
            else:
                # 回退：受影响节点的最后一个在拓扑序中的节点
                last_affected = None
                for nid in reversed(execution_order):
                    if nid in affected:
                        last_affected = nid
                        break
                if last_affected is not None:
                    context.output_data = node_data.get(last_affected, {})
                else:
                    context.output_data = {}

            context.status = "completed"
            context.end_time = _time.time()

            logger.info(
                "部分重试完成",
                execution_id=new_execution_id,
                start_node=start_node_id,
                duration=context.end_time - context.start_time,
            )

            if self.enable_performance_monitoring:
                self.performance_monitor.record_workflow_execution(context)

        except Exception as e:
            context.status = "error"
            context.error = str(e)
            context.end_time = _time.time()
            logger.error(
                "部分重试失败",
                execution_id=new_execution_id,
                error=str(e),
                exc_info=True,
            )
            if self.enable_performance_monitoring:
                self.performance_monitor.record_workflow_execution(context)
        finally:
            if new_execution_id in self.active_executions:
                del self.active_executions[new_execution_id]
            # 清理缓存与计数器
            self.clear_cache(new_execution_id)
            self.error_handler.clear_retry_counts()
            if self.enable_parallel_execution:
                self.parallel_executor.reset_performance_cache()
            if self.enable_performance_monitoring:
                self.performance_monitor.clear_history()

        return context
    
    async def _validate_workflow(self, workflow: WorkflowDefinition) -> DataFlowValidation:
        """验证工作流定义"""
        errors = []
        warnings = []
        suggestions = []
        
        # 检查是否有孤立节点
        node_ids = {node.id for node in workflow.nodes}
        connected_nodes = set()
        
        for edge in workflow.edges:
            if edge.source not in node_ids:
                errors.append(f"边 {edge.id} 的源节点 {edge.source} 不存在")
            if edge.target not in node_ids:
                errors.append(f"边 {edge.id} 的目标节点 {edge.target} 不存在")
            
            connected_nodes.add(edge.source)
            connected_nodes.add(edge.target)
        
        # 检查孤立节点
        isolated_nodes = node_ids - connected_nodes
        if isolated_nodes:
            warnings.append(f"发现孤立节点: {isolated_nodes}")
        
        # 检查循环依赖
        try:
            graph = nx.DiGraph()
            for edge in workflow.edges:
                graph.add_edge(edge.source, edge.target)
            
            if not nx.is_directed_acyclic_graph(graph):
                errors.append("工作流中存在循环依赖")
        except Exception as e:
            errors.append(f"图结构验证失败: {str(e)}")
        
        # 检查输入输出匹配
        node_map = {node.id: node for node in workflow.nodes}
        for edge in workflow.edges:
            source_node = node_map.get(edge.source)
            target_node = node_map.get(edge.target)
            
            if source_node and target_node:
                # 检查输出是否存在（允许 'output' / 'output-0' 作为通用别名）
                source_outputs = [out.name for out in source_node.function_signature.outputs]
                if (
                    edge.source_output not in source_outputs
                    and edge.source_output not in ('output', 'output-0')
                ):
                    errors.append(
                        f"节点 {edge.source} 没有输出 {edge.source_output}"
                    )
                
                # 检查输入是否存在（允许 'input' / 'input-0' 作为通用别名）
                target_inputs = [inp.name for inp in target_node.function_signature.inputs]
                if (
                    edge.target_input not in target_inputs
                    and edge.target_input not in ('input', 'input-0')
                ):
                    errors.append(
                        f"节点 {edge.target} 没有输入 {edge.target_input}"
                    )
        
        return DataFlowValidation(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions
        )
    
    def _build_execution_graph(self, workflow: WorkflowDefinition) -> nx.DiGraph:
        """构建执行图"""
        graph = nx.DiGraph()
        
        # 添加节点
        for node in workflow.nodes:
            graph.add_node(node.id, node=node)
        
        # 添加边
        for edge in workflow.edges:
            graph.add_edge(edge.source, edge.target, edge=edge)
        
        return graph
    
    async def _execute_workflow_graph(
        self,
        graph: nx.DiGraph,
        workflow_definition: WorkflowDefinition,
        context: WorkflowExecutionContext,
        debug: bool = False
    ):
        """执行工作流图"""
        
        # 找到起始节点（入度为0的节点）
        start_nodes = [node for node in graph.nodes() if graph.in_degree(node) == 0]
        
        if not start_nodes:
            # 如果没有起始节点，找到输入节点
            start_nodes = [
                node.id for node in workflow_definition.nodes 
                if node.type == 'input'
            ]
        
        if not start_nodes:
            raise ValueError("未找到起始节点")
        
        # 使用拓扑排序确定执行顺序
        execution_order = list(nx.topological_sort(graph))
        
        # 节点数据存储
        node_data: Dict[str, Dict[str, Any]] = {}
        
        # 初始化输入数据
        for node_id in start_nodes:
            node_data[node_id] = context.input_data.copy()
        
        # 按顺序执行节点
        for node_id in execution_order:
            node = graph.nodes[node_id]['node']
            
            # 收集输入数据
            input_data = await self._collect_node_input_data(
                node_id, graph, node_data, context
            )
            
            # 执行节点
            step = ExecutionStep(
                step_id=f"step_{len(context.steps)}",
                node_id=node_id,
                node_name=node.name,
                input_data=input_data,
                start_time=time.time()
            )
            
            context.steps.append(step)
            
            # 执行节点（带错误处理）
            output_data = await self._execute_node_with_error_handling(
                node, input_data, context, step, debug
            )
            
            # 存储节点输出
            node_data[node_id] = output_data
            
            # 缓存节点结果
            cache_key = f"{node_id}_{context.execution_id}"
            self.node_cache[cache_key] = output_data
            
            if debug:
                logger.info(
                    "节点执行完成",
                    node_id=node_id,
                    duration=step.duration,
                    output_keys=list(output_data.keys())
                )
        
        # 设置最终输出
        output_nodes = [
            node for node in workflow_definition.nodes 
            if node.type == 'output'
        ]
        
        if output_nodes:
            # 从输出节点收集数据
            final_output = {}
            for output_node in output_nodes:
                if output_node.id in node_data:
                    final_output.update(node_data[output_node.id])
            context.output_data = final_output
        else:
            # 使用最后一个节点的输出
            if execution_order:
                last_node_id = execution_order[-1]
                context.output_data = node_data.get(last_node_id, {})
    
    async def _collect_node_input_data(
        self,
        node_id: str,
        graph: nx.DiGraph,
        node_data: Dict[str, Dict[str, Any]],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """收集节点输入数据"""
        
        input_data: Dict[str, Any] = {}

        # 获取目标节点签名（用于解析别名）
        target_node: WorkflowNode = graph.nodes[node_id]['node']
        target_inputs = [inp.name for inp in target_node.function_signature.inputs]

        def resolve_target_input(name: str) -> str:
            # 允许前端默认句柄名 'input' 作别名
            if name in target_inputs and name:
                return name
            # 常见优先级
            priority = ['data', 'prompt', 'text']
            for p in priority:
                if p in target_inputs:
                    return p
            return target_inputs[0] if target_inputs else name

        # 从前驱节点收集数据
        for predecessor in graph.predecessors(node_id):
            edge_data = graph.edges[predecessor, node_id]['edge']

            if predecessor in node_data:
                source_payload = node_data[predecessor]

                # 解析源节点输出别名
                source_node: WorkflowNode = graph.nodes[predecessor]['node']
                source_outputs = [out.name for out in source_node.function_signature.outputs]
                src_key = edge_data.source_output
                if src_key not in source_payload:
                    if src_key == 'output' or (isinstance(src_key, str) and src_key.startswith('output')):
                        # 使用首选输出字段
                        prefer = ['content', 'result', 'documents', 'data']
                        chosen = next((k for k in prefer if k in source_payload), None)
                        if not chosen and source_outputs:
                            chosen = source_outputs[0]
                        src_key = chosen or src_key

                value = source_payload.get(src_key) if isinstance(source_payload, dict) else None
                if value is None:
                    # 回退到整体传递
                    value = source_payload

                # 应用数据转换
                if edge_data.transform:
                    value = await self._apply_data_transform(
                        value, edge_data.transform, context
                    )

                # 解析目标输入别名
                # 解析目标输入别名（input / input-0）
                const_key = edge_data.target_input
                if isinstance(const_key, str) and const_key.startswith('input'):
                    const_key = 'input'
                dst_key = resolve_target_input(const_key)

                # 合并策略：若目标键为 'data' 且均为字典则合并
                if dst_key == 'data' and isinstance(value, dict) and isinstance(input_data.get('data'), dict):
                    input_data['data'] = {**input_data['data'], **value}
                else:
                    input_data[dst_key] = value
        
        # 如果没有输入数据，使用全局输入
        if not input_data:
            input_data = context.input_data.copy()

        # 覆写：如果节点配置里声明了 overrides，则为缺失字段填充静态值
        try:
            target = graph.nodes[node_id]['node']
            cfg = getattr(target, 'config', {}) if hasattr(target, 'config') else {}
            overrides = cfg.get('overrides', {}) if isinstance(cfg, dict) else {}
            if isinstance(overrides, dict):
                for k, v in overrides.items():
                    if k and (k not in input_data or input_data[k] in (None, '')) and v not in (None, ''):
                        input_data[k] = v
        except Exception:
            pass

        return input_data
    
    async def _apply_data_transform(
        self,
        value: Any,
        transform_code: str,
        context: WorkflowExecutionContext
    ) -> Any:
        """应用数据转换"""
        
        try:
            # 创建安全的执行环境
            safe_globals = {
                'json': json,
                'len': len,
                'str': str,
                'int': int,
                'float': float,
                'bool': bool,
                'list': list,
                'dict': dict,
                'value': value,
                'context': context.global_context,
            }
            
            # 执行转换代码
            exec_globals = safe_globals.copy()
            exec(f"result = {transform_code}", exec_globals)
            
            return exec_globals['result']
            
        except Exception as e:
            logger.error(
                "数据转换失败",
                transform_code=transform_code,
                error=str(e),
                exc_info=True
            )
            return value
    
    async def _execute_node_with_error_handling(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext,
        step: ExecutionStep,
        debug: bool = False
    ) -> Dict[str, Any]:
        """执行节点（带错误处理）"""
        
        max_attempts = 3
        attempt = 0
        
        while attempt < max_attempts:
            try:
                step.status = "running"
                
                # 执行节点
                output_data = await self._execute_node(node, input_data, context)
                
                step.output_data = output_data
                step.status = "completed"
                step.end_time = time.time()
                step.duration = step.end_time - step.start_time
                
                # 更新执行指标
                self._update_execution_metrics(node.id, True, step.duration)
                
                return output_data
                
            except Exception as e:
                attempt += 1
                step.status = "error"
                step.error = str(e)
                step.end_time = time.time()
                step.duration = step.end_time - step.start_time
                
                logger.error(
                    "节点执行失败",
                    node_id=node.id,
                    attempt=attempt,
                    error=str(e),
                    exc_info=True
                )
                
                # 使用错误处理器处理错误
                recovery_result = await self.error_handler.handle_error(
                    e, node, context, step
                )
                
                # 根据恢复结果决定下一步行动
                if recovery_result['success']:
                    action = recovery_result['action']
                    
                    if action == 'retry':
                        # 重试，继续循环
                        continue
                    elif action in ['skip_node', 'use_fallback', 'use_cached_result', 'use_default_value']:
                        # 使用恢复数据
                        recovery_data = recovery_result.get('data', {})
                        
                        step.output_data = recovery_data
                        step.status = "recovered"
                        step.error = f"Recovered using {action}: {recovery_result.get('message', '')}"
                        
                        # 更新执行指标
                        self._update_execution_metrics(node.id, False, step.duration)
                        
                        return recovery_data
                    else:
                        # 其他恢复动作
                        break
                else:
                    # 恢复失败
                    if recovery_result['action'] == 'fail_fast':
                        # 快速失败，直接抛出异常
                        raise e
                    else:
                        # 其他失败情况，继续尝试或退出
                        break
        
        # 所有尝试都失败了
        step.status = "error"
        self._update_execution_metrics(node.id, False, step.duration)
        
        # 检查是否忽略错误
        if node.config.get('ignore_errors', False):
            step.status = "ignored"
            step.error = f"Error ignored: {str(e)}"
            return {}
        else:
            # 抛出最后的错误
            raise e
    
    async def _execute_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行节点"""
        
        if node.type in self.node_executors:
            executor = self.node_executors[node.type]
            return await executor(node, input_data, context)
        else:
            raise ValueError(f"未知的节点类型: {node.type}")
    
    def _update_execution_metrics(self, node_id: str, success: bool, duration: float):
        """更新执行指标"""
        if node_id not in self.execution_metrics:
            self.execution_metrics[node_id] = {
                'total_executions': 0,
                'successful_executions': 0,
                'failed_executions': 0,
                'total_duration': 0,
                'avg_duration': 0,
                'success_rate': 0
            }
        
        metrics = self.execution_metrics[node_id]
        metrics['total_executions'] += 1
        metrics['total_duration'] += duration
        
        if success:
            metrics['successful_executions'] += 1
        else:
            metrics['failed_executions'] += 1
        
        metrics['avg_duration'] = metrics['total_duration'] / metrics['total_executions']
        metrics['success_rate'] = metrics['successful_executions'] / metrics['total_executions']
    
    # 节点执行器实现
    async def _execute_llm_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行LLM节点"""
        
        config = node.config
        
        # 处理输入数据 - 更智能的数据提取
        actual_data = input_data
        
        # 如果数据被多层包装，逐层解包
        while 'data' in actual_data and isinstance(actual_data['data'], dict) and len(actual_data) == 1:
            actual_data = actual_data['data']
        
        # 如果还有data键但不是唯一键，则优先使用data内的数据，但保持其他键
        if 'data' in actual_data and isinstance(actual_data['data'], dict):
            # 合并data内的数据和外层数据
            merged_data = {**actual_data}
            merged_data.update(actual_data['data'])
            actual_data = merged_data
        
        # 尝试从多个可能的键中获取提示词
        prompt = (
            actual_data.get('prompt') or 
            actual_data.get('text') or 
            actual_data.get('input') or 
            actual_data.get('query') or
            actual_data.get('message') or
            (str(actual_data) if isinstance(actual_data, str) else '')
        )
        
        # 确保prompt是字符串
        if not isinstance(prompt, str):
            prompt = str(prompt) if prompt is not None else ''
        
        system_prompt = config.get('system_prompt', '')
        
        # 构建完整提示
        if system_prompt:
            full_prompt = f"{system_prompt}\n\n{prompt}"
        else:
            full_prompt = prompt
        
        print(f"DEBUG: LLM node received input_data: {input_data}")
        print(f"DEBUG: After processing, actual_data: {actual_data}")
        print(f"DEBUG: Extracted prompt: '{prompt}'")
        print(f"DEBUG: Full prompt: '{full_prompt}'")
        
        # 调用LLM服务
        tenant_id = (
            (context.global_context or {}).get("tenant_id")
            or (context.input_data or {}).get("tenant_id")
        )
        response = await llm_service.chat(
            message=full_prompt,
            model=config.get('model', 'qwen-turbo'),
            temperature=config.get('temperature', 0.7),
            max_tokens=config.get('max_tokens', 1000),
            tenant_id=tenant_id,
        )
        
        if response.get('success'):
            return {
                'content': response['message'],
                'metadata': {
                    'tokens_used': response.get('usage', {}).get('total_tokens', 0),
                    'model': config.get('model', 'qwen-turbo'),
                    'finish_reason': response.get('finish_reason', 'stop')
                }
            }
        else:
            raise RuntimeError(f"LLM调用失败: {response.get('error', 'Unknown error')}")
    
    async def _execute_rag_retriever_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行RAG检索节点"""
        
        config = node.config
        query = input_data.get('query', '')
        knowledge_base = config.get('knowledge_base', '')
        top_k = config.get('top_k', 5)

        # 获取租户ID（优先从全局上下文，其次从输入数据）
        tenant_id = (
            (context.global_context or {}).get("tenant_id")
            or (context.input_data or {}).get("tenant_id")
        )
        if tenant_id is None:
            raise RuntimeError("缺少租户ID，无法执行RAG检索节点")

        # 生成查询向量
        embedding_response = await llm_service.get_embeddings(
            texts=[query], tenant_id=tenant_id
        )

        if not embedding_response.get('success'):
            raise RuntimeError("向量生成失败")

        query_vector = embedding_response['embeddings'][0]

        # 向量搜索（按租户隔离集合）
        collection_name = f"tenant_{tenant_id}_{knowledge_base}"
        results = await milvus_service.search(
            collection_name=collection_name,
            query_vector=query_vector,
            top_k=top_k
        )
        
        return {
            'documents': [
                {
                    'text': result['text'],
                    'score': 1.0 / (1.0 + result.get('distance', 0)),
                    'metadata': result.get('metadata', {})
                }
                for result in results
            ],
            'query': query,
            'total_results': len(results)
        }

    async def _execute_hybrid_retriever_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行混合检索节点（向量 + 关键词）"""

        config = node.config or {}
        query = (
            input_data.get('query')
            or input_data.get('text')
            or input_data.get('prompt')
            or ''
        )
        knowledge_base = config.get('knowledge_base', '')
        top_k = int(config.get('top_k', 5))

        if not query:
            return {'documents': [], 'query': '', 'total_results': 0}

        # 获取租户ID
        tenant_id = (
            (context.global_context or {}).get('tenant_id')
            or (context.input_data or {}).get('tenant_id')
        )
        if tenant_id is None:
            raise RuntimeError("缺少租户ID，无法执行混合检索")

        # 生成查询向量
        embedding_response = await llm_service.get_embeddings(
            texts=[query], tenant_id=tenant_id
        )
        if not embedding_response.get('success'):
            raise RuntimeError("向量生成失败")
        query_vector = embedding_response['embeddings'][0]

        tenant_collection_name = f"tenant_{tenant_id}_{knowledge_base}"
        tenant_index_name = tenant_collection_name

        # 向量检索
        async def safe_vector_search():
            try:
                return await milvus_service.search(
                    collection_name=tenant_collection_name,
                    query_vector=query_vector,
                    top_k=top_k
                )
            except Exception as e:
                # 尝试维度自修复
                if (
                    'dimension mismatch' in str(e).lower()
                    or 'vector dimension' in str(e).lower()
                    or 'should divide the dim' in str(e).lower()
                ):
                    try:
                        milvus_service.recreate_collection_with_new_dimension(
                            tenant_collection_name, len(query_vector)
                        )
                        return await milvus_service.search(
                            collection_name=tenant_collection_name,
                            query_vector=query_vector,
                            top_k=top_k
                        )
                    except Exception:
                        return []
                return []

        vector_task = asyncio.create_task(safe_vector_search())

        # 关键词检索（ES 可选）
        keyword_task = None
        try:
            es_service = await get_elasticsearch_service()
            if es_service is not None:
                keyword_task = asyncio.create_task(
                    es_service.search(
                        index_name=tenant_index_name,
                        query=query,
                        top_k=top_k,
                        filter_query={"tenant_id": tenant_id}
                    )
                )
        except Exception:
            keyword_task = None

        if keyword_task:
            vector_results, keyword_results = await asyncio.gather(
                vector_task, keyword_task, return_exceptions=True
            )
        else:
            vector_results = await vector_task
            keyword_results = []

        if isinstance(vector_results, Exception):
            vector_results = []
        if isinstance(keyword_results, Exception):
            keyword_results = []

        unified_docs = []
        for res in vector_results or []:
            unified_docs.append({
                'text': res.get('text', ''),
                'score': 1.0 / (1.0 + res.get('distance', 0)),
                'source': 'vector',
                'metadata': {
                    'document_name': res.get('document_name', ''),
                    'knowledge_base': res.get('knowledge_base', knowledge_base)
                }
            })

        existing_texts = {d['text'] for d in unified_docs}
        for res in keyword_results or []:
            text = res.get('text', '')
            if text and text not in existing_texts:
                unified_docs.append({
                    'text': text,
                    'score': res.get('score', 0),
                    'source': 'keyword',
                    'metadata': {
                        'document_name': res.get('document_name', ''),
                        'knowledge_base': knowledge_base
                    }
                })

        return {
            'documents': unified_docs,
            'query': query,
            'total_results': len(unified_docs)
        }

    async def _execute_retriever_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """统一检索节点：支持 vector / keyword / hybrid 模式"""
        cfg = node.config or {}
        mode = str(cfg.get('mode', 'hybrid')).lower()
        knowledge_base = cfg.get('knowledge_base', '')
        top_k = int(cfg.get('top_k', 5))

        if mode == 'vector':
            return await self._execute_rag_retriever_node(node, input_data, context)
        if mode == 'hybrid':
            return await self._execute_hybrid_retriever_node(node, input_data, context)

        # keyword 模式
        query = input_data.get('query') or input_data.get('text') or input_data.get('prompt') or ''
        if not query:
            return {'documents': [], 'query': '', 'total_results': 0}

        tenant_id = (
            (context.global_context or {}).get('tenant_id')
            or (context.input_data or {}).get('tenant_id')
        )
        if tenant_id is None:
            raise RuntimeError('缺少租户ID，无法执行关键词检索')

        index_name = f"tenant_{tenant_id}_{knowledge_base}"
        try:
            es_service = await get_elasticsearch_service()
            results = []
            if es_service is not None:
                results = await es_service.search(
                    index_name=index_name,
                    query=query,
                    top_k=top_k,
                    filter_query={'tenant_id': tenant_id}
                )
            docs = [
                {
                    'text': r.get('text', ''),
                    'score': r.get('score', 0),
                    'source': 'keyword',
                    'metadata': {'knowledge_base': knowledge_base}
                }
                for r in results or []
            ]
            return {'documents': docs, 'query': query, 'total_results': len(docs)}
        except Exception as e:
            logger.warning('Keyword retriever failed', error=str(e))
            return {'documents': [], 'query': query, 'total_results': 0}
    
    async def _execute_classifier_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行分类节点"""
        
        config = node.config
        text = input_data.get('text', '')
        classes = config.get('classes', [])
        
        # 构建分类提示
        prompt = f"将以下文本分类到这些类别中的一个：{', '.join(classes)}\n\n文本：{text}\n\n类别："

        tenant_id = (
            (context.global_context or {}).get('tenant_id')
            or (context.input_data or {}).get('tenant_id')
        )
        response = await llm_service.chat(
            message=prompt,
            model=config.get('model', 'qwen-turbo'),
            temperature=0.1,
            max_tokens=50,
            tenant_id=tenant_id,
        )
        
        if response.get('success'):
            predicted_class = response['message'].strip()
            
            # 计算置信度（简单实现）
            confidence = 0.8 if predicted_class in classes else 0.3
            
            return {
                'class': predicted_class,
                'confidence': confidence,
                'all_classes': classes,
                'raw_response': response['message']
            }
        else:
            raise RuntimeError(f"分类失败: {response.get('error', 'Unknown error')}")
    
    async def _execute_condition_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行条件节点"""
        
        config = node.config
        condition_type = config.get('condition_type', 'equals')
        condition_value = config.get('condition_value', '')
        field_path = config.get('field_path', 'value')
        
        # 从输入数据中获取值
        value = self._get_nested_value(input_data, field_path)
        
        # 评估条件
        if condition_type == 'equals':
            result = value == condition_value
        elif condition_type == 'contains':
            result = condition_value in str(value)
        elif condition_type == 'greater_than':
            result = float(value) > float(condition_value)
        elif condition_type == 'less_than':
            result = float(value) < float(condition_value)
        else:
            result = bool(value)
        
        return {
            'condition_result': result,
            'evaluated_value': value,
            'condition_type': condition_type,
            'condition_value': condition_value
        }
    
    async def _execute_code_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行代码节点"""
        
        config = node.config
        code = config.get('code', '')
        language = config.get('language', 'python')
        
        if language == 'python':
            # 创建安全的执行环境
            safe_globals = {
                'json': json,
                'len': len,
                'str': str,
                'int': int,
                'float': float,
                'bool': bool,
                'list': list,
                'dict': dict,
                'print': print,
                'input_data': input_data,
                'context': context.global_context,
            }
            
            # 执行代码
            exec_globals = safe_globals.copy()
            exec(code, exec_globals)
            
            # 获取结果
            result = exec_globals.get('result', {})
            
            return {
                'result': result,
                'execution_output': 'Code executed successfully'
            }
        else:
            raise ValueError(f"不支持的语言: {language}")
    
    async def _execute_input_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行输入节点"""
        print(f"DEBUG: Input node received: {input_data}")
        
        # 检查输入数据是否已经被包装在'data'中
        if 'data' in input_data and isinstance(input_data['data'], dict):
            # 如果已经包装，直接返回包装的数据
            result = input_data['data']
            print(f"DEBUG: Input node returning unwrapped data: {result}")
            return result
        else:
            # 如果没有包装，返回完整的input_data
            print(f"DEBUG: Input node returning original data: {input_data}")
            return input_data
    
    async def _execute_output_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行输出节点"""
        
        config = node.config
        output_format = config.get('format', 'json')
        template = config.get('template', '')

        # 兼容 'data' 包装
        payload = input_data.get('data', input_data)

        if template:
            # 使用模板格式化输出，避免缺失键报错
            try:
                class _SafeDict(dict):
                    def __missing__(self, key):
                        return ''
                formatted_output = template.format_map(_SafeDict(payload if isinstance(payload, dict) else {}))
                return {'result': formatted_output}
            except Exception as e:
                logger.warning(f"模板格式化失败: {e}")
                return {'result': payload}
        else:
            # 直接返回输入数据
            return {'result': payload}
    
    async def _execute_data_transformer_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行数据转换节点"""
        
        config = node.config
        transform_type = config.get('transform_type', 'json')
        
        if transform_type == 'json':
            # JSON转换
            json_str = json.dumps(input_data, ensure_ascii=False, indent=2)
            return {'json_output': json_str}
        elif transform_type == 'extract':
            # 提取特定字段
            fields = config.get('fields', [])
            extracted = {field: input_data.get(field) for field in fields}
            return extracted
        else:
            return input_data
    
    async def _execute_embeddings_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行嵌入节点"""
        
        config = node.config
        text = input_data.get('text', '')
        model = config.get('model', 'text-embedding-v2')

        tenant_id = (
            (context.global_context or {}).get('tenant_id')
            or (context.input_data or {}).get('tenant_id')
        )

        # 生成嵌入
        response = await llm_service.get_embeddings(
            texts=[text], model=model, tenant_id=tenant_id
        )
        
        if response.get('success'):
            return {
                'embedding': response['embeddings'][0],
                'dimensions': len(response['embeddings'][0]),
                'model': model,
                'text': text
            }
        else:
            raise RuntimeError(f"嵌入生成失败: {response.get('error', 'Unknown error')}")
    
    async def _execute_parser_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行解析节点"""
        
        config = node.config
        text = input_data.get('text', '')
        parser_type = config.get('parser_type', 'json')
        
        if parser_type == 'json':
            # JSON解析
            try:
                parsed_data = json.loads(text)
                return {
                    'parsed_data': parsed_data,
                    'parser_type': parser_type,
                    'success': True
                }
            except json.JSONDecodeError as e:
                return {
                    'parsed_data': {},
                    'parser_type': parser_type,
                    'success': False,
                    'error': f"JSON解析失败: {str(e)}"
                }
        elif parser_type == 'extract_fields':
            # 字段提取
            fields = config.get('fields', [])
            patterns = config.get('patterns', {})
            
            extracted = {}
            for field in fields:
                if field in patterns:
                    # 使用正则表达式提取
                    import re
                    pattern = patterns[field]
                    match = re.search(pattern, text)
                    extracted[field] = match.group(1) if match else None
                else:
                    # 简单字符串匹配
                    extracted[field] = text if field in text.lower() else None
            
            return {
                'parsed_data': extracted,
                'parser_type': parser_type,
                'success': True
            }
        else:
            # 默认返回原始文本
            return {
                'parsed_data': {'content': text},
                'parser_type': parser_type,
                'success': True
            }

    async def _execute_reranker_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行重排序节点（接入 reranking_service）"""
        
        config = node.config or {}
        query = input_data.get('query', '')
        documents = input_data.get('documents', [])
        top_k = int(config.get('top_k', 5))

        provider_str = str(config.get('provider', 'bge')).lower()
        provider_map = {
            'bge': RerankingProvider.BGE,
            'qwen': RerankingProvider.QWEN,
            'cohere': RerankingProvider.COHERE,
            'local': RerankingProvider.LOCAL,
            'none': RerankingProvider.NONE,
        }
        provider = provider_map.get(provider_str, RerankingProvider.BGE)

        tenant_id = (
            (context.global_context or {}).get("tenant_id")
            or (context.input_data or {}).get("tenant_id")
        )
        reranked_docs = await reranking_service.rerank_documents(
            query=query,
            documents=documents,
            provider=provider,
            top_k=top_k,
            tenant_id=tenant_id,
        )

        # 提供两个键位以兼容不同工作流配置
        return {
            'documents': reranked_docs,
            'reranked_documents': reranked_docs,
            'query': query,
            'total_results': len(reranked_docs)
        }
    
    def _calculate_similarity(self, query: str, text: str) -> float:
        """计算文本相似度（简单实现）"""
        query_words = set(query.lower().split())
        text_words = set(text.lower().split())
        
        if not query_words or not text_words:
            return 0.0
        
        intersection = query_words & text_words
        union = query_words | text_words
        
        return len(intersection) / len(union)
    
    def _get_nested_value(self, data: Dict[str, Any], path: str) -> Any:
        """获取嵌套字典的值"""
        keys = path.split('.')
        current = data
        
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return None
        
        return current
    
    async def get_execution_status(self, execution_id: str) -> Optional[WorkflowExecutionContext]:
        """获取执行状态"""
        return self.active_executions.get(execution_id)
    
    async def stop_execution(self, execution_id: str) -> bool:
        """停止执行"""
        if execution_id in self.active_executions:
            context = self.active_executions[execution_id]
            context.status = "stopped"
            context.end_time = time.time()
            del self.active_executions[execution_id]
            return True
        return False
    
    def get_execution_metrics(self) -> Dict[str, Dict[str, Any]]:
        """获取执行指标"""
        metrics = self.execution_metrics.copy()
        
        # 添加并行执行统计
        if self.enable_parallel_execution:
            parallel_stats = self.parallel_executor.get_performance_statistics()
            metrics['parallel_execution'] = parallel_stats
        
        # 添加性能监控统计
        if self.enable_performance_monitoring:
            performance_dashboard = self.performance_monitor.get_performance_dashboard()
            metrics['performance_monitoring'] = performance_dashboard
        
        return metrics
    
    def get_cached_result(self, node_id: str, execution_id: str) -> Optional[Dict[str, Any]]:
        """获取缓存结果"""
        cache_key = f"{node_id}_{execution_id}"
        return self.node_cache.get(cache_key)
    
    def clear_cache(self, execution_id: Optional[str] = None):
        """清除缓存"""
        if execution_id:
            # 清除特定执行的缓存
            keys_to_remove = [key for key in self.node_cache.keys() if key.endswith(f"_{execution_id}")]
            for key in keys_to_remove:
                del self.node_cache[key]
        else:
            # 清除所有缓存
            self.node_cache.clear()
    
    def get_error_statistics(self) -> Dict[str, Any]:
        """获取错误统计信息"""
        return self.error_handler.get_error_statistics()
    
    def reset_error_handler(self):
        """重置错误处理器"""
        self.error_handler.clear_retry_counts()
        self.error_handler.reset_circuit_breakers()
    
    def configure_parallel_execution(self, enable: bool = True, max_workers: int = 10, **resource_config):
        """配置并行执行"""
        self.enable_parallel_execution = enable
        
        if enable:
            # 重新初始化并行执行器
            self.parallel_executor = workflow_parallel_executor
            self.parallel_executor.max_workers = max_workers
            
            # 配置资源池
            if resource_config:
                self.parallel_executor.configure_resource_pool(**resource_config)
    
    def get_parallel_statistics(self) -> Dict[str, Any]:
        """获取并行执行统计"""
        if not self.enable_parallel_execution:
            return {"parallel_execution_enabled": False}
        
        stats = self.parallel_executor.get_performance_statistics()
        stats["parallel_execution_enabled"] = True
        return stats
    
    def reset_parallel_cache(self):
        """重置并行执行缓存"""
        if self.enable_parallel_execution:
            self.parallel_executor.reset_performance_cache()
    
    def configure_performance_monitoring(self, enable: bool = True, **config):
        """配置性能监控"""
        self.enable_performance_monitoring = enable
        
        if enable:
            # 配置性能监控器
            if 'max_history_size' in config:
                self.performance_monitor.max_history_size = config['max_history_size']
            
            if 'system_monitoring_enabled' in config:
                self.performance_monitor.system_monitoring_enabled = config['system_monitoring_enabled']
            
            if 'alert_enabled' in config:
                self.performance_monitor.alert_enabled = config['alert_enabled']
    
    async def start_performance_monitoring(self):
        """启动性能监控"""
        if self.enable_performance_monitoring:
            await self.performance_monitor.start_monitoring()
    
    async def stop_performance_monitoring(self):
        """停止性能监控"""
        if self.enable_performance_monitoring:
            await self.performance_monitor.stop_monitoring()
    
    def get_performance_dashboard(self) -> Dict[str, Any]:
        """获取性能仪表板"""
        if not self.enable_performance_monitoring:
            return {"performance_monitoring_enabled": False}
        
        return self.performance_monitor.get_performance_dashboard()
    
    def get_workflow_performance_report(self, workflow_id: str) -> Dict[str, Any]:
        """获取工作流性能报告"""
        if not self.enable_performance_monitoring:
            return {"performance_monitoring_enabled": False}
        
        return self.performance_monitor.get_workflow_performance_report(workflow_id)
    
    def get_node_performance_report(self, node_id: str) -> Dict[str, Any]:
        """获取节点性能报告"""
        if not self.enable_performance_monitoring:
            return {"performance_monitoring_enabled": False}
        
        return self.performance_monitor.get_node_performance_report(node_id)
    
    def get_alert_summary(self) -> Dict[str, Any]:
        """获取告警摘要"""
        if not self.enable_performance_monitoring:
            return {"performance_monitoring_enabled": False}
        
        return self.performance_monitor.get_alert_summary()
    
    def clear_performance_history(self):
        """清空性能历史数据"""
        if self.enable_performance_monitoring:
            self.performance_monitor.clear_history()


# 全局执行引擎实例
workflow_execution_engine = WorkflowExecutionEngine()
