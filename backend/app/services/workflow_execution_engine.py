"""
工作流执行引擎
支持节点间数据流传递、状态管理、错误处理等
"""

import asyncio
import json
import time
import uuid
import ast
import re
import math
import inspect
import multiprocessing as mp
from dataclasses import dataclass
from typing import Dict, List, Any, Optional, Callable, Tuple
from datetime import datetime
import structlog
from concurrent.futures import ThreadPoolExecutor
import networkx as nx
import httpx

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


@dataclass(frozen=True)
class _SandboxLimits:
    timeout_sec: float = 3.0
    max_memory_mb: int = 256
    max_stdout_chars: int = 10_000
    max_input_bytes: int = 2_000_000
    max_result_bytes: int = 2_000_000


_BANNED_NAMES = {
    "__import__",
    "__builtins__",
    "__loader__",
    "__spec__",
    "open",
    "eval",
    "exec",
    "compile",
    "globals",
    "locals",
    "vars",
    "dir",
    "help",
    "input",
    "breakpoint",
    "getattr",
    "setattr",
    "delattr",
    "hasattr",
    "type",
    "object",
    "super",
    "classmethod",
    "staticmethod",
    "property",
}


def _sandbox_make_safe_builtins(print_sink: List[str], max_stdout_chars: int) -> Dict[str, Any]:
    def _safe_print(*args: Any, **kwargs: Any) -> None:
        sep = kwargs.get("sep", " ")
        end = kwargs.get("end", "\n")
        try:
            s = sep.join(str(a) for a in args) + str(end)
        except Exception:
            s = "<print error>\n"
        current = sum(len(x) for x in print_sink)
        if current >= max_stdout_chars:
            return
        remaining = max_stdout_chars - current
        print_sink.append(s[:remaining])

    return {
        "abs": abs,
        "all": all,
        "any": any,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "filter": filter,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "map": map,
        "max": max,
        "min": min,
        "pow": pow,
        "range": range,
        "reversed": reversed,
        "round": round,
        "set": set,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "zip": zip,
        "print": _safe_print,
    }


def _sandbox_validate_python_ast(code: str) -> None:
    """Best-effort AST validation (not a perfect sandbox).

    Strict policy:
    - Allow only expressions/assignments/if/for and basic data structures.
    - Disallow import/try/with/while/function/class/lambda and other high-risk statements.
    - Disallow dunder attribute access and dangerous builtins.
    """
    tree = ast.parse(code, mode="exec")

    allowed_call_names = {
        "abs",
        "all",
        "any",
        "bool",
        "dict",
        "enumerate",
        "filter",
        "float",
        "int",
        "len",
        "list",
        "map",
        "max",
        "min",
        "pow",
        "range",
        "reversed",
        "round",
        "set",
        "sorted",
        "str",
        "sum",
        "tuple",
        "zip",
        "print",
    }

    allowed_attr_modules = {"math", "json", "re"}

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ValueError("Import is not allowed in sandbox")
        if isinstance(node, (ast.Global, ast.Nonlocal)):
            raise ValueError("global/nonlocal is not allowed in sandbox")
        if isinstance(node, (ast.ClassDef, ast.AsyncFunctionDef, ast.FunctionDef, ast.Lambda)):
            raise ValueError("function/class/lambda is not allowed in sandbox")
        if isinstance(node, ast.While):
            raise ValueError("while is not allowed in sandbox (use for/range)")
        if isinstance(node, ast.Try):
            raise ValueError("try/except is not allowed in sandbox")
        if isinstance(node, ast.With):
            raise ValueError("with is not allowed in sandbox")
        if isinstance(node, (ast.Raise, ast.Assert, ast.Delete)):
            raise ValueError("raise/assert/delete is not allowed in sandbox")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                raise ValueError("Dunder attribute access is not allowed")
        if isinstance(node, ast.Name):
            if node.id in _BANNED_NAMES or node.id.startswith("__"):
                raise ValueError(f"Name not allowed in sandbox: {node.id}")
        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name):
                if fn.id not in allowed_call_names:
                    raise ValueError(f"Call not allowed in sandbox: {fn.id}")
            elif isinstance(fn, ast.Attribute):
                if fn.attr.startswith("__"):
                    raise ValueError("Dunder attribute call is not allowed")
                if isinstance(fn.value, ast.Name) and fn.value.id in allowed_attr_modules:
                    pass
                else:
                    raise ValueError("Only module attribute calls (math/json/re) are allowed")
            else:
                raise ValueError("Unsupported call target in sandbox")


