/**
 * 用户设置组件 - 个人配置管理
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Chip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Save as SaveIcon,
  Person as PersonIcon,
  Palette as ThemeIcon,
  Language as LanguageIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { AuthManager } from '../services/authApi';

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

const UserSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const authManager = AuthManager.getInstance();

  // 可用的模型选项
  const chatModels = [
    'deepseek-chat',
    'qwen-max',
    'qwen-plus',
    'qwen-turbo',
  ];

  const embeddingModels = [
    'text-embedding-3-small',
    'text-embedding-ada-002',
    'bge-large-zh-v1.5',
  ];

  const rerankModels = [
    'bge-reranker-v2-m3',
    'bge-reranker-base',
  ];

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
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>聊天模型</InputLabel>
                <Select
                  value={config.preferred_chat_model}
                  onChange={(e) => updateConfig('preferred_chat_model', e.target.value)}
                  label="聊天模型"
                >
                  {chatModels.map((model) => (
                    <MenuItem key={model} value={model}>
                      {model}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>嵌入模型</InputLabel>
                <Select
                  value={config.preferred_embedding_model}
                  onChange={(e) => updateConfig('preferred_embedding_model', e.target.value)}
                  label="嵌入模型"
                >
                  {embeddingModels.map((model) => (
                    <MenuItem key={model} value={model}>
                      {model}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>重排序模型</InputLabel>
                <Select
                  value={config.preferred_rerank_model}
                  onChange={(e) => updateConfig('preferred_rerank_model', e.target.value)}
                  label="重排序模型"
                >
                  {rerankModels.map((model) => (
                    <MenuItem key={model} value={model}>
                      {model}
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
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="最大令牌数"
                type="number"
                value={config.max_tokens}
                onChange={(e) => updateConfig('max_tokens', parseInt(e.target.value))}
                inputProps={{ min: 1, max: 32768 }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="温度"
                value={config.temperature}
                onChange={(e) => updateConfig('temperature', e.target.value)}
                helperText="控制生成随机性 (0.0-2.0)"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Top-p"
                value={config.top_p}
                onChange={(e) => updateConfig('top_p', e.target.value)}
                helperText="核采样参数 (0.0-1.0)"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="检索数量"
                type="number"
                value={config.retrieval_top_k}
                onChange={(e) => updateConfig('retrieval_top_k', parseInt(e.target.value))}
                inputProps={{ min: 1, max: 20 }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="分块大小"
                type="number"
                value={config.chunk_size}
                onChange={(e) => updateConfig('chunk_size', parseInt(e.target.value))}
                inputProps={{ min: 100, max: 4096 }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="分块重叠"
                type="number"
                value={config.chunk_overlap}
                onChange={(e) => updateConfig('chunk_overlap', parseInt(e.target.value))}
                inputProps={{ min: 0, max: 512 }}
              />
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
            <Grid item xs={12} md={6}>
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
            <Grid item xs={12} md={6}>
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