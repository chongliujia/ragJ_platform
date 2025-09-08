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
  Checkbox,
  MenuItem,
} from '@mui/material';
import { ContentCopy as CopyIcon, RestartAlt as ResetIcon, Info as InfoIcon, Code as CodeIcon } from '@mui/icons-material';
import type { Node, Edge } from 'reactflow';
import { modelConfigApi } from '../../services/modelConfigApi';

interface Props {
  open: boolean;
  node: Node | null;
  onClose: () => void;
  onSave: (config: any) => void;
  nodes?: Node[];
  edges?: Edge[];
}

const NodeConfigPanel: React.FC<Props> = ({ open, node, onClose, onSave, nodes = [], edges = [] }) => {
  const [localConfig, setLocalConfig] = useState<any>({});
  const type = (node as any)?.data?.type || node?.type;
  const funcSig = (node as any)?.data?.function_signature;
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  // 记录每个输入参数是否使用连线（true 表示使用连线，false 表示手动覆盖）
  const [useEdgeMap, setUseEdgeMap] = useState<Record<string, boolean>>({});
  // 测试模式：优先使用手动输入（忽略连线）
  const [testMode, setTestMode] = useState(false);
  
  // 动态获取可用的聊天模型
  const [availableChatModels, setAvailableChatModels] = useState<Array<{
    model_name: string;
    provider: string;
    provider_display_name: string;
    model_display_name: string;
  }>>([]);
  
  // 加载可用的聊天模型
  useEffect(() => {
    const loadAvailableChatModels = async () => {
      try {
        console.log('Loading available chat models...');
        const response = await modelConfigApi.getAvailableChatModels();
        console.log('Available chat models response:', response.data);
        setAvailableChatModels(response.data.models);
      } catch (error) {
        console.error('Failed to load available chat models:', error);
        // 如果API调用失败，回退到默认的模型列表
        const fallbackModels = [
          { model_name: 'deepseek-chat', provider: 'deepseek', provider_display_name: 'DeepSeek', model_display_name: 'DeepSeek - deepseek-chat' }
        ];
        console.log('Using fallback models:', fallbackModels);
        setAvailableChatModels(fallbackModels);
      }
    };
    
    if (open && type === 'llm') {
      loadAvailableChatModels();
    }
  }, [open, type]);
  
  // 生成LLM模型选项
  const llmModelOptions = useMemo(() => {
    return availableChatModels.map(model => model.model_name);
  }, [availableChatModels]);

  useEffect(() => {
    if (node) {
      const cfg = (node as any).data?.config || {};
      // 合并默认值，避免缺字段导致执行失败
      const defaults: Record<string, any> = {};
      if (type === 'llm') {
        // 使用第一个可用的聊天模型作为默认值
        const defaultModel = availableChatModels.length > 0 ? availableChatModels[0].model_name : 'deepseek-chat';
        Object.assign(defaults, { model: defaultModel, temperature: 0.7, max_tokens: 1000, system_prompt: '' });
      } else if (type === 'rag_retriever') {
        Object.assign(defaults, { knowledge_base: '', top_k: 5, score_threshold: 0.7, rerank: true });
      } else if (type === 'input') {
        Object.assign(defaults, { input_type: 'text', required: true });
      }
      // 初始化配置：默认值 + 节点配置 + 覆写字段（避免重复 key 警告）
      const initOverrides = { ...(cfg.overrides || {}) };
      setLocalConfig({ ...defaults, ...cfg, overrides: initOverrides });
    } else {
      setLocalConfig({});
    }
  }, [node, type, availableChatModels]);

  const handleSave = () => {
    // 运行时字段校验（必填、简单数值范围）
    const errs: Record<string, string | null> = {};
    if (funcSig && Array.isArray(funcSig.inputs)) {
      funcSig.inputs.forEach((inp: any) => {
        const key = inp.name;
        const inbound = inboundForParam(key);
        const hasInbound = inbound.length > 0;
        const overrides = (localConfig as any).overrides || {};
        const val = overrides[key];
        const useEdge = !testMode && hasInbound && (useEdgeMap[key] ?? (val === undefined || val === ''));
        // 只有在未使用连线且 required 时，才校验覆写值
        if (!useEdge && inp.required) {
          if (val === undefined || val === null || val === '') {
            errs[key] = '必填';
          }
          if (inp.type === 'number' && val !== undefined && val !== null && val !== '') {
            const num = Number(val);
            if (Number.isNaN(num)) errs[key] = '必须为数字';
            const min = inp?.validation?.min;
            const max = inp?.validation?.max;
            if (min !== undefined && num < min) errs[key] = `不得小于 ${min}`;
            if (max !== undefined && num > max) errs[key] = `不得大于 ${max}`;
          }
        }
      });
    }
    setFieldErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setError('请修正表单中的错误后再保存');
      return;
    }
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

  const inboundForParam = (paramName: string) => {
    if (!node) return [] as Edge[];
    // 匹配目标节点为当前节点，且 targetHandle == 参数名（或未指定 handle 且只有一个参数）
    const incoming = edges.filter((e: any) => e.target === node.id);
    const exact = incoming.filter((e: any) => e.targetHandle === paramName);
    if (exact.length) return exact;
    if (funcSig?.inputs && funcSig.inputs.length === 1) {
      // 兼容：只有一个输入参数且未指定 handle 的边
      return incoming.filter((e: any) => !e.targetHandle);
    }
    return [] as Edge[];
  };

  const resolveNodeName = (nodeId?: string) => {
    const n = nodes.find(n => n.id === nodeId);
    return (n as any)?.data?.name || nodeId || '';
  };

  const functionSignature = funcSig || { inputs: [], outputs: [] };

  // 同步每个参数的“使用连线”初始状态
  useEffect(() => {
    const map: Record<string, boolean> = {};
    if (Array.isArray(funcSig?.inputs)) {
      const overrides = (localConfig as any).overrides || {};
      funcSig.inputs.forEach((inp: any) => {
        const key = inp.name;
        const inbound = inboundForParam(key);
        const hasInbound = inbound.length > 0;
        const val = overrides[key];
        map[key] = hasInbound && (val === undefined || val === '');
      });
    }
    setUseEdgeMap(map);
  }, [node, edges, funcSig]);

  // 读取并记忆每个节点最近一次“测试输入”与测试模式
  useEffect(() => {
    const id = node?.id;
    if (!id) return;
    try {
      const saved = localStorage.getItem(`node_test_overrides:${id}`);
      const savedUseEdge = localStorage.getItem(`node_test_useEdge:${id}`);
      const savedTestMode = localStorage.getItem(`node_test_mode:${id}`);
      if (saved) {
        const overrides = JSON.parse(saved);
        setLocalConfig((c: any) => ({ ...c, overrides: { ...(c?.overrides || {}), ...overrides } }));
      }
      if (savedUseEdge) {
        setUseEdgeMap((m) => ({ ...m, ...JSON.parse(savedUseEdge) }));
      }
      if (savedTestMode) setTestMode(savedTestMode === '1');
    } catch {}
  }, [node?.id]);

  useEffect(() => {
    const id = node?.id;
    if (!id) return;
    try {
      const overrides = (localConfig as any).overrides || {};
      localStorage.setItem(`node_test_overrides:${id}`, JSON.stringify(overrides));
      localStorage.setItem(`node_test_useEdge:${id}`, JSON.stringify(useEdgeMap));
      localStorage.setItem(`node_test_mode:${id}`, testMode ? '1' : '0');
    } catch {}
  }, [node?.id, localConfig.overrides, useEdgeMap, testMode]);

  // 统计未满足的必填项（仅在未使用连线时校验）
  const missingRequired = useMemo(() => {
    const list: string[] = [];
    const overrides = (localConfig as any).overrides || {};
    if (Array.isArray(funcSig?.inputs)) {
      funcSig.inputs.forEach((inp: any) => {
        const key = inp.name;
        if (!inp?.required) return;
        const inbound = inboundForParam(key);
        const hasInbound = inbound.length > 0;
        const usingEdge = !testMode && hasInbound && (useEdgeMap[key] ?? (overrides[key] === undefined || overrides[key] === ''));
        if (!usingEdge) {
          const v = overrides[key];
          if (v === undefined || v === null || v === '') list.push(key);
        }
      });
    }
    return list;
  }, [funcSig, localConfig, edges, node, useEdgeMap, testMode]);

  const renderAutoField = (inp: any) => {
    const key = inp.name as string;
    const label = `${key}${inp.required ? ' *' : ''}`;
    const helper = inp.description || '';
    const overrides = (localConfig as any).overrides || {};
    const val = overrides[key];
    const err = fieldErrors[key] || null;
    const bound = inboundForParam(key);
    const hasInbound = bound.length > 0;
    const e: any = hasInbound ? bound[0] : null;
    const srcName = hasInbound ? resolveNodeName(e.source) : '';
    const srcHandle = hasInbound ? (e.sourceHandle || 'output') : '';

    // 使用连线/使用静态值切换；测试模式下强制不使用连线
    let useEdge = !testMode && hasInbound && (useEdgeMap[key] ?? (val === undefined || val === ''));
    const onToggleUseEdge = (checked: boolean) => {
      // 受控切换；切到“使用连线”时清空覆盖值
      setUseEdgeMap((m) => ({ ...m, [key]: checked }));
      if (checked) {
        setLocalConfig((c: any) => ({ ...c, overrides: { ...(c.overrides || {}), [key]: '' } }));
        setFieldErrors((fe) => ({ ...fe, [key]: null }));
      }
    };

    const renderOverrideField = () => {
      const commonProps = {
        fullWidth: true,
        label,
        value: val ?? '',
        error: !!err,
        helperText: err || helper,
        placeholder: inp?.example || (inp?.type === 'string' ? '请输入...' : ''),
        onChange: (e: any) => setLocalConfig((c: any) => ({ ...c, overrides: { ...(c.overrides || {}), [key]: e.target.value } })),
      } as any;

      // enum -> Select
      const options: any[] = inp?.validation?.enum || inp?.enum || [];
      if (Array.isArray(options) && options.length > 0) {
        return (
          <TextField select {...commonProps}>
            {options.map((op: any) => (
              <MenuItem key={String(op)} value={op}>{String(op)}</MenuItem>
            ))}
          </TextField>
        );
      }
      switch (inp.type) {
        case 'number':
          return (
            <TextField
              type="number"
              {...commonProps}
              placeholder={(() => {
                const min = inp?.validation?.min;
                const max = inp?.validation?.max;
                if (min !== undefined && max !== undefined) return `${min} - ${max}`;
                if (min !== undefined) return `>= ${min}`;
                if (max !== undefined) return `<= ${max}`;
                return '';
              })()}
              onChange={(e: any) => setLocalConfig((c: any) => ({ ...c, overrides: { ...(c.overrides || {}), [key]: e.target.value === '' ? '' : Number(e.target.value) } }))}
            />
          );
        case 'boolean':
          return (
            <FormControlLabel
              control={<Switch checked={!!val} onChange={(e) => setLocalConfig((c: any) => ({ ...c, overrides: { ...(c.overrides || {}), [key]: e.target.checked } }))} />}
              label={label}
            />
          );
        case 'array':
        case 'object':
          return (
            <TextField
              label={`${label} (JSON)`}
              multiline
              minRows={4}
              fullWidth
              value={val ? JSON.stringify(val, null, 2) : ''}
              error={!!err}
              helperText={err || helper}
              onChange={(e) => {
                try {
                  const v = e.target.value ? JSON.parse(e.target.value) : (inp.type === 'array' ? [] : {});
                  setLocalConfig((c: any) => ({ ...c, overrides: { ...(c.overrides || {}), [key]: v } }));
                  setFieldErrors((fe) => ({ ...fe, [key]: null }));
                } catch {
                  setFieldErrors((fe) => ({ ...fe, [key]: 'JSON 解析错误' }));
                }
              }}
            />
          );
        case 'string':
        default:
          return <TextField {...commonProps} />;
      }
    };

    return (
      <Grid item xs={12} key={key}>
        {hasInbound && (
          <FormControlLabel
            control={<Switch checked={useEdge} onChange={(e) => onToggleUseEdge(e.target.checked)} />}
            label={`使用连线 (${srcName}.${srcHandle})`}
          />
        )}
        {(!hasInbound || !useEdge) && (
          <Box sx={{ mt: 1 }}>
            {renderOverrideField()}
          </Box>
        )}
      </Grid>
    );
  };

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
          {((node as any)?.data?.functionCode) && (
            <Tooltip title="编辑函数代码">
              <IconButton onClick={() => { try { window.dispatchEvent(new CustomEvent('open-node-function-code', { detail: { nodeId: node?.id } } as any)); } catch {} }}>
                <CodeIcon />
              </IconButton>
            </Tooltip>
          )}
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
          <>
            {/* 测试模式与校验提示 */}
            <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <FormControlLabel 
                control={<Switch checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />} 
                label="测试：手动输入优先" 
              />
              {missingRequired.length > 0 && (
                <Alert severity="warning" sx={{ m: 0, py: 0.5 }}>
                  仍有必填项未填写：{missingRequired.map((k, i) => (
                    <Button key={i} size="small" sx={{ textTransform: 'none', ml: 0.5 }} onClick={() => {
                      try {
                        const el = document.getElementById(`param-${k}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      } catch {}
                    }}>{k}</Button>
                  ))}
                </Alert>
              )}
            </Box>
            {/* 自动生成的参数表单（基于函数签名） */}
            {funcSig?.inputs?.length ? (
              <Grid container spacing={2}>
                {funcSig.inputs.map((inp: any) => (
                  <React.Fragment key={inp.name}>
                    <div id={`param-${inp.name}`} style={{ width: '100%' }} />
                    {renderAutoField(inp)}
                  </React.Fragment>
                ))}
              </Grid>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>该节点暂无可配置参数</Typography>
            )}

            {/* 类型特定配置（非函数签名参数，例如 LLM 的模型） */}
            {type === 'llm' && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>基础配置</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <TextField
                      select
                      fullWidth
                      label="模型"
                      value={localConfig.model || ''}
                      onChange={(e) => setLocalConfig((c: any) => ({ ...c, model: e.target.value }))}
                    >
                      {llmModelOptions.map((modelName) => {
                        const modelInfo = availableChatModels.find(m => m.model_name === modelName);
                        const displayName = modelInfo ? modelInfo.model_display_name : modelName;
                        return (
                          <MenuItem key={modelName} value={modelName}>
                            {displayName}
                          </MenuItem>
                        );
                      })}
                    </TextField>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      multiline
                      rows={3}
                      fullWidth
                      label="系统提示词（可选）"
                      placeholder="例如：你是一个专业的AI助手，请简洁准确地回答用户问题。"
                      value={localConfig.system_prompt || ''}
                      onChange={(e) => setLocalConfig((c: any) => ({ ...c, system_prompt: e.target.value }))}
                      helperText="定义AI的角色和行为方式"
                    />
                  </Grid>
                </Grid>

                {/* 高级参数 - 收起状态 */}
                <Box sx={{ mt: 2 }}>
                  <FormControlLabel 
                    control={<Switch checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />} 
                    label="高级参数" 
                  />
                  {advanced && (
                    <Grid container spacing={2} sx={{ mt: 1 }}>
                      <Grid item xs={6}>
                        <TextField
                          type="number"
                          fullWidth
                          label="创造性 (0-2)"
                          value={localConfig.temperature ?? 0.7}
                          inputProps={{ step: 0.1, min: 0, max: 2 }}
                          onChange={(e) => setLocalConfig((c: any) => ({ ...c, temperature: Number(e.target.value) }))}
                          helperText="0=精确, 1=均衡, 2=创造"
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          type="number"
                          fullWidth
                          label="最大长度"
                          value={localConfig.max_tokens ?? 1000}
                          inputProps={{ min: 100, max: 4000, step: 100 }}
                          onChange={(e) => setLocalConfig((c: any) => ({ ...c, max_tokens: Number(e.target.value) }))}
                          helperText="回答的最大字数"
                        />
                      </Grid>
                    </Grid>
                  )}
                </Box>
              </Box>
            )}
          </>
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
