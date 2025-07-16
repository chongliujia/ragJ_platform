/**
 * 流程控制节点组件 - 循环、并行等流程控制节点
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
  Chip,
  Switch,
  FormControlLabel,
  Slider,
} from '@mui/material';
import {
  Transform as ProcessIcon,
  Settings as SettingsIcon,
  Loop as LoopIcon,
  CallSplit as ParallelIcon,
  PlayArrow as StartIcon,
  Stop as EndIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

interface ProcessNodeData {
  name: string;
  type: 'loop' | 'parallel' | 'start' | 'end' | 'delay';
  config: {
    max_iterations?: number;
    break_condition?: string;
    wait_for_all?: boolean;
    delay_seconds?: number;
    parallel_branches?: number;
    timeout?: number;
  };
}

const ProcessNode: React.FC<NodeProps<ProcessNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});

  const getNodeIcon = () => {
    switch (data.type) {
      case 'loop':
        return <LoopIcon sx={{ color: '#fff' }} />;
      case 'parallel':
        return <ParallelIcon sx={{ color: '#fff' }} />;
      case 'start':
        return <StartIcon sx={{ color: '#fff' }} />;
      case 'end':
        return <EndIcon sx={{ color: '#fff' }} />;
      case 'delay':
        return <ProcessIcon sx={{ color: '#fff' }} />;
      default:
        return <ProcessIcon sx={{ color: '#fff' }} />;
    }
  };

  const getNodeColor = () => {
    switch (data.type) {
      case 'loop':
        return 'linear-gradient(45deg, #f093fb 0%, #f5576c 100%)';
      case 'parallel':
        return 'linear-gradient(45deg, #4facfe 0%, #00f2fe 100%)';
      case 'start':
        return 'linear-gradient(45deg, #43e97b 0%, #38f9d7 100%)';
      case 'end':
        return 'linear-gradient(45deg, #fa709a 0%, #fee140 100%)';
      case 'delay':
        return 'linear-gradient(45deg, #a8edea 0%, #fed6e3 100%)';
      default:
        return 'linear-gradient(45deg, #667eea 0%, #764ba2 100%)';
    }
  };

  const handleConfigSave = () => {
    data.config = config;
    setConfigOpen(false);
  };

  const renderConfigFields = () => {
    switch (data.type) {
      case 'loop':
        return (
          <>
            <TextField
              fullWidth
              type="number"
              label="最大迭代次数"
              value={config.max_iterations || 10}
              onChange={(e) =>
                setConfig({ ...config, max_iterations: parseInt(e.target.value) })
              }
              sx={{ mb: 2, mt: 1 }}
            />
            <TextField
              fullWidth
              label="跳出条件"
              value={config.break_condition || ''}
              onChange={(e) =>
                setConfig({ ...config, break_condition: e.target.value })
              }
              placeholder="例如: result.status == 'success'"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="number"
              label="超时时间 (秒)"
              value={config.timeout || 300}
              onChange={(e) =>
                setConfig({ ...config, timeout: parseInt(e.target.value) })
              }
            />
          </>
        );
      case 'parallel':
        return (
          <>
            <TextField
              fullWidth
              type="number"
              label="并行分支数"
              value={config.parallel_branches || 2}
              onChange={(e) =>
                setConfig({ ...config, parallel_branches: parseInt(e.target.value) })
              }
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={config.wait_for_all || true}
                  onChange={(e) =>
                    setConfig({ ...config, wait_for_all: e.target.checked })
                  }
                />
              }
              label="等待所有分支完成"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="number"
              label="超时时间 (秒)"
              value={config.timeout || 300}
              onChange={(e) =>
                setConfig({ ...config, timeout: parseInt(e.target.value) })
              }
            />
          </>
        );
      case 'delay':
        return (
          <>
            <Typography gutterBottom sx={{ mt: 1 }}>
              延迟时间: {config.delay_seconds || 1} 秒
            </Typography>
            <Slider
              value={config.delay_seconds || 1}
              onChange={(e, value) =>
                setConfig({ ...config, delay_seconds: value as number })
              }
              min={0.1}
              max={60}
              step={0.1}
              sx={{ mb: 2 }}
            />
          </>
        );
      default:
        return null;
    }
  };

  const shouldShowInput = () => {
    return data.type !== 'start';
  };

  const shouldShowOutput = () => {
    return data.type !== 'end';
  };

  return (
    <>
      <Box
        sx={{
          background: getNodeColor(),
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
            boxShadow: '0 8px 25px rgba(249, 147, 251, 0.4)',
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
        {shouldShowInput() && (
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
        )}

        {/* 节点头部 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          {getNodeIcon()}
          <Typography variant="h6" sx={{ flexGrow: 1, fontSize: '0.8rem', ml: 1 }}>
            {data.name || '流程节点'}
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
          <Chip
            label={data.type}
            size="small"
            sx={{
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              mb: 0.5,
            }}
          />
          {data.type === 'loop' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              最大: {config.max_iterations || 10} 次
            </Typography>
          )}
          {data.type === 'parallel' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              分支: {config.parallel_branches || 2} 个
            </Typography>
          )}
          {data.type === 'delay' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              延迟: {config.delay_seconds || 1} 秒
            </Typography>
          )}
        </Box>

        {/* 输出连接点 */}
        {shouldShowOutput() && (
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
        )}

        {/* 并行节点的多个输出点 */}
        {data.type === 'parallel' && (
          <>
            {Array.from({ length: config.parallel_branches || 2 }).map((_, index) => (
              <Handle
                key={`parallel-${index}`}
                type="source"
                position={Position.Right}
                id={`parallel-${index}`}
                style={{
                  background: '#fff',
                  border: '2px solid #667eea',
                  width: 12,
                  height: 12,
                  top: `${30 + index * 20}%`,
                }}
              />
            ))}
          </>
        )}
      </Box>

      {/* 配置对话框 */}
      <Dialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{data.name} 配置</DialogTitle>
        <DialogContent>{renderConfigFields()}</DialogContent>
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

export default memo(ProcessNode);