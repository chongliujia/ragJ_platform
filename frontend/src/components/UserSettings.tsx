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
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
  Switch,
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
  preferred_extraction_model: string;
  extraction_max_chunks: number;
  extraction_max_text_chars: number;
  extraction_max_items: number;
  extraction_document_limit: number;
  extraction_auto_chunking: boolean;
  extraction_chunk_strategy: string;
  extraction_mode: string;
  extraction_progressive_enabled: boolean;
  extraction_progressive_min_items: number;
  extraction_progressive_step: number;
  extraction_summary_max_chars: number;
  extraction_entity_type_whitelist: string;
  extraction_relation_type_whitelist: string;
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

const EXTRACTION_MAX_CHUNKS_LIMIT = 50;
const EXTRACTION_MAX_TEXT_CHARS_LIMIT = 4000;
const EXTRACTION_MAX_ITEMS_LIMIT = 30;
const EXTRACTION_DOCUMENT_LIMIT = 50;
const EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS = 6;
const EXTRACTION_DEFAULT_PROGRESSIVE_STEP = 3;
const EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS = 2000;
const EXTRACTION_MAX_PROGRESSIVE_ITEMS = 50;
const EXTRACTION_MAX_PROGRESSIVE_STEP = 50;
const EXTRACTION_MAX_SUMMARY_CHARS = 4000;

const coerceBoundedInt = (value: any, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const coerceBoolean = (value: any, fallback: boolean) => {
  if (value === true || value === false) return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
};

const coerceChunkStrategy = (value: any, fallback: string) => {
  if (value === 'uniform' || value === 'leading' || value === 'head_tail' || value === 'diverse') {
    return value;
  }
  return fallback;
};

const coerceExtractionMode = (value: any, fallback: string) => {
  if (value === 'direct' || value === 'summary') return value;
  return fallback;
};

const clampInt = (value: any, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const CHUNK_STRATEGY_OPTIONS = [
  { value: 'uniform', labelKey: 'userSettings.fields.extractionChunkStrategyUniform' },
  { value: 'leading', labelKey: 'userSettings.fields.extractionChunkStrategyLeading' },
  { value: 'head_tail', labelKey: 'userSettings.fields.extractionChunkStrategyHeadTail' },
  { value: 'diverse', labelKey: 'userSettings.fields.extractionChunkStrategyDiverse' },
];

const EXTRACTION_MODE_OPTIONS = [
  { value: 'direct', labelKey: 'userSettings.fields.extractionModeDirect' },
  { value: 'summary', labelKey: 'userSettings.fields.extractionModeSummary' },
];

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
      const extractionModel =
        (data as any)?.preferred_extraction_model ||
        (data as any)?.preferred_chat_model ||
        '';
      setConfig({
        ...data,
        preferred_extraction_model: extractionModel,
        extraction_max_chunks: coerceBoundedInt((data as any)?.extraction_max_chunks, 3, 1, EXTRACTION_MAX_CHUNKS_LIMIT),
        extraction_max_text_chars: coerceBoundedInt((data as any)?.extraction_max_text_chars, 1800, 200, EXTRACTION_MAX_TEXT_CHARS_LIMIT),
        extraction_max_items: coerceBoundedInt((data as any)?.extraction_max_items, 12, 1, EXTRACTION_MAX_ITEMS_LIMIT),
        extraction_document_limit: coerceBoundedInt((data as any)?.extraction_document_limit, 6, 1, EXTRACTION_DOCUMENT_LIMIT),
        extraction_auto_chunking: coerceBoolean((data as any)?.extraction_auto_chunking, false),
        extraction_chunk_strategy: coerceChunkStrategy(
          (data as any)?.extraction_chunk_strategy,
          'uniform'
        ),
        extraction_mode: coerceExtractionMode(
          (data as any)?.extraction_mode,
          'direct'
        ),
        extraction_progressive_enabled: coerceBoolean(
          (data as any)?.extraction_progressive_enabled,
          false
        ),
        extraction_progressive_min_items: coerceBoundedInt(
          (data as any)?.extraction_progressive_min_items,
          EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS,
          1,
          EXTRACTION_MAX_PROGRESSIVE_ITEMS
        ),
        extraction_progressive_step: coerceBoundedInt(
          (data as any)?.extraction_progressive_step,
          EXTRACTION_DEFAULT_PROGRESSIVE_STEP,
          1,
          EXTRACTION_MAX_PROGRESSIVE_STEP
        ),
        extraction_summary_max_chars: coerceBoundedInt(
          (data as any)?.extraction_summary_max_chars,
          EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS,
          200,
          EXTRACTION_MAX_SUMMARY_CHARS
        ),
        extraction_entity_type_whitelist: String(
          (data as any)?.extraction_entity_type_whitelist || ''
        ),
        extraction_relation_type_whitelist: String(
          (data as any)?.extraction_relation_type_whitelist || ''
        ),
        chat_system_prompt: prompt,
      });
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
          preferred_extraction_model: config.preferred_extraction_model,
          extraction_max_chunks: config.extraction_max_chunks,
          extraction_max_text_chars: config.extraction_max_text_chars,
          extraction_max_items: config.extraction_max_items,
          extraction_document_limit: config.extraction_document_limit,
          extraction_auto_chunking: config.extraction_auto_chunking,
          extraction_chunk_strategy: config.extraction_chunk_strategy,
          extraction_mode: config.extraction_mode,
          extraction_progressive_enabled: config.extraction_progressive_enabled,
          extraction_progressive_min_items: config.extraction_progressive_min_items,
          extraction_progressive_step: config.extraction_progressive_step,
          extraction_summary_max_chars: config.extraction_summary_max_chars,
          extraction_entity_type_whitelist: config.extraction_entity_type_whitelist,
          extraction_relation_type_whitelist: config.extraction_relation_type_whitelist,
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
      const extractionModel =
        (updatedConfig as any)?.preferred_extraction_model ||
        (updatedConfig as any)?.preferred_chat_model ||
        '';
      setConfig({
        ...updatedConfig,
        preferred_extraction_model: extractionModel,
        extraction_max_chunks: coerceBoundedInt((updatedConfig as any)?.extraction_max_chunks, 3, 1, EXTRACTION_MAX_CHUNKS_LIMIT),
        extraction_max_text_chars: coerceBoundedInt((updatedConfig as any)?.extraction_max_text_chars, 1800, 200, EXTRACTION_MAX_TEXT_CHARS_LIMIT),
        extraction_max_items: coerceBoundedInt((updatedConfig as any)?.extraction_max_items, 12, 1, EXTRACTION_MAX_ITEMS_LIMIT),
        extraction_document_limit: coerceBoundedInt((updatedConfig as any)?.extraction_document_limit, 6, 1, EXTRACTION_DOCUMENT_LIMIT),
        extraction_auto_chunking: coerceBoolean((updatedConfig as any)?.extraction_auto_chunking, false),
        extraction_chunk_strategy: coerceChunkStrategy(
          (updatedConfig as any)?.extraction_chunk_strategy,
          'uniform'
        ),
        extraction_mode: coerceExtractionMode(
          (updatedConfig as any)?.extraction_mode,
          'direct'
        ),
        extraction_progressive_enabled: coerceBoolean(
          (updatedConfig as any)?.extraction_progressive_enabled,
          false
        ),
        extraction_progressive_min_items: coerceBoundedInt(
          (updatedConfig as any)?.extraction_progressive_min_items,
          EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS,
          1,
          EXTRACTION_MAX_PROGRESSIVE_ITEMS
        ),
        extraction_progressive_step: coerceBoundedInt(
          (updatedConfig as any)?.extraction_progressive_step,
          EXTRACTION_DEFAULT_PROGRESSIVE_STEP,
          1,
          EXTRACTION_MAX_PROGRESSIVE_STEP
        ),
        extraction_summary_max_chars: coerceBoundedInt(
          (updatedConfig as any)?.extraction_summary_max_chars,
          EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS,
          200,
          EXTRACTION_MAX_SUMMARY_CHARS
        ),
        extraction_entity_type_whitelist: String(
          (updatedConfig as any)?.extraction_entity_type_whitelist || ''
        ),
        extraction_relation_type_whitelist: String(
          (updatedConfig as any)?.extraction_relation_type_whitelist || ''
        ),
        chat_system_prompt: prompt,
      });
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
  const extractionModelNames = Array.from(new Set([
    ...availableChatModels.map(m => m.model_name),
    ...(config?.preferred_extraction_model ? [config.preferred_extraction_model] : []),
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
  const extractionMaxChunksValue = coerceBoundedInt(config.extraction_max_chunks, 3, 1, EXTRACTION_MAX_CHUNKS_LIMIT);
  const extractionMaxTextCharsValue = coerceBoundedInt(
    config.extraction_max_text_chars,
    1800,
    200,
    EXTRACTION_MAX_TEXT_CHARS_LIMIT
  );
  const extractionMaxItemsValue = coerceBoundedInt(config.extraction_max_items, 12, 1, EXTRACTION_MAX_ITEMS_LIMIT);
  const extractionDocumentLimitValue = coerceBoundedInt(
    config.extraction_document_limit,
    6,
    1,
    EXTRACTION_DOCUMENT_LIMIT
  );
  const extractionAutoChunkingValue = coerceBoolean(config.extraction_auto_chunking, false);
  const extractionChunkStrategyValue = coerceChunkStrategy(config.extraction_chunk_strategy, 'uniform');
  const extractionModeValue = coerceExtractionMode(config.extraction_mode, 'direct');
  const extractionProgressiveEnabledValue = coerceBoolean(
    config.extraction_progressive_enabled,
    false
  );
  const extractionProgressiveMinItemsValue = coerceBoundedInt(
    config.extraction_progressive_min_items,
    EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS,
    1,
    EXTRACTION_MAX_PROGRESSIVE_ITEMS
  );
  const extractionProgressiveStepValue = coerceBoundedInt(
    config.extraction_progressive_step,
    EXTRACTION_DEFAULT_PROGRESSIVE_STEP,
    1,
    EXTRACTION_MAX_PROGRESSIVE_STEP
  );
  const extractionSummaryMaxCharsValue = coerceBoundedInt(
    config.extraction_summary_max_chars,
    EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS,
    200,
    EXTRACTION_MAX_SUMMARY_CHARS
  );

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
            <li><b>{t('userSettings.help.labels.extraction')}</b>{t('userSettings.help.items.extraction')}</li>
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
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>{t('userSettings.fields.extractionModel')}</InputLabel>
                <Select
                  value={config.preferred_extraction_model}
                  onChange={(e) => updateConfig('preferred_extraction_model', e.target.value)}
                  label={t('userSettings.fields.extractionModel')}
                  disabled={modelsLoading}
                >
                  {extractionModelNames.map((modelName) => {
                    const info = availableChatModels.find(m => m.model_name === modelName);
                    const displayName = info ? info.model_display_name : modelName;
                    return (
                      <MenuItem key={modelName} value={modelName}>
                        {displayName}
                      </MenuItem>
                    );
                  })}
                </Select>
                <FormHelperText>{t('userSettings.fields.extractionModelHelp')}</FormHelperText>
              </FormControl>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* 语义抽取默认参数 */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon />
            <Typography variant="h6">{t('userSettings.sections.extraction')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label={t('userSettings.fields.extractionMaxChunks')}
                value={extractionMaxChunksValue}
                onChange={(e) =>
                  updateConfig(
                    'extraction_max_chunks',
                    clampInt(e.target.value, 1, EXTRACTION_MAX_CHUNKS_LIMIT)
                  )
                }
                helperText={t('userSettings.fields.extractionMaxChunksHelp')}
                inputProps={{ min: 1, max: EXTRACTION_MAX_CHUNKS_LIMIT, step: 1 }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label={t('userSettings.fields.extractionMaxTextChars')}
                value={extractionMaxTextCharsValue}
                onChange={(e) =>
                  updateConfig(
                    'extraction_max_text_chars',
                    clampInt(e.target.value, 200, EXTRACTION_MAX_TEXT_CHARS_LIMIT)
                  )
                }
                helperText={t('userSettings.fields.extractionMaxTextCharsHelp')}
                inputProps={{ min: 200, max: EXTRACTION_MAX_TEXT_CHARS_LIMIT, step: 50 }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label={t('userSettings.fields.extractionMaxItems')}
                value={extractionMaxItemsValue}
                onChange={(e) =>
                  updateConfig(
                    'extraction_max_items',
                    clampInt(e.target.value, 1, EXTRACTION_MAX_ITEMS_LIMIT)
                  )
                }
                helperText={t('userSettings.fields.extractionMaxItemsHelp')}
                inputProps={{ min: 1, max: EXTRACTION_MAX_ITEMS_LIMIT, step: 1 }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label={t('userSettings.fields.extractionDocumentLimit')}
                value={extractionDocumentLimitValue}
                onChange={(e) =>
                  updateConfig(
                    'extraction_document_limit',
                    clampInt(e.target.value, 1, EXTRACTION_DOCUMENT_LIMIT)
                  )
                }
                helperText={t('userSettings.fields.extractionDocumentLimitHelp')}
                inputProps={{ min: 1, max: EXTRACTION_DOCUMENT_LIMIT, step: 1 }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl component="fieldset">
                <FormControlLabel
                  control={
                    <Switch
                      checked={extractionAutoChunkingValue}
                      onChange={(e) => updateConfig('extraction_auto_chunking', e.target.checked)}
                    />
                  }
                  label={t('userSettings.fields.extractionAutoChunking')}
                />
                <FormHelperText>{t('userSettings.fields.extractionAutoChunkingHelp')}</FormHelperText>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>{t('userSettings.fields.extractionChunkStrategy')}</InputLabel>
                <Select
                  value={extractionChunkStrategyValue}
                  onChange={(e) => updateConfig('extraction_chunk_strategy', e.target.value)}
                  label={t('userSettings.fields.extractionChunkStrategy')}
                >
                  {CHUNK_STRATEGY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{t('userSettings.fields.extractionChunkStrategyHelp')}</FormHelperText>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>{t('userSettings.fields.extractionMode')}</InputLabel>
                <Select
                  value={extractionModeValue}
                  onChange={(e) => updateConfig('extraction_mode', e.target.value)}
                  label={t('userSettings.fields.extractionMode')}
                >
                  {EXTRACTION_MODE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{t('userSettings.fields.extractionModeHelp')}</FormHelperText>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label={t('userSettings.fields.extractionSummaryMaxChars')}
                value={extractionSummaryMaxCharsValue}
                onChange={(e) =>
                  updateConfig(
                    'extraction_summary_max_chars',
                    clampInt(e.target.value, 200, EXTRACTION_MAX_SUMMARY_CHARS)
                  )
                }
                helperText={t('userSettings.fields.extractionSummaryMaxCharsHelp')}
                inputProps={{ min: 200, max: EXTRACTION_MAX_SUMMARY_CHARS, step: 50 }}
                disabled={extractionModeValue !== 'summary'}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl component="fieldset">
                <FormControlLabel
                  control={
                    <Switch
                      checked={extractionProgressiveEnabledValue}
                      onChange={(e) =>
                        updateConfig('extraction_progressive_enabled', e.target.checked)
                      }
                    />
                  }
                  label={t('userSettings.fields.extractionProgressiveEnabled')}
                />
                <FormHelperText>
                  {t('userSettings.fields.extractionProgressiveEnabledHelp')}
                </FormHelperText>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label={t('userSettings.fields.extractionProgressiveMinItems')}
                value={extractionProgressiveMinItemsValue}
                onChange={(e) =>
                  updateConfig(
                    'extraction_progressive_min_items',
                    clampInt(e.target.value, 1, EXTRACTION_MAX_PROGRESSIVE_ITEMS)
                  )
                }
                helperText={t('userSettings.fields.extractionProgressiveMinItemsHelp')}
                inputProps={{ min: 1, max: EXTRACTION_MAX_PROGRESSIVE_ITEMS, step: 1 }}
                disabled={!extractionProgressiveEnabledValue}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="number"
                label={t('userSettings.fields.extractionProgressiveStep')}
                value={extractionProgressiveStepValue}
                onChange={(e) =>
                  updateConfig(
                    'extraction_progressive_step',
                    clampInt(e.target.value, 1, EXTRACTION_MAX_PROGRESSIVE_STEP)
                  )
                }
                helperText={t('userSettings.fields.extractionProgressiveStepHelp')}
                inputProps={{ min: 1, max: EXTRACTION_MAX_PROGRESSIVE_STEP, step: 1 }}
                disabled={!extractionProgressiveEnabledValue}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('userSettings.fields.extractionEntityTypeWhitelist')}
                value={config.extraction_entity_type_whitelist || ''}
                onChange={(e) =>
                  updateConfig('extraction_entity_type_whitelist', e.target.value)
                }
                helperText={t('userSettings.fields.extractionEntityTypeWhitelistHelp')}
                multiline
                minRows={2}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('userSettings.fields.extractionRelationTypeWhitelist')}
                value={config.extraction_relation_type_whitelist || ''}
                onChange={(e) =>
                  updateConfig('extraction_relation_type_whitelist', e.target.value)
                }
                helperText={t('userSettings.fields.extractionRelationTypeWhitelistHelp')}
                multiline
                minRows={2}
              />
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
