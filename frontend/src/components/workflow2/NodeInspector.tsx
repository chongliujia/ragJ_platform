import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  ClickAwayListener,
  Chip,
  Box,
  Button,
  Divider,
  FormControl,
  FormHelperText,
  InputLabel,
  ListSubheader,
  MenuItem,
  Paper,
  Popper,
  MenuList,
  Select,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import MonacoEditor from '@monaco-editor/react';
import type { Edge, Node } from 'reactflow';
import type { WorkflowEdgeData, WorkflowNodeData } from './types';
import { NODE_SCHEMAS, type NodeFieldSchema, type SchemaOption } from './nodeSchemas';

type InputEl = HTMLInputElement | HTMLTextAreaElement;

function outputsForKind(kind: WorkflowNodeData['kind'] | undefined): string[] {
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
}

function inputsForKind(kind: WorkflowNodeData['kind'] | undefined): string[] {
  switch (kind) {
    case 'llm':
      return ['data', 'prompt', 'input'];
    case 'rag_retriever':
      return ['data', 'query'];
    case 'http_request':
      return ['data', 'url'];
    case 'condition':
      return ['data', 'value'];
    case 'code_executor':
      return ['data', 'input'];
    case 'output':
      return ['data', 'input'];
    case 'input':
    default:
      return [];
  }
}

function recommendedSourceOutput(kind: WorkflowNodeData['kind'] | undefined): string {
  switch (kind) {
    case 'input':
      return 'input';
    case 'llm':
      return 'content';
    case 'rag_retriever':
      return 'documents';
    case 'http_request':
      return 'response_data';
    case 'condition':
      return 'data';
    case 'code_executor':
      return 'result';
    case 'output':
      return 'result';
    default:
      return 'output';
  }
}

type MustacheContext = {
  openIndex: number;
  replaceFrom: number;
  replaceTo: number;
  query: string;
};

function getMustacheContext(value: string, cursor: number): MustacheContext | null {
  const before = value.slice(0, cursor);
  const open = before.lastIndexOf('{{');
  if (open < 0) return null;
  const close = before.lastIndexOf('}}');
  if (close > open) return null;

  let start = open + 2;
  while (start < cursor && /\s/.test(value[start])) start += 1;
  const query = value.slice(start, cursor);
  return { openIndex: open, replaceFrom: start, replaceTo: cursor, query };
}

function rankTemplateSuggestion(item: string, query: string): number {
  if (!query) return 2;
  const q = query.toLowerCase();
  const it = item.toLowerCase();
  if (it === q) return 0;
  if (it.startsWith(q)) return 1;
  if (it.includes(q)) return 2;
  return 9;
}

function normalizeTargetInput(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return 'input';
  if (v.startsWith('input')) return 'input';
  return v;
}

type Props = {
  node: Node<WorkflowNodeData> | null;
  onChange: (patch: Partial<WorkflowNodeData>) => void;
  onDelete: () => void;
  onCreateBranches?: () => void;
  onUpdateEdge?: (edgeId: string, patch: Partial<WorkflowEdgeData>) => void;
  knowledgeBases: string[];
  availableChatModels: string[];
  allNodes: Node<WorkflowNodeData>[];
  allEdges: Edge<WorkflowEdgeData>[];
};

