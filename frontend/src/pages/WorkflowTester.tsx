import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, TextField, Button, IconButton, Divider, Chip, Alert, Stack, LinearProgress, useMediaQuery } from '@mui/material';
import { ArrowBack as BackIcon, Send as SendIcon, PlayArrow as PlayIcon, Stop as StopIcon } from '@mui/icons-material';
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

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const runOnce = async (text: string) => {
    if (!id) return;
    setRunning(true);
    setError(null);
    setProgress([]);

    // 将用户输入映射到常见字段，便于多种工作流直接复用
    const payload = {
      input_data: {
        prompt: text,
        query: text,
        text
      },
      debug: false
    };

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
            const out = (result && result.result && result.result.output_data) || result.output_data || result;
            const textOut = typeof out === 'string' ? out : (out?.content || out?.text || JSON.stringify(out));
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
    if (!text || running) return;
    setMessages((msgs) => msgs.concat([{ role: 'user', content: text, timestamp: Date.now() }]));
    setInput('');
    await runOnce(text);
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

              if (typeof label === 'string' || typeof label === 'number') return String(label);
              if (label && typeof label === 'object') {
                // Avoid rendering raw objects in React children
                return (
                  stepLike.nodeName ||
                  stepLike.node_name ||
                  stepLike.id ||
                  t('workflowTester.progress.step', { index: i + 1 })
                );
              }
              return t('workflowTester.progress.step', { index: i + 1 });
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
                0;
              const n = Number(v);
              return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
            })()}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>
      ))}
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
              {ProgressPanel}
            </Box>
          )}
        </Box>
        {isMdUp && (
          <Box sx={{ p: 2, pr: 0, overflow: 'auto' }}>
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
