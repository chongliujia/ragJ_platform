import { useMemo, useState } from 'react';
import { Box, Divider, Paper, TextField, Typography, List, ListItemButton, ListItemText, Chip } from '@mui/material';
import type { NodeTemplate } from './nodeTemplates';

type Props = {
  templates: NodeTemplate[];
  onAddClick: (kind: NodeTemplate['kind']) => void;
  embedded?: boolean;
};

export default function NodePalette({ templates, onAddClick, embedded }: Props) {
  const [q, setQ] = useState('');

  const grouped = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = !query
      ? templates
      : templates.filter((t) => (t.name + ' ' + t.description).toLowerCase().includes(query));
    const map = new Map<string, NodeTemplate[]>();
    for (const t of filtered) {
      const key = t.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [q, templates]);

  const content = (
    <>
      {!embedded && (
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          节点库
        </Typography>
      )}
      <TextField
        size="small"
        placeholder="搜索节点…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Divider />
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {grouped.map(([cat, list]) => (
          <Box key={cat} sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {cat}
              </Typography>
              <Chip size="small" label={list.length} />
            </Box>
            <List dense disablePadding>
              {list.map((t) => (
                <ListItemButton
                  key={t.kind}
                  sx={{ borderRadius: 1, mb: 0.5 }}
                  onClick={() => onAddClick(t.kind)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/ragj-workflow-node', JSON.stringify({ kind: t.kind }));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {t.name}
                      </Typography>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {t.description}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        ))}
        {grouped.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            没有匹配的节点
          </Typography>
        )}
      </Box>
      {!embedded && (
        <Typography variant="caption" color="text.secondary">
          提示：可拖拽到画布，也可点击添加
        </Typography>
      )}
    </>
  );

  if (embedded) {
    return (
      <Box sx={{ p: 1.25, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {content}
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
      {content}
    </Paper>
  );
}
