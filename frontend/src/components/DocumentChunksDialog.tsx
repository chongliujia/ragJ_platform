import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Tooltip,
  Divider,
  TablePagination,
} from '@mui/material';
import { Close as CloseIcon, ContentCopy as CopyIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { documentApi } from '../services/api';

interface DocumentChunksDialogProps {
  open: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  documentId: string;
  filename?: string;
  totalChunks?: number;
}

interface ChunkItem {
  id: number;
  chunk_index: number;
  text: string;
}

const DEFAULT_ROWS_PER_PAGE = 100;

const DocumentChunksDialog: React.FC<DocumentChunksDialogProps> = ({
  open,
  onClose,
  knowledgeBaseId,
  documentId,
  filename,
  totalChunks,
}) => {
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  const loadPage = async (nextPage: number, nextRowsPerPage: number) => {
    try {
      setLoading(true);
      setError(null);
      const currentOffset = Math.max(0, nextPage * nextRowsPerPage);
      const res = await documentApi.getChunks(knowledgeBaseId, documentId, { offset: currentOffset, limit: nextRowsPerPage });
      const items: ChunkItem[] = Array.isArray(res.data) ? res.data : [];
      setChunks(items);
      setHasMore(items.length === nextRowsPerPage);
      setPage(nextPage);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载分片失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setChunks([]);
      setHasMore(true);
      setPage(0);
      loadPage(0, rowsPerPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, knowledgeBaseId, documentId]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(chunks.map(c => c.text).join('\n\n'));
    } catch (e) {
      // ignore
    }
  };

  const count = typeof totalChunks === 'number' && totalChunks >= 0 ? totalChunks : -1;
  const canNext = count === -1 ? hasMore : page < Math.ceil(count / rowsPerPage) - 1;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">查看分片{filename ? `: ${filename}` : ''}</Typography>
          <Box>
            <Tooltip title="复制全部">
              <IconButton size="small" onClick={copyAll}>
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="刷新">
              <span>
                <IconButton size="small" onClick={() => loadPage(page, rowsPerPage)} disabled={loading}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
        )}
        <Box sx={{ mb: 1 }}>
          <TablePagination
            component="div"
            count={count}
            page={page}
            onPageChange={(_, next) => {
              if (loading) return;
              if (count === -1 && next > page && !hasMore) return;
              loadPage(next, rowsPerPage);
            }}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              const next = Number(e.target.value);
              const safe = Number.isFinite(next) && next > 0 ? next : DEFAULT_ROWS_PER_PAGE;
              setRowsPerPage(safe);
              loadPage(0, safe);
            }}
            rowsPerPageOptions={[25, 50, 100, 200]}
            labelRowsPerPage="每页"
            labelDisplayedRows={({ from, to, count }) =>
              count === -1 ? `${from}-${to}` : `${from}-${to} / ${count}`
            }
            backIconButtonProps={{ disabled: loading || page === 0 }}
            nextIconButtonProps={{ disabled: loading || !canNext }}
          />
          <Divider />
        </Box>

        {chunks.length === 0 && loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <List>
            {chunks.map((c) => (
              <ListItem key={`${c.id}-${c.chunk_index}`} alignItems="flex-start" divider>
                <ListItemText
                  primary={`#${c.chunk_index + 1}`}
                  secondary={
                    <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {c.text}
                    </Box>
                  }
                  secondaryTypographyProps={{ component: 'div' }}
                />
              </ListItem>
            ))}
          </List>
        )}
        {loading && chunks.length > 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DocumentChunksDialog;
