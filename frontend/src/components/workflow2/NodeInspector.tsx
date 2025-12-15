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
  InputLabel,
  MenuItem,
  Paper,
  Popper,
  MenuList,
  Select,
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
      return ['data', 'prompt', 'query', 'text'];
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
  knowledgeBases,
  availableChatModels,
  allNodes,
  allEdges,
}: Props) {
  const [rawConfig, setRawConfig] = useState('');
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
    if (node.data.kind !== 'http_request') return;
    const c: any = node.data.config || {};
    setHttpHeadersRaw(JSON.stringify(c.headers || {}, null, 2));
    setHttpParamsRaw(JSON.stringify(c.params || {}, null, 2));
    setHttpDataRaw(JSON.stringify(('data' in c ? c.data : {}), null, 2));
    setHttpHeadersErr(null);
    setHttpParamsErr(null);
    setHttpDataErr(null);
  }, [node]);

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

  const variableHints = useMemo(() => {
    if (!node) return [];
    // Only include keys that will actually appear in this node's input_data (derived from incoming edges).
    const unique = Array.from(new Set(incomingMappings.map((m) => m.targetKey)));
    unique.sort();
    return unique;
  }, [incomingMappings, node]);

  const globalTemplateHints = useMemo(() => {
    // Global/runtime context (WorkflowTester provides prompt/query/text; backend supports {{context.*}})
    return ['input.prompt', 'input.query', 'input.text', 'context.tenant_id', 'context.user_id'];
  }, []);

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
    for (const k of ['prompt', 'query', 'text', 'data', 'tenant_id', 'user_id']) hintSet.add(k);
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
    groups.push({ label: '全局', items: globalTemplateHints.slice() });

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
      const opts: SchemaOption[] =
        typeof f.options === 'function'
          ? f.options({ knowledgeBases, availableChatModels })
          : (f.options || []);
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

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
          变量/引用提示（输入 <code>{'{{'}</code> 自动联想；点击复制/插入）
        </Typography>
        <Typography variant="caption" color="text.secondary">
          全局（无需连线）：
        </Typography>
        <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {globalTemplateHints.map((k) => (
            <Chip
              key={k}
              size="small"
              label={`{{${k}}}`}
              onClick={() => void insertTemplate(`{{${k}}}`)}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          来自连线（连接上游节点后可用）：
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
        {incomingEdges.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              上游映射：
              {incomingEdges.map((e) => {
                const src = allNodes.find((n) => n.id === e.source)?.data?.name || e.source;
                const dst = e.data?.target_input || 'input';
                const so = e.data?.source_output || 'output';
                return (
                  <Box key={e.id} component="span" sx={{ ml: 1 }}>
                    [{src}.{so} → {dst}]
                  </Box>
                );
              })}
            </Typography>
          </Box>
        )}
      </Box>

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

                {kind === 'llm' && g === '提示词' && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button variant="outlined" size="small" onClick={() => quickFill('rag_to_llm')}>
                      一键：RAG→LLM 系统提示
                    </Button>
                    <Button variant="outlined" size="small" onClick={() => quickFill('docs_to_prompt')}>
                      一键：合成 prompt（overrides）
                    </Button>
                  </Box>
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
                  <Typography variant="caption" color="text.secondary">
                    输出模板支持 <code>{'{{变量}}'}</code>（推荐）或 Python format <code>{'{content}'}</code>（兼容旧用法，模板不包含 <code>{'{{'}</code> 时启用）。
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        );
      })}

      <Accordion sx={{ mt: 2 }}>
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
    </Paper>
  );
}
