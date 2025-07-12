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
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
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

// 自定义节点类型
import LLMNode from '../components/workflow/LLMNode';
import DataNode from '../components/workflow/DataNode';
import ProcessNode from '../components/workflow/ProcessNode';
import ConditionNode from '../components/workflow/ConditionNode';

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

// 节点类型配置
const nodeTypes = {
  llm: LLMNode,
  data: DataNode,
  process: ProcessNode,
  condition: ConditionNode,
};

// 预定义的节点模板
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
        type: 'embeddings',
        name: '向量嵌入',
        description: '将文本转换为向量表示',
        defaultConfig: {
          model: 'text-embedding-ada-002',
          dimensions: 1536,
          batch_size: 100,
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
      {
        type: 'summarizer',
        name: '文本摘要',
        description: '生成文本内容的摘要',
        defaultConfig: {
          model: 'qwen-plus',
          max_length: 500,
          style: 'concise',
        },
      },
      {
        type: 'translator',
        name: '文本翻译',
        description: '将文本翻译为目标语言',
        defaultConfig: {
          model: 'qwen-turbo',
          source_lang: 'auto',
          target_lang: 'zh',
        },
      },
      {
        type: 'rewriter',
        name: '文本改写',
        description: '重写和优化文本内容',
        defaultConfig: {
          model: 'qwen-plus',
          style: 'professional',
          tone: 'neutral',
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
      {
        type: 'database',
        name: '数据库查询',
        description: '执行数据库查询操作',
        defaultConfig: {
          connection: '',
          query_type: 'SELECT',
          timeout: 30,
        },
      },
      {
        type: 'web_scraper',
        name: '网页抓取',
        description: '抓取和解析网页内容',
        defaultConfig: {
          url: '',
          headers: {},
          timeout: 30,
          extract_text: true,
        },
      },
      {
        type: 'data_transformer',
        name: '数据转换',
        description: '转换和清理数据格式',
        defaultConfig: {
          input_format: 'json',
          output_format: 'json',
          transformations: [],
        },
      },
      {
        type: 'vector_store',
        name: '向量存储',
        description: '存储和管理向量数据',
        defaultConfig: {
          collection_name: '',
          batch_size: 100,
          create_index: true,
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
      {
        type: 'loop',
        name: '循环处理',
        description: '重复执行某个流程',
        defaultConfig: {
          max_iterations: 10,
          break_condition: '',
          timeout: 300,
        },
      },
      {
        type: 'parallel',
        name: '并行执行',
        description: '同时执行多个分支',
        defaultConfig: {
          wait_for_all: true,
          parallel_branches: 3,
          timeout: 300,
        },
      },
      {
        type: 'start',
        name: '开始节点',
        description: '工作流的入口点',
        defaultConfig: {
          trigger_type: 'manual',
          input_schema: {},
        },
      },
      {
        type: 'end',
        name: '结束节点',
        description: '工作流的结束点',
        defaultConfig: {
          output_format: 'json',
          cleanup: true,
        },
      },
      {
        type: 'delay',
        name: '延迟等待',
        description: '暂停执行指定时间',
        defaultConfig: {
          delay_seconds: 1,
          unit: 'seconds',
        },
      },
      {
        type: 'retry',
        name: '重试机制',
        description: '失败时自动重试',
        defaultConfig: {
          max_retries: 3,
          retry_delay: 5,
          retry_on: ['timeout', 'error'],
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
      {
        type: 'api_call',
        name: 'API调用',
        description: '调用外部API接口',
        defaultConfig: {
          url: '',
          method: 'POST',
          headers: {},
          timeout: 30,
        },
      },
      {
        type: 'webhook',
        name: 'Webhook通知',
        description: '发送Webhook通知',
        defaultConfig: {
          url: '',
          method: 'POST',
          payload_template: '',
        },
      },
      {
        type: 'email',
        name: '邮件发送',
        description: '发送电子邮件',
        defaultConfig: {
          to: '',
          subject: '',
          template: '',
          attachments: [],
        },
      },
      {
        type: 'file_upload',
        name: '文件上传',
        description: '上传文件到存储',
        defaultConfig: {
          storage_type: 'local',
          path: '',
          overwrite: false,
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
      {
        type: 'template_engine',
        name: '模板渲染',
        description: '使用模板引擎渲染内容',
        defaultConfig: {
          template: '',
          engine: 'jinja2',
          variables: {},
        },
      },
      {
        type: 'log_writer',
        name: '日志记录',
        description: '记录工作流执行日志',
        defaultConfig: {
          level: 'info',
          format: 'json',
          destination: 'console',
        },
      },
      {
        type: 'cache',
        name: '缓存管理',
        description: '缓存中间结果',
        defaultConfig: {
          key_template: '',
          ttl: 3600,
          cache_type: 'memory',
        },
      },
      {
        type: 'scheduler',
        name: '任务调度',
        description: '定时执行任务',
        defaultConfig: {
          schedule: '0 0 * * *',
          timezone: 'UTC',
          enabled: true,
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
  workflowId,
  onSave,
  onExecute,
}) => {
  const { t } = useTranslation();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

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
  const [tabValue, setTabValue] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');

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

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
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
      const response = await fetch('/api/v1/agents/workflows', {
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
        alert('保存失败，请重试');
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('保存失败，请检查网络连接');
    }
  }, [workflowName, workflowDescription, nodes, edges, onSave]);

  // 执行工作流
  const handleExecute = useCallback(async () => {
    const workflow = {
      name: workflowName,
      nodes,
      edges,
    };

    try {
      // 这里可以添加执行逻辑
      alert('工作流执行中...');
      onExecute?.(workflow);
    } catch (error) {
      console.error('Execute error:', error);
      alert('执行失败，请检查工作流配置');
    }
  }, [workflowName, nodes, edges, onExecute]);

  // 拖拽开始处理
  const onDragStart = (event: React.DragEvent, nodeData: any) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(nodeData));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <ReactFlowProvider>
      <Box sx={{ 
        height: '100vh', 
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* 侧边栏 */}
        <Drawer
          variant="persistent"
          anchor="left"
          open={drawerOpen}
          sx={{
            width: drawerOpen ? 360 : 0,
            flexShrink: 0,
            transition: 'width 0.3s ease-in-out',
            '& .MuiDrawer-paper': {
              width: 360,
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
            <Toolbar>
              <WorkflowIcon sx={{ mr: 1, color: '#00d4ff' }} />
              <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600 }}>
                节点库
              </Typography>
              <IconButton 
                onClick={() => setDrawerOpen(false)}
                sx={{ 
                  color: '#00d4ff',
                  '&:hover': { backgroundColor: 'rgba(0, 212, 255, 0.1)' }
                }}
              >
                <CloseIcon />
              </IconButton>
            </Toolbar>
          </AppBar>

          <Box sx={{ p: 3, height: 'calc(100vh - 64px)', overflow: 'auto' }}>
            <Tabs 
              value={tabValue} 
              onChange={(e, v) => setTabValue(v)}
              sx={{
                mb: 2,
                '& .MuiTab-root': {
                  fontWeight: 600,
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.95rem',
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
              <Tab label="节点模板" />
              <Tab label="我的节点" />
            </Tabs>

            {/* 搜索框 */}
            {tabValue === 0 && (
              <>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="搜索节点..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  sx={{
                    mb: 2,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'rgba(26, 31, 46, 0.8)',
                      borderRadius: '8px',
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
                <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    {searchTerm ? `找到 ${nodeTemplates.map(cat => 
                      cat.nodes.filter(node =>
                        node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        node.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        cat.category.toLowerCase().includes(searchTerm.toLowerCase())
                      ).length
                    ).reduce((a, b) => a + b, 0)} 个节点` : 
                    `共 ${nodeTemplates.reduce((total, cat) => total + cat.nodes.length, 0)} 个节点`}
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
                    defaultExpanded={category.category === 'AI模型'}
                    sx={{
                      background: 'rgba(26, 31, 46, 0.5)',
                      border: '1px solid rgba(0, 212, 255, 0.1)',
                      borderRadius: '12px !important',
                      mb: 2,
                      '&:before': { display: 'none' },
                      '& .MuiAccordionSummary-root': {
                        borderRadius: '12px 12px 0 0',
                        '&:hover': {
                          backgroundColor: 'rgba(0, 212, 255, 0.05)',
                        },
                      },
                    }}
                  >
                    <AccordionSummary 
                      expandIcon={<ExpandMoreIcon sx={{ color: '#00d4ff' }} />}
                      sx={{
                        '& .MuiAccordionSummary-content': {
                          margin: '12px 0',
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Box sx={{ color: '#00d4ff', mr: 1 }}>{category.icon}</Box>
                          <Typography sx={{ fontWeight: 600, color: 'white' }}>
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
                          }}
                        />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <List dense>
                        {category.nodes.map((nodeTemplate) => (
                          <ListItem
                            key={nodeTemplate.type}
                            draggable
                            onDragStart={(e) => onDragStart(e, nodeTemplate)}
                            sx={{
                              border: '1px solid rgba(0, 212, 255, 0.2)',
                              borderRadius: 2,
                              mb: 1,
                              cursor: 'grab',
                              background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
                              transition: 'all 0.3s ease',
                              '&:hover': {
                                backgroundColor: 'rgba(0, 212, 255, 0.1)',
                                borderColor: 'rgba(0, 212, 255, 0.4)',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 4px 12px rgba(0, 212, 255, 0.2)',
                              },
                              '&:active': {
                                cursor: 'grabbing',
                                transform: 'scale(0.95)',
                              },
                            }}
                          >
                            <ListItemText
                              primary={nodeTemplate.name}
                              secondary={nodeTemplate.description}
                              primaryTypographyProps={{ 
                                fontSize: '0.95rem',
                                fontWeight: 600,
                                color: 'white',
                              }}
                              secondaryTypographyProps={{ 
                                fontSize: '0.8rem',
                                color: 'rgba(255, 255, 255, 0.7)',
                                lineHeight: 1.4,
                              }}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Box>
            )}

            {tabValue === 1 && (
              <Box>
                <Typography variant="h6" sx={{ mb: 3, color: '#00d4ff', fontWeight: 600 }}>
                  预定义工作流模板
                </Typography>
                
                {/* 智能客服模板 */}
                <Box
                  sx={{
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    borderRadius: 2,
                    p: 2.5,
                    mb: 2,
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
                    // 加载智能客服模板
                    alert('正在加载智能客服模板...');
                  }}
                >
                  <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
                    🤖 智能客服助手
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
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
                    p: 2.5,
                    mb: 2,
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
                    alert('正在加载文档分析模板...');
                  }}
                >
                  <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
                    📄 智能文档分析
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
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
                    p: 2.5,
                    mb: 2,
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
                    alert('正在加载多语言翻译模板...');
                  }}
                >
                  <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
                    🌍 多语言翻译助手
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
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
                    p: 2.5,
                    mb: 2,
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
                    alert('正在加载内容审核模板...');
                  }}
                >
                  <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
                    🛡️ 智能内容审核
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
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
          width: drawerOpen ? 'calc(100vw - 360px)' : '100vw',
          height: '100vh',
          transition: 'width 0.3s ease-in-out',
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
            <Toolbar sx={{ minHeight: '72px !important', px: 3 }}>
              {!drawerOpen && (
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
              )}
              
              <Typography 
                variant="h5" 
                sx={{ 
                  flexGrow: 1,
                  fontWeight: 700,
                  fontSize: '1.5rem',
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
                size="large"
                sx={{ 
                  mr: 1.5,
                  borderRadius: '10px',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '1rem',
                  px: 3,
                  py: 1.2,
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
                size="large"
                sx={{ 
                  mr: 2,
                  borderRadius: '10px',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '1rem',
                  px: 3,
                  py: 1.2,
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
                  color: 'rgba(255, 255, 255, 0.7)',
                  '&:hover': {
                    color: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                  },
                }}
              >
                <CodeIcon />
              </IconButton>
            </Toolbar>
          </AppBar>

          {/* React Flow 编辑器 */}
          <Box
            ref={reactFlowWrapper}
            sx={{ 
              height: 'calc(100vh - 72px)',
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
              connectionMode={ConnectionMode.Loose}
              fitView
              style={{ zIndex: 2 }}
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
                  从左侧拖拽节点到画布，连接节点创建工作流
                </Alert>
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
          maxWidth="lg"
          fullWidth
          fullScreen
        >
          <DialogTitle>LangGraph代码编辑</DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              在这里可以编写自定义的LangGraph代码
            </Alert>
            {/* 这里可以集成Monaco Editor */}
            <Paper sx={{ p: 2, backgroundColor: '#1e1e1e', color: 'white' }}>
              <pre>{`# LangGraph 工作流代码
from langgraph import StateGraph, END
from typing import TypedDict

class WorkflowState(TypedDict):
    messages: list
    result: str

def llm_node(state: WorkflowState):
    # LLM节点处理逻辑
    return {"result": "LLM处理结果"}

def create_workflow():
    workflow = StateGraph(WorkflowState)
    workflow.add_node("llm", llm_node)
    workflow.set_entry_point("llm")
    workflow.add_edge("llm", END)
    return workflow.compile()
`}</pre>
            </Paper>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCodeEditorOpen(false)}>关闭</Button>
            <Button variant="contained">保存代码</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ReactFlowProvider>
  );
};

export default WorkflowEditor;