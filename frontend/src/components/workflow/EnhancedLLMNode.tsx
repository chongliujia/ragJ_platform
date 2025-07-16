/**
 * 增强版LLM节点组件
 * 使用EnhancedNodeBase提供更美观的UI和更好的用户体验
 */

import React, { memo, useState } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  Chip,
  Grid,
  Divider,
  LinearProgress,
} from '@mui/material';
import {
  Psychology as AIIcon,
  Speed as SpeedIcon,
  Token as TokenIcon,
  Description as PromptIcon,
} from '@mui/icons-material';
import type { NodeProps } from 'reactflow';
import EnhancedNodeBase from './EnhancedNodeBase';

interface LLMNodeData {
  name: string;
  config: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    system_prompt?: string;
    user_prompt?: string;
  };
  status?: 'idle' | 'running' | 'success' | 'error';
  performance?: {
    latency?: number;
    tokens_used?: number;
    cost?: number;
  };
}

const EnhancedLLMNode: React.FC<NodeProps<LLMNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});
  const [isExecuting, setIsExecuting] = useState(false);

  const modelOptions = [
    { value: 'qwen-turbo', label: 'Qwen Turbo', cost: 0.001 },
    { value: 'qwen-plus', label: 'Qwen Plus', cost: 0.002 },
    { value: 'qwen-max', label: 'Qwen Max', cost: 0.005 },
    { value: 'deepseek-chat', label: 'DeepSeek Chat', cost: 0.001 },
    { value: 'deepseek-coder', label: 'DeepSeek Coder', cost: 0.002 },
  ];

  const handleConfigSave = () => {
    data.config = config;
    setConfigOpen(false);
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    // 模拟执行过程
    setTimeout(() => {
      setIsExecuting(false);
      // 更新性能数据
      data.performance = {
        latency: Math.random() * 2000 + 500,
        tokens_used: Math.floor(Math.random() * 1000 + 100),
        cost: Math.random() * 0.01 + 0.001,
      };
      data.status = 'success';
    }, 2000);
  };

  const getTemperatureColor = (temp: number) => {
    if (temp < 0.3) return '#4caf50'; // 绿色 - 保守
    if (temp < 0.7) return '#ff9800'; // 橙色 - 平衡
    return '#f44336'; // 红色 - 创意
  };

  const getTemperatureLabel = (temp: number) => {
    if (temp < 0.3) return '保守';
    if (temp < 0.7) return '平衡';
    return '创意';
  };

  const renderNodeContent = () => (
    <Box>
      <Grid container spacing={1} sx={{ mb: 1 }}>
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <AIIcon sx={{ mr: 1, fontSize: '1rem', color: '#00d4ff' }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {config.model || 'qwen-turbo'}
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={6}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <SpeedIcon sx={{ mr: 0.5, fontSize: '0.8rem', color: getTemperatureColor(config.temperature || 0.7) }} />
            <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
              {getTemperatureLabel(config.temperature || 0.7)}
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={6}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <TokenIcon sx={{ mr: 0.5, fontSize: '0.8rem', color: '#4caf50' }} />
            <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
              {config.max_tokens || 1000}
            </Typography>
          </Box>
        </Grid>
      </Grid>

      {/* 快速配置标签 */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {config.system_prompt && (
          <Chip
            label="系统"
            size="small"
            icon={<PromptIcon />}
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              fontSize: '0.6rem',
              height: 20,
            }}
          />
        )}
        {config.user_prompt && (
          <Chip
            label="用户"
            size="small"
            icon={<PromptIcon />}
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              fontSize: '0.6rem',
              height: 20,
            }}
          />
        )}
      </Box>

      {/* 性能指标 */}
      {data.performance && (
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255, 255, 255, 0.2)' }}>
          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.8 }}>
            延迟: {data.performance.latency?.toFixed(0)}ms | 
            令牌: {data.performance.tokens_used} | 
            成本: ${data.performance.cost?.toFixed(4)}
          </Typography>
        </Box>
      )}

      {/* 执行进度条 */}
      {isExecuting && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress 
            sx={{ 
              height: 2,
              borderRadius: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              '& .MuiLinearProgress-bar': {
                backgroundColor: '#00d4ff',
              },
            }} 
          />
        </Box>
      )}
    </Box>
  );

  return (
    <>
      <EnhancedNodeBase
        data={data}
        selected={selected}
        nodeType="llm"
        icon={<AIIcon />}
        title={data.name || 'LLM调用'}
        subtitle={`${config.model || 'qwen-turbo'} • ${getTemperatureLabel(config.temperature || 0.7)}`}
        status={isExecuting ? 'running' : data.status}
        onConfigClick={() => setConfigOpen(true)}
        onExecuteClick={handleExecute}
      >
        {renderNodeContent()}
      </EnhancedNodeBase>

      {/* 配置对话框 */}
      <Dialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            background: 'linear-gradient(135deg, #1a1f2e 0%, #2d3748 100%)',
            color: 'white',
          },
        }}
      >
        <DialogTitle sx={{ 
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <AIIcon sx={{ mr: 1 }} />
            LLM节点配置
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>模型</InputLabel>
                <Select
                  value={config.model || 'qwen-turbo'}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  label="模型"
                  sx={{ color: 'white' }}
                >
                  {modelOptions.map((model) => (
                    <MenuItem key={model.value} value={model.value}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                        <span>{model.label}</span>
                        <Chip 
                          label={`$${model.cost}/1K tokens`} 
                          size="small" 
                          sx={{ backgroundColor: 'rgba(0, 212, 255, 0.2)' }}
                        />
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="最大Token数"
                value={config.max_tokens || 1000}
                onChange={(e) => setConfig({ ...config, max_tokens: parseInt(e.target.value) })}
                InputProps={{ style: { color: 'white' } }}
                InputLabelProps={{ style: { color: 'rgba(255, 255, 255, 0.7)' } }}
              />
            </Grid>

            <Grid item xs={12}>
              <Typography gutterBottom sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
                创意度: {config.temperature || 0.7} - {getTemperatureLabel(config.temperature || 0.7)}
              </Typography>
              <Slider
                value={config.temperature || 0.7}
                onChange={(e, value) => setConfig({ ...config, temperature: value as number })}
                min={0}
                max={2}
                step={0.1}
                marks={[
                  { value: 0, label: '精确' },
                  { value: 0.7, label: '平衡' },
                  { value: 1.4, label: '创意' },
                  { value: 2, label: '随机' },
                ]}
                sx={{
                  color: getTemperatureColor(config.temperature || 0.7),
                  '& .MuiSlider-markLabel': {
                    color: 'rgba(255, 255, 255, 0.7)',
                  },
                }}
              />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2, backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="系统提示词"
                multiline
                rows={3}
                value={config.system_prompt || ''}
                onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
                placeholder="定义AI的角色和行为规范..."
                InputProps={{ style: { color: 'white' } }}
                InputLabelProps={{ style: { color: 'rgba(255, 255, 255, 0.7)' } }}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="用户提示词模板"
                multiline
                rows={3}
                value={config.user_prompt || ''}
                onChange={(e) => setConfig({ ...config, user_prompt: e.target.value })}
                placeholder="使用 {input} 作为变量占位符..."
                InputProps={{ style: { color: 'white' } }}
                InputLabelProps={{ style: { color: 'rgba(255, 255, 255, 0.7)' } }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', pt: 2 }}>
          <Button 
            onClick={() => setConfigOpen(false)}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            取消
          </Button>
          <Button 
            onClick={handleConfigSave} 
            variant="contained"
            sx={{ 
              background: 'linear-gradient(45deg, #667eea 0%, #764ba2 100%)',
              '&:hover': {
                background: 'linear-gradient(45deg, #5a67d8 0%, #6b46c1 100%)',
              },
            }}
          >
            保存配置
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default memo(EnhancedLLMNode);