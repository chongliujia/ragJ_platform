"""
工作流性能监控系统
提供全面的性能指标收集、分析和可视化功能
"""

import asyncio
import time
import json
import uuid
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum
from collections import defaultdict, deque
import statistics
from datetime import datetime, timedelta
import structlog
import psutil
import threading
from contextlib import asynccontextmanager

from app.schemas.workflow import WorkflowExecutionContext, ExecutionStep, WorkflowNode

logger = structlog.get_logger(__name__)


class MetricType(Enum):
    """指标类型"""
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    TIMER = "timer"
    RATE = "rate"


class AlertSeverity(Enum):
    """告警严重程度"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


@dataclass
class PerformanceMetric:
    """性能指标"""
    name: str
    value: float
    timestamp: float
    labels: Dict[str, str] = field(default_factory=dict)
    metric_type: MetricType = MetricType.GAUGE
    unit: str = ""
    description: str = ""


@dataclass
class SystemMetrics:
    """系统指标"""
    cpu_usage: float
    memory_usage: float
    disk_usage: float
    network_io: Dict[str, float]
    process_count: int
    thread_count: int
    timestamp: float


@dataclass
class WorkflowMetrics:
    """工作流指标"""
    workflow_id: str
    execution_id: str
    status: str
    start_time: float
    end_time: Optional[float]
    total_duration: Optional[float]
    node_count: int
    completed_nodes: int
    failed_nodes: int
    recovered_nodes: int
    average_node_duration: float
    longest_node_duration: float
    shortest_node_duration: float
    resource_utilization: Dict[str, float]
    error_rate: float
    throughput: float  # 节点/秒
    labels: Dict[str, str] = field(default_factory=dict)


@dataclass
class NodeMetrics:
    """节点指标"""
    node_id: str
    node_name: str
    node_type: str
    execution_count: int
    total_duration: float
    average_duration: float
    min_duration: float
    max_duration: float
    success_rate: float
    error_rate: float
    last_execution_time: float
    resource_usage: Dict[str, float]
    performance_trend: List[float]  # 最近执行时间趋势
    labels: Dict[str, str] = field(default_factory=dict)


@dataclass
class Alert:
    """告警信息"""
    alert_id: str
    severity: AlertSeverity
    metric_name: str
    threshold: float
    current_value: float
    message: str
    timestamp: float
    workflow_id: Optional[str] = None
    node_id: Optional[str] = None
    resolved: bool = False
    resolved_time: Optional[float] = None


class AlertRule:
    """告警规则"""
    
    def __init__(
        self,
        name: str,
        metric_name: str,
        threshold: float,
        comparison: str,  # >, <, >=, <=, ==
        severity: AlertSeverity,
        message_template: str,
        labels: Dict[str, str] = None
    ):
        self.name = name
        self.metric_name = metric_name
        self.threshold = threshold
        self.comparison = comparison
        self.severity = severity
        self.message_template = message_template
        self.labels = labels or {}
    
    def evaluate(self, metric: PerformanceMetric) -> bool:
        """评估告警条件"""
        if metric.name != self.metric_name:
            return False
        
        # 检查标签匹配
        if self.labels:
            for key, value in self.labels.items():
                if metric.labels.get(key) != value:
                    return False
        
        # 评估阈值条件
        if self.comparison == '>':
            return metric.value > self.threshold
        elif self.comparison == '<':
            return metric.value < self.threshold
        elif self.comparison == '>=':
            return metric.value >= self.threshold
        elif self.comparison == '<=':
            return metric.value <= self.threshold
        elif self.comparison == '==':
            return metric.value == self.threshold
        
        return False
    
    def create_alert(self, metric: PerformanceMetric) -> Alert:
        """创建告警"""
        return Alert(
            alert_id=str(uuid.uuid4()),
            severity=self.severity,
            metric_name=self.metric_name,
            threshold=self.threshold,
            current_value=metric.value,
            message=self.message_template.format(
                metric_name=self.metric_name,
                threshold=self.threshold,
                current_value=metric.value,
                **metric.labels
            ),
            timestamp=time.time(),
            workflow_id=metric.labels.get('workflow_id'),
            node_id=metric.labels.get('node_id')
        )


class WorkflowPerformanceMonitor:
    """工作流性能监控器"""
    
    def __init__(self, max_history_size: int = 10000):
        self.max_history_size = max_history_size
        
        # 指标存储
        self.metrics_history: deque = deque(maxlen=max_history_size)
        self.workflow_metrics: Dict[str, WorkflowMetrics] = {}
        self.node_metrics: Dict[str, NodeMetrics] = {}
        self.system_metrics_history: deque = deque(maxlen=1000)
        
        # 告警系统
        self.alert_rules: List[AlertRule] = []
        self.active_alerts: Dict[str, Alert] = {}
        self.alert_history: deque = deque(maxlen=1000)
        
        # 性能统计
        self.performance_stats: Dict[str, Dict[str, Any]] = defaultdict(dict)
        
        # 监控配置
        self.monitoring_enabled = True
        self.system_monitoring_enabled = True
        self.alert_enabled = True
        
        # 后台任务
        self.monitoring_tasks: List[asyncio.Task] = []
        self.system_monitor_task: Optional[asyncio.Task] = None
        
        # 线程锁
        self.lock = threading.Lock()
        
        # 初始化默认告警规则
        self._init_default_alert_rules()
    
    def _init_default_alert_rules(self):
        """初始化默认告警规则"""
        
        # 工作流执行时间告警
        self.alert_rules.append(AlertRule(
            name="workflow_execution_time_high",
            metric_name="workflow_execution_duration",
            threshold=300.0,  # 5分钟
            comparison=">",
            severity=AlertSeverity.WARNING,
            message_template="工作流 {workflow_id} 执行时间过长: {current_value:.2f}秒 (阈值: {threshold}秒)"
        ))
        
        # 节点失败率告警
        self.alert_rules.append(AlertRule(
            name="node_error_rate_high",
            metric_name="node_error_rate",
            threshold=0.1,  # 10%
            comparison=">",
            severity=AlertSeverity.ERROR,
            message_template="节点 {node_id} 错误率过高: {current_value:.2%} (阈值: {threshold:.2%})"
        ))
        
        # 系统CPU使用率告警
        self.alert_rules.append(AlertRule(
            name="system_cpu_high",
            metric_name="system_cpu_usage",
            threshold=80.0,  # 80%
            comparison=">",
            severity=AlertSeverity.WARNING,
            message_template="系统CPU使用率过高: {current_value:.1f}% (阈值: {threshold:.1f}%)"
        ))
        
        # 系统内存使用率告警
        self.alert_rules.append(AlertRule(
            name="system_memory_high",
            metric_name="system_memory_usage",
            threshold=85.0,  # 85%
            comparison=">",
            severity=AlertSeverity.WARNING,
            message_template="系统内存使用率过高: {current_value:.1f}% (阈值: {threshold:.1f}%)"
        ))
        
        # 工作流失败率告警
        self.alert_rules.append(AlertRule(
            name="workflow_failure_rate_high",
            metric_name="workflow_failure_rate",
            threshold=0.2,  # 20%
            comparison=">",
            severity=AlertSeverity.ERROR,
            message_template="工作流失败率过高: {current_value:.2%} (阈值: {threshold:.2%})"
        ))
    
    async def start_monitoring(self):
        """启动监控"""
        if not self.monitoring_enabled:
            return
        
        logger.info("启动性能监控")
        
        # 启动系统监控任务
        if self.system_monitoring_enabled:
            self.system_monitor_task = asyncio.create_task(self._system_monitor_loop())
        
        # 启动告警检查任务
        if self.alert_enabled:
            alert_task = asyncio.create_task(self._alert_check_loop())
            self.monitoring_tasks.append(alert_task)
        
        # 启动性能统计任务
        stats_task = asyncio.create_task(self._performance_stats_loop())
        self.monitoring_tasks.append(stats_task)
    
    async def stop_monitoring(self):
        """停止监控"""
        logger.info("停止性能监控")
        
        # 停止系统监控任务
        if self.system_monitor_task:
            self.system_monitor_task.cancel()
            try:
                await self.system_monitor_task
            except asyncio.CancelledError:
                pass
        
        # 停止其他监控任务
        for task in self.monitoring_tasks:
            task.cancel()
        
        # 等待所有任务完成
        if self.monitoring_tasks:
            await asyncio.gather(*self.monitoring_tasks, return_exceptions=True)
        
        self.monitoring_tasks.clear()
    
    def record_metric(self, metric: PerformanceMetric):
        """记录性能指标"""
        if not self.monitoring_enabled:
            return
        
        with self.lock:
            self.metrics_history.append(metric)
            
            # 检查告警
            if self.alert_enabled:
                self._check_alerts(metric)
    
    def record_workflow_execution(self, context: WorkflowExecutionContext):
        """记录工作流执行"""
        if not self.monitoring_enabled:
            return
        
        # 计算工作流指标
        start_time = context.start_time
        end_time = context.end_time
        duration = end_time - start_time if end_time else None
        
        completed_nodes = len([s for s in context.steps if s.status == "completed"])
        failed_nodes = len([s for s in context.steps if s.status == "error"])
        recovered_nodes = len([s for s in context.steps if s.status == "recovered"])
        
        # 计算节点执行时间统计
        node_durations = [s.duration for s in context.steps if s.duration]
        avg_duration = statistics.mean(node_durations) if node_durations else 0
        max_duration = max(node_durations) if node_durations else 0
        min_duration = min(node_durations) if node_durations else 0
        
        # 计算错误率和吞吐量
        error_rate = failed_nodes / len(context.steps) if context.steps else 0
        throughput = len(context.steps) / duration if duration and duration > 0 else 0
        
        # 创建工作流指标
        workflow_metrics = WorkflowMetrics(
            workflow_id=context.workflow_id,
            execution_id=context.execution_id,
            status=context.status,
            start_time=start_time,
            end_time=end_time,
            total_duration=duration,
            node_count=len(context.steps),
            completed_nodes=completed_nodes,
            failed_nodes=failed_nodes,
            recovered_nodes=recovered_nodes,
            average_node_duration=avg_duration,
            longest_node_duration=max_duration,
            shortest_node_duration=min_duration,
            resource_utilization={},  # 需要从资源监控器获取
            error_rate=error_rate,
            throughput=throughput,
            labels={"workflow_id": context.workflow_id}
        )
        
        with self.lock:
            self.workflow_metrics[context.execution_id] = workflow_metrics
        
        # 记录具体指标
        self.record_metric(PerformanceMetric(
            name="workflow_execution_duration",
            value=duration if duration else 0,
            timestamp=time.time(),
            labels={"workflow_id": context.workflow_id},
            metric_type=MetricType.TIMER,
            unit="seconds"
        ))
        
        self.record_metric(PerformanceMetric(
            name="workflow_node_count",
            value=len(context.steps),
            timestamp=time.time(),
            labels={"workflow_id": context.workflow_id},
            metric_type=MetricType.GAUGE,
            unit="count"
        ))
        
        self.record_metric(PerformanceMetric(
            name="workflow_error_rate",
            value=error_rate,
            timestamp=time.time(),
            labels={"workflow_id": context.workflow_id},
            metric_type=MetricType.GAUGE,
            unit="percentage"
        ))
        
        # 记录节点级别指标
        self._record_node_metrics(context.steps)
    
    def _record_node_metrics(self, steps: List[ExecutionStep]):
        """记录节点级别指标"""
        
        for step in steps:
            if not step.node_id:
                continue
            
            # 更新节点指标
            with self.lock:
                if step.node_id not in self.node_metrics:
                    self.node_metrics[step.node_id] = NodeMetrics(
                        node_id=step.node_id,
                        node_name=step.node_name,
                        node_type="",  # 需要从节点定义获取
                        execution_count=0,
                        total_duration=0,
                        average_duration=0,
                        min_duration=float('inf'),
                        max_duration=0,
                        success_rate=0,
                        error_rate=0,
                        last_execution_time=0,
                        resource_usage={},
                        performance_trend=[],
                        labels={"node_id": step.node_id}
                    )
                
                node_metrics = self.node_metrics[step.node_id]
                node_metrics.execution_count += 1
                node_metrics.last_execution_time = time.time()
                
                if step.duration:
                    node_metrics.total_duration += step.duration
                    node_metrics.average_duration = node_metrics.total_duration / node_metrics.execution_count
                    node_metrics.min_duration = min(node_metrics.min_duration, step.duration)
                    node_metrics.max_duration = max(node_metrics.max_duration, step.duration)
                    
                    # 更新性能趋势
                    node_metrics.performance_trend.append(step.duration)
                    if len(node_metrics.performance_trend) > 100:
                        node_metrics.performance_trend.pop(0)
                
                # 更新成功率
                if step.status == "completed":
                    node_metrics.success_rate = (
                        node_metrics.success_rate * (node_metrics.execution_count - 1) + 1
                    ) / node_metrics.execution_count
                elif step.status == "error":
                    node_metrics.error_rate = (
                        node_metrics.error_rate * (node_metrics.execution_count - 1) + 1
                    ) / node_metrics.execution_count
            
            # 记录节点指标
            if step.duration:
                self.record_metric(PerformanceMetric(
                    name="node_execution_duration",
                    value=step.duration,
                    timestamp=time.time(),
                    labels={
                        "node_id": step.node_id,
                        "node_name": step.node_name,
                        "status": step.status
                    },
                    metric_type=MetricType.TIMER,
                    unit="seconds"
                ))
            
            # 记录节点错误率
            if step.status == "error":
                self.record_metric(PerformanceMetric(
                    name="node_error_rate",
                    value=self.node_metrics[step.node_id].error_rate,
                    timestamp=time.time(),
                    labels={"node_id": step.node_id},
                    metric_type=MetricType.GAUGE,
                    unit="percentage"
                ))
    
    async def _system_monitor_loop(self):
        """系统监控循环"""
        while True:
            try:
                # 获取系统指标
                cpu_percent = psutil.cpu_percent(interval=1)
                memory = psutil.virtual_memory()
                disk = psutil.disk_usage('/')
                net_io = psutil.net_io_counters()
                
                system_metrics = SystemMetrics(
                    cpu_usage=cpu_percent,
                    memory_usage=memory.percent,
                    disk_usage=disk.percent,
                    network_io={
                        "bytes_sent": net_io.bytes_sent,
                        "bytes_recv": net_io.bytes_recv,
                        "packets_sent": net_io.packets_sent,
                        "packets_recv": net_io.packets_recv
                    },
                    process_count=len(psutil.pids()),
                    thread_count=threading.active_count(),
                    timestamp=time.time()
                )
                
                with self.lock:
                    self.system_metrics_history.append(system_metrics)
                
                # 记录系统指标
                self.record_metric(PerformanceMetric(
                    name="system_cpu_usage",
                    value=cpu_percent,
                    timestamp=time.time(),
                    metric_type=MetricType.GAUGE,
                    unit="percentage"
                ))
                
                self.record_metric(PerformanceMetric(
                    name="system_memory_usage",
                    value=memory.percent,
                    timestamp=time.time(),
                    metric_type=MetricType.GAUGE,
                    unit="percentage"
                ))
                
                self.record_metric(PerformanceMetric(
                    name="system_disk_usage",
                    value=disk.percent,
                    timestamp=time.time(),
                    metric_type=MetricType.GAUGE,
                    unit="percentage"
                ))
                
                await asyncio.sleep(10)  # 每10秒收集一次系统指标
                
            except Exception as e:
                logger.error(f"系统监控失败: {e}")
                await asyncio.sleep(10)
    
    async def _alert_check_loop(self):
        """告警检查循环"""
        while True:
            try:
                # 检查所有活跃告警是否需要解除
                current_time = time.time()
                resolved_alerts = []
                
                for alert_id, alert in self.active_alerts.items():
                    # 检查告警是否过期（1小时后自动解除）
                    if current_time - alert.timestamp > 3600:
                        alert.resolved = True
                        alert.resolved_time = current_time
                        resolved_alerts.append(alert_id)
                
                # 移除已解除的告警
                for alert_id in resolved_alerts:
                    resolved_alert = self.active_alerts.pop(alert_id)
                    self.alert_history.append(resolved_alert)
                
                await asyncio.sleep(60)  # 每分钟检查一次告警
                
            except Exception as e:
                logger.error(f"告警检查失败: {e}")
                await asyncio.sleep(60)
    
    async def _performance_stats_loop(self):
        """性能统计循环"""
        while True:
            try:
                # 计算性能统计
                self._calculate_performance_statistics()
                await asyncio.sleep(300)  # 每5分钟计算一次统计
                
            except Exception as e:
                logger.error(f"性能统计计算失败: {e}")
                await asyncio.sleep(300)
    
    def _check_alerts(self, metric: PerformanceMetric):
        """检查告警条件"""
        for rule in self.alert_rules:
            if rule.evaluate(metric):
                # 创建告警
                alert = rule.create_alert(metric)
                
                # 检查是否已有相同告警
                alert_key = f"{rule.name}_{metric.labels.get('workflow_id', '')}_{metric.labels.get('node_id', '')}"
                
                if alert_key not in self.active_alerts:
                    self.active_alerts[alert_key] = alert
                    logger.warning(f"触发告警: {alert.message}")
    
    def _calculate_performance_statistics(self):
        """计算性能统计"""
        current_time = time.time()
        
        with self.lock:
            # 工作流统计
            workflow_stats = {
                "total_executions": len(self.workflow_metrics),
                "completed_executions": len([w for w in self.workflow_metrics.values() if w.status == "completed"]),
                "failed_executions": len([w for w in self.workflow_metrics.values() if w.status == "error"]),
                "average_execution_time": 0,
                "total_nodes_processed": 0,
                "average_throughput": 0
            }
            
            if self.workflow_metrics:
                completed_workflows = [w for w in self.workflow_metrics.values() if w.total_duration]
                if completed_workflows:
                    workflow_stats["average_execution_time"] = statistics.mean(
                        [w.total_duration for w in completed_workflows]
                    )
                    workflow_stats["total_nodes_processed"] = sum(w.node_count for w in completed_workflows)
                    workflow_stats["average_throughput"] = statistics.mean(
                        [w.throughput for w in completed_workflows]
                    )
            
            # 节点统计
            node_stats = {
                "total_nodes": len(self.node_metrics),
                "total_executions": sum(n.execution_count for n in self.node_metrics.values()),
                "average_execution_time": 0,
                "slowest_nodes": [],
                "fastest_nodes": [],
                "most_error_prone_nodes": []
            }
            
            if self.node_metrics:
                node_stats["average_execution_time"] = statistics.mean(
                    [n.average_duration for n in self.node_metrics.values() if n.average_duration > 0]
                )
                
                # 最慢的节点
                sorted_by_duration = sorted(
                    self.node_metrics.values(),
                    key=lambda n: n.average_duration,
                    reverse=True
                )
                node_stats["slowest_nodes"] = [
                    {
                        "node_id": n.node_id,
                        "node_name": n.node_name,
                        "average_duration": n.average_duration
                    }
                    for n in sorted_by_duration[:5]
                ]
                
                # 最快的节点
                node_stats["fastest_nodes"] = [
                    {
                        "node_id": n.node_id,
                        "node_name": n.node_name,
                        "average_duration": n.average_duration
                    }
                    for n in sorted_by_duration[-5:]
                ]
                
                # 错误率最高的节点
                sorted_by_error_rate = sorted(
                    self.node_metrics.values(),
                    key=lambda n: n.error_rate,
                    reverse=True
                )
                node_stats["most_error_prone_nodes"] = [
                    {
                        "node_id": n.node_id,
                        "node_name": n.node_name,
                        "error_rate": n.error_rate
                    }
                    for n in sorted_by_error_rate[:5] if n.error_rate > 0
                ]
            
            # 系统统计
            system_stats = {}
            if self.system_metrics_history:
                recent_metrics = list(self.system_metrics_history)[-60:]  # 最近10分钟
                system_stats = {
                    "average_cpu_usage": statistics.mean([m.cpu_usage for m in recent_metrics]),
                    "average_memory_usage": statistics.mean([m.memory_usage for m in recent_metrics]),
                    "average_disk_usage": statistics.mean([m.disk_usage for m in recent_metrics]),
                    "current_process_count": recent_metrics[-1].process_count if recent_metrics else 0,
                    "current_thread_count": recent_metrics[-1].thread_count if recent_metrics else 0
                }
            
            # 更新性能统计
            self.performance_stats = {
                "workflow_statistics": workflow_stats,
                "node_statistics": node_stats,
                "system_statistics": system_stats,
                "last_updated": current_time
            }
    
    def get_performance_dashboard(self) -> Dict[str, Any]:
        """获取性能仪表板数据"""
        with self.lock:
            return {
                "statistics": self.performance_stats,
                "active_alerts": {
                    "count": len(self.active_alerts),
                    "alerts": [asdict(alert) for alert in self.active_alerts.values()]
                },
                "recent_metrics": [
                    asdict(metric) for metric in list(self.metrics_history)[-100:]
                ],
                "system_status": {
                    "monitoring_enabled": self.monitoring_enabled,
                    "alert_enabled": self.alert_enabled,
                    "metrics_count": len(self.metrics_history),
                    "workflow_count": len(self.workflow_metrics),
                    "node_count": len(self.node_metrics)
                }
            }
    
    def get_workflow_performance_report(self, workflow_id: str) -> Dict[str, Any]:
        """获取工作流性能报告"""
        with self.lock:
            workflow_executions = [
                w for w in self.workflow_metrics.values()
                if w.workflow_id == workflow_id
            ]
            
            if not workflow_executions:
                return {"error": "No executions found for workflow"}
            
            # 计算统计数据
            completed_executions = [w for w in workflow_executions if w.status == "completed"]
            failed_executions = [w for w in workflow_executions if w.status == "error"]
            
            return {
                "workflow_id": workflow_id,
                "summary": {
                    "total_executions": len(workflow_executions),
                    "completed_executions": len(completed_executions),
                    "failed_executions": len(failed_executions),
                    "success_rate": len(completed_executions) / len(workflow_executions) if workflow_executions else 0
                },
                "performance": {
                    "average_duration": statistics.mean([w.total_duration for w in completed_executions if w.total_duration]) if completed_executions else 0,
                    "min_duration": min([w.total_duration for w in completed_executions if w.total_duration]) if completed_executions else 0,
                    "max_duration": max([w.total_duration for w in completed_executions if w.total_duration]) if completed_executions else 0,
                    "average_throughput": statistics.mean([w.throughput for w in completed_executions]) if completed_executions else 0
                },
                "recent_executions": [asdict(w) for w in workflow_executions[-10:]]
            }
    
    def get_node_performance_report(self, node_id: str) -> Dict[str, Any]:
        """获取节点性能报告"""
        with self.lock:
            if node_id not in self.node_metrics:
                return {"error": "Node not found"}
            
            node_metrics = self.node_metrics[node_id]
            
            # 计算性能趋势
            trend_analysis = {}
            if len(node_metrics.performance_trend) > 1:
                recent_trend = node_metrics.performance_trend[-10:]
                if len(recent_trend) > 1:
                    trend_analysis = {
                        "trend_direction": "improving" if recent_trend[-1] < recent_trend[0] else "degrading",
                        "trend_percentage": abs(recent_trend[-1] - recent_trend[0]) / recent_trend[0] * 100 if recent_trend[0] > 0 else 0
                    }
            
            return {
                "node_id": node_id,
                "basic_info": {
                    "node_name": node_metrics.node_name,
                    "node_type": node_metrics.node_type,
                    "execution_count": node_metrics.execution_count,
                    "last_execution": node_metrics.last_execution_time
                },
                "performance": {
                    "average_duration": node_metrics.average_duration,
                    "min_duration": node_metrics.min_duration if node_metrics.min_duration != float('inf') else 0,
                    "max_duration": node_metrics.max_duration,
                    "total_duration": node_metrics.total_duration
                },
                "reliability": {
                    "success_rate": node_metrics.success_rate,
                    "error_rate": node_metrics.error_rate
                },
                "trend_analysis": trend_analysis,
                "performance_history": node_metrics.performance_trend[-50:]  # 最近50次执行
            }
    
    def add_alert_rule(self, rule: AlertRule):
        """添加告警规则"""
        self.alert_rules.append(rule)
        logger.info(f"添加告警规则: {rule.name}")
    
    def remove_alert_rule(self, rule_name: str):
        """移除告警规则"""
        self.alert_rules = [r for r in self.alert_rules if r.name != rule_name]
        logger.info(f"移除告警规则: {rule_name}")
    
    def get_alert_summary(self) -> Dict[str, Any]:
        """获取告警摘要"""
        with self.lock:
            return {
                "active_alerts": {
                    "total": len(self.active_alerts),
                    "critical": len([a for a in self.active_alerts.values() if a.severity == AlertSeverity.CRITICAL]),
                    "error": len([a for a in self.active_alerts.values() if a.severity == AlertSeverity.ERROR]),
                    "warning": len([a for a in self.active_alerts.values() if a.severity == AlertSeverity.WARNING]),
                    "info": len([a for a in self.active_alerts.values() if a.severity == AlertSeverity.INFO])
                },
                "recent_alerts": [asdict(alert) for alert in list(self.alert_history)[-10:]],
                "alert_rules": [
                    {
                        "name": rule.name,
                        "metric_name": rule.metric_name,
                        "threshold": rule.threshold,
                        "comparison": rule.comparison,
                        "severity": rule.severity.value
                    }
                    for rule in self.alert_rules
                ]
            }
    
    def clear_history(self):
        """清空历史数据"""
        with self.lock:
            self.metrics_history.clear()
            self.workflow_metrics.clear()
            self.node_metrics.clear()
            self.system_metrics_history.clear()
            self.alert_history.clear()
            self.performance_stats.clear()
        
        logger.info("性能监控历史数据已清空")


# 全局性能监控器实例
workflow_performance_monitor = WorkflowPerformanceMonitor()