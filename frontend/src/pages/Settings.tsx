import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material';
import {
  Save as SaveIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import ModelConfigComponent from '../components/ModelConfig';
import ModelPresets from '../components/ModelPresets';
import { modelConfigApi } from '../services/modelApi';
import type { ModelsConfig } from '../types/models';
import { DEFAULT_MODEL_CONFIG } from '../types/models';

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ModelsConfig>(DEFAULT_MODEL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // 加载配置
  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await modelConfigApi.getConfig();
      setConfig(response.data);
    } catch (error) {
      console.error('Failed to load config:', error);
      // 如果加载失败，使用默认配置
      setConfig(DEFAULT_MODEL_CONFIG);
      setMessage({
        type: 'error',
        text: t('settings.messages.loadError'),
      });
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const saveConfig = async () => {
    try {
      setSaving(true);
      await modelConfigApi.updateConfig(config);
      setMessage({
        type: 'success',
        text: t('settings.messages.saveSuccess'),
      });
    } catch (error: any) {
      console.error('Failed to save config:', error);
      setMessage({
        type: 'error',
        text: error.response?.data?.detail || t('settings.messages.saveError'),
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  // 清除消息
  const clearMessage = () => {
    setMessage(null);
  };

  // 应用预设配置
  const applyPreset = (presetConfig: ModelsConfig) => {
    setConfig(presetConfig);
    setMessage({
      type: 'success',
      text: t('settings.messages.presetApplied'),
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
          {t('settings.title')}
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadConfig}
            disabled={loading}
          >
            {t('settings.reload')}
          </Button>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
            onClick={saveConfig}
            disabled={saving}
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </Box>
      </Box>

      {message && (
        <Alert 
          severity={message.type} 
          sx={{ mb: 3 }} 
          onClose={clearMessage}
        >
          {message.text}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t('settings.description.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settings.description.subtitle')}
        </Typography>
        <Box component="ul" sx={{ pl: 2, mb: 0 }}>
          <Typography component="li" variant="body2" sx={{ mb: 1 }}>
            <strong>DeepSeek</strong>：{t('settings.description.providers.deepseek')}
          </Typography>
          <Typography component="li" variant="body2" sx={{ mb: 1 }}>
            <strong>通义千问</strong>：{t('settings.description.providers.qwen')}
          </Typography>
          <Typography component="li" variant="body2">
            <strong>硅基流动</strong>：{t('settings.description.providers.siliconflow')}
          </Typography>
        </Box>
      </Paper>

      {/* 预设配置 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <ModelPresets onApplyPreset={applyPreset} />
      </Paper>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* 聊天模型配置 */}
                 <ModelConfigComponent
           type="chat"
           config={config.chat}
           onChange={(newConfig) => setConfig(prev => ({ 
             ...prev, 
             chat: { ...newConfig, type: 'chat' } as any 
           }))}
           title={t('settings.models.chat')}
         />

         <Divider />

         {/* 嵌入模型配置 */}
         <ModelConfigComponent
           type="embedding"
           config={config.embedding}
           onChange={(newConfig) => setConfig(prev => ({ 
             ...prev, 
             embedding: { ...newConfig, type: 'embedding' } as any 
           }))}
           title={t('settings.models.embedding')}
         />

         <Divider />

         {/* 重排模型配置 */}
         <ModelConfigComponent
           type="rerank"
           config={config.rerank}
           onChange={(newConfig) => setConfig(prev => ({ 
             ...prev, 
             rerank: { ...newConfig, type: 'rerank' } as any 
           }))}
           title={t('settings.models.rerank')}
         />
      </Box>

      <Box sx={{ mt: 4, p: 3, backgroundColor: 'grey.50', borderRadius: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t('settings.recommendations.title')}
        </Typography>
        <Box component="ul" sx={{ pl: 2, mb: 0 }}>
          <Typography component="li" variant="body2" sx={{ mb: 1 }}>
            {t('settings.recommendations.economy')}
          </Typography>
          <Typography component="li" variant="body2" sx={{ mb: 1 }}>
            {t('settings.recommendations.premium')}
          </Typography>
          <Typography component="li" variant="body2">
            {t('settings.recommendations.chinese')}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default Settings; 