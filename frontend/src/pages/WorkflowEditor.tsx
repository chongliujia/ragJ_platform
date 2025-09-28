/**
 * 智能体工作流可视化编辑器
 * 基于React Flow实现拖拽式工作流设计
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  Snackbar,
  
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
  CheckCircle as ValidateIcon,
  ViewModule as LayoutIcon,
  CenterFocusStrong as FitIcon,
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
import DataNode from '../components/workflow/DataNode';
import ProcessNode from '../components/workflow/ProcessNode';
import ConditionNode from '../components/workflow/ConditionNode';
import InputOutputNode from '../components/workflow/InputOutputNode';
import ToolNode from '../components/workflow/ToolNode';
import CodeEditor from '../components/workflow/CodeEditor';
import WorkflowDebugger from '../components/workflow/WorkflowDebugger';
import WorkflowExecution from '../components/workflow/WorkflowExecution';
import NodeConfigPanel from '../components/workflow/NodeConfigPanel';
import UltraCompactNodeItem from '../components/workflow/UltraCompactNodeItem';
import QuickAccessPanel from '../components/workflow/QuickAccessPanel';
import EnhancedConnectionLine from '../components/workflow/EnhancedConnectionLine';
import EnhancedEdge from '../components/workflow/EnhancedEdge';
import CustomLLMNode from '../components/workflow/CustomLLMNode';
import CustomFunctionCreator from '../components/workflow/CustomFunctionCreator';
import WorkflowDataFlowManager from '../components/workflow/WorkflowDataFlowManager';
import ChatTesterWidget from '../components/ChatTesterWidget';

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
  retriever: DataNode,
  hybrid_retriever: DataNode,
  parser: DataNode,
  database: DataNode,
  embeddings: DataNode,
  reranker: DataNode,
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
  summarizer: CustomLLMNode,
  translator: CustomLLMNode,
  rewriter: CustomLLMNode,
  classifier: CustomLLMNode,
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
          model: '', // 默认为空，需要用户选择
          temperature: 0.7,
          max_tokens: 1000,
          system_prompt: '',
        },
        // 提供函数签名，便于参数表单与连线句柄匹配
        function_signature: {
          name: 'llm_chat_completion',
          description: '调用大语言模型进行文本生成和对话',
          category: 'llm',
          inputs: [
            { name: 'prompt', type: 'string', description: '用户输入的提示文本', required: true, example: '请用一句话介绍这个系统' },
          ],
          outputs: [
            { name: 'content', type: 'string', description: '生成的文本内容', required: true, example: '这是生成的文本...' },
          ],
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
        description: '向量检索（Milvus）',
        defaultConfig: {
          knowledge_base: '',
          top_k: 5,
          score_threshold: 0.7,
          rerank: true,
        },
      },
      {
        type: 'retriever',
        name: '统一检索',
        description: '向量/关键词/混合可选',
        defaultConfig: {
          knowledge_base: '',
          top_k: 5,
          score_threshold: 0.7,
          mode: 'hybrid',
        },
      },
      {
        type: 'hybrid_retriever',
        name: '混合检索',
        description: '向量+关键词融合检索',
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
  // 已持久化的工作流ID（用于执行/加载历史）。当路由是 'new' 时，保存成功后会更新为真实ID
  const [persistedWorkflowId, setPersistedWorkflowId] = useState<string | undefined>(
    workflowId && workflowId !== 'new' ? workflowId : undefined
  );
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // 如果从WorkflowManagement页面跳转过来，初始化工作流名称
  useEffect(() => {
    const init = async () => {
      if (workflowId && workflowId !== 'new') {
        // 验证此ID是否真实存在于后端；不存在则视为未持久化
        try {
          const res = await fetch(`/api/v1/workflows/${workflowId}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
          });
          if (res.ok) {
            // 加载后端已保存的工作流定义
            const data = await res.json();
            const serverNodes = Array.isArray(data?.nodes) ? data.nodes : [];
            const serverEdges = Array.isArray(data?.edges) ? data.edges : [];

            // 转换为 React Flow 节点
            const rfNodes = serverNodes.map((n: any) => ({
              id: n.id,
              type: n.type,
              position: n.position || { x: 100, y: 100 },
              data: {
                type: n.type,
                name: n.name || n.type,
                description: n.description,
                config: n.config || {},
                function_signature: n.function_signature,
              },
            }));
            // 节点类型映射，便于推断默认句柄
            const nodeTypeMap: Record<string, string> = Object.fromEntries(
              rfNodes.map((n: any) => [n.id, n.type])
            );

            const rfEdges = serverEdges.map((e: any) => {
              const edge: any = {
                id: e.id || `e_${e.source}_${e.target}`,
                source: e.source,
                target: e.target,
              };
              const srcType = nodeTypeMap[e.source];
              const tgtType = nodeTypeMap[e.target];
              const srcOut = e.source_output as string | undefined;
              const tgtIn = e.target_input as string | undefined;

              // 将通用别名映射为语义句柄名
              const mapAlias = (type: string | undefined, alias: string | undefined, side: 'src'|'tgt') => {
                if (!alias) return undefined;
                const a = String(alias);
                if (type === 'llm') {
                  if (side === 'src' && a.startsWith('output')) return 'content';
                  if (side === 'tgt' && a.startsWith('input')) return 'prompt';
                }
              if (type === 'rag_retriever' || type === 'hybrid_retriever' || type === 'retriever') {
                if (side === 'src' && a.startsWith('output')) return 'documents';
                if (side === 'tgt' && a.startsWith('input')) return 'query';
              }
                if (type === 'embeddings') {
                  if (side === 'src' && a.startsWith('output')) return 'embedding';
                  if (side === 'tgt' && a.startsWith('input')) return 'text';
                }
                if (type === 'parser') {
                  if (side === 'src' && a.startsWith('output')) return 'parsed_data';
                  if (side === 'tgt' && a.startsWith('input')) return 'text';
                }
                if (type === 'output') {
                  if (side === 'tgt' && a.startsWith('input')) return 'data';
                }
                if (type === 'input') {
                  if (side === 'src' && a.startsWith('output')) return 'data';
                }
                // 非别名，保留原值
                if ((side === 'src' && !a.startsWith('output')) || (side === 'tgt' && !a.startsWith('input'))) return a;
                return undefined;
              };

              const mappedSrc = mapAlias(srcType, srcOut, 'src');
              const mappedTgt = mapAlias(tgtType, tgtIn, 'tgt');
              if (mappedSrc) edge.sourceHandle = mappedSrc;
              if (mappedTgt) edge.targetHandle = mappedTgt;
              return edge;
            });

            setNodes(rfNodes);
            setEdges(rfEdges);
            setWorkflowName(data?.name || `工作流 ${workflowId}`);
            setWorkflowDescription(data?.description || '');
            setPersistedWorkflowId(workflowId);
            try { localStorage.setItem('current_workflow_id', workflowId); } catch {}
            return;
          }
        } catch {}
        // 不存在：作为新建处理
        setWorkflowName(workflowName || `工作流 ${workflowId}`);
        setPersistedWorkflowId(undefined);
      } else {
        setWorkflowName('新建工作流');
        setPersistedWorkflowId(undefined);
      }
    };
    init();
  }, [workflowId]);

  // 工作流状态
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [workflowName, setWorkflowName] = useState('新建工作流');
  const [workflowDescription, setWorkflowDescription] = useState('');
  // 运行高亮：用于聊天小窗执行时在编辑区动态展示
  const runActiveRef = useRef(false);

  const updateRunProgress = useCallback((evt: any) => {
    const step = evt?.step || evt?.data || evt || {};
    const nodeId: string | undefined = step.nodeId || step.node_id || step.node || step.id;
    const st: string | undefined = step.status || evt?.status;
    if (!nodeId) return;
    runActiveRef.current = true;
    const mapStatus = (s?: string) => {
      if (!s) return undefined as any;
      if (s === 'running') return 'running';
      if (s === 'completed' || s === 'success' || s === 'done') return 'success';
      if (s === 'error' || s === 'failed') return 'error';
      return undefined as any;
    };
    const ns = mapStatus(st);
    if (!ns) return;
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: ns } } : n));
    setEdges(eds => eds.map(e => e.source === nodeId ? {
      ...e,
      data: { ...(e.data || {}), status: ns === 'running' ? 'active' : (ns === 'success' ? 'success' : ns === 'error' ? 'error' : 'idle'), animated: ns === 'running' },
    } : e));
  }, [setNodes, setEdges]);

  const handleRunComplete = useCallback((evt: any) => {
    // 完成后，短暂保留高亮，再缓慢恢复
    setTimeout(() => {
      setEdges(eds => eds.map(e => ({ ...e, data: { ...(e.data || {}), status: 'idle', animated: false } })));
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: undefined } })));
      runActiveRef.current = false;
    }, 1500);
  }, [setNodes, setEdges]);

  const handleRunError = useCallback((evt: any) => {
    // 错误时保留颜色，下一次进度再清理
    runActiveRef.current = false;
  }, []);

  // UI状态
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodeConfigOpen, setNodeConfigOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [debuggerOpen, setDebuggerOpen] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [dataFlowOpen, setDataFlowOpen] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  // 边标签显示模式: always | hover
  const [edgeLabelMode, setEdgeLabelMode] = useState<'always' | 'hover'>(() => {
    if (typeof window === 'undefined') return 'always';
    return (localStorage.getItem('edge_label_mode') as any) || 'always';
  });
  const [customFunctionCreatorOpen, setCustomFunctionCreatorOpen] = useState(false);
  const [customFunctions, setCustomFunctions] = useState<any[]>([]);
  const [dataFlowValidation, setDataFlowValidation] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [snackbar, setSnackbar] = useState<{open: boolean; message: string; severity: 'success'|'info'|'warning'|'error'}>({ open: false, message: '', severity: 'info' });
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);

  // 兼容旧连接：自动补齐缺失的句柄（避免出现 output -> input）
  useEffect(() => {
    if (!nodes.length || !edges.length) return;
    setEdges((eds) => eds.map((e) => {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);
      const srcType = (src as any)?.data?.type || src?.type;
      const tgtType = (tgt as any)?.data?.type || tgt?.type;
      const sh = (e as any).sourceHandle || (
        srcType === 'input' ? 'data' :
        (srcType === 'rag_retriever' || srcType === 'hybrid_retriever' || srcType === 'retriever') ? 'documents' :
        srcType === 'parser' ? 'parsed_data' :
        srcType === 'embeddings' ? 'embedding' :
        srcType === 'llm' ? 'content' : undefined
      );
      const th = (e as any).targetHandle || (
        tgtType === 'llm' ? 'prompt' :
        tgtType === 'output' ? 'data' :
        (tgtType === 'rag_retriever' || tgtType === 'hybrid_retriever' || tgtType === 'retriever') ? 'query' :
        (tgtType === 'embeddings' || tgtType === 'parser') ? 'text' : undefined
      );
      if (sh === (e as any).sourceHandle && th === (e as any).targetHandle) return e;
      return { ...e, sourceHandle: sh, targetHandle: th } as any;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const showSnackbar = useCallback((message: string, severity: 'success'|'info'|'warning'|'error' = 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  // 监听来自节点组件的“打开配置”事件
  useEffect(() => {
    const handler = (e: any) => {
      const nodeId = e?.detail?.nodeId as string | undefined;
      if (nodeId) {
        const n = nodes.find(nn => nn.id === nodeId) || null;
        setSelectedNode(n);
      }
      setNodeConfigOpen(true);
    };
    window.addEventListener('open-node-config', handler as any);
    return () => window.removeEventListener('open-node-config', handler as any);
  }, [nodes]);

  // 连接处理
  const onConnect = useCallback(
    (params: Connection) => {
      const src = nodes.find(n => n.id === params.source);
      const tgt = nodes.find(n => n.id === params.target);
      const p = { ...params } as any;
      // 兜底：当未指定句柄时，用节点类型的语义句柄名
      const srcType = (src as any)?.data?.type || src?.type;
      const tgtType = (tgt as any)?.data?.type || tgt?.type;
      if (!p.sourceHandle) {
        if (srcType === 'input') p.sourceHandle = 'data';
        if (srcType === 'rag_retriever' || srcType === 'hybrid_retriever' || srcType === 'retriever') p.sourceHandle = 'documents';
        if (srcType === 'parser') p.sourceHandle = 'parsed_data';
        if (srcType === 'embeddings') p.sourceHandle = 'embedding';
        if (srcType === 'llm') p.sourceHandle = 'content';
      }
      if (!p.targetHandle) {
        if (tgtType === 'llm') p.targetHandle = 'prompt';
        if (tgtType === 'output') p.targetHandle = 'data';
        if (tgtType === 'rag_retriever' || tgtType === 'hybrid_retriever' || tgtType === 'retriever') p.targetHandle = 'query';
        if (tgtType === 'embeddings' || tgtType === 'parser') p.targetHandle = 'text';
      }
      setEdges((eds) => addEdge(p, eds));
    },
    [nodes, setEdges]
  );

  // 切换边标签显示模式
  const toggleEdgeLabelMode = useCallback(() => {
    setEdgeLabelMode((prev) => {
      const next = prev === 'always' ? 'hover' : 'always';
      try { localStorage.setItem('edge_label_mode', next); } catch {}
      // 更新所有边以触发重渲染
      setEdges((eds) => eds.map((e) => ({ ...e, data: { ...(e.data || {}), labelMode: next } })));
      return next;
    });
  }, [setEdges]);

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

  // 初始化边的标签显示模式到 data 中，便于 EnhancedEdge 渲染
  useEffect(() => {
    setEdges((eds) => eds.map(e => ({ ...e, data: { ...(e.data || {}), labelMode: edgeLabelMode } })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeLabelMode]);

  // 节点选择处理
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setNodeConfigOpen(true);
  }, []);

  // 根据验证结果标记节点状态（错误/警告）
  const applyValidationMarkers = useCallback((errors: any[], warnings: any[]) => {
    const getIds = (arr: any[]) => {
      const ids = new Set<string>();
      for (const msg of arr || []) {
        const s = String(msg || '');
        let m = s.match(/节点\s+(\S+)/);
        if (!m) m = s.match(/node\s+(\S+)/i);
        if (m && m[1]) ids.add(m[1]);
      }
      return ids;
    };
    const errorIds = getIds(errors);
    const warnIds = getIds(warnings);
    setNodes((nds) => nds.map((n) => {
      const d: any = { ...(n.data || {}) };
      if (errorIds.has(n.id)) d.status = 'error';
      else if (warnIds.has(n.id)) d.status = 'running';
      else if (d.status === 'error' || d.status === 'running') d.status = 'idle';
      return { ...n, data: d } as any;
    }));
  }, [setNodes]);

  // 保存工作流
  // 保存当前工作流；返回保存后的工作流ID（新建时）
  const handleSave = useCallback(async (): Promise<string | undefined> => {
      // 预校验：检索节点 knowledge_base 必须已选择
      const invalidRetriever = nodes.find((n: any) => (
        ['rag_retriever','hybrid_retriever','retriever'].includes((n.data?.type || n.type)) && (!n.data?.config?.knowledge_base)
      ));
      if (invalidRetriever) {
        showSnackbar('保存失败：存在未配置知识库的检索节点', 'warning');
        try {
          const n = invalidRetriever;
          if (reactFlowInstance) {
            const padding = 100;
            reactFlowInstance.fitBounds({ x: n.position.x - padding, y: n.position.y - padding, width: 2*padding, height: 2*padding }, { padding: 0.2 });
          }
          setNodes(nds => nds.map(nn => ({ ...nn, selected: nn.id === n.id })));
        } catch {}
        return undefined;
      }
      const normalizeHandle = (h: any) => {
        if (!h) return undefined;
        // 若是通用别名（input*/output*），则不写入句柄，由后端按默认处理
        if (typeof h === 'string' && (h.startsWith('output') || h.startsWith('input'))) return undefined;
        return h;
      };

      const nodeTypeMap: Record<string, string> = Object.fromEntries(nodes.map(n => [n.id, (n as any).data?.type || n.type]));
      const fallbackHandle = (edge: any, side: 'src' | 'tgt') => {
        const type = side === 'src' ? nodeTypeMap[edge.source] : nodeTypeMap[edge.target];
        if (side === 'src') {
          if (!edge.sourceHandle) {
            if (type === 'input') return 'data';
            if (type === 'rag_retriever') return 'documents';
            if (type === 'parser') return 'parsed_data';
            if (type === 'embeddings') return 'embedding';
          }
          return edge.sourceHandle;
        } else {
          if (!edge.targetHandle) {
            if (type === 'llm') return 'prompt';
            if (type === 'output') return 'data';
            if (type === 'rag_retriever') return 'query';
            if (type === 'embeddings' || type === 'parser') return 'text';
          }
          return edge.targetHandle;
        }
      };

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
        edges: edges.map((edge) => {
          const sh = normalizeHandle(fallbackHandle(edge, 'src'));
          const th = normalizeHandle(fallbackHandle(edge, 'tgt'));
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            ...(sh ? { source_output: sh } : {}),
            ...(th ? { target_input: th } : {}),
            condition: edge.data?.condition,
          };
        }),
      };

    try {
      // 如果有workflowId且不是'new'，尝试更新现有工作流
      if (persistedWorkflowId) {
        try {
          const response = await fetch(`/api/v1/workflows/${persistedWorkflowId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
            },
            body: JSON.stringify(workflow),
          });

          if (response.ok) {
            showSnackbar('工作流更新成功！', 'success');
            onSave?.(workflow);
            return persistedWorkflowId;
          }
          if (response.status === 401 || response.status === 403) {
            showSnackbar('未登录或无权限，请先登录后再保存', 'warning');
            navigate('/login');
            return undefined;
          }
        } catch (updateError) {
          console.error('Update error:', updateError);
        }
      }

      // 尝试创建新工作流
      const response = await fetch('/api/v1/workflows/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(workflow),
      });

      if (response.ok) {
        const data = await response.json();
        const newId = data?.id;
        if (newId) {
          setPersistedWorkflowId(newId);
          // 导航到可编辑路由，确保后续执行/历史使用后端ID
          navigate(`/workflows/${newId}/edit`);
          try { localStorage.setItem('current_workflow_id', newId); } catch {}
        }
        showSnackbar('工作流保存成功！', 'success');
        onSave?.({ ...workflow, id: newId });
        return newId;
      } else {
        if (response.status === 401 || response.status === 403) {
          showSnackbar('未登录或无权限，请先登录后再保存', 'warning');
          navigate('/login');
          return undefined;
        }
        const msg = await response.text().catch(() => '');
        throw new Error(`保存失败 ${response.status}${msg ? `: ${msg}` : ''}`);
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
        showSnackbar('后端不可用或连接失败，已暂存到本地', 'warning');
        onSave?.(workflowWithId);
        return workflowWithId.id as string;
      } catch (localError) {
        showSnackbar('保存失败，请检查网络连接和本地存储空间', 'error');
      }
    }
    return undefined;
  }, [workflowName, workflowDescription, nodes, edges, onSave, navigate, persistedWorkflowId]);

  // 执行工作流
  const handleExecute = useCallback(async () => {
    // 确保已保存并有后端ID
    let id = persistedWorkflowId;
    if (!id) {
      id = await handleSave();
    }
    if (!id) {
      showSnackbar('请先保存工作流再执行', 'warning');
      return;
    }
    setExecutionOpen(true);
  }, [persistedWorkflowId, handleSave, showSnackbar]);

  // 后端校验工作流
  const handleValidate = useCallback(async () => {
    // 预校验：检索节点 knowledge_base 必须已选择
    const invalidRetriever = nodes.find((n: any) => (
      ['rag_retriever','hybrid_retriever','retriever'].includes((n.data?.type || n.type)) && (!n.data?.config?.knowledge_base)
    ));
    if (invalidRetriever) {
      showSnackbar('验证失败：存在未配置知识库的检索节点', 'warning');
      try {
        const n = invalidRetriever;
        if (reactFlowInstance) {
          const padding = 100;
          reactFlowInstance.fitBounds({ x: n.position.x - padding, y: n.position.y - padding, width: 2*padding, height: 2*padding }, { padding: 0.2 });
        }
        setNodes(nds => nds.map(nn => ({ ...nn, selected: nn.id === n.id })));
      } catch {}
      return;
    }
    try {
      setValidating(true);
      const normalizeHandle2 = (h: any) => {
        if (!h) return undefined;
        if (typeof h === 'string' && (h.startsWith('output') || h.startsWith('input'))) return undefined;
        return h;
      };
      const payload = {
        name: workflowName,
        description: workflowDescription,
        nodes: nodes.map((n) => ({
          id: n.id,
          type: (n as any).data?.type || n.type,
          name: (n as any).data?.name || n.id,
          description: (n as any).data?.description,
          config: (n as any).data?.config || {},
          position: n.position,
        })),
        edges: edges.map((e) => {
          const sh = normalizeHandle2((e as any).sourceHandle);
          const th = normalizeHandle2((e as any).targetHandle);
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            ...(sh ? { source_output: sh } : {}),
            ...(th ? { target_input: th } : {}),
          };
        }),
      };

      const res = await fetch('/api/v1/workflows/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('validate failed');
      const data = await res.json();
      const result = {
        isValid: data.is_valid,
        errors: data.errors || [],
        warnings: data.warnings || [],
        suggestions: data.suggestions || [],
      };
      setDataFlowValidation(result);
      applyValidationMarkers(result.errors, result.warnings);
      if (!result.isValid && result.errors.length) {
        focusEdgeByError(String(result.errors[0]));
      }
      showSnackbar(result.isValid ? '验证通过' : `发现 ${result.errors.length} 个错误、${result.warnings.length} 个警告`, result.isValid ? 'success' : 'warning');
    } catch (err) {
      console.error('Validate error:', err);
      showSnackbar('验证失败，请稍后重试', 'error');
    } finally {
      setValidating(false);
    }
  }, [workflowName, workflowDescription, nodes, edges, showSnackbar, applyValidationMarkers]);

  // 根据错误字符串尝试定位相关边
  const focusEdgeByError = (text: string) => {
    const outMatch = text.match(/节点\s+(\S+)\s+没有输出\s+(\S+)/);
    if (outMatch) {
      const srcId = outMatch[1];
      const edge = edges.find(e => e.source === srcId);
      if (edge) { selectAndFocusEdge(edge.id); }
      return;
    }
    const inMatch = text.match(/节点\s+(\S+)\s+没有输入\s+(\S+)/);
    if (inMatch) {
      const tgtId = inMatch[1];
      const edge = edges.find(e => e.target === tgtId);
      if (edge) { selectAndFocusEdge(edge.id); }
    }
  };

  const selectAndFocusEdge = (edgeId: string) => {
    setEdges(eds => eds.map(e => ({ ...e, selected: e.id === edgeId })));
    const edge = edges.find(e => e.id === edgeId);
    if (!edge || !reactFlowInstance) return;
    const sn = nodes.find(n => n.id === edge.source);
    const tn = nodes.find(n => n.id === edge.target);
    if (!sn || !tn) return;
    const minX = Math.min(sn.position.x, tn.position.x) - 80;
    const minY = Math.min(sn.position.y, tn.position.y) - 80;
    const maxX = Math.max(sn.position.x, tn.position.x) + 200;
    const maxY = Math.max(sn.position.y, tn.position.y) + 200;
    reactFlowInstance.fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 0.2 });
  };

  // 简易自动布局（分层排列）
  const handleAutoLayout = useCallback(() => {
    const inDegree: Record<string, number> = {};
    nodes.forEach((n) => (inDegree[n.id] = 0));
    edges.forEach((e) => {
      inDegree[e.target] = (inDegree[e.target] || 0) + 1;
    });

    const levels: string[][] = [];
    const visited = new Set<string>();
    let current = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
    const edgeList = edges.map((e) => ({ ...e }));

    while (current.length) {
      levels.push(current);
      current.forEach((id) => visited.add(id));
      const next = new Set<string>();
      edgeList.forEach((e) => {
        if (visited.has(e.source) && !visited.has(e.target)) {
          inDegree[e.target] = Math.max(0, (inDegree[e.target] || 1) - 1);
          if (inDegree[e.target] === 0) next.add(e.target);
        }
      });
      current = Array.from(next);
    }

    const unvisited = nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
    if (unvisited.length) levels.push(unvisited);

    const xGap = 280;
    const yGap = 140;
    const newNodes = nodes.map((n) => ({ ...n }));
    levels.forEach((level, li) => {
      level.forEach((id, idx) => {
        const node = newNodes.find((nn) => nn.id === id);
        if (node) node.position = { x: li * xGap + 40, y: idx * yGap + 60 };
      });
    });
    setNodes(newNodes);
  }, [nodes, edges, setNodes]);

  const handleFitView = useCallback(() => {
    try {
      reactFlowInstance?.fitView({ padding: 0.2 });
    } catch {}
  }, [reactFlowInstance]);

  // 快捷键支持：保存(Cmd/Ctrl+S)、执行(Cmd/Ctrl+Enter)、验证(Cmd/Ctrl+Shift+V)、自动布局(L)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        handleSave();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        handleExecute();
      } else if (mod && e.shiftKey && key === 'v') {
        e.preventDefault();
        handleValidate();
      } else if (key === 'l') {
        handleAutoLayout();
      } else if (key === '+') {
        try { reactFlowInstance?.zoomIn({ duration: 100 }); } catch {}
      } else if (key === '-') {
        try { reactFlowInstance?.zoomOut({ duration: 100 }); } catch {}
      } else if (key === 'g') {
        setShowGrid(v => !v);
      } else if (key === 's' && !mod) {
        setSnap(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, handleExecute, handleValidate, handleAutoLayout]);

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
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* 左侧组件库 */}
        <Drawer
          variant="persistent"
          anchor="left"
          open={drawerOpen}
          sx={{
            width: drawerOpen ? 280 : 0, // 稍微增加宽度
            flexShrink: 0,
            transition: 'width 0.3s ease-in-out',
            '& .MuiDrawer-paper': {
              width: 280,
              boxSizing: 'border-box',
              background: 'linear-gradient(180deg, #1a1f2e 0%, #0f1419 100%)',
              borderRight: '1px solid rgba(0, 212, 255, 0.2)',
              backdropFilter: 'blur(10px)',
              position: 'relative',
              height: '100%',
              top: 0,
              overflow: 'auto',
              maxHeight: '100%',
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
                      defaultConfig: { model: '', temperature: 0.7 }
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
          width: drawerOpen ? 'calc(100% - 280px)' : '100%',
          height: '100%',
          overflow: 'hidden',
          minHeight: 0,
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
              height: '56px', // 固定高度
            }}
          >
            <Toolbar sx={{ 
              minHeight: '56px !important', 
              height: '56px',
              px: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              overflow: 'hidden',
            }}>
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
                  fontSize: '0.9rem',
                  background: 'linear-gradient(45deg, #00d4ff 30%, #ffffff 90%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '200px',
                }}
              >
                {workflowName}
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Button
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  size="small"
                  sx={{ 
                    borderRadius: '6px',
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    px: 1,
                    py: 0.3,
                    minWidth: '64px',
                    border: '1px solid rgba(0, 212, 255, 0.3)',
                    color: '#00d4ff',
                    '&:hover': {
                      backgroundColor: 'rgba(0, 212, 255, 0.1)',
                      borderColor: '#00d4ff',
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
                    borderRadius: '6px',
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    px: 1,
                    py: 0.3,
                    minWidth: '64px',
                    background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)',
                    '&:hover': {
                      background: 'linear-gradient(45deg, #33e0ff 0%, #00b3e6 100%)',
                    },
                  }}
                >
                  执行
                </Button>

                {persistedWorkflowId && (
                  <Button
                    onClick={() => navigate(`/workflows/${persistedWorkflowId}/test`)}
                    variant="outlined"
                    size="small"
                    sx={{ 
                      borderRadius: '6px',
                      textTransform: 'none',
                      fontWeight: 600,
                      fontSize: '0.7rem',
                      px: 1,
                      py: 0.3,
                      minWidth: '60px',
                      border: '1px solid rgba(0, 212, 255, 0.3)',
                      color: '#00d4ff',
                      '&:hover': { backgroundColor: 'rgba(0, 212, 255, 0.1)', borderColor: '#00d4ff' },
                    }}
                  >
                    测试
                  </Button>
                )}

                <Box sx={{ display: 'flex', gap: 0.3 }}>
                  <Tooltip title="工作流设置"><span>
                    <IconButton 
                      onClick={() => setConfigDialogOpen(true)}
                      size="small"
                      sx={{
                        color: 'rgba(255, 255, 255, 0.7)',
                        '&:hover': {
                          color: '#00d4ff',
                          backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        },
                      }}
                    >
                      <SettingsIcon fontSize="small" />
                    </IconButton>
                  </span></Tooltip>
                  
                  <Tooltip title="代码编辑器"><span>
                    <IconButton 
                      onClick={() => setCodeEditorOpen(true)}
                      size="small"
                      sx={{
                        color: 'rgba(255, 255, 255, 0.7)',
                        '&:hover': {
                          color: '#00d4ff',
                          backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        },
                      }}
                    >
                      <CodeIcon fontSize="small" />
                    </IconButton>
                  </span></Tooltip>
                  
                  <Tooltip title="调试器"><span>
                    <IconButton 
                      onClick={() => setDebuggerOpen(true)}
                      size="small"
                      sx={{
                        color: 'rgba(255, 255, 255, 0.7)',
                        '&:hover': {
                          color: '#ff9800',
                          backgroundColor: 'rgba(255, 152, 0, 0.1)',
                        },
                      }}
                    >
                      <BugReportIcon fontSize="small" />
                    </IconButton>
                  </span></Tooltip>

                  <Tooltip title="验证工作流"><span>
                    <IconButton 
                      onClick={handleValidate}
                      disabled={validating}
                      size="small"
                      sx={{
                        color: dataFlowValidation?.isValid === false ? '#f44336' : 'rgba(255, 255, 255, 0.7)',
                        '&:hover': {
                          color: '#4caf50',
                          backgroundColor: 'rgba(76, 175, 80, 0.12)',
                        },
                      }}
                    >
                      <ValidateIcon fontSize="small" />
                    </IconButton>
                  </span></Tooltip>

                  <Tooltip title="自动布局"><span>
                    <IconButton 
                      onClick={handleAutoLayout}
                      size="small"
                      sx={{
                        color: 'rgba(255, 255, 255, 0.7)',
                        '&:hover': {
                          color: '#00d4ff',
                          backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        },
                      }}
                    >
                      <LayoutIcon fontSize="small" />
                    </IconButton>
                  </span></Tooltip>

                  <Tooltip title={`边标签：${edgeLabelMode === 'always' ? '常驻' : '悬停'}`}>
                    <IconButton 
                      onClick={toggleEdgeLabelMode}
                      size="small"
                      sx={{
                        color: edgeLabelMode === 'always' ? '#4caf50' : 'rgba(255, 255, 255, 0.7)',
                        '&:hover': {
                          color: '#4caf50',
                          backgroundColor: 'rgba(76, 175, 80, 0.12)',
                        },
                      }}
                    >
                      <DataFlowIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  
                  <Tooltip title="数据流管理"><span>
                    <IconButton 
                      onClick={() => setDataFlowOpen(true)}
                      size="small"
                      sx={{
                        color: dataFlowValidation?.isValid === false ? '#f44336' : 'rgba(255, 255, 255, 0.7)',
                        '&:hover': {
                          color: '#00d4ff',
                          backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        },
                      }}
                    >
                      <DataFlowIcon fontSize="small" />
                    </IconButton>
                  </span></Tooltip>
                </Box>
              </Box>
            </Toolbar>
          </AppBar>

        {/* React Flow 编辑器 */}
        <Box
          ref={reactFlowWrapper}
          sx={{ 
            flex: 1,
            width: '100%',
            height: 'calc(100% - 56px)', // 减去工具栏的高度
            background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 50%, #0f1419 100%)',
            position: 'relative',
            overflow: 'hidden',
            minHeight: 0,
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
            onMoveEnd={(_, viewport) => { try { setZoom((viewport as any)?.zoom || 1); } catch {} }}
            nodeTypes={useMemo(() => nodeTypes, [])}
            edgeTypes={useMemo(() => edgeTypes, [])}
            connectionLineComponent={EnhancedConnectionLine}
            connectionMode={ConnectionMode.Loose}
            snapToGrid={snap}
            snapGrid={[20, 20]}
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
              style={{ backgroundColor: 'transparent', display: showGrid ? 'block' : 'none' }}
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
                点击顶部"组件库"按钮添加组件，连接组件创建智能体工作流
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

            <Panel position="bottom-left">
              <Box sx={{ display: 'flex', gap: 1, p: 1, background: 'rgba(26, 31, 46, 0.9)', borderRadius: 2, border: '1px solid rgba(0, 212, 255, 0.3)' }}>
                <Tooltip title="保存 (⌘/Ctrl+S)"><span>
                  <IconButton size="small" onClick={handleSave} sx={{ color: '#00d4ff' }}>
                    <SaveIcon fontSize="small" />
                  </IconButton>
                </span></Tooltip>
                <Tooltip title="验证 (⌘/Ctrl+Shift+V)"><span>
                  <IconButton size="small" onClick={handleValidate} disabled={validating} sx={{ color: '#4caf50' }}>
                    <ValidateIcon fontSize="small" />
                  </IconButton>
                </span></Tooltip>
                <Tooltip title="自动布局 (L)"><span>
                  <IconButton size="small" onClick={handleAutoLayout} sx={{ color: '#00d4ff' }}>
                    <LayoutIcon fontSize="small" />
                  </IconButton>
                </span></Tooltip>
                <Tooltip title="适配视图"><span>
                  <IconButton size="small" onClick={handleFitView} sx={{ color: '#00d4ff' }}>
                    <FitIcon fontSize="small" />
                  </IconButton>
                </span></Tooltip>
              </Box>
            </Panel>

            <Panel position="bottom-right">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, background: 'rgba(26, 31, 46, 0.9)', borderRadius: 2, border: '1px solid rgba(0, 212, 255, 0.3)' }}>
                <Tooltip title="缩小 (-)"><span>
                  <IconButton size="small" onClick={() => { try { reactFlowInstance?.zoomOut({ duration: 200 }); } catch {} }} sx={{ color: 'rgba(255,255,255,0.8)' }}>−</IconButton>
                </span></Tooltip>
                <Typography variant="caption" sx={{ minWidth: 48, textAlign: 'center', color: 'rgba(255,255,255,0.8)' }}>{Math.round(zoom * 100)}%</Typography>
                <Tooltip title="放大 (+)"><span>
                  <IconButton size="small" onClick={() => { try { reactFlowInstance?.zoomIn({ duration: 200 }); } catch {} }} sx={{ color: 'rgba(255,255,255,0.8)' }}>+</IconButton>
                </span></Tooltip>
                <Divider flexItem orientation="vertical" sx={{ borderColor: 'rgba(0, 212, 255, 0.3)' }} />
                <Tooltip title={`网格 ${showGrid ? '开' : '关'} (G)`}><span>
                  <Button size="small" variant={showGrid ? 'contained' : 'outlined'} onClick={() => setShowGrid(v => !v)}>Grid</Button>
                </span></Tooltip>
                <Tooltip title={`吸附 ${snap ? '开' : '关'} (S)`}><span>
                  <Button size="small" variant={snap ? 'contained' : 'outlined'} onClick={() => setSnap(v => !v)}>Snap</Button>
                </span></Tooltip>
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
              workflowId={persistedWorkflowId}
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

        {/* 节点配置右侧抽屉 */}
        <NodeConfigPanel
          key={selectedNode?.id || 'none'}
          open={nodeConfigOpen}
          node={selectedNode}
          nodes={nodes as any}
          edges={edges as any}
          onClose={() => setNodeConfigOpen(false)}
          onSave={(config) => {
            if (!selectedNode) return;
            setNodes((nds) => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, config } } : n));
            showSnackbar('节点配置已保存', 'success');
          }}
        />

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
      {/* 全局 Snackbar 提示 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
      {/* 仅在工作流编辑页显示聊天测试小窗 */}
      <ChatTesterWidget 
        workflowId={persistedWorkflowId}
        onEnsureSaved={handleSave}
        onProgress={updateRunProgress}
        onComplete={handleRunComplete}
        onError={handleRunError}
      />
    </Box>
    </ReactFlowProvider>
  );
};

export default WorkflowEditor;
