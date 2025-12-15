import { useMemo } from 'react';
import { Box, Button, Divider, Paper, TextField, Typography } from '@mui/material';
import type { Edge } from 'reactflow';
import type { WorkflowEdgeData } from './types';

type Props = {
  edge: Edge<WorkflowEdgeData> | null;
  onChange: (patch: Partial<WorkflowEdgeData>) => void;
  onDelete: () => void;
  sourceName?: string;
  targetName?: string;
};

export default function EdgeInspector({ edge, onChange, onDelete, sourceName, targetName }: Props) {
  const title = useMemo(() => {
    if (!edge) return '边属性';
    const left = sourceName || edge.source;
    const right = targetName || edge.target;
    return `${left} → ${right}`;
  }, [edge, sourceName, targetName]);

  if (!edge) {
    return (
      <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
          属性面板
        </Typography>
        <Typography variant="body2" color="text.secondary">
          选中一个边后在这里编辑映射/条件/转换。
        </Typography>
      </Paper>
    );
  }

  const data = edge.data || {};

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap title={title}>
          {title}
        </Typography>
        <Button color="error" variant="outlined" size="small" onClick={onDelete}>
          删除
        </Button>
      </Box>
      <Divider sx={{ my: 1.5 }} />

      <TextField
        fullWidth
        size="small"
        label="source_output"
        value={data.source_output || 'output'}
        onChange={(e) => onChange({ source_output: e.target.value })}
        helperText="源节点输出字段名/句柄（例如 content / documents / output）"
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label="target_input"
        value={data.target_input || 'input'}
        onChange={(e) => onChange({ target_input: e.target.value })}
        helperText="目标节点输入字段名/句柄（例如 prompt / query / input）"
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label="condition（可选）"
        value={data.condition || ''}
        onChange={(e) => onChange({ condition: e.target.value })}
        helperText={'条件表达式（安全 eval，无函数调用）。变量：value/input/context。例：value["condition_result"] == True'}
        multiline
        minRows={3}
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label="transform（可选）"
        value={data.transform || ''}
        onChange={(e) => onChange({ transform: e.target.value })}
        helperText={'数据转换表达式（后端会执行）。例：{"query": value["content"]}'}
        multiline
        minRows={3}
      />
    </Paper>
  );
}