export default function NodeInspector({
  node,
  onChange,
  onDelete,
  onCreateBranches,
  onUpdateEdge,
  knowledgeBases,
  availableChatModels,
  allNodes,
  allEdges,
}: Props) {
  const [rawConfig, setRawConfig] = useState('');
  const [activeTab, setActiveTab] = useState<'config' | 'io' | 'advanced'>('config');
  const lastNodeIdRef = useRef<string | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [activeInputEl, setActiveInputEl] = useState<InputEl | null>(null);
  const sysPromptRef = useRef<HTMLInputElement | null>(null);
  const outputTemplateRef = useRef<HTMLInputElement | null>(null);
  const conditionValueRef = useRef<HTMLInputElement | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  const [httpHeadersRaw, setHttpHeadersRaw] = useState('');
  const [httpParamsRaw, setHttpParamsRaw] = useState('');
  const [httpDataRaw, setHttpDataRaw] = useState('');
  const [httpHeadersErr, setHttpHeadersErr] = useState<string | null>(null);
  const [httpParamsErr, setHttpParamsErr] = useState<string | null>(null);
  const [httpDataErr, setHttpDataErr] = useState<string | null>(null);

  const [tplOpen, setTplOpen] = useState(false);
  const [tplItems, setTplItems] = useState<string[]>([]);
  const [tplActiveIdx, setTplActiveIdx] = useState(0);
  const [tplMode, setTplMode] = useState<'autocomplete' | 'picker'>('autocomplete');
  const tplCtxRef = useRef<MustacheContext | null>(null);

  const cfg = node?.data.config || {};
  const kind = node?.data.kind;

  const schema = useMemo(() => {
    const k = kind as WorkflowNodeData['kind'] | undefined;
    return (k ? NODE_SCHEMAS[k] : []) || [];
  }, [kind]);

  const title = useMemo(() => {
    if (!node) return '属性面板';
    return `${node.data.name || '未命名'}（${node.data.kind}）`;
  }, [node]);

  useEffect(() => {
    if (!node) return;
    // Only auto-select tab when the selected node changes (avoid jumping tabs while editing config).
    if (lastNodeIdRef.current === node.id) return;
    lastNodeIdRef.current = node.id;
    try {
      const hasAnyEdge = (allEdges || []).some((e) => e.source === node.id || e.target === node.id);
      setActiveTab(hasAnyEdge ? 'io' : 'config');
    } catch {
      setActiveTab('config');
    }
  }, [allEdges, node]);

  useEffect(() => {
    if (!node) return;
    if (node.data.kind !== 'http_request') return;
    const c: any = node.data.config || {};
    setHttpHeadersRaw(JSON.stringify(c.headers || {}, null, 2));
    setHttpParamsRaw(JSON.stringify(c.params || {}, null, 2));
    setHttpDataRaw(JSON.stringify(('data' in c ? c.data : {}), null, 2));
    setHttpHeadersErr(null);
    setHttpParamsErr(null);
    setHttpDataErr(null);
  }, [node?.id, node?.data?.kind]);

  if (!node) {
    return (
      <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
          属性面板
        </Typography>
        <Typography variant="body2" color="text.secondary">
          选中一个节点后在这里编辑参数。
        </Typography>
      </Paper>
    );
  }

  const updateConfig = (key: string, value: any) => {
    onChange({ config: { ...(node.data.config || {}), [key]: value } });
  };

  const incomingEdges = useMemo(() => {
    if (!node) return [];
    return (allEdges || []).filter((e) => e.target === node.id);
  }, [allEdges, node]);

  const incomingMappings = useMemo(() => {
    if (!node) return [];
    return incomingEdges.map((e) => {
      const srcNode = allNodes.find((n) => n.id === e.source);
      const srcName = srcNode?.data?.name || e.source;
      const srcKind = srcNode?.data?.kind;
      const sourceOutput = typeof e.data?.source_output === 'string' && e.data.source_output ? e.data.source_output : 'output';
      const targetKey = normalizeTargetInput(e.data?.target_input);
      return { edgeId: e.id, sourceId: e.source, srcName, srcKind, sourceOutput, targetKey };
    });
  }, [allNodes, incomingEdges, node]);

  const outgoingEdges = useMemo(() => {
    if (!node) return [];
    return (allEdges || []).filter((e) => e.source === node.id);
  }, [allEdges, node]);

  const outgoingMappings = useMemo(() => {
    if (!node) return [];
    return outgoingEdges.map((e) => {
      const tgtNode = allNodes.find((n) => n.id === e.target);
      const tgtName = tgtNode?.data?.name || e.target;
      const tgtKind = tgtNode?.data?.kind;
      const sourceOutput = typeof e.data?.source_output === 'string' && e.data.source_output ? e.data.source_output : (e.sourceHandle || 'output');
      const targetKey = normalizeTargetInput(e.data?.target_input ?? e.targetHandle);
      const condition = typeof e.data?.condition === 'string' ? e.data.condition : '';
      return { edgeId: e.id, targetId: e.target, tgtName, tgtKind, sourceOutput, targetKey, condition };
    });
  }, [allNodes, node, outgoingEdges]);

  const llmConnectedPromptKeyOptions = useMemo(() => {
    if (kind !== 'llm') return [] as SchemaOption[];
    const seen = new Set<string>();
    const out: SchemaOption[] = [];
    for (const m of incomingMappings) {
      const key = String(m.targetKey || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ value: key, label: `${key} ← ${m.srcName}.${m.sourceOutput}` });
    }
    out.sort((a, b) => a.value.localeCompare(b.value));
    return out;
  }, [incomingMappings, kind]);

  const variableHints = useMemo(() => {
    if (!node) return [];
    // Only include keys that will actually appear in this node's input_data (derived from incoming edges).
    const unique = Array.from(new Set(incomingMappings.map((m) => m.targetKey)));
    unique.sort();
    return unique;
  }, [incomingMappings, node]);

  const runtimeInputTemplateHints = useMemo(() => {
    // Runtime input (from WorkflowTester / execute input_data), not from edges.
    return ['input.input', 'input.prompt', 'input.query', 'input.text'];
  }, []);

  const runtimeContextTemplateHints = useMemo(() => {
    // Runtime context injected by backend (tenant/user), not from edges.
    return ['context.tenant_id', 'context.user_id'];
  }, []);

  const globalTemplateHints = useMemo(() => {
    return [...runtimeInputTemplateHints, ...runtimeContextTemplateHints];
  }, [runtimeContextTemplateHints, runtimeInputTemplateHints]);

  const templateSuggestions = useMemo(() => {
    const out = new Set<string>();
    for (const k of globalTemplateHints) out.add(k);
    for (const k of variableHints) {
      if (!k) continue;
      out.add(k);
      out.add(`data.${k}`);
    }

    // Expand suggestions based on edge mappings (shape hints).
    for (const m of incomingMappings) {
      const base = m.targetKey;
      const basePrefix = base === 'data' ? 'data.data' : base;
      const outputs = outputsForKind(m.srcKind);
      const hintOutputs = Array.from(new Set([m.sourceOutput, ...outputs])).filter(Boolean);
      for (const o of hintOutputs) {
        if (!o) continue;
        const root = `${basePrefix}.${o}`;
        out.add(root);
        if (o === 'documents') {
          out.add(`${root}[0].text`);
          out.add(`${root}[0].metadata`);
          out.add(`${root}[0].score`);
        }
        if (o === 'metadata') {
          out.add(`${root}.model`);
          out.add(`${root}.usage.total_tokens`);
        }
        if (o === 'result') {
          out.add(`${root}.content`);
          out.add(`${root}.text`);
        }
        if (o === 'response_data') {
          out.add(`${root}.data`);
          out.add(`${root}.text`);
        }
      }
      if (base === 'data') out.add('data.data');
    }

    return Array.from(out);
  }, [globalTemplateHints, incomingMappings, variableHints]);

  const outputSelectOptions = useMemo(() => {
    if (kind !== 'output') return [] as SchemaOption[];
    const seen = new Set<string>();
    const items: SchemaOption[] = [];

    const add = (value: string, label?: string) => {
      if (seen.has(value)) return;
      seen.add(value);
      items.push({ value, label: label ?? value });
    };

    add('', '自动（默认输出 data/input）');
    add('data', 'data（整体）');
    add('input', 'input（整体）');

    for (const m of incomingMappings) {
      const base = m.targetKey;
      if (!base) continue;
      add(base, `${base} ← ${m.srcName}.${m.sourceOutput}`);
      const outs = outputsForKind(m.srcKind);
      const hintOutputs = Array.from(new Set([m.sourceOutput, ...outs])).filter(Boolean);
      for (const o of hintOutputs) {
        add(`${base}.${o}`, `${base}.${o}（当 ${base} 为对象时）`);
      }
    }

    const preferred = ['content', 'result', 'response_data', 'documents', 'stdout'];
    items.sort((a, b) => {
      const ap = preferred.some((p) => a.value === p || a.value.endsWith(`.${p}`)) ? -1 : 0;
      const bp = preferred.some((p) => b.value === p || b.value.endsWith(`.${p}`)) ? -1 : 0;
      if (ap !== bp) return ap - bp;
      return a.value.localeCompare(b.value);
    });
    return items;
  }, [incomingMappings, kind]);

  const referenceWarnings = useMemo(() => {
    if (!node) return [];
    const texts: string[] = [];
    const addStr = (v: any) => {
      if (typeof v === 'string' && v.includes('{{')) texts.push(v);
    };
    addStr(cfg.system_prompt);
    addStr(cfg.template);
    addStr(cfg.url);
    if (cfg.overrides && typeof cfg.overrides === 'object') {
      Object.values(cfg.overrides).forEach(addStr);
    }

    const tokens = new Set<string>();
    const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    for (const s of texts) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const expr = (m[1] || '').trim();
        if (!expr) continue;
        tokens.add(expr);
      }
    }

    const hintSet = new Set(variableHints);
    // Backends can resolve these from global input even without edges; avoid noisy warnings.
    for (const k of ['input', 'prompt', 'query', 'text', 'data', 'tenant_id', 'user_id']) hintSet.add(k);
    const warnings: string[] = [];
    for (const expr of tokens) {
      if (expr.startsWith('input.') || expr.startsWith('context.') || expr.startsWith('data.')) continue;
      const root = expr.split(/[.[\s]/)[0];
      if (root && !hintSet.has(root)) warnings.push(`引用变量可能不存在：{{${expr}}}`);
    }
    return warnings;
  }, [cfg, node, variableHints]);

  const nodeValidation = useMemo(() => {
    if (!node) return { errors: [] as string[], warnings: [] as string[] };
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!node.data.name?.trim()) errors.push('节点名称不能为空');

    if (kind === 'llm') {
      const t = Number(cfg.temperature ?? 0.7);
      const mt = Number(cfg.max_tokens ?? 1000);
      if (!Number.isFinite(t) || t < 0 || t > 2) errors.push('temperature 需在 0~2 之间');
      if (!Number.isFinite(mt) || mt < 1) errors.push('max_tokens 需为正整数');
      if (!cfg.system_prompt && incomingEdges.length === 0) warnings.push('当前 LLM 节点没有上游输入，可能会收到空 prompt');
    }

    if (kind === 'rag_retriever') {
      if (!cfg.knowledge_base) errors.push('请选择知识库');
      const k = Number(cfg.top_k ?? 5);
      if (!Number.isFinite(k) || k < 1 || k > 50) errors.push('top_k 需在 1~50 之间');
    }

    if (kind === 'condition') {
      if (!String(cfg.field_path || '').trim()) errors.push('field_path 不能为空');
      const ct = String(cfg.condition_type || 'equals');
      if (!ct) errors.push('condition_type 不能为空');
      if (ct !== 'truthy' && String(cfg.condition_value ?? '').trim() === '') warnings.push('condition_value 为空：仅对 truthy 类型可省略');
    }

    if (kind === 'code_executor') {
      const code = String(cfg.code || '');
      if (!code.trim()) errors.push('代码不能为空');
      if (!/\bresult\s*=/.test(code)) warnings.push('建议在代码中设置变量 result 作为输出');
      if (/\bimport\b/.test(code)) warnings.push('Sandbox 禁止 import（请使用内置 json/re/math 或纯逻辑处理）');
      if (/__\w+__/.test(code)) warnings.push('Sandbox 禁止访问 __dunder__ 属性（例如 __class__）');

      const timeoutSec = Number(cfg.timeout_sec ?? cfg.timeout ?? 3);
      const memMb = Number(cfg.max_memory_mb ?? 256);
      const stdoutChars = Number(cfg.max_stdout_chars ?? 10000);
      const maxInBytes = Number(cfg.max_input_bytes ?? 2000000);
      const maxOutBytes = Number(cfg.max_result_bytes ?? 2000000);
      if (!Number.isFinite(timeoutSec) || timeoutSec < 0.1 || timeoutSec > 30) errors.push('timeout_sec 建议在 0.1~30 秒之间');
      if (!Number.isFinite(memMb) || memMb < 16 || memMb > 4096) errors.push('max_memory_mb 建议在 16~4096 之间');
      if (!Number.isFinite(stdoutChars) || stdoutChars < 1000 || stdoutChars > 200000) errors.push('max_stdout_chars 建议在 1000~200000 之间');
      if (!Number.isFinite(maxInBytes) || maxInBytes < 10000 || maxInBytes > 50_000_000) errors.push('max_input_bytes 建议在 10000~50000000 之间');
      if (!Number.isFinite(maxOutBytes) || maxOutBytes < 10000 || maxOutBytes > 50_000_000) errors.push('max_result_bytes 建议在 10000~50000000 之间');
    }

    if (kind === 'output') {
      const f = String(cfg.format || 'json');
      if (!['json', 'text', 'markdown'].includes(f)) errors.push('format 不支持');
      const tpl = String(cfg.template || '');
      const sel = String(cfg.select_path || cfg.select || '');
      if (sel && tpl) warnings.push('已设置 select_path，但 template 非空时会覆盖 select_path');
      if (tpl && tpl.trim() === '') warnings.push('template 仅包含空白字符，会导致输出为空');
      if (tpl && !tpl.includes('{{') && !tpl.includes('{')) warnings.push('未配置模板：将直接输出 input_data');
    }

    if (kind === 'http_request') {
      const url = String(cfg.url || '').trim();
      if (!url) errors.push('url 不能为空');
      const m = String(cfg.method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) errors.push('method 不支持（GET/POST/PUT/PATCH/DELETE）');
      const timeout = Number(cfg.timeout ?? 30);
      if (!Number.isFinite(timeout) || timeout <= 0) errors.push('timeout 必须为正数（秒）');
      if (cfg.headers != null && typeof cfg.headers !== 'object') errors.push('headers 必须是 JSON 对象');
      if (cfg.params != null && typeof cfg.params !== 'object') errors.push('params 必须是 JSON 对象');
    }

    // overrides (engine supports it)
    const overrides = cfg.overrides;
    if (overrides != null && typeof overrides !== 'object') errors.push('overrides 必须是对象（key->value）');

    return { errors, warnings: [...warnings, ...referenceWarnings] };
  }, [cfg, incomingEdges.length, kind, node, referenceWarnings]);

  const insertTemplate = async (placeholder: string) => {
    try {
      await navigator.clipboard.writeText(placeholder);
    } catch {}

    // Best-effort inline insert into active text field
    const map: Record<string, React.RefObject<HTMLInputElement | null>> = {
      system_prompt: sysPromptRef,
      template: outputTemplateRef,
      condition_value: conditionValueRef,
      url: urlRef,
    };
    const ref = activeField ? map[activeField] : null;
    const el = ref?.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + placeholder + el.value.slice(end);
    // Update corresponding config field
    if (activeField === 'system_prompt') updateConfig('system_prompt', next);
    if (activeField === 'template') updateConfig('template', next);
    if (activeField === 'condition_value') updateConfig('condition_value', next);
    if (activeField === 'url') updateConfig('url', next);
    if (activeField?.startsWith('overrides.')) {
      const k = activeField.slice('overrides.'.length);
      if (k) setOverride(k, next);
    }
    // Restore cursor best-effort
    requestAnimationFrame(() => {
      try {
        el.focus();
        const pos = start + placeholder.length;
        el.setSelectionRange(pos, pos);
      } catch {}
    });
  };

  const setActiveEditing = (field: string, el: InputEl | null) => {
    setActiveField(field);
    setActiveInputEl(el);
  };

  const getActiveValue = (): string => {
    if (!activeField) return '';
    if (activeField === 'system_prompt') return String(cfg.system_prompt || '');
    if (activeField === 'template') return String(cfg.template || '');
    if (activeField === 'condition_value') return String(cfg.condition_value ?? '');
    if (activeField === 'url') return String(cfg.url || '');
    if (activeField.startsWith('overrides.')) {
      const k = activeField.slice('overrides.'.length);
      const overrides = cfg.overrides && typeof cfg.overrides === 'object' ? (cfg.overrides as Record<string, any>) : {};
      return String(overrides[k] ?? '');
    }
    return '';
  };

  const setActiveValue = (next: string) => {
    if (!activeField) return;
    if (activeField === 'system_prompt') updateConfig('system_prompt', next);
    else if (activeField === 'template') updateConfig('template', next);
    else if (activeField === 'condition_value') updateConfig('condition_value', next);
    else if (activeField === 'url') updateConfig('url', next);
    else if (activeField.startsWith('overrides.')) {
      const k = activeField.slice('overrides.'.length);
      if (k) setOverride(k, next);
    }
  };

  const refreshTemplateAutocomplete = (value: string, cursor: number) => {
    const ctx = getMustacheContext(value, cursor);
    if (!ctx) {
      tplCtxRef.current = null;
      setTplOpen(false);
      setTplItems([]);
      setTplActiveIdx(0);
      return;
    }
    const q = (ctx.query || '').trim();
    const items = templateSuggestions
      .filter((s) => rankTemplateSuggestion(s, q) < 9)
      .sort((a, b) => rankTemplateSuggestion(a, q) - rankTemplateSuggestion(b, q) || a.localeCompare(b))
      .slice(0, 12);

    tplCtxRef.current = ctx;
    setTplMode('autocomplete');
    setTplItems(items);
    setTplActiveIdx(0);
    setTplOpen(items.length > 0);
  };

  const acceptTemplateSuggestion = (expr: string) => {
    if (!activeInputEl) return;
    const value = activeInputEl.value ?? getActiveValue();
    const cursor = activeInputEl.selectionStart ?? value.length;
    const ctx = getMustacheContext(value, cursor);
    if (!ctx) {
      // No {{...}} context: insert a complete {{expr}} token.
      void insertTemplate(`{{${expr}}}`);
      setTplOpen(false);
      return;
    }

    let next = value.slice(0, ctx.replaceFrom) + expr + value.slice(ctx.replaceTo);
    const insertPos = ctx.replaceFrom + expr.length;
    if (next.indexOf('}}', ctx.openIndex) === -1) {
      next = next.slice(0, insertPos) + '}}' + next.slice(insertPos);
    }

    setActiveValue(next);
    setTplOpen(false);
    requestAnimationFrame(() => {
      try {
        activeInputEl.focus();
        activeInputEl.setSelectionRange(insertPos, insertPos);
      } catch {}
    });
  };

  const onTemplateKeyDown = (e: React.KeyboardEvent) => {
    if (!tplOpen || tplMode !== 'autocomplete' || tplItems.length === 0) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setTplOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTplActiveIdx((i) => (i + 1) % tplItems.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTplActiveIdx((i) => (i - 1 + tplItems.length) % tplItems.length);
      return;
    }
    if (e.key === 'Enter') {
      // Only hijack Enter when in a {{...}} context; otherwise preserve newline.
      const value = activeInputEl?.value ?? getActiveValue();
      const cursor = (activeInputEl?.selectionStart ?? value.length);
      if (getMustacheContext(value, cursor)) {
        e.preventDefault();
        acceptTemplateSuggestion(tplItems[tplActiveIdx] || tplItems[0]);
      }
    }
  };

  const setOverride = (key: string, value: string) => {
    const current = (cfg.overrides && typeof cfg.overrides === 'object' ? cfg.overrides : {}) as Record<string, any>;
    updateConfig('overrides', { ...current, [key]: value });
  };

  const quickFill = (preset: 'rag_to_llm' | 'docs_to_prompt') => {
    if (preset === 'rag_to_llm') {
      // A common pattern: RAG -> LLM. Put documents into system_prompt so prompt remains the question.
      updateConfig(
        'system_prompt',
        '请基于以下资料回答用户问题；如果资料不足，请说明无法确定。\n\n资料：{{documents}}\n\n'
      );
      return;
    }
    if (preset === 'docs_to_prompt') {
      setOverride('prompt', '资料：{{documents}}\n\n问题：{{prompt}}');
      return;
    }
  };

  const parseJsonObject = (raw: string, setErr: (msg: string | null) => void): any => {
    const text = (raw || '').trim();
    if (!text) {
      setErr(null);
      return {};
    }
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        setErr(null);
        return v;
      }
      setErr('需为 JSON 对象');
      return null;
    } catch (e: any) {
      setErr(e?.message || 'JSON 解析失败');
      return null;
    }
  };

  const openTemplatePicker = (field: string, el: InputEl | null) => {
    if (!el) return;
    setActiveEditing(field, el);
    tplCtxRef.current = null;
    const items = [...templateSuggestions].sort((a, b) => a.localeCompare(b)).slice(0, 50);
    setTplItems(items);
    setTplActiveIdx(0);
    setTplMode('picker');
    setTplOpen(true);
    requestAnimationFrame(() => {
      try {
        el.focus();
      } catch {}
    });
  };

  const pickerGroups = useMemo(() => {
    const groups: Array<{ label: string; items: string[] }> = [];
    groups.push({ label: '运行时输入/上下文（不依赖连线）', items: globalTemplateHints.slice() });

    const byEdge = incomingMappings.map((m) => {
      const items = new Set<string>();
      items.add(m.targetKey);
      items.add(`data.${m.targetKey}`);

      if (m.targetKey === 'data') {
        items.add('data.data');
        items.add(`data.data.${m.sourceOutput}`);
        if (m.sourceOutput === 'documents') {
          items.add('data.data.documents[0].text');
          items.add('data.data.documents[0].metadata');
        }
      } else if (m.targetKey === m.sourceOutput) {
        if (m.sourceOutput === 'documents') {
          items.add('documents[0].text');
          items.add('documents[0].metadata');
        }
        if (m.sourceOutput === 'metadata') {
          items.add('metadata.model');
        }
        if (m.sourceOutput === 'response_data') {
          items.add('response_data.data');
        }
        if (m.sourceOutput === 'result') {
          items.add('result.content');
        }
      }

      const label = `${m.srcName}（${m.sourceOutput} → ${m.targetKey}）`;
      return { label, items: Array.from(items).sort((a, b) => a.localeCompare(b)) };
    });

    for (const g of byEdge) {
      if (g.items.length) groups.push(g);
    }
    return groups;
  }, [globalTemplateHints, incomingMappings]);

  const templateFieldProps = (field: 'system_prompt' | 'template' | 'condition_value' | 'url') => {
    const refMap: Record<string, React.RefObject<HTMLInputElement | null>> = {
      system_prompt: sysPromptRef,
      template: outputTemplateRef,
      condition_value: conditionValueRef,
      url: urlRef,
    };
    const ref = refMap[field];
    return {
      inputRef: ref,
      onFocus: (e: any) => {
        const el = e.target as InputEl;
        setActiveEditing(field, el);
        refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
      },
      onChange: (e: any) => {
        const el = e.target as InputEl;
        updateConfig(field, el.value);
        refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
      },
      onKeyDown: onTemplateKeyDown,
      onClick: (e: any) => {
        const el = e.target as InputEl;
        refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
      },
      InputProps: {
        endAdornment: (
          <Button
            size="small"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => openTemplatePicker(field, ref?.current)}
          >
            插入变量
          </Button>
        ),
      },
    };
  };

  const renderField = (f: NodeFieldSchema) => {
    const val = (cfg as any)?.[f.key];
    if (f.type === 'select') {
      let opts: SchemaOption[] =
        typeof f.options === 'function'
          ? f.options({ knowledgeBases, availableChatModels })
          : (f.options || []);

      if (kind === 'llm' && f.key === 'prompt_key') {
        const baseOpts = opts;
        const connectedOpts = llmConnectedPromptKeyOptions;
        const value = String(val ?? '');
        const runtimeOpts = (baseOpts || []).filter((o) => ['input', 'prompt', 'query', 'text'].includes(String(o.value)));
        const otherOpts = (baseOpts || []).filter(
          (o) => o.value !== '' && !['input', 'prompt', 'query', 'text'].includes(String(o.value))
        );
        return (
          <FormControl key={f.key} fullWidth size="small">
            <InputLabel>{f.label}</InputLabel>
            <Select value={value} label={f.label} onChange={(e) => updateConfig(f.key, e.target.value)}>
              {(baseOpts || []).filter((o) => o.value === '').map((o) => (
                <MenuItem key={`${f.key}_${o.value}`} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}

              <ListSubheader>运行时输入（不依赖连线）</ListSubheader>
              {runtimeOpts.map((o) => (
                <MenuItem key={`${f.key}_runtime_${o.value}`} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}

              {connectedOpts.length > 0 && <ListSubheader>来自连线（连接上游后出现）</ListSubheader>}
              {connectedOpts.map((o) => (
                <MenuItem key={`${f.key}_connected_${o.value}`} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}

              {otherOpts.length > 0 && <ListSubheader>其他</ListSubheader>}
              {otherOpts.map((o) => (
                <MenuItem key={`${f.key}_other_${o.value}`} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              {connectedOpts.length
                ? '推荐：若已通过连线映射字段，可在“来自连线”选择；否则用“运行时输入”。'
                : '提示：未连接上游时，可使用“运行时输入”；连接上游后会出现“来自连线”。'}
            </FormHelperText>
          </FormControl>
        );
      }

      return (
        <FormControl key={f.key} fullWidth size="small">
          <InputLabel>{f.label}</InputLabel>
          <Select value={String(val ?? '')} label={f.label} onChange={(e) => updateConfig(f.key, e.target.value)}>
            {opts.map((o) => (
              <MenuItem key={`${f.key}_${o.value}`} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    if (f.type === 'number') {
      return (
        <TextField
          key={f.key}
          fullWidth
          size="small"
          label={f.label}
          type="number"
          value={val ?? ''}
          onChange={(e) => updateConfig(f.key, e.target.value === '' ? '' : Number(e.target.value))}
          inputProps={f.inputProps}
          helperText={f.helperText}
        />
      );
    }
    if (f.type === 'textarea') {
      return (
        <TextField
          key={f.key}
          fullWidth
          size="small"
          label={f.label}
          value={String(val ?? '')}
          onChange={(e) => updateConfig(f.key, e.target.value)}
          helperText={f.helperText}
          multiline
          minRows={f.minRows ?? 3}
        />
      );
    }
    if (f.type === 'template') {
      const fieldKey = f.key as any;
      const bind =
        fieldKey === 'system_prompt' || fieldKey === 'template' || fieldKey === 'condition_value' || fieldKey === 'url'
          ? templateFieldProps(fieldKey)
          : {};
      return (
        <TextField
          key={f.key}
          fullWidth
          size="small"
          label={f.label}
          value={String(val ?? '')}
          placeholder={f.placeholder}
          helperText={f.helperText}
          multiline={Boolean(f.minRows)}
          minRows={f.minRows}
          {...(bind as any)}
        />
      );
    }
    if (f.type === 'json_object') {
      const key = f.key;
      const raw = key === 'headers' ? httpHeadersRaw : key === 'params' ? httpParamsRaw : httpDataRaw;
      const setRaw = key === 'headers' ? setHttpHeadersRaw : key === 'params' ? setHttpParamsRaw : setHttpDataRaw;
      const err = key === 'headers' ? httpHeadersErr : key === 'params' ? httpParamsErr : httpDataErr;
      const setErr = key === 'headers' ? setHttpHeadersErr : key === 'params' ? setHttpParamsErr : setHttpDataErr;
      return (
        <TextField
          key={f.key}
          fullWidth
          size="small"
          label={f.label}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => {
            const v = parseJsonObject(raw, setErr);
            if (v) updateConfig(key, v);
          }}
          error={!!err}
          helperText={err || f.helperText}
          multiline
          minRows={3}
        />
      );
    }
    if (f.type === 'code') {
      return (
        <Box key={f.key} sx={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden' }}>
          <MonacoEditor
            height="240px"
            language="python"
            theme="vs-dark"
            value={String(val ?? '')}
            onChange={(v) => updateConfig(f.key, v || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
            }}
          />
        </Box>
      );
    }
    return null;
  };

  const schemaByGroup = useMemo(() => {
    const map = new Map<string, NodeFieldSchema[]>();
    for (const f of schema) {
      const g = f.group || '配置';
      const list = map.get(g) || [];
      list.push(f);
      map.set(g, list);
    }
    return Array.from(map.entries());
  }, [schema]);

  const nodeOutputs = useMemo(() => {
    return outputsForKind(kind);
  }, [kind]);

  const nodeInputs = useMemo(() => {
    return inputsForKind(kind);
  }, [kind]);

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap title={title}>
          {title}
        </Typography>
        <Button color="error" variant="outlined" size="small" onClick={onDelete}>
          删除
        </Button>
      </Box>
      <Divider sx={{ my: 1.5 }} />

      <Popper
        open={tplOpen && !!activeInputEl}
        anchorEl={activeInputEl}
        placement="bottom-start"
        modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
        sx={{ zIndex: 1400, maxWidth: 520 }}
      >
        <ClickAwayListener onClickAway={() => setTplOpen(false)}>
          <Paper variant="outlined" sx={{ p: 0.5, width: 420, maxWidth: 'min(520px, 92vw)' }}>
            <Box sx={{ px: 1, py: 0.75, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                {tplMode === 'autocomplete'
                  ? (
                      <>
                        输入 <code>{'{{'}</code> 自动联想（上下键选择，回车确认）
                      </>
                    )
                  : '变量选择器（点击插入）'}
              </Typography>
              <Button size="small" onClick={() => setTplOpen(false)}>
                关闭
              </Button>
            </Box>
            {tplMode === 'autocomplete' ? (
              <MenuList dense sx={{ maxHeight: 260, overflow: 'auto' }}>
                {tplItems.map((it, idx) => (
                  <MenuItem
                    key={it}
                    selected={idx === tplActiveIdx}
                    onMouseDown={(e) => {
                      // prevent blur before click
                      e.preventDefault();
                    }}
                    onClick={() => acceptTemplateSuggestion(it)}
                  >
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {it}
                    </Typography>
                  </MenuItem>
                ))}
                {tplItems.length === 0 && (
                  <MenuItem disabled>
                    <Typography variant="caption" color="text.secondary">
                      暂无可用变量
                    </Typography>
                  </MenuItem>
                )}
              </MenuList>
            ) : (
              <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
                {pickerGroups.map((g) => (
                  <Box key={g.label} sx={{ px: 0.5, py: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, display: 'block' }}>
                      {g.label}
                    </Typography>
                    <MenuList dense disablePadding>
                      {g.items.map((it) => (
                        <MenuItem
                          key={`${g.label}:${it}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => acceptTemplateSuggestion(it)}
                        >
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {it}
                          </Typography>
                        </MenuItem>
                      ))}
                      {g.items.length === 0 && (
                        <MenuItem disabled>
                          <Typography variant="caption" color="text.secondary">
                            暂无
                          </Typography>
                        </MenuItem>
                      )}
                    </MenuList>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        </ClickAwayListener>
      </Popper>

      {(nodeValidation.errors.length > 0 || nodeValidation.warnings.length > 0) && (
        <Box sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {nodeValidation.errors.map((e, idx) => (
            <Alert key={`e-${idx}`} severity="error">
              {e}
            </Alert>
          ))}
          {nodeValidation.warnings.map((w, idx) => (
            <Alert key={`w-${idx}`} severity="warning">
              {w}
            </Alert>
          ))}
        </Box>
      )}

      <TextField
        fullWidth
        size="small"
        label="节点名称"
        value={node.data.name}
        onChange={(e) => onChange({ name: e.target.value })}
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label="描述"
        value={node.data.description || ''}
        onChange={(e) => onChange({ description: e.target.value })}
        sx={{ mb: 2 }}
      />

      <Tabs
        value={activeTab}
        onChange={(_e, v) => setActiveTab(v)}
        variant="fullWidth"
        sx={{ mb: 2 }}
      >
        <Tab value="config" label="配置" />
        <Tab value="io" label="连线 / IO" />
        <Tab value="advanced" label="高级" />
      </Tabs>

      {activeTab === 'io' && (
        <>
          <Accordion sx={{ mb: 2 }} defaultExpanded={kind === 'output'}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 800 }}>输入字段（{nodeInputs.length}）</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary">
                这些是本节点可接入的输入字段；连接上游时在连线里选择 <code>target_input</code>。
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {nodeInputs.length ? nodeInputs.map((k) => <Chip key={k} size="small" label={k} />) : (
                  <Typography variant="caption" color="text.secondary">无（起始节点）</Typography>
                )}
              </Box>
            </AccordionDetails>
          </Accordion>

          <Accordion sx={{ mb: 2 }} defaultExpanded={kind === 'output'}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 800 }}>输出字段（{nodeOutputs.length}）</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary">
                这些是本节点可能产生的输出字段；连接下游时在连线里选择 <code>source_output</code> 使用它们。
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {nodeOutputs.map((k) => (
                  <Chip key={k} size="small" label={k} />
                ))}
              </Box>
            </AccordionDetails>
          </Accordion>

          <Accordion sx={{ mb: 2 }} defaultExpanded={false}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 800 }}>输出去向（{outgoingMappings.length}）</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary">
                这里展示本节点的输出都连到了哪里（对应每条边的 <code>source_output</code> / <code>target_input</code>）。
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {outgoingMappings.map((m) => (
                  <Paper key={m.edgeId} variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      → {m.tgtName}
                      {m.tgtKind ? (
                        <Typography component="span" variant="caption" color="text.secondary">
                          {' '}
                          （{m.tgtKind}）
                        </Typography>
                      ) : null}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {m.sourceOutput} → {m.targetKey}
                      {m.condition ? (
                        <Typography component="span" variant="caption" color="text.secondary">
                          {' '}
                          · condition: {m.condition}
                        </Typography>
                      ) : null}
                    </Typography>
                  </Paper>
                ))}
                {outgoingMappings.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    暂无（未连接下游节点）
                  </Typography>
                )}
              </Box>
            </AccordionDetails>
          </Accordion>

          {(kind === 'llm' || kind === 'rag_retriever' || kind === 'output') && (
            <Accordion sx={{ mb: 2 }} defaultExpanded={incomingMappings.length > 0}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography sx={{ fontWeight: 800 }}>
                  {kind === 'rag_retriever' ? '查询绑定（来自连线）' : '输入绑定（来自连线）'}
                  {incomingMappings.length ? `（${incomingMappings.length}）` : ''}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                {kind === 'llm' ? (
                  <Typography variant="caption" color="text.secondary">
                    连接上游节点后，可在这里选择“取哪个输出、映射到 LLM 的哪个字段”。这会同步修改连线映射（等价于编辑边属性）。
                  </Typography>
                ) : kind === 'rag_retriever' ? (
                  <Typography variant="caption" color="text.secondary">
                    RAG 会优先读取 <code>query</code>，其次 <code>prompt</code>/<code>text</code>/<code>input</code>。建议将上游输出映射到 <code>query</code>。
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    输出节点会将输入数据格式化为 <code>result</code> 返回。常见用法：将 LLM 的 <code>content</code> 映射到输出节点的 <code>data</code>。
                  </Typography>
                )}

                {incomingMappings.length === 0 ? (
                  <Alert severity="info" sx={{ mt: 1.25 }}>
                    请先连接上游节点（连线后可在这里选择输入来源/映射字段）。
                  </Alert>
                ) : (
                  <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {incomingMappings.map((m) => {
                      const canEdit = typeof onUpdateEdge === 'function';
                      const srcOutputs = outputsForKind(m.srcKind);
                      const sourceOpts = Array.from(new Set([m.sourceOutput, ...srcOutputs])).filter(Boolean);
                      const targetOpts =
                        kind === 'llm'
                          ? (['input', 'prompt', 'data'] as const)
                          : kind === 'rag_retriever'
                            ? (['query', 'prompt', 'text', 'input', 'data'] as const)
                            : (['data', 'input', 'text', 'prompt', 'query'] as const);

                      const recSo = recommendedSourceOutput(m.srcKind);
                      const recTi = kind === 'llm' ? 'input' : kind === 'rag_retriever' ? 'query' : 'data';
                      const showFix = canEdit && ((m.sourceOutput || '') !== recSo || (m.targetKey || '') !== recTi);

                      return (
                        <Paper
                          key={m.edgeId}
                          variant="outlined"
                          sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              {m.srcName} → {node.data.name || (kind === 'llm' ? 'LLM' : kind === 'rag_retriever' ? 'RAG' : '输出')}
                            </Typography>
                            {showFix && (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => onUpdateEdge?.(m.edgeId, { source_output: recSo, target_input: recTi })}
                              >
                                应用推荐
                              </Button>
                            )}
                          </Box>
                          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                            <FormControl size="small" fullWidth disabled={!canEdit}>
                              <InputLabel>取上游输出</InputLabel>
                              <Select
                                label="取上游输出"
                                value={String(m.sourceOutput || 'output')}
                                onChange={(e) => onUpdateEdge?.(m.edgeId, { source_output: String(e.target.value) })}
                              >
                                {sourceOpts.map((v) => (
                                  <MenuItem key={`${m.edgeId}_so_${v}`} value={v}>
                                    {v}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                            <FormControl size="small" fullWidth disabled={!canEdit}>
                              <InputLabel>
                                {kind === 'llm' ? '映射到 LLM 字段' : kind === 'rag_retriever' ? '映射到 RAG 字段' : '映射到输出字段'}
                              </InputLabel>
                              <Select
                                label={kind === 'llm' ? '映射到 LLM 字段' : kind === 'rag_retriever' ? '映射到 RAG 字段' : '映射到输出字段'}
                                value={String(m.targetKey || recTi)}
                                onChange={(e) => onUpdateEdge?.(m.edgeId, { target_input: String(e.target.value) })}
                              >
                                {targetOpts.map((v) => (
                                  <MenuItem key={`${m.edgeId}_ti_${v}`} value={v}>
                                    {v}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            推荐：<code>{recSo}</code> → <code>{recTi}</code>
                          </Typography>
                        </Paper>
                      );
                    })}
                  </Box>
                )}

                {kind === 'llm' && (
                  <Box sx={{ mt: 1.25, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button variant="outlined" size="small" onClick={() => quickFill('rag_to_llm')}>
                      一键：RAG→LLM 系统提示
                    </Button>
                    <Button variant="outlined" size="small" onClick={() => quickFill('docs_to_prompt')}>
                      一键：合成 prompt（overrides）
                    </Button>
                  </Box>
                )}
              </AccordionDetails>
            </Accordion>
          )}

          <Accordion sx={{ mb: 2 }} defaultExpanded={false}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 800 }}>
                变量提示（运行时 {globalTemplateHints.length} / 连线 {variableHints.length}）
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary">
                在模板字段里输入 <code>{'{{'}</code> 会自动联想；也可以在下方点击复制/插入。
              </Typography>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: 'block' }}>
                运行时输入（来自测试/执行入参，不依赖连线）：
              </Typography>
              <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {runtimeInputTemplateHints.map((k) => (
                  <Chip
                    key={k}
                    size="small"
                    label={`{{${k}}}`}
                    onClick={() => void insertTemplate(`{{${k}}}`)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: 'block' }}>
                运行时上下文（tenant/user，不依赖连线）：
              </Typography>
              <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {runtimeContextTemplateHints.map((k) => (
                  <Chip
                    key={k}
                    size="small"
                    label={`{{${k}}}`}
                    onClick={() => void insertTemplate(`{{${k}}}`)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: 'block' }}>
                来自连线（连接上游节点后可用，会进入本节点的 input_data）：
              </Typography>
              <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {variableHints.map((k) => (
                  <Chip
                    key={k}
                    size="small"
                    label={`{{${k}}}`}
                    onClick={() => void insertTemplate(`{{${k}}}`)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
                {variableHints.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    暂无（请先连接上游节点）
                  </Typography>
                )}
              </Box>
            </AccordionDetails>
          </Accordion>
        </>
      )}

      {activeTab === 'config' && (
        <>
          {schema.length === 0 && (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              当前节点没有可配置参数。
            </Alert>
          )}

          {schemaByGroup.map(([g, fields]) => {
            const isSandbox = kind === 'code_executor' && g === 'Sandbox';
            return (
              <Box key={g} sx={{ mb: 2 }}>
                {!isSandbox && (
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                    {g}
                  </Typography>
                )}

                {isSandbox ? (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography sx={{ fontWeight: 700 }}>Sandbox 限制</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {fields.map(renderField)}
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              updateConfig('timeout_sec', 3);
                              updateConfig('max_memory_mb', 256);
                              updateConfig('max_stdout_chars', 10000);
                              updateConfig('max_input_bytes', 2000000);
                              updateConfig('max_result_bytes', 2000000);
                            }}
                          >
                            恢复默认
                          </Button>
                        </Box>
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {fields.map(renderField)}

                    {kind === 'code_executor' && g === '代码' && (
                      <Typography variant="caption" color="text.secondary">
                        约定：在代码中设置变量 <code>result</code> 作为输出（例如 <code>result = &#123;&quot;content&quot;: &quot;...&quot;&#125;</code>）。
                      </Typography>
                    )}

                    {kind === 'condition' && g === '基础配置' && (
                      <>
                        <Button variant="outlined" onClick={() => onCreateBranches?.()} disabled={!onCreateBranches}>
                          一键生成 True/False 分支
                        </Button>
                        <Typography variant="caption" color="text.secondary">
                          分支提示：从节点右侧的 <code>true</code>/<code>false</code> 句柄连线，会自动写入边条件并透传 <code>data</code>。
                        </Typography>
                      </>
                    )}

                    {kind === 'output' && g === '模板' && (
                      <>
                        <FormControl size="small" fullWidth>
                          <InputLabel>select_path（可选）</InputLabel>
                          <Select
                            label="select_path（可选）"
                            value={String(cfg.select_path || '')}
                            onChange={(e) => updateConfig('select_path', e.target.value)}
                          >
                            {outputSelectOptions.map((opt) => (
                              <MenuItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <Typography variant="caption" color="text.secondary">
                          优先级：若填写了 template，则以 template 为准；否则按 <code>select_path</code> 从输入里取值（例如 <code>data.content</code>）。
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          输出模板支持 <code>{'{{变量}}'}</code>（推荐）或 Python format <code>{'{content}'}</code>（兼容旧用法，模板不包含 <code>{'{{'}</code> 时启用）。
                        </Typography>
                      </>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}

          <Accordion
            sx={{ mb: 0.5 }}
            defaultExpanded={kind === 'llm' || kind === 'rag_retriever' || kind === 'output'}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 800 }}>IO 快览</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary">
                这里展示本节点的输入/输出字段；实际把上游输出接入到哪个字段，请到“连线 / IO”里配置。
              </Typography>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: 'block' }}>
                输入字段（{nodeInputs.length}）：
              </Typography>
              <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {nodeInputs.map((k) => (
                  <Chip key={`in_${k}`} size="small" label={k} />
                ))}
                {nodeInputs.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    无
                  </Typography>
                )}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: 'block' }}>
                输出字段（{nodeOutputs.length}）：
              </Typography>
              <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {nodeOutputs.map((k) => (
                  <Chip key={`out_${k}`} size="small" label={k} />
                ))}
                {nodeOutputs.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    无
                  </Typography>
                )}
              </Box>

              <Box sx={{ mt: 1.25, display: 'flex', justifyContent: 'flex-end' }}>
                <Button size="small" variant="outlined" onClick={() => setActiveTab('io')}>
                  去配置连线 / 绑定
                </Button>
              </Box>
            </AccordionDetails>
          </Accordion>
        </>
      )}

      {activeTab === 'advanced' && (
        <>
          <Accordion sx={{ mt: 0 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 700 }}>高级：输入 overrides（缺失字段自动填充）</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                用于在没有上游连线时，为当前节点补齐输入字段（例如给 LLM 填 prompt）。支持 <code>{'{{变量}}'}</code>。
              </Typography>
              {(() => {
                const overrides =
                  cfg.overrides && typeof cfg.overrides === 'object' ? (cfg.overrides as Record<string, any>) : {};
                const keys = Object.keys(overrides);
                return (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {(keys.length ? keys : ['prompt']).slice(0, 6).map((k) => (
                      <TextField
                        key={k}
                        size="small"
                        fullWidth
                        label={`overrides.${k}`}
                        value={String(overrides[k] ?? '')}
                        onChange={(e) => {
                          setOverride(k, e.target.value);
                          const el = e.target as InputEl;
                          refreshTemplateAutocomplete(e.target.value, el.selectionStart ?? e.target.value.length);
                        }}
                        onFocus={(e) => {
                          const el = e.target as InputEl;
                          setActiveEditing(`overrides.${k}`, el);
                          refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
                        }}
                        onKeyDown={onTemplateKeyDown}
                        onClick={(e) => {
                          const el = e.target as InputEl;
                          refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
                        }}
                      />
                    ))}
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        const nextKey = `key_${Object.keys(overrides).length + 1}`;
                        setOverride(nextKey, '');
                      }}
                    >
                      添加一项
                    </Button>
                  </Box>
                );
              })()}
            </AccordionDetails>
          </Accordion>

          <Accordion sx={{ mt: 2 }} onChange={(_, expanded) => { if (expanded) setRawConfig(JSON.stringify(node.data.config || {}, null, 2)); }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 700 }}>高级：直接编辑 config JSON</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <TextField
                fullWidth
                multiline
                minRows={8}
                value={rawConfig}
                onChange={(e) => setRawConfig(e.target.value)}
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                <Button
                  variant="contained"
                  onClick={() => {
                    try {
                      const obj = JSON.parse(rawConfig || '{}');
                      onChange({ config: obj });
                    } catch {
                      // ignore; let user fix JSON
                    }
                  }}
                >
                  应用 JSON
                </Button>
              </Box>
            </AccordionDetails>
          </Accordion>
        </>
      )}
    </Paper>
  );
}
