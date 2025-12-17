import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, TextField, Button, IconButton, Divider, Chip, Alert, Stack, LinearProgress, useMediaQuery, MenuItem, Switch, FormControlLabel } from '@mui/material';
import { ArrowBack as BackIcon, Send as SendIcon, PlayArrow as PlayIcon, Stop as StopIcon, History as HistoryIcon } from '@mui/icons-material';
import { workflowApi } from '../services/api';
import { useTranslation } from 'react-i18next';
import { alpha, useTheme } from '@mui/material/styles';

interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

const WorkflowTester: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<null | (() => void)>(null);
  const [progress, setProgress] = useState<any[]>([]);
  const [ioSchema, setIoSchema] = useState<any | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, any>>({ data: '{}' });
  const [paramErrors, setParamErrors] = useState<string[]>([]);
  const gotResultRef = useRef(false);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setSchemaLoading(true);
    setSchemaError(null);
    workflowApi
      .getIOSchema(id)
      .then((res: any) => {
        if (!alive) return;
        const data = res?.data || null;
        setIoSchema(data);

        const props = (data?.input_schema?.properties || {}) as Record<string, any>;
        const next: Record<string, any> = {};
        for (const [k, v] of Object.entries(props)) {
          if (k === 'text' || k === 'input') continue; // reuse bottom input bar
          const typ = String((v as any)?.type || 'string');
          if ((v as any)?.default !== undefined) {
            next[k] = typ === 'object' || typ === 'array' ? JSON.stringify((v as any).default, null, 2) : (v as any).default;
          } else if (k === 'data') {
            next[k] = '{}';
          } else if (typ === 'boolean') {
            next[k] = false;
          } else {
            next[k] = '';
          }
        }
        setParamValues((prev) => ({ ...next, data: next.data ?? prev.data ?? '{}' }));
      })
      .catch((e: any) => {
        if (!alive) return;
        setSchemaError(e?.response?.data?.detail || e?.message || '加载 schema 失败');
        setIoSchema(null);
      })
      .finally(() => {
        if (!alive) return;
        setSchemaLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const buildInputData = () => {
    const props = (ioSchema?.input_schema?.properties || {}) as Record<string, any>;
    const required = (ioSchema?.input_schema?.required || []) as string[];
    const errors: string[] = [];

    const inputData: any = {};
    const text = input.trim();
    const hasOtherParams = (() => {
      for (const [k, v] of Object.entries(paramValues || {})) {
        if (k === 'text' || k === 'input') continue;
        if (v === undefined || v === null) continue;
        const s = typeof v === 'string' ? v.trim() : v;
        if (k === 'data' && typeof s === 'string' && (s === '' || s === '{}' || s === 'null')) continue;
        if (typeof s === 'string' && s === '') continue;
        if (typeof s === 'boolean' && s === false) continue;
        return true;
      }
      return false;
    })();
    if ((required.includes('text') || required.includes('input')) && !text) {
      errors.push(`缺少必填参数：${required.includes('input') ? 'input' : 'text'}`);
    }
    if (!text && !hasOtherParams) {
      errors.push('请输入 input 或填写参数后再执行');
    }
    if (text) {
      inputData.input = text;
      inputData.text = text;
      inputData.prompt = text;
      inputData.query = text;
    }

    for (const key of Object.keys(props)) {
      if (key === 'text' || key === 'input') continue;
      const schemaProp: any = props[key] || {};
      const typ = String(schemaProp?.type || 'string');
      const raw = paramValues[key];

      const isMissing =
        raw === undefined || raw === null || raw === '' || (typ === 'object' && String(raw || '').trim() === '') || (typ === 'array' && String(raw || '').trim() === '');
      if (required.includes(key) && isMissing) errors.push(`缺少必填参数：${key}`);

      if (isMissing) continue;

      if (typ === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) errors.push(`参数 ${key} 需要是数字`);
        else inputData[key] = n;
      } else if (typ === 'boolean') {
        inputData[key] = !!raw;
      } else if (typ === 'object' || typ === 'array') {
        try {
          inputData[key] = JSON.parse(String(raw));
        } catch {
          errors.push(`参数 ${key} 不是合法 JSON`);
        }
      } else {
        inputData[key] = raw;
      }
    }

    setParamErrors(errors);
    if (errors.length) return { ok: false as const, inputData: null as any, errors };
    return { ok: true as const, inputData, errors: [] as string[] };
  };

  const runOnce = async () => {
    if (!id) return;
    setRunning(true);
    setError(null);
    setProgress([]);
    setParamErrors([]);
    gotResultRef.current = false;

    const built = buildInputData();
    if (!built.ok) {
      // Avoid “没反应”：把参数错误也显示到主区域
      setError(built.errors.join('；') || '参数校验失败');
      setRunning(false);
      return;
    }

    const payload = { input_data: built.inputData, debug: false };

    try {
      const { cancel, promise } = workflowApi.executeStreamCancelable(
        id,
        payload,
        (evt) => {
          setProgress((prev) => prev.concat(evt));
        },
        (err) => {
          setError(err?.message || t('workflowTester.errors.executeFailed'));
          setRunning(false);
        },
        (result) => {
          try {
            if (result == null) {
              if (!gotResultRef.current) {
                setMessages((msgs) =>
                  msgs.concat([{ role: 'assistant', content: '执行完成，但没有返回结果（可能被中断或后端未返回 complete payload）', timestamp: Date.now() }])
                );
              }
              return;
            }
            gotResultRef.current = true;
            let out = result?.result?.output_data ?? result?.output_data ?? result;
            // Unwrap common {result: ...} shape, but keep object when result is empty (avoid “没反应”)
            if (out && typeof out === 'object' && 'result' in out && Object.keys(out).length <= 2) {
              const r: any = (out as any).result;
              if (typeof r === 'string') {
                if (r.trim() !== '') out = r;
              } else if (r !== undefined) {
                out = r;
              }
            }
            const textOut =
              typeof out === 'string'
                ? out
                : (out?.content || out?.text || out?.message || out?.answer || JSON.stringify(out));
            setMessages((msgs) => msgs.concat([{ role: 'assistant', content: textOut, timestamp: Date.now() }]));
          } finally {
            setRunning(false);
          }
        }
      );
      cancelRef.current = cancel;
      await promise;
      cancelRef.current = null;
    } catch (e: any) {
      setError(e?.message || t('workflowTester.errors.executeError'));
      setRunning(false);
    }
  };

  const onSend = async () => {
    const text = input.trim();
    if (running) return;
    if (text) {
      setMessages((msgs) => msgs.concat([{ role: 'user', content: text, timestamp: Date.now() }]));
      setInput('');
    }
    await runOnce();
  };

  const ProgressPanel = (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('workflowTester.progress.title')}
      </Typography>
      {progress.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          {t('workflowTester.progress.empty')}
        </Typography>
      )}
      {progress.map((p, i) => (
        <Box key={i} sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {(() => {
              const stepLike: any = (p && (p.step ?? p.data ?? p)) || {};
              const label =
                stepLike.node_name ??
                stepLike.nodeName ??
                stepLike.node_id ??
                stepLike.nodeId ??
                stepLike.step_id ??
                stepLike.stepId ??
                stepLike.step ??
                null;

              const base = (typeof label === 'string' || typeof label === 'number')
                ? String(label)
                : (
                    stepLike.nodeName ||
                    stepLike.node_name ||
                    stepLike.id ||
                    t('workflowTester.progress.step', { index: i + 1 })
                  );

              const status = stepLike.status ? String(stepLike.status) : '';
              const dur = Number(stepLike.duration);
              const durTxt = Number.isFinite(dur) && dur > 0 ? `${dur.toFixed(2)}s` : '';
              const extra = [status, durTxt].filter(Boolean).join(' · ');

              return extra ? `${base} · ${extra}` : base;
            })()}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={(() => {
              const stepLike: any = (p && (p.step ?? p.data ?? p)) || {};
              const v =
                stepLike.percent ??
                stepLike.progress ??
                stepLike.percentage ??
                stepLike.completed_percent ??
                (() => {
                  const prog = (p && (p.progress ?? stepLike.progress)) || null;
                  const cur = Number(prog?.current);
                  const total = Number(prog?.total);
                  if (Number.isFinite(cur) && Number.isFinite(total) && total > 0) {
                    return (cur / total) * 100;
                  }
                  return 0;
                })();
              const n = Number(v);
              return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
            })()}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>
      ))}
    </Paper>
  );

  const ParameterPanel = (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        参数
      </Typography>
      {schemaLoading && (
        <Typography variant="caption" color="text.secondary">
          加载 schema...
        </Typography>
      )}
      {schemaError && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {schemaError}
        </Alert>
      )}
      {paramErrors.length > 0 && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {paramErrors.join('；')}
        </Alert>
      )}
      {(() => {
        const props = (ioSchema?.input_schema?.properties || {}) as Record<string, any>;
        const required = (ioSchema?.input_schema?.required || []) as string[];
        const keys = Object.keys(props).filter((k) => k !== 'text' && k !== 'input');
        if (!keys.length) {
          return (
            <Typography variant="caption" color="text.secondary">
              未推导出结构化参数：可直接在底部输入文本执行。
            </Typography>
          );
        }
        return (
          <Stack spacing={1}>
            {keys.map((k) => {
              const p: any = props[k] || {};
              const typ = String(p?.type || 'string');
              const isRequired = required.includes(k);
              const label = `${k}${isRequired ? '（必填）' : ''}`;
              const helper = String(p?.description || '');
              const enumVals: any[] | null = Array.isArray(p?.enum) ? p.enum : null;

              if (typ === 'boolean') {
                return (
                  <FormControlLabel
                    key={k}
                    control={
                      <Switch
                        checked={!!paramValues[k]}
                        onChange={(e) => setParamValues((prev) => ({ ...prev, [k]: e.target.checked }))}
                      />
                    }
                    label={label}
                  />
                );
              }

              if (enumVals) {
                return (
                  <TextField
                    key={k}
                    select
                    fullWidth
                    size="small"
                    label={label}
                    value={paramValues[k] ?? ''}
                    onChange={(e) => setParamValues((prev) => ({ ...prev, [k]: e.target.value }))}
                    helperText={helper || '请选择'}
                  >
                    {enumVals.map((v, idx) => (
                      <MenuItem key={idx} value={v}>
                        {String(v)}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              }

              const isJson = typ === 'object' || typ === 'array';
              return (
                <TextField
                  key={k}
                  fullWidth
                  size="small"
                  label={label}
                  value={paramValues[k] ?? ''}
                  onChange={(e) => setParamValues((prev) => ({ ...prev, [k]: e.target.value }))}
                  helperText={helper || (isJson ? '输入 JSON' : '')}
                  multiline={isJson}
                  minRows={isJson ? 4 : undefined}
                  inputProps={typ === 'number' ? { inputMode: 'numeric' } : undefined}
                />
              );
            })}
          </Stack>
        );
      })()}
      {ioSchema?.output_schema?.properties && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            预期输出字段：{Object.keys(ioSchema.output_schema.properties || {}).join(', ') || '（未知）'}
          </Typography>
        </Box>
      )}
    </Paper>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Paper elevation={0} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <IconButton onClick={() => navigate(-1)}>
          <BackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>
          {t('workflowTester.title')}
        </Typography>
        {id && <Chip label={`ID: ${id}`} size="small" />}
        <Stack direction="row" spacing={1}>
          {id && (
            <Button size="small" variant="outlined" startIcon={<HistoryIcon />} onClick={() => navigate(`/workflows/${id}/executions`)}>
              历史
            </Button>
          )}
          <Button size="small" variant="outlined" startIcon={<StopIcon />} disabled={!running} onClick={() => { const c = cancelRef.current; if (c) { try { c(); } catch {} } }}>
            {t('workflowTester.actions.stop')}
          </Button>
        </Stack>
      </Paper>
      <Divider />

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: isMdUp ? '1fr 340px' : '1fr', gap: 2 }}>
        <Box
          ref={listRef}
          sx={{
            overflow: 'auto',
            p: 2,
            background: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : '#fafafa',
            minWidth: 0,
          }}
        >
          {messages.length === 0 && (
            <Alert severity="info">
              {t('workflowTester.emptyHint')}
            </Alert>
          )}
          {messages.map((m, idx) => (
            <Box key={idx} sx={{ display: 'flex', mb: 2, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <Box
                sx={{
                  maxWidth: '75%',
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  background: m.role === 'user'
                    ? theme.palette.primary.main
                    : alpha(theme.palette.background.paper, 0.6),
                  color: m.role === 'user' ? theme.palette.primary.contrastText : 'inherit',
                  border: m.role === 'user'
                    ? `1px solid ${alpha(theme.palette.primary.light, 0.6)}`
                    : `1px solid ${alpha(theme.palette.divider, 0.6)}`,
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
              </Box>
            </Box>
          ))}
          {running && (
            <Box sx={{ color: 'text.secondary' }}>{t('workflowTester.running')}</Box>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>
          )}
          {!isMdUp && (
            <Box sx={{ mt: 2 }}>
              {ParameterPanel}
              <Box sx={{ mt: 2 }} />
              {ProgressPanel}
            </Box>
          )}
        </Box>
        {isMdUp && (
          <Box sx={{ p: 2, pr: 0, overflow: 'auto' }}>
            {ParameterPanel}
            <Box sx={{ mt: 2 }} />
            {ProgressPanel}
          </Box>
        )}
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', gap: 1, flexShrink: 0 }}>
        <TextField
          fullWidth
          placeholder={t('workflowTester.inputPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          disabled={running}
        />
        <Button
          variant="contained"
          startIcon={running ? <PlayIcon /> : <SendIcon />}
          onClick={onSend}
          disabled={running}
        >
          {t('workflowTester.actions.send')}
        </Button>
      </Box>
    </Box>
  );
};

export default WorkflowTester;
