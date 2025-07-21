"""
工作流错误处理和恢复系统
支持智能错误恢复、重试策略、故障转移等功能
"""

import asyncio
import json
import time
import traceback
from typing import Dict, List, Any, Optional, Union, Callable
from datetime import datetime, timedelta
from enum import Enum
import structlog
from dataclasses import dataclass, field
from contextlib import asynccontextmanager

from app.schemas.workflow import WorkflowExecutionContext, ExecutionStep, WorkflowNode

logger = structlog.get_logger(__name__)


class ErrorType(Enum):
    """错误类型枚举"""
    VALIDATION_ERROR = "validation_error"
    EXECUTION_ERROR = "execution_error"
    TIMEOUT_ERROR = "timeout_error"
    DEPENDENCY_ERROR = "dependency_error"
    RESOURCE_ERROR = "resource_error"
    NETWORK_ERROR = "network_error"
    DATA_ERROR = "data_error"
    CONFIGURATION_ERROR = "configuration_error"
    PERMISSION_ERROR = "permission_error"
    QUOTA_ERROR = "quota_error"


class RetryStrategy(Enum):
    """重试策略枚举"""
    EXPONENTIAL_BACKOFF = "exponential_backoff"
    LINEAR_BACKOFF = "linear_backoff"
    FIXED_DELAY = "fixed_delay"
    IMMEDIATE = "immediate"
    NO_RETRY = "no_retry"


class RecoveryAction(Enum):
    """恢复动作枚举"""
    RETRY = "retry"
    SKIP_NODE = "skip_node"
    USE_FALLBACK = "use_fallback"
    USE_CACHED_RESULT = "use_cached_result"
    USE_DEFAULT_VALUE = "use_default_value"
    FAIL_FAST = "fail_fast"
    ROLLBACK = "rollback"
    CIRCUIT_BREAK = "circuit_break"


@dataclass
class WorkflowError(Exception):
    """工作流错误"""
    message: str
    error_type: ErrorType
    node_id: Optional[str] = None
    step_id: Optional[str] = None
    recoverable: bool = True
    retry_after: Optional[int] = None
    context: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    traceback_str: str = field(default_factory=lambda: traceback.format_exc())
    
    def __post_init__(self):
        super().__init__(self.message)


@dataclass
class RetryConfig:
    """重试配置"""
    strategy: RetryStrategy = RetryStrategy.EXPONENTIAL_BACKOFF
    max_retries: int = 3
    initial_delay: float = 1.0
    max_delay: float = 60.0
    backoff_multiplier: float = 2.0
    jitter: bool = True
    timeout_multiplier: float = 1.5


@dataclass
class RecoveryStrategy:
    """恢复策略"""
    action: RecoveryAction
    retry_config: Optional[RetryConfig] = None
    fallback_value: Any = None
    fallback_function: Optional[Callable] = None
    timeout_seconds: Optional[float] = None
    circuit_breaker_threshold: int = 5
    circuit_breaker_timeout: float = 60.0


@dataclass
class CircuitBreakerState:
    """断路器状态"""
    is_open: bool = False
    failure_count: int = 0
    last_failure_time: Optional[float] = None
    success_count: int = 0
    total_calls: int = 0


