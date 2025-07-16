/**
 * LLM节点组件 - 大语言模型调用节点
 */

import React, { memo, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
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
} from '@mui/material';
import {
  Psychology as AIIcon,
  Settings as SettingsIcon,
  PlayArrow as PlayIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

interface LLMNodeData {
  name: string;
  config: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    system_prompt?: string;
    user_prompt?: string;
  };
}

const LLMNode: React.FC<NodeProps<LLMNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});

  const modelOptions = [
    'qwen-turbo',
    'qwen-plus',
    'qwen-max',
    'deepseek-chat',
    'deepseek-coder',
  ];

  const handleConfigSave = () => {
    // 这里可以触发节点配置更新
    data.config = config;
    setConfigOpen(false);
  };

  return (
    <>
      <Box
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          border: selected ? '2px solid #00d4ff' : '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 3,
          padding: 0.5,
          minWidth: 100,
          color: 'white',
          position: 'relative',
          boxShadow: selected 
            ? '0 8px 32px rgba(0, 212, 255, 0.3)' 
            : '0 4px 20px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.3s ease',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 25px rgba(102, 126, 234, 0.4)',
            borderColor: 'rgba(0, 212, 255, 0.5)',
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 50%)',
            borderRadius: 3,
            pointerEvents: 'none',
          },
        }}
      >
        {/* 输入连接点 */}
        <Handle
          type="target"
          position={Position.Left}
          style={{
            background: 'linear-gradient(45deg, #ffffff 0%, #00d4ff 100%)',
            border: '2px solid #667eea',
            width: 14,
            height: 14,
            boxShadow: '0 2px 8px rgba(0, 212, 255, 0.3)',
          }}
        />

        {/* 节点头部 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          <AIIcon sx={{ mr: 1, color: '#fff' }} />
          <Typography variant="h6" sx={{ flexGrow: 1, fontSize: '0.8rem' }}>
            {data.name || 'LLM节点'}
          </Typography>
          <IconButton
            size="small"
            onClick={() => setConfigOpen(true)}
            sx={{ color: '#fff' }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* 节点内容 */}
        <Box>
          <Typography variant="body2" sx={{ opacity: 0.9, mb: 0.5 }}>
            模型: {config.model || 'qwen-turbo'}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9, mb: 0.5 }}>
            温度: {config.temperature || 0.7}
          </Typography>
          {config.system_prompt && (
            <Chip
              label="系统提示词"
              size="small"
              sx={{ 
                backgroundColor: 'rgba(255,255,255,0.2)',
                color: 'white',
                mb: 1 
              }}
            />
          )}
        </Box>

        {/* 输出连接点 */}
        <Handle
          type="source"
          position={Position.Right}
          style={{
            background: 'linear-gradient(45deg, #ffffff 0%, #00d4ff 100%)',
            border: '2px solid #667eea',
            width: 14,
            height: 14,
            boxShadow: '0 2px 8px rgba(0, 212, 255, 0.3)',
          }}
        />

        {/* 执行按钮 */}
        <IconButton
          size="small"
          sx={{
            position: 'absolute',
            top: 8,
            right: 40,
            color: '#fff',
            '&:hover': {
              backgroundColor: 'rgba(255,255,255,0.1)',
            },
          }}
        >
          <PlayIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* 配置对话框 */}
      <Dialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>LLM节点配置</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
            <InputLabel>模型</InputLabel>
            <Select
              value={config.model || 'qwen-turbo'}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              label="模型"
            >
              {modelOptions.map((model) => (
                <MenuItem key={model} value={model}>
                  {model}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography gutterBottom>
            温度: {config.temperature || 0.7}
          </Typography>
          <Slider
            value={config.temperature || 0.7}
            onChange={(e, value) =>
              setConfig({ ...config, temperature: value as number })
            }
            min={0}
            max={2}
            step={0.1}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="number"
            label="最大Token数"
            value={config.max_tokens || 1000}
            onChange={(e) =>
              setConfig({ ...config, max_tokens: parseInt(e.target.value) })
            }
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            label="系统提示词"
            multiline
            rows={3}
            value={config.system_prompt || ''}
            onChange={(e) =>
              setConfig({ ...config, system_prompt: e.target.value })
            }
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            label="用户提示词模板"
            multiline
            rows={3}
            value={config.user_prompt || ''}
            onChange={(e) =>
              setConfig({ ...config, user_prompt: e.target.value })
            }
            placeholder="使用 {input} 占位符"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigOpen(false)}>取消</Button>
          <Button onClick={handleConfigSave} variant="contained">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default memo(LLMNode);