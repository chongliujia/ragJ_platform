"""
工作流错误处理和恢复演示
展示如何使用增强的错误处理功能
"""

import asyncio
import json
from datetime import datetime
from typing import Dict, Any

from app.schemas.workflow import (
    WorkflowDefinition,
    WorkflowNode,
    WorkflowEdge,
    NodeFunctionSignature,
    NodeInputSchema,
    NodeOutputSchema,
    DataType
)
from app.services.workflow_execution_engine import workflow_execution_engine
from app.services.workflow_error_handler import (
    workflow_error_handler,
    RecoveryStrategy,
    RetryConfig,
    RecoveryAction,
    RetryStrategy,
    ErrorType
)


def create_demo_workflow() -> WorkflowDefinition:
    """创建演示工作流"""
    
    # 定义节点
    nodes = [
        WorkflowNode(
            id="input_1",
            type="input",
            name="输入节点",
            description="接收输入数据",
            function_signature=NodeFunctionSignature(
                name="input_data",
                description="输入数据",
                category="io",
                inputs=[],
                outputs=[
                    NodeOutputSchema(
                        name="data",
                        type=DataType.OBJECT,
                        description="输入数据",
                        required=True
                    )
                ]
            ),
            position={"x": 100, "y": 100}
        ),
        WorkflowNode(
            id="network_node",
            type="network_request",
            name="网络请求节点",
            description="模拟网络请求（可能失败）",
            function_signature=NodeFunctionSignature(
                name="network_request",
                description="网络请求",
                category="network",
                inputs=[
                    NodeInputSchema(
                        name="url",
                        type=DataType.STRING,
                        description="请求URL",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="response",
                        type=DataType.OBJECT,
                        description="响应数据",
                        required=True
                    )
                ]
            ),
            config={
                "url": "https://api.example.com/data",
                "timeout": 5,
                "retry_on_failure": True
            },
            position={"x": 400, "y": 100}
        ),
        WorkflowNode(
            id="process_node",
            type="data_processor",
            name="数据处理节点",
            description="处理数据（可能出现格式错误）",
            function_signature=NodeFunctionSignature(
                name="process_data",
                description="数据处理",
                category="processing",
                inputs=[
                    NodeInputSchema(
                        name="data",
                        type=DataType.OBJECT,
                        description="待处理数据",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="processed_data",
                        type=DataType.OBJECT,
                        description="处理后数据",
                        required=True
                    )
                ]
            ),
            config={
                "processing_type": "json_parse",
                "ignore_errors": False
            },
            position={"x": 700, "y": 100}
        ),
        WorkflowNode(
            id="output_1",
            type="output",
            name="输出节点",
            description="输出结果",
            function_signature=NodeFunctionSignature(
                name="output_data",
                description="输出数据",
                category="io",
                inputs=[
                    NodeInputSchema(
                        name="data",
                        type=DataType.OBJECT,
                        description="输出数据",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="result",
                        type=DataType.OBJECT,
                        description="最终结果",
                        required=True
                    )
                ]
            ),
            position={"x": 1000, "y": 100}
        )
    ]
    
    # 定义边
    edges = [
        WorkflowEdge(
            id="edge_1",
            source="input_1",
            target="network_node",
            source_output="data",
            target_input="url",
            transform="value.get('url', 'https://api.example.com/data')"
        ),
        WorkflowEdge(
            id="edge_2",
            source="network_node",
            target="process_node",
            source_output="response",
            target_input="data"
        ),
        WorkflowEdge(
            id="edge_3",
            source="process_node",
            target="output_1",
            source_output="processed_data",
            target_input="data"
        )
    ]
    
    # 创建工作流定义
    workflow_definition = WorkflowDefinition(
        id="error_handling_demo",
        name="错误处理演示工作流",
        description="演示工作流错误处理和恢复功能",
        version="1.0.0",
        nodes=nodes,
        edges=edges,
        global_config={
            "timeout": 30,
            "enable_error_recovery": True,
            "enable_metrics": True
        }
    )
    
    return workflow_definition


def configure_error_strategies():
    """配置错误处理策略"""
    
    # 网络节点使用指数退避重试
    network_strategy = RecoveryStrategy(
        action=RecoveryAction.RETRY,
        retry_config=RetryConfig(
            strategy=RetryStrategy.EXPONENTIAL_BACKOFF,
            max_retries=3,
            initial_delay=1.0,
            max_delay=10.0,
            backoff_multiplier=2.0,
            jitter=True
        ),
        fallback_value={"response": {"error": "network_fallback", "data": None}},
        circuit_breaker_threshold=5,
        circuit_breaker_timeout=60.0
    )
    
    # 数据处理节点使用默认值恢复
    process_strategy = RecoveryStrategy(
        action=RecoveryAction.USE_DEFAULT_VALUE,
        fallback_value={"processed_data": {"error": "data_format_error", "data": {}}},
        timeout_seconds=10.0
    )
    
    # 设置节点特定策略
    workflow_error_handler.set_node_strategy("network_node", network_strategy)
    workflow_error_handler.set_node_strategy("process_node", process_strategy)
    
    print("✅ 错误处理策略配置完成")


