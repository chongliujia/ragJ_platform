import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon, ContentCopy as CopyIcon, Delete as DeleteIcon, Refresh as RefreshIcon, Visibility as ShowIcon, VisibilityOff as HideIcon } from '@mui/icons-material';
import { apiKeyApi } from '../services/api';
import { resolvePublicApiBaseUrl } from '../utils/publicApi';

type ApiKeyRow = {
  id: number;
  name: string;
  key: string;
  tenant_id: number;
  scopes: string;
  allowed_kb?: string | null;
  allowed_workflow_id?: string | null;
  rate_limit_per_min: number;
  revoked: boolean;
  created_at?: string;
  expires_at?: string | null;
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function maskKey(key: string) {
  const s = String(key || '');
  if (s.length <= 10) return '••••••••••';
  return `${s.slice(0, 4)}••••••••••${s.slice(-4)}`;
}

const ApiKeysManager: React.FC = () => {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    scopes: 'chat,workflow',
    allowed_kb: '',
    allowed_workflow_id: '',
    rate_limit_per_min: 60,
    expire_in_days: '',
  });

  const [reveal, setReveal] = useState<Record<number, boolean>>({});

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiKeyApi.list();
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || '获取 API Keys 失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const publicApiHint = useMemo(() => {
    const base = resolvePublicApiBaseUrl();
    const full = base
      ? [
          `POST ${base}/api/v1/public/workflows/{workflow_id}/run`,
          `POST ${base}/api/v1/public/workflows/{workflow_id}/run/stream`,
          `GET  ${base}/api/v1/public/workflows/{workflow_id}/io-schema`,
        ].join('\n')
      : '';
    const relative = [
      'POST /api/v1/public/workflows/{workflow_id}/run',
      'POST /api/v1/public/workflows/{workflow_id}/run/stream',
      'GET  /api/v1/public/workflows/{workflow_id}/io-schema',
    ].join('\n');
    return full ? `${full}\n\n# relative\n${relative}` : relative;
  }, []);

  const createKey = useCallback(async () => {
    const name = form.name.trim();
    if (!name) {
      setSnack({ type: 'error', message: '请填写名称' });
      return;
    }
    setCreating(true);
    try {
      const payload: any = {
        name,
        scopes: form.scopes.trim() || 'chat,workflow',
        rate_limit_per_min: Number(form.rate_limit_per_min || 60),
      };
      if (form.allowed_kb.trim()) payload.allowed_kb = form.allowed_kb.trim();
      if (form.allowed_workflow_id.trim()) payload.allowed_workflow_id = form.allowed_workflow_id.trim();
      if (String(form.expire_in_days || '').trim()) payload.expire_in_days = Number(form.expire_in_days);
      const res = await apiKeyApi.create(payload);
      const created = res.data as ApiKeyRow;
      setSnack({ type: 'success', message: 'API Key 已创建（可复制 Key）' });
      try {
        if (created?.key) await copyToClipboard(created.key);
      } catch {
        // ignore
      }
      setCreateOpen(false);
      setForm({ name: '', scopes: 'chat,workflow', allowed_kb: '', allowed_workflow_id: '', rate_limit_per_min: 60, expire_in_days: '' });
      await fetchList();
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || '创建失败' });
    } finally {
      setCreating(false);
    }
  }, [fetchList, form]);

  const revoke = useCallback(
    async (id: number) => {
      if (!id) return;
      setLoading(true);
      try {
        await apiKeyApi.revoke(id);
        setSnack({ type: 'success', message: '已吊销' });
        await fetchList();
      } catch (e: any) {
        setSnack({ type: 'error', message: e?.response?.data?.detail || '吊销失败' });
      } finally {
        setLoading(false);
      }
    },
    [fetchList]
  );

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 900, flex: 1 }}>
          API Keys
        </Typography>
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={fetchList} disabled={loading}>
          刷新
        </Button>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          新建
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 1.5 }}>
        <Typography variant="body2">
          Public API（对外调用）需要请求头 <Box component="span" sx={{ fontFamily: 'monospace' }}>x-api-key</Box>。
          跨租户运行公开工作流时，请将 API Key 绑定 <Box component="span" sx={{ fontFamily: 'monospace' }}>allowed_workflow_id</Box>。
        </Typography>
        <Box component="pre" sx={{ m: 0, mt: 0.75, p: 1, borderRadius: 1, bgcolor: 'background.default', overflow: 'auto' }}>
          {publicApiHint}
        </Box>
      </Alert>

      <Paper variant="outlined" sx={{ overflow: 'auto' }}>
        <Table size="small" sx={{ minWidth: 880 }}>
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell>Key</TableCell>
              <TableCell>Scopes</TableCell>
              <TableCell>allowed_workflow_id</TableCell>
              <TableCell>allowed_kb</TableCell>
              <TableCell>限流</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{r.name}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Box component="span">{reveal[r.id] ? r.key : maskKey(r.key)}</Box>
                    <IconButton size="small" onClick={() => setReveal((m) => ({ ...m, [r.id]: !m[r.id] }))} aria-label="显示/隐藏">
                      {reveal[r.id] ? <HideIcon fontSize="small" /> : <ShowIcon fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" onClick={() => void copyToClipboard(r.key)} aria-label="复制 Key">
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </TableCell>
                <TableCell>{r.scopes || '-'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.allowed_workflow_id || '-'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.allowed_kb || '-'}</TableCell>
                <TableCell>{r.rate_limit_per_min}/min</TableCell>
                <TableCell>{r.revoked ? 'revoked' : 'active'}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" disabled={r.revoked || loading} onClick={() => void revoke(r.id)} aria-label="吊销">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="caption" color="text.secondary">
                    {loading ? '加载中…' : '暂无 API Key'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>新建 API Key</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={1.25}>
            <TextField
              label="名称"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              size="small"
              fullWidth
              autoFocus
            />
            <TextField
              label="Scopes（逗号分隔）"
              value={form.scopes}
              onChange={(e) => setForm((p) => ({ ...p, scopes: e.target.value }))}
              size="small"
              fullWidth
              helperText="例如：chat,workflow"
            />
            <Divider />
            <TextField
              label="allowed_workflow_id（跨租户/限制访问时建议填写）"
              value={form.allowed_workflow_id}
              onChange={(e) => setForm((p) => ({ ...p, allowed_workflow_id: e.target.value }))}
              size="small"
              fullWidth
              helperText="绑定到某个 workflow_id，可用于跨租户运行公开工作流。"
            />
            <TextField
              label="allowed_kb（可选）"
              value={form.allowed_kb}
              onChange={(e) => setForm((p) => ({ ...p, allowed_kb: e.target.value }))}
              size="small"
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label="rate_limit_per_min"
                value={form.rate_limit_per_min}
                onChange={(e) => setForm((p) => ({ ...p, rate_limit_per_min: Number(e.target.value) }))}
                size="small"
                fullWidth
                inputProps={{ inputMode: 'numeric' }}
              />
              <TextField
                label="expire_in_days（可选）"
                value={form.expire_in_days}
                onChange={(e) => setForm((p) => ({ ...p, expire_in_days: e.target.value }))}
                size="small"
                fullWidth
                inputProps={{ inputMode: 'numeric' }}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            取消
          </Button>
          <Button variant="contained" onClick={() => void createKey()} disabled={creating}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        message={snack?.message || ''}
      />
    </Box>
  );
};

export default ApiKeysManager;
