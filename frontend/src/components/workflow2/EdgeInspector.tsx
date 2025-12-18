import { useMemo } from 'react';
import { Box, Button, Divider, Paper, TextField, Typography, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const title = useMemo(() => {
    if (!edge) return t('workflow2.edgeInspector.title');
    const left = sourceName || edge.source;
    const right = targetName || edge.target;
    return `${left} → ${right}`;
  }, [edge, sourceName, t, targetName]);

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

  const data = edge?.data || {};

  if (!edge) {
    return (
      <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
          {t('workflow2.edgeInspector.panelTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('workflow2.edgeInspector.emptyHint')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap title={title}>
          {title}
        </Typography>
        <Button color="error" variant="outlined" size="small" onClick={onDelete}>
          {t('common.delete')}
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
          {t('workflow2.edgeInspector.sourceOutputHint')}
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
          {t('workflow2.edgeInspector.targetInputHint')}
        </Typography>
      </FormControl>

      <TextField
        fullWidth
        size="small"
        label={t('workflow2.edgeInspector.fields.customSourceOutput')}
        value={data.source_output || ''}
        onChange={(e) => onChange({ source_output: e.target.value })}
        placeholder={t('workflow2.edgeInspector.placeholders.sourceOutput')}
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label={t('workflow2.edgeInspector.fields.customTargetInput')}
        value={data.target_input || ''}
        onChange={(e) => onChange({ target_input: e.target.value })}
        placeholder={t('workflow2.edgeInspector.placeholders.targetInput')}
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label={t('workflow2.edgeInspector.fields.conditionOptional')}
        value={data.condition || ''}
        onChange={(e) => onChange({ condition: e.target.value })}
        helperText={t('workflow2.edgeInspector.helpers.condition')}
        multiline
        minRows={3}
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label={t('workflow2.edgeInspector.fields.transformOptional')}
        value={data.transform || ''}
        onChange={(e) => onChange({ transform: e.target.value })}
        helperText={t('workflow2.edgeInspector.helpers.transform')}
        multiline
        minRows={3}
      />
    </Paper>
  );
}