class WorkflowErrorHandler:
    """工作流错误处理器"""
    
    def __init__(self):
        self.error_strategies: Dict[ErrorType, RecoveryStrategy] = self._init_default_strategies()
        self.node_strategies: Dict[str, RecoveryStrategy] = {}
        self.circuit_breakers: Dict[str, CircuitBreakerState] = {}
        self.retry_counts: Dict[str, int] = {}
        self.error_history: List[WorkflowError] = []
        self.max_error_history = 1000
        
    def _init_default_strategies(self) -> Dict[ErrorType, RecoveryStrategy]:
        """初始化默认错误策略"""
        return {
            ErrorType.TIMEOUT_ERROR: RecoveryStrategy(
                action=RecoveryAction.RETRY,
                retry_config=RetryConfig(
                    strategy=RetryStrategy.LINEAR_BACKOFF,
                    max_retries=3,
                    initial_delay=2.0,
                    timeout_multiplier=1.5
                )
            ),
            ErrorType.NETWORK_ERROR: RecoveryStrategy(
                action=RecoveryAction.RETRY,
                retry_config=RetryConfig(
                    strategy=RetryStrategy.EXPONENTIAL_BACKOFF,
                    max_retries=5,
                    initial_delay=1.0,
                    max_delay=30.0
                )
            ),
            ErrorType.RESOURCE_ERROR: RecoveryStrategy(
                action=RecoveryAction.RETRY,
                retry_config=RetryConfig(
                    strategy=RetryStrategy.LINEAR_BACKOFF,
                    max_retries=3,
                    initial_delay=5.0,
                    max_delay=60.0
                )
            ),
            ErrorType.DEPENDENCY_ERROR: RecoveryStrategy(
                action=RecoveryAction.USE_FALLBACK,
                fallback_value={"error": "dependency_unavailable", "data": None}
            ),
            ErrorType.DATA_ERROR: RecoveryStrategy(
                action=RecoveryAction.USE_DEFAULT_VALUE,
                fallback_value={"error": "data_format_error", "data": {}}
            ),
            ErrorType.VALIDATION_ERROR: RecoveryStrategy(
                action=RecoveryAction.FAIL_FAST
            ),
            ErrorType.EXECUTION_ERROR: RecoveryStrategy(
                action=RecoveryAction.RETRY,
                retry_config=RetryConfig(
                    strategy=RetryStrategy.FIXED_DELAY,
                    max_retries=2,
                    initial_delay=1.0
                )
            ),
            ErrorType.CONFIGURATION_ERROR: RecoveryStrategy(
                action=RecoveryAction.USE_DEFAULT_VALUE,
                fallback_value={"error": "config_error", "data": {}}
            ),
            ErrorType.PERMISSION_ERROR: RecoveryStrategy(
                action=RecoveryAction.FAIL_FAST
            ),
            ErrorType.QUOTA_ERROR: RecoveryStrategy(
                action=RecoveryAction.CIRCUIT_BREAK,
                retry_config=RetryConfig(
                    strategy=RetryStrategy.EXPONENTIAL_BACKOFF,
                    max_retries=2,
                    initial_delay=30.0
                )
            )
        }
    
    def set_node_strategy(self, node_id: str, strategy: RecoveryStrategy):
        """设置节点特定的错误策略"""
        self.node_strategies[node_id] = strategy
    
    def classify_error(self, error: Exception, node: WorkflowNode) -> ErrorType:
        """分类错误类型"""
        error_msg = str(error).lower()
        
        # 网络相关错误
        if any(keyword in error_msg for keyword in 
               ['connection', 'network', 'timeout', 'dns', 'socket', 'http']):
            return ErrorType.NETWORK_ERROR
        
        # 超时错误
        if 'timeout' in error_msg:
            return ErrorType.TIMEOUT_ERROR
        
        # 资源错误
        if any(keyword in error_msg for keyword in 
               ['memory', 'disk', 'resource', 'limit', 'quota']):
            return ErrorType.RESOURCE_ERROR
        
        # 权限错误
        if any(keyword in error_msg for keyword in 
               ['permission', 'unauthorized', 'forbidden', 'access']):
            return ErrorType.PERMISSION_ERROR
        
        # 配置错误
        if any(keyword in error_msg for keyword in 
               ['config', 'configuration', 'missing', 'invalid']):
            return ErrorType.CONFIGURATION_ERROR
        
        # 数据错误
        if any(keyword in error_msg for keyword in 
               ['json', 'parse', 'format', 'decode', 'encode']):
            return ErrorType.DATA_ERROR
        
        # 依赖错误
        if any(keyword in error_msg for keyword in 
               ['import', 'module', 'dependency', 'not found']):
            return ErrorType.DEPENDENCY_ERROR
        
        # 默认为执行错误
        return ErrorType.EXECUTION_ERROR
    
    async def handle_error(
        self,
        error: Exception,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理错误并返回恢复结果"""
        
        # 分类错误
        error_type = self.classify_error(error, node)
        
        # 创建工作流错误
        workflow_error = WorkflowError(
            message=str(error),
            error_type=error_type,
            node_id=node.id,
            step_id=step.step_id,
            context={
                'node_name': node.name,
                'node_type': node.type,
                'execution_id': context.execution_id
            }
        )
        
        # 记录错误历史
        self._record_error(workflow_error)
        
        # 获取恢复策略
        strategy = self._get_recovery_strategy(node.id, error_type)
        
        # 检查断路器状态
        if await self._check_circuit_breaker(node.id, strategy):
            return {
                'action': 'circuit_break',
                'success': False,
                'error': 'Circuit breaker is open',
                'data': strategy.fallback_value
            }
        
        # 执行恢复策略
        recovery_result = await self._execute_recovery_strategy(
            workflow_error, strategy, node, context, step
        )
        
        # 更新断路器状态
        self._update_circuit_breaker(node.id, recovery_result['success'])
        
        return recovery_result
    
    def _record_error(self, error: WorkflowError):
        """记录错误历史"""
        self.error_history.append(error)
        
        # 限制历史记录数量
        if len(self.error_history) > self.max_error_history:
            self.error_history = self.error_history[-self.max_error_history:]
        
        logger.error(
            "工作流错误记录",
            error_type=error.error_type.value,
            node_id=error.node_id,
            message=error.message,
            context=error.context
        )
    
    def _get_recovery_strategy(self, node_id: str, error_type: ErrorType) -> RecoveryStrategy:
        """获取恢复策略"""
        # 优先使用节点特定策略
        if node_id in self.node_strategies:
            return self.node_strategies[node_id]
        
        # 使用默认策略
        return self.error_strategies.get(error_type, RecoveryStrategy(
            action=RecoveryAction.FAIL_FAST
        ))
    
    async def _check_circuit_breaker(self, node_id: str, strategy: RecoveryStrategy) -> bool:
        """检查断路器状态"""
        if strategy.action != RecoveryAction.CIRCUIT_BREAK:
            return False
        
        if node_id not in self.circuit_breakers:
            self.circuit_breakers[node_id] = CircuitBreakerState()
        
        breaker = self.circuit_breakers[node_id]
        
        if breaker.is_open:
            # 检查是否可以尝试恢复
            if (breaker.last_failure_time and 
                time.time() - breaker.last_failure_time > strategy.circuit_breaker_timeout):
                breaker.is_open = False
                breaker.failure_count = 0
                logger.info(f"断路器 {node_id} 尝试恢复")
                return False
            return True
        
        return False
    
    def _update_circuit_breaker(self, node_id: str, success: bool):
        """更新断路器状态"""
        if node_id not in self.circuit_breakers:
            return
        
        breaker = self.circuit_breakers[node_id]
        breaker.total_calls += 1
        
        if success:
            breaker.success_count += 1
            breaker.failure_count = 0
        else:
            breaker.failure_count += 1
            breaker.last_failure_time = time.time()
            
            # 检查是否需要打开断路器
            strategy = self._get_recovery_strategy(node_id, ErrorType.EXECUTION_ERROR)
            if (breaker.failure_count >= strategy.circuit_breaker_threshold and
                not breaker.is_open):
                breaker.is_open = True
                logger.warning(f"断路器 {node_id} 已打开")
    
    async def _execute_recovery_strategy(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """执行恢复策略"""
        
        if strategy.action == RecoveryAction.RETRY:
            return await self._handle_retry(error, strategy, node, context, step)
        
        elif strategy.action == RecoveryAction.SKIP_NODE:
            return await self._handle_skip_node(error, strategy, node, context, step)
        
        elif strategy.action == RecoveryAction.USE_FALLBACK:
            return await self._handle_use_fallback(error, strategy, node, context, step)
        
        elif strategy.action == RecoveryAction.USE_CACHED_RESULT:
            return await self._handle_use_cached_result(error, strategy, node, context, step)
        
        elif strategy.action == RecoveryAction.USE_DEFAULT_VALUE:
            return await self._handle_use_default_value(error, strategy, node, context, step)
        
        elif strategy.action == RecoveryAction.FAIL_FAST:
            return await self._handle_fail_fast(error, strategy, node, context, step)
        
        elif strategy.action == RecoveryAction.ROLLBACK:
            return await self._handle_rollback(error, strategy, node, context, step)
        
        elif strategy.action == RecoveryAction.CIRCUIT_BREAK:
            return await self._handle_circuit_break(error, strategy, node, context, step)
        
        else:
            return {
                'action': 'unknown',
                'success': False,
                'error': f'Unknown recovery action: {strategy.action}',
                'data': None
            }
    
    async def _handle_retry(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理重试策略"""
        
        if not strategy.retry_config:
            return {
                'action': 'retry_failed',
                'success': False,
                'error': 'No retry configuration provided',
                'data': None
            }
        
        retry_key = f"{node.id}_{step.step_id}"
        current_retry = self.retry_counts.get(retry_key, 0)
        
        if current_retry >= strategy.retry_config.max_retries:
            return {
                'action': 'max_retries_exceeded',
                'success': False,
                'error': f'Max retries ({strategy.retry_config.max_retries}) exceeded',
                'data': strategy.fallback_value
            }
        
        # 计算延迟时间
        delay = self._calculate_retry_delay(strategy.retry_config, current_retry)
        
        # 增加重试计数
        self.retry_counts[retry_key] = current_retry + 1
        
        logger.info(
            f"节点 {node.id} 准备重试",
            retry_count=current_retry + 1,
            delay=delay,
            max_retries=strategy.retry_config.max_retries
        )
        
        # 等待延迟
        if delay > 0:
            await asyncio.sleep(delay)
        
        return {
            'action': 'retry',
            'success': True,
            'retry_count': current_retry + 1,
            'delay': delay,
            'data': None
        }
    
    def _calculate_retry_delay(self, config: RetryConfig, retry_count: int) -> float:
        """计算重试延迟"""
        if config.strategy == RetryStrategy.EXPONENTIAL_BACKOFF:
            delay = config.initial_delay * (config.backoff_multiplier ** retry_count)
        elif config.strategy == RetryStrategy.LINEAR_BACKOFF:
            delay = config.initial_delay * (retry_count + 1)
        elif config.strategy == RetryStrategy.FIXED_DELAY:
            delay = config.initial_delay
        else:  # IMMEDIATE
            delay = 0
        
        # 应用最大延迟限制
        delay = min(delay, config.max_delay)
        
        # 应用抖动
        if config.jitter and delay > 0:
            import random
            delay = delay * (0.5 + random.random() * 0.5)
        
        return delay
    
    async def _handle_skip_node(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理跳过节点策略"""
        
        logger.warning(f"跳过节点 {node.id} 由于错误: {error.message}")
        
        return {
            'action': 'skip_node',
            'success': True,
            'message': f'Node {node.id} skipped due to error',
            'data': strategy.fallback_value or {}
        }
    
    async def _handle_use_fallback(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理使用备用值策略"""
        
        fallback_data = strategy.fallback_value
        
        # 如果有备用函数，调用它
        if strategy.fallback_function:
            try:
                if asyncio.iscoroutinefunction(strategy.fallback_function):
                    fallback_data = await strategy.fallback_function(error, node, context, step)
                else:
                    fallback_data = strategy.fallback_function(error, node, context, step)
            except Exception as e:
                logger.error(f"备用函数执行失败: {e}")
                fallback_data = strategy.fallback_value
        
        return {
            'action': 'use_fallback',
            'success': True,
            'message': f'Using fallback value for node {node.id}',
            'data': fallback_data
        }
    
    async def _handle_use_cached_result(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理使用缓存结果策略"""
        
        # 这里需要与缓存系统集成
        # 暂时返回备用值
        return {
            'action': 'use_cached_result',
            'success': True,
            'message': f'Using cached result for node {node.id}',
            'data': strategy.fallback_value or {}
        }
    
    async def _handle_use_default_value(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理使用默认值策略"""
        
        return {
            'action': 'use_default_value',
            'success': True,
            'message': f'Using default value for node {node.id}',
            'data': strategy.fallback_value or {}
        }
    
    async def _handle_fail_fast(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理快速失败策略"""
        
        return {
            'action': 'fail_fast',
            'success': False,
            'error': f'Fast fail for node {node.id}: {error.message}',
            'data': None
        }
    
    async def _handle_rollback(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理回滚策略"""
        
        # 回滚逻辑需要与状态管理系统集成
        return {
            'action': 'rollback',
            'success': True,
            'message': f'Rollback initiated for node {node.id}',
            'data': None
        }
    
    async def _handle_circuit_break(
        self,
        error: WorkflowError,
        strategy: RecoveryStrategy,
        node: WorkflowNode,
        context: WorkflowExecutionContext,
        step: ExecutionStep
    ) -> Dict[str, Any]:
        """处理断路器策略"""
        
        # 打开断路器
        if node.id not in self.circuit_breakers:
            self.circuit_breakers[node.id] = CircuitBreakerState()
        
        self.circuit_breakers[node.id].is_open = True
        self.circuit_breakers[node.id].last_failure_time = time.time()
        
        return {
            'action': 'circuit_break',
            'success': False,
            'error': f'Circuit breaker opened for node {node.id}',
            'data': strategy.fallback_value
        }
    
    def get_error_statistics(self) -> Dict[str, Any]:
        """获取错误统计信息"""
        
        if not self.error_history:
            return {
                'total_errors': 0,
                'error_types': {},
                'top_failing_nodes': [],
                'recent_errors': []
            }
        
        error_types = {}
        node_errors = {}
        
        for error in self.error_history:
            # 统计错误类型
            error_type = error.error_type.value
            error_types[error_type] = error_types.get(error_type, 0) + 1
            
            # 统计节点错误
            if error.node_id:
                node_errors[error.node_id] = node_errors.get(error.node_id, 0) + 1
        
        # 获取最近的错误
        recent_errors = sorted(
            self.error_history[-20:],
            key=lambda e: e.timestamp,
            reverse=True
        )
        
        return {
            'total_errors': len(self.error_history),
            'error_types': error_types,
            'top_failing_nodes': sorted(
                node_errors.items(),
                key=lambda x: x[1],
                reverse=True
            )[:10],
            'recent_errors': [
                {
                    'timestamp': error.timestamp,
                    'error_type': error.error_type.value,
                    'node_id': error.node_id,
                    'message': error.message[:100]
                }
                for error in recent_errors
            ]
        }
    
    def clear_retry_counts(self):
        """清除重试计数"""
        self.retry_counts.clear()
    
    def reset_circuit_breakers(self):
        """重置断路器状态"""
        self.circuit_breakers.clear()


# 全局错误处理器实例
workflow_error_handler = WorkflowErrorHandler()