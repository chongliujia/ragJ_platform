import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  initialChunkIndex?: number;
  highlightTerms?: string[];
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
  initialChunkIndex,
  highlightTerms,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlightText = (text: string, terms?: string[]) => {
    const cleaned = (terms || []).map((term) => term.trim()).filter(Boolean);
    if (cleaned.length === 0) return text;
    const escaped = cleaned.map(escapeRegExp);
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(regex);
    const lowerTerms = cleaned.map((term) => term.toLowerCase());
    return parts.map((part, index) => {
      const isMatch = lowerTerms.includes(part.toLowerCase());
      if (!isMatch) return part;
      return (
        <Box
          key={`${part}-${index}`}
          component="span"
          sx={{
            backgroundColor: 'rgba(255, 213, 79, 0.3)',
            borderRadius: 0.5,
            px: 0.4,
          }}
        >
          {part}
        </Box>
      );
    });
  };

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
      setError(e?.response?.data?.detail || e?.message || t('documentChunksDialog.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setChunks([]);
      setHasMore(true);
      const initialPage =
        typeof initialChunkIndex === 'number' && initialChunkIndex >= 0
          ? Math.floor(initialChunkIndex / rowsPerPage)
          : 0;
      loadPage(initialPage, rowsPerPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, knowledgeBaseId, documentId, rowsPerPage, initialChunkIndex]);

  useEffect(() => {
    if (!open || typeof initialChunkIndex !== 'number') return;
    const targetId = `chunk-${initialChunkIndex}`;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ block: 'center' });
    }
  }, [open, chunks, initialChunkIndex]);

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
          <Typography variant="h6">
            {t('documentChunksDialog.title', { filename: filename ? `: ${filename}` : '' })}
          </Typography>
          <Box>
            <Tooltip title={t('documentChunksDialog.actions.copyAll')}>
              <IconButton size="small" onClick={copyAll}>
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('documentChunksDialog.actions.refresh')}>
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
            labelRowsPerPage={t('documentChunksDialog.pagination.rowsPerPage')}
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
              <ListItem
                key={`${c.id}-${c.chunk_index}`}
                id={`chunk-${c.chunk_index}`}
                alignItems="flex-start"
                divider
                sx={
                  typeof initialChunkIndex === 'number' && c.chunk_index === initialChunkIndex
                    ? { bgcolor: 'rgba(0, 212, 255, 0.08)' }
                    : undefined
                }
              >
                <ListItemText
                  primary={`#${c.chunk_index + 1}`}
                  secondary={
                    <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {highlightText(c.text, highlightTerms)}
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
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DocumentChunksDialog;
