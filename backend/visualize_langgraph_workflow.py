"""
LangGraph工作流可视化
生成RAG工作流的图表和说明
"""

import os
from datetime import datetime


def generate_workflow_visualization():
    """生成工作流可视化文档"""
    
    mermaid_diagram = """
```mermaid
graph TD
    A[开始] --> B[analyze_query<br/>分析查询]
    B --> C[generate_embedding<br/>生成向量嵌入]
    C --> D{embedding_generated?<br/>向量生成成功?}
    
    D -->|Yes| E[retrieve_documents<br/>检索文档]
    D -->|No| F[fallback_response<br/>备用回答]
    
    E --> G{docs_retrieved?<br/>检索到文档?}
    G -->|Yes| H[rerank_documents<br/>重新排序]
    G -->|No| F
    
    H --> I[generate_response<br/>生成回答]
    I --> J[结束]
    F --> J
    
    style A fill:#e1f5fe
    style J fill:#e8f5e8
    style D fill:#fff3e0
    style G fill:#fff3e0
    style F fill:#ffebee
    style I fill:#e8f5e8
```
"""
    
    workflow_steps = {
        "analyze_query": {
            "name": "分析查询",
            "description": "分析用户查询的意图、复杂度和语言",
            "inputs": ["用户查询文本"],
            "outputs": ["查询分析结果"],
            "logic": "检测查询语言(中文/英文)，判断查询类型和复杂度"
        },
        "generate_embedding": {
            "name": "生成向量嵌入",
            "description": "将用户查询转换为向量表示",
            "inputs": ["查询文本"],
            "outputs": ["查询向量", "生成状态"],
            "logic": "调用嵌入模型API，处理失败情况"
        },
        "retrieve_documents": {
            "name": "检索文档", 
            "description": "使用混合搜索检索相关文档",
            "inputs": ["查询向量", "查询文本", "知识库ID"],
            "outputs": ["检索到的文档列表"],
            "logic": "并行执行向量搜索和关键词搜索，合并结果"
        },
        "rerank_documents": {
            "name": "重新排序",
            "description": "对检索到的文档进行相关性重新排序",
            "inputs": ["文档列表", "查询文本"],
            "outputs": ["重新排序的文档", "上下文文本"],
            "logic": "使用重排序模型提高检索精度"
        },
        "generate_response": {
            "name": "生成回答",
            "description": "基于上下文生成最终回答",
            "inputs": ["上下文文本", "查询文本"],
            "outputs": ["AI回答", "使用统计"],
            "logic": "构造RAG提示词，调用LLM生成回答，添加引用信息"
        },
        "fallback_response": {
            "name": "备用回答",
            "description": "当RAG流程失败时提供备用回答",
            "inputs": ["查询文本"],
            "outputs": ["备用回答"],
            "logic": "直接调用LLM进行标准对话，不使用知识库"
        }
    }
    
    decision_points = {
        "should_retrieve": {
            "condition": "embedding_generated",
            "description": "检查向量嵌入是否生成成功",
            "paths": {
                "retrieve": "向量生成成功，继续文档检索",
                "fallback": "向量生成失败，使用备用回答"
            }
        },
        "should_rerank": {
            "condition": "docs_retrieved > 0",
            "description": "检查是否检索到文档",
            "paths": {
                "rerank": "检索到文档，进行重新排序",
                "fallback": "未检索到文档，使用备用回答"
            }
        }
    }
    
    # 生成详细说明
    documentation = f"""
# LangGraph RAG 工作流可视化

## 工作流图表

{mermaid_diagram}

## 节点详细说明

"""
    
    for step_id, step_info in workflow_steps.items():
        documentation += f"""
### {step_info['name']} ({step_id})

**描述**: {step_info['description']}

**输入**: {', '.join(step_info['inputs'])}

**输出**: {', '.join(step_info['outputs'])}

**处理逻辑**: {step_info['logic']}

---
"""
    
    documentation += """
## 决策点说明

"""
    
    for decision_id, decision_info in decision_points.items():
        documentation += f"""
### {decision_id}

**条件**: {decision_info['condition']}

**描述**: {decision_info['description']}

**路径选择**:
"""
        for path, desc in decision_info['paths'].items():
            documentation += f"- **{path}**: {desc}\n"
        documentation += "\n---\n"
    
    documentation += f"""
## 工作流特性

### 🔄 状态管理
- **自动状态跟踪**: 每个步骤的执行状态和结果自动保存
- **状态传递**: 状态在各节点间无缝传递
- **错误状态**: 记录错误信息和恢复状态

### 🌊 流程控制
- **条件分支**: 基于执行结果自动选择下一步
- **错误处理**: 优雅的错误处理和降级机制
- **并行处理**: 向量搜索和关键词搜索并行执行

### 📊 可观察性
- **执行日志**: 详细的步骤执行日志
- **性能监控**: 每个步骤的执行时间统计
- **错误诊断**: 详细的错误信息和堆栈跟踪

### 🛡️ 容错机制
- **多级回退**: 向量化失败 → 检索失败 → 生成失败的多层回退
- **部分成功**: 即使某些步骤失败也能提供有用的回答
- **服务降级**: Elasticsearch不可用时自动使用纯向量搜索

## 扩展能力

### 添加新节点
```python
async def new_processing_step(state: ChatState) -> ChatState:
    # 新的处理逻辑
    state["new_data"] = "processed"
    return state

workflow.add_node("new_step", new_processing_step)
```

### 自定义决策逻辑
```python
def custom_condition(state: ChatState) -> str:
    if state["custom_metric"] > threshold:
        return "path_a"
    return "path_b"

workflow.add_conditional_edges(
    "source_node",
    custom_condition,
    {{"path_a": "node_a", "path_b": "node_b"}}
)
```

### 性能优化
- **缓存策略**: 查询向量和检索结果缓存
- **批处理**: 多个查询的批量处理
- **异步优化**: 最大化并发处理能力

## 使用场景

1. **企业知识库问答**: 基于企业文档的智能问答
2. **客户服务**: 自动化客户查询处理
3. **教育辅助**: 基于教材的学习辅导
4. **研究助手**: 科研文献检索和分析
5. **法律咨询**: 法律文档查询和解释
6. **医疗问答**: 医学知识库查询
7. **技术支持**: 产品文档和故障排除
8. **内容创作**: 基于资料的内容生成

## 监控指标

- **响应时间**: 端到端响应时间和各步骤耗时
- **检索准确率**: 检索结果的相关性评分
- **用户满意度**: 基于用户反馈的质量评估
- **系统资源**: CPU、内存、网络使用情况
- **错误率**: 各类错误的发生频率和处理成功率

---

*文档生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*
"""
    
    return documentation


def save_visualization_docs():
    """保存可视化文档"""
    docs_dir = "docs"
    if not os.path.exists(docs_dir):
        os.makedirs(docs_dir)
    
    doc_content = generate_workflow_visualization()
    
    with open(os.path.join(docs_dir, "langgraph_workflow_visualization.md"), "w", encoding="utf-8") as f:
        f.write(doc_content)
    
    print("✅ LangGraph工作流可视化文档已生成")
    print(f"📁 保存位置: {os.path.join(docs_dir, 'langgraph_workflow_visualization.md')}")


if __name__ == "__main__":
    save_visualization_docs()