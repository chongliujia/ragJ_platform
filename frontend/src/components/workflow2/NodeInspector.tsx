import React, { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import MonacoEditor from '@monaco-editor/react';
import type { Node } from 'reactflow';
import type { WorkflowNodeData } from './types';

type Props = {
  node: Node<WorkflowNodeData> | null;
  onChange: (patch: Partial<WorkflowNodeData>) => void;
  onDelete: () => void;
  onCreateBranches?: () => void;
  knowledgeBases: string[];
  availableChatModels: string[];
};

export default function NodeInspector({
  node,
  onChange,
  onDelete,
  onCreateBranches,
  knowledgeBases,
  availableChatModels,
}: Props) {
  const [rawConfig, setRawConfig] = useState('');

  const cfg = node?.data.config || {};
  const kind = node?.data.kind;

  const title = useMemo(() => {
    if (!node) return '属性面板';
    return `${node.data.name || '未命名'}（${node.data.kind}）`;
  }, [node]);

  if (!node) {
    return (
      <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
          属性面板
        </Typography>
        <Typography variant="body2" color="text.secondary">
          选中一个节点后在这里编辑参数。
        </Typography>
      </Paper>
    );
  }

  const updateConfig = (key: string, value: any) => {
    onChange({ config: { ...(node.data.config || {}), [key]: value } });
  };

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
        label="节点名称"
        value={node.data.name}
        onChange={(e) => onChange({ name: e.target.value })}
        sx={{ mb: 1.5 }}
      />
      <TextField
        fullWidth
        size="small"
        label="描述"
        value={node.data.description || ''}
        onChange={(e) => onChange({ description: e.target.value })}
        sx={{ mb: 2 }}
      />

      {kind === 'llm' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>模型</InputLabel>
            <Select
              value={cfg.model || ''}
              label="模型"
              onChange={(e) => updateConfig('model', e.target.value)}
            >
              <MenuItem value="">
                <em>（使用默认/按租户配置）</em>
              </MenuItem>
              {availableChatModels.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="temperature"
            type="number"
            value={cfg.temperature ?? 0.7}
            onChange={(e) => updateConfig('temperature', Number(e.target.value))}
            inputProps={{ step: 0.1, min: 0, max: 2 }}
          />
          <TextField
            fullWidth
            size="small"
            label="max_tokens"
            type="number"
            value={cfg.max_tokens ?? 1000}
            onChange={(e) => updateConfig('max_tokens', Number(e.target.value))}
            inputProps={{ step: 50, min: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="system_prompt"
            value={cfg.system_prompt || ''}
            onChange={(e) => updateConfig('system_prompt', e.target.value)}
            multiline
            minRows={4}
          />
        </Box>
      )}

      {kind === 'rag_retriever' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>知识库</InputLabel>
            <Select
              value={cfg.knowledge_base || ''}
              label="知识库"
              onChange={(e) => updateConfig('knowledge_base', e.target.value)}
            >
              <MenuItem value="">
                <em>请选择</em>
              </MenuItem>
              {knowledgeBases.map((kb) => (
                <MenuItem key={kb} value={kb}>
                  {kb}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="top_k"
            type="number"
            value={cfg.top_k ?? 5}
            onChange={(e) => updateConfig('top_k', Number(e.target.value))}
            inputProps={{ step: 1, min: 1, max: 50 }}
          />
        </Box>
      )}

      {kind === 'condition' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            fullWidth
            size="small"
            label="field_path"
            value={cfg.field_path || 'value'}
            onChange={(e) => updateConfig('field_path', e.target.value)}
            helperText="支持嵌套路径，例如 data.class"
          />
          <FormControl fullWidth size="small">
            <InputLabel>condition_type</InputLabel>
            <Select
              value={cfg.condition_type || 'equals'}
              label="condition_type"
              onChange={(e) => updateConfig('condition_type', e.target.value)}
            >
              <MenuItem value="equals">equals</MenuItem>
              <MenuItem value="contains">contains</MenuItem>
              <MenuItem value="greater_than">greater_than</MenuItem>
              <MenuItem value="less_than">less_than</MenuItem>
              <MenuItem value="truthy">truthy</MenuItem>
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="condition_value"
            value={cfg.condition_value ?? ''}
            onChange={(e) => updateConfig('condition_value', e.target.value)}
          />
          <Button
            variant="outlined"
            onClick={() => onCreateBranches?.()}
            disabled={!onCreateBranches}
          >
            一键生成 True/False 分支
          </Button>
          <Typography variant="caption" color="text.secondary">
            分支提示：从节点右侧的 <code>true</code>/<code>false</code> 句柄连线，会自动写入边条件并透传 <code>data</code>。
          </Typography>
        </Box>
      )}

      {kind === 'code_executor' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>language</InputLabel>
            <Select
              value={cfg.language || 'python'}
              label="language"
              onChange={(e) => updateConfig('language', e.target.value)}
            >
              <MenuItem value="python">python</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden' }}>
            <MonacoEditor
              height="240px"
              language="python"
              theme="vs-dark"
              value={cfg.code || ''}
              onChange={(v) => updateConfig('code', v || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
              }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            约定：在代码中设置变量 <code>result</code> 作为输出（例如 <code>result = &#123;&quot;content&quot;: &quot;...&quot;&#125;</code>）。
          </Typography>
        </Box>
      )}

      {kind === 'output' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel>format</InputLabel>
            <Select
              value={cfg.format || 'json'}
              label="format"
              onChange={(e) => updateConfig('format', e.target.value)}
            >
              <MenuItem value="json">json</MenuItem>
              <MenuItem value="text">text</MenuItem>
              <MenuItem value="markdown">markdown</MenuItem>
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="template（可选）"
            value={cfg.template || ''}
            onChange={(e) => updateConfig('template', e.target.value)}
            multiline
            minRows={4}
            helperText="留空则直接输出 input_data（兼容 data 包装）。"
          />
        </Box>
      )}

      <Accordion sx={{ mt: 2 }} onChange={(_, expanded) => { if (expanded) setRawConfig(JSON.stringify(node.data.config || {}, null, 2)); }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontWeight: 700 }}>高级：直接编辑 config JSON</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TextField
            fullWidth
            multiline
            minRows={8}
            value={rawConfig}
            onChange={(e) => setRawConfig(e.target.value)}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button
              variant="contained"
              onClick={() => {
                try {
                  const obj = JSON.parse(rawConfig || '{}');
                  onChange({ config: obj });
                } catch {
                  // ignore; let user fix JSON
                }
              }}
            >
              应用 JSON
            </Button>
          </Box>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
