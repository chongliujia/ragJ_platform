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
  const tplCtxRef = useRef<MustacheContext | null>(null);

  const cfg = node?.data.config || {};
  const kind = node?.data.kind;

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

  const variableHints = useMemo(() => {
    if (!node) return [];
    const mappedInputs = incomingEdges
      .map((e) => e.data?.target_input)
      .filter((x): x is string => typeof x === 'string' && x.length > 0);

    const upstreamOutputs = incomingEdges.flatMap((e) => {
      const src = allNodes.find((n) => n.id === e.source);
      const srcKind = src?.data?.kind;
      const fromKind = outputsForKind(srcKind);
      const chosen = typeof e.data?.source_output === 'string' && e.data.source_output ? [e.data.source_output] : [];
      return [...fromKind, ...chosen];
    });

    // Only include "connected" hints here. Global inputs are suggested separately.
    const unique = Array.from(new Set([...mappedInputs, ...upstreamOutputs]));
    unique.sort();
    return unique;
  }, [allNodes, incomingEdges, node]);

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
      out.add(`input.${k}`);
    }
    out.add('context.tenant_id');
    out.add('context.user_id');

    // common dotted paths for convenience (backend supports brackets)
    if (out.has('documents') || out.has('data.documents') || out.has('input.documents')) {
      out.add('documents[0].text');
      out.add('documents[0].metadata');
      out.add('documents[0].score');
    }
    if (out.has('metadata') || out.has('data.metadata') || out.has('input.metadata')) {
      out.add('metadata.model');
      out.add('metadata.usage.total_tokens');
    }
    if (out.has('result') || out.has('data.result') || out.has('input.result')) {
      out.add('result.content');
      out.add('result.text');
    }
    if (out.has('response_data') || out.has('data.response_data') || out.has('input.response_data')) {
      out.add('response_data.data');
      out.add('response_data.text');
    }

    return Array.from(out);
  }, [globalTemplateHints, variableHints]);

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
    setTplItems(items);
    setTplActiveIdx(0);
    setTplOpen(items.length > 0);
  };

  const acceptTemplateSuggestion = (expr: string) => {
    if (!activeInputEl) return;
    const value = activeInputEl.value ?? getActiveValue();
    const cursor = activeInputEl.selectionStart ?? value.length;
    const ctx = getMustacheContext(value, cursor);
    if (!ctx) return;

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
    if (!tplOpen || tplItems.length === 0) return;
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
                输入 <code>{'{{'}</code> 自动联想（上下键选择，回车确认）
              </Typography>
              <Button size="small" onClick={() => setTplOpen(false)}>
                关闭
              </Button>
            </Box>
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

      {kind === 'llm' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>模型</InputLabel>
            <Select
              value={cfg.model || ''}
              label="模型"
              onChange={(e) => updateConfig('model', e.target.value)}
            >
              <MenuItem value="">
                <em>（使用默认/按租户配置）</em>
              </MenuItem>
              {availableChatModels.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="temperature"
            type="number"
            value={cfg.temperature ?? 0.7}
            onChange={(e) => updateConfig('temperature', Number(e.target.value))}
            inputProps={{ step: 0.1, min: 0, max: 2 }}
          />
          <TextField
            fullWidth
            size="small"
            label="max_tokens"
            type="number"
            value={cfg.max_tokens ?? 1000}
            onChange={(e) => updateConfig('max_tokens', Number(e.target.value))}
            inputProps={{ step: 50, min: 1 }}
          />
          <TextField
            inputRef={sysPromptRef}
            fullWidth
            size="small"
            label="system_prompt"
            value={cfg.system_prompt || ''}
            onChange={(e) => {
              updateConfig('system_prompt', e.target.value);
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(e.target.value, el.selectionStart ?? e.target.value.length);
            }}
            onFocus={(e) => {
              const el = e.target as InputEl;
              setActiveEditing('system_prompt', el);
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
            onKeyDown={onTemplateKeyDown}
            onClick={(e) => {
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
            multiline
            minRows={4}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" size="small" onClick={() => quickFill('rag_to_llm')}>
              一键：RAG→LLM 系统提示
            </Button>
            <Button variant="outlined" size="small" onClick={() => quickFill('docs_to_prompt')}>
              一键：合成 prompt（overrides）
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            支持模板语法：<code>{'{{变量}}'}</code>（后端会在运行时用当前节点输入替换）。
          </Typography>
        </Box>
      )}

      {kind === 'rag_retriever' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>知识库</InputLabel>
            <Select
              value={cfg.knowledge_base || ''}
              label="知识库"
              onChange={(e) => updateConfig('knowledge_base', e.target.value)}
            >
              <MenuItem value="">
                <em>请选择</em>
              </MenuItem>
              {knowledgeBases.map((kb) => (
                <MenuItem key={kb} value={kb}>
                  {kb}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="top_k"
            type="number"
            value={cfg.top_k ?? 5}
            onChange={(e) => updateConfig('top_k', Number(e.target.value))}
            inputProps={{ step: 1, min: 1, max: 50 }}
          />
        </Box>
      )}

      {kind === 'http_request' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>method</InputLabel>
            <Select
              value={String(cfg.method || 'GET').toUpperCase()}
              label="method"
              onChange={(e) => updateConfig('method', e.target.value)}
            >
              <MenuItem value="GET">GET</MenuItem>
              <MenuItem value="POST">POST</MenuItem>
              <MenuItem value="PUT">PUT</MenuItem>
              <MenuItem value="PATCH">PATCH</MenuItem>
              <MenuItem value="DELETE">DELETE</MenuItem>
            </Select>
          </FormControl>

          <TextField
            inputRef={urlRef}
            fullWidth
            size="small"
            label="url"
            value={cfg.url || ''}
            onChange={(e) => {
              updateConfig('url', e.target.value);
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(e.target.value, el.selectionStart ?? e.target.value.length);
            }}
            onFocus={(e) => {
              const el = e.target as InputEl;
              setActiveEditing('url', el);
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
            onKeyDown={onTemplateKeyDown}
            onClick={(e) => {
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
            placeholder="https://example.com/api"
            helperText="支持模板：{{变量}}（例如 {{query}}）"
          />

          <TextField
            fullWidth
            size="small"
            label="timeout（秒）"
            type="number"
            value={cfg.timeout ?? 30}
            onChange={(e) => updateConfig('timeout', Number(e.target.value))}
            inputProps={{ step: 1, min: 1 }}
          />

          <TextField
            fullWidth
            size="small"
            label="headers（JSON 对象，可选）"
            value={httpHeadersRaw}
            onChange={(e) => setHttpHeadersRaw(e.target.value)}
            onBlur={() => {
              const v = parseJsonObject(httpHeadersRaw, setHttpHeadersErr);
              if (v) updateConfig('headers', v);
            }}
            error={!!httpHeadersErr}
            helperText={httpHeadersErr || '例如：{"Authorization":"Bearer xxx"}'}
            multiline
            minRows={3}
          />

          <TextField
            fullWidth
            size="small"
            label="params（JSON 对象，可选）"
            value={httpParamsRaw}
            onChange={(e) => setHttpParamsRaw(e.target.value)}
            onBlur={() => {
              const v = parseJsonObject(httpParamsRaw, setHttpParamsErr);
              if (v) updateConfig('params', v);
            }}
            error={!!httpParamsErr}
            helperText={httpParamsErr || 'GET 查询参数，例如：{"q":"{{query}}"}'}
            multiline
            minRows={3}
          />

          <TextField
            fullWidth
            size="small"
            label="data（JSON 对象，可选，用作请求体）"
            value={httpDataRaw}
            onChange={(e) => setHttpDataRaw(e.target.value)}
            onBlur={() => {
              const v = parseJsonObject(httpDataRaw, setHttpDataErr);
              if (v) updateConfig('data', v);
            }}
            error={!!httpDataErr}
            helperText={httpDataErr || 'POST/PUT/PATCH 请求体，例如：{"text":"{{prompt}}"}'}
            multiline
            minRows={3}
          />
        </Box>
      )}

      {kind === 'condition' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            fullWidth
            size="small"
            label="field_path"
            value={cfg.field_path || 'value'}
            onChange={(e) => updateConfig('field_path', e.target.value)}
            helperText="支持嵌套路径，例如 data.class"
          />
          <FormControl fullWidth size="small">
            <InputLabel>condition_type</InputLabel>
            <Select
              value={cfg.condition_type || 'equals'}
              label="condition_type"
              onChange={(e) => updateConfig('condition_type', e.target.value)}
            >
              <MenuItem value="equals">equals</MenuItem>
              <MenuItem value="contains">contains</MenuItem>
              <MenuItem value="greater_than">greater_than</MenuItem>
              <MenuItem value="less_than">less_than</MenuItem>
              <MenuItem value="truthy">truthy</MenuItem>
            </Select>
          </FormControl>
          <TextField
            inputRef={conditionValueRef}
            fullWidth
            size="small"
            label="condition_value"
            value={cfg.condition_value ?? ''}
            onChange={(e) => {
              updateConfig('condition_value', e.target.value);
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(e.target.value, el.selectionStart ?? e.target.value.length);
            }}
            onFocus={(e) => {
              const el = e.target as InputEl;
              setActiveEditing('condition_value', el);
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
            onKeyDown={onTemplateKeyDown}
            onClick={(e) => {
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
          />
          <Button
            variant="outlined"
            onClick={() => onCreateBranches?.()}
            disabled={!onCreateBranches}
          >
            一键生成 True/False 分支
          </Button>
          <Typography variant="caption" color="text.secondary">
            分支提示：从节点右侧的 <code>true</code>/<code>false</code> 句柄连线，会自动写入边条件并透传 <code>data</code>。
          </Typography>
        </Box>
      )}

      {kind === 'code_executor' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>language</InputLabel>
            <Select
              value={cfg.language || 'python'}
              label="language"
              onChange={(e) => updateConfig('language', e.target.value)}
            >
              <MenuItem value="python">python</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden' }}>
            <MonacoEditor
              height="240px"
              language="python"
              theme="vs-dark"
              value={cfg.code || ''}
              onChange={(v) => updateConfig('code', v || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
              }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            约定：在代码中设置变量 <code>result</code> 作为输出（例如 <code>result = &#123;&quot;content&quot;: &quot;...&quot;&#125;</code>）。
          </Typography>

          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 700 }}>Sandbox 限制</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="timeout_sec（秒）"
                  type="number"
                  value={cfg.timeout_sec ?? 3}
                  onChange={(e) => updateConfig('timeout_sec', Number(e.target.value))}
                  inputProps={{ step: 0.1, min: 0.1, max: 30 }}
                  helperText="超时会直接终止子进程（默认 3s）。"
                />
                <TextField
                  fullWidth
                  size="small"
                  label="max_memory_mb"
                  type="number"
                  value={cfg.max_memory_mb ?? 256}
                  onChange={(e) => updateConfig('max_memory_mb', Number(e.target.value))}
                  inputProps={{ step: 16, min: 16, max: 4096 }}
                  helperText="内存限制（best-effort；不同平台可能不完全生效）。"
                />
                <TextField
                  fullWidth
                  size="small"
                  label="max_stdout_chars"
                  type="number"
                  value={cfg.max_stdout_chars ?? 10000}
                  onChange={(e) => updateConfig('max_stdout_chars', Number(e.target.value))}
                  inputProps={{ step: 1000, min: 1000, max: 200000 }}
                  helperText="print 输出会被截断并写入执行详情 stdout。"
                />
                <TextField
                  fullWidth
                  size="small"
                  label="max_input_bytes"
                  type="number"
                  value={cfg.max_input_bytes ?? 2000000}
                  onChange={(e) => updateConfig('max_input_bytes', Number(e.target.value))}
                  inputProps={{ step: 10000, min: 10000, max: 50000000 }}
                  helperText="限制 input_data + context 的 JSON 体积，避免爆内存/爆日志。"
                />
                <TextField
                  fullWidth
                  size="small"
                  label="max_result_bytes"
                  type="number"
                  value={cfg.max_result_bytes ?? 2000000}
                  onChange={(e) => updateConfig('max_result_bytes', Number(e.target.value))}
                  inputProps={{ step: 10000, min: 10000, max: 50000000 }}
                  helperText="限制 result 的 JSON 体积，超限会报错。"
                />
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
        </Box>
      )}

      {kind === 'output' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>format</InputLabel>
            <Select
              value={cfg.format || 'json'}
              label="format"
              onChange={(e) => updateConfig('format', e.target.value)}
            >
              <MenuItem value="json">json</MenuItem>
              <MenuItem value="text">text</MenuItem>
              <MenuItem value="markdown">markdown</MenuItem>
            </Select>
          </FormControl>
          <TextField
            inputRef={outputTemplateRef}
            fullWidth
            size="small"
            label="template（可选）"
            value={cfg.template || ''}
            onChange={(e) => {
              updateConfig('template', e.target.value);
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(e.target.value, el.selectionStart ?? el.value.length);
            }}
            onFocus={(e) => {
              const el = e.target as InputEl;
              setActiveEditing('template', el);
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
            onKeyDown={onTemplateKeyDown}
            onClick={(e) => {
              const el = e.target as InputEl;
              refreshTemplateAutocomplete(el.value, el.selectionStart ?? el.value.length);
            }}
            multiline
            minRows={4}
            helperText="留空则直接输出 input_data（兼容 data 包装）。"
          />
          <Typography variant="caption" color="text.secondary">
            输出模板支持 <code>{'{{变量}}'}</code>（推荐）或 Python format <code>{'{content}'}</code>（兼容旧用法，模板不包含 <code>{'{{'}</code> 时启用）。
          </Typography>
        </Box>
      )}

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
