import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Edge, Node } from 'reactflow';
import type { WorkflowEdgeData, WorkflowNodeData, WorkflowNodeKind } from './types';
import { NODE_SCHEMAS, type NodeFieldSchema } from './nodeSchemas';

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
      return ['prompt', 'documents', 'data'];
    case 'rag_retriever':
      return ['query', 'data'];
    case 'http_request':
      return ['url', 'data'];
    case 'condition':
      return ['value', 'data'];
    case 'code_executor':
      return ['input', 'data'];
    case 'output':
      return ['data'];
    case 'input':
    default:
      return [];
  }
}

function normalizeEdgeTarget(kind: WorkflowNodeKind | undefined, raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return '';
  const base = v.startsWith('input') ? 'input' : v;
  if (base === 'input') {
    if (kind === 'llm') return 'prompt';
    if (kind === 'rag_retriever') return 'query';
    if (kind === 'condition') return 'value';
  }
  return base;
}

type VariableOption = {
  edgeId: string;
  sourceNodeId: string;
  sourceName: string;
  sourceKind?: WorkflowNodeKind;
  outputKey: string;
};

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

export default function DifyNodeInspector({
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
  const { t } = useTranslation();
  const [tab, setTab] = useState<'settings' | 'last_run'>('settings');
  const cfg = node?.data.config || {};
  const kind = node?.data.kind;

  const schema = useMemo(() => {
    const k = kind as WorkflowNodeData['kind'] | undefined;
    return (k ? NODE_SCHEMAS[k] : []) || [];
  }, [kind]);

  const nodeInputs = useMemo(() => inputsForKind(kind), [kind]);
  const nodeOutputs = useMemo(() => outputsForKind(kind), [kind]);

  const incomingEdges = useMemo(() => {
    if (!node) return [] as Edge<WorkflowEdgeData>[];
    return (allEdges || []).filter((e) => e.target === node.id);
  }, [allEdges, node]);

  const variableOptions = useMemo(() => {
    if (!node) return [] as VariableOption[];
    const out: VariableOption[] = [];
    for (const e of incomingEdges) {
      const src = allNodes.find((n) => n.id === e.source);
      const sourceName = src?.data?.name || e.source;
      const sourceKind = src?.data?.kind;
      const outs = outputsForKind(sourceKind);
      for (const k of outs) {
        out.push({ edgeId: e.id, sourceNodeId: e.source, sourceName, sourceKind, outputKey: k });
      }
      // Ensure current selection is always selectable (even if schema changes)
      const cur = String(e.data?.source_output || e.sourceHandle || '').trim();
      if (cur && !outs.includes(cur)) {
        out.push({ edgeId: e.id, sourceNodeId: e.source, sourceName, sourceKind, outputKey: cur });
      }
    }
    return out;
  }, [allNodes, incomingEdges, node]);

  const bindingByInput = useMemo(() => {
    const map = new Map<string, { edgeId: string; sourceName: string; outputKey: string }>();
    if (!node) return map;
    for (const e of incomingEdges) {
      const target = normalizeEdgeTarget(kind, e.data?.target_input ?? e.targetHandle);
      if (!target) continue;
      const src = allNodes.find((n) => n.id === e.source);
      const sourceName = src?.data?.name || e.source;
      const outputKey = String(e.data?.source_output || e.sourceHandle || 'output');
      // Prefer first; advanced users can still fine-tune in edge selection elsewhere.
      if (!map.has(target)) map.set(target, { edgeId: e.id, sourceName, outputKey });
    }
    return map;
  }, [allNodes, incomingEdges, kind, node]);

  const title = useMemo(() => {
    if (!node) return t('workflow2.inspector.title');
    return node.data.name || t('workflow2.node.unnamed');
  }, [node, t]);

  const updateConfig = (key: string, value: any) => {
    if (!node) return;
    onChange({ config: { ...(node.data.config || {}), [key]: value } });
  };

  const findFirstOption = (pred: (o: VariableOption) => boolean, preferOutputs: string[]): VariableOption | null => {
    for (const p of preferOutputs) {
      const hit = variableOptions.find((o) => pred(o) && o.outputKey === p);
      if (hit) return hit;
    }
    return variableOptions.find(pred) || null;
  };

  const clearInputBinding = (targetInput: string) => {
    if (!node || !onUpdateEdge) return;
    const cur = bindingByInput.get(targetInput);
    if (!cur) return;
    // Move it back to a neutral key to avoid silent overwrites.
    onUpdateEdge(cur.edgeId, { target_input: 'data' });
  };

  const renderField = (f: NodeFieldSchema) => {
    const val = (cfg as any)?.[f.key];
    const fieldLabel = f.labelKey ? t(f.labelKey) : f.label;
    const helperText = f.helperTextKey ? t(f.helperTextKey) : f.helperText;
    const placeholder = f.placeholderKey ? t(f.placeholderKey) : f.placeholder;
    if (f.type === 'select') {
      const opts = typeof f.options === 'function' ? f.options({ knowledgeBases, availableChatModels }) : (f.options || []);
      return (
        <FormControl key={f.key} size="small" fullWidth>
          <InputLabel>{fieldLabel}</InputLabel>
          <Select
            label={fieldLabel}
            value={val ?? ''}
            onChange={(e) => updateConfig(f.key, e.target.value)}
          >
            {opts.map((o) => (
              <MenuItem key={`${f.key}_${o.value}`} value={o.value}>
                {o.labelKey ? t(o.labelKey) : (o.label ?? '')}
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
          size="small"
          fullWidth
          type="number"
          label={fieldLabel}
          value={val ?? ''}
          onChange={(e) => updateConfig(f.key, e.target.value === '' ? '' : Number(e.target.value))}
          helperText={helperText}
          inputProps={f.inputProps}
        />
      );
    }
    if (f.type === 'textarea' || f.type === 'template' || f.type === 'code') {
      return (
        <TextField
          key={f.key}
          size="small"
          fullWidth
          multiline
          minRows={f.minRows ?? 4}
          label={fieldLabel}
          value={typeof val === 'string' ? val : (val ?? '')}
          onChange={(e) => updateConfig(f.key, e.target.value)}
          helperText={helperText}
          placeholder={placeholder}
        />
      );
    }
    if (f.type === 'json_object') {
      return (
        <TextField
          key={f.key}
          size="small"
          fullWidth
          multiline
          minRows={f.minRows ?? 4}
          label={fieldLabel}
          value={typeof val === 'string' ? val : JSON.stringify(val ?? {}, null, 2)}
          onChange={(e) => {
            try {
              updateConfig(f.key, JSON.parse(e.target.value || '{}'));
            } catch {
              // keep raw string if invalid; user can fix it
              updateConfig(f.key, e.target.value);
            }
          }}
          helperText={helperText}
          placeholder={placeholder}
        />
      );
    }
    return (
      <TextField
        key={f.key}
        size="small"
        fullWidth
        label={fieldLabel}
        value={typeof val === 'string' ? val : (val ?? '')}
        onChange={(e) => updateConfig(f.key, e.target.value)}
        helperText={helperText}
        placeholder={placeholder}
      />
    );
  };

  const schemaByGroup = useMemo(() => {
    const map = new Map<string, NodeFieldSchema[]>();
    for (const f of schema) {
      const g = f.group || 'config';
      const list = map.get(g) || [];
      list.push(f);
      map.set(g, list);
    }
    return Array.from(map.entries());
  }, [schema]);

  const bindInput = (targetInput: string, opt: VariableOption | null) => {
    if (!node || !onUpdateEdge) return;
    if (!opt) {
      clearInputBinding(targetInput);
      return;
    }

    // Unbind previous edge that used this target (avoid ambiguous overwrite).
    for (const e of incomingEdges) {
      const t = normalizeEdgeTarget(kind, e.data?.target_input ?? e.targetHandle);
      if (t === targetInput && e.id !== opt.edgeId) {
        onUpdateEdge(e.id, { target_input: 'data' });
      }
    }
    onUpdateEdge(opt.edgeId, { source_output: opt.outputKey, target_input: targetInput });
  };

  const applyRecommendedBindings = (mode: 'basic' | 'rag_to_llm') => {
    if (!node || incomingEdges.length === 0) return;
    if (kind === 'llm') {
      const promptOpt = findFirstOption(
        (o) => o.sourceKind === 'input' || o.sourceKind === 'http_request' || o.sourceKind === 'condition' || o.sourceKind === 'code_executor' || o.sourceKind === 'rag_retriever',
        ['input', 'prompt', 'text', 'query', 'content', 'result']
      );
      bindInput('prompt', promptOpt);

      const dataOpt = findFirstOption((o) => o.sourceKind === 'input', ['data']);
      if (dataOpt) bindInput('data', dataOpt);

      if (mode === 'rag_to_llm') {
        const docsOpt = findFirstOption((o) => o.sourceKind === 'rag_retriever', ['documents']);
        if (docsOpt) bindInput('documents', docsOpt);
        const next = t('workflow2.inspector.ragToLlmSystemPromptTemplate');
        if (!String((cfg as any)?.system_prompt || '').trim()) updateConfig('system_prompt', next);
      }
    }
    if (kind === 'rag_retriever') {
      const qOpt = findFirstOption((o) => o.sourceKind === 'input', ['query', 'input', 'prompt', 'text']);
      bindInput('query', qOpt);
      const dataOpt = findFirstOption((o) => o.sourceKind === 'input', ['data']);
      if (dataOpt) bindInput('data', dataOpt);
    }
    if (kind === 'output') {
      const outOpt = findFirstOption(
        () => true,
        ['content', 'result', 'data', 'documents', 'response_data', 'stdout', 'text', 'prompt', 'query', 'input']
      );
      bindInput('data', outOpt);
    }
  };

  if (!node) {
    return (
      <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
          {t('workflow2.inspector.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('workflow2.inspector.emptyHint')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography variant="subtitle1" sx={{ fontWeight: 900 }} noWrap title={title}>
          {title}
        </Typography>
        <Button color="error" variant="outlined" size="small" onClick={onDelete}>
          {t('common.delete')}
        </Button>
      </Stack>
      <Divider sx={{ my: 1.5 }} />

      <TextField
        fullWidth
        size="small"
        label={t('workflow2.inspector.fields.nodeName')}
        value={node.data.name}
        onChange={(e) => onChange({ name: e.target.value })}
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label={t('workflow2.inspector.fields.description')}
        value={node.data.description || ''}
        onChange={(e) => onChange({ description: e.target.value })}
        sx={{ mb: 2 }}
      />

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="fullWidth" sx={{ mb: 2 }}>
        <Tab value="settings" label={t('workflow2.inspector.tabs.settings')} />
        <Tab value="last_run" label={t('workflow2.inspector.tabs.lastRun')} />
      </Tabs>

      {tab === 'last_run' && (
        <Alert severity="info">
          {t('workflow2.inspector.lastRunHint')}
        </Alert>
      )}

      {tab === 'settings' && (
        <Stack spacing={2}>
          {nodeInputs.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>
                {t('workflow2.inspector.sections.inputBindings')}
              </Typography>

              {incomingEdges.length === 0 && (
                <Alert severity="warning" sx={{ mb: 1.25 }}>
                  {t('workflow2.inspector.noUpstreamWarning')}
                </Alert>
              )}

              <Stack spacing={1.25}>
                {(kind === 'llm' || kind === 'rag_retriever' || kind === 'output') && (
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={incomingEdges.length === 0}
                      onClick={() => applyRecommendedBindings('basic')}
                    >
                      {t('workflow2.inspector.actions.recommendedBindings')}
                    </Button>
                    {kind === 'llm' && (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={incomingEdges.length === 0}
                        onClick={() => applyRecommendedBindings('rag_to_llm')}
                      >
                        {t('workflow2.inspector.actions.ragToLlm')}
                      </Button>
                    )}
                  </Stack>
                )}

                {nodeInputs.map((k) => {
                  const cur = bindingByInput.get(k);
                  const value = cur ? `${cur.edgeId}::${cur.outputKey}` : '';
                  return (
                    <Box key={`in_${k}`} sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {k}
                        </Typography>
                        {cur ? (
                          <Chip size="small" label={`${cur.sourceName}.${cur.outputKey}`} />
                        ) : (
                          <Chip size="small" variant="outlined" label={t('workflow2.inspector.unbound')} />
                        )}
                      </Stack>

                      <FormControl size="small" fullWidth sx={{ mt: 1 }} disabled={incomingEdges.length === 0}>
                        <InputLabel>{t('workflow2.inspector.fields.bindVariable')}</InputLabel>
                        <Select
                          label={t('workflow2.inspector.fields.bindVariable')}
                          value={value}
                          onChange={(e) => {
                            const raw = String(e.target.value || '');
                            if (!raw) {
                              bindInput(k, null);
                              return;
                            }
                            const [edgeId, outputKey] = raw.split('::');
                            const opt = variableOptions.find((o) => o.edgeId === edgeId && o.outputKey === outputKey) || null;
                            bindInput(k, opt);
                          }}
                        >
                          <MenuItem value="">
                            <em>{t('workflow2.inspector.clearBinding')}</em>
                          </MenuItem>
                          {variableOptions.map((o) => (
                            <MenuItem key={`${o.edgeId}::${o.outputKey}`} value={`${o.edgeId}::${o.outputKey}`}>
                              {o.sourceName}.{o.outputKey}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          )}

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>
              {t('workflow2.inspector.sections.settings')}
            </Typography>

            {schema.length === 0 && (
              <Alert severity="info">{t('workflow2.inspector.noConfig')}</Alert>
            )}

            <Stack spacing={1.5}>
              {schemaByGroup.map(([g, fields]) => (
                <Box key={g} sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800, mb: 1 }}>
                    {t(`workflow2.schema.groups.${g}`, { defaultValue: g })}
                  </Typography>
                  <Stack spacing={1.25}>
                    {fields.map(renderField)}
                    {kind === 'condition' && g === 'basic' && (
                      <>
                        <Button variant="outlined" onClick={() => onCreateBranches?.()} disabled={!onCreateBranches}>
                          {t('workflow2.inspector.actions.createBranches')}
                        </Button>
                        <Typography variant="caption" color="text.secondary">
                          {t('workflow2.inspector.createBranchesHint')}
                        </Typography>
                      </>
                    )}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>
              {t('workflow2.inspector.sections.outputs')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('workflow2.inspector.outputsHint')}
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {nodeOutputs.map((k) => (
                <Chip key={`out_${k}`} size="small" label={k} />
              ))}
            </Box>
          </Box>
        </Stack>
      )}
    </Paper>
  );
}
