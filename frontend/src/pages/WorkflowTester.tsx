import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, TextField, Button, IconButton, Divider, Chip, Alert, Stack, LinearProgress } from '@mui/material';
import { ArrowBack as BackIcon, Send as SendIcon, PlayArrow as PlayIcon, Stop as StopIcon } from '@mui/icons-material';
import { workflowApi } from '../services/api';

interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

const WorkflowTester: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
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
          setError(err?.message || '执行失败');
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
      setError(e?.message || '执行异常');
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

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Paper elevation={0} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton onClick={() => navigate(-1)}>
          <BackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>工作流测试（聊天）</Typography>
        {id && <Chip label={`ID: ${id}`} size="small" />}
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<StopIcon />} disabled={!running} onClick={() => { const c = cancelRef.current; if (c) { try { c(); } catch {} } }}>
            停止
          </Button>
        </Stack>
      </Paper>
      <Divider />

      <Box ref={listRef} sx={{ flex: 1, overflow: 'auto', p: 2, background: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : '#fafafa', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 2 }}>
        {messages.length === 0 && (
          <Alert severity="info">输入内容并发送，系统将使用当前工作流执行并返回结果。</Alert>
        )}
        <Box>
          {messages.map((m, idx) => (
            <Box key={idx} sx={{ display: 'flex', mb: 2, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <Box sx={{ maxWidth: '70%', px: 1.5, py: 1, borderRadius: 2, background: m.role === 'user' ? '#1976d2' : 'rgba(0,0,0,0.1)', color: m.role === 'user' ? '#fff' : 'inherit' }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
              </Box>
            </Box>
          ))}
          {running && (
            <Box sx={{ color: 'text.secondary' }}>执行中...</Box>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>
          )}
        </Box>
        {/* 侧边进度面板 */}
        <Box sx={{ position: 'sticky', top: 0, height: 'fit-content' }}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>执行进度</Typography>
            {progress.length === 0 && (
              <Typography variant="caption" color="text.secondary">暂无进度</Typography>
            )}
            {progress.map((p, i) => (
              <Box key={i} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">{p?.node_id || p?.step || `步骤 ${i+1}`}</Typography>
                <LinearProgress variant="determinate" value={p?.percent || 0} sx={{ height: 6, borderRadius: 3 }} />
              </Box>
            ))}
          </Paper>
        </Box>
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', gap: 1 }}>
        <TextField fullWidth placeholder="输入问题..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
        <Button variant="contained" startIcon={running ? <PlayIcon /> : <SendIcon />} onClick={onSend} disabled={running}>
          发送
        </Button>
      </Box>
    </Box>
  );
};

export default WorkflowTester;
