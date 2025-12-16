import { useMemo } from 'react';
import { Box, Button, Divider, Paper, TextField, Typography, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import type { Edge } from 'reactflow';
import type { WorkflowEdgeData } from './types';

type Props = {
  edge: Edge<WorkflowEdgeData> | null;
  onChange: (patch: Partial<WorkflowEdgeData>) => void;
  onDelete: () => void;
  sourceName?: string;
  targetName?: string;
  sourceOutputs?: string[];
  targetInputs?: string[];
};

export default function EdgeInspector({
  edge,
  onChange,
  onDelete,
  sourceName,
  targetName,
  sourceOutputs,
  targetInputs,
}: Props) {
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

  const sourceOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of ['output', 'content', 'result', 'documents', 'data', 'response_data']) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    for (const v of sourceOutputs || []) {
      const s = String(v || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }, [sourceOutputs]);

  const targetOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of ['input', 'data', 'prompt', 'query', 'text', 'value', 'url']) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    for (const v of targetInputs || []) {
      const s = String(v || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }, [targetInputs]);

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

      <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
        <InputLabel>source_output</InputLabel>
        <Select
          label="source_output"
          value={String(data.source_output || 'output')}
          onChange={(e) => onChange({ source_output: String(e.target.value) })}
        >
          {sourceOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          源节点输出字段/句柄（优先用下拉，必要时可在下方自定义）。
        </Typography>
      </FormControl>

      <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
        <InputLabel>target_input</InputLabel>
        <Select
          label="target_input"
          value={String(data.target_input || 'input')}
          onChange={(e) => onChange({ target_input: String(e.target.value) })}
        >
          {targetOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          目标节点输入字段/句柄（例如 LLM 推荐接到 input 或 prompt；Output 推荐接到 data）。
        </Typography>
      </FormControl>

      <TextField
        fullWidth
        size="small"
        label="高级：自定义 source_output（可选）"
        value={data.source_output || ''}
        onChange={(e) => onChange({ source_output: e.target.value })}
        placeholder="例如 content"
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label="高级：自定义 target_input（可选）"
        value={data.target_input || ''}
        onChange={(e) => onChange({ target_input: e.target.value })}
        placeholder="例如 input"
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
