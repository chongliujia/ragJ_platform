import React, { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Box,
  Typography,
  TextField,
  FormControlLabel,
  Switch,
  Button,
  Divider,
  Tabs,
  Tab,
  Grid,
  Tooltip,
  IconButton,
  Alert,
} from '@mui/material';
import { ContentCopy as CopyIcon, RestartAlt as ResetIcon, Info as InfoIcon } from '@mui/icons-material';
import type { Node } from 'reactflow';

interface Props {
  open: boolean;
  node: Node | null;
  onClose: () => void;
  onSave: (config: any) => void;
}

const NodeConfigPanel: React.FC<Props> = ({ open, node, onClose, onSave }) => {
  const [localConfig, setLocalConfig] = useState<any>({});
  const type = (node as any)?.data?.type || node?.type;
  const funcSig = (node as any)?.data?.function_signature;
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (node) {
      const cfg = (node as any).data?.config || {};
      // 合并默认值，避免缺字段导致执行失败
      const defaults: Record<string, any> = {};
      if (type === 'llm') {
        Object.assign(defaults, { model: 'qwen-turbo', temperature: 0.7, max_tokens: 1000, system_prompt: '' });
      } else if (type === 'rag_retriever') {
        Object.assign(defaults, { knowledge_base: '', top_k: 5, score_threshold: 0.7, rerank: true });
      } else if (type === 'input') {
        Object.assign(defaults, { input_type: 'text', required: true });
      }
      setLocalConfig({ ...defaults, ...cfg });
    } else {
      setLocalConfig({});
    }
  }, [node, type]);

  const handleSave = () => {
    // 基本校验
    if (type === 'llm') {
      const t = Number(localConfig.temperature);
      if (Number.isNaN(t) || t < 0 || t > 2) {
        setError('LLM temperature 必须在 0-2 之间');
        return; 
      }
      const mt = Number(localConfig.max_tokens);
      if (Number.isNaN(mt) || mt <= 0) {
        setError('LLM max_tokens 必须为正数');
        return; 
      }
    } else if (type === 'rag_retriever') {
      const tk = Number(localConfig.top_k);
      if (Number.isNaN(tk) || tk <= 0) {
        setError('top_k 必须为正数');
        return; 
      }
      const st = Number(localConfig.score_threshold);
      if (Number.isNaN(st) || st < 0 || st > 1) {
        setError('score_threshold 必须在 0-1 之间');
        return; 
      }
    }
    onSave(localConfig);
    onClose();
  };

  if (!node) return null;

  const copyJSON = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(localConfig, null, 2)); } catch {}
  };

  const resetDefaults = () => {
    if (node) {
      const cfg = (node as any).data?.config || {};
      const defaults: Record<string, any> = {};
      if (type === 'llm') Object.assign(defaults, { model: 'qwen-turbo', temperature: 0.7, max_tokens: 1000, system_prompt: '' });
      else if (type === 'rag_retriever') Object.assign(defaults, { knowledge_base: '', top_k: 5, score_threshold: 0.7, rerank: true });
      else if (type === 'input') Object.assign(defaults, { input_type: 'text', required: true });
      setLocalConfig({ ...defaults, ...cfg });
    }
  };

  // UI: tabs for Config / Docs
  const DocBlock = useMemo(() => {
    if (!funcSig) return null;
    return (
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{funcSig.name}</Typography>
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>{funcSig.description}</Typography>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>输入参数</Typography>
        {Array.isArray(funcSig.inputs) && funcSig.inputs.length > 0 ? (
          <Box sx={{ pl: 1 }}>
            {funcSig.inputs.map((inp: any, idx: number) => (
              <Typography key={idx} variant="body2" sx={{ mb: 0.5 }}>• {inp.name} ({inp.type}){inp.required ? ' *' : ''} — {inp.description}</Typography>
            ))}
          </Box>
        ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>无</Typography>}
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>输出</Typography>
        {Array.isArray(funcSig.outputs) && funcSig.outputs.length > 0 ? (
          <Box sx={{ pl: 1 }}>
            {funcSig.outputs.map((out: any, idx: number) => (
              <Typography key={idx} variant="body2" sx={{ mb: 0.5 }}>• {out.name} ({out.type}) — {out.description}</Typography>
            ))}
          </Box>
        ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>无</Typography>}
      </Box>
    );
  }, [funcSig]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 420 } }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h6">节点配置</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{(node as any)?.data?.name || type}</Typography>
        </Box>
        <Box>
          <Tooltip title="复制JSON"><IconButton onClick={copyJSON}><CopyIcon /></IconButton></Tooltip>
          <Tooltip title="恢复默认"><IconButton onClick={resetDefaults}><ResetIcon /></IconButton></Tooltip>
          <Tooltip title="说明"><IconButton onClick={() => setTab(1)}><InfoIcon /></IconButton></Tooltip>
        </Box>
      </Box>
      <Divider />

      {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2 }}>
        <Tab label="配置" />
        <Tab label="说明" />
      </Tabs>

      <Box sx={{ p: 2, pt: 1, overflow: 'auto', flex: 1 }}>
        {tab === 0 && (
          <Grid container spacing={2}>
            {type === 'llm' && (
              <>
                <Grid item xs={12}><TextField label="model" fullWidth value={localConfig.model || ''} onChange={(e) => setLocalConfig((c: any) => ({ ...c, model: e.target.value }))} helperText="模型名称，例如 deepseek-chat 或 qwen-turbo" /></Grid>
                <Grid item xs={6}><TextField label="temperature" type="number" fullWidth value={localConfig.temperature} inputProps={{ step: 0.1, min: 0, max: 2 }} onChange={(e) => setLocalConfig((c: any) => ({ ...c, temperature: Number(e.target.value) }))} helperText="0-2，数值越大越发散" /></Grid>
                <Grid item xs={6}><TextField label="max_tokens" type="number" fullWidth value={localConfig.max_tokens} onChange={(e) => setLocalConfig((c: any) => ({ ...c, max_tokens: Number(e.target.value) }))} helperText="最大输出token" /></Grid>
                <Grid item xs={12}><TextField label="system_prompt" multiline minRows={3} fullWidth value={localConfig.system_prompt || ''} onChange={(e) => setLocalConfig((c: any) => ({ ...c, system_prompt: e.target.value }))} helperText="系统提示词" /></Grid>
              </>
            )}
            {type === 'rag_retriever' && (
              <>
                <Grid item xs={12}><TextField label="knowledge_base" fullWidth value={localConfig.knowledge_base || ''} onChange={(e) => setLocalConfig((c: any) => ({ ...c, knowledge_base: e.target.value }))} helperText="目标知识库ID/名称" /></Grid>
                <Grid item xs={6}><TextField label="top_k" type="number" fullWidth value={localConfig.top_k} onChange={(e) => setLocalConfig((c: any) => ({ ...c, top_k: Number(e.target.value) }))} helperText="检索条数" /></Grid>
                <Grid item xs={6}><TextField label="score_threshold" type="number" fullWidth value={localConfig.score_threshold} inputProps={{ step: 0.05, min: 0, max: 1 }} onChange={(e) => setLocalConfig((c: any) => ({ ...c, score_threshold: Number(e.target.value) }))} helperText="相似度阈值 0-1" /></Grid>
                <Grid item xs={12}><FormControlLabel control={<Switch checked={!!localConfig.rerank} onChange={(e) => setLocalConfig((c: any) => ({ ...c, rerank: e.target.checked }))} />} label="rerank（重排序）" /></Grid>
              </>
            )}
            {type === 'input' && (
              <>
                <Grid item xs={12}><TextField label="input_type" fullWidth value={localConfig.input_type || 'text'} onChange={(e) => setLocalConfig((c: any) => ({ ...c, input_type: e.target.value }))} helperText="输入类型，例如 text" /></Grid>
                <Grid item xs={12}><FormControlLabel control={<Switch checked={!!localConfig.required} onChange={(e) => setLocalConfig((c: any) => ({ ...c, required: e.target.checked }))} />} label="required（必填）" /></Grid>
              </>
            )}
            {!(type === 'llm' || type === 'rag_retriever' || type === 'input') && (
              <Grid item xs={12}><TextField label="config (JSON)" multiline minRows={10} fullWidth value={JSON.stringify(localConfig, null, 2)} onChange={(e) => { try { setLocalConfig(JSON.parse(e.target.value)); setError(null); } catch { setError('JSON 解析错误'); } }} /></Grid>
            )}
          </Grid>
        )}
        {tab === 1 && (DocBlock || <Typography variant="body2" sx={{ color: 'text.secondary' }}>暂无说明</Typography>)}
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSave}>保存</Button>
      </Box>
    </Drawer>
  );
};

export default NodeConfigPanel;
