/**
 * 代码编辑器组件 - 基于Monaco Editor的LangGraph代码编辑器
 */

import React, { useState, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Tabs,
  Tab,
  Alert,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  Save as SaveIcon,
  Refresh as ResetIcon,
  FileDownload as ExportIcon,
  FileUpload as ImportIcon,
  BugReport as DebugIcon,
  Visibility as PreviewIcon,
} from '@mui/icons-material';
import Editor from '@monaco-editor/react';
import type { Node, Edge } from 'reactflow';

interface CodeEditorProps {
  nodes: Node[];
  edges: Edge[];
  onSave?: (code: string) => void;
  onExecute?: (code: string) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ nodes, edges, onSave, onExecute }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const editorRef = useRef<any>(null);

  // 生成LangGraph代码的模板
  const generateLangGraphCode = () => {
    const template = `"""
LangGraph 工作流代码
自动生成于: ${new Date().toLocaleString()}
节点数量: ${nodes.length}
连接数量: ${edges.length}
"""

from langgraph import StateGraph, END
from typing import TypedDict, Dict, Any
import json

# 定义工作流状态
class WorkflowState(TypedDict):
    input: str
    messages: list
    result: str
    context: Dict[str, Any]
    step_results: Dict[str, Any]

# 工作流节点实现
${generateNodeFunctions()}

# 创建工作流图
def create_workflow():
    workflow = StateGraph(WorkflowState)
    
    # 添加节点
${generateNodeRegistrations()}
    
    # 添加边连接
${generateEdgeConnections()}
    
    return workflow.compile()

# 执行工作流
def execute_workflow(input_data: str) -> Dict[str, Any]:
    workflow = create_workflow()
    
    initial_state = {
        "input": input_data,
        "messages": [],
        "result": "",
        "context": {},
        "step_results": {}
    }
    
    try:
        result = workflow.invoke(initial_state)
        return {
            "status": "success",
            "result": result.get("result", ""),
            "step_results": result.get("step_results", {}),
            "messages": result.get("messages", [])
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "step_results": {}
        }

# 示例用法
if __name__ == "__main__":
    result = execute_workflow("Hello, World!")
    print(json.dumps(result, indent=2, ensure_ascii=False))
`;

    setCode(template);
  };

  const generateNodeFunctions = () => {
    return nodes.map(node => {
      const nodeData = node.data;
      const functionName = `${nodeData.type}_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      switch (nodeData.type) {
        case 'llm':
          return `
def ${functionName}(state: WorkflowState) -> WorkflowState:
    """${nodeData.name} - LLM节点"""
    # LLM调用逻辑
    model = "${nodeData.config?.model || 'qwen-turbo'}"
    temperature = ${nodeData.config?.temperature || 0.7}
    system_prompt = "${nodeData.config?.system_prompt || ''}"
    
    # 这里应该调用实际的LLM API
    response = f"LLM响应 (模型: {model}, 温度: {temperature})"
    
    state["step_results"]["${node.id}"] = response
    state["messages"].append(f"[${nodeData.name}] {response}")
    return state
`;

        case 'rag_retriever':
          return `
def ${functionName}(state: WorkflowState) -> WorkflowState:
    """${nodeData.name} - RAG检索节点"""
    knowledge_base = "${nodeData.config?.knowledge_base || ''}"
    top_k = ${nodeData.config?.top_k || 5}
    
    # 这里应该调用实际的RAG检索API
    retrieved_docs = [f"文档{i}" for i in range(top_k)]
    
    state["step_results"]["${node.id}"] = retrieved_docs
    state["context"]["retrieved_docs"] = retrieved_docs
    state["messages"].append(f"[${nodeData.name}] 检索到 {len(retrieved_docs)} 个文档")
    return state
`;

        case 'classifier':
          return `
def ${functionName}(state: WorkflowState) -> WorkflowState:
    """${nodeData.name} - 分类节点"""
    classes = ${JSON.stringify(nodeData.config?.classes || [])}
    
    # 这里应该调用实际的分类API
    classification_result = classes[0] if classes else "未知"
    confidence = 0.95
    
    result = {
        "class": classification_result,
        "confidence": confidence,
        "all_classes": classes
    }
    
    state["step_results"]["${node.id}"] = result
    state["messages"].append(f"[${nodeData.name}] 分类结果: {classification_result} (置信度: {confidence})")
    return state
`;

        case 'condition':
          return `
def ${functionName}(state: WorkflowState) -> WorkflowState:
    """${nodeData.name} - 条件判断节点"""
    condition_type = "${nodeData.config?.condition_type || 'contains'}"
    condition_value = "${nodeData.config?.condition_value || ''}"
    field_path = "${nodeData.config?.field_path || 'result'}"
    
    # 简单的条件判断逻辑
    condition_met = True  # 这里应该实现实际的条件判断
    
    state["step_results"]["${node.id}"] = {
        "condition_met": condition_met,
        "condition_type": condition_type,
        "condition_value": condition_value
    }
    state["messages"].append(f"[${nodeData.name}] 条件判断: {'满足' if condition_met else '不满足'}")
    return state
`;

        default:
          return `
def ${functionName}(state: WorkflowState) -> WorkflowState:
    """${nodeData.name} - ${nodeData.type}节点"""
    # 通用节点处理逻辑
    result = f"${nodeData.name} 处理完成"
    
    state["step_results"]["${node.id}"] = result
    state["messages"].append(f"[${nodeData.name}] {result}")
    return state
`;
      }
    }).join('\n');
  };

  const generateNodeRegistrations = () => {
    return nodes.map(node => {
      const functionName = `${node.data.type}_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      return `    workflow.add_node("${node.id}", ${functionName})`;
    }).join('\n');
  };

  const generateEdgeConnections = () => {
    const connections = edges.map(edge => {
      return `    workflow.add_edge("${edge.source}", "${edge.target}")`;
    });
    
    // 添加入口点和结束点
    const startNodes = nodes.filter(node => 
      !edges.some(edge => edge.target === node.id)
    );
    const endNodes = nodes.filter(node => 
      !edges.some(edge => edge.source === node.id)
    );
    
    if (startNodes.length > 0) {
      connections.unshift(`    workflow.set_entry_point("${startNodes[0].id}")`);
    }
    
    endNodes.forEach(node => {
      connections.push(`    workflow.add_edge("${node.id}", END)`);
    });
    
    return connections.join('\n');
  };

  const handleExecute = async () => {
    if (!code.trim()) {
      setExecutionResult({
        status: 'error',
        error: '请先生成或编写代码'
      });
      return;
    }

    setIsExecuting(true);
    try {
      // 模拟代码执行
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const mockResult = {
        status: 'success',
        result: '工作流执行成功',
        step_results: nodes.reduce((acc, node) => {
          acc[node.id] = `${node.data.name} 执行完成`;
          return acc;
        }, {} as Record<string, string>),
        execution_time: '2.3s',
        nodes_executed: nodes.length
      };
      
      setExecutionResult(mockResult);
      onExecute?.(code);
    } catch (error) {
      setExecutionResult({
        status: 'error',
        error: error instanceof Error ? error.message : '执行失败'
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleSave = () => {
    onSave?.(code);
  };

  const handleExport = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py,.txt';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          setCode(content);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 工具栏 */}
      <Box sx={{ 
        p: 2, 
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap'
      }}>
        <Button
          startIcon={<PreviewIcon />}
          onClick={generateLangGraphCode}
          size="small"
          variant="outlined"
          sx={{ color: '#00d4ff', borderColor: '#00d4ff' }}
        >
          生成代码
        </Button>
        
        <Button
          startIcon={<RunIcon />}
          onClick={handleExecute}
          disabled={isExecuting}
          size="small"
          variant="contained"
          sx={{ 
            background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)',
            '&:disabled': { opacity: 0.6 }
          }}
        >
          {isExecuting ? '执行中...' : '执行'}
        </Button>
        
        <Button
          startIcon={<SaveIcon />}
          onClick={handleSave}
          size="small"
          sx={{ color: '#00d4ff' }}
        >
          保存
        </Button>
        
        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
        
        <Tooltip title="导入代码文件">
          <IconButton size="small" onClick={handleImport} sx={{ color: '#00d4ff' }}>
            <ImportIcon />
          </IconButton>
        </Tooltip>
        
        <Tooltip title="导出代码文件">
          <IconButton size="small" onClick={handleExport} sx={{ color: '#00d4ff' }}>
            <ExportIcon />
          </IconButton>
        </Tooltip>
        
        <Tooltip title="重置代码">
          <IconButton size="small" onClick={() => setCode('')} sx={{ color: '#00d4ff' }}>
            <ResetIcon />
          </IconButton>
        </Tooltip>
        
        <Box sx={{ flexGrow: 1 }} />
        
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>语言</InputLabel>
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            label="语言"
            sx={{ 
              color: 'white',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255, 255, 255, 0.3)'
              }
            }}
          >
            <MenuItem value="python">Python</MenuItem>
            <MenuItem value="javascript">JavaScript</MenuItem>
            <MenuItem value="typescript">TypeScript</MenuItem>
            <MenuItem value="json">JSON</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* 标签页 */}
      <Tabs 
        value={activeTab} 
        onChange={(_, newValue) => setActiveTab(newValue)}
        sx={{ 
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          '& .MuiTab-root': { color: 'rgba(255, 255, 255, 0.7)' },
          '& .Mui-selected': { color: '#00d4ff' },
          '& .MuiTabs-indicator': { backgroundColor: '#00d4ff' }
        }}
      >
        <Tab label="代码编辑" />
        <Tab label="执行结果" />
        <Tab label="帮助文档" />
      </Tabs>

      {/* 内容区域 */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        {activeTab === 0 && (
          <Editor
            height="100%"
            language={language}
            value={code}
            onChange={(value) => setCode(value || '')}
            theme="vs-dark"
            options={{
              fontSize: 14,
              lineNumbers: 'on',
              roundedSelection: false,
              scrollBeyondLastLine: false,
              readOnly: false,
              automaticLayout: true,
              minimap: { enabled: true },
              folding: true,
              wordWrap: 'on',
              contextmenu: true,
              selectOnLineNumbers: true,
              tabSize: 4,
              insertSpaces: true
            }}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
          />
        )}

        {activeTab === 1 && (
          <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
            {executionResult ? (
              <Box>
                <Alert 
                  severity={executionResult.status === 'success' ? 'success' : 'error'}
                  sx={{ mb: 2 }}
                >
                  {executionResult.status === 'success' ? '执行成功' : `执行失败: ${executionResult.error}`}
                </Alert>
                
                {executionResult.status === 'success' && (
                  <Paper sx={{ p: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)' }}>
                    <Typography variant="h6" sx={{ color: '#00d4ff', mb: 2 }}>
                      执行结果
                    </Typography>
                    
                    <Typography variant="body2" sx={{ color: 'white', mb: 2 }}>
                      执行时间: {executionResult.execution_time}
                    </Typography>
                    
                    <Typography variant="body2" sx={{ color: 'white', mb: 2 }}>
                      执行节点数: {executionResult.nodes_executed}
                    </Typography>
                    
                    <Typography variant="h6" sx={{ color: '#00d4ff', mb: 1 }}>
                      节点执行结果:
                    </Typography>
                    
                    <Box sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      <pre style={{ color: 'white', margin: 0 }}>
                        {JSON.stringify(executionResult.step_results, null, 2)}
                      </pre>
                    </Box>
                  </Paper>
                )}
              </Box>
            ) : (
              <Alert severity="info">
                点击"执行"按钮来运行工作流代码
              </Alert>
            )}
          </Box>
        )}

        {activeTab === 2 && (
          <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
            <Typography variant="h5" sx={{ color: '#00d4ff', mb: 3 }}>
              LangGraph 工作流开发指南
            </Typography>
            
            <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
              基本概念
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 3 }}>
              LangGraph 是一个用于构建有状态的多角色应用程序的库。它基于图的概念，
              其中每个节点代表一个处理步骤，边表示数据流。
            </Typography>
            
            <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
              核心组件
            </Typography>
            <Box sx={{ mb: 3 }}>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • <strong>StateGraph</strong>: 主要的图结构，定义工作流
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • <strong>Node</strong>: 处理函数，接收状态并返回更新后的状态
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • <strong>Edge</strong>: 连接节点，定义数据流向
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • <strong>State</strong>: 在节点间传递的数据结构
              </Typography>
            </Box>
            
            <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
              代码示例
            </Typography>
            <Paper sx={{ p: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)', mb: 3 }}>
              <pre style={{ color: 'white', margin: 0, fontSize: '0.875rem' }}>
{`from langgraph import StateGraph, END
from typing import TypedDict

class WorkflowState(TypedDict):
    messages: list
    result: str

def my_node(state: WorkflowState):
    # 处理逻辑
    return {"result": "处理完成"}

workflow = StateGraph(WorkflowState)
workflow.add_node("my_node", my_node)
workflow.set_entry_point("my_node")
workflow.add_edge("my_node", END)

app = workflow.compile()
result = app.invoke({"messages": [], "result": ""})`}
              </pre>
            </Paper>
            
            <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
              最佳实践
            </Typography>
            <Box>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • 保持节点函数简单且专注于单一职责
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • 使用 TypedDict 定义清晰的状态结构
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • 添加适当的错误处理和日志记录
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1 }}>
                • 使用条件边实现复杂的控制流
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default CodeEditor;