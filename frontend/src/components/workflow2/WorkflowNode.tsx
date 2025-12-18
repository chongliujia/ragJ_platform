import { useMemo, useState } from 'react';
import { Box, Chip, Paper, Typography, alpha, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { WorkflowNodeData } from './types';

export default function WorkflowNode(props: NodeProps<WorkflowNodeData>) {
  const { data, selected } = props;
  const theme = useTheme();
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const showPortLabels = selected || hovered;

  const PORT_TOP_BASE = 44;
  const PORT_STEP = 18;

  const portLabel = useMemo(() => {
    return (id: string) => {
      if (data.kind === 'condition') {
        if (id === 'true') return 'TRUE';
        if (id === 'false') return 'FALSE';
      }
      return id;
    };
  }, [data.kind]);

  const inputs = useMemo(() => {
    switch (data.kind) {
      case 'llm':
        return ['data', 'prompt', 'input', 'documents'];
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

  const kindLabel = useMemo(() => {
    switch (data.kind) {
      case 'input':
        return t('workflow2.kindLabels.input');
      case 'llm':
        return t('workflow2.kindLabels.llm');
      case 'rag_retriever':
        return t('workflow2.kindLabels.rag_retriever');
      case 'http_request':
        return t('workflow2.kindLabels.http_request');
      case 'condition':
        return t('workflow2.kindLabels.condition');
      case 'code_executor':
        return t('workflow2.kindLabels.code_executor');
      case 'output':
        return t('workflow2.kindLabels.output');
      default:
        return data.kind;
    }
  }, [data.kind, t]);

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
        return [] as string[];
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
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Box sx={{ px: 1.25, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          size="small"
          label={kindLabel}
          sx={{
            height: 22,
            fontWeight: 700,
            bgcolor: alpha(accent, 0.18),
            border: `1px solid ${alpha(accent, 0.25)}`,
          }}
        />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }} noWrap>
          {data.name || t('workflow2.node.unnamed')}
        </Typography>
      </Box>

      {!!data.description && (
        <Box sx={{ px: 1.25, pb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
            {data.description}
          </Typography>
        </Box>
      )}

      {/* Port labels to make IO explicit while building workflows (only on hover/selected) */}
      {showPortLabels &&
        inputs.map((id, idx) => (
          <Typography
            key={`in_label_${id}`}
            variant="caption"
            sx={{
              position: 'absolute',
              left: 14,
              top: PORT_TOP_BASE + idx * PORT_STEP - 9,
              fontSize: 11,
              color: alpha(theme.palette.text.secondary, 0.9),
              pointerEvents: 'none',
              userSelect: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {portLabel(id)}
          </Typography>
        ))}
      {showPortLabels &&
        outputs.map((id, idx) => (
          <Typography
            key={`out_label_${id}`}
            variant="caption"
            sx={{
              position: 'absolute',
              right: 14,
              top: PORT_TOP_BASE + idx * PORT_STEP - 9,
              fontSize: 11,
              color: alpha(theme.palette.text.secondary, 0.9),
              pointerEvents: 'none',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              textAlign: 'right',
            }}
          >
            {portLabel(id)}
          </Typography>
        ))}

      {inputs.map((id, idx) => (
        <Handle
          key={`in_${id}`}
          type="target"
          position={Position.Left}
          id={id}
          style={{
            top: PORT_TOP_BASE + idx * PORT_STEP,
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
            top: PORT_TOP_BASE + idx * PORT_STEP,
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
