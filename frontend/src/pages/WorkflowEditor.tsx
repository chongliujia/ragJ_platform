/**
 * 智能体工作流可视化编辑器
 * 基于React Flow实现拖拽式工作流设计
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Chip,
  Tooltip,
  AppBar,
  Toolbar,
  Tab,
  Tabs,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
  Code as CodeIcon,
  SmartToy as BotIcon,
  AccountTree as WorkflowIcon,
  Add as AddIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Psychology as AIIcon,
  Storage as DataIcon,
  Transform as ProcessIcon,
  Visibility as ViewIcon,
  Edit as EditIcon,
  BugReport as BugReportIcon,
  DataUsage as DataFlowIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  ConnectionMode,
  ReactFlowProvider,
  Panel,
} from 'reactflow';
import type { Node, Edge, Connection } from 'reactflow';
import 'reactflow/dist/style.css';

// 全局样式覆盖 - 移除React Flow的默认节点样式
const globalStyles = `
  .custom-workflow-editor .react-flow__node {
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    border-radius: 0 !important;
  }
  
  .custom-workflow-editor .react-flow__node-input,
  .custom-workflow-editor .react-flow__node-output,
  .custom-workflow-editor .react-flow__node-llm,
  .custom-workflow-editor .react-flow__node-data,
  .custom-workflow-editor .react-flow__node-process,
  .custom-workflow-editor .react-flow__node-condition {
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  
  .custom-workflow-editor .react-flow__node.selected {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }
`;

// 注入全局样式
if (typeof document !== 'undefined') {
  const existingStyle = document.getElementById('workflow-node-styles');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'workflow-node-styles';
    style.textContent = globalStyles;
    document.head.appendChild(style);
  }
}

// 自定义节点类型
import LLMNode from '../components/workflow/LLMNode';
import DataNode from '../components/workflow/DataNode';
import ProcessNode from '../components/workflow/ProcessNode';
import ConditionNode from '../components/workflow/ConditionNode';
import InputOutputNode from '../components/workflow/InputOutputNode';
import ToolNode from '../components/workflow/ToolNode';
import CodeEditor from '../components/workflow/CodeEditor';
import WorkflowDebugger from '../components/workflow/WorkflowDebugger';
import WorkflowExecution from '../components/workflow/WorkflowExecution';
import UltraCompactNodeItem from '../components/workflow/UltraCompactNodeItem';
import QuickAccessPanel from '../components/workflow/QuickAccessPanel';
import EnhancedLLMNode from '../components/workflow/EnhancedLLMNode';
import EnhancedConnectionLine from '../components/workflow/EnhancedConnectionLine';
import EnhancedEdge from '../components/workflow/EnhancedEdge';
import CustomLLMNode from '../components/workflow/CustomLLMNode';
import CustomFunctionCreator from '../components/workflow/CustomFunctionCreator';
import WorkflowDataFlowManager from '../components/workflow/WorkflowDataFlowManager';

// 工作流节点类型定义
export interface WorkflowNodeData {
  id: string;
  type: string;
  name: string;
  description?: string;
  config: Record<string, any>;
  inputs?: string[];
  outputs?: string[];
}

// 节点类型配置 - 移到组件外部以避免重新创建
const nodeTypes = {
  llm: CustomLLMNode, // 使用可编程LLM节点
  data: DataNode,
  process: ProcessNode,
  condition: ConditionNode,
  // 数据节点类型
  rag_retriever: DataNode,
  parser: DataNode,
  database: DataNode,
  embeddings: DataNode,
  web_scraper: DataNode,
  data_transformer: DataNode,
  vector_store: DataNode,
  // 流程控制节点类型
  loop: ProcessNode,
  parallel: ProcessNode,
  start: ProcessNode,
  end: ProcessNode,
  delay: ProcessNode,
  retry: ProcessNode,
  // 输入输出节点类型
  input: InputOutputNode,
  output: InputOutputNode,
  api_call: InputOutputNode,
  webhook: InputOutputNode,
  email: InputOutputNode,
  file_upload: InputOutputNode,
  // 工具节点类型
  code_executor: ToolNode,
  template_engine: ToolNode,
  log_writer: ToolNode,
  cache: ToolNode,
  scheduler: ToolNode,
  // AI模型节点类型
  summarizer: LLMNode,
  translator: LLMNode,
  rewriter: LLMNode,
  classifier: LLMNode,
};

// 边类型配置 - 移到组件外部以避免重新创建
const edgeTypes = {
  enhanced: EnhancedEdge,
  default: EnhancedEdge, // 使用增强边作为默认边类型
};

// 预定义的节点模板（超精简版）- 移到组件外部
const nodeTemplates = [
  {
    category: 'AI模型',
    icon: <AIIcon />,
    nodes: [
      {
        type: 'llm',
        name: 'LLM调用',
        description: '调用大语言模型进行文本生成',
        defaultConfig: {
          model: 'qwen-turbo',
          temperature: 0.7,
          max_tokens: 1000,
          system_prompt: '你是一个有用的AI助手。',
        },
      },
      {
        type: 'classifier',
        name: '文本分类',
        description: '对文本进行分类或意图识别',
        defaultConfig: {
          model: 'qwen-turbo',
          classes: ['正面', '负面', '中性'],
          confidence_threshold: 0.8,
        },
      },
    ],
  },
  {
    category: '数据处理',
    icon: <DataIcon />,
    nodes: [
      {
        type: 'rag_retriever',
        name: 'RAG检索',
        description: '从知识库检索相关文档',
        defaultConfig: {
          knowledge_base: '',
          top_k: 5,
          score_threshold: 0.7,
          rerank: true,
        },
      },
      {
        type: 'parser',
        name: '文档解析',
        description: '解析各种格式的文档',
        defaultConfig: {
          file_types: ['pdf', 'docx', 'txt', 'md', 'html'],
          extract_images: false,
          chunk_size: 1000,
          chunk_overlap: 200,
        },
      },
    ],
  },
  {
    category: '流程控制',
    icon: <ProcessIcon />,
    nodes: [
      {
        type: 'condition',
        name: '条件判断',
        description: '根据条件控制流程分支',
        defaultConfig: {
          condition_type: 'contains',
          condition_value: '',
          field_path: 'result.status',
        },
      },
    ],
  },
  {
    category: '输入输出',
    icon: <ViewIcon />,
    nodes: [
      {
        type: 'input',
        name: '用户输入',
        description: '接收用户输入数据',
        defaultConfig: {
          input_type: 'text',
          required: true,
          validation: {},
        },
      },
      {
        type: 'output',
        name: '结果输出',
        description: '输出处理结果',
        defaultConfig: {
          output_type: 'text',
          format: 'json',
          template: '',
        },
      },
    ],
  },
  {
    category: '工具集成',
    icon: <SettingsIcon />,
    nodes: [
      {
        type: 'code_executor',
        name: '代码执行',
        description: '执行Python/JavaScript代码',
        defaultConfig: {
          language: 'python',
          code: '',
          timeout: 30,
          environment: 'sandbox',
        },
      },
    ],
  },
];

interface WorkflowEditorProps {
  workflowId?: string;
  onSave?: (workflow: any) => void;
  onExecute?: (workflow: any) => void;
}

const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  workflowId: propWorkflowId,
  onSave,
  onExecute,
}) => {
  const { t } = useTranslation();
  const { id: routeWorkflowId } = useParams();
  const navigate = useNavigate();
  
  // 使用路由参数或props传入的workflowId
  const workflowId = routeWorkflowId || propWorkflowId;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // 如果从WorkflowManagement页面跳转过来，初始化工作流名称
  useEffect(() => {
    if (workflowId && workflowId !== 'new') {
      // 这里可以根据workflowId加载现有工作流数据
      // 目前先使用默认名称
      setWorkflowName(`工作流 ${workflowId}`);
    } else if (workflowId === 'new' || !workflowId) {
      setWorkflowName('新建工作流');
    }
  }, [workflowId]);

  // 工作流状态
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [workflowName, setWorkflowName] = useState('新建工作流');
  const [workflowDescription, setWorkflowDescription] = useState('');

  // UI状态
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [debuggerOpen, setDebuggerOpen] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [dataFlowOpen, setDataFlowOpen] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [customFunctionCreatorOpen, setCustomFunctionCreatorOpen] = useState(false);
  const [customFunctions, setCustomFunctions] = useState<any[]>([]);
  const [dataFlowValidation, setDataFlowValidation] = useState<any>(null);

  // 连接处理
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // 拖拽创建节点
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const nodeData = JSON.parse(
        event.dataTransfer.getData('application/reactflow')
      );

      if (typeof nodeData === 'undefined' || !nodeData) {
        return;
      }

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `${nodeData.type}_${Date.now()}`,
        type: nodeData.type,
        position,
        data: {
          ...nodeData,
          name: nodeData.name,
          config: nodeData.defaultConfig || {},
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  // 节点选择处理
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  // 保存工作流
  const handleSave = useCallback(async () => {
    const workflow = {
      name: workflowName,
      description: workflowDescription,
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.data.type,
        name: node.data.name,
        config: node.data.config,
        position: node.position,
      })),
      edges: edges.map((edge) => ({
        from_node: edge.source,
        to_node: edge.target,
        condition: edge.data?.condition,
      })),
    };

    try {
      // 如果有workflowId且不是'new'，尝试更新现有工作流
      if (workflowId && workflowId !== 'new') {
        try {
          const response = await fetch(`/api/v1/workflows/${workflowId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
            },
            body: JSON.stringify(workflow),
          });

          if (response.ok) {
            alert('工作流更新成功！');
            onSave?.(workflow);
            return;
          }
        } catch (updateError) {
          console.error('Update error:', updateError);
        }
      }

      // 尝试创建新工作流
      const response = await fetch('/api/v1/workflows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(workflow),
      });

      if (response.ok) {
        alert('工作流保存成功！');
        onSave?.(workflow);
      } else {
        throw new Error('保存失败');
      }
    } catch (error) {
      console.error('Save error:', error);
      // 提供降级体验：本地保存到localStorage
      try {
        const savedWorkflows = JSON.parse(localStorage.getItem('saved_workflows') || '[]');
        const workflowWithId = {
          ...workflow,
          id: workflowId || `local_${Date.now()}`,
          saved_at: new Date().toISOString()
        };
        savedWorkflows.push(workflowWithId);
        localStorage.setItem('saved_workflows', JSON.stringify(savedWorkflows));
        alert('后端服务不可用，工作流已保存到本地');
        onSave?.(workflowWithId);
      } catch (localError) {
        alert('保存失败，请检查网络连接和本地存储空间');
      }
    }
  }, [workflowName, workflowDescription, nodes, edges, onSave]);

  // 执行工作流
  const handleExecute = useCallback(async () => {
    setExecutionOpen(true);
  }, []);

  // 拖拽开始处理
  const onDragStart = (event: React.DragEvent, nodeData: any) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(nodeData));
    event.dataTransfer.effectAllowed = 'move';
  };

  // 加载预定义模板
  const loadTemplate = useCallback((templateType: string) => {
    const templates = {
      customer_service: {
        nodes: [
          {
            id: 'start_1',
            type: 'start',
            position: { x: 50, y: 100 },
            data: { name: '开始', type: 'start', config: {} }
          },
          {
            id: 'intent_1',
            type: 'classifier',
            position: { x: 300, y: 100 },
            data: { name: '意图识别', type: 'classifier', config: { model: 'qwen-turbo', classes: ['问题咨询', '投诉建议', '产品介绍'] } }
          },
          {
            id: 'rag_1',
            type: 'rag_retriever',
            position: { x: 600, y: 100 },
            data: { name: '知识检索', type: 'rag_retriever', config: { knowledge_base: 'customer_service', top_k: 5 } }
          },
          {
            id: 'llm_1',
            type: 'llm',
            position: { x: 900, y: 100 },
            data: { name: '回复生成', type: 'llm', config: { model: 'qwen-turbo', temperature: 0.7, system_prompt: '你是一个专业的客服助手' } }
          },
          {
            id: 'output_1',
            type: 'output',
            position: { x: 1200, y: 100 },
            data: { name: '输出结果', type: 'output', config: { format: 'json' } }
          }
        ],
        edges: [
          { id: 'e1-2', source: 'start_1', target: 'intent_1' },
          { id: 'e2-3', source: 'intent_1', target: 'rag_1' },
          { id: 'e3-4', source: 'rag_1', target: 'llm_1' },
          { id: 'e4-5', source: 'llm_1', target: 'output_1' }
        ]
      },
      document_analysis: {
        nodes: [
          {
            id: 'input_1',
            type: 'input',
            position: { x: 50, y: 100 },
            data: { name: '文档输入', type: 'input', config: { input_type: 'file' } }
          },
          {
            id: 'parser_1',
            type: 'parser',
            position: { x: 350, y: 100 },
            data: { name: '文档解析', type: 'parser', config: { file_types: ['pdf', 'docx', 'txt'] } }
          },
          {
            id: 'classifier_1',
            type: 'classifier',
            position: { x: 650, y: 50 },
            data: { name: '内容分类', type: 'classifier', config: { classes: ['合同', '报告', '通知'] } }
          },
          {
            id: 'summarizer_1',
            type: 'summarizer',
            position: { x: 650, y: 200 },
            data: { name: '摘要生成', type: 'summarizer', config: { max_length: 500 } }
          },
          {
            id: 'output_1',
            type: 'output',
            position: { x: 950, y: 100 },
            data: { name: '分析结果', type: 'output', config: { format: 'json' } }
          }
        ],
        edges: [
          { id: 'e1-2', source: 'input_1', target: 'parser_1' },
          { id: 'e2-3', source: 'parser_1', target: 'classifier_1' },
          { id: 'e2-4', source: 'parser_1', target: 'summarizer_1' },
          { id: 'e3-5', source: 'classifier_1', target: 'output_1' },
          { id: 'e4-5', source: 'summarizer_1', target: 'output_1' }
        ]
      },
      translation: {
        nodes: [
          {
            id: 'input_1',
            type: 'input',
            position: { x: 50, y: 100 },
            data: { name: '文本输入', type: 'input', config: { input_type: 'text' } }
          },
          {
            id: 'detector_1',
            type: 'classifier',
            position: { x: 350, y: 100 },
            data: { name: '语言检测', type: 'classifier', config: { classes: ['中文', '英文', '日文', '韩文'] } }
          },
          {
            id: 'translator_1',
            type: 'translator',
            position: { x: 650, y: 100 },
            data: { name: '翻译处理', type: 'translator', config: { target_lang: 'zh' } }
          },
          {
            id: 'output_1',
            type: 'output',
            position: { x: 950, y: 100 },
            data: { name: '翻译结果', type: 'output', config: { format: 'text' } }
          }
        ],
        edges: [
          { id: 'e1-2', source: 'input_1', target: 'detector_1' },
          { id: 'e2-3', source: 'detector_1', target: 'translator_1' },
          { id: 'e3-4', source: 'translator_1', target: 'output_1' }
        ]
      }
    };

    const template = templates[templateType as keyof typeof templates];
    if (template) {
      setNodes(template.nodes);
      setEdges(template.edges);
      setWorkflowName(
        templateType === 'customer_service' ? '智能客服助手' :
        templateType === 'document_analysis' ? '智能文档分析' :
        templateType === 'translation' ? '多语言翻译助手' : '新建工作流'
      );
    }
  }, [setNodes, setEdges]);

  // 创建自定义智能体
  const handleCreateCustomAgent = useCallback(() => {
    // 打开自定义智能体创建对话框
    setCustomFunctionCreatorOpen(true);
  }, []);

  // 保存自定义函数
  const handleSaveCustomFunction = useCallback((customFunction: any) => {
    setCustomFunctions(prev => [...prev, customFunction]);
    // 这里可以保存到后端
    console.log('保存自定义函数:', customFunction);
  }, []);

  // 显示节点信息
  const handleShowNodeInfo = useCallback((nodeTemplate: any) => {
    // 显示节点详细信息
    console.log('显示节点信息:', nodeTemplate);
  }, []);

  return (
    <ReactFlowProvider>
      <Box sx={{ 
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        maxWidth: '1400px',
        margin: '0 auto',
        '@media (max-width: 1600px)': {
          maxWidth: '1200px',
        },
        '@media (max-width: 1200px)': {
          maxWidth: '100%',
        },
      }}>
        {/* 侧边栏 */}
        <Drawer
          variant="persistent"
          anchor="left"
          open={drawerOpen}
          sx={{
            width: drawerOpen ? 220 : 0,
            flexShrink: 0,
            transition: 'width 0.3s ease-in-out',
            '& .MuiDrawer-paper': {
              width: 220,
              boxSizing: 'border-box',
              background: 'linear-gradient(180deg, #1a1f2e 0%, #0f1419 100%)',
              borderRight: '1px solid rgba(0, 212, 255, 0.2)',
              backdropFilter: 'blur(10px)',
              position: 'relative',
              height: '100vh',
              overflow: 'hidden',
            },
          }}
        >
          <AppBar 
            position="static" 
            color="transparent" 
            elevation={0}
            sx={{
              background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(0, 153, 204, 0.05) 100%)',
              borderBottom: '1px solid rgba(0, 212, 255, 0.2)',
            }}
          >
            <Toolbar sx={{ minHeight: '40px !important', px: 2 }}>
              <WorkflowIcon sx={{ mr: 1, color: '#00d4ff' }} />
              <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600, fontSize: '0.9rem' }}>
                智能体组件库
              </Typography>
              <IconButton 
                onClick={() => setDrawerOpen(false)}
                size="small"
                sx={{ 
                  color: '#00d4ff',
                  '&:hover': { backgroundColor: 'rgba(0, 212, 255, 0.1)' }
                }}
              >
                <CloseIcon />
              </IconButton>
            </Toolbar>
          </AppBar>

          <Box sx={{ p: 0.5, height: 'calc(100vh - 40px)', overflow: 'auto' }}>
            <Tabs 
              value={tabValue} 
              onChange={(e, v) => setTabValue(v)}
              sx={{
                mb: 0.5,
                '& .MuiTab-root': {
                  fontWeight: 600,
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.75rem',
                  minHeight: '36px',
                  '&.Mui-selected': {
                    color: '#00d4ff',
                  },
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: '#00d4ff',
                  height: 3,
                  borderRadius: '3px 3px 0 0',
                },
              }}
            >
              <Tab label="组件模板" />
              <Tab label="我的组件" />
            </Tabs>

            {/* 搜索框 */}
            {tabValue === 0 && (
              <>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="搜索组件..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  sx={{
                    mb: 0.5,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'rgba(26, 31, 46, 0.8)',
                      borderRadius: '8px',
                      height: '32px',
                      '& fieldset': {
                        borderColor: 'rgba(0, 212, 255, 0.3)',
                      },
                      '&:hover fieldset': {
                        borderColor: 'rgba(0, 212, 255, 0.5)',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#00d4ff',
                      },
                    },
                    '& .MuiInputBase-input': {
                      color: 'white',
                      padding: '8px 12px',
                      '&::placeholder': {
                        color: 'rgba(255, 255, 255, 0.5)',
                      },
                    },
                  }}
                  InputProps={{
                    startAdornment: (
                      <Box sx={{ mr: 1, color: 'rgba(255, 255, 255, 0.5)' }}>
                        🔍
                      </Box>
                    ),
                  }}
                />
                
                {/* 统计信息 */}
                <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.8rem' }}>
                    {searchTerm ? `找到 ${nodeTemplates.map(cat => 
                      cat.nodes.filter(node =>
                        node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        node.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        cat.category.toLowerCase().includes(searchTerm.toLowerCase())
                      ).length
                    ).reduce((a, b) => a + b, 0)} 个组件` : 
                    `共 ${nodeTemplates.reduce((total, cat) => total + cat.nodes.length, 0)} 个组件`}
                  </Typography>
                  {searchTerm && (
                    <Button
                      size="small"
                      onClick={() => setSearchTerm('')}
                      sx={{ 
                        color: '#00d4ff',
                        fontSize: '0.75rem',
                        textTransform: 'none',
                        minWidth: 'auto',
                        p: 0.5,
                      }}
                    >
                      清除
                    </Button>
                  )}
                </Box>
              </>
            )}

            {tabValue === 0 && (
              <Box>
                {/* 仅保留最精简的节点 */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mb: 1 }}>
                  {/* 只显示最常用的6个节点 */}
                  <UltraCompactNodeItem
                    nodeTemplate={{
                      type: 'llm',
                      name: 'LLM',
                      description: '大语言模型',
                      defaultConfig: { model: 'qwen-turbo', temperature: 0.7 }
                    }}
                    onDragStart={onDragStart}
                    onShowInfo={handleShowNodeInfo}
                  />
                  <UltraCompactNodeItem
                    nodeTemplate={{
                      type: 'rag_retriever',
                      name: '检索',
                      description: '知识库检索',
                      defaultConfig: { top_k: 5, score_threshold: 0.7 }
                    }}
                    onDragStart={onDragStart}
                    onShowInfo={handleShowNodeInfo}
                  />
                  <UltraCompactNodeItem
                    nodeTemplate={{
                      type: 'input',
                      name: '输入',
                      description: '用户输入',
                      defaultConfig: { input_type: 'text', required: true }
                    }}
                    onDragStart={onDragStart}
                    onShowInfo={handleShowNodeInfo}
                  />
                  <UltraCompactNodeItem
                    nodeTemplate={{
                      type: 'output',
                      name: '输出',
                      description: '结果输出',
                      defaultConfig: { output_type: 'text', format: 'json' }
                    }}
                    onDragStart={onDragStart}
                    onShowInfo={handleShowNodeInfo}
                  />
                  <UltraCompactNodeItem
                    nodeTemplate={{
                      type: 'condition',
                      name: '条件',
                      description: '条件判断',
                      defaultConfig: { condition_type: 'contains', condition_value: '' }
                    }}
                    onDragStart={onDragStart}
                    onShowInfo={handleShowNodeInfo}
                  />
                  <UltraCompactNodeItem
                    nodeTemplate={{
                      type: 'code_executor',
                      name: '代码',
                      description: '代码执行',
                      defaultConfig: { language: 'python', timeout: 30 }
                    }}
                    onDragStart={onDragStart}
                    onShowInfo={handleShowNodeInfo}
                  />
                </Box>
                
                {/* 收起的更多组件 */}
                {nodeTemplates
                  .map((category) => ({
                    ...category,
                    nodes: category.nodes.filter(node =>
                      searchTerm === '' ||
                      node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      node.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      category.category.toLowerCase().includes(searchTerm.toLowerCase())
                    )
                  }))
                  .filter(category => category.nodes.length > 0)
                  .map((category) => (
                  <Accordion 
                    key={category.category} 
                    defaultExpanded={false}
                    sx={{
                      background: 'rgba(26, 31, 46, 0.5)',
                      border: '1px solid rgba(0, 212, 255, 0.1)',
                      borderRadius: '8px !important',
                      mb: 0.5,
                      '&:before': { display: 'none' },
                      '& .MuiAccordionSummary-root': {
                        minHeight: '36px',
                        borderRadius: '8px 8px 0 0',
                        '&:hover': {
                          backgroundColor: 'rgba(0, 212, 255, 0.05)',
                        },
                      },
                    }}
                  >
                    <AccordionSummary 
                      expandIcon={<ExpandMoreIcon sx={{ color: '#00d4ff', fontSize: '1.2rem' }} />}
                      sx={{
                        '& .MuiAccordionSummary-content': {
                          margin: '4px 0',
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Box sx={{ color: '#00d4ff', mr: 1.5, fontSize: '1.1rem' }}>{category.icon}</Box>
                          <Typography sx={{ fontWeight: 600, color: 'white', fontSize: '0.875rem' }}>
                            {category.category}
                          </Typography>
                        </Box>
                        <Chip 
                          label={category.nodes.length}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(0, 212, 255, 0.2)',
                            color: '#00d4ff',
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            height: '20px',
                          }}
                        />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0, pb: 0.3 }}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                        {category.nodes.map((nodeTemplate) => (
                          <UltraCompactNodeItem
                            key={nodeTemplate.type}
                            nodeTemplate={nodeTemplate}
                            onDragStart={onDragStart}
                            onShowInfo={handleShowNodeInfo}
                          />
                        ))}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Box>
            )}

            {tabValue === 1 && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="h6" sx={{ color: '#00d4ff', fontWeight: 600, fontSize: '0.9rem' }}>
                    我的自定义组件
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setCustomFunctionCreatorOpen(true)}
                    sx={{
                      color: '#00d4ff',
                      borderColor: '#00d4ff',
                      fontSize: '0.7rem',
                      padding: '2px 8px',
                      minWidth: 'auto',
                      '&:hover': {
                        borderColor: '#00d4ff',
                        backgroundColor: 'rgba(0, 212, 255, 0.1)',
                      },
                    }}
                  >
                    <AddIcon sx={{ fontSize: '0.8rem', mr: 0.5 }} />
                    创建函数
                  </Button>
                </Box>

                {/* 自定义函数列表 */}
                {customFunctions.length > 0 ? (
                  <Box sx={{ mb: 2 }}>
                    {customFunctions.map((func, index) => (
                      <Box
                        key={index}
                        sx={{
                          border: '1px solid rgba(76, 175, 80, 0.3)',
                          borderRadius: 2,
                          p: 1,
                          mb: 1,
                          background: 'rgba(76, 175, 80, 0.1)',
                          cursor: 'pointer',
                          '&:hover': {
                            backgroundColor: 'rgba(76, 175, 80, 0.2)',
                          },
                        }}
                        onClick={() => {
                          // 添加自定义函数到画布
                          const newNode = {
                            id: `custom_${Date.now()}`,
                            type: 'llm', // 使用CustomLLMNode类型
                            position: { x: 100, y: 100 },
                            data: {
                              name: func.name,
                              config: {},
                              functionCode: func.implementation,
                              type: 'custom',
                            },
                          };
                          setNodes(prev => [...prev, newNode]);
                        }}
                      >
                        <Typography variant="body2" sx={{ color: 'white', fontWeight: 600, fontSize: '0.8rem' }}>
                          {func.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.7rem' }}>
                          {func.description}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 2, mb: 2 }}>
                    <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem' }}>
                      还没有自定义函数
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '0.7rem' }}>
                      点击"创建函数"来添加您的第一个自定义组件
                    </Typography>
                  </Box>
                )}

                <Typography variant="h6" sx={{ mb: 1, color: '#00d4ff', fontWeight: 600, fontSize: '0.9rem' }}>
                  预定义工作流模板
                </Typography>
                
                {/* 智能客服模板 */}
                <Box
                  sx={{
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    borderRadius: 2,
                    p: 0.75,
                    mb: 0.5,
                    background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      borderColor: 'rgba(0, 212, 255, 0.4)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(0, 212, 255, 0.2)',
                    },
                  }}
                  onClick={() => loadTemplate('customer_service')}
                >
                  <Typography variant="subtitle1" sx={{ color: 'white', mb: 0.5, fontWeight: 600, fontSize: '0.85rem' }}>
                    🤖 智能客服助手
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 0.5, fontSize: '0.7rem' }}>
                    基于RAG的智能客服工作流，包含意图识别、知识检索和回复生成
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip label="意图分类" size="small" sx={{ backgroundColor: 'rgba(0, 212, 255, 0.2)' }} />
                    <Chip label="知识检索" size="small" sx={{ backgroundColor: 'rgba(0, 212, 255, 0.2)' }} />
                    <Chip label="回复生成" size="small" sx={{ backgroundColor: 'rgba(0, 212, 255, 0.2)' }} />
                  </Box>
                </Box>

                {/* 文档分析模板 */}
                <Box
                  sx={{
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    borderRadius: 2,
                    p: 0.75,
                    mb: 0.5,
                    background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      borderColor: 'rgba(0, 212, 255, 0.4)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(0, 212, 255, 0.2)',
                    },
                  }}
                  onClick={() => loadTemplate('document_analysis')}
                >
                  <Typography variant="subtitle1" sx={{ color: 'white', mb: 0.5, fontWeight: 600, fontSize: '0.85rem' }}>
                    📄 智能文档分析
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 0.5, fontSize: '0.7rem' }}>
                    自动解析文档，提取关键信息，生成摘要和分析报告
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip label="文档解析" size="small" sx={{ backgroundColor: 'rgba(67, 233, 123, 0.2)' }} />
                    <Chip label="信息提取" size="small" sx={{ backgroundColor: 'rgba(67, 233, 123, 0.2)' }} />
                    <Chip label="摘要生成" size="small" sx={{ backgroundColor: 'rgba(67, 233, 123, 0.2)' }} />
                  </Box>
                </Box>

                {/* 多语言翻译模板 */}
                <Box
                  sx={{
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    borderRadius: 2,
                    p: 0.75,
                    mb: 0.5,
                    background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      borderColor: 'rgba(0, 212, 255, 0.4)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(0, 212, 255, 0.2)',
                    },
                  }}
                  onClick={() => loadTemplate('translation')}
                >
                  <Typography variant="subtitle1" sx={{ color: 'white', mb: 0.5, fontWeight: 600, fontSize: '0.85rem' }}>
                    🌍 多语言翻译助手
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 0.5, fontSize: '0.7rem' }}>
                    自动检测语言并翻译为多种目标语言，支持批量处理
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip label="语言检测" size="small" sx={{ backgroundColor: 'rgba(249, 115, 22, 0.2)' }} />
                    <Chip label="批量翻译" size="small" sx={{ backgroundColor: 'rgba(249, 115, 22, 0.2)' }} />
                    <Chip label="质量评估" size="small" sx={{ backgroundColor: 'rgba(249, 115, 22, 0.2)' }} />
                  </Box>
                </Box>

                {/* 内容审核模板 */}
                <Box
                  sx={{
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    borderRadius: 2,
                    p: 0.75,
                    mb: 0.5,
                    background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      borderColor: 'rgba(0, 212, 255, 0.4)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(0, 212, 255, 0.2)',
                    },
                  }}
                  onClick={() => {
                    // 可以添加更多模板
                    alert('该模板正在开发中...');
                  }}
                >
                  <Typography variant="subtitle1" sx={{ color: 'white', mb: 0.5, fontWeight: 600, fontSize: '0.85rem' }}>
                    🛡️ 智能内容审核
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 0.5, fontSize: '0.7rem' }}>
                    自动检测有害内容，进行内容分类和风险评估
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip label="内容分类" size="small" sx={{ backgroundColor: 'rgba(239, 68, 68, 0.2)' }} />
                    <Chip label="风险评估" size="small" sx={{ backgroundColor: 'rgba(239, 68, 68, 0.2)' }} />
                    <Chip label="自动标记" size="small" sx={{ backgroundColor: 'rgba(239, 68, 68, 0.2)' }} />
                  </Box>
                </Box>

                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center', mt: 3 }}>
                  点击模板即可快速创建相应的工作流
                </Typography>
              </Box>
            )}
          </Box>
        </Drawer>

        {/* 主编辑区域 */}
        <Box sx={{ 
          flexGrow: 1, 
          display: 'flex', 
          flexDirection: 'column',
          width: drawerOpen ? 'calc(100vw - 220px)' : '100vw',
          height: '100vh',
          transition: 'width 0.3s ease-in-out',
          '@media (max-width: 1200px)': {
            width: drawerOpen ? 'calc(100vw - 220px)' : '100vw',
          },
          '@media (max-width: 768px)': {
            width: '100vw',
          },
        }}>
          {/* 顶部工具栏 */}
          <AppBar 
            position="static" 
            color="default" 
            elevation={0}
            sx={{
              background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 50%, #0a0e1a 100%)',
              borderBottom: '1px solid rgba(0, 212, 255, 0.3)',
              backdropFilter: 'blur(20px)',
              flexShrink: 0,
            }}
          >
            <Toolbar sx={{ minHeight: '28px !important', px: 0.75 }}>
              {!drawerOpen && (
                <Tooltip title="打开组件库" arrow>
                  <IconButton
                    onClick={() => setDrawerOpen(true)}
                    sx={{ 
                      mr: 2,
                      color: '#00d4ff',
                      '&:hover': {
                        backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        transform: 'scale(1.1)',
                      },
                    }}
                  >
                    <WorkflowIcon />
                  </IconButton>
                </Tooltip>
              )}
              
              <Typography 
                variant="h6" 
                sx={{ 
                  flexGrow: 1,
                  fontWeight: 700,
                  fontSize: '1rem',
                  background: 'linear-gradient(45deg, #00d4ff 30%, #ffffff 90%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {workflowName}
              </Typography>

              <Button
                startIcon={<SaveIcon />}
                onClick={handleSave}
                size="small"
                sx={{ 
                  mr: 1,
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  px: 1.5,
                  py: 0.5,
                  border: '1px solid rgba(0, 212, 255, 0.3)',
                  color: '#00d4ff',
                  '&:hover': {
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                    borderColor: '#00d4ff',
                    boxShadow: '0 4px 12px rgba(0, 212, 255, 0.2)',
                  },
                }}
              >
                保存
              </Button>
              
              <Button
                startIcon={<PlayIcon />}
                onClick={handleExecute}
                variant="contained"
                size="small"
                sx={{ 
                  mr: 1,
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  px: 1.5,
                  py: 0.5,
                  background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)',
                  boxShadow: '0 4px 15px rgba(0, 212, 255, 0.3)',
                  '&:hover': {
                    background: 'linear-gradient(45deg, #33e0ff 0%, #00b3e6 100%)',
                    boxShadow: '0 6px 20px rgba(0, 212, 255, 0.4)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                执行
              </Button>

              <IconButton 
                onClick={() => setConfigDialogOpen(true)}
                sx={{
                  mr: 1,
                  color: 'rgba(255, 255, 255, 0.7)',
                  '&:hover': {
                    color: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                  },
                }}
              >
                <SettingsIcon />
              </IconButton>
              
              <IconButton 
                onClick={() => setCodeEditorOpen(true)}
                sx={{
                  mr: 1,
                  color: 'rgba(255, 255, 255, 0.7)',
                  '&:hover': {
                    color: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                  },
                }}
              >
                <CodeIcon />
              </IconButton>
              
              <IconButton 
                onClick={() => setDebuggerOpen(true)}
                sx={{
                  mr: 1,
                  color: 'rgba(255, 255, 255, 0.7)',
                  '&:hover': {
                    color: '#ff9800',
                    backgroundColor: 'rgba(255, 152, 0, 0.1)',
                  },
                }}
              >
                <BugReportIcon />
              </IconButton>
              
              <IconButton 
                onClick={() => setDataFlowOpen(true)}
                sx={{
                  color: dataFlowValidation?.isValid === false ? '#f44336' : 'rgba(255, 255, 255, 0.7)',
                  '&:hover': {
                    color: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                  },
                }}
              >
                <DataFlowIcon />
              </IconButton>
            </Toolbar>
          </AppBar>

          {/* React Flow 编辑器 */}
          <Box
            ref={reactFlowWrapper}
            sx={{ 
              height: 'calc(100vh - 28px)',
              width: '100%',
              background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 50%, #0f1419 100%)',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'radial-gradient(circle at 25% 25%, rgba(0, 212, 255, 0.1) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(0, 153, 204, 0.05) 0%, transparent 50%)',
                pointerEvents: 'none',
                zIndex: 1,
              },
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onInit={setReactFlowInstance}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionLineComponent={EnhancedConnectionLine}
              connectionMode={ConnectionMode.Loose}
              fitView
              className="custom-workflow-editor"
              style={{ zIndex: 2 }}
              defaultEdgeOptions={{
                type: 'enhanced',
                animated: true,
                style: { strokeWidth: 2, stroke: '#00d4ff' },
              }}
            >
              <Background 
                variant="dots" 
                gap={30} 
                size={1.5}
                color="rgba(0, 212, 255, 0.3)"
                style={{ backgroundColor: 'transparent' }}
              />
              <Controls 
                style={{ 
                  backgroundColor: 'rgba(26, 31, 46, 0.9)',
                  border: '1px solid rgba(0, 212, 255, 0.3)',
                  borderRadius: '16px',
                  backdropFilter: 'blur(15px)',
                  padding: '8px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                }}
              />
              <MiniMap 
                style={{ 
                  backgroundColor: 'rgba(26, 31, 46, 0.9)',
                  border: '1px solid rgba(0, 212, 255, 0.3)',
                  borderRadius: '16px',
                  backdropFilter: 'blur(15px)',
                  width: 200,
                  height: 150,
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                }}
                maskColor="rgba(0, 0, 0, 0.1)"
              />
              
              <Panel position="top-center">
                <Alert 
                  severity="info" 
                  sx={{ 
                    mb: 2,
                    background: 'rgba(26, 31, 46, 0.9)',
                    color: 'white',
                    border: '1px solid rgba(0, 212, 255, 0.3)',
                    borderRadius: '12px',
                    backdropFilter: 'blur(10px)',
                    '& .MuiAlert-icon': {
                      color: '#00d4ff',
                    },
                  }}
                >
                  从左侧拖拽组件到画布，连接组件创建智能体工作流
                </Alert>
              </Panel>
              
              <Panel position="top-right">
                <Box sx={{ 
                  display: 'flex', 
                  gap: 1, 
                  alignItems: 'center',
                  background: 'rgba(26, 31, 46, 0.9)',
                  px: 2,
                  py: 1,
                  borderRadius: 2,
                  border: '1px solid rgba(0, 212, 255, 0.3)',
                  backdropFilter: 'blur(10px)'
                }}>
                  <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    组件: {nodes.length}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    连接: {edges.length}
                  </Typography>
                  {nodes.length > 0 && (
                    <Chip 
                      label="已构建"
                      size="small"
                      sx={{
                        height: '20px',
                        fontSize: '0.7rem',
                        backgroundColor: 'rgba(76, 175, 80, 0.2)',
                        color: '#4caf50',
                      }}
                    />
                  )}
                </Box>
              </Panel>
            </ReactFlow>
          </Box>
        </Box>

        {/* 工作流配置对话框 */}
        <Dialog
          open={configDialogOpen}
          onClose={() => setConfigDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>工作流配置</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="工作流名称"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              sx={{ mb: 2, mt: 1 }}
            />
            <TextField
              fullWidth
              label="描述"
              multiline
              rows={3}
              value={workflowDescription}
              onChange={(e) => setWorkflowDescription(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfigDialogOpen(false)}>取消</Button>
            <Button
              onClick={() => setConfigDialogOpen(false)}
              variant="contained"
            >
              确定
            </Button>
          </DialogActions>
        </Dialog>

        {/* 代码编辑器对话框 */}
        <Dialog
          open={codeEditorOpen}
          onClose={() => setCodeEditorOpen(false)}
          maxWidth={false}
          fullWidth
          fullScreen
          sx={{
            '& .MuiDialog-paper': {
              backgroundColor: '#0a0e1a',
              backgroundImage: 'none',
            }
          }}
        >
          <DialogTitle 
            sx={{ 
              backgroundColor: 'rgba(26, 31, 46, 0.9)',
              borderBottom: '1px solid rgba(0, 212, 255, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <CodeIcon sx={{ mr: 1, color: '#00d4ff' }} />
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
                LangGraph 代码编辑器
              </Typography>
            </Box>
            <IconButton
              onClick={() => setCodeEditorOpen(false)}
              sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          
          <DialogContent sx={{ p: 0, height: 'calc(100vh - 64px)' }}>
            <CodeEditor
              nodes={nodes}
              edges={edges}
              onSave={(code) => {
                console.log('保存代码:', code);
                // 这里可以保存到后端
              }}
              onExecute={(code) => {
                console.log('执行代码:', code);
                // 这里可以执行工作流
              }}
            />
          </DialogContent>
        </Dialog>

        {/* 调试器对话框 */}
        <Dialog
          open={debuggerOpen}
          onClose={() => setDebuggerOpen(false)}
          maxWidth={false}
          fullWidth
          fullScreen
          sx={{
            '& .MuiDialog-paper': {
              backgroundColor: '#0a0e1a',
              backgroundImage: 'none',
            }
          }}
        >
          <DialogTitle 
            sx={{ 
              backgroundColor: 'rgba(26, 31, 46, 0.9)',
              borderBottom: '1px solid rgba(255, 152, 0, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <BugReportIcon sx={{ mr: 1, color: '#ff9800' }} />
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
                工作流调试器
              </Typography>
              <Chip 
                label={`${nodes.length} 节点 · ${edges.length} 连接`}
                size="small"
                sx={{ 
                  ml: 2,
                  backgroundColor: 'rgba(255, 152, 0, 0.2)',
                  color: '#ff9800'
                }}
              />
            </Box>
            <IconButton
              onClick={() => setDebuggerOpen(false)}
              sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          
          <DialogContent sx={{ p: 0, height: 'calc(100vh - 64px)' }}>
            <WorkflowDebugger
              nodes={nodes}
              edges={edges}
              onExecute={(debugMode, breakpoints) => {
                console.log('执行工作流:', { debugMode, breakpoints });
                // 这里可以执行实际的工作流
              }}
            />
          </DialogContent>
        </Dialog>

        {/* 工作流执行器对话框 */}
        <Dialog
          open={executionOpen}
          onClose={() => setExecutionOpen(false)}
          maxWidth={false}
          fullWidth
          fullScreen
          sx={{
            '& .MuiDialog-paper': {
              backgroundColor: '#0a0e1a',
              backgroundImage: 'none',
            }
          }}
        >
          <DialogTitle 
            sx={{ 
              backgroundColor: 'rgba(26, 31, 46, 0.9)',
              borderBottom: '1px solid rgba(76, 175, 80, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <PlayIcon sx={{ mr: 1, color: '#4caf50' }} />
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
                工作流执行器
              </Typography>
              <Chip 
                label={`${nodes.length} 节点 · ${edges.length} 连接`}
                size="small"
                sx={{ 
                  ml: 2,
                  backgroundColor: 'rgba(76, 175, 80, 0.2)',
                  color: '#4caf50'
                }}
              />
            </Box>
            <IconButton
              onClick={() => setExecutionOpen(false)}
              sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          
          <DialogContent sx={{ p: 0, height: 'calc(100vh - 64px)' }}>
            <WorkflowExecution
              workflowId={workflowId}
              nodes={nodes}
              edges={edges}
              onSave={(workflow) => {
                console.log('保存工作流:', workflow);
                onSave?.(workflow);
                setExecutionOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>

        {/* 自定义函数创建器 */}
        <CustomFunctionCreator
          open={customFunctionCreatorOpen}
          onClose={() => setCustomFunctionCreatorOpen(false)}
          onSave={(customFunction) => {
            setCustomFunctions(prev => [...prev, customFunction]);
            console.log('保存自定义函数:', customFunction);
            // 这里可以将自定义函数保存到后端或本地存储
          }}
        />

        {/* 数据流管理器对话框 */}
        <Dialog
          open={dataFlowOpen}
          onClose={() => setDataFlowOpen(false)}
          maxWidth="lg"
          fullWidth
          sx={{
            '& .MuiDialog-paper': {
              backgroundColor: '#0a0e1a',
              backgroundImage: 'none',
              height: '80vh',
            }
          }}
        >
          <DialogTitle 
            sx={{ 
              backgroundColor: 'rgba(26, 31, 46, 0.9)',
              borderBottom: '1px solid rgba(0, 212, 255, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <DataFlowIcon sx={{ mr: 1, color: '#00d4ff' }} />
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
                数据流管理器
              </Typography>
              {dataFlowValidation && (
                <Chip 
                  label={dataFlowValidation.isValid ? '验证通过' : '验证失败'}
                  size="small"
                  color={dataFlowValidation.isValid ? 'success' : 'error'}
                  sx={{ ml: 2 }}
                />
              )}
            </Box>
            <IconButton
              onClick={() => setDataFlowOpen(false)}
              sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          
          <DialogContent sx={{ p: 0, height: 'calc(100vh - 120px)' }}>
            <WorkflowDataFlowManager
              nodes={nodes}
              edges={edges}
              onDataFlowUpdate={(validation) => {
                setDataFlowValidation(validation);
              }}
              onConnectionFix={(connection) => {
                console.log('修复连接:', connection);
                // 这里可以自动修复连接问题
              }}
            />
          </DialogContent>
        </Dialog>
      </Box>
    </ReactFlowProvider>
  );
};

export default WorkflowEditor;