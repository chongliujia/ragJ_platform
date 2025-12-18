import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  ContentCopy as CopyIcon,
  Key as KeyIcon,
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
  MiniMap,
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
import { resolvePublicApiBaseUrl } from '../utils/publicApi';
import type { TFunction } from 'i18next';

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

const HEADER_EXPANDED_KEY = 'ragj_workflow_editor_header_expanded';
const PALETTE_OPEN_KEY = 'ragj_workflow_editor_palette_open';
const PALETTE_WIDTH_KEY = 'ragj_workflow_editor_palette_width';
const PALETTE_SCALE_KEY = 'ragj_workflow_editor_palette_scale';

function defaultGraph(t: TFunction): { nodes: Node<WorkflowNodeData>[]; edges: Edge<WorkflowEdgeData>[] } {
  const inputId = genId('n');
  const llmId = genId('n');
  const outputId = genId('n');
  return {
    nodes: [
      {
        id: inputId,
        type: WORKFLOW_NODE_TYPE,
        position: { x: 0, y: 80 },
        data: { kind: 'input', name: t('workflow2.nodes.input.name'), description: t('workflow2.nodes.input.description'), config: {} },
      },
      {
        id: llmId,
        type: WORKFLOW_NODE_TYPE,
        position: { x: 300, y: 80 },
        data: {
          kind: 'llm',
          name: t('workflow2.nodes.llm.name'),
          description: t('workflow2.nodes.llm.description'),
          config: { model: '', temperature: 0.7, max_tokens: 1000, system_prompt: '' },
        },
      },
      {
        id: outputId,
        type: WORKFLOW_NODE_TYPE,
        position: { x: 600, y: 80 },
        data: { kind: 'output', name: t('workflow2.nodes.output.name'), description: t('workflow2.nodes.output.description'), config: { format: 'json', template: '' } },
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
  const { t } = useTranslation();

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);

  const [name, setName] = useState(() => t('workflowEditor.defaultName'));
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<WorkflowNodeData>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<WorkflowEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

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

  const sameIdList = useCallback((a: string[], b: string[]) => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }, []);

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
  const [dirty, setDirty] = useState(false);
  const [testConfirmOpen, setTestConfirmOpen] = useState(false);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
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
  const publicApiBaseUrl = useMemo(() => resolvePublicApiBaseUrl(), []);

  const onNodesChange = useCallback(
    (changes: any[]) => {
      const meaningful = (changes || []).some((c) => c?.type && c.type !== 'select');
      if (meaningful) setDirty(true);
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase]
  );

  const onEdgesChange = useCallback(
    (changes: any[]) => {
      const meaningful = (changes || []).some((c) => c?.type && c.type !== 'select');
      if (meaningful) setDirty(true);
      onEdgesChangeBase(changes);
    },
    [onEdgesChangeBase]
  );

  const resetToDefault = useCallback(() => {
    const g = defaultGraph(t);
    setNodes(g.nodes);
    setEdges(g.edges);
    setSelectedNodeId(null);
    setDirty(true);
    setValidation(null);
  }, [setEdges, setNodes, t]);

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
        setName(t('workflowEditor.defaultName'));
        setDescription('');
        setIsPublic(false);
        resetToDefault();
        return;
      }

      setBusy(true);
      try {
        const res = await workflowApi.getDetail(id);
        const wf = res.data || {};
        setName(wf.name || t('workflowEditor.defaultName'));
        setDescription(wf.description || '');
        setIsPublic(!!wf.is_public);
        setNodes(toReactFlowNodes(wf.nodes || []));
        setEdges(toReactFlowEdges(wf.edges || []));
        setDirty(false);
      } catch (e: any) {
        setSnack({ type: 'error', message: e?.response?.data?.detail || t('workflowEditor.messages.loadFailed') });
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!focusNodeId) return;
    const exists = nodes.some((n) => n.id === focusNodeId);
    if (!exists) return;

    const nodesAlreadySelected = nodes.every((n) => {
      const selected = !!(n as any).selected;
      return selected === (n.id === focusNodeId);
    });
    if (!nodesAlreadySelected) {
      setNodes((ns) =>
        ns.map((n) => ({
          ...n,
          selected: n.id === focusNodeId,
        }))
      );
    }

    if (edges.some((e) => !!(e as any).selected)) {
      setEdges((es) => es.map((e) => ({ ...e, selected: false })));
    }

    setSelectedNodeId(focusNodeId);
    setSelectedEdgeId(null);
    setSelectedNodeIds([focusNodeId]);
    setSelectedEdgeIds([]);
  }, [edges, focusNodeId, nodes, setEdges, setNodes]);

  const serialize = useCallback(() => {
    return {
      name: name || t('workflowEditor.defaultName'),
      description: description || '',
      nodes: toBackendNodes(nodes),
      edges: toBackendEdges(edges),
      global_config: {},
      is_public: !!isPublic,
    };
  }, [description, edges, isPublic, name, nodes, t]);

  const openSaveAsTemplate = useCallback(() => {
    setTemplateName(name || t('workflowEditor.defaultName'));
    setTemplateDescription(description || '');
    setTemplateCategory('custom');
    setTemplateTags('');
    setTemplateIsPublic(false);
    setTemplateDialogOpen(true);
  }, [description, name, t]);

  const saveAsTemplate = useCallback(async () => {
    const tname = (templateName || '').trim();
    if (!tname) {
      setSnack({ type: 'error', message: t('workflowEditor.templates.nameRequired') });
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
      setSnack({ type: 'success', message: t('workflowEditor.templates.saved') });
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || t('workflowEditor.templates.saveFailed') });
    } finally {
      setBusy(false);
    }
  }, [serialize, t, templateCategory, templateDescription, templateIsPublic, templateName, templateTags]);

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
      setDirty(true);
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
          name: tpl ? t(tpl.nameKey) : kind,
          description: tpl ? t(tpl.descriptionKey) : '',
          config: base,
        },
      };
      setNodes((ns) => ns.concat(next));
      setSelectedNodeId(next.id);
      setDirty(true);
      setValidation(null);
    },
    [setNodes, t]
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
      setDirty(true);
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
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
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
          name: which === 'true' ? t('workflowEditor.branches.trueName') : t('workflowEditor.branches.falseName'),
          description: t('workflowEditor.branches.placeholderDescription'),
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
      setSnack({ type: 'info', message: t('workflowEditor.branches.alreadyExists') });
      return;
    }

    setNodes((ns) => ns.concat(newNodes));
    setEdges((es) => es.concat(newEdges));
    setDirty(true);
    setValidation(null);
  }, [edges, nodes, selectedNodeId, setEdges, setNodes, t]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
    setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
    setSelectedNodeIds((ids) => ids.filter((x) => x !== selectedNodeId));
    setDirty(true);
    setValidation(null);
  }, [selectedNodeId, setEdges, setNodes]);

  const validate = useCallback(async () => {
    setBusy(true);
    try {
      const payload = serialize();
      const res = await workflowApi.validate(payload as any);
      setValidation(res.data);
      setSnack({
        type: res.data?.is_valid ? 'success' : 'error',
        message: res.data?.is_valid ? t('workflowEditor.validation.valid') : t('workflowEditor.validation.invalid'),
      });
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || t('workflowEditor.validation.failed') });
    } finally {
      setBusy(false);
    }
  }, [serialize, t]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const payload = serialize();
      if (id) {
        await workflowApi.update(id, payload as any);
        setDirty(false);
        setSnack({ type: 'success', message: t('workflowEditor.messages.saved') });
      } else {
        const res = await workflowApi.create(payload as any);
        const newId = res.data?.id;
        if (newId) {
          setDirty(false);
          navigate(`/workflows/${newId}/edit`, { replace: true });
          setSnack({ type: 'success', message: t('workflowEditor.messages.createdAndSaved') });
        } else {
          setSnack({ type: 'success', message: t('workflowEditor.messages.created') });
        }
      }
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || t('workflowEditor.messages.saveFailed') });
    } finally {
      setBusy(false);
    }
  }, [id, navigate, serialize, t]);

  const saveAndEnterTest = useCallback(async () => {
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
        setSnack({ type: 'error', message: t('workflowEditor.messages.saveMissingId') });
        return;
      }
      setDirty(false);
      setSnack({ type: 'success', message: t('workflowEditor.messages.savedEnterTest') });
      navigate(`/workflows/${workflowId}/test`);
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || t('workflowEditor.messages.saveEnterTestFailed') });
    } finally {
      setBusy(false);
    }
  }, [id, navigate, serialize, t]);

  const goTest = useCallback(async () => {
    // Fast path: saved workflow without changes -> enter immediately.
    if (id && !dirty) {
      navigate(`/workflows/${id}/test`);
      return;
    }
    // Existing workflow with unsaved changes -> ask before saving.
    if (id && dirty) {
      setTestConfirmOpen(true);
      return;
    }
    // New workflow -> must create first.
    await saveAndEnterTest();
  }, [dirty, id, navigate, saveAndEnterTest]);

  const autoLayout = useCallback(() => {
    // Simple DAG layout (no extra deps): layer by longest-path depth.
    const nodeIds = nodes.map((n) => n.id);
    const idSet = new Set(nodeIds);
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const id of nodeIds) {
      incoming.set(id, []);
      outgoing.set(id, []);
    }
    for (const e of edges) {
      if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
      incoming.get(e.target)!.push(e.source);
      outgoing.get(e.source)!.push(e.target);
    }

    const indeg = new Map<string, number>();
    for (const id of nodeIds) indeg.set(id, incoming.get(id)!.length);

    const q: string[] = [];
    for (const id of nodeIds) if ((indeg.get(id) || 0) === 0) q.push(id);
    // Fallback: if cycle, just keep existing order.
    if (q.length === 0) return;

    const topo: string[] = [];
    while (q.length) {
      const cur = q.shift()!;
      topo.push(cur);
      for (const nxt of outgoing.get(cur) || []) {
        indeg.set(nxt, (indeg.get(nxt) || 0) - 1);
        if ((indeg.get(nxt) || 0) === 0) q.push(nxt);
      }
    }

    const level = new Map<string, number>();
    for (const id of topo) {
      const preds = incoming.get(id) || [];
      const maxPred = preds.reduce((m, p) => Math.max(m, level.get(p) || 0), 0);
      level.set(id, preds.length ? maxPred + 1 : 0);
    }

    const byLevel = new Map<number, Node<WorkflowNodeData>[]>();
    for (const n of nodes) {
      const lv = level.get(n.id);
      if (lv == null) continue;
      const list = byLevel.get(lv) || [];
      list.push(n);
      byLevel.set(lv, list);
    }
    for (const list of byLevel.values()) {
      list.sort((a, b) => a.position.y - b.position.y);
    }

    const X_GAP = 320;
    const Y_GAP = 140;
    const nextPos = new Map<string, { x: number; y: number }>();
    for (const [lv, list] of Array.from(byLevel.entries()).sort((a, b) => a[0] - b[0])) {
      for (let i = 0; i < list.length; i += 1) {
        nextPos.set(list[i].id, { x: lv * X_GAP, y: i * Y_GAP + 60 });
      }
    }

    setNodes((ns) =>
      ns.map((n) => (nextPos.has(n.id) ? { ...n, position: nextPos.get(n.id)! } : n))
    );
    setDirty(true);
    setValidation(null);
  }, [edges, nodes, setNodes]);

  const alignSelection = useCallback(
    (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
      const ids = selectedNodeIds;
      if (ids.length < 2) return;
      const selected = nodes.filter((n) => ids.includes(n.id));
      if (selected.length < 2) return;

      const xs = selected.map((n) => n.position.x);
      const ys = selected.map((n) => n.position.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;

      setNodes((ns) =>
        ns.map((n) => {
          if (!ids.includes(n.id)) return n;
          const p = { ...n.position };
          if (mode === 'left') p.x = minX;
          if (mode === 'right') p.x = maxX;
          if (mode === 'hcenter') p.x = midX;
          if (mode === 'top') p.y = minY;
          if (mode === 'bottom') p.y = maxY;
          if (mode === 'vcenter') p.y = midY;
          return { ...n, position: p };
        })
      );
      setDirty(true);
      setValidation(null);
    },
    [nodes, selectedNodeIds, setNodes]
  );

  const distributeSelection = useCallback(
    (axis: 'x' | 'y') => {
      const ids = selectedNodeIds;
      if (ids.length < 3) return;
      const selected = nodes.filter((n) => ids.includes(n.id));
      if (selected.length < 3) return;
      const sorted = selected.slice().sort((a, b) => (axis === 'x' ? a.position.x - b.position.x : a.position.y - b.position.y));
      const start = axis === 'x' ? sorted[0].position.x : sorted[0].position.y;
      const end = axis === 'x' ? sorted[sorted.length - 1].position.x : sorted[sorted.length - 1].position.y;
      const step = (end - start) / (sorted.length - 1);
      const target = new Map<string, number>();
      for (let i = 0; i < sorted.length; i += 1) {
        target.set(sorted[i].id, start + step * i);
      }
      setNodes((ns) =>
        ns.map((n) => {
          if (!ids.includes(n.id)) return n;
          const v = target.get(n.id);
          if (v == null) return n;
          return { ...n, position: { ...n.position, [axis]: v } as any };
        })
      );
      setDirty(true);
      setValidation(null);
    },
    [nodes, selectedNodeIds, setNodes]
  );

  const deleteSelection = useCallback(() => {
    if (selectedNodeIds.length > 0) {
      const toDel = new Set(selectedNodeIds);
      setNodes((ns) => ns.filter((n) => !toDel.has(n.id)));
      setEdges((es) => es.filter((e) => !toDel.has(e.source) && !toDel.has(e.target)));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setDirty(true);
      setValidation(null);
      return;
    }
    if (selectedEdgeIds.length > 0) {
      const toDel = new Set(selectedEdgeIds);
      setEdges((es) => es.filter((e) => !toDel.has(e.id)));
      setSelectedEdgeId(null);
      setSelectedEdgeIds([]);
      setDirty(true);
      setValidation(null);
    }
  }, [selectedEdgeIds, selectedNodeIds, setEdges, setNodes]);

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if ((t as any).isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const key = (e.key || '').toLowerCase();
      const meta = e.metaKey || e.ctrlKey;

      if (key === 'escape') {
        closeInspector();
        return;
      }

      if (key === 'backspace' || key === 'delete') {
        if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
          e.preventDefault();
          deleteSelection();
        }
        return;
      }

      if (meta && key === 's') {
        e.preventDefault();
        void save();
        return;
      }

      if (meta && key === 'enter') {
        e.preventDefault();
        void goTest();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeInspector, deleteSelection, goTest, save, selectedEdgeIds.length, selectedNodeIds.length]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Paper variant="outlined" sx={{ p: 1.25, flexShrink: 0 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
            <Tooltip title={headerExpanded ? t('workflowEditor.header.collapse') : t('workflowEditor.header.expand')}>
              <IconButton
                size="small"
                onClick={toggleHeader}
                aria-label={headerExpanded ? t('workflowEditor.header.collapse') : t('workflowEditor.header.expand')}
              >
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
              {t('workflowEditor.title')}
            </Typography>
            <TextField
              size="small"
              label={t('workflowEditor.fields.name')}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
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
              {t('workflowEditor.actions.resetCanvas')}
            </Button>
            <Button
              variant="outlined"
              onClick={autoLayout}
              disabled={busy}
              size="small"
            >
              {t('workflowEditor.actions.autoLayout')}
            </Button>
            <Button
              variant="outlined"
              startIcon={<ValidateIcon />}
              onClick={validate}
              disabled={busy}
              size="small"
            >
              {t('workflowEditor.actions.validate')}
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={save}
              disabled={busy}
              size="small"
            >
              {t('workflowEditor.actions.save')}
            </Button>
            <Button
              variant="outlined"
              startIcon={<TestIcon />}
              onClick={goTest}
              disabled={busy}
              size="small"
            >
              {t('workflowEditor.actions.test')}
            </Button>
            {!!id && (
              <Button
                variant="outlined"
                startIcon={<KeyIcon />}
                onClick={() => setApiDialogOpen(true)}
                disabled={busy}
                size="small"
              >
                {t('workflowEditor.actions.api')}
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<TemplateIcon />}
              onClick={openSaveAsTemplate}
              disabled={busy}
              size="small"
            >
              {t('workflowEditor.actions.saveAsTemplate')}
            </Button>
          </Stack>
        </Stack>

        <Collapse in={headerExpanded} timeout={150} unmountOnExit>
          <Box sx={{ mt: 1.25 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <TextField
                size="small"
                label={t('workflowEditor.fields.description')}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
                fullWidth
              />
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={isPublic}
                      onChange={(_e, checked) => {
                        setIsPublic(checked);
                        setDirty(true);
                      }}
                      disabled={busy}
                      size="small"
                    />
                  }
                  label={isPublic ? t('workflowEditor.visibility.team') : t('workflowEditor.visibility.private')}
                />
              </Box>
            </Stack>

            {validation && (
              <Box sx={{ mt: 1.25 }}>
                <Alert severity={validation.is_valid ? 'success' : 'error'}>
                  {validation.is_valid ? t('workflowEditor.validation.valid') : t('workflowEditor.validation.invalid')}
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
              const nodeIds = (sel.nodes || []).map((n) => n.id);
              const edgeIds = (sel.edges || []).map((e) => e.id);
              setSelectedNodeIds((prev) => (sameIdList(prev, nodeIds) ? prev : nodeIds));
              setSelectedEdgeIds((prev) => (sameIdList(prev, edgeIds) ? prev : edgeIds));

              if (nodeIds.length === 1 && edgeIds.length === 0) {
                setSelectedNodeId((prev) => (prev === nodeIds[0] ? prev : nodeIds[0]));
                setSelectedEdgeId((prev) => (prev === null ? prev : null));
                return;
              }
              if (edgeIds.length === 1 && nodeIds.length === 0) {
                setSelectedEdgeId((prev) => (prev === edgeIds[0] ? prev : edgeIds[0]));
                setSelectedNodeId((prev) => (prev === null ? prev : null));
                return;
              }
              setSelectedNodeId((prev) => (prev === null ? prev : null));
              setSelectedEdgeId((prev) => (prev === null ? prev : null));
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeStrokeWidth={2}
              nodeColor={(n: any) => {
                const k = n?.data?.kind;
                if (k === 'input') return '#29b6f6';
                if (k === 'llm') return '#42a5f5';
                if (k === 'rag_retriever') return '#ab47bc';
                if (k === 'http_request') return '#26c6da';
                if (k === 'condition') return '#ffa726';
                if (k === 'code_executor') return '#66bb6a';
                if (k === 'output') return '#ef5350';
                return '#90a4ae';
              }}
              style={{
                height: 120,
                width: 180,
              }}
            />
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
                    {t('workflow2.palette.title')}
                  </Typography>
                  <Tooltip title={t('workflowEditor.palette.zoomOut')}>
                    <IconButton size="small" onClick={() => bumpPaletteScale(-0.05)}>
                      <ZoomOutIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('workflowEditor.palette.zoomIn')}>
                    <IconButton size="small" onClick={() => bumpPaletteScale(0.05)}>
                      <ZoomInIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('workflowEditor.palette.collapse')}>
                    <IconButton size="small" onClick={togglePalette} aria-label={t('workflowEditor.palette.collapse')}>
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
              <Tooltip title={t('workflowEditor.palette.open')}>
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
                  aria-label={t('workflowEditor.palette.open')}
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
            {NODE_TEMPLATES.slice(0, 6).map((tpl) => (
              <Button key={tpl.kind} size="small" variant="outlined" onClick={() => addAtCenter(tpl.kind)}>
                + {t(tpl.nameKey)}
              </Button>
            ))}
          </Box>

          {selectedNodeIds.length > 1 && (
            <Box
              sx={{
                position: 'absolute',
                left: '50%',
                bottom: 12,
                transform: 'translateX(-50%)',
                zIndex: 19,
                maxWidth: '92vw',
              }}
            >
              <Paper variant="outlined" sx={{ p: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                  {t('workflowEditor.selection.selectedCount', { count: selectedNodeIds.length })}
                </Typography>
                <Button size="small" variant="outlined" onClick={() => alignSelection('left')}>
                  {t('workflowEditor.selection.align.left')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => alignSelection('hcenter')}>
                  {t('workflowEditor.selection.align.hcenter')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => alignSelection('right')}>
                  {t('workflowEditor.selection.align.right')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => alignSelection('top')}>
                  {t('workflowEditor.selection.align.top')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => alignSelection('vcenter')}>
                  {t('workflowEditor.selection.align.vcenter')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => alignSelection('bottom')}>
                  {t('workflowEditor.selection.align.bottom')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => distributeSelection('x')}>
                  {t('workflowEditor.selection.distribute.x')}
                </Button>
                <Button size="small" variant="outlined" onClick={() => distributeSelection('y')}>
                  {t('workflowEditor.selection.distribute.y')}
                </Button>
                <Button size="small" variant="outlined" onClick={autoLayout}>
                  {t('workflowEditor.actions.autoLayout')}
                </Button>
                <Button size="small" color="error" variant="outlined" onClick={deleteSelection}>
                  {t('common.delete')}
                </Button>
              </Paper>
            </Box>
          )}

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
                  aria-label={t('workflowEditor.inspector.close')}
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
                      setDirty(true);
                      setValidation(null);
                    }}
                    onDelete={() => {
                      if (!selectedEdgeId) return;
                      setEdges((es) => es.filter((e) => e.id !== selectedEdgeId));
                      setSelectedEdgeId(null);
                      setDirty(true);
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

      <Dialog open={testConfirmOpen} onClose={() => setTestConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('workflowEditor.confirmTest.title')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('workflowEditor.confirmTest.body')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setTestConfirmOpen(false);
              if (id) navigate(`/workflows/${id}/test`);
            }}
            disabled={busy}
          >
            {t('workflowEditor.confirmTest.enterDirectly')}
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              setTestConfirmOpen(false);
              await saveAndEnterTest();
            }}
            disabled={busy}
          >
            {t('workflowEditor.confirmTest.saveAndEnter')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={apiDialogOpen} onClose={() => setApiDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('workflowEditor.apiDialog.title')}</DialogTitle>
        <DialogContent sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CopyIcon />}
              onClick={async () => {
                const wid = id || '<workflow_id>';
                const base = publicApiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
                const url = `${String(base).replace(/\/+$/, '')}/api/v1/public/workflows/${wid}/run`;
                const cmd = `curl -sS -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: YOUR_KEY" \\\n  -d '{"input_data":{"text":"hello"}}'`;
                try {
                  await navigator.clipboard.writeText(cmd);
                  setSnack({ type: 'success', message: t('workflowEditor.apiDialog.copiedRun') });
                } catch {
                  setSnack({ type: 'error', message: t('workflowEditor.apiDialog.copyFailed') });
                }
              }}
            >
              {t('workflowEditor.apiDialog.copyRunCurl')}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CopyIcon />}
              onClick={async () => {
                const wid = id || '<workflow_id>';
                const base = publicApiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
                const url = `${String(base).replace(/\/+$/, '')}/api/v1/public/workflows/${wid}/run/stream`;
                const cmd = `curl -N -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: YOUR_KEY" \\\n  -d '{"input_data":{"text":"hello"},"debug":false}'`;
                try {
                  await navigator.clipboard.writeText(cmd);
                  setSnack({ type: 'success', message: t('workflowEditor.apiDialog.copiedStream') });
                } catch {
                  setSnack({ type: 'error', message: t('workflowEditor.apiDialog.copyFailed') });
                }
              }}
            >
              {t('workflowEditor.apiDialog.copyStreamCurl')}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CopyIcon />}
              onClick={async () => {
                const wid = id || '<workflow_id>';
                const base = publicApiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
                const url = `${String(base).replace(/\/+$/, '')}/api/v1/public/workflows/${wid}/io-schema`;
                const cmd = `curl -sS -X GET "${url}" -H "x-api-key: YOUR_KEY"`;
                try {
                  await navigator.clipboard.writeText(cmd);
                  setSnack({ type: 'success', message: t('workflowEditor.apiDialog.copiedSchema') });
                } catch {
                  setSnack({ type: 'error', message: t('workflowEditor.apiDialog.copyFailed') });
                }
              }}
            >
              {t('workflowEditor.apiDialog.copySchemaCurl')}
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('workflowEditor.apiDialog.desc')}
          </Typography>
          <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: 'background.default', overflow: 'auto' }}>
{`${publicApiBaseUrl ? `POST ${publicApiBaseUrl}/api/v1/public/workflows/${id || '<workflow_id>'}/run\n` : ''}POST /api/v1/public/workflows/${id || '<workflow_id>'}/run
${publicApiBaseUrl ? `POST ${publicApiBaseUrl}/api/v1/public/workflows/${id || '<workflow_id>'}/run/stream\n` : ''}POST /api/v1/public/workflows/${id || '<workflow_id>'}/run/stream
${publicApiBaseUrl ? `GET  ${publicApiBaseUrl}/api/v1/public/workflows/${id || '<workflow_id>'}/io-schema\n` : ''}GET  /api/v1/public/workflows/${id || '<workflow_id>'}/io-schema`}
          </Box>
          {!!publicApiBaseUrl && (
            <Typography variant="caption" color="text.secondary">
              {t('workflowEditor.apiDialog.baseHint')}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t('workflowEditor.apiDialog.crossTenantHint')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApiDialogOpen(false)}>{t('workflowEditor.apiDialog.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('workflowEditor.templates.dialogTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
          <TextField
            label={t('workflowEditor.templates.fields.name')}
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('workflowEditor.templates.fields.description')}
            value={templateDescription}
            onChange={(e) => setTemplateDescription(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
          <TextField
            label={t('workflowEditor.templates.fields.categoryOptional')}
            value={templateCategory}
            onChange={(e) => setTemplateCategory(e.target.value)}
            fullWidth
            size="small"
            helperText={t('workflowEditor.templates.fields.categoryHint')}
          />
          <TextField
            label={t('workflowEditor.templates.fields.tagsOptional')}
            value={templateTags}
            onChange={(e) => setTemplateTags(e.target.value)}
            fullWidth
            size="small"
            placeholder={t('workflowEditor.templates.fields.tagsPlaceholder')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={templateIsPublic}
                onChange={(_e, checked) => setTemplateIsPublic(checked)}
                size="small"
              />
            }
            label={templateIsPublic ? t('workflowEditor.visibility.team') : t('workflowEditor.visibility.private')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialogOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={saveAsTemplate} variant="contained" disabled={busy}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkflowEditor;
