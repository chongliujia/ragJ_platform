"""
LangGraph RAG Workflow Demo
演示LangGraph工作流的使用方法
"""

import asyncio
import json
from app.services.langgraph_chat_service import langgraph_chat_service
from app.schemas.chat import ChatRequest


async def demo_langgraph_workflow():
    """演示LangGraph工作流"""
    print("🚀 LangGraph RAG Workflow Demo")
    print("=" * 50)
    
    # 创建测试请求
    chat_request = ChatRequest(
        message="什么是RAG技术？它有什么优势？",
        knowledge_base_id="test1",
        model="deepseek-chat",
        chat_id="demo_chat_001"
    )
    
    print(f"📝 用户问题: {chat_request.message}")
    print(f"📚 知识库: {chat_request.knowledge_base_id}")
    print(f"🤖 模型: {chat_request.model}")
    print("-" * 50)
    
    try:
        # 执行LangGraph工作流
        print("🔄 开始执行LangGraph工作流...")
        
        response = await langgraph_chat_service.chat(
            request=chat_request,
            tenant_id=1,
            user_id=1
        )
        
        print("✅ 工作流执行完成!")
        print("-" * 50)
        print(f"💬 AI回答: {response.message}")
        print(f"📊 使用统计: {response.usage}")
        print(f"🕒 时间戳: {response.timestamp}")
        print(f"💭 对话ID: {response.chat_id}")
        
    except Exception as e:
        print(f"❌ 工作流执行失败: {str(e)}")
        import traceback
        traceback.print_exc()


def demo_workflow_steps():
    """演示工作流的各个步骤"""
    print("\n📋 LangGraph RAG 工作流步骤:")
    print("=" * 50)
    
    steps = [
        {
            "name": "analyze_query",
            "description": "分析用户查询的意图和复杂度",
            "inputs": ["用户查询"],
            "outputs": ["查询分析结果"]
        },
        {
            "name": "generate_embedding",
            "description": "为用户查询生成向量嵌入",
            "inputs": ["查询文本"],
            "outputs": ["查询向量"]
        },
        {
            "name": "retrieve_documents",
            "description": "使用混合搜索检索相关文档",
            "inputs": ["查询向量", "查询文本"],
            "outputs": ["检索到的文档列表"]
        },
        {
            "name": "rerank_documents",
            "description": "对检索到的文档进行重新排序",
            "inputs": ["文档列表", "查询文本"],
            "outputs": ["重新排序的文档"]
        },
        {
            "name": "generate_response",
            "description": "基于上下文生成最终回答",
            "inputs": ["重新排序的文档", "查询文本"],
            "outputs": ["AI回答"]
        },
        {
            "name": "fallback_response",
            "description": "当RAG失败时的备用回答",
            "inputs": ["查询文本"],
            "outputs": ["备用回答"]
        }
    ]
    
    for i, step in enumerate(steps, 1):
        print(f"{i}. {step['name']}")
        print(f"   📝 描述: {step['description']}")
        print(f"   📥 输入: {', '.join(step['inputs'])}")
        print(f"   📤 输出: {', '.join(step['outputs'])}")
        print()


def demo_workflow_advantages():
    """演示LangGraph工作流的优势"""
    print("\n🌟 LangGraph工作流优势:")
    print("=" * 50)
    
    advantages = [
        "🔄 状态管理: 自动管理对话状态和上下文",
        "🌊 流程控制: 灵活的条件分支和错误处理",
        "📊 可观察性: 每个步骤的执行状态和结果跟踪",
        "🔧 可扩展性: 容易添加新的处理步骤",
        "🚀 异步处理: 支持并发操作提高性能",
        "🛡️ 容错性: 优雅的错误处理和回退机制",
        "📈 可监控: 详细的执行日志和性能指标",
        "🎯 专业化: 针对RAG场景优化的工作流"
    ]
    
    for advantage in advantages:
        print(f"  {advantage}")
    
    print("\n📚 使用场景:")
    print("=" * 30)
    scenarios = [
        "🎓 教育问答系统",
        "📋 企业知识库查询",
        "🔍 文档检索和总结",
        "💡 智能客服系统",
        "📊 数据分析报告生成",
        "🏥 医疗知识查询",
        "⚖️ 法律文件分析",
        "🔬 科研文献检索"
    ]
    
    for scenario in scenarios:
        print(f"  {scenario}")


async def main():
    """主函数"""
    print("🎯 LangGraph RAG 系统演示")
    print("=" * 60)
    
    # 展示工作流步骤
    demo_workflow_steps()
    
    # 展示工作流优势
    demo_workflow_advantages()
    
    # 执行演示
    await demo_langgraph_workflow()
    
    print("\n🎉 演示完成!")
    print("=" * 60)
    print("💡 提示: 要在生产环境中使用，请确保:")
    print("  1. 配置正确的API密钥")
    print("  2. 启动Milvus和Elasticsearch服务")
    print("  3. 创建知识库并上传文档")
    print("  4. 配置模型服务")


if __name__ == "__main__":
    asyncio.run(main())