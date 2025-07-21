"""
完整的工作流系统使用示例
展示如何创建、执行和管理工作流
"""

import asyncio
import json
from datetime import datetime

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
from app.services.workflow_state_manager import workflow_state_manager


# 定义节点函数签名
llm_signature = NodeFunctionSignature(
    name="llm_chat_completion",
    description="调用大语言模型进行文本生成",
    category="llm",
    inputs=[
        NodeInputSchema(
            name="prompt",
            type=DataType.STRING,
            description="用户输入的提示文本",
            required=True
        ),
        NodeInputSchema(
            name="system_prompt",
            type=DataType.STRING,
            description="系统提示词",
            required=False,
            default="你是一个有用的AI助手"
        )
    ],
    outputs=[
        NodeOutputSchema(
            name="content",
            type=DataType.STRING,
            description="生成的文本内容",
            required=True
        ),
        NodeOutputSchema(
            name="metadata",
            type=DataType.OBJECT,
            description="包含token使用等元数据",
            required=True
        )
    ]
)

rag_signature = NodeFunctionSignature(
    name="rag_retrieve",
    description="从知识库检索相关文档",
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
            description="检索到的文档列表",
            required=True
        ),
        NodeOutputSchema(
            name="total_results",
            type=DataType.NUMBER,
            description="总结果数量",
            required=True
        )
    ]
)

classifier_signature = NodeFunctionSignature(
    name="classify_text",
    description="对文本进行分类",
    category="ai",
    inputs=[
        NodeInputSchema(
            name="text",
            type=DataType.STRING,
            description="待分类的文本",
            required=True
        )
    ],
    outputs=[
        NodeOutputSchema(
            name="class",
            type=DataType.STRING,
            description="分类结果",
            required=True
        ),
        NodeOutputSchema(
            name="confidence",
            type=DataType.NUMBER,
            description="置信度分数",
            required=True
        )
    ]
)

input_signature = NodeFunctionSignature(
    name="input_data",
    description="工作流输入节点",
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
)

output_signature = NodeFunctionSignature(
    name="output_data",
    description="工作流输出节点",
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
            description="格式化结果",
            required=True
        )
    ]
)


async def create_sample_workflow():
    """创建示例工作流：智能客服系统"""
    
    # 定义节点
    nodes = [
        WorkflowNode(
            id="input_1",
            type="input",
            name="用户输入",
            description="接收用户查询",
            function_signature=input_signature,
            position={"x": 100, "y": 100}
        ),
        WorkflowNode(
            id="classifier_1",
            type="classifier",
            name="意图识别",
            description="识别用户查询的意图",
            function_signature=classifier_signature,
            config={
                "model": "qwen-turbo",
                "classes": ["问题咨询", "投诉建议", "产品介绍", "技术支持"]
            },
            position={"x": 400, "y": 100}
        ),
        WorkflowNode(
            id="rag_1",
            type="rag_retriever",
            name="知识检索",
            description="从知识库检索相关信息",
            function_signature=rag_signature,
            config={
                "knowledge_base": "customer_service",
                "top_k": 5,
                "score_threshold": 0.7
            },
            position={"x": 700, "y": 100}
        ),
        WorkflowNode(
            id="llm_1",
            type="llm",
            name="回复生成",
            description="生成智能回复",
            function_signature=llm_signature,
            config={
                "model": "qwen-turbo",
                "temperature": 0.7,
                "max_tokens": 1000,
                "system_prompt": "你是一个专业的客服助手，请根据检索到的信息为用户提供准确、友好的回复。"
            },
            position={"x": 1000, "y": 100}
        ),
        WorkflowNode(
            id="output_1",
            type="output",
            name="结果输出",
            description="输出最终结果",
            function_signature=output_signature,
            position={"x": 1300, "y": 100}
        )
    ]
    
    # 定义边
    edges = [
        WorkflowEdge(
            id="edge_1",
            source="input_1",
            target="classifier_1",
            source_output="data",
            target_input="text"
        ),
        WorkflowEdge(
            id="edge_2",
            source="classifier_1",
            target="rag_1",
            source_output="class",
            target_input="query",
            transform="f'用户意图: {value}'"
        ),
        WorkflowEdge(
            id="edge_3",
            source="rag_1",
            target="llm_1",
            source_output="documents",
            target_input="prompt",
            transform="f'基于以下信息回答用户问题:\\n{json.dumps(value, ensure_ascii=False)}'"
        ),
        WorkflowEdge(
            id="edge_4",
            source="llm_1",
            target="output_1",
            source_output="content",
            target_input="data"
        )
    ]
    
    # 创建工作流定义
    workflow_definition = WorkflowDefinition(
        id="customer_service_workflow",
        name="智能客服助手",
        description="基于RAG的智能客服工作流，包含意图识别、知识检索和回复生成",
        version="1.0.0",
        nodes=nodes,
        edges=edges,
        global_config={
            "timeout": 300,
            "retry_count": 3,
            "enable_checkpoints": True
        }
    )
    
    return workflow_definition


