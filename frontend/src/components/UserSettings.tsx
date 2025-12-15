/**
 * 用户设置组件 - 个人配置管理
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Save as SaveIcon,
  Palette as ThemeIcon,
  Tune as TuneIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { modelConfigApi } from '../services/modelConfigApi';
import type { ProviderConfig, ModelConfig } from '../services/modelConfigApi';

interface UserConfig {
  id: number;
  user_id: number;
  preferred_chat_model: string;
  preferred_embedding_model: string;
  preferred_rerank_model: string;
  max_tokens: number;
  temperature: string;
  top_p: string;
  retrieval_top_k: number;
  chunk_size: number;
  chunk_overlap: number;
  theme: string;
  language: string;
  custom_settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface AvailableChatModel {
  model_name: string;
  provider: string;
  provider_display_name: string;
  model_display_name: string;
}

const UserSettings: React.FC = () => {
  const { i18n } = useTranslation();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 动态可用模型（per-tenant）
  const [availableChatModels, setAvailableChatModels] = useState<AvailableChatModel[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [rerankModels, setRerankModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const themes = [
    { value: 'light', label: '浅色主题' },
    { value: 'dark', label: '深色主题' },
    { value: 'auto', label: '跟随系统' },
  ];

  const languages = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
  ];

  useEffect(() => {
    loadUserConfig();
  }, []);

  useEffect(() => {
    loadModelOptions();
  }, []);

  const loadUserConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/v1/users/config', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load user configuration');
      }

      const data = await response.json();
      setConfig(data);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadModelOptions = async () => {
    try {
      setModelsLoading(true);
      const [providersRes, activeRes, chatRes] = await Promise.all([
        modelConfigApi.getProviders(),
        modelConfigApi.getActiveModels(),
        modelConfigApi.getAvailableChatModels().catch(() => null),
      ]);

      const providers = (providersRes.data || []) as ProviderConfig[];
      const activeModels = (activeRes.data || []) as ModelConfig[];

      const chatModels = (chatRes as any)?.data?.models || [];
      setAvailableChatModels(chatModels);

      const getOptionsForType = (type: string) => {
        const active = activeModels.find(m => m.model_type === type);
        const provider = active ? providers.find(p => p.provider === active.provider) : undefined;
        const raw = (provider as any)?.available_models?.[type] || (active?.model_name ? [active.model_name] : []);
        const options = Array.isArray(raw) ? raw : [];
        const strings = options.filter((v): v is string => typeof v === 'string');
        return Array.from(new Set(strings));
      };

      setEmbeddingModels(getOptionsForType('embedding'));
      setRerankModels(getOptionsForType('reranking'));
    } catch (error) {
      console.error('Failed to load model options:', error);
      setAvailableChatModels([]);
      setEmbeddingModels([]);
      setRerankModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/v1/users/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          preferred_chat_model: config.preferred_chat_model,
          preferred_embedding_model: config.preferred_embedding_model,
          preferred_rerank_model: config.preferred_rerank_model,
          max_tokens: config.max_tokens,
          temperature: config.temperature,
          top_p: config.top_p,
          retrieval_top_k: config.retrieval_top_k,
          chunk_size: config.chunk_size,
          chunk_overlap: config.chunk_overlap,
          theme: config.theme,
          language: config.language,
          custom_settings: config.custom_settings,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save user configuration');
      }

      const updatedConfig = await response.json();
      setConfig(updatedConfig);
      setSuccess('配置保存成功！');
      
      // 如果语言设置改变，更新i18n
      if (i18n.language !== config.language) {
        i18n.changeLanguage(config.language);
      }

      setTimeout(() => setSuccess(null), 3000);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (field: keyof UserConfig, value: any) => {
    if (config) {
      setConfig({ ...config, [field]: value });
    }
  };

  const chatModelNames = Array.from(new Set([
    ...availableChatModels.map(m => m.model_name),
    ...(config?.preferred_chat_model ? [config.preferred_chat_model] : []),
  ]));
  const embeddingModelNames = Array.from(new Set([
    ...embeddingModels,
    ...(config?.preferred_embedding_model ? [config.preferred_embedding_model] : []),
  ]));
  const rerankModelNames = Array.from(new Set([
    ...rerankModels,
    ...(config?.preferred_rerank_model ? [config.preferred_rerank_model] : []),
  ]));

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!config) {
    return (
      <Alert severity="error">
        无法加载用户配置
      </Alert>
    );
  }

  const temperatureNumber = Number(config.temperature);
  const temperatureValue = Number.isFinite(temperatureNumber) ? temperatureNumber : 0.7;
  const topPNumber = Number(config.top_p);
  const topPValue = Number.isFinite(topPNumber) ? topPNumber : 0.9;
  const maxTokensNumber = Number(config.max_tokens);
  const maxTokensValue = Number.isFinite(maxTokensNumber) && maxTokensNumber > 0 ? maxTokensNumber : 1000;
  const retrievalTopKNumber = Number(config.retrieval_top_k);
  const retrievalTopKValue = Number.isFinite(retrievalTopKNumber) && retrievalTopKNumber > 0 ? retrievalTopKNumber : 5;
  const chunkSizeNumber = Number(config.chunk_size);
  const chunkSizeValue = Number.isFinite(chunkSizeNumber) && chunkSizeNumber > 0 ? chunkSizeNumber : 1000;
  const chunkOverlapNumber = Number(config.chunk_overlap);
  const chunkOverlapValue = Number.isFinite(chunkOverlapNumber) && chunkOverlapNumber >= 0 ? chunkOverlapNumber : 200;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      {/* 折叠说明区 */}
      <Accordion sx={{ mb: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InfoIcon fontSize="small" color="action" />
            <Typography sx={{ fontWeight: 600 }}>参数说明</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            这些参数只影响当前账号（不会影响同租户其他用户）。若模型列表为空，请先在「系统设置 → 模型配置」里配置提供商 API。
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary', fontSize: 14, lineHeight: 1.8 }}>
            <li><b>Chat 模型</b>：对话回答使用的默认模型。</li>
            <li><b>Embedding</b>：用于文档入库与检索向量化，建议选择稳定的向量模型。</li>
            <li><b>Rerank</b>：用于对检索结果二次排序（可提升命中，但会增加耗时/费用）。</li>
            <li><b>Chunk</b>：分片越大上下文越完整，但入库成本更高。</li>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* AI 模型设置 */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon />
            <Typography variant="h6">AI 模型设置</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>聊天模型</InputLabel>
                <Select
                  value={config.preferred_chat_model}
                  onChange={(e) => updateConfig('preferred_chat_model', e.target.value)}
                  label="聊天模型"
                  disabled={modelsLoading}
                >
                  {chatModelNames.map((modelName) => {
                    const info = availableChatModels.find(m => m.model_name === modelName);
                    const displayName = info ? info.model_display_name : modelName;
                    return (
                      <MenuItem key={modelName} value={modelName}>
                        {displayName}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>嵌入模型</InputLabel>
                <Select
                  value={config.preferred_embedding_model}
                  onChange={(e) => updateConfig('preferred_embedding_model', e.target.value)}
                  label="嵌入模型"
                  disabled={modelsLoading}
                >
                  {embeddingModelNames.map((modelName) => (
                    <MenuItem key={modelName} value={modelName}>
                      {modelName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>重排序模型</InputLabel>
                <Select
                  value={config.preferred_rerank_model}
                  onChange={(e) => updateConfig('preferred_rerank_model', e.target.value)}
                  label="重排序模型"
                  disabled={modelsLoading}
                >
                  {rerankModelNames.map((modelName) => (
                    <MenuItem key={modelName} value={modelName}>
                      {modelName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* 模型参数设置 */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon />
            <Typography variant="h6">模型参数</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  最大令牌数 ({maxTokensValue})
                </Typography>
                <Slider
                  min={256}
                  max={32768}
                  step={256}
                  value={maxTokensValue}
                  valueLabelDisplay="auto"
                  onChange={(_, v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    updateConfig('max_tokens', Math.max(1, Math.round(Number(val))));
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  控制单次回复最大长度
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  温度 ({temperatureValue.toFixed(2)})
                </Typography>
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperatureValue}
                  valueLabelDisplay="auto"
                  onChange={(_, v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    updateConfig('temperature', String(val));
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  控制生成随机性 (0.0-2.0)
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Top-p ({topPValue.toFixed(2)})
                </Typography>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={topPValue}
                  valueLabelDisplay="auto"
                  onChange={(_, v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    updateConfig('top_p', String(val));
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  核采样参数 (0.0-1.0)
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  检索数量 ({retrievalTopKValue})
                </Typography>
                <Slider
                  min={1}
                  max={20}
                  step={1}
                  value={retrievalTopKValue}
                  valueLabelDisplay="auto"
                  onChange={(_, v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    updateConfig('retrieval_top_k', Math.max(1, Math.round(Number(val))));
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  每次检索返回的片段数
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  分块大小 ({chunkSizeValue})
                </Typography>
                <Slider
                  min={100}
                  max={4096}
                  step={100}
                  value={chunkSizeValue}
                  valueLabelDisplay="auto"
                  onChange={(_, v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    updateConfig('chunk_size', Math.max(100, Math.round(Number(val))));
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  文档切分时每块字符数
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  分块重叠 ({chunkOverlapValue})
                </Typography>
                <Slider
                  min={0}
                  max={512}
                  step={10}
                  value={chunkOverlapValue}
                  valueLabelDisplay="auto"
                  onChange={(_, v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    updateConfig('chunk_overlap', Math.max(0, Math.round(Number(val))));
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  相邻分块之间的重叠字符数
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* 界面设置 */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ThemeIcon />
            <Typography variant="h6">界面设置</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>主题</InputLabel>
                <Select
                  value={config.theme}
                  onChange={(e) => updateConfig('theme', e.target.value)}
                  label="主题"
                >
                  {themes.map((theme) => (
                    <MenuItem key={theme.value} value={theme.value}>
                      {theme.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>语言</InputLabel>
                <Select
                  value={config.language}
                  onChange={(e) => updateConfig('language', e.target.value)}
                  label="语言"
                >
                  {languages.map((lang) => (
                    <MenuItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* 保存按钮 */}
      <Box sx={{ mt: 3, textAlign: 'right' }}>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving}
          size="large"
        >
          {saving ? '保存中...' : '保存设置'}
        </Button>
      </Box>

      {/* 配置信息 */}
      <Paper sx={{ mt: 3, p: 2, bgcolor: 'grey.50' }}>
        <Typography variant="body2" color="text.secondary">
          配置创建时间: {new Date(config.created_at).toLocaleString()}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          最后更新时间: {new Date(config.updated_at).toLocaleString()}
        </Typography>
      </Paper>
    </Box>
  );
};

export default UserSettings;