def _sandbox_estimate_bytes(value: Any) -> int:
    try:
        s = json.dumps(value, ensure_ascii=False)
        return len(s.encode("utf-8", errors="ignore"))
    except Exception:
        try:
            return len(repr(value).encode("utf-8", errors="ignore"))
        except Exception:
            return 0


def _sandbox_process_entry(
    q: "mp.Queue",
    *,
    code: str,
    input_data: Any,
    context_data: Any,
    limits: _SandboxLimits,
) -> None:
    try:
        # OS-level resource limits (best-effort; may be unavailable).
        try:
            import resource

            cpu = max(1, int(math.ceil(limits.timeout_sec + 1)))
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))

            if limits.max_memory_mb and limits.max_memory_mb > 0:
                mem = int(limits.max_memory_mb) * 1024 * 1024
                try:
                    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
                except Exception:
                    pass
        except Exception:
            pass

        _sandbox_validate_python_ast(code)

        # Input/context size guard (prevents huge pickles/logs).
        in_bytes = _sandbox_estimate_bytes(input_data)
        ctx_bytes = _sandbox_estimate_bytes(context_data)
        if limits.max_input_bytes and (in_bytes + ctx_bytes) > limits.max_input_bytes:
            raise ValueError(f"input/context too large: {in_bytes + ctx_bytes} bytes (limit {limits.max_input_bytes})")

        stdout_parts: List[str] = []
        safe_builtins = _sandbox_make_safe_builtins(stdout_parts, limits.max_stdout_chars)

        sandbox_globals: Dict[str, Any] = {
            "__builtins__": safe_builtins,
            "json": json,
            "re": re,
            "math": math,
            "input_data": input_data,
            "context": context_data,
            "result": None,
        }
        sandbox_locals: Dict[str, Any] = {}

        compiled = compile(code, "<workflow_code_executor>", "exec")
        exec(compiled, sandbox_globals, sandbox_locals)

        result = sandbox_locals.get("result", sandbox_globals.get("result", None))
        stdout = "".join(stdout_parts)
        if limits.max_result_bytes:
            out_bytes = _sandbox_estimate_bytes(result)
            if out_bytes > limits.max_result_bytes:
                raise ValueError(f"result too large: {out_bytes} bytes (limit {limits.max_result_bytes})")
        q.put({"success": True, "result": result, "stdout": stdout})
    except Exception as e:
        try:
            q.put({"success": False, "error": str(e)})
        except Exception:
            pass


