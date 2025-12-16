import { useMemo } from 'react';
import { Box, Chip, Paper, Typography, alpha, useTheme } from '@mui/material';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { WorkflowNodeData } from './types';

function kindLabel(kind: WorkflowNodeData['kind']): string {
  switch (kind) {
    case 'input':
      return '输入';
    case 'llm':
      return 'LLM';
    case 'rag_retriever':
      return '检索';
    case 'http_request':
      return 'HTTP';
    case 'condition':
      return '条件';
    case 'code_executor':
      return '代码';
    case 'output':
      return '输出';
    default:
      return kind;
  }
}

export default function WorkflowNode(props: NodeProps<WorkflowNodeData>) {
  const { data, selected } = props;
  const theme = useTheme();

  const inputs = useMemo(() => {
    switch (data.kind) {
      case 'llm':
        return ['data', 'prompt', 'input'];
      case 'rag_retriever':
        return ['data', 'query'];
      case 'http_request':
        return ['data', 'url'];
      case 'condition':
        return ['data', 'value'];
      case 'code_executor':
        return ['data', 'input'];
      case 'output':
        return ['data', 'input'];
      case 'input':
      default:
        return [] as string[];
    }
  }, [data.kind]);

  const outputs = useMemo(() => {
    switch (data.kind) {
      case 'input':
        return ['data', 'input', 'prompt', 'query', 'text'];
      case 'llm':
        return ['content', 'metadata'];
      case 'rag_retriever':
        return ['documents', 'query', 'total_results'];
      case 'http_request':
        return ['response_data', 'status_code', 'success'];
      case 'condition':
        // Special: 'true'/'false' are virtual handles used to auto-fill edge.condition on connect.
        return ['true', 'false'];
      case 'code_executor':
        return ['result'];
      case 'output':
        return ['output'];
      default:
        return ['output'];
    }
  }, [data.kind]);

  const accent = useMemo(() => {
    switch (data.kind) {
      case 'input':
        return theme.palette.info.main;
      case 'llm':
        return theme.palette.primary.main;
      case 'rag_retriever':
        return theme.palette.secondary.main;
      case 'http_request':
        return theme.palette.info.main;
      case 'condition':
        return theme.palette.warning.main;
      case 'code_executor':
        return theme.palette.success.main;
      case 'output':
        return theme.palette.error.main;
      default:
        return theme.palette.divider;
    }
  }, [data.kind, theme.palette]);

  return (
    <Paper
      elevation={0}
      sx={{
        minWidth: 220,
        borderRadius: 2,
        border: `1px solid ${alpha(accent, selected ? 0.8 : 0.25)}`,
        background: alpha(theme.palette.background.paper, 0.85),
        boxShadow: selected ? `0 0 0 2px ${alpha(accent, 0.25)}` : 'none',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.25, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          size="small"
          label={kindLabel(data.kind)}
          sx={{
            height: 22,
            fontWeight: 700,
            bgcolor: alpha(accent, 0.18),
            border: `1px solid ${alpha(accent, 0.25)}`,
          }}
        />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }} noWrap>
          {data.name || '未命名节点'}
        </Typography>
      </Box>

      {!!data.description && (
        <Box sx={{ px: 1.25, pb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
            {data.description}
          </Typography>
        </Box>
      )}

      {inputs.map((id, idx) => (
        <Handle
          key={`in_${id}`}
          type="target"
          position={Position.Left}
          id={id}
          style={{
            top: 44 + idx * 18,
            width: 10,
            height: 10,
            border: `2px solid ${alpha(accent, 0.8)}`,
            background: theme.palette.background.default,
          }}
        />
      ))}

      {outputs.map((id, idx) => (
        <Handle
          key={`out_${id}`}
          type="source"
          position={Position.Right}
          id={id}
          style={{
            top: 44 + idx * 18,
            width: 10,
            height: 10,
            border: `2px solid ${alpha(accent, 0.8)}`,
            background: theme.palette.background.default,
          }}
        />
      ))}
    </Paper>
  );
}
