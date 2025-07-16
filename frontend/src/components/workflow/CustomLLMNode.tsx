/**
 * 自定义LLM节点示例
 * 展示如何使用LangGraphNodeBase创建带函数签名的节点
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
  Alert,
  LinearProgress,
} from '@mui/material';
import {
  Psychology as AIIcon,
  Speed as SpeedIcon,
  Token as TokenIcon,
  Description as PromptIcon,
} from '@mui/icons-material';
import type { NodeProps } from 'reactflow';
import LangGraphNodeBase from './LangGraphNodeBase';

// 函数签名定义
const llmFunctionSignature = {
  name: 'llm_chat_completion',
  description: '调用大语言模型进行文本生成和对话',
  category: 'llm' as const,
  inputs: [
    {
      name: 'prompt',
      type: 'string' as const,
      description: '用户输入的提示文本',
      required: true,
      example: '请帮我写一个关于AI的故事',
    },
    {
      name: 'system_prompt',
      type: 'string' as const,
      description: '系统提示词，定义AI的角色和行为',
      required: false,
      example: '你是一个有用的AI助手，擅长创意写作。',
    },
  ],
  outputs: [
    {
      name: 'content',
      type: 'string' as const,
      description: '生成的文本内容',
      required: true,
      example: '这是一个关于AI的精彩故事...',
    },
    {
      name: 'metadata',
      type: 'object' as const,
      description: '包含token使用、模型信息等元数据',
      required: true,
      example: '{"tokens_used": 256, "model": "qwen-turbo"}',
    },
  ],
};

interface CustomLLMNodeData {
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
  functionCode?: string; // 用户自定义的函数代码
}

// 默认的函数代码 - 移到组件外部
const defaultFunctionCode = `async function llm_chat_completion(inputs) {
  // 从输入中提取参数
  const { 
    prompt, 
    system_prompt = "你是一个有用的AI助手", 
    temperature = 0.7, 
    max_tokens = 1000,
    model = "qwen-turbo"
  } = inputs;

  // 构建完整的提示
  const full_prompt = system_prompt + "\\n\\n用户: " + prompt;
  
  // 调用LLM API (这里是模拟调用)
  const startTime = Date.now();
  
  try {
    const response = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: full_prompt,
        temperature,
        max_tokens,
        model
      })
    });
    
    const result = await response.json();
    const endTime = Date.now();
    
    return {
      content: result.content,
      tokens_used: result.usage.total_tokens,
      finish_reason: result.finish_reason,
      model_info: {
        model: model,
        temperature: temperature,
        processing_time: endTime - startTime
      }
    };
  } catch (error) {
    throw new Error(\`LLM调用失败: \${error.message}\`);
  }
}`;

const CustomLLMNode: React.FC<NodeProps<CustomLLMNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});
  const [functionCode, setFunctionCode] = useState(data.functionCode || defaultFunctionCode);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTime, setExecutionTime] = useState<number>();
  const [memoryUsage, setMemoryUsage] = useState<number>();

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

  const handleCodeSave = () => {
    data.functionCode = functionCode;
    setCodeEditorOpen(false);
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    const startTime = Date.now();
    
    // 模拟函数执行
    setTimeout(() => {
      const endTime = Date.now();
      setExecutionTime(endTime - startTime);
      setMemoryUsage(Math.random() * 50 + 10);
      
      // 更新性能数据
      data.performance = {
        latency: endTime - startTime,
        tokens_used: Math.floor(Math.random() * 1000 + 100),
        cost: Math.random() * 0.01 + 0.001,
      };
      data.status = 'success';
      setIsExecuting(false);
    }, 2000);
  };

  const getTemperatureColor = (temp: number) => {
    if (temp < 0.3) return '#4caf50';
    if (temp < 0.7) return '#ff9800';
    return '#f44336';
  };

  const getTemperatureLabel = (temp: number) => {
    if (temp < 0.3) return '保守';
    if (temp < 0.7) return '平衡';
    return '创意';
  };

  // 渲染节点内容
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

      {/* 函数状态标签 */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        <Chip
          label="可编程"
          size="small"
          sx={{
            backgroundColor: 'rgba(76, 175, 80, 0.2)',
            color: '#4caf50',
            fontSize: '0.6rem',
            height: 20,
          }}
        />
        {config.system_prompt && (
          <Chip
            label="系统提示"
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
        {data.functionCode && (
          <Chip
            label="自定义代码"
            size="small"
            sx={{
              backgroundColor: 'rgba(255, 152, 0, 0.2)',
              color: '#ff9800',
              fontSize: '0.6rem',
              height: 20,
            }}
          />
        )}
      </Box>

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
          <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>
            正在执行自定义函数...
          </Typography>
        </Box>
      )}
    </Box>
  );

  return (
    <>
      <LangGraphNodeBase
        data={data}
        selected={selected}
        functionSignature={llmFunctionSignature}
        status={isExecuting ? 'running' : data.status}
        executionTime={executionTime}
        memoryUsage={memoryUsage}
        onConfigClick={() => setConfigOpen(true)}
        onExecuteClick={handleExecute}
      >
        {renderNodeContent()}
      </LangGraphNodeBase>

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
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <AIIcon sx={{ mr: 1 }} />
            LLM函数配置
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
              <Alert severity="info" sx={{ mb: 2 }}>
                💡 你可以点击"编辑函数代码"来自定义这个LLM节点的具体实现逻辑
              </Alert>
              <Button
                variant="outlined"
                onClick={() => setCodeEditorOpen(true)}
                sx={{ color: '#00d4ff', borderColor: '#00d4ff' }}
              >
                编辑函数代码
              </Button>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigOpen(false)} sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            取消
          </Button>
          <Button onClick={handleConfigSave} variant="contained">
            保存配置
          </Button>
        </DialogActions>
      </Dialog>

      {/* 代码编辑器对话框 */}
      <Dialog
        open={codeEditorOpen}
        onClose={() => setCodeEditorOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            background: 'linear-gradient(135deg, #1a1f2e 0%, #2d3748 100%)',
            color: 'white',
            height: '80vh',
          },
        }}
      >
        <DialogTitle>编辑函数代码</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            在这里编辑函数的具体实现。函数接收inputs参数，返回outputs结果。
          </Alert>
          <TextField
            fullWidth
            multiline
            rows={25}
            value={functionCode}
            onChange={(e) => setFunctionCode(e.target.value)}
            variant="outlined"
            sx={{
              '& .MuiInputBase-input': {
                fontFamily: 'Monaco, Menlo, monospace',
                fontSize: '0.9rem',
                color: 'white',
              },
              '& .MuiOutlinedInput-root': {
                '& fieldset': {
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                },
                '&:hover fieldset': {
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#00d4ff',
                },
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCodeEditorOpen(false)} sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            取消
          </Button>
          <Button onClick={handleCodeSave} variant="contained">
            保存代码
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default memo(CustomLLMNode);