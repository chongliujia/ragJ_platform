import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  CardActions,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Check as CheckIcon,
  Error as ErrorIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Speed as TestIcon,
  ExpandMore as ExpandMoreIcon,
  Info as InfoIcon,
  Star as StarIcon,
} from '@mui/icons-material';
import { modelConfigApi } from '../services/modelConfigApi';
import type { 
  ProviderConfig, 
  ModelConfig, 
  UpdateModelConfigRequest, 
  PresetConfig 
} from '../services/modelConfigApi';

const ModelConfigManager: React.FC = () => {
  const { t } = useTranslation();
  
  // 状态管理
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [activeModels, setActiveModels] = useState<ModelConfig[]>([]);
  const [presets, setPresets] = useState<Record<string, PresetConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // 对话框状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<{
    type: string;
    config: UpdateModelConfigRequest;
  } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  
  // 测试状态
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // 加载数据
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [providersResponse, activeModelsResponse, presetsResponse] = await Promise.all([
        modelConfigApi.getProviders(),
        modelConfigApi.getActiveModels(),
        modelConfigApi.getPresets()
      ]);
      
      setProviders(providersResponse.data);
      setActiveModels(activeModelsResponse.data);
      setPresets(presetsResponse.data.presets);
      
    } catch (error: any) {
      console.error('Failed to load model config:', error);
      setError(error.response?.data?.detail || '加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 清除消息
  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  // 获取模型类型的中文名称
  const getModelTypeName = (type: string) => {
    switch (type) {
      case 'chat': return '聊天模型';
      case 'embedding': return '嵌入模型';
      case 'reranking': return '重排模型';
      default: return type;
    }
  };

  // 获取提供商的中文名称
  const getProviderName = (provider: string) => {
    const providerConfig = providers.find(p => p.provider === provider);
    return providerConfig?.display_name || provider;
  };

  // 打开编辑对话框
  const openEditDialog = async (modelType: string) => {
    try {
      const activeModel = activeModels.find(m => m.model_type === modelType);
      if (!activeModel) return;

      // 获取模型配置详情（包含已保存的API密钥）
      const [modelsResponse, detailsResponse] = await Promise.all([
        modelConfigApi.getProviderModels(activeModel.provider, modelType),
        modelConfigApi.getModelConfigDetails(modelType)
      ]);
      
      setAvailableModels(modelsResponse.data.models);

      // 设置编辑配置，使用已保存的值
      setEditingModel({
        type: modelType,
        config: {
          provider: detailsResponse.data.provider,
          model_name: detailsResponse.data.model_name,
          api_key: detailsResponse.data.api_key, // 使用已保存的API密钥（或为空）
          api_base: detailsResponse.data.api_base,
          temperature: detailsResponse.data.temperature,
          max_tokens: detailsResponse.data.max_tokens,
          enabled: detailsResponse.data.enabled,
        }
      });
      
      setEditDialogOpen(true);
    } catch (error: any) {
      console.error('Failed to open edit dialog:', error);
      setError(error.response?.data?.detail || '获取模型配置失败');
    }
  };

  // 保存模型配置
  const saveModelConfig = async () => {
    if (!editingModel) return;

    try {
      await modelConfigApi.updateActiveModel(editingModel.type, editingModel.config);
      setSuccess('模型配置更新成功');
      setEditDialogOpen(false);
      setEditingModel(null);
      loadData();
    } catch (error: any) {
      console.error('Failed to save model config:', error);
      setError(error.response?.data?.detail || '保存配置失败');
    }
  };

  // 更新编辑配置
  const updateEditingConfig = (updates: Partial<UpdateModelConfigRequest>) => {
    if (!editingModel) return;
    
    setEditingModel({
      ...editingModel,
      config: { ...editingModel.config, ...updates }
    });
  };

  // 当提供商变化时更新可用模型
  const handleProviderChange = async (provider: string) => {
    if (!editingModel) return;
    
    try {
      const modelsResponse = await modelConfigApi.getProviderModels(provider, editingModel.type);
      setAvailableModels(modelsResponse.data.models);
      
      updateEditingConfig({
        provider,
        model_name: modelsResponse.data.models[0] || ''
      });
    } catch (error) {
      console.error('Failed to get models for provider:', error);
    }
  };

  // 测试提供商连接
  const testProvider = async (provider: string) => {
    try {
      setTestingProvider(provider);
      await modelConfigApi.testProviderConnection(provider);
      setSuccess(`${getProviderName(provider)} 连接测试成功`);
    } catch (error: any) {
      console.error('Provider test failed:', error);
      setError(error.response?.data?.detail || `${getProviderName(provider)} 连接测试失败`);
    } finally {
      setTestingProvider(null);
    }
  };

  // 应用预设配置
  const applyPreset = async (presetKey: string) => {
    try {
      const preset = presets[presetKey];
      if (!preset) return;

      // 这里需要用户输入API密钥，暂时提示用户
      setSuccess(`已选择 ${preset.name} 预设，请为每个模型配置API密钥`);
    } catch (error: any) {
      console.error('Failed to apply preset:', error);
      setError('应用预设失败');
    }
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
          模型配置管理
        </Typography>
        <Button
          variant="outlined"
          onClick={loadData}
          disabled={loading}
          startIcon={<SettingsIcon />}
        >
          刷新配置
        </Button>
      </Box>

      {/* 消息提示 */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={clearMessages}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={clearMessages}>
          {success}
        </Alert>
      )}

      {/* 预设配置 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <StarIcon color="primary" />
          快速配置预设
        </Typography>
        <Grid container spacing={2}>
          {Object.entries(presets).map(([key, preset]) => (
            <Grid item xs={12} md={4} key={key}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    {preset.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {preset.description}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {Object.entries(preset.models).map(([modelType, config]) => (
                      <Box key={modelType} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" sx={{ minWidth: 60 }}>
                          {getModelTypeName(modelType)}:
                        </Typography>
                        <Chip 
                          label={getProviderName(config.provider)} 
                          size="small" 
                          variant="outlined"
                        />
                      </Box>
                    ))}
                  </Box>
                </CardContent>
                <CardActions>
                  <Button 
                    size="small" 
                    onClick={() => applyPreset(key)}
                    startIcon={<CheckIcon />}
                  >
                    应用预设
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* 当前活跃模型 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <SettingsIcon color="primary" />
          当前活跃模型
        </Typography>
        <Grid container spacing={2}>
          {activeModels.map((model) => (
            <Grid item xs={12} md={4} key={model.model_type}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="h6">
                      {getModelTypeName(model.model_type)}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {model.has_api_key ? (
                        <CheckIcon color="success" fontSize="small" />
                      ) : (
                        <ErrorIcon color="error" fontSize="small" />
                      )}
                      <Switch checked={model.enabled} size="small" disabled />
                    </Box>
                  </Box>
                  
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    提供商: {getProviderName(model.provider)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    模型: {model.model_name}
                  </Typography>
                  <Typography variant="body2" color={model.has_api_key ? "success.main" : "error.main"}>
                    API密钥: {model.has_api_key ? "已配置" : "未配置"}
                  </Typography>
                </CardContent>
                <CardActions>
                  <Button 
                    size="small" 
                    startIcon={<EditIcon />}
                    onClick={() => openEditDialog(model.model_type)}
                  >
                    编辑配置
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* 提供商状态 */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          提供商状态
        </Typography>
        <Grid container spacing={2}>
          {providers.map((provider) => (
            <Grid item xs={12} md={6} key={provider.provider}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="h6">
                      {provider.display_name}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {provider.has_api_key ? (
                        <CheckIcon color="success" fontSize="small" />
                      ) : (
                        <ErrorIcon color="error" fontSize="small" />
                      )}
                    </Box>
                  </Box>
                  
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {provider.description}
                  </Typography>
                  
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    API端点: {provider.api_base}
                  </Typography>
                  <Typography variant="body2" color={provider.has_api_key ? "success.main" : "error.main"}>
                    API密钥: {provider.has_api_key ? "已配置" : "未配置"}
                  </Typography>
                  
                  {/* 可用模型数量 */}
                  <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {Object.entries(provider.available_models).map(([modelType, models]) => (
                      <Chip 
                        key={modelType}
                        label={`${getModelTypeName(modelType)}: ${models.length}`}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </CardContent>
                <CardActions>
                  {provider.has_api_key && (
                    <Button 
                      size="small" 
                      startIcon={testingProvider === provider.provider ? 
                        <CircularProgress size={16} /> : <TestIcon />
                      }
                      onClick={() => testProvider(provider.provider)}
                      disabled={testingProvider === provider.provider}
                    >
                      测试连接
                    </Button>
                  )}
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* 编辑模型配置对话框 */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          编辑 {editingModel ? getModelTypeName(editingModel.type) : ''} 配置
        </DialogTitle>
        <DialogContent>
          {editingModel && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
              {/* 提供商选择 */}
              <FormControl fullWidth>
                <InputLabel>提供商</InputLabel>
                <Select
                  value={editingModel.config.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  label="提供商"
                >
                  {providers.map((provider) => (
                    <MenuItem key={provider.provider} value={provider.provider}>
                      {provider.display_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* 模型选择 */}
              <FormControl fullWidth>
                <InputLabel>模型</InputLabel>
                <Select
                  value={editingModel.config.model_name}
                  onChange={(e) => updateEditingConfig({ model_name: e.target.value })}
                  label="模型"
                >
                  {availableModels.map((model) => (
                    <MenuItem key={model} value={model}>
                      {model}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* API密钥 */}
              <TextField
                label="API密钥"
                type="password"
                value={editingModel.config.api_key}
                onChange={(e) => updateEditingConfig({ api_key: e.target.value })}
                required={!editingModel.config.api_key || !editingModel.config.api_key.includes('*')}
                fullWidth
                helperText={
                  editingModel.config.api_key && editingModel.config.api_key.includes('*') 
                    ? '已保存API密钥，留空保持不变或输入新的API密钥' 
                    : '请输入有效的API密钥'
                }
                placeholder={
                  editingModel.config.api_key && editingModel.config.api_key.includes('*') 
                    ? '留空保持原有API密钥' 
                    : '请输入API密钥'
                }
              />

              {/* API端点 */}
              <TextField
                label="API端点 (可选)"
                value={editingModel.config.api_base || ''}
                onChange={(e) => updateEditingConfig({ api_base: e.target.value })}
                fullWidth
                helperText="留空使用默认端点"
              />
              
              {/* 温度参数 */}
              <TextField
                label="温度 (可选)"
                type="number"
                value={editingModel.config.temperature || ''}
                onChange={(e) => updateEditingConfig({ temperature: parseFloat(e.target.value) || undefined })}
                fullWidth
                inputProps={{ min: 0, max: 2, step: 0.1 }}
                helperText="控制输出的随机性（0-2）"
              />
              
              {/* 最大令牌数 */}
              <TextField
                label="最大令牌数 (可选)"
                type="number"
                value={editingModel.config.max_tokens || ''}
                onChange={(e) => updateEditingConfig({ max_tokens: parseInt(e.target.value) || undefined })}
                fullWidth
                inputProps={{ min: 1, max: 100000 }}
                helperText="限制输出的最大令牌数"
              />

              {/* 启用开关 */}
              <FormControlLabel
                control={
                  <Switch
                    checked={editingModel.config.enabled}
                    onChange={(e) => updateEditingConfig({ enabled: e.target.checked })}
                  />
                }
                label="启用此模型"
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>
            取消
          </Button>
          <Button 
            onClick={saveModelConfig}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={
              !editingModel?.config.api_key || 
              (!editingModel.config.api_key.includes('*') && editingModel.config.api_key.trim() === '')
            }
          >
            保存配置
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModelConfigManager;