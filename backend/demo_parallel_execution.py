"""
工作流并行执行演示
展示串行执行与并行执行的性能差异
"""

import asyncio
import time
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
from app.services.workflow_parallel_executor import workflow_parallel_executor


def create_complex_workflow() -> WorkflowDefinition:
    """创建复杂的工作流用于演示"""
    
    # 定义节点
    nodes = [
        # 输入节点
        WorkflowNode(
            id="input_1",
            type="input",
            name="数据输入",
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
        
        # 并行处理分支A
        WorkflowNode(
            id="rag_a",
            type="rag_retriever",
            name="知识检索A",
            description="从知识库A检索相关信息",
            function_signature=NodeFunctionSignature(
                name="rag_retrieve",
                description="知识检索",
                category="data",
                inputs=[
                    NodeInputSchema(
                        name="query",
                        type=DataType.STRING,
                        description="查询文本",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="documents",
                        type=DataType.ARRAY,
                        description="检索到的文档",
                        required=True
                    )
                ]
            ),
            config={
                "knowledge_base": "knowledge_a",
                "top_k": 5,
                "cpu_intensive": False,
                "memory_intensive": False
            },
            position={"x": 300, "y": 50}
        ),
        
        # 并行处理分支B
        WorkflowNode(
            id="rag_b",
            type="rag_retriever",
            name="知识检索B",
            description="从知识库B检索相关信息",
            function_signature=NodeFunctionSignature(
                name="rag_retrieve",
                description="知识检索",
                category="data",
                inputs=[
                    NodeInputSchema(
                        name="query",
                        type=DataType.STRING,
                        description="查询文本",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="documents",
                        type=DataType.ARRAY,
                        description="检索到的文档",
                        required=True
                    )
                ]
            ),
            config={
                "knowledge_base": "knowledge_b",
                "top_k": 5,
                "cpu_intensive": False,
                "memory_intensive": False
            },
            position={"x": 300, "y": 150}
        ),
        
        # 并行处理分支C
        WorkflowNode(
            id="classifier_1",
            type="classifier",
            name="文本分类器",
            description="对输入文本进行分类",
            function_signature=NodeFunctionSignature(
                name="classify_text",
                description="文本分类",
                category="ai",
                inputs=[
                    NodeInputSchema(
                        name="text",
                        type=DataType.STRING,
                        description="待分类文本",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="class",
                        type=DataType.STRING,
                        description="分类结果",
                        required=True
                    )
                ]
            ),
            config={
                "classes": ["技术", "业务", "管理"],
                "model": "qwen-turbo"
            },
            position={"x": 300, "y": 250}
        ),
        
        # 数据合并节点
        WorkflowNode(
            id="merger_1",
            type="data_transformer",
            name="数据合并",
            description="合并多个数据源的结果",
            function_signature=NodeFunctionSignature(
                name="merge_data",
                description="数据合并",
                category="processing",
                inputs=[
                    NodeInputSchema(
                        name="data_a",
                        type=DataType.ARRAY,
                        description="数据源A",
                        required=True
                    ),
                    NodeInputSchema(
                        name="data_b",
                        type=DataType.ARRAY,
                        description="数据源B",
                        required=True
                    ),
                    NodeInputSchema(
                        name="class_info",
                        type=DataType.STRING,
                        description="分类信息",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="merged_data",
                        type=DataType.OBJECT,
                        description="合并后的数据",
                        required=True
                    )
                ]
            ),
            config={
                "merge_strategy": "weighted_average"
            },
            position={"x": 600, "y": 150}
        ),
        
        # LLM处理节点
        WorkflowNode(
            id="llm_1",
            type="llm",
            name="智能生成",
            description="基于检索结果生成回复",
            function_signature=NodeFunctionSignature(
                name="llm_generate",
                description="智能生成",
                category="llm",
                inputs=[
                    NodeInputSchema(
                        name="context",
                        type=DataType.OBJECT,
                        description="上下文数据",
                        required=True
                    )
                ],
                outputs=[
                    NodeOutputSchema(
                        name="content",
                        type=DataType.STRING,
                        description="生成的内容",
                        required=True
                    )
                ]
            ),
            config={
                "model": "qwen-turbo",
                "temperature": 0.7,
                "max_tokens": 1000,
                "cpu_intensive": True,
                "memory_intensive": True
            },
            position={"x": 900, "y": 150}
        ),
        
        # 输出节点
        WorkflowNode(
            id="output_1",
            type="output",
            name="结果输出",
            description="输出最终结果",
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
            position={"x": 1200, "y": 150}
        )
    ]
    
    # 定义边
    edges = [
        # 从输入到三个并行分支
        WorkflowEdge(
            id="edge_1",
            source="input_1",
            target="rag_a",
            source_output="data",
            target_input="query",
            transform="value.get('query', 'default query')"
        ),
        WorkflowEdge(
            id="edge_2",
            source="input_1",
            target="rag_b",
            source_output="data",
            target_input="query",
            transform="value.get('query', 'default query')"
        ),
        WorkflowEdge(
            id="edge_3",
            source="input_1",
            target="classifier_1",
            source_output="data",
            target_input="text",
            transform="value.get('text', 'default text')"
        ),
        
        # 从三个分支到合并节点
        WorkflowEdge(
            id="edge_4",
            source="rag_a",
            target="merger_1",
            source_output="documents",
            target_input="data_a"
        ),
        WorkflowEdge(
            id="edge_5",
            source="rag_b",
            target="merger_1",
            source_output="documents",
            target_input="data_b"
        ),
        WorkflowEdge(
            id="edge_6",
            source="classifier_1",
            target="merger_1",
            source_output="class",
            target_input="class_info"
        ),
        
        # 从合并到LLM
        WorkflowEdge(
            id="edge_7",
            source="merger_1",
            target="llm_1",
            source_output="merged_data",
            target_input="context"
        ),
        
        # 从LLM到输出
        WorkflowEdge(
            id="edge_8",
            source="llm_1",
            target="output_1",
            source_output="content",
            target_input="data"
        )
    ]
    
    # 创建工作流定义
    workflow_definition = WorkflowDefinition(
        id="parallel_demo_workflow",
        name="并行执行演示工作流",
        description="展示串行执行与并行执行的性能差异",
        version="1.0.0",
        nodes=nodes,
        edges=edges,
        global_config={
            "timeout": 60,
            "enable_parallel_execution": True,
            "max_parallel_workers": 5
        }
    )
    
    return workflow_definition


async def benchmark_execution_modes():
    """对比串行与并行执行性能"""
    
    print("🚀 工作流并行执行性能对比")
    print("=" * 60)
    
    # 创建工作流
    workflow_def = create_complex_workflow()
    
    # 准备输入数据
    input_data = {
        "query": "如何提高系统性能？",
        "text": "我们需要优化系统架构以提高性能和稳定性",
        "user_id": "demo_user"
    }
    
    # 测试1: 串行执行
    print("\n📊 测试1: 串行执行")
    print("-" * 40)
    
    serial_start = time.time()
    
    try:
        serial_context = await workflow_execution_engine.execute_workflow(
            workflow_definition=workflow_def,
            input_data=input_data,
            debug=True,
            enable_parallel=False
        )
        
        serial_duration = time.time() - serial_start
        
        print(f"✅ 串行执行完成")
        print(f"⏱️  总执行时间: {serial_duration:.2f}秒")
        print(f"📊 状态: {serial_context.status}")
        print(f"🔄 步骤数量: {len(serial_context.steps)}")
        
        # 显示步骤详情
        print(f"\n📝 步骤详情:")
        for i, step in enumerate(serial_context.steps, 1):
            print(f"{i}. {step.node_name}: {step.duration:.3f}秒 ({step.status})")
        
    except Exception as e:
        print(f"❌ 串行执行失败: {str(e)}")
        serial_duration = time.time() - serial_start
        serial_context = None
    
    # 测试2: 并行执行
    print(f"\n📊 测试2: 并行执行")
    print("-" * 40)
    
    parallel_start = time.time()
    
    try:
        parallel_context = await workflow_execution_engine.execute_workflow(
            workflow_definition=workflow_def,
            input_data=input_data,
            debug=True,
            enable_parallel=True
        )
        
        parallel_duration = time.time() - parallel_start
        
        print(f"✅ 并行执行完成")
        print(f"⏱️  总执行时间: {parallel_duration:.2f}秒")
        print(f"📊 状态: {parallel_context.status}")
        print(f"🔄 步骤数量: {len(parallel_context.steps)}")
        
        # 显示步骤详情
        print(f"\n📝 步骤详情:")
        for i, step in enumerate(parallel_context.steps, 1):
            print(f"{i}. {step.node_name}: {step.duration:.3f}秒 ({step.status})")
        
    except Exception as e:
        print(f"❌ 并行执行失败: {str(e)}")
        parallel_duration = time.time() - parallel_start
        parallel_context = None
    
    # 性能对比
    print(f"\n🏆 性能对比结果")
    print("=" * 60)
    
    if serial_context and parallel_context:
        speedup = serial_duration / parallel_duration
        improvement = (serial_duration - parallel_duration) / serial_duration * 100
        
        print(f"串行执行时间: {serial_duration:.2f}秒")
        print(f"并行执行时间: {parallel_duration:.2f}秒")
        print(f"性能提升: {speedup:.2f}倍")
        print(f"时间节省: {improvement:.1f}%")
        
        if speedup > 1.5:
            print("🎉 并行执行显著提升了性能！")
        elif speedup > 1.1:
            print("✅ 并行执行有一定的性能提升")
        else:
            print("⚠️  并行执行性能提升不明显")
    
    return serial_context, parallel_context


async def demonstrate_resource_management():
    """演示资源管理功能"""
    
    print("\n🔧 资源管理演示")
    print("=" * 60)
    
    # 配置资源池
    workflow_execution_engine.configure_parallel_execution(
        enable=True,
        max_workers=5,
        total_cpu=4.0,
        total_memory=4096,
        total_network=500
    )
    
    # 获取资源利用率
    stats = workflow_execution_engine.get_parallel_statistics()
    
    print("📊 资源配置:")
    if stats.get("parallel_execution_enabled"):
        resource_util = stats.get("resource_utilization", {})
        print(f"   CPU利用率: {resource_util.get('cpu', 0)*100:.1f}%")
        print(f"   内存利用率: {resource_util.get('memory', 0)*100:.1f}%")
        print(f"   网络利用率: {resource_util.get('network', 0)*100:.1f}%")
    else:
        print("   并行执行未启用")
    
    # 显示节点性能统计
    if "node_performance" in stats:
        print(f"\n📈 节点性能统计:")
        for node_id, perf in stats["node_performance"].items():
            print(f"   {node_id}:")
            print(f"     平均执行时间: {perf.get('avg_duration', 0):.3f}秒")
            print(f"     执行次数: {perf.get('execution_count', 0)}")
            print(f"     最快时间: {perf.get('min_duration', 0):.3f}秒")
            print(f"     最慢时间: {perf.get('max_duration', 0):.3f}秒")


async def demonstrate_optimization_analysis():
    """演示优化分析功能"""
    
    print("\n🔍 工作流优化分析")
    print("=" * 60)
    
    workflow_def = create_complex_workflow()
    
    # 模拟优化分析（简化版）
    print("📊 并行化潜力分析:")
    print(f"   节点总数: {len(workflow_def.nodes)}")
    print(f"   边数量: {len(workflow_def.edges)}")
    
    # 分析依赖关系
    dependencies = {}
    for node in workflow_def.nodes:
        dependencies[node.id] = []
    
    for edge in workflow_def.edges:
        dependencies[edge.target].append(edge.source)
    
    # 计算可并行执行的节点
    parallel_groups = []
    processed = set()
    
    def find_parallel_nodes(current_nodes):
        if not current_nodes:
            return []
        
        # 找到没有依赖或依赖已处理的节点
        ready_nodes = []
        for node_id in current_nodes:
            if all(dep in processed for dep in dependencies[node_id]):
                ready_nodes.append(node_id)
        
        return ready_nodes
    
    remaining_nodes = set(node.id for node in workflow_def.nodes)
    
    level = 1
    while remaining_nodes:
        ready_nodes = find_parallel_nodes(remaining_nodes)
        if not ready_nodes:
            break
        
        print(f"   第{level}层并行节点: {len(ready_nodes)}个")
        for node_id in ready_nodes:
            processed.add(node_id)
            remaining_nodes.remove(node_id)
        
        parallel_groups.append(ready_nodes)
        level += 1
    
    max_parallel = max(len(group) for group in parallel_groups) if parallel_groups else 0
    print(f"   最大并行度: {max_parallel}")
    
    # 生成优化建议
    print(f"\n💡 优化建议:")
    if max_parallel > 1:
        print("   ✅ 工作流具有良好的并行化潜力")
        print("   📈 建议启用并行执行模式")
    else:
        print("   ⚠️  工作流主要为串行结构")
        print("   🔄 考虑重构以增加并行度")
    
    if len(workflow_def.nodes) > 5:
        print("   🎯 建议配置足够的工作线程")
        print("   💾 考虑启用结果缓存")


async def main():
    """主演示函数"""
    
    print("🎯 工作流并行执行完整演示")
    print("=" * 60)
    
    # 1. 执行性能对比
    serial_context, parallel_context = await benchmark_execution_modes()
    
    # 2. 资源管理演示
    await demonstrate_resource_management()
    
    # 3. 优化分析演示
    await demonstrate_optimization_analysis()
    
    print(f"\n🎉 演示完成!")
    print("=" * 60)
    
    # 清理资源
    workflow_execution_engine.reset_parallel_cache()


if __name__ == "__main__":
    asyncio.run(main())