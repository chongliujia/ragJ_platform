import React, { useState, useEffect } from 'react';
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
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

type ModelConfigScope = 'me' | 'tenant';

interface ModelConfigManagerProps {
  scope?: ModelConfigScope;
}

const MODEL_TYPES: Array<ModelConfig['model_type']> = ['chat', 'embedding', 'reranking'];

const ModelConfigManager: React.FC<ModelConfigManagerProps> = ({ scope = 'me' }) => {
  const scopedApi = scope === 'tenant' ? modelConfigApi.tenant : modelConfigApi;
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
  const [customModelName, setCustomModelName] = useState<string>('');

  // Provider 配置对话框（先配置提供商 key/base，再选模型）
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<{
    provider: string;
    display_name: string;
    api_base: string;
    api_key: string;
    enabled: boolean;
    has_api_key: boolean;
  } | null>(null);
  
  // 测试状态
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // 加载数据
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [providersResponse, activeModelsResponse, presetsResponse] = await Promise.all([
        scopedApi.getProviders(),
        scopedApi.getActiveModels(),
        modelConfigApi.getPresets()
      ]);
      
      setProviders(providersResponse.data);
      const list = Array.isArray(activeModelsResponse.data) ? activeModelsResponse.data : [];
      const byType = new Map(list.map((m) => [m.model_type, m]));
      const fallbackProvider = providersResponse.data?.[0]?.provider || 'local';
      setActiveModels(
        MODEL_TYPES.map((t) => byType.get(t) || ({
          model_type: t,
          provider: fallbackProvider,
          model_name: '',
          has_api_key: false,
          enabled: true,
        } as ModelConfig))
      );
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
      const initialProvider = activeModel?.provider || providers?.[0]?.provider || 'local';

      const modelsResponse = await scopedApi.getProviderModels(initialProvider, modelType);
      const models = modelsResponse.data?.models || [];
      setAvailableModels(models);

      let details: any = null;
      try {
        const detailsResponse = await scopedApi.getModelConfigDetails(modelType);
        details = detailsResponse.data;
      } catch {
        details = null;
      }

      const providerToEdit = details?.provider || initialProvider;
      const modelToEdit = details?.model_name || models?.[0] || '';
      const providerBase = providers.find((p) => p.provider === providerToEdit)?.api_base || '';

      setEditingModel({
        type: modelType,
        config: {
          provider: providerToEdit,
          model_name: modelToEdit,
          api_key: details?.api_key || '',
          api_base: details?.api_base || providerBase || undefined,
          temperature: details?.temperature,
          max_tokens: details?.max_tokens,
          enabled: details?.enabled ?? true,
        }
      });
      
      // 重置自定义模型名称状态
      setCustomModelName('');
      
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
      // 如果使用了自定义模型名称，先将其添加到提供商的模型列表中
      if (!availableModels.includes(editingModel.config.model_name)) {
        try {
          await scopedApi.addCustomModel(
            editingModel.config.provider,
            editingModel.type,
            editingModel.config.model_name
          );
          console.log('Custom model added to provider list');
        } catch (addError) {
          console.warn('Failed to add custom model to provider list:', addError);
          // 继续保存配置，即使添加到提供商列表失败
        }
      }

      await scopedApi.updateActiveModel(editingModel.type, editingModel.config);
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
      const modelsResponse = await scopedApi.getProviderModels(provider, editingModel.type);
      setAvailableModels(modelsResponse.data.models);

      const providerBase = providers.find(p => p.provider === provider)?.api_base || '';
      const providerRow = providers.find(p => p.provider === provider);
      const providerHasKey = !!providerRow?.has_api_key;
      const providerRequiresKey = providerRow ? providerRow.requires_api_key !== false : true;

      updateEditingConfig({
        provider,
        model_name: modelsResponse.data.models[0] || '',
        // 切换 provider 时清空 model-level key，避免把旧 provider 的掩码 key 带过去
        api_key: '',
        api_base: providerBase || undefined,
        enabled: true,
      });

      if (!providerRequiresKey || providerHasKey) {
        setSuccess(`${getProviderName(provider)} 已配置 API 密钥；模型配置可留空使用该密钥`);
      }
    } catch (error) {
      console.error('Failed to get models for provider:', error);
    }
  };

  const openProviderDialog = (p: ProviderConfig) => {
    setEditingProvider({
      provider: p.provider,
      display_name: p.display_name,
      api_base: p.api_base || '',
      api_key: '',
      enabled: p.enabled,
      has_api_key: p.has_api_key,
    });
    setProviderDialogOpen(true);
  };

  const saveProviderConfig = async () => {
    if (!editingProvider) return;
    try {
      await scopedApi.updateProvider(editingProvider.provider, {
        api_key: editingProvider.api_key, // 允许为空：后端会保持不变（若已配置）
        api_base: editingProvider.api_base || undefined,
        enabled: editingProvider.enabled,
      });
      setSuccess(`${editingProvider.display_name} 提供商配置已更新`);
      setProviderDialogOpen(false);
      setEditingProvider(null);
      await loadData();
    } catch (error: any) {
      console.error('Failed to save provider config:', error);
      setError(error.response?.data?.detail || '保存提供商配置失败');
    }
  };

  // 测试提供商连接
  const testProvider = async (provider: string) => {
    try {
      setTestingProvider(provider);
      await scopedApi.testProviderConnection(provider);
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
          {scope === 'tenant' ? '租户共享模型配置' : '个人模型配置'}
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

      {/* 折叠说明区 */}
      <Accordion sx={{ mb: 3 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InfoIcon color="action" fontSize="small" />
            <Typography sx={{ fontWeight: 600 }}>使用说明</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {scope === 'tenant'
              ? '这里配置的是租户共享模型：先配置提供商，再选择每类模型的默认值（Chat/Embedding/Rerank）。'
              : '这里配置的是个人模型：先配置提供商，再选择每类模型的默认值（Chat/Embedding/Rerank）。'}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary', fontSize: 14, lineHeight: 1.8 }}>
            <li>先点「配置 API」：填写 API Base / API Key，并启用提供商。</li>
            <li>
              再编辑「活跃模型」：选择{scope === 'tenant' ? '租户' : '个人'}默认的聊天/向量/重排模型。
            </li>
            <li>模型级 API Key 为空时，会自动复用提供商级 API Key（更安全，避免多处存储）。</li>
            <li>「本地(OpenAI兼容)」要求提供 OpenAI-Compatible `/v1` 接口；可不填 Key，把 Base 指向你的服务地址即可（会自动补齐 `/v1`）。</li>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* 预设配置 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <StarIcon color="primary" />
          快速配置预设
        </Typography>
        <Grid container spacing={2}>
          {Object.entries(presets).map(([key, preset]) => (
            <Grid size={{ xs: 12, md: 4 }} key={key}>
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
            <Grid size={{ xs: 12, md: 4 }} key={model.model_type}>
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
            <Grid size={{ xs: 12, md: 6 }} key={provider.provider}>
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
                  <Button
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={() => openProviderDialog(provider)}
                  >
                    配置 API
                  </Button>
                  {(provider.has_api_key || provider.requires_api_key === false) && (
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

              {/* 模型选择 - 支持自定义模型名称 */}
              <Box>
                <FormControl fullWidth>
                  <InputLabel>模型</InputLabel>
                  <Select
                    value={
                      availableModels.includes(editingModel.config.model_name) 
                        ? editingModel.config.model_name 
                        : (editingModel.config.model_name ? editingModel.config.model_name : '__custom__')
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '__custom__') {
                        setCustomModelName('');
                        updateEditingConfig({ model_name: '__custom__' });
                      } else {
                        updateEditingConfig({ model_name: value });
                      }
                    }}
                    label="模型"
                  >
                    {availableModels.map((model) => (
                      <MenuItem key={model} value={model}>
                        {model}
                      </MenuItem>
                    ))}
                    {/* 如果当前模型不在预定义列表中，显示它 */}
                    {editingModel.config.model_name && 
                     !availableModels.includes(editingModel.config.model_name) && 
                     editingModel.config.model_name !== '__custom__' && (
                      <MenuItem value={editingModel.config.model_name}>
                        {editingModel.config.model_name} <em>（自定义）</em>
                      </MenuItem>
                    )}
                    <MenuItem value="__custom__">
                      <em>自定义模型名称...</em>
                    </MenuItem>
                  </Select>
                </FormControl>
                
                {/* 自定义模型名称输入框 */}
                {(editingModel.config.model_name === '__custom__' || 
                  (editingModel.config.model_name && !availableModels.includes(editingModel.config.model_name))) && (
                  <TextField
                    label="自定义模型名称"
                    value={editingModel.config.model_name === '__custom__' ? customModelName : editingModel.config.model_name}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (editingModel.config.model_name === '__custom__') {
                        setCustomModelName(value);
                        if (value.trim()) {
                          updateEditingConfig({ model_name: value });
                        }
                      } else {
                        updateEditingConfig({ model_name: value });
                      }
                    }}
                    fullWidth
                    sx={{ mt: 2 }}
                    placeholder="请输入模型名称，例如: gpt-4-turbo, claude-3-5-sonnet"
                    helperText={
                      editingModel.config.model_name === '__custom__' 
                        ? "输入您想要使用的模型名称" 
                        : "自定义模型名称（不在预定义列表中）"
                    }
                    autoFocus={editingModel.config.model_name === '__custom__'}
                  />
                )}
              </Box>

              {/* API密钥 */}
              <TextField
                label="API密钥"
                type="password"
                value={editingModel.config.api_key}
                onChange={(e) => updateEditingConfig({ api_key: e.target.value })}
                required={
                  (providers.find(p => p.provider === editingModel.config.provider)?.requires_api_key !== false) &&
                  !providers.find(p => p.provider === editingModel.config.provider)?.has_api_key &&
                  (!editingModel.config.api_key || !editingModel.config.api_key.includes('*'))
                }
                fullWidth
                helperText={
                  (providers.find(p => p.provider === editingModel.config.provider)?.requires_api_key === false) ||
                  providers.find(p => p.provider === editingModel.config.provider)?.has_api_key
                    ? (
                      editingModel.config.api_key && editingModel.config.api_key.includes('*')
                        ? '已保存模型级 API 密钥；留空保持不变或输入新的 API 密钥'
                        : '可留空使用该提供商已配置的 API 密钥，或输入模型级 API 密钥覆盖'
                    )
                    : (
                      editingModel.config.api_key && editingModel.config.api_key.includes('*')
                        ? '已保存API密钥，留空保持不变或输入新的API密钥'
                        : '请输入有效的API密钥'
                    )
                }
                placeholder={
                  editingModel.config.api_key && editingModel.config.api_key.includes('*')
                    ? '留空保持原有API密钥'
                    : (
                      (providers.find(p => p.provider === editingModel.config.provider)?.requires_api_key === false) ||
                      providers.find(p => p.provider === editingModel.config.provider)?.has_api_key
                        ? '留空使用提供商密钥'
                        : '请输入API密钥'
                    )
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
              !editingModel ||
              (
                (providers.find(p => p.provider === editingModel.config.provider)?.requires_api_key !== false) &&
                !providers.find(p => p.provider === editingModel.config.provider)?.has_api_key &&
                (!editingModel.config.api_key || (!editingModel.config.api_key.includes('*') && editingModel.config.api_key.trim() === ''))
              ) ||
              !editingModel.config.model_name ||
              editingModel.config.model_name === '__custom__' ||
              editingModel.config.model_name.trim() === ''
            }
          >
            保存配置
          </Button>
        </DialogActions>
      </Dialog>

      {/* 编辑提供商配置对话框 */}
      <Dialog
        open={providerDialogOpen}
        onClose={() => setProviderDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editingProvider ? `配置 ${editingProvider.display_name}` : '配置提供商'}
        </DialogTitle>
        <DialogContent>
          {editingProvider && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <TextField
                label="API密钥"
                type="password"
                value={editingProvider.api_key}
                onChange={(e) =>
                  setEditingProvider({ ...editingProvider, api_key: e.target.value })
                }
                fullWidth
                helperText={
                  !providers.find(p => p.provider === editingProvider.provider)?.requires_api_key
                    ? '本地/自建 OpenAI-compatible 端点可不填密钥'
                    : (editingProvider.has_api_key ? '留空保持不变' : '请输入有效的API密钥')
                }
                placeholder={
                  !providers.find(p => p.provider === editingProvider.provider)?.requires_api_key
                    ? '可留空'
                    : (editingProvider.has_api_key ? '留空保持原有API密钥' : '请输入API密钥')
                }
              />
              <TextField
                label="API端点 (可选)"
                value={editingProvider.api_base}
                onChange={(e) =>
                  setEditingProvider({ ...editingProvider, api_base: e.target.value })
                }
                fullWidth
                helperText="留空使用默认端点"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={editingProvider.enabled}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, enabled: e.target.checked })
                    }
                  />
                }
                label="启用该提供商"
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProviderDialogOpen(false)}>取消</Button>
          <Button
            onClick={saveProviderConfig}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={
              !editingProvider ||
              (
                (providers.find(p => p.provider === editingProvider.provider)?.requires_api_key !== false) &&
                (!editingProvider.has_api_key && editingProvider.api_key.trim() === '')
              )
            }
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModelConfigManager;