def _run_python_sandbox(
    *,
    code: str,
    input_data: Any,
    context_data: Any,
    limits: _SandboxLimits,
) -> Dict[str, Any]:
    q: mp.Queue = mp.Queue(maxsize=1)
    p = mp.Process(
        target=_sandbox_process_entry,
        kwargs={"q": q, "code": code, "input_data": input_data, "context_data": context_data, "limits": limits},
        daemon=True,
    )
    p.start()
    p.join(timeout=limits.timeout_sec)
    if p.is_alive():
        p.terminate()
        p.join(timeout=0.2)
        return {"success": False, "error": f"Timeout after {limits.timeout_sec}s"}
    try:
        if not q.empty():
            return q.get_nowait()
    except Exception:
        pass
    return {"success": False, "error": "Sandbox failed without result"}


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
            'http_request': self._execute_http_request_node,
        }
    
    async def execute_workflow(
        self,
        workflow_definition: WorkflowDefinition,
        input_data: Dict[str, Any],
        execution_id: Optional[str] = None,
        debug: bool = False,
        enable_parallel: Optional[bool] = None,
        on_step: Optional[Callable[[ExecutionStep, int, int], Any]] = None,
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
                    debug,
                    on_step=on_step,
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
        debug: bool = False,
        on_step: Optional[Callable[[ExecutionStep, int, int], Any]] = None,
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
        total_steps = max(len(execution_order), 1)
        
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

            if on_step:
                try:
                    maybe = on_step(step, len(context.steps), total_steps)
                    if inspect.isawaitable(maybe):
                        await maybe
                except Exception:
                    # Progress callback should never break workflow execution.
                    pass
        
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
            # 特例：LLM/RAG 等常见节点希望把 'input' 视为 prompt/query，而不是 data
            if name == 'input':
                if 'prompt' in target_inputs:
                    return 'prompt'
                if 'query' in target_inputs:
                    return 'query'
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

                # 条件边：若 condition 表达式为 false，则跳过该边的数据传递
                try:
                    cond = getattr(edge_data, "condition", None)
                    if cond and isinstance(cond, str) and cond.strip():
                        ok = self._evaluate_edge_condition(
                            cond,
                            source_payload=source_payload,
                            context=context,
                        )
                        if not ok:
                            continue
                except Exception:
                    # 条件表达式异常时，默认不阻断执行（按 true 处理）
                    pass

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

                # 仅在“键不存在”时回退到整体传递；键存在但值为 None 时应保持 None
                if isinstance(source_payload, dict) and src_key in source_payload:
                    value = source_payload[src_key]
                else:
                    # 回退到整体传递（兼容历史配置）
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
                        if isinstance(v, str):
                            input_data[k] = self._render_mustache_template(
                                v,
                                data=input_data,
                                input_data=context.input_data,
                                context_data=context.global_context,
                            )
                        else:
                            input_data[k] = v
        except Exception:
            pass

        return input_data

    _MUSTACHE_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

    def _render_mustache_template(
        self,
        template: str,
        *,
        data: Any,
        input_data: Optional[Dict[str, Any]] = None,
        context_data: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Render a minimal {{var}} template using dotted paths.

        Resolution order for {{foo}}:
          1) data.foo
          2) input.foo
          3) context.foo

        Supported explicit roots:
          - {{data.foo}}
          - {{input.foo}}
          - {{context.foo}}

        Non-string values are JSON-serialized.
        """
        if not template or "{{" not in template:
            return template
        if not isinstance(template, str):
            template = str(template)

        roots = {
            "data": data,
            "input": input_data or {},
            "context": context_data or {},
        }

        def _tokenize(path: str) -> List[str]:
            # Convert bracket indices: documents[0].text -> documents.0.text
            normalized = re.sub(r"\[(\d+)\]", r".\1", path.strip())
            return [p for p in normalized.split(".") if p]

        def _get_path(obj: Any, path: str) -> Any:
            cur: Any = obj
            for part in _tokenize(path):
                if cur is None:
                    return None
                if isinstance(cur, dict):
                    if part in cur:
                        cur = cur[part]
                        continue
                    return None
                if isinstance(cur, (list, tuple)):
                    if part.isdigit():
                        idx = int(part)
                        if 0 <= idx < len(cur):
                            cur = cur[idx]
                            continue
                    return None
                return None
            return cur

        def _stringify(value: Any) -> str:
            if value is None:
                return ""
            if isinstance(value, str):
                return value
            try:
                return json.dumps(value, ensure_ascii=False)
            except Exception:
                return str(value)

        def _resolve(expr: str) -> str:
            expr = (expr or "").strip()
            if not expr:
                return ""

            # Explicit root: input.xxx / context.xxx / data.xxx
            if expr.startswith("input."):
                return _stringify(_get_path(roots["input"], expr[len("input.") :]))
            if expr.startswith("context."):
                return _stringify(_get_path(roots["context"], expr[len("context.") :]))
            if expr.startswith("data."):
                return _stringify(_get_path(roots["data"], expr[len("data.") :]))

            for root_name in ("data", "input", "context"):
                val = _get_path(roots[root_name], expr)
                if val is not None:
                    return _stringify(val)
            return ""

        return self._MUSTACHE_RE.sub(lambda m: _resolve(m.group(1)), template)

    def _evaluate_edge_condition(
        self,
        expr: str,
        *,
        source_payload: Any,
        context: WorkflowExecutionContext,
    ) -> bool:
        """Evaluate edge condition safely (no calls/attributes/imports).

        Variables:
          - value: predecessor node output payload (usually a dict)
          - input: workflow input_data
          - context: workflow global_context
        """
        raw = (expr or "").strip()
        if not raw:
            return True
        if raw.lower() in ("true", "yes", "y", "1"):
            return True
        if raw.lower() in ("false", "no", "n", "0"):
            return False

        variables = {
            "value": source_payload,
            "input": context.input_data,
            "context": context.global_context,
        }

        tree = ast.parse(raw, mode="eval")

        allowed = (
            ast.Expression,
            ast.BoolOp,
            ast.UnaryOp,
            ast.Compare,
            ast.Name,
            ast.Load,
            ast.Constant,
            ast.Subscript,
            ast.Slice,
            ast.Tuple,
            ast.List,
            ast.Dict,
        )
        allowed_ops = (
            ast.And,
            ast.Or,
            ast.Not,
            ast.Eq,
            ast.NotEq,
            ast.In,
            ast.NotIn,
            ast.Gt,
            ast.GtE,
            ast.Lt,
            ast.LtE,
            ast.Is,
            ast.IsNot,
        )

        for node in ast.walk(tree):
            if isinstance(node, ast.Call) or isinstance(node, ast.Attribute):
                raise ValueError("Calls/attributes are not allowed in condition expressions")
            if isinstance(node, ast.BinOp):
                raise ValueError("Binary operations are not allowed in condition expressions")
            if isinstance(node, ast.Await) or isinstance(node, ast.Lambda):
                raise ValueError("Unsupported syntax in condition expressions")
            if not isinstance(node, allowed + allowed_ops):
                # Explicitly forbid anything else (e.g., comprehension, f-string, etc.)
                raise ValueError(f"Unsupported syntax in condition expressions: {type(node).__name__}")
            if isinstance(node, ast.Name) and node.id not in variables:
                raise ValueError(f"Unknown name in condition expressions: {node.id}")

        code = compile(tree, "<edge_condition>", "eval")
        return bool(eval(code, {"__builtins__": {}}, variables))
    
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
                        # 保留原始错误信息到 step.error；恢复信息写入 metrics，避免“看起来成功但无输出”
                        try:
                            step.metrics = step.metrics or {}
                            step.metrics["recovery"] = {
                                "action": action,
                                "message": recovery_result.get("message", ""),
                            }
                        except Exception:
                            pass
                        
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
        actual_data = self._normalize_input_payload(input_data)
        
        # 如果数据被多层包装，逐层解包
        while 'data' in actual_data and isinstance(actual_data['data'], dict) and len(actual_data) == 1:
            actual_data = actual_data['data']
        
        # 如果还有data键但不是唯一键，则优先使用data内的数据，但保持其他键
        if 'data' in actual_data and isinstance(actual_data['data'], dict):
            # 合并data内的数据和外层数据
            merged_data = {**actual_data}
            merged_data.update(actual_data['data'])
            actual_data = merged_data
        
        # 允许显式选择 prompt 来源字段（Dify-like）
        prompt_key = config.get('prompt_key') or config.get('prompt_field')
        prompt = None
        if isinstance(prompt_key, str) and prompt_key.strip():
            k = prompt_key.strip()
            if isinstance(actual_data, dict) and k in actual_data:
                prompt = actual_data.get(k)

        # 尝试从多个可能的键中获取提示词（兜底）
        if prompt is None:
            prompt = (
                actual_data.get('prompt') or
                actual_data.get('input') or
                actual_data.get('text') or
                actual_data.get('query') or
                actual_data.get('message') or
                (str(actual_data) if isinstance(actual_data, str) else '')
            )
        
        # 确保prompt是字符串
        if not isinstance(prompt, str):
            prompt = str(prompt) if prompt is not None else ''
        
        system_prompt = config.get('system_prompt', '')
        if isinstance(system_prompt, str) and system_prompt:
            system_prompt = self._render_mustache_template(
                system_prompt,
                data=actual_data,
                input_data=context.input_data,
                context_data=context.global_context,
            )
        if isinstance(prompt, str) and prompt:
            prompt = self._render_mustache_template(
                prompt,
                data=actual_data,
                input_data=context.input_data,
                context_data=context.global_context,
            )
        
        # 构建完整提示
        if system_prompt:
            full_prompt = f"{system_prompt}\n\n{prompt}"
        else:
            full_prompt = prompt
        
        # 调用LLM服务
        tenant_id = (
            (context.global_context or {}).get("tenant_id")
            or (context.input_data or {}).get("tenant_id")
        )
        user_id = (
            (context.global_context or {}).get("user_id")
            or (context.input_data or {}).get("user_id")
        )
        response = await llm_service.chat(
            message=full_prompt,
            # Treat empty/absent model as "use active per-tenant chat model"
            model=(config.get('model') or None),
            temperature=config.get('temperature', 0.7),
            max_tokens=config.get('max_tokens', 1000),
            tenant_id=tenant_id,
            user_id=user_id,
        )
        
        if response.get('success'):
            return {
                'content': response['message'],
                'metadata': {
                    'tokens_used': response.get('usage', {}).get('total_tokens', 0),
                    'model': response.get('model') or (config.get('model') or 'active'),
                    'finish_reason': response.get('finish_reason', 'stop')
                }
            }
        else:
            err = response.get("error", "Unknown error")
            hint = response.get("message") or ""
            raise RuntimeError(f"LLM调用失败: {err}{(' | ' + hint) if hint else ''}")
    
    async def _execute_rag_retriever_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext
    ) -> Dict[str, Any]:
        """执行RAG检索节点"""
        
        config = node.config
        actual_data = self._normalize_input_payload(input_data)
        query = (
            actual_data.get('query')
            or actual_data.get('prompt')
            or actual_data.get('text')
            or actual_data.get('input')
            or ''
        )
        knowledge_base = config.get('knowledge_base', '')
        top_k = config.get('top_k', 5)

        # 获取租户ID（优先从全局上下文，其次从输入数据）
        tenant_id = (
            (context.global_context or {}).get("tenant_id")
            or (context.input_data or {}).get("tenant_id")
        )
        user_id = (
            (context.global_context or {}).get("user_id")
            or (context.input_data or {}).get("user_id")
        )
        if tenant_id is None:
            raise RuntimeError("缺少租户ID，无法执行RAG检索节点")

        # Enforce KB read access (avoid workflow bypassing KB permissions)
        try:
            from app.db.database import SessionLocal
            from app.db.models.knowledge_base import KnowledgeBase as KBModel
            from app.db.models.user import User as UserModel

            db = SessionLocal()
            try:
                kb_row = (
                    db.query(KBModel)
                    .filter(
                        KBModel.name == knowledge_base,
                        KBModel.tenant_id == tenant_id,
                        KBModel.is_active == True,
                    )
                    .first()
                )
                if kb_row is None:
                    raise RuntimeError("知识库不存在或不可用")
                if user_id is not None:
                    u = db.query(UserModel).filter(UserModel.id == int(user_id)).first()
                    if not u:
                        raise RuntimeError("用户不存在")
                    if u.role not in ("super_admin", "tenant_admin"):
                        if kb_row.owner_id != u.id and not bool(getattr(kb_row, "is_public", False)):
                            raise RuntimeError("无权访问该知识库")
            finally:
                db.close()
        except RuntimeError:
            raise
        except Exception:
            # If DB check fails unexpectedly, default to safe behavior when a user context exists.
            if user_id is not None:
                raise RuntimeError("知识库权限校验失败")

        # 生成查询向量
        embedding_response = await llm_service.get_embeddings(
            texts=[query], tenant_id=tenant_id, user_id=user_id
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
        user_id = (
            (context.global_context or {}).get("user_id")
            or (context.input_data or {}).get("user_id")
        )
        if tenant_id is None:
            raise RuntimeError("缺少租户ID，无法执行混合检索")

        # Enforce KB read access (avoid workflow bypassing KB permissions)
        try:
            from app.db.database import SessionLocal
            from app.db.models.knowledge_base import KnowledgeBase as KBModel
            from app.db.models.user import User as UserModel

            db = SessionLocal()
            try:
                kb_row = (
                    db.query(KBModel)
                    .filter(
                        KBModel.name == knowledge_base,
                        KBModel.tenant_id == tenant_id,
                        KBModel.is_active == True,
                    )
                    .first()
                )
                if kb_row is None:
                    raise RuntimeError("知识库不存在或不可用")
                if user_id is not None:
                    u = db.query(UserModel).filter(UserModel.id == int(user_id)).first()
                    if not u:
                        raise RuntimeError("用户不存在")
                    if u.role not in ("super_admin", "tenant_admin"):
                        if kb_row.owner_id != u.id and not bool(getattr(kb_row, "is_public", False)):
                            raise RuntimeError("无权访问该知识库")
            finally:
                db.close()
        except RuntimeError:
            raise
        except Exception:
            if user_id is not None:
                raise RuntimeError("知识库权限校验失败")

        # 生成查询向量
        embedding_response = await llm_service.get_embeddings(
            texts=[query], tenant_id=tenant_id, user_id=user_id
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
                        await milvus_service.async_recreate_collection_with_new_dimension(
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
        user_id = (
            (context.global_context or {}).get("user_id")
            or (context.input_data or {}).get("user_id")
        )
        response = await llm_service.chat(
            message=prompt,
            model=config.get('model', 'qwen-turbo'),
            temperature=0.1,
            max_tokens=50,
            tenant_id=tenant_id,
            user_id=user_id,
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
        
        actual_data = self._normalize_input_payload(input_data)

        # 支持直接传入 value；否则从 field_path 提取
        if 'value' in actual_data and actual_data.get('value') is not None:
            value = actual_data.get('value')
        else:
            value = self._get_nested_value(actual_data, field_path)
        
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
            'condition_value': condition_value,
            # 透传数据，便于分支继续处理
            'data': actual_data,
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
            actual_data = self._normalize_input_payload(input_data)
            timeout_sec = float(config.get("timeout_sec") or config.get("timeout") or 3.0)
            max_mem_mb = int(config.get("max_memory_mb") or 256)
            max_stdout_chars = int(config.get("max_stdout_chars") or 10_000)
            max_input_bytes = int(config.get("max_input_bytes") or 2_000_000)
            max_result_bytes = int(config.get("max_result_bytes") or 2_000_000)

            limits = _SandboxLimits(
                timeout_sec=max(0.1, timeout_sec),
                max_memory_mb=max(16, max_mem_mb),
                max_stdout_chars=max(1000, max_stdout_chars),
                max_input_bytes=max(10_000, max_input_bytes),
                max_result_bytes=max(10_000, max_result_bytes),
            )

            res = await asyncio.to_thread(
                _run_python_sandbox,
                code=str(code or ""),
                input_data=actual_data,
                context_data=context.global_context,
                limits=limits,
            )

            if not res.get("success"):
                raise RuntimeError(f"代码执行失败（sandbox）：{res.get('error') or 'Unknown error'}")

            return {
                "result": res.get("result"),
                "stdout": res.get("stdout", ""),
                "execution_output": "Code executed successfully",
                "sandbox": {
                    "timeout_sec": limits.timeout_sec,
                    "max_memory_mb": limits.max_memory_mb,
                    "max_stdout_chars": limits.max_stdout_chars,
                    "max_input_bytes": limits.max_input_bytes,
                    "max_result_bytes": limits.max_result_bytes,
                },
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

        # 输入节点输出应稳定包含：data / prompt / query / text（便于 edge 映射）
        actual = self._normalize_input_payload(input_data)
        # 若存在 data 包装，则将其视为主要 payload，同时合并外层字段（如 tenant_id/user_id）
        if isinstance(actual.get("data"), dict):
            merged = {**actual["data"], **{k: v for k, v in actual.items() if k != "data"}}
        else:
            merged = dict(actual)

        prompt = merged.get("prompt") or merged.get("text") or merged.get("query") or ""
        query = merged.get("query") or merged.get("prompt") or merged.get("text") or ""
        text = merged.get("text") or merged.get("prompt") or merged.get("query") or ""

        # 避免 None 触发上游“整体回退”的历史行为：用空串/空对象兜底
        if prompt is None:
            prompt = ""
        if query is None:
            query = ""
        if text is None:
            text = ""

        return {
            "data": merged,
            "input": prompt,
            "prompt": prompt,
            "query": query,
            "text": text,
        }
    
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
        actual_data = self._normalize_input_payload(input_data)
        payload = actual_data.get('data', actual_data)
        # When upstream maps a scalar into `data`, expose useful aliases for templates/select_path.
        template_payload: Dict[str, Any]
        if isinstance(payload, dict):
            template_payload = payload
        else:
            template_payload = {
                "data": payload,
                "content": payload,
                "text": payload,
                "result": payload,
                "value": payload,
            }

        # 允许配置 select_path 选择输出字段（template 为空时生效）
        select_path = config.get('select_path') or config.get('select')
        if isinstance(select_path, str) and select_path.strip() and not template:
            path = select_path.strip()
            # roots: data/input/context；同时将 payload 的字段提升一层便于直接写 content/result 等
            roots: Dict[str, Any] = {
                "data": payload,
                "input": context.input_data or {},
                "context": context.global_context or {},
            }
            if isinstance(payload, dict):
                roots.update(payload)
            else:
                roots.update(template_payload)

            selected = self._get_value_by_path(roots, path)
            if selected is None:
                # fallback to default payload
                selected = payload
            return {"result": selected}

        if template:
            # 使用模板格式化输出，避免缺失键报错
            try:
                if isinstance(template, str) and "{{" in template:
                    rendered = self._render_mustache_template(
                        template,
                        data=template_payload,
                        input_data=context.input_data,
                        context_data=context.global_context,
                    )
                    # If template renders empty/whitespace, fall back to raw payload to avoid “no output”.
                    if isinstance(rendered, str) and rendered.strip() == "":
                        return {"result": payload}
                    return {"result": rendered}
                else:
                    class _SafeDict(dict):
                        def __missing__(self, key):
                            return ''
                    formatted_output = template.format_map(_SafeDict(template_payload))
                    if isinstance(formatted_output, str) and formatted_output.strip() == "":
                        return {"result": payload}
                    return {'result': formatted_output}
            except Exception as e:
                logger.warning(f"模板格式化失败: {e}")
                return {'result': payload}
        else:
            # 直接返回输入数据
            return {'result': payload}

    async def _execute_http_request_node(
        self,
        node: WorkflowNode,
        input_data: Dict[str, Any],
        context: WorkflowExecutionContext,
    ) -> Dict[str, Any]:
        """执行 HTTP 请求节点（支持 {{变量}} 模板）。"""
        config = node.config or {}
        actual_data = self._normalize_input_payload(input_data)

        def render_str(v: Any) -> Any:
            if isinstance(v, str):
                return self._render_mustache_template(
                    v,
                    data=actual_data,
                    input_data=context.input_data,
                    context_data=context.global_context,
                )
            return v

        url = str(render_str(config.get("url") or actual_data.get("url") or "")).strip()
        method = str(config.get("method") or "GET").upper()
        timeout = float(config.get("timeout") or 30)

        if not url:
            raise ValueError("HTTP 请求节点缺少 url")
        if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            raise ValueError(f"HTTP method 不支持: {method}")

        headers = config.get("headers") or {}
        params = config.get("params") or {}
        data = config.get("data") if "data" in config else actual_data.get("data", {})

        # 渲染 headers/params 的字符串值
        if isinstance(headers, dict):
            headers = {str(k): render_str(v) for k, v in headers.items()}
        if isinstance(params, dict):
            params = {str(k): render_str(v) for k, v in params.items()}
        if isinstance(data, str):
            data = render_str(data)
        elif isinstance(data, dict):
            data = {str(k): render_str(v) for k, v in data.items()}

        req_kwargs: Dict[str, Any] = {
            "headers": headers if isinstance(headers, dict) else {},
            "params": params if isinstance(params, dict) else {},
        }
        if method in ("POST", "PUT", "PATCH"):
            if isinstance(data, dict):
                req_kwargs["json"] = data
            else:
                req_kwargs["content"] = str(data)

        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.request(method, url, **req_kwargs)
        except Exception as e:
            return {
                "status_code": 0,
                "response_data": None,
                "headers": {},
                "success": False,
                "url": url,
                "method": method,
                "error": str(e),
            }

        try:
            response_data = resp.json()
        except Exception:
            response_data = resp.text

        return {
            "status_code": resp.status_code,
            "response_data": response_data,
            "headers": dict(resp.headers),
            "success": resp.status_code < 400,
            "url": url,
            "method": method,
        }
    
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
        actual_data = self._normalize_input_payload(input_data)
        text = (
            actual_data.get('text')
            or actual_data.get('prompt')
            or actual_data.get('query')
            or ''
        )
        # Treat empty/absent model as "use active per-tenant embedding model"
        model = config.get('model') or None

        tenant_id = (
            (context.global_context or {}).get('tenant_id')
            or (context.input_data or {}).get('tenant_id')
        )
        user_id = (
            (context.global_context or {}).get("user_id")
            or (context.input_data or {}).get("user_id")
        )

        # 生成嵌入
        response = await llm_service.get_embeddings(
            texts=[text], model=model, tenant_id=tenant_id, user_id=user_id
        )
        
        if response.get('success'):
            return {
                'embedding': response['embeddings'][0],
                'dimensions': len(response['embeddings'][0]),
                'model': model or 'active',
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
        actual_data = self._normalize_input_payload(input_data)
        query = actual_data.get('query') or actual_data.get('prompt') or ''
        documents = actual_data.get('documents', []) or []
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

    def _normalize_input_payload(self, input_data: Any) -> Dict[str, Any]:
        """Normalize input payload to a dict; unwrap/merge common 'data' wrapper."""
        if input_data is None:
            return {}
        if isinstance(input_data, dict):
            actual = input_data
            # 如果数据被多层包装，逐层解包
            while 'data' in actual and isinstance(actual['data'], dict) and len(actual) == 1:
                actual = actual['data']
            # 如果还有data键但不是唯一键，则优先使用data内的数据，但保持其他键
            if 'data' in actual and isinstance(actual['data'], dict):
                merged = {**actual}
                merged.update(actual['data'])
                actual = merged
            return actual
        # 非 dict 统一包一层，便于 downstream 取值
        return {'value': input_data, 'data': input_data}
    
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

    def _get_value_by_path(self, root: Any, path: str) -> Any:
        """Get nested value from dict/list via dotted path, supporting [index] syntax."""
        if root is None:
            return None
        if not path:
            return root
        if not isinstance(path, str):
            return None
        normalized = re.sub(r"\[(\d+)\]", r".\1", path.strip())
        parts = [p for p in normalized.split(".") if p]
        current: Any = root
        for part in parts:
            if isinstance(current, dict):
                if part in current:
                    current = current[part]
                else:
                    return None
            elif isinstance(current, list):
                try:
                    idx = int(part)
                except Exception:
                    return None
                if idx < 0 or idx >= len(current):
                    return None
                current = current[idx]
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