async def execute_workflow_example():
    """执行工作流示例"""
    
    print("🚀 开始工作流执行示例")
    print("=" * 60)
    
    # 1. 创建工作流
    print("1. 创建示例工作流...")
    workflow_def = await create_sample_workflow()
    print(f"   ✅ 工作流创建完成: {workflow_def.name}")
    print(f"   📊 节点数量: {len(workflow_def.nodes)}")
    print(f"   🔗 连接数量: {len(workflow_def.edges)}")
    
    # 2. 准备输入数据
    input_data = {
        "message": "我的产品有问题，需要技术支持",
        "user_id": "user123",
        "timestamp": datetime.now().isoformat()
    }
    
    print(f"\n2. 准备输入数据...")
    print(f"   📝 用户消息: {input_data['message']}")
    
    # 3. 初始化状态管理器
    print("\n3. 初始化状态管理器...")
    await workflow_state_manager.initialize()
    print("   ✅ 状态管理器初始化完成")
    
    # 4. 执行工作流
    print("\n4. 执行工作流...")
    try:
        execution_context = await workflow_execution_engine.execute_workflow(
            workflow_definition=workflow_def,
            input_data=input_data,
            debug=True
        )
        
        # 5. 保存执行状态
        await workflow_state_manager.save_execution_state(
            execution_context,
            create_checkpoint=True
        )
        
        # 6. 显示结果
        print("\n" + "=" * 60)
        print("🎉 工作流执行完成！")
        print("=" * 60)
        
        print(f"📋 执行ID: {execution_context.execution_id}")
        print(f"📊 状态: {execution_context.status}")
        print(f"⏱️  执行时间: {execution_context.end_time - execution_context.start_time:.2f}秒")
        print(f"🔄 步骤数量: {len(execution_context.steps)}")
        
        if execution_context.status == "completed":
            print(f"✅ 执行成功")
            print(f"📤 输出数据: {json.dumps(execution_context.output_data, ensure_ascii=False, indent=2)}")
        else:
            print(f"❌ 执行失败: {execution_context.error}")
        
        # 7. 显示步骤详情
        print(f"\n📝 执行步骤详情:")
        print("-" * 40)
        
        for i, step in enumerate(execution_context.steps, 1):
            status_icon = "✅" if step.status == "completed" else "❌" if step.status == "error" else "⏳"
            print(f"{i}. {status_icon} {step.node_name} ({step.status})")
            
            if step.duration:
                print(f"   ⏱️  持续时间: {step.duration:.3f}秒")
            
            if step.error:
                print(f"   ❌ 错误: {step.error}")
            
            if step.output_data:
                print(f"   📤 输出: {json.dumps(step.output_data, ensure_ascii=False)[:100]}...")
        
        # 8. 显示检查点信息
        if execution_context.checkpoints:
            print(f"\n🔄 检查点信息:")
            print("-" * 40)
            for checkpoint in execution_context.checkpoints:
                print(f"   📍 检查点 {checkpoint['checkpoint_id']}: {checkpoint['step_count']} 步骤")
        
        # 9. 获取执行指标
        print(f"\n📊 工作流指标:")
        print("-" * 40)
        metrics = await workflow_state_manager.get_execution_metrics(workflow_def.id)
        
        print(f"   📈 总执行次数: {metrics.get('total_executions', 0)}")
        print(f"   ✅ 成功次数: {metrics.get('successful_executions', 0)}")
        print(f"   ❌ 失败次数: {metrics.get('failed_executions', 0)}")
        print(f"   📊 成功率: {metrics.get('success_rate', 0):.2%}")
        print(f"   ⏱️  平均执行时间: {metrics.get('avg_duration', 0):.2f}秒")
        
        return execution_context
        
    except Exception as e:
        print(f"❌ 工作流执行失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return None
    
    finally:
        # 清理资源
        await workflow_state_manager.close()


async def test_workflow_resume():
    """测试工作流恢复功能"""
    
    print("\n🔄 测试工作流恢复功能")
    print("=" * 60)
    
    # 初始化状态管理器
    await workflow_state_manager.initialize()
    
    # 假设有一个执行ID需要恢复
    execution_id = "exec_12345678"
    
    # 尝试加载执行状态
    execution_context = await workflow_state_manager.load_execution_state(execution_id)
    
    if execution_context:
        print(f"✅ 成功加载执行状态: {execution_id}")
        print(f"📊 状态: {execution_context.status}")
        print(f"🔄 步骤数量: {len(execution_context.steps)}")
        
        # 尝试从检查点恢复
        if execution_context.checkpoints:
            latest_checkpoint = len(execution_context.checkpoints) - 1
            resumed_context = await workflow_state_manager.resume_from_checkpoint(
                execution_id,
                latest_checkpoint
            )
            
            if resumed_context:
                print(f"✅ 成功从检查点 {latest_checkpoint} 恢复")
                print(f"📊 恢复后状态: {resumed_context.status}")
            else:
                print(f"❌ 从检查点恢复失败")
        else:
            print("ℹ️  没有可用的检查点")
    else:
        print(f"❌ 执行状态不存在: {execution_id}")
    
    await workflow_state_manager.close()


async def main():
    """主函数"""
    print("🎯 工作流系统完整示例")
    print("=" * 60)
    
    # 执行工作流示例
    execution_context = await execute_workflow_example()
    
    if execution_context:
        print(f"\n✅ 示例执行完成!")
        print(f"📋 执行ID: {execution_context.execution_id}")
        
        # 测试工作流恢复（可选）
        # await test_workflow_resume()
    else:
        print(f"\n❌ 示例执行失败!")
    
    print(f"\n🎉 演示完成!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())