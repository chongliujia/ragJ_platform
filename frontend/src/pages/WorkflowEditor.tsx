import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircle as ValidateIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ViewModule as ViewModuleIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  Save as SaveIcon,
  Science as TestIcon,
  Refresh as ResetIcon,
  FileCopy as TemplateIcon,
} from '@mui/icons-material';
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { knowledgeBaseApi, workflowApi } from '../services/api';
import { modelConfigApi } from '../services/modelConfigApi';
import WorkflowNode from '../components/workflow2/WorkflowNode';
import NodePalette from '../components/workflow2/NodePalette';
import DifyNodeInspector from '../components/workflow2/DifyNodeInspector';
import EdgeInspector from '../components/workflow2/EdgeInspector';
import { NODE_TEMPLATES } from '../components/workflow2/nodeTemplates';
import type { WorkflowEdgeData, WorkflowNodeData, WorkflowNodeKind } from '../components/workflow2/types';
import { WORKFLOW_NODE_TYPE, toBackendEdges, toBackendNodes, toReactFlowEdges, toReactFlowNodes } from '../components/workflow2/serde';

function genId(prefix: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const uuid = (crypto as any)?.randomUUID?.();
    if (uuid) return `${prefix}_${uuid}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const nodeTypes = {
  [WORKFLOW_NODE_TYPE]: WorkflowNode,
};

const DEFAULT_WORKFLOW_NAME = '新工作流';
const HEADER_EXPANDED_KEY = 'ragj_workflow_editor_header_expanded';
const PALETTE_OPEN_KEY = 'ragj_workflow_editor_palette_open';
const PALETTE_WIDTH_KEY = 'ragj_workflow_editor_palette_width';
const PALETTE_SCALE_KEY = 'ragj_workflow_editor_palette_scale';

function defaultGraph(): { nodes: Node<WorkflowNodeData>[]; edges: Edge<WorkflowEdgeData>[] } {
  const inputId = genId('n');
  const llmId = genId('n');
  const outputId = genId('n');
  return {
    nodes: [
      {
        id: inputId,
        type: WORKFLOW_NODE_TYPE,
        position: { x: 0, y: 80 },
        data: { kind: 'input', name: '输入', description: '执行输入', config: {} },
      },
      {
        id: llmId,
        type: WORKFLOW_NODE_TYPE,
        position: { x: 300, y: 80 },
        data: {
          kind: 'llm',
          name: 'LLM',
          description: '生成回复',
          config: { model: '', temperature: 0.7, max_tokens: 1000, system_prompt: '' },
        },
      },
      {
        id: outputId,
        type: WORKFLOW_NODE_TYPE,
        position: { x: 600, y: 80 },
        data: { kind: 'output', name: '输出', description: '格式化输出', config: { format: 'json', template: '' } },
      },
    ],
    edges: [
      {
        id: genId('e'),
        source: inputId,
        target: llmId,
        type: 'default',
        sourceHandle: 'input',
        targetHandle: 'input',
        data: { source_output: 'input', target_input: 'input' },
      },
      {
        id: genId('e'),
        source: llmId,
        target: outputId,
        type: 'default',
        sourceHandle: 'content',
        targetHandle: 'data',
        data: { source_output: 'content', target_input: 'data' },
      },
    ],
  };
}

const WorkflowEditor: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);

  const [name, setName] = useState(DEFAULT_WORKFLOW_NAME);
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const focusNodeId = useMemo(() => {
    const sp = new URLSearchParams(location.search || '');
    return sp.get('node');
  }, [location.search]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) || null,
    [edges, selectedEdgeId]
  );

  const inputsForKind = useCallback((kind?: WorkflowNodeKind): string[] => {
    switch (kind) {
      case 'llm':
        return ['data', 'prompt', 'input', 'documents'];
      case 'rag_retriever':
        return ['data', 'query', 'input'];
      case 'http_request':
        return ['data', 'url'];
      case 'condition':
        return ['data', 'value', 'input'];
      case 'code_executor':
        return ['data', 'input'];
      case 'output':
        return ['data', 'input'];
      case 'input':
      default:
        return [];
    }
  }, []);

  const outputsForKind = useCallback((kind?: WorkflowNodeKind): string[] => {
    switch (kind) {
      case 'input':
        return ['data', 'input', 'prompt', 'query', 'text'];
      case 'llm':
        return ['content', 'metadata'];
      case 'rag_retriever':
        return ['documents', 'query', 'total_results'];
      case 'http_request':
        return ['response_data', 'status_code', 'success', 'headers'];
      case 'condition':
        return ['condition_result', 'data'];
      case 'code_executor':
        return ['result', 'stdout'];
      case 'output':
        return ['result'];
      default:
        return ['data'];
    }
  }, []);

  const [knowledgeBases, setKnowledgeBases] = useState<string[]>([]);
  const [availableChatModels, setAvailableChatModels] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateCategory, setTemplateCategory] = useState('custom');
  const [templateTags, setTemplateTags] = useState('');
  const [templateIsPublic, setTemplateIsPublic] = useState(false);

  const [validation, setValidation] = useState<null | {
    is_valid: boolean;
    errors: string[];
    warnings: string[];
    suggestions: string[];
  }>(null);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [paletteWidth, setPaletteWidth] = useState(280);
  const [paletteScale, setPaletteScale] = useState(1);
  const paletteResizeRef = useRef<null | { startX: number; startWidth: number }>(null);

  const resetToDefault = useCallback(() => {
    const g = defaultGraph();
    setNodes(g.nodes);
    setEdges(g.edges);
    setSelectedNodeId(null);
    setValidation(null);
  }, [setEdges, setNodes]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(HEADER_EXPANDED_KEY);
      if (v === '1') setHeaderExpanded(true);
      if (v === '0') setHeaderExpanded(false);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const open = localStorage.getItem(PALETTE_OPEN_KEY);
      if (open === '0') setPaletteOpen(false);
      if (open === '1') setPaletteOpen(true);
      const w = Number(localStorage.getItem(PALETTE_WIDTH_KEY));
      if (Number.isFinite(w) && w >= 220 && w <= 520) setPaletteWidth(w);
      const s = Number(localStorage.getItem(PALETTE_SCALE_KEY));
      if (Number.isFinite(s) && s >= 0.8 && s <= 1.2) setPaletteScale(s);
    } catch {
      // ignore
    }
  }, []);

  const toggleHeader = useCallback(() => {
    setHeaderExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HEADER_EXPANDED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const togglePalette = useCallback(() => {
    setPaletteOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PALETTE_OPEN_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const bumpPaletteScale = useCallback((delta: number) => {
    setPaletteScale((prev) => {
      const next = Math.max(0.8, Math.min(1.2, Math.round((prev + delta) * 100) / 100));
      try {
        localStorage.setItem(PALETTE_SCALE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!paletteResizeRef.current) return;
      const dx = e.clientX - paletteResizeRef.current.startX;
      const next = Math.max(220, Math.min(520, paletteResizeRef.current.startWidth + dx));
      setPaletteWidth(next);
    };
    const onUp = () => {
      if (!paletteResizeRef.current) return;
      paletteResizeRef.current = null;
      try {
        localStorage.setItem(PALETTE_WIDTH_KEY, String(paletteWidth));
      } catch {
        // ignore
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [paletteWidth]);

  useEffect(() => {
    // 初始化节点库/模型列表
    (async () => {
      try {
        const kbRes = await knowledgeBaseApi.getList();
        const kbs = (kbRes.data || []).map((x: any) => x?.name || x?.id).filter(Boolean);
        setKnowledgeBases(Array.from(new Set(kbs)));
      } catch {
        setKnowledgeBases([]);
      }

      try {
        const res = await modelConfigApi.getAvailableChatModels();
        const models = (res.data?.models || []).map((m: any) => m?.model_name).filter(Boolean);
        setAvailableChatModels(Array.from(new Set(models)));
      } catch {
        setAvailableChatModels([]);
      }
    })();
  }, []);

  useEffect(() => {
    // 加载工作流 / 新建初始化
    (async () => {
      setValidation(null);
      setSelectedNodeId(null);
      if (!id) {
        setName(DEFAULT_WORKFLOW_NAME);
        setDescription('');
        setIsPublic(false);
        resetToDefault();
        return;
      }

      setBusy(true);
      try {
        const res = await workflowApi.getDetail(id);
        const wf = res.data || {};
        setName(wf.name || DEFAULT_WORKFLOW_NAME);
        setDescription(wf.description || '');
        setIsPublic(!!wf.is_public);
        setNodes(toReactFlowNodes(wf.nodes || []));
        setEdges(toReactFlowEdges(wf.edges || []));
      } catch (e: any) {
        setSnack({ type: 'error', message: e?.response?.data?.detail || '加载工作流失败' });
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!focusNodeId) return;
    if (nodes.some((n) => n.id === focusNodeId)) {
      setSelectedNodeId(focusNodeId);
      setSelectedEdgeId(null);
    }
  }, [focusNodeId, nodes]);

  const serialize = useCallback(() => {
    return {
      name: name || DEFAULT_WORKFLOW_NAME,
      description: description || '',
      nodes: toBackendNodes(nodes),
      edges: toBackendEdges(edges),
      global_config: {},
      is_public: !!isPublic,
    };
  }, [description, edges, isPublic, name, nodes]);

  const openSaveAsTemplate = useCallback(() => {
    setTemplateName(name || DEFAULT_WORKFLOW_NAME);
    setTemplateDescription(description || '');
    setTemplateCategory('custom');
    setTemplateTags('');
    setTemplateIsPublic(false);
    setTemplateDialogOpen(true);
  }, [description, name]);

  const saveAsTemplate = useCallback(async () => {
    const tname = (templateName || '').trim();
    if (!tname) {
      setSnack({ type: 'error', message: '模板名称不能为空' });
      return;
    }
    setBusy(true);
    try {
      const payload = serialize();
      const tags = templateTags
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      await workflowApi.createTemplate({
        name: tname,
        description: templateDescription || '',
        category: templateCategory || 'custom',
        tags,
        nodes: payload.nodes,
        edges: payload.edges,
        is_public: !!templateIsPublic,
      });
      setTemplateDialogOpen(false);
      setSnack({ type: 'success', message: '模板已保存' });
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || '保存模板失败' });
    } finally {
      setBusy(false);
    }
  }, [serialize, templateCategory, templateDescription, templateIsPublic, templateName, templateTags]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      const isCondition = sourceNode?.data?.kind === 'condition';
      const defaultSourceHandle = () => {
        const kind = sourceNode?.data?.kind;
        switch (kind) {
          case 'input':
            return 'input';
          case 'llm':
            return 'content';
          case 'rag_retriever':
            return 'documents';
          case 'http_request':
            return 'response_data';
          case 'code_executor':
            return 'result';
          case 'condition':
            return 'data';
          case 'output':
          default:
            return 'output';
        }
      };
      const defaultTargetHandle = () => {
        const kind = targetNode?.data?.kind;
        switch (kind) {
          case 'llm':
            return 'input';
          case 'rag_retriever':
            return 'query';
          case 'http_request':
            return 'url';
          case 'condition':
            return 'value';
          case 'code_executor':
            return 'input';
          case 'output':
            return 'data';
          case 'input':
          default:
            return 'input';
        }
      };

      const sh = connection.sourceHandle || defaultSourceHandle();
      const th = connection.targetHandle || defaultTargetHandle();

      let edgeData: WorkflowEdgeData = {
        source_output: sh,
        target_input: th,
      };
      const edge: any = {
        ...connection,
        id: genId('e'),
        type: 'default',
        sourceHandle: sh,
        targetHandle: th,
      };

      // Branching: connect from condition node's virtual handles true/false
      if (isCondition && (sh === 'true' || sh === 'false')) {
        edgeData = {
          // condition node executor outputs `data` (passthrough payload) and `condition_result`
          source_output: 'data',
          target_input: 'data',
          condition: sh === 'true' ? 'value["condition_result"] == True' : 'value["condition_result"] == False',
        };
        edge.label = sh.toUpperCase();
      }

      edge.data = edgeData;
      setEdges((eds) => addEdge(edge, eds));
    },
    [nodes, setEdges]
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind, position?: { x: number; y: number }) => {
      const tpl = NODE_TEMPLATES.find((t) => t.kind === kind);
      const base = tpl?.defaultConfig || {};
      const next: Node<WorkflowNodeData> = {
        id: genId('n'),
        type: WORKFLOW_NODE_TYPE,
        position: position || { x: 0, y: 0 },
        data: {
          kind,
          name: tpl?.name || kind,
          description: tpl?.description || '',
          config: base,
        },
      };
      setNodes((ns) => ns.concat(next));
      setSelectedNodeId(next.id);
      setValidation(null);
    },
    [setNodes]
  );

  const addAtCenter = useCallback(
    (kind: WorkflowNodeKind) => {
      if (!rf || !wrapperRef.current) {
        addNode(kind, { x: 0, y: 0 });
        return;
      }
      const rect = wrapperRef.current.getBoundingClientRect();
      const vp = rf.getViewport();
      const center = {
        x: (-vp.x + rect.width / 2) / vp.zoom,
        y: (-vp.y + rect.height / 2) / vp.zoom,
      };
      addNode(kind, center);
    },
    [addNode, rf]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!rf || !wrapperRef.current) return;
      const raw = event.dataTransfer.getData('application/ragj-workflow-node');
      if (!raw) return;
      let kind: WorkflowNodeKind | null = null;
      try {
        kind = JSON.parse(raw)?.kind as WorkflowNodeKind;
      } catch {
        kind = null;
      }
      if (!kind) return;

      const rect = wrapperRef.current.getBoundingClientRect();
      const position = rf.project({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      addNode(kind, position);
    },
    [addNode, rf]
  );

  const updateSelectedNode = useCallback(
    (patch: Partial<WorkflowNodeData>) => {
      if (!selectedNodeId) return;
      setNodes((ns) =>
        ns.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n))
      );
      setValidation(null);
    },
    [selectedNodeId, setNodes]
  );

  const updateEdgeById = useCallback(
    (edgeId: string, patch: Partial<WorkflowEdgeData>) => {
      setEdges((es) =>
        es.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                sourceHandle: (patch as any)?.source_output ?? e.sourceHandle,
                targetHandle: (patch as any)?.target_input ?? e.targetHandle,
                data: { ...(e.data || {}), ...patch },
              }
            : e
        )
      );
      setValidation(null);
    },
    [setEdges]
  );

  const closeInspector = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    // Unselect in ReactFlow state (prevents panel immediately re-opening).
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
  }, [setEdges, setNodes]);

  const createBranchesForSelectedCondition = useCallback(() => {
    if (!selectedNodeId) return;
    const base = nodes.find((n) => n.id === selectedNodeId);
    if (!base || base.data.kind !== 'condition') return;

    // Avoid duplicate branch edges
    const hasTrue = edges.some(
      (e) => e.source === base.id && (e.label === 'TRUE' || e.data?.condition === 'value[\"condition_result\"] == True')
    );
    const hasFalse = edges.some(
      (e) => e.source === base.id && (e.label === 'FALSE' || e.data?.condition === 'value[\"condition_result\"] == False')
    );

    const x = base.position.x + 320;
    const y = base.position.y;

    const newNodes: Node<WorkflowNodeData>[] = [];
    const newEdges: Edge<WorkflowEdgeData>[] = [];

    const makeBranch = (which: 'true' | 'false', dy: number) => {
      const id = genId('n');
      newNodes.push({
        id,
        type: WORKFLOW_NODE_TYPE,
        position: { x, y: y + dy },
        data: {
          kind: 'code_executor',
          name: which === 'true' ? 'TRUE 分支' : 'FALSE 分支',
          description: '分支占位节点（可替换为任意节点）',
          config: { language: 'python', code: 'result = input_data' },
        },
      });

      newEdges.push({
        id: genId('e'),
        source: base.id,
        target: id,
        sourceHandle: which,
        targetHandle: 'data',
        type: 'default',
        label: which.toUpperCase(),
        data: {
          source_output: 'data',
          target_input: 'data',
          condition:
            which === 'true'
              ? 'value["condition_result"] == True'
              : 'value["condition_result"] == False',
        },
      });
    };

    if (!hasTrue) makeBranch('true', -120);
    if (!hasFalse) makeBranch('false', 120);

    if (newNodes.length === 0) {
      setSnack({ type: 'info', message: '已存在 True/False 分支，无需重复生成' });
      return;
    }

    setNodes((ns) => ns.concat(newNodes));
    setEdges((es) => es.concat(newEdges));
    setValidation(null);
  }, [edges, nodes, selectedNodeId, setEdges, setNodes]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
    setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
    setValidation(null);
  }, [selectedNodeId, setEdges, setNodes]);

  const validate = useCallback(async () => {
    setBusy(true);
    try {
      const payload = serialize();
      const res = await workflowApi.validate(payload as any);
      setValidation(res.data);
      setSnack({ type: res.data?.is_valid ? 'success' : 'error', message: res.data?.is_valid ? '校验通过' : '校验失败' });
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || '校验失败' });
    } finally {
      setBusy(false);
    }
  }, [serialize]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const payload = serialize();
      if (id) {
        await workflowApi.update(id, payload as any);
        setSnack({ type: 'success', message: '已保存' });
      } else {
        const res = await workflowApi.create(payload as any);
        const newId = res.data?.id;
        if (newId) {
          navigate(`/workflows/${newId}/edit`, { replace: true });
          setSnack({ type: 'success', message: '已创建并保存' });
        } else {
          setSnack({ type: 'success', message: '已创建' });
        }
      }
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || '保存失败' });
    } finally {
      setBusy(false);
    }
  }, [id, navigate, serialize]);

  const goTest = useCallback(async () => {
    // Ensure tester runs the latest graph (avoid “改了没保存，测试没反应/还是旧流程”)
    setBusy(true);
    try {
      const payload = serialize();
      let workflowId = id || null;
      if (workflowId) {
        await workflowApi.update(workflowId, payload as any);
      } else {
        const res = await workflowApi.create(payload as any);
        workflowId = res.data?.id || null;
      }
      if (!workflowId) {
        setSnack({ type: 'error', message: '保存失败：未获取到工作流 ID' });
        return;
      }
      setSnack({ type: 'success', message: '已保存，进入测试' });
      navigate(`/workflows/${workflowId}/test`);
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || '保存失败，无法进入测试' });
    } finally {
      setBusy(false);
    }
  }, [id, navigate, serialize]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Paper variant="outlined" sx={{ p: 1.25, flexShrink: 0 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
            <Tooltip title={headerExpanded ? '收起工作流设置' : '展开工作流设置'}>
              <IconButton size="small" onClick={toggleHeader} aria-label="切换工作流设置展开">
                <ExpandMoreIcon
                  fontSize="small"
                  sx={{
                    transform: headerExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 120ms ease',
                  }}
                />
              </IconButton>
            </Tooltip>
            <Typography variant="subtitle1" sx={{ fontWeight: 900, whiteSpace: 'nowrap' }}>
              工作流
            </Typography>
            <TextField
              size="small"
              label="名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
          </Stack>

          <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
            <Button
              variant="outlined"
              startIcon={<ResetIcon />}
              onClick={resetToDefault}
              disabled={busy}
              size="small"
            >
              重置画布
            </Button>
            <Button
              variant="outlined"
              startIcon={<ValidateIcon />}
              onClick={validate}
              disabled={busy}
              size="small"
            >
              校验
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={save}
              disabled={busy}
              size="small"
            >
              保存
            </Button>
            <Button
              variant="outlined"
              startIcon={<TestIcon />}
              onClick={goTest}
              disabled={busy}
              size="small"
            >
              测试
            </Button>
            <Button
              variant="outlined"
              startIcon={<TemplateIcon />}
              onClick={openSaveAsTemplate}
              disabled={busy}
              size="small"
            >
              保存为模板
            </Button>
          </Stack>
        </Stack>

        <Collapse in={headerExpanded} timeout={150} unmountOnExit>
          <Box sx={{ mt: 1.25 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <TextField
                size="small"
                label="描述"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
              />
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={isPublic}
                      onChange={(_e, checked) => setIsPublic(checked)}
                      disabled={busy}
                      size="small"
                    />
                  }
                  label={isPublic ? '公开给团队' : '仅自己可见'}
                />
              </Box>
            </Stack>

            {validation && (
              <Box sx={{ mt: 1.25 }}>
                <Alert severity={validation.is_valid ? 'success' : 'error'}>
                  {validation.is_valid ? '校验通过' : '校验失败'}
                  {!!validation.errors?.length && (
                    <Box component="ul" sx={{ m: 0.5, pl: 2 }}>
                      {validation.errors.slice(0, 5).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </Box>
                  )}
                </Alert>
              </Box>
            )}
          </Box>
        </Collapse>
      </Paper>

      <Divider sx={{ my: 1.5 }} />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr' },
          gap: 2,
        }}
      >
        <Paper
          ref={wrapperRef}
          variant="outlined"
          sx={{ position: 'relative', minHeight: 0, overflow: 'hidden' }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setRf}
            nodeTypes={nodeTypes}
            onSelectionChange={(sel) => {
              const id = sel.nodes?.[0]?.id || null;
              setSelectedNodeId(id);
              setSelectedEdgeId(sel.edges?.[0]?.id || null);
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>

          {/* Floating node palette (Dify-like): does not shrink canvas */}
          <Box
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              bottom: 12,
              zIndex: 18,
              pointerEvents: 'none',
            }}
          >
            {paletteOpen ? (
              <Paper
                variant="outlined"
                sx={{
                  width: paletteWidth,
                  height: '100%',
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  pointerEvents: 'auto',
                }}
              >
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 1, py: 0.75 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 900, flex: 1 }}>
                    节点库
                  </Typography>
                  <Tooltip title="缩小">
                    <IconButton size="small" onClick={() => bumpPaletteScale(-0.05)}>
                      <ZoomOutIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="放大">
                    <IconButton size="small" onClick={() => bumpPaletteScale(0.05)}>
                      <ZoomInIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="折叠">
                    <IconButton size="small" onClick={togglePalette} aria-label="折叠节点库">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Divider />
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <Box
                    sx={{
                      transform: `scale(${paletteScale})`,
                      transformOrigin: 'top left',
                      width: `${100 / paletteScale}%`,
                    }}
                  >
                    <NodePalette templates={NODE_TEMPLATES} onAddClick={(k) => addAtCenter(k)} embedded />
                  </Box>
                </Box>
                {/* Resize handle */}
                <Box
                  onPointerDown={(e) => {
                    paletteResizeRef.current = { startX: e.clientX, startWidth: paletteWidth };
                    try {
                      (e.currentTarget as any).setPointerCapture?.(e.pointerId);
                    } catch {
                      // ignore
                    }
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: 8,
                    height: '100%',
                    cursor: 'col-resize',
                    bgcolor: 'transparent',
                  }}
                />
              </Paper>
            ) : (
              <Tooltip title="打开节点库">
                <IconButton
                  size="small"
                  onClick={togglePalette}
                  sx={{
                    pointerEvents: 'auto',
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'background.paper' },
                  }}
                  aria-label="打开节点库"
                >
                  <ViewModuleIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              display: { xs: 'flex', md: 'none' },
              gap: 1,
              flexWrap: 'wrap',
              zIndex: 10,
            }}
          >
            {NODE_TEMPLATES.slice(0, 6).map((t) => (
              <Button key={t.kind} size="small" variant="outlined" onClick={() => addAtCenter(t.kind)}>
                + {t.name}
              </Button>
            ))}
          </Box>

          {(selectedNode || selectedEdge) && (
            <Box
              sx={{
                position: 'absolute',
                top: 12,
                right: 12,
                bottom: 12,
                width: { xs: 'calc(100% - 24px)', sm: 420, md: 380 },
                maxWidth: '92vw',
                zIndex: 20,
              }}
            >
              <Box sx={{ position: 'relative', height: '100%' }}>
                <IconButton
                  size="small"
                  onClick={closeInspector}
                  sx={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    zIndex: 30,
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'background.paper' },
                  }}
                  aria-label="关闭属性面板"
                >
                  <CloseIcon fontSize="small" />
                </IconButton>

                {selectedNode ? (
                  <DifyNodeInspector
                    node={selectedNode}
                    onChange={updateSelectedNode}
                    onDelete={deleteSelectedNode}
                    onCreateBranches={selectedNode.data.kind === 'condition' ? createBranchesForSelectedCondition : undefined}
                    onUpdateEdge={updateEdgeById}
                    knowledgeBases={knowledgeBases}
                    availableChatModels={availableChatModels}
                    allNodes={nodes}
                    allEdges={edges}
                  />
                ) : (
                  <EdgeInspector
                    edge={selectedEdge}
                    sourceName={
                      selectedEdge
                        ? nodes.find((n) => n.id === selectedEdge.source)?.data?.name
                        : undefined
                    }
                    targetName={
                      selectedEdge
                        ? nodes.find((n) => n.id === selectedEdge.target)?.data?.name
                        : undefined
                    }
                    sourceOutputs={(() => {
                      const src = selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) : null;
                      return outputsForKind(src?.data?.kind);
                    })()}
                    targetInputs={(() => {
                      const tgt = selectedEdge ? nodes.find((n) => n.id === selectedEdge.target) : null;
                      return inputsForKind(tgt?.data?.kind);
                    })()}
                    onChange={(patch) => {
                      if (!selectedEdgeId) return;
                      setEdges((es) =>
                        es.map((e) =>
                          e.id === selectedEdgeId
                            ? {
                                ...e,
                                sourceHandle: (patch as any)?.source_output ?? e.sourceHandle,
                                targetHandle: (patch as any)?.target_input ?? e.targetHandle,
                                data: { ...(e.data || {}), ...patch },
                              }
                            : e
                        )
                      );
                      setValidation(null);
                    }}
                    onDelete={() => {
                      if (!selectedEdgeId) return;
                      setEdges((es) => es.filter((e) => e.id !== selectedEdgeId));
                      setSelectedEdgeId(null);
                      setValidation(null);
                    }}
                  />
                )}
              </Box>
            </Box>
          )}
        </Paper>
      </Box>

      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        message={snack?.message || ''}
      />

      <Dialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>保存为模板</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
          <TextField
            label="模板名称"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="模板描述"
            value={templateDescription}
            onChange={(e) => setTemplateDescription(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
          <TextField
            label="分类（可选）"
            value={templateCategory}
            onChange={(e) => setTemplateCategory(e.target.value)}
            fullWidth
            size="small"
            helperText="例如 customer_service / document_processing / ai_assistant / data_analysis / custom"
          />
          <TextField
            label="标签（逗号分隔，可选）"
            value={templateTags}
            onChange={(e) => setTemplateTags(e.target.value)}
            fullWidth
            size="small"
            placeholder="RAG, 客服, 数据分析"
          />
          <FormControlLabel
            control={
              <Switch
                checked={templateIsPublic}
                onChange={(_e, checked) => setTemplateIsPublic(checked)}
                size="small"
              />
            }
            label={templateIsPublic ? '公开给团队' : '仅自己可见'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialogOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={saveAsTemplate} variant="contained" disabled={busy}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkflowEditor;
