"""
工作流状态持久化管理器
支持检查点、状态恢复、分布式状态管理
"""

import asyncio
import json
import time
import uuid
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timedelta
import structlog
import redis.asyncio as redis
from contextlib import asynccontextmanager

from app.schemas.workflow import (
    WorkflowExecutionContext,
    ExecutionStep,
    WorkflowDefinition
)
from app.core.config import settings

logger = structlog.get_logger(__name__)


class WorkflowStateManager:
    """工作流状态管理器"""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.state_prefix = "workflow_state"
        self.execution_prefix = "workflow_execution"
        self.checkpoint_prefix = "workflow_checkpoint"
        self.lock_prefix = "workflow_lock"
        self.state_ttl = 3600 * 24 * 7  # 7天过期
        self.lock_ttl = 300  # 5分钟锁过期
        
    async def initialize(self):
        """初始化Redis连接"""
        if not self.redis_client:
            try:
                self.redis_client = redis.from_url(
                    settings.REDIS_URL,
                    decode_responses=True,
                    socket_timeout=5,
                    socket_connect_timeout=5
                )
                # 测试连接
                await self.redis_client.ping()
                logger.info("工作流状态管理器初始化成功")
            except Exception as e:
                logger.error(f"Redis连接失败: {e}")
                self.redis_client = None
    
    async def close(self):
        """关闭Redis连接"""
        if self.redis_client:
            await self.redis_client.close()
            self.redis_client = None
    
    @asynccontextmanager
    async def _get_redis(self):
        """获取Redis客户端"""
        if not self.redis_client:
            await self.initialize()
        
        if not self.redis_client:
            raise RuntimeError("Redis连接不可用")
        
        yield self.redis_client
    
    async def save_execution_state(
        self,
        execution_context: WorkflowExecutionContext,
        create_checkpoint: bool = False
    ) -> bool:
        """保存执行状态"""
        try:
            async with self._get_redis() as redis_client:
                # 序列化执行上下文
                state_data = {
                    "execution_id": execution_context.execution_id,
                    "workflow_id": execution_context.workflow_id,
                    "status": execution_context.status,
                    "start_time": execution_context.start_time,
                    "end_time": execution_context.end_time,
                    "input_data": execution_context.input_data,
                    "output_data": execution_context.output_data,
                    "global_context": execution_context.global_context,
                    "steps": [
                        {
                            "step_id": step.step_id,
                            "node_id": step.node_id,
                            "node_name": step.node_name,
                            "status": step.status,
                            "start_time": step.start_time,
                            "end_time": step.end_time,
                            "duration": step.duration,
                            "input_data": step.input_data,
                            "output_data": step.output_data,
                            "error": step.error,
                            "memory_usage": step.memory_usage,
                            "metrics": step.metrics,
                        }
                        for step in execution_context.steps
                    ],
                    "checkpoints": execution_context.checkpoints,
                    "metrics": execution_context.metrics,
                    "error": execution_context.error,
                    "updated_at": time.time(),
                }
                
                # 保存执行状态
                state_key = f"{self.execution_prefix}:{execution_context.execution_id}"
                await redis_client.set(
                    state_key,
                    json.dumps(state_data),
                    ex=self.state_ttl
                )
                
                # 创建检查点
                if create_checkpoint:
                    checkpoint_key = f"{self.checkpoint_prefix}:{execution_context.execution_id}:{len(execution_context.checkpoints)}"
                    await redis_client.set(
                        checkpoint_key,
                        json.dumps(state_data),
                        ex=self.state_ttl
                    )
                    
                    # 添加到检查点列表
                    execution_context.checkpoints.append({
                        "checkpoint_id": len(execution_context.checkpoints),
                        "timestamp": time.time(),
                        "step_count": len(execution_context.steps),
                        "key": checkpoint_key
                    })
                
                # 更新工作流执行索引
                workflow_key = f"{self.state_prefix}:{execution_context.workflow_id}:executions"
                await redis_client.sadd(workflow_key, execution_context.execution_id)
                await redis_client.expire(workflow_key, self.state_ttl)
                
                logger.debug(
                    "执行状态保存成功",
                    execution_id=execution_context.execution_id,
                    checkpoint_created=create_checkpoint
                )
                
                return True
                
        except Exception as e:
            logger.error(
                "保存执行状态失败",
                execution_id=execution_context.execution_id,
                error=str(e),
                exc_info=True
            )
            return False
    
    async def load_execution_state(
        self,
        execution_id: str
    ) -> Optional[WorkflowExecutionContext]:
        """加载执行状态"""
        try:
            async with self._get_redis() as redis_client:
                state_key = f"{self.execution_prefix}:{execution_id}"
                state_data = await redis_client.get(state_key)
                
                if not state_data:
                    logger.warning(f"执行状态不存在: {execution_id}")
                    return None
                
                # 反序列化状态数据
                data = json.loads(state_data)
                
                # 重建执行步骤
                steps = []
                for step_data in data.get("steps", []):
                    step = ExecutionStep(
                        step_id=step_data["step_id"],
                        node_id=step_data["node_id"],
                        node_name=step_data["node_name"],
                        status=step_data["status"],
                        start_time=step_data.get("start_time"),
                        end_time=step_data.get("end_time"),
                        duration=step_data.get("duration"),
                        input_data=step_data.get("input_data", {}),
                        output_data=step_data.get("output_data", {}),
                        error=step_data.get("error"),
                        memory_usage=step_data.get("memory_usage"),
                        metrics=step_data.get("metrics", {}),
                    )
                    steps.append(step)
                
                # 重建执行上下文
                execution_context = WorkflowExecutionContext(
                    execution_id=data["execution_id"],
                    workflow_id=data["workflow_id"],
                    status=data["status"],
                    start_time=data["start_time"],
                    end_time=data.get("end_time"),
                    input_data=data.get("input_data", {}),
                    output_data=data.get("output_data", {}),
                    global_context=data.get("global_context", {}),
                    steps=steps,
                    checkpoints=data.get("checkpoints", []),
                    metrics=data.get("metrics", {}),
                    error=data.get("error"),
                )
                
                logger.debug(
                    "执行状态加载成功",
                    execution_id=execution_id,
                    steps_count=len(steps)
                )
                
                return execution_context
                
        except Exception as e:
            logger.error(
                "加载执行状态失败",
                execution_id=execution_id,
                error=str(e),
                exc_info=True
            )
            return None
    
    async def resume_from_checkpoint(
        self,
        execution_id: str,
        checkpoint_id: int
    ) -> Optional[WorkflowExecutionContext]:
        """从检查点恢复"""
        try:
            async with self._get_redis() as redis_client:
                checkpoint_key = f"{self.checkpoint_prefix}:{execution_id}:{checkpoint_id}"
                checkpoint_data = await redis_client.get(checkpoint_key)
                
                if not checkpoint_data:
                    logger.warning(f"检查点不存在: {checkpoint_key}")
                    return None
                
                # 反序列化检查点数据
                data = json.loads(checkpoint_data)
                
                # 重建执行步骤
                steps = []
                for step_data in data.get("steps", []):
                    step = ExecutionStep(
                        step_id=step_data["step_id"],
                        node_id=step_data["node_id"],
                        node_name=step_data["node_name"],
                        status=step_data["status"],
                        start_time=step_data.get("start_time"),
                        end_time=step_data.get("end_time"),
                        duration=step_data.get("duration"),
                        input_data=step_data.get("input_data", {}),
                        output_data=step_data.get("output_data", {}),
                        error=step_data.get("error"),
                        memory_usage=step_data.get("memory_usage"),
                        metrics=step_data.get("metrics", {}),
                    )
                    steps.append(step)
                
                # 重建执行上下文
                execution_context = WorkflowExecutionContext(
                    execution_id=data["execution_id"],
                    workflow_id=data["workflow_id"],
                    status="running",  # 重置状态为运行中
                    start_time=data["start_time"],
                    end_time=None,  # 重置结束时间
                    input_data=data.get("input_data", {}),
                    output_data=data.get("output_data", {}),
                    global_context=data.get("global_context", {}),
                    steps=steps,
                    checkpoints=data.get("checkpoints", []),
                    metrics=data.get("metrics", {}),
                    error=None,  # 重置错误
                )
                
                logger.info(
                    "从检查点恢复成功",
                    execution_id=execution_id,
                    checkpoint_id=checkpoint_id,
                    steps_count=len(steps)
                )
                
                return execution_context
                
        except Exception as e:
            logger.error(
                "从检查点恢复失败",
                execution_id=execution_id,
                checkpoint_id=checkpoint_id,
                error=str(e),
                exc_info=True
            )
            return None
    
    async def get_workflow_executions(
        self,
        workflow_id: str,
        limit: int = 100
    ) -> List[str]:
        """获取工作流的执行列表"""
        try:
            async with self._get_redis() as redis_client:
                workflow_key = f"{self.state_prefix}:{workflow_id}:executions"
                execution_ids = await redis_client.smembers(workflow_key)
                
                # 按时间排序（最新的在前）
                executions_with_time = []
                for execution_id in execution_ids:
                    state_key = f"{self.execution_prefix}:{execution_id}"
                    state_data = await redis_client.get(state_key)
                    
                    if state_data:
                        data = json.loads(state_data)
                        executions_with_time.append({
                            "execution_id": execution_id,
                            "start_time": data.get("start_time", 0)
                        })
                
                # 按开始时间排序
                executions_with_time.sort(key=lambda x: x["start_time"], reverse=True)
                
                return [exec_info["execution_id"] for exec_info in executions_with_time[:limit]]
                
        except Exception as e:
            logger.error(
                "获取工作流执行列表失败",
                workflow_id=workflow_id,
                error=str(e),
                exc_info=True
            )
            return []
    
    async def acquire_execution_lock(
        self,
        execution_id: str,
        timeout: int = 300
    ) -> bool:
        """获取执行锁"""
        try:
            async with self._get_redis() as redis_client:
                lock_key = f"{self.lock_prefix}:{execution_id}"
                lock_value = f"{uuid.uuid4().hex}:{time.time()}"
                
                # 尝试获取锁
                result = await redis_client.set(
                    lock_key,
                    lock_value,
                    nx=True,
                    ex=timeout
                )
                
                if result:
                    logger.debug(f"获取执行锁成功: {execution_id}")
                    return True
                else:
                    logger.warning(f"获取执行锁失败: {execution_id}")
                    return False
                    
        except Exception as e:
            logger.error(
                "获取执行锁失败",
                execution_id=execution_id,
                error=str(e),
                exc_info=True
            )
            return False
    
    async def release_execution_lock(
        self,
        execution_id: str
    ) -> bool:
        """释放执行锁"""
        try:
            async with self._get_redis() as redis_client:
                lock_key = f"{self.lock_prefix}:{execution_id}"
                await redis_client.delete(lock_key)
                
                logger.debug(f"释放执行锁成功: {execution_id}")
                return True
                
        except Exception as e:
            logger.error(
                "释放执行锁失败",
                execution_id=execution_id,
                error=str(e),
                exc_info=True
            )
            return False
    
    async def cleanup_expired_states(self) -> int:
        """清理过期状态"""
        try:
            async with self._get_redis() as redis_client:
                # 获取所有执行状态键
                pattern = f"{self.execution_prefix}:*"
                keys = await redis_client.keys(pattern)
                
                cleaned_count = 0
                current_time = time.time()
                
                for key in keys:
                    try:
                        state_data = await redis_client.get(key)
                        if state_data:
                            data = json.loads(state_data)
                            updated_at = data.get("updated_at", 0)
                            
                            # 检查是否过期（超过7天未更新）
                            if current_time - updated_at > self.state_ttl:
                                await redis_client.delete(key)
                                cleaned_count += 1
                                
                                # 清理相关的检查点
                                execution_id = key.split(":")[-1]
                                checkpoint_pattern = f"{self.checkpoint_prefix}:{execution_id}:*"
                                checkpoint_keys = await redis_client.keys(checkpoint_pattern)
                                if checkpoint_keys:
                                    await redis_client.delete(*checkpoint_keys)
                                
                    except Exception as e:
                        logger.warning(f"清理状态失败: {key}, {e}")
                
                if cleaned_count > 0:
                    logger.info(f"清理了 {cleaned_count} 个过期状态")
                
                return cleaned_count
                
        except Exception as e:
            logger.error(
                "清理过期状态失败",
                error=str(e),
                exc_info=True
            )
            return 0
    
    async def get_execution_metrics(
        self,
        workflow_id: str,
        time_range: timedelta = timedelta(days=7)
    ) -> Dict[str, Any]:
        """获取执行指标"""
        try:
            async with self._get_redis() as redis_client:
                execution_ids = await self.get_workflow_executions(workflow_id)
                
                total_executions = 0
                successful_executions = 0
                failed_executions = 0
                total_duration = 0
                avg_duration = 0
                execution_count_by_status = {}
                
                current_time = time.time()
                time_threshold = current_time - time_range.total_seconds()
                
                for execution_id in execution_ids:
                    state_key = f"{self.execution_prefix}:{execution_id}"
                    state_data = await redis_client.get(state_key)
                    
                    if state_data:
                        data = json.loads(state_data)
                        start_time = data.get("start_time", 0)
                        
                        # 只统计指定时间范围内的执行
                        if start_time >= time_threshold:
                            total_executions += 1
                            status = data.get("status", "unknown")
                            
                            execution_count_by_status[status] = execution_count_by_status.get(status, 0) + 1
                            
                            if status == "completed":
                                successful_executions += 1
                            elif status == "error":
                                failed_executions += 1
                            
                            # 计算持续时间
                            end_time = data.get("end_time")
                            if end_time and start_time:
                                duration = end_time - start_time
                                total_duration += duration
                
                if total_executions > 0:
                    avg_duration = total_duration / total_executions
                    success_rate = successful_executions / total_executions
                    failure_rate = failed_executions / total_executions
                else:
                    success_rate = 0
                    failure_rate = 0
                
                return {
                    "total_executions": total_executions,
                    "successful_executions": successful_executions,
                    "failed_executions": failed_executions,
                    "success_rate": success_rate,
                    "failure_rate": failure_rate,
                    "avg_duration": avg_duration,
                    "total_duration": total_duration,
                    "execution_count_by_status": execution_count_by_status,
                    "time_range_days": time_range.days
                }
                
        except Exception as e:
            logger.error(
                "获取执行指标失败",
                workflow_id=workflow_id,
                error=str(e),
                exc_info=True
            )
            return {}


# 全局状态管理器实例
workflow_state_manager = WorkflowStateManager()


# 自动清理任务
async def auto_cleanup_task():
    """自动清理过期状态的后台任务"""
    while True:
        try:
            await asyncio.sleep(3600)  # 每小时清理一次
            await workflow_state_manager.cleanup_expired_states()
        except Exception as e:
            logger.error(f"自动清理任务失败: {e}")


# 启动自动清理任务
def start_auto_cleanup():
    """启动自动清理任务"""
    asyncio.create_task(auto_cleanup_task())