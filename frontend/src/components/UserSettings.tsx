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
  TextField,
  FormHelperText,
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
  chat_system_prompt?: string;
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
  const { t, i18n } = useTranslation();
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
    { value: 'light', labelKey: 'userSettings.theme.light' },
    { value: 'dark', labelKey: 'userSettings.theme.dark' },
    { value: 'auto', labelKey: 'userSettings.theme.auto' },
  ];

  const languages = [
    { value: 'zh', labelKey: 'userSettings.language.zh' },
    { value: 'en', labelKey: 'userSettings.language.en' },
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
      const prompt =
        (data as any)?.chat_system_prompt ||
        (data as any)?.custom_settings?.chat_system_prompt ||
        '';
      setConfig({ ...data, chat_system_prompt: prompt });
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
          chat_system_prompt: config.chat_system_prompt,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save user configuration');
      }

      const updatedConfig = await response.json();
      const prompt =
        (updatedConfig as any)?.chat_system_prompt ||
        (updatedConfig as any)?.custom_settings?.chat_system_prompt ||
        '';
      setConfig({ ...updatedConfig, chat_system_prompt: prompt });
      setSuccess(t('userSettings.messages.saved'));
      
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
        {t('userSettings.errors.loadFailed')}
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
            <Typography sx={{ fontWeight: 600 }}>{t('userSettings.help.title')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('userSettings.help.description')}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary', fontSize: 14, lineHeight: 1.8 }}>
            <li><b>{t('userSettings.help.labels.chat')}</b>{t('userSettings.help.items.chat')}</li>
            <li><b>{t('userSettings.help.labels.embedding')}</b>{t('userSettings.help.items.embedding')}</li>
            <li><b>{t('userSettings.help.labels.rerank')}</b>{t('userSettings.help.items.rerank')}</li>
            <li><b>{t('userSettings.help.labels.chunk')}</b>{t('userSettings.help.items.chunk')}</li>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* AI 模型设置 */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon />
            <Typography variant="h6">{t('userSettings.sections.aiModels')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>{t('userSettings.fields.chatModel')}</InputLabel>
                <Select
                  value={config.preferred_chat_model}
                  onChange={(e) => updateConfig('preferred_chat_model', e.target.value)}
                  label={t('userSettings.fields.chatModel')}
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
                <InputLabel>{t('userSettings.fields.embeddingModel')}</InputLabel>
                <Select
                  value={config.preferred_embedding_model}
                  onChange={(e) => updateConfig('preferred_embedding_model', e.target.value)}
                  label={t('userSettings.fields.embeddingModel')}
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
                <InputLabel>{t('userSettings.fields.rerankModel')}</InputLabel>
                <Select
                  value={config.preferred_rerank_model}
                  onChange={(e) => updateConfig('preferred_rerank_model', e.target.value)}
                  label={t('userSettings.fields.rerankModel')}
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

      {/* 聊天提示词设置 */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon />
            <Typography variant="h6">{t('userSettings.sections.prompt')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <TextField
            fullWidth
            multiline
            minRows={4}
            label={t('userSettings.fields.chatSystemPrompt')}
            value={config.chat_system_prompt || ''}
            onChange={(e) => updateConfig('chat_system_prompt', e.target.value)}
            placeholder={t('userSettings.fields.chatSystemPromptPlaceholder')}
          />
          <FormHelperText sx={{ mt: 1 }}>
            {t('userSettings.fields.chatSystemPromptHelp')}
          </FormHelperText>
        </AccordionDetails>
      </Accordion>

      {/* 模型参数设置 */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon />
            <Typography variant="h6">{t('userSettings.sections.modelParams')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('userSettings.params.maxTokens', { value: maxTokensValue })}
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
                  {t('userSettings.params.maxTokensHelp')}
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('userSettings.params.temperature', { value: temperatureValue.toFixed(2) })}
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
                  {t('userSettings.params.temperatureHelp')}
                </Typography>
              </Box>
            </Grid>
	            <Grid size={{ xs: 12, md: 4 }}>
	              <Box sx={{ px: 1 }}>
	                <Typography variant="subtitle2" sx={{ mb: 1 }}>
	                  {t('userSettings.params.topP', { value: topPValue.toFixed(2) })}
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
                  {t('userSettings.params.topPHelp')}
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('userSettings.params.retrievalTopK', { value: retrievalTopKValue })}
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
                  {t('userSettings.params.retrievalTopKHelp')}
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('userSettings.params.chunkSize', { value: chunkSizeValue })}
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
                  {t('userSettings.params.chunkSizeHelp')}
                </Typography>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ px: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('userSettings.params.chunkOverlap', { value: chunkOverlapValue })}
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
                  {t('userSettings.params.chunkOverlapHelp')}
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
            <Typography variant="h6">{t('userSettings.sections.ui')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('userSettings.fields.theme')}</InputLabel>
                <Select
                  value={config.theme}
                  onChange={(e) => updateConfig('theme', e.target.value)}
                  label={t('userSettings.fields.theme')}
                >
                  {themes.map((theme) => (
                    <MenuItem key={theme.value} value={theme.value}>
                      {t(theme.labelKey)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('userSettings.fields.language')}</InputLabel>
                <Select
                  value={config.language}
                  onChange={(e) => updateConfig('language', e.target.value)}
                  label={t('userSettings.fields.language')}
                >
                  {languages.map((lang) => (
                    <MenuItem key={lang.value} value={lang.value}>
                      {t(lang.labelKey)}
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
          {saving ? t('userSettings.actions.saving') : t('userSettings.actions.save')}
        </Button>
      </Box>

      {/* 配置信息 */}
      <Paper sx={{ mt: 3, p: 2, bgcolor: 'grey.50' }}>
        <Typography variant="body2" color="text.secondary">
          {t('userSettings.meta.createdAt')}: {new Date(config.created_at).toLocaleString()}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('userSettings.meta.updatedAt')}: {new Date(config.updated_at).toLocaleString()}
        </Typography>
      </Paper>
    </Box>
  );
};

export default UserSettings;
