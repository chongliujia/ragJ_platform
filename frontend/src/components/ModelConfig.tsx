import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Slider,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Science as TestIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import type { ModelConfig, ModelProvider } from '../types/models';
import { MODEL_PROVIDERS } from '../types/models';
import { modelConfigApi, modelTestApi } from '../services/modelApi';

interface ModelConfigProps {
  type: 'chat' | 'embedding' | 'rerank';
  config: ModelConfig;
  onChange: (config: ModelConfig) => void;
  title: string;
}

const ModelConfigComponent: React.FC<ModelConfigProps> = ({
  type,
  config,
  onChange,
  title,
}) => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  // 获取当前提供商的可用模型
  const getAvailableModels = (): string[] => {
    const provider = MODEL_PROVIDERS[config.provider];
    if (!provider || !provider.models) {
      return [];
    }
    const models = (provider.models as any)[type];
    return models || [];
  };

  // 处理提供商变更
  const handleProviderChange = (provider: ModelProvider) => {
    const providerInfo = MODEL_PROVIDERS[provider];
    const availableModels = (providerInfo.models as any)[type] || [];
    
    onChange({
      ...config,
      provider,
      baseUrl: providerInfo.baseUrl,
      model: availableModels[0] || '',
    });
  };

  // 测试模型连接
  const testModel = async () => {
    if (!config.apiKey) {
      setTestResult({
        success: false,
        message: t('settings.config.enterApiKey'),
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      let response;
      
      switch (type) {
        case 'chat':
          response = await modelTestApi.testChat('你好', config);
          break;
        case 'embedding':
          response = await modelTestApi.testEmbedding('测试文本', config);
          break;
        case 'rerank':
          response = await modelTestApi.testRerank('查询', ['文档1', '文档2'], config);
          break;
        default:
          throw new Error('不支持的模型类型');
      }

      setTestResult({
        success: true,
        message: t('settings.config.testSuccess'),
      });
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.response?.data?.detail || t('settings.config.testFailed'),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">{title}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {testResult && (
                <Chip
                  icon={testResult.success ? <CheckIcon /> : <ErrorIcon />}
                  label={testResult.success ? t('settings.config.connected') : t('settings.config.connectionFailed')}
                  color={testResult.success ? 'success' : 'error'}
                  size="small"
                />
              )}
              <IconButton onClick={() => setExpanded(!expanded)}>
                {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>
          </Box>
        }
      />
      
      <Collapse in={expanded}>
        <CardContent>
          {/* 提供商选择 */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>{t('settings.config.provider')}</InputLabel>
            <Select
              value={config.provider}
              label={t('settings.config.provider')}
              onChange={(e) => handleProviderChange(e.target.value as ModelProvider)}
            >
              {Object.entries(MODEL_PROVIDERS).map(([key, provider]) => (
                <MenuItem key={key} value={key}>
                  {provider.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* API Key */}
          <Box sx={{ mb: 2 }}>
            <TextField
              fullWidth
              label={t('settings.config.apiKey')}
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
              InputProps={{
                endAdornment: (
                  <IconButton onClick={() => setShowApiKey(!showApiKey)}>
                    {showApiKey ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                ),
              }}
            />
          </Box>

          {/* 基础 URL */}
          <TextField
            fullWidth
            label={t('settings.config.baseUrl')}
            value={config.baseUrl || ''}
            onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
            sx={{ mb: 2 }}
          />

          {/* 模型选择 */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>{t('settings.config.model')}</InputLabel>
            <Select
              value={config.model}
              label={t('settings.config.model')}
              onChange={(e) => onChange({ ...config, model: e.target.value })}
            >
              {getAvailableModels().map((model) => (
                <MenuItem key={model} value={model}>
                  {model}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 聊天模型的高级参数 */}
          {type === 'chat' && (
            <>
              <Box sx={{ mb: 2 }}>
                <Typography gutterBottom>
                  {t('settings.config.temperature')}: {config.temperature || 0.7}
                </Typography>
                <Slider
                  value={config.temperature || 0.7}
                  onChange={(_, value) => onChange({ ...config, temperature: value as number })}
                  min={0}
                  max={1}
                  step={0.1}
                  marks
                  valueLabelDisplay="auto"
                />
              </Box>

              <TextField
                fullWidth
                label={t('settings.config.maxTokens')}
                type="number"
                value={config.maxTokens || 2000}
                onChange={(e) => onChange({ ...config, maxTokens: parseInt(e.target.value) })}
                sx={{ mb: 2 }}
              />

              <Box sx={{ mb: 2 }}>
                <Typography gutterBottom>
                  {t('settings.config.topP')}: {config.topP || 0.9}
                </Typography>
                <Slider
                  value={config.topP || 0.9}
                  onChange={(_, value) => onChange({ ...config, topP: value as number })}
                  min={0}
                  max={1}
                  step={0.1}
                  marks
                  valueLabelDisplay="auto"
                />
              </Box>
            </>
          )}

          {/* 测试结果 */}
          {testResult && (
            <Alert 
              severity={testResult.success ? 'success' : 'error'} 
              sx={{ mb: 2 }}
            >
              {testResult.message}
            </Alert>
          )}

          {/* 测试按钮 */}
          <Button
            variant="outlined"
            startIcon={testing ? <CircularProgress size={20} /> : <TestIcon />}
            onClick={testModel}
            disabled={testing || !config.apiKey}
            fullWidth
          >
            {testing ? t('settings.config.testing') : t('settings.config.testConnection')}
          </Button>
        </CardContent>
      </Collapse>
    </Card>
  );
};

export default ModelConfigComponent; 