import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  TablePagination,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ArrowBack as BackIcon, Refresh as RefreshIcon, Replay as ReplayIcon, Edit as EditIcon } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { workflowApi } from '../services/api';

type ExecutionRow = {
  execution_id: string;
  workflow_id: string;
  status: string;
  start_time?: string | null;
  end_time?: string | null;
  duration?: number | null;
  total_steps?: number | null;
  completed_steps?: number | null;
  failed_steps?: number | null;
  error_message?: string | null;
  created_at?: string | null;
  executed_by?: number | null;
};

type ExecutionStep = {
  step_id: string;
  node_id: string;
  node_name: string;
  status?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  duration?: number | null;
  input?: any;
  output?: any;
  error?: string | null;
  metrics?: any;
};

type ExecutionDetail = {
  execution_id: string;
  workflow_id: string;
  status: string;
  start_time?: number | null;
  end_time?: number | null;
  duration?: number | null;
  input_data?: any;
  output_data?: any;
  error?: any;
  metrics?: any;
  steps?: ExecutionStep[];
};

function toPrettyJson(value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTimeIso(iso?: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function statusColor(status: string | undefined | null): 'success' | 'warning' | 'error' | 'default' {
  const s = String(status || '').toLowerCase();
  if (s.includes('success') || s.includes('completed') || s === 'done') return 'success';
  if (s.includes('running') || s.includes('pending')) return 'warning';
  if (s.includes('fail') || s.includes('error')) return 'error';
  return 'default';
}

const WorkflowExecutions: React.FC = () => {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));

  const [rows, setRows] = useState<ExecutionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [snack, setSnack] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const selectedExecutionId = sp.get('execution') || '';

  const fetchList = useCallback(async () => {
    if (!id) return;
    setLoadingList(true);
    try {
      const res = await workflowApi.getExecutionHistory(id, { limit, offset });
      const data = res.data || {};
      const executions = Array.isArray(data.executions) ? data.executions : [];
      setRows(executions);
      setTotal(Number(data.total || 0));
      if (!selectedExecutionId && executions[0]?.execution_id) {
        setSp((prev) => {
          const next = new URLSearchParams(prev);
          next.set('execution', executions[0].execution_id);
          return next;
        });
      }
    } catch (e: any) {
      setSnack({ type: 'error', message: e?.response?.data?.detail || '获取执行历史失败' });
    } finally {
      setLoadingList(false);
    }
  }, [id, limit, offset, selectedExecutionId, setSp]);

  const fetchDetail = useCallback(async () => {
    if (!id || !selectedExecutionId) return;
    setLoadingDetail(true);
    try {
      const res = await workflowApi.getExecutionDetail(id, selectedExecutionId);
      setDetail(res.data || null);
    } catch (e: any) {
      setDetail(null);
      setSnack({ type: 'error', message: e?.response?.data?.detail || '获取执行详情失败' });
    } finally {
      setLoadingDetail(false);
    }
  }, [id, selectedExecutionId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const failedSteps = useMemo(() => {
    const steps = detail?.steps || [];
    return steps.filter((s) => statusColor(s.status) === 'error' || (s.error && String(s.error).trim()));
  }, [detail?.steps]);

  const retryFromNode = useCallback(
    async (nodeId: string) => {
      if (!id || !detail?.execution_id || !nodeId) return;
      try {
        setSnack({ type: 'info', message: '正在重试…' });
        const res = await workflowApi.retryStep(id, detail.execution_id, nodeId);
        const newId = res.data?.execution_id;
        if (newId) {
          setSp((prev) => {
            const next = new URLSearchParams(prev);
            next.set('execution', newId);
            return next;
          });
          setSnack({ type: 'success', message: `已创建重试执行：${newId}` });
        } else {
          setSnack({ type: 'success', message: '重试已触发' });
        }
        await fetchList();
      } catch (e: any) {
        setSnack({ type: 'error', message: e?.response?.data?.detail || '重试失败' });
      }
    },
    [detail?.execution_id, fetchList, id, setSp]
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Paper elevation={0} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <IconButton onClick={() => navigate(-1)}>
          <BackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>
          执行历史
        </Typography>
        {id && <Chip label={`Workflow: ${id}`} size="small" />}
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => {
              fetchList();
              fetchDetail();
            }}
          >
            刷新
          </Button>
          <Button size="small" variant="contained" onClick={() => navigate(`/workflows/${id}/test`)}>
            去执行
          </Button>
        </Stack>
      </Paper>
      <Divider />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: isMdUp ? '380px 1fr' : '1fr',
          gap: 2,
          p: 2,
        }}
      >
        <Paper variant="outlined" sx={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              执行列表
            </Typography>
            <Typography variant="caption" color="text.secondary">
              只显示你有权限查看的执行记录。
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {loadingList && (
              <Box sx={{ p: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  加载中…
                </Typography>
              </Box>
            )}
            {!loadingList && rows.length === 0 && (
              <Box sx={{ p: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  暂无执行记录
                </Typography>
              </Box>
            )}
            <List dense disablePadding>
              {rows.map((r) => {
                const active = r.execution_id === selectedExecutionId;
                return (
                  <ListItemButton
                    key={r.execution_id}
                    selected={active}
                    onClick={() => {
                      setSp((prev) => {
                        const next = new URLSearchParams(prev);
                        next.set('execution', r.execution_id);
                        return next;
                      });
                    }}
                    sx={{
                      alignItems: 'flex-start',
                      gap: 1,
                      py: 1.25,
                      px: 1.5,
                      borderBottom: `1px solid ${theme.palette.divider}`,
                    }}
                  >
                    <Chip size="small" label={r.status || '-'} color={statusColor(r.status)} sx={{ mt: 0.2 }} />
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {r.execution_id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatTimeIso(r.created_at)}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.25, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="caption" color="text.secondary">
                            用时: {r.duration ?? '-'}s
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            步骤: {r.completed_steps ?? 0}/{r.total_steps ?? 0}
                          </Typography>
                          {!!r.failed_steps && (
                            <Typography variant="caption" color="error">
                              失败: {r.failed_steps}
                            </Typography>
                          )}
                          {!!r.error_message && (
                            <Typography variant="caption" color="error">
                              {String(r.error_message).slice(0, 60)}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
          <TablePagination
            component="div"
            count={total}
            page={Math.floor(offset / limit)}
            onPageChange={(_, nextPage) => setOffset(nextPage * limit)}
            rowsPerPage={limit}
            onRowsPerPageChange={(e) => {
              const next = Number(e.target.value);
              setLimit(next);
              setOffset(0);
            }}
            rowsPerPageOptions={[10, 20, 50]}
          />
        </Paper>

        <Paper variant="outlined" sx={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              执行详情
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {selectedExecutionId ? `Execution: ${selectedExecutionId}` : '请选择一条执行记录'}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5 }}>
            {loadingDetail && (
              <Typography variant="caption" color="text.secondary">
                加载中…
              </Typography>
            )}
            {!loadingDetail && !detail && (
              <Alert severity="info">请选择一条执行记录查看步骤详情。</Alert>
            )}
            {!loadingDetail && detail && (
              <Box>
                <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip label={detail.status || '-'} color={statusColor(detail.status)} size="small" />
                  {detail.duration != null && <Chip label={`用时 ${detail.duration}s`} size="small" />}
                  {!!failedSteps.length && <Chip label={`失败步骤 ${failedSteps.length}`} color="error" size="small" />}
                  <Button
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={() => navigate(`/workflows/${id}/edit`)}
                  >
                    打开编辑器
                  </Button>
                </Stack>

                {!!failedSteps.length && (
                  <Paper variant="outlined" sx={{ p: 1, mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      失败节点定位：
                    </Typography>
                    <Box sx={{ mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {failedSteps.slice(0, 10).map((s) => (
                        <Chip
                          key={s.step_id}
                          size="small"
                          color="error"
                          label={`${s.node_name || s.node_id}`}
                          onClick={() => navigate(`/workflows/${id}/edit?node=${encodeURIComponent(s.node_id)}`)}
                        />
                      ))}
                      {failedSteps.length > 10 && (
                        <Chip size="small" label={`+${failedSteps.length - 10}`} />
                      )}
                    </Box>
                  </Paper>
                )}

                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography sx={{ fontWeight: 700 }}>本次输入 / 输出</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          input_data
                        </Typography>
                        <Box component="pre" sx={{ m: 0, mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'background.default', overflow: 'auto' }}>
                          {toPrettyJson(detail.input_data)}
                        </Box>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          output_data
                        </Typography>
                        <Box component="pre" sx={{ m: 0, mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'background.default', overflow: 'auto' }}>
                          {toPrettyJson(detail.output_data)}
                        </Box>
                      </Box>
                      {!!detail.error && (
                        <Alert severity="error">{typeof detail.error === 'string' ? detail.error : toPrettyJson(detail.error)}</Alert>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>

                <Divider sx={{ my: 1.5 }} />

                {(detail.steps || []).map((s, idx) => {
                  const hasErr = statusColor(s.status) === 'error' || !!(s.error && String(s.error).trim());
                  return (
                    <Accordion key={s.step_id} defaultExpanded={hasErr}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', width: '100%' }}>
                          <Typography sx={{ fontWeight: 800 }}>
                            #{idx + 1} {s.node_name || s.node_id}
                          </Typography>
                          <Chip size="small" label={s.status || '-'} color={statusColor(s.status)} />
                          {s.duration != null && (
                            <Typography variant="caption" color="text.secondary">
                              {s.duration}s
                            </Typography>
                          )}
                          <Box sx={{ flex: 1 }} />
                          <Button
                            size="small"
                            startIcon={<EditIcon />}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/workflows/${id}/edit?node=${encodeURIComponent(s.node_id)}`);
                            }}
                          >
                            定位
                          </Button>
                          <Button
                            size="small"
                            color={hasErr ? 'error' : 'inherit'}
                            startIcon={<ReplayIcon />}
                            onClick={(e) => {
                              e.stopPropagation();
                              retryFromNode(s.node_id);
                            }}
                          >
                            从此步重试
                          </Button>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Stack spacing={1}>
                          {!!s.error && <Alert severity="error">{String(s.error)}</Alert>}
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              input
                            </Typography>
                            <Box component="pre" sx={{ m: 0, mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'background.default', overflow: 'auto' }}>
                              {toPrettyJson(s.input)}
                            </Box>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              output
                            </Typography>
                            <Box component="pre" sx={{ m: 0, mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'background.default', overflow: 'auto' }}>
                              {toPrettyJson(s.output)}
                            </Box>
                          </Box>
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  );
                })}
              </Box>
            )}
          </Box>
        </Paper>
      </Box>

      <Snackbar
        open={!!snack}
        autoHideDuration={2500}
        onClose={() => setSnack(null)}
        message={snack?.message || ''}
      />
    </Box>
  );
};

export default WorkflowExecutions;
