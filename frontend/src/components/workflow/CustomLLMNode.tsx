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
import { useEffect } from 'react';
import LangGraphNodeBase from './LangGraphNodeBase';

// 函数签名定义 - 简化版本
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
  ],
  outputs: [
    {
      name: 'content',
      type: 'string' as const,
      description: '生成的文本内容',
      required: true,
      example: '这是一个关于AI的精彩故事...',
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
  
  // 调用后端测试接口（代理到 /api/v1/test/llm/chat）
  const startTime = Date.now();
  
  try {
    const response = await fetch('/api/v1/test/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: full_prompt,
        model,
        temperature,
        max_tokens
      })
    });
    
    if (!response.ok) {
      const txt = await response.text().catch(() => '');
      throw new Error('HTTP ' + response.status + (txt ? ': ' + txt : ''));
    }
    const result = await response.json();
    const endTime = Date.now();
    
    return {
      content: result?.response?.message || result?.response?.content || '',
      tokens_used: result?.response?.usage?.total_tokens || 0,
      finish_reason: result?.response?.finish_reason || 'stop',
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

const CustomLLMNode: React.FC<NodeProps<CustomLLMNodeData>> = ({ id, data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});
  const [functionCode, setFunctionCode] = useState(data.functionCode || defaultFunctionCode);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTime, setExecutionTime] = useState<number>();
  const [memoryUsage, setMemoryUsage] = useState<number>();

  // 同步data.config的变化到本地状态
  useEffect(() => {
    if (data.config) {
      setConfig(data.config);
    }
  }, [data.config]);

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

    try {
      // 读取必要参数（优先用右侧面板“测试输入”的覆盖值）
      const cfg = data?.config || {} as any;
      const overrides = (cfg.overrides || {}) as any;
      const prompt: string = overrides.prompt || cfg.user_prompt || '请用一句话介绍这个系统';
      const system_prompt: string = overrides.system_prompt || cfg.system_prompt || '你是一个有用的AI助手';
      const model: string = cfg.model || 'qwen-turbo';
      const temperature: number = typeof cfg.temperature === 'number' ? cfg.temperature : 0.7;
      const max_tokens: number = typeof cfg.max_tokens === 'number' ? cfg.max_tokens : 1000;

      const fullPrompt = `${system_prompt}\n\n用户: ${prompt}`;

      const res = await fetch('/api/v1/test/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullPrompt,
          model,
          temperature,
          max_tokens,
        }),
      });

      const endTime = Date.now();
      setExecutionTime(endTime - startTime);
      setMemoryUsage(Math.random() * 50 + 10);

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        data.status = 'error';
        setIsExecuting(false);
        console.error('LLM 测试失败:', res.status, txt);
        return;
      }

      const json = await res.json();
      const usage = json?.response?.usage?.total_tokens || 0;
      // 更新性能数据与状态
      data.performance = {
        latency: endTime - startTime,
        tokens_used: usage,
        cost: Math.random() * 0.01 + 0.001,
      };
      data.status = 'success';
    } catch (e) {
      console.error('LLM 测试异常:', e);
      data.status = 'error';
    } finally {
      setIsExecuting(false);
    }
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

  // 允许从全局配置抽屉触发自定义函数代码编辑
  useEffect(() => {
    const handler = (e: any) => {
      const nodeId = e?.detail?.nodeId as string | undefined;
      if (nodeId === id) setCodeEditorOpen(true);
    };
    window.addEventListener('open-node-function-code', handler as any);
    return () => window.removeEventListener('open-node-function-code', handler as any);
  }, [id]);

  // 渲染节点内容 - 简化版本
  const renderNodeContent = () => (
    <Box>
      {/* 显示模型名称 */}
      <Typography variant="body2" sx={{ opacity: 0.9, mb: 0.5 }}>
        {config.model || '请选择模型'}
      </Typography>
      
      {/* 状态标签 */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {!config.model && (
          <Chip
            label="未配置"
            size="small"
            sx={{
              backgroundColor: 'rgba(255, 152, 0, 0.3)',
              color: 'white',
              fontSize: '0.7rem',
              height: '20px'
            }}
          />
        )}
        {config.system_prompt && (
          <Chip
            label="自定义提示"
            size="small"
            sx={{
              backgroundColor: 'rgba(76, 175, 80, 0.3)',
              color: 'white',
              fontSize: '0.7rem',
              height: '20px'
            }}
          />
        )}
        {(config.temperature && config.temperature !== 0.7) && (
          <Chip
            label={`创造性: ${config.temperature}`}
            size="small"
            sx={{
              backgroundColor: 'rgba(255, 193, 7, 0.3)',
              color: 'white',
              fontSize: '0.7rem',
              height: '20px',
              ml: 0.5
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
            正在执行...
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
        onConfigClick={() => { try { window.dispatchEvent(new CustomEvent('open-node-config', { detail: { nodeId: id } } as any)); } catch {} }}
        onExecuteClick={handleExecute}
      >
        {renderNodeContent()}
      </LangGraphNodeBase>

      {/* 配置已统一到右侧抽屉（NodeConfigPanel） */}

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