async def simulate_network_error():
    """模拟网络错误场景"""
    
    print("\n🔥 场景1: 网络请求失败")
    print("=" * 50)
    
    # 配置错误策略
    configure_error_strategies()
    
    # 创建工作流
    workflow_def = create_demo_workflow()
    
    # 执行工作流（模拟网络失败）
    input_data = {
        "url": "https://nonexistent-api.com/data",  # 不存在的URL
        "test_scenario": "network_failure"
    }
    
    try:
        execution_context = await workflow_execution_engine.execute_workflow(
            workflow_definition=workflow_def,
            input_data=input_data,
            debug=True
        )
        
        print(f"📊 执行结果: {execution_context.status}")
        print(f"⏱️  执行时间: {execution_context.end_time - execution_context.start_time:.2f}秒")
        
        # 显示步骤详情
        print(f"\n📝 步骤详情:")
        for i, step in enumerate(execution_context.steps, 1):
            status_icon = "✅" if step.status == "completed" else "🔄" if step.status == "recovered" else "❌"
            print(f"{i}. {status_icon} {step.node_name} ({step.status})")
            if step.error:
                print(f"   ❌ 错误: {step.error}")
            if step.duration:
                print(f"   ⏱️  耗时: {step.duration:.3f}秒")
        
        # 显示错误统计
        error_stats = workflow_error_handler.get_error_statistics()
        print(f"\n📊 错误统计:")
        print(f"   总错误数: {error_stats['total_errors']}")
        print(f"   错误类型: {error_stats['error_types']}")
        
        return execution_context
        
    except Exception as e:
        print(f"❌ 工作流执行失败: {str(e)}")
        return None


async def simulate_data_format_error():
    """模拟数据格式错误场景"""
    
    print("\n🔥 场景2: 数据格式错误")
    print("=" * 50)
    
    # 重置错误处理器
    workflow_error_handler.clear_retry_counts()
    
    # 创建工作流
    workflow_def = create_demo_workflow()
    
    # 执行工作流（模拟数据格式错误）
    input_data = {
        "url": "https://api.example.com/invalid-data",
        "test_scenario": "data_format_error"
    }
    
    try:
        execution_context = await workflow_execution_engine.execute_workflow(
            workflow_definition=workflow_def,
            input_data=input_data,
            debug=True
        )
        
        print(f"📊 执行结果: {execution_context.status}")
        print(f"⏱️  执行时间: {execution_context.end_time - execution_context.start_time:.2f}秒")
        
        # 显示恢复的步骤
        recovered_steps = [step for step in execution_context.steps if step.status == "recovered"]
        if recovered_steps:
            print(f"\n🔄 恢复的步骤:")
            for step in recovered_steps:
                print(f"   • {step.node_name}: {step.error}")
        
        return execution_context
        
    except Exception as e:
        print(f"❌ 工作流执行失败: {str(e)}")
        return None


async def simulate_circuit_breaker():
    """模拟断路器场景"""
    
    print("\n🔥 场景3: 断路器触发")
    print("=" * 50)
    
    # 配置断路器策略
    circuit_breaker_strategy = RecoveryStrategy(
        action=RecoveryAction.CIRCUIT_BREAK,
        retry_config=RetryConfig(
            strategy=RetryStrategy.EXPONENTIAL_BACKOFF,
            max_retries=2,
            initial_delay=1.0
        ),
        circuit_breaker_threshold=3,
        circuit_breaker_timeout=30.0,
        fallback_value={"response": {"error": "circuit_breaker_open", "data": None}}
    )
    
    workflow_error_handler.set_node_strategy("network_node", circuit_breaker_strategy)
    
    # 创建工作流
    workflow_def = create_demo_workflow()
    
    # 多次执行以触发断路器
    for i in range(5):
        print(f"\n🔄 第{i+1}次执行:")
        
        input_data = {
            "url": "https://failing-api.com/data",
            "test_scenario": "circuit_breaker_test"
        }
        
        try:
            execution_context = await workflow_execution_engine.execute_workflow(
                workflow_definition=workflow_def,
                input_data=input_data,
                debug=False
            )
            
            print(f"   状态: {execution_context.status}")
            
            # 检查是否有断路器打开的步骤
            circuit_break_steps = [
                step for step in execution_context.steps 
                if step.error and "circuit_breaker" in step.error.lower()
            ]
            
            if circuit_break_steps:
                print(f"   ⚡ 断路器已打开")
                break
                
        except Exception as e:
            print(f"   ❌ 执行失败: {str(e)}")
        
        # 短暂延迟
        await asyncio.sleep(0.5)


async def demonstrate_performance_metrics():
    """演示性能指标"""
    
    print("\n📊 性能指标演示")
    print("=" * 50)
    
    # 获取执行指标
    execution_metrics = workflow_execution_engine.get_execution_metrics()
    
    if execution_metrics:
        print("节点执行指标:")
        for node_id, metrics in execution_metrics.items():
            print(f"  {node_id}:")
            print(f"    总执行次数: {metrics['total_executions']}")
            print(f"    成功次数: {metrics['successful_executions']}")
            print(f"    失败次数: {metrics['failed_executions']}")
            print(f"    成功率: {metrics['success_rate']:.2%}")
            print(f"    平均耗时: {metrics['avg_duration']:.3f}秒")
    else:
        print("暂无执行指标")
    
    # 获取错误统计
    error_stats = workflow_error_handler.get_error_statistics()
    print(f"\n错误统计:")
    print(f"  总错误数: {error_stats['total_errors']}")
    print(f"  错误类型分布: {error_stats['error_types']}")
    print(f"  失败节点TOP3: {error_stats['top_failing_nodes'][:3]}")


async def main():
    """主演示函数"""
    
    print("🎯 工作流错误处理和恢复演示")
    print("=" * 60)
    
    # 场景1: 网络请求失败
    await simulate_network_error()
    
    # 场景2: 数据格式错误
    await simulate_data_format_error()
    
    # 场景3: 断路器触发
    await simulate_circuit_breaker()
    
    # 性能指标
    await demonstrate_performance_metrics()
    
    print("\n🎉 演示完成!")
    print("=" * 60)
    
    # 清理资源
    workflow_error_handler.clear_retry_counts()
    workflow_error_handler.reset_circuit_breakers()


if __name__ == "__main__":
    asyncio.run(main())