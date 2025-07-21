"""
工作流并行执行优化器
支持智能并行调度、资源管理、依赖解析等功能
"""

import asyncio
import time
import uuid
from typing import Dict, List, Any, Optional, Set, Tuple
from dataclasses import dataclass, field
from enum import Enum
from concurrent.futures import ThreadPoolExecutor, as_completed
import structlog
from collections import defaultdict, deque
import heapq

from app.schemas.workflow import (
    WorkflowDefinition, 
    WorkflowNode, 
    WorkflowEdge,
    WorkflowExecutionContext,
    ExecutionStep
)

logger = structlog.get_logger(__name__)


class NodePriority(Enum):
    """节点优先级"""
    CRITICAL = 1
    HIGH = 2
    NORMAL = 3
    LOW = 4


class ResourceType(Enum):
    """资源类型"""
    CPU = "cpu"
    MEMORY = "memory"
    NETWORK = "network"
    GPU = "gpu"
    STORAGE = "storage"


@dataclass
class ResourceRequirement:
    """资源需求"""
    cpu: float = 1.0  # CPU核心数
    memory: int = 512  # MB
    network_bandwidth: int = 100  # Mbps
    gpu_memory: int = 0  # MB
    storage_io: int = 10  # MB/s
    duration_estimate: float = 1.0  # 预估执行时间（秒）


@dataclass
class NodeExecutionInfo:
    """节点执行信息"""
    node: WorkflowNode
    dependencies: Set[str] = field(default_factory=set)
    dependents: Set[str] = field(default_factory=set)
    priority: NodePriority = NodePriority.NORMAL
    resource_requirement: ResourceRequirement = field(default_factory=ResourceRequirement)
    estimated_duration: float = 1.0
    can_parallelize: bool = True
    batch_group: Optional[str] = None  # 批处理组
    execution_weight: float = 1.0  # 执行权重
    
    def __post_init__(self):
        if not self.dependencies:
            self.dependencies = set()
        if not self.dependents:
            self.dependents = set()


@dataclass
class ExecutionBatch:
    """执行批次"""
    batch_id: str
    nodes: List[NodeExecutionInfo]
    max_parallelism: int = 5
    resource_limit: ResourceRequirement = field(default_factory=ResourceRequirement)
    estimated_duration: float = 0.0
    
    def __post_init__(self):
        if self.nodes:
            self.estimated_duration = max(node.estimated_duration for node in self.nodes)


@dataclass
class ResourcePool:
    """资源池"""
    total_cpu: float = 8.0
    total_memory: int = 8192  # MB
    total_network: int = 1000  # Mbps
    total_gpu_memory: int = 0  # MB
    total_storage_io: int = 1000  # MB/s
    
    # 当前使用量
    used_cpu: float = 0.0
    used_memory: int = 0
    used_network: int = 0
    used_gpu_memory: int = 0
    used_storage_io: int = 0
    
    def can_allocate(self, requirement: ResourceRequirement) -> bool:
        """检查是否可以分配资源"""
        return (
            self.used_cpu + requirement.cpu <= self.total_cpu and
            self.used_memory + requirement.memory <= self.total_memory and
            self.used_network + requirement.network_bandwidth <= self.total_network and
            self.used_gpu_memory + requirement.gpu_memory <= self.total_gpu_memory and
            self.used_storage_io + requirement.storage_io <= self.total_storage_io
        )
    
    def allocate(self, requirement: ResourceRequirement) -> bool:
        """分配资源"""
        if self.can_allocate(requirement):
            self.used_cpu += requirement.cpu
            self.used_memory += requirement.memory
            self.used_network += requirement.network_bandwidth
            self.used_gpu_memory += requirement.gpu_memory
            self.used_storage_io += requirement.storage_io
            return True
        return False
    
    def release(self, requirement: ResourceRequirement):
        """释放资源"""
        self.used_cpu = max(0, self.used_cpu - requirement.cpu)
        self.used_memory = max(0, self.used_memory - requirement.memory)
        self.used_network = max(0, self.used_network - requirement.network_bandwidth)
        self.used_gpu_memory = max(0, self.used_gpu_memory - requirement.gpu_memory)
        self.used_storage_io = max(0, self.used_storage_io - requirement.storage_io)
    
    def get_utilization(self) -> Dict[str, float]:
        """获取资源利用率"""
        return {
            "cpu": self.used_cpu / self.total_cpu if self.total_cpu > 0 else 0,
            "memory": self.used_memory / self.total_memory if self.total_memory > 0 else 0,
            "network": self.used_network / self.total_network if self.total_network > 0 else 0,
            "gpu_memory": self.used_gpu_memory / self.total_gpu_memory if self.total_gpu_memory > 0 else 0,
            "storage_io": self.used_storage_io / self.total_storage_io if self.total_storage_io > 0 else 0
        }


