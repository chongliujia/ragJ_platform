import React, { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, CircularProgress, List, ListItem, ListItemText, IconButton, Tooltip } from '@mui/material';
import { Close as CloseIcon, ContentCopy as CopyIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { documentApi } from '../services/api';

interface DocumentChunksDialogProps {
  open: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  documentId: string;
  filename?: string;
}

interface ChunkItem {
  id: number;
  chunk_index: number;
  text: string;
}

const PAGE_SIZE = 100;

const DocumentChunksDialog: React.FC<DocumentChunksDialogProps> = ({ open, onClose, knowledgeBaseId, documentId, filename }) => {
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = async (reset = false) => {
    try {
      setLoading(true);
      setError(null);
      const currentOffset = reset ? 0 : offset;
      const res = await documentApi.getChunks(knowledgeBaseId, documentId, { offset: currentOffset, limit: PAGE_SIZE });
      const items: ChunkItem[] = Array.isArray(res.data) ? res.data : [];
      if (reset) {
        // reset list
        setChunks(items);
      } else {
        // append with de-duplication by id+chunk_index
        setChunks(prev => {
          const seen = new Set(prev.map(x => `${x.id}-${x.chunk_index}`));
          const merged: ChunkItem[] = [...prev];
          for (const it of items) {
            const key = `${it.id}-${it.chunk_index}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(it);
            }
          }
          return merged;
        });
      }
      setOffset(currentOffset + items.length);
      setHasMore(items.length === PAGE_SIZE);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载分片失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setChunks([]);
      setOffset(0);
      setHasMore(true);
      loadPage(true);
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
              <IconButton size="small" onClick={() => loadPage(true)} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
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
        {hasMore && !loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <Button onClick={() => loadPage(false)}>加载更多</Button>
          </Box>
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