class WorkflowParallelExecutor:
    """工作流并行执行器"""
    
    def __init__(self, max_workers: int = 10):
        self.max_workers = max_workers
        self.thread_pool = ThreadPoolExecutor(max_workers=max_workers)
        self.resource_pool = ResourcePool()
        self.execution_history: Dict[str, List[float]] = defaultdict(list)  # 节点历史执行时间
        self.node_performance_cache: Dict[str, Dict[str, float]] = {}  # 节点性能缓存
        
    async def execute_workflow_parallel(
        self,
        workflow_definition: WorkflowDefinition,
        context: WorkflowExecutionContext,
        node_executor,
        debug: bool = False
    ) -> None:
        """并行执行工作流"""
        
        logger.info(
            "开始并行执行工作流",
            workflow_id=workflow_definition.id,
            node_count=len(workflow_definition.nodes),
            max_workers=self.max_workers
        )
        
        # 1. 分析工作流依赖和构建执行图
        execution_graph = self._build_execution_graph(workflow_definition)
        
        # 2. 优化执行计划
        execution_plan = await self._optimize_execution_plan(execution_graph, context)
        
        # 3. 执行批次
        await self._execute_batches(execution_plan, context, node_executor, debug)
        
        logger.info(
            "并行执行工作流完成",
            workflow_id=workflow_definition.id,
            total_batches=len(execution_plan),
            resource_utilization=self.resource_pool.get_utilization()
        )
    
    def _build_execution_graph(self, workflow: WorkflowDefinition) -> Dict[str, NodeExecutionInfo]:
        """构建执行图"""
        
        # 创建节点执行信息
        execution_graph = {}
        for node in workflow.nodes:
            execution_info = NodeExecutionInfo(
                node=node,
                priority=self._determine_node_priority(node),
                resource_requirement=self._estimate_resource_requirement(node),
                estimated_duration=self._estimate_execution_duration(node),
                can_parallelize=self._can_node_parallelize(node)
            )
            execution_graph[node.id] = execution_info
        
        # 构建依赖关系
        for edge in workflow.edges:
            if edge.source in execution_graph and edge.target in execution_graph:
                execution_graph[edge.target].dependencies.add(edge.source)
                execution_graph[edge.source].dependents.add(edge.target)
        
        return execution_graph
    
    def _determine_node_priority(self, node: WorkflowNode) -> NodePriority:
        """确定节点优先级"""
        
        # 基于节点类型确定优先级
        high_priority_types = {'input', 'output', 'llm'}
        normal_priority_types = {'rag_retriever', 'classifier', 'condition'}
        low_priority_types = {'data_transformer', 'code_executor'}
        
        if node.type in high_priority_types:
            return NodePriority.HIGH
        elif node.type in normal_priority_types:
            return NodePriority.NORMAL
        elif node.type in low_priority_types:
            return NodePriority.LOW
        
        # 基于配置确定优先级
        config_priority = node.config.get('priority', 'normal')
        if config_priority == 'critical':
            return NodePriority.CRITICAL
        elif config_priority == 'high':
            return NodePriority.HIGH
        elif config_priority == 'low':
            return NodePriority.LOW
        
        return NodePriority.NORMAL
    
    def _estimate_resource_requirement(self, node: WorkflowNode) -> ResourceRequirement:
        """估算资源需求"""
        
        # 基于节点类型的默认资源需求
        type_requirements = {
            'llm': ResourceRequirement(cpu=2.0, memory=1024, network_bandwidth=200, duration_estimate=3.0),
            'rag_retriever': ResourceRequirement(cpu=1.5, memory=512, network_bandwidth=100, duration_estimate=2.0),
            'classifier': ResourceRequirement(cpu=1.0, memory=256, network_bandwidth=50, duration_estimate=1.5),
            'data_transformer': ResourceRequirement(cpu=0.5, memory=128, network_bandwidth=20, duration_estimate=0.5),
            'code_executor': ResourceRequirement(cpu=1.0, memory=512, network_bandwidth=10, duration_estimate=2.0),
            'condition': ResourceRequirement(cpu=0.1, memory=64, network_bandwidth=5, duration_estimate=0.1),
            'input': ResourceRequirement(cpu=0.1, memory=32, network_bandwidth=5, duration_estimate=0.1),
            'output': ResourceRequirement(cpu=0.1, memory=32, network_bandwidth=5, duration_estimate=0.1)
        }
        
        base_requirement = type_requirements.get(node.type, ResourceRequirement())
        
        # 根据节点配置调整资源需求
        if node.config:
            # 调整CPU需求
            if 'cpu_intensive' in node.config and node.config['cpu_intensive']:
                base_requirement.cpu *= 2
            
            # 调整内存需求
            if 'memory_intensive' in node.config and node.config['memory_intensive']:
                base_requirement.memory *= 2
            
            # 调整网络需求
            if 'network_intensive' in node.config and node.config['network_intensive']:
                base_requirement.network_bandwidth *= 2
        
        return base_requirement
    
    def _estimate_execution_duration(self, node: WorkflowNode) -> float:
        """估算执行时间"""
        
        # 从历史记录中获取平均执行时间
        if node.id in self.execution_history:
            history = self.execution_history[node.id]
            if history:
                return sum(history) / len(history)
        
        # 使用默认估算
        return self._estimate_resource_requirement(node).duration_estimate
    
    def _can_node_parallelize(self, node: WorkflowNode) -> bool:
        """判断节点是否可以并行执行"""
        
        # 某些节点类型不适合并行执行
        non_parallel_types = {'input', 'output'}
        if node.type in non_parallel_types:
            return False
        
        # 检查节点配置
        if node.config.get('sequential_only', False):
            return False
        
        # 检查是否有状态依赖
        if node.config.get('stateful', False):
            return False
        
        return True
    
    async def _optimize_execution_plan(
        self,
        execution_graph: Dict[str, NodeExecutionInfo],
        context: WorkflowExecutionContext
    ) -> List[ExecutionBatch]:
        """优化执行计划"""
        
        # 1. 拓扑排序确定执行层次
        execution_levels = self._topological_sort_by_level(execution_graph)
        
        # 2. 在每个层次内进行并行优化
        execution_plan = []
        
        for level_idx, level_nodes in enumerate(execution_levels):
            if not level_nodes:
                continue
            
            # 3. 对当前层次的节点进行分组和优化
            level_batches = await self._optimize_level_execution(
                level_nodes, execution_graph, level_idx
            )
            
            execution_plan.extend(level_batches)
        
        logger.info(
            "执行计划优化完成",
            total_levels=len(execution_levels),
            total_batches=len(execution_plan),
            estimated_total_time=sum(batch.estimated_duration for batch in execution_plan)
        )
        
        return execution_plan
    
    def _topological_sort_by_level(
        self,
        execution_graph: Dict[str, NodeExecutionInfo]
    ) -> List[List[NodeExecutionInfo]]:
        """按层次进行拓扑排序"""
        
        # 计算每个节点的入度
        in_degree = {}
        for node_id, node_info in execution_graph.items():
            in_degree[node_id] = len(node_info.dependencies)
        
        # 分层处理
        levels = []
        remaining_nodes = set(execution_graph.keys())
        
        while remaining_nodes:
            # 找到当前层次的节点（入度为0的节点）
            current_level = []
            for node_id in list(remaining_nodes):
                if in_degree[node_id] == 0:
                    current_level.append(execution_graph[node_id])
                    remaining_nodes.remove(node_id)
            
            if not current_level:
                # 检测到循环依赖
                raise ValueError(f"检测到循环依赖: {remaining_nodes}")
            
            levels.append(current_level)
            
            # 更新下一层节点的入度
            for node_info in current_level:
                for dependent_id in node_info.dependents:
                    if dependent_id in in_degree:
                        in_degree[dependent_id] -= 1
        
        return levels
    
    async def _optimize_level_execution(
        self,
        level_nodes: List[NodeExecutionInfo],
        execution_graph: Dict[str, NodeExecutionInfo],
        level_idx: int
    ) -> List[ExecutionBatch]:
        """优化单个层次的执行"""
        
        if not level_nodes:
            return []
        
        # 1. 按优先级和资源需求排序
        sorted_nodes = sorted(level_nodes, key=lambda x: (
            x.priority.value,  # 优先级
            -x.estimated_duration,  # 预估时间（长的先执行）
            -x.resource_requirement.cpu  # CPU需求（高的先执行）
        ))
        
        # 2. 智能分批
        batches = []
        current_batch_nodes = []
        current_batch_resources = ResourceRequirement()
        
        for node_info in sorted_nodes:
            # 检查是否可以加入当前批次
            can_add_to_batch = (
                len(current_batch_nodes) < self.max_workers and
                self._can_add_to_batch(node_info, current_batch_nodes, current_batch_resources)
            )
            
            if can_add_to_batch:
                current_batch_nodes.append(node_info)
                current_batch_resources = self._combine_resources(
                    current_batch_resources, node_info.resource_requirement
                )
            else:
                # 创建新批次
                if current_batch_nodes:
                    batch = ExecutionBatch(
                        batch_id=f"batch_{level_idx}_{len(batches)}",
                        nodes=current_batch_nodes,
                        resource_limit=current_batch_resources,
                        estimated_duration=max(n.estimated_duration for n in current_batch_nodes)
                    )
                    batches.append(batch)
                
                # 开始新批次
                current_batch_nodes = [node_info]
                current_batch_resources = node_info.resource_requirement
        
        # 添加最后一个批次
        if current_batch_nodes:
            batch = ExecutionBatch(
                batch_id=f"batch_{level_idx}_{len(batches)}",
                nodes=current_batch_nodes,
                resource_limit=current_batch_resources,
                estimated_duration=max(n.estimated_duration for n in current_batch_nodes)
            )
            batches.append(batch)
        
        # 3. 进一步优化批次
        optimized_batches = await self._optimize_batches(batches)
        
        return optimized_batches
    
    def _can_add_to_batch(
        self,
        node_info: NodeExecutionInfo,
        current_batch: List[NodeExecutionInfo],
        current_resources: ResourceRequirement
    ) -> bool:
        """判断节点是否可以加入当前批次"""
        
        # 检查资源限制
        combined_resources = self._combine_resources(current_resources, node_info.resource_requirement)
        if not self.resource_pool.can_allocate(combined_resources):
            return False
        
        # 检查是否可以并行执行
        if not node_info.can_parallelize:
            return len(current_batch) == 0
        
        # 检查批次兼容性
        for batch_node in current_batch:
            if not self._are_nodes_compatible(node_info, batch_node):
                return False
        
        return True
    
    def _combine_resources(
        self,
        res1: ResourceRequirement,
        res2: ResourceRequirement
    ) -> ResourceRequirement:
        """合并资源需求"""
        return ResourceRequirement(
            cpu=res1.cpu + res2.cpu,
            memory=res1.memory + res2.memory,
            network_bandwidth=res1.network_bandwidth + res2.network_bandwidth,
            gpu_memory=res1.gpu_memory + res2.gpu_memory,
            storage_io=res1.storage_io + res2.storage_io,
            duration_estimate=max(res1.duration_estimate, res2.duration_estimate)
        )
    
    def _are_nodes_compatible(
        self,
        node1: NodeExecutionInfo,
        node2: NodeExecutionInfo
    ) -> bool:
        """检查两个节点是否兼容并行执行"""
        
        # 检查资源冲突
        if (node1.resource_requirement.cpu > 1.5 and node2.resource_requirement.cpu > 1.5):
            return False
        
        # 检查同类型节点限制
        if node1.node.type == node2.node.type:
            # 某些类型的节点不适合同时执行多个
            exclusive_types = {'llm', 'rag_retriever'}
            if node1.node.type in exclusive_types:
                return False
        
        # 检查批次组
        if node1.batch_group and node2.batch_group:
            return node1.batch_group == node2.batch_group
        
        return True
    
    async def _optimize_batches(self, batches: List[ExecutionBatch]) -> List[ExecutionBatch]:
        """进一步优化批次"""
        
        # 1. 合并小批次
        optimized_batches = []
        i = 0
        
        while i < len(batches):
            current_batch = batches[i]
            
            # 尝试与下一个批次合并
            if i + 1 < len(batches):
                next_batch = batches[i + 1]
                
                # 检查是否可以合并
                combined_nodes = current_batch.nodes + next_batch.nodes
                if (len(combined_nodes) <= self.max_workers and
                    self._can_merge_batches(current_batch, next_batch)):
                    
                    # 合并批次
                    combined_resources = ResourceRequirement()
                    for node in combined_nodes:
                        combined_resources = self._combine_resources(
                            combined_resources, node.resource_requirement
                        )
                    
                    merged_batch = ExecutionBatch(
                        batch_id=f"merged_{current_batch.batch_id}_{next_batch.batch_id}",
                        nodes=combined_nodes,
                        resource_limit=combined_resources,
                        estimated_duration=max(
                            current_batch.estimated_duration,
                            next_batch.estimated_duration
                        )
                    )
                    
                    optimized_batches.append(merged_batch)
                    i += 2  # 跳过下一个批次
                    continue
            
            optimized_batches.append(current_batch)
            i += 1
        
        return optimized_batches
    
    def _can_merge_batches(self, batch1: ExecutionBatch, batch2: ExecutionBatch) -> bool:
        """检查是否可以合并两个批次"""
        
        # 检查资源限制
        combined_resources = self._combine_resources(batch1.resource_limit, batch2.resource_limit)
        if not self.resource_pool.can_allocate(combined_resources):
            return False
        
        # 检查节点兼容性
        for node1 in batch1.nodes:
            for node2 in batch2.nodes:
                if not self._are_nodes_compatible(node1, node2):
                    return False
        
        return True
    
    async def _execute_batches(
        self,
        execution_plan: List[ExecutionBatch],
        context: WorkflowExecutionContext,
        node_executor,
        debug: bool = False
    ) -> None:
        """执行批次"""
        
        node_data = {}
        
        for batch_idx, batch in enumerate(execution_plan):
            logger.info(
                f"开始执行批次 {batch_idx + 1}/{len(execution_plan)}",
                batch_id=batch.batch_id,
                node_count=len(batch.nodes),
                estimated_duration=batch.estimated_duration
            )
            
            # 分配资源
            if not self.resource_pool.allocate(batch.resource_limit):
                logger.warning(
                    f"资源分配失败，等待资源释放",
                    batch_id=batch.batch_id,
                    required_resources=batch.resource_limit.__dict__
                )
                # 等待资源释放
                await asyncio.sleep(0.1)
                continue
            
            try:
                # 并行执行批次中的节点
                await self._execute_batch_parallel(
                    batch, node_data, context, node_executor, debug
                )
                
            finally:
                # 释放资源
                self.resource_pool.release(batch.resource_limit)
            
            logger.info(
                f"批次执行完成",
                batch_id=batch.batch_id,
                resource_utilization=self.resource_pool.get_utilization()
            )
    
    async def _execute_batch_parallel(
        self,
        batch: ExecutionBatch,
        node_data: Dict[str, Any],
        context: WorkflowExecutionContext,
        node_executor,
        debug: bool = False
    ) -> None:
        """并行执行批次中的节点"""
        
        # 创建并行任务
        tasks = []
        for node_info in batch.nodes:
            # 收集输入数据
            input_data = self._collect_node_input_data(node_info, node_data, context)
            
            # 创建执行任务
            task = self._execute_node_with_monitoring(
                node_info, input_data, context, node_executor, debug
            )
            tasks.append(task)
        
        # 等待所有任务完成
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 处理结果
        for i, result in enumerate(results):
            node_info = batch.nodes[i]
            
            if isinstance(result, Exception):
                logger.error(
                    f"节点执行失败",
                    node_id=node_info.node.id,
                    error=str(result),
                    exc_info=True
                )
                # 错误处理逻辑
                node_data[node_info.node.id] = {}
            else:
                node_data[node_info.node.id] = result
                
                # 更新性能统计
                self._update_node_performance(node_info.node.id, result.get('duration', 0))
    
    def _collect_node_input_data(
        self,
        node_info: NodeExecutionInfo,
        node_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """收集节点输入数据"""
        
        input_data = {}
        
        # 从依赖节点收集数据
        for dependency_id in node_info.dependencies:
            if dependency_id in node_data:
                input_data.update(node_data[dependency_id])
        
        # 如果没有依赖，使用全局输入数据
        if not input_data:
            input_data = context.input_data.copy()
        
        return input_data
    
    async def _execute_node_with_monitoring(
        self,
        node_info: NodeExecutionInfo,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext,
        node_executor,
        debug: bool = False
    ) -> Dict[str, Any]:
        """执行节点并监控性能"""
        
        start_time = time.time()
        
        try:
            # 创建执行步骤
            step = ExecutionStep(
                step_id=f"step_{uuid.uuid4().hex[:8]}",
                node_id=node_info.node.id,
                node_name=node_info.node.name,
                input_data=input_data,
                start_time=start_time
            )
            
            context.steps.append(step)
            
            # 执行节点
            output_data = await node_executor._execute_node(
                node_info.node, input_data, context
            )
            
            # 更新步骤信息
            step.output_data = output_data
            step.status = "completed"
            step.end_time = time.time()
            step.duration = step.end_time - step.start_time
            
            # 记录性能数据
            self._record_execution_time(node_info.node.id, step.duration)
            
            if debug:
                logger.info(
                    f"节点执行完成",
                    node_id=node_info.node.id,
                    duration=step.duration,
                    resource_usage=node_info.resource_requirement.__dict__
                )
            
            return output_data
            
        except Exception as e:
            # 记录错误
            duration = time.time() - start_time
            self._record_execution_time(node_info.node.id, duration)
            
            logger.error(
                f"节点执行失败",
                node_id=node_info.node.id,
                duration=duration,
                error=str(e),
                exc_info=True
            )
            raise
    
    def _record_execution_time(self, node_id: str, duration: float):
        """记录执行时间"""
        if node_id not in self.execution_history:
            self.execution_history[node_id] = deque(maxlen=100)  # 保留最近100次记录
        
        self.execution_history[node_id].append(duration)
    
    def _update_node_performance(self, node_id: str, duration: float):
        """更新节点性能缓存"""
        if node_id not in self.node_performance_cache:
            self.node_performance_cache[node_id] = {
                'avg_duration': duration,
                'min_duration': duration,
                'max_duration': duration,
                'execution_count': 1
            }
        else:
            cache = self.node_performance_cache[node_id]
            cache['execution_count'] += 1
            cache['avg_duration'] = (
                (cache['avg_duration'] * (cache['execution_count'] - 1) + duration) / 
                cache['execution_count']
            )
            cache['min_duration'] = min(cache['min_duration'], duration)
            cache['max_duration'] = max(cache['max_duration'], duration)
    
    def get_performance_statistics(self) -> Dict[str, Any]:
        """获取性能统计信息"""
        return {
            'node_performance': self.node_performance_cache,
            'resource_utilization': self.resource_pool.get_utilization(),
            'execution_history': {
                node_id: list(history) for node_id, history in self.execution_history.items()
            }
        }
    
    def reset_performance_cache(self):
        """重置性能缓存"""
        self.node_performance_cache.clear()
        self.execution_history.clear()
        self.resource_pool = ResourcePool()
    
    def configure_resource_pool(self, **kwargs):
        """配置资源池"""
        for key, value in kwargs.items():
            if hasattr(self.resource_pool, key):
                setattr(self.resource_pool, key, value)


# 全局并行执行器实例
workflow_parallel_executor = WorkflowParallelExecutor()