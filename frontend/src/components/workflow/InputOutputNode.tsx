/**
 * 输入输出节点组件 - 处理数据输入输出的节点
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
  Divider,
} from '@mui/material';
import {
  Input as InputIcon,
  Output as OutputIcon,
  Api as ApiIcon,
  Email as EmailIcon,
  Upload as UploadIcon,
  Link as WebhookIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

interface InputOutputNodeData {
  name: string;
  type: 'input' | 'output' | 'api_call' | 'webhook' | 'email' | 'file_upload';
  config: {
    input_type?: string;
    output_type?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
    to?: string;
    subject?: string;
    template?: string;
    storage_type?: string;
    path?: string;
    required?: boolean;
    validation?: Record<string, any>;
    format?: string;
    payload_template?: string;
  };
}

const InputOutputNode: React.FC<NodeProps<InputOutputNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});

  const getNodeIcon = () => {
    switch (data.type) {
      case 'input':
        return <InputIcon sx={{ color: '#fff' }} />;
      case 'output':
        return <OutputIcon sx={{ color: '#fff' }} />;
      case 'api_call':
        return <ApiIcon sx={{ color: '#fff' }} />;
      case 'webhook':
        return <WebhookIcon sx={{ color: '#fff' }} />;
      case 'email':
        return <EmailIcon sx={{ color: '#fff' }} />;
      case 'file_upload':
        return <UploadIcon sx={{ color: '#fff' }} />;
      default:
        return <InputIcon sx={{ color: '#fff' }} />;
    }
  };

  const getNodeColor = () => {
    switch (data.type) {
      case 'input':
        return 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)';
      case 'output':
        return 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)';
      case 'api_call':
        return 'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)';
      case 'webhook':
        return 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)';
      case 'email':
        return 'linear-gradient(135deg, #fdbb2d 0%, #22c1c3 100%)';
      case 'file_upload':
        return 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)';
      default:
        return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
  };

  const handleConfigSave = () => {
    data.config = config;
    setConfigOpen(false);
  };

  const renderConfigFields = () => {
    switch (data.type) {
      case 'input':
        return (
          <>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>输入类型</InputLabel>
              <Select
                value={config.input_type || 'text'}
                onChange={(e) => setConfig({ ...config, input_type: e.target.value })}
                label="输入类型"
              >
                <MenuItem value="text">文本</MenuItem>
                <MenuItem value="number">数字</MenuItem>
                <MenuItem value="file">文件</MenuItem>
                <MenuItem value="json">JSON</MenuItem>
                <MenuItem value="array">数组</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={config.required || true}
                  onChange={(e) => setConfig({ ...config, required: e.target.checked })}
                />
              }
              label="必填项"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="验证规则 (JSON)"
              multiline
              rows={3}
              value={JSON.stringify(config.validation || {}, null, 2)}
              onChange={(e) => {
                try {
                  const validation = JSON.parse(e.target.value);
                  setConfig({ ...config, validation });
                } catch (error) {
                  // Invalid JSON, ignore
                }
              }}
              placeholder='{"minLength": 1, "maxLength": 1000}'
            />
          </>
        );

      case 'output':
        return (
          <>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>输出类型</InputLabel>
              <Select
                value={config.output_type || 'text'}
                onChange={(e) => setConfig({ ...config, output_type: e.target.value })}
                label="输出类型"
              >
                <MenuItem value="text">文本</MenuItem>
                <MenuItem value="json">JSON</MenuItem>
                <MenuItem value="html">HTML</MenuItem>
                <MenuItem value="markdown">Markdown</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>格式</InputLabel>
              <Select
                value={config.format || 'raw'}
                onChange={(e) => setConfig({ ...config, format: e.target.value })}
                label="格式"
              >
                <MenuItem value="raw">原始</MenuItem>
                <MenuItem value="formatted">格式化</MenuItem>
                <MenuItem value="compressed">压缩</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="输出模板"
              multiline
              rows={4}
              value={config.template || ''}
              onChange={(e) => setConfig({ ...config, template: e.target.value })}
              placeholder="使用 {{variable}} 作为变量占位符"
            />
          </>
        );

      case 'api_call':
        return (
          <>
            <TextField
              fullWidth
              label="API URL"
              value={config.url || ''}
              onChange={(e) => setConfig({ ...config, url: e.target.value })}
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>请求方法</InputLabel>
              <Select
                value={config.method || 'POST'}
                onChange={(e) => setConfig({ ...config, method: e.target.value })}
                label="请求方法"
              >
                <MenuItem value="GET">GET</MenuItem>
                <MenuItem value="POST">POST</MenuItem>
                <MenuItem value="PUT">PUT</MenuItem>
                <MenuItem value="DELETE">DELETE</MenuItem>
                <MenuItem value="PATCH">PATCH</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="请求头 (JSON)"
              multiline
              rows={3}
              value={JSON.stringify(config.headers || {}, null, 2)}
              onChange={(e) => {
                try {
                  const headers = JSON.parse(e.target.value);
                  setConfig({ ...config, headers });
                } catch (error) {
                  // Invalid JSON, ignore
                }
              }}
              placeholder='{"Content-Type": "application/json"}'
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="number"
              label="超时时间 (秒)"
              value={config.timeout || 30}
              onChange={(e) => setConfig({ ...config, timeout: parseInt(e.target.value) })}
            />
          </>
        );

      case 'webhook':
        return (
          <>
            <TextField
              fullWidth
              label="Webhook URL"
              value={config.url || ''}
              onChange={(e) => setConfig({ ...config, url: e.target.value })}
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>请求方法</InputLabel>
              <Select
                value={config.method || 'POST'}
                onChange={(e) => setConfig({ ...config, method: e.target.value })}
                label="请求方法"
              >
                <MenuItem value="POST">POST</MenuItem>
                <MenuItem value="PUT">PUT</MenuItem>
                <MenuItem value="PATCH">PATCH</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="负载模板"
              multiline
              rows={4}
              value={config.payload_template || ''}
              onChange={(e) => setConfig({ ...config, payload_template: e.target.value })}
              placeholder='{"event": "workflow_complete", "data": {{result}}}'
            />
          </>
        );

      case 'email':
        return (
          <>
            <TextField
              fullWidth
              label="收件人"
              value={config.to || ''}
              onChange={(e) => setConfig({ ...config, to: e.target.value })}
              sx={{ mb: 2, mt: 1 }}
              placeholder="user@example.com"
            />
            <TextField
              fullWidth
              label="邮件主题"
              value={config.subject || ''}
              onChange={(e) => setConfig({ ...config, subject: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="邮件模板"
              multiline
              rows={4}
              value={config.template || ''}
              onChange={(e) => setConfig({ ...config, template: e.target.value })}
              placeholder="使用 {{variable}} 作为变量占位符"
            />
          </>
        );

      case 'file_upload':
        return (
          <>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>存储类型</InputLabel>
              <Select
                value={config.storage_type || 'local'}
                onChange={(e) => setConfig({ ...config, storage_type: e.target.value })}
                label="存储类型"
              >
                <MenuItem value="local">本地存储</MenuItem>
                <MenuItem value="s3">Amazon S3</MenuItem>
                <MenuItem value="oss">阿里云OSS</MenuItem>
                <MenuItem value="cos">腾讯云COS</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="存储路径"
              value={config.path || ''}
              onChange={(e) => setConfig({ ...config, path: e.target.value })}
              sx={{ mb: 2 }}
              placeholder="/uploads/"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={config.overwrite || false}
                  onChange={(e) => setConfig({ ...config, overwrite: e.target.checked })}
                />
              }
              label="覆盖同名文件"
            />
          </>
        );

      default:
        return null;
    }
  };

  const shouldShowInput = () => {
    return data.type !== 'input';
  };

  const shouldShowOutput = () => {
    return data.type !== 'output';
  };

  return (
    <>
      <Box
        sx={{
          background: getNodeColor(),
          border: selected ? '2px solid #00d4ff' : '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: 3,
          padding: 2,
          minWidth: 140,
          maxWidth: 200,
          color: 'white',
          position: 'relative',
          boxShadow: selected 
            ? '0 8px 32px rgba(0, 212, 255, 0.4)' 
            : '0 4px 20px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          '&:hover': {
            transform: 'translateY(-2px) scale(1.02)',
            boxShadow: '0 8px 25px rgba(132, 250, 176, 0.4)',
            borderColor: 'rgba(0, 212, 255, 0.5)',
          },
        }}
      >
        {/* 输入连接点 */}
        {shouldShowInput() && (
          <Handle
            type="target"
            position={Position.Left}
            style={{
              background: 'linear-gradient(45deg, #ffffff 0%, #84fab0 100%)',
              border: '2px solid #4caf50',
              width: 14,
              height: 14,
              borderRadius: '50%',
              boxShadow: '0 2px 8px rgba(132, 250, 176, 0.4)',
              transition: 'all 0.3s ease',
              zIndex: 10,
            }}
          />
        )}

        {/* 节点头部 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Box sx={{ mr: 1, fontSize: '1.2rem' }}>{getNodeIcon()}</Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" sx={{ fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.2 }}>
              {data.name || '输入输出节点'}
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.7rem', opacity: 0.8, lineHeight: 1.1 }}>
              {data.type === 'input' && `输入类型: ${config.input_type || 'text'}`}
              {data.type === 'output' && `输出格式: ${config.format || 'raw'}`}
              {data.type === 'api_call' && `API调用: ${config.method || 'POST'}`}
              {data.type === 'email' && `邮件发送: ${config.to || '未设置'}`}
              {data.type === 'webhook' && `Webhook: ${config.method || 'POST'}`}
              {data.type === 'file_upload' && `文件上传: ${config.storage_type || 'local'}`}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => setConfigOpen(true)}
            sx={{ 
              color: 'white',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.2)' },
            }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* 节点状态指示器 */}
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <Chip
            label={data.type}
            size="small"
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              fontSize: '0.6rem',
              height: 20,
              fontWeight: 600,
            }}
          />
          {config.required && (
            <Chip
              label="必需"
              size="small"
              sx={{
                backgroundColor: 'rgba(244, 67, 54, 0.2)',
                color: '#f44336',
                fontSize: '0.6rem',
                height: 20,
              }}
            />
          )}
        </Box>

        {/* 输出连接点 */}
        {shouldShowOutput() && (
          <Handle
            type="source"
            position={Position.Right}
            style={{
              background: 'linear-gradient(45deg, #84fab0 0%, #ffffff 100%)',
              border: '2px solid #4caf50',
              width: 14,
              height: 14,
              borderRadius: '50%',
              boxShadow: '0 2px 8px rgba(132, 250, 176, 0.4)',
              transition: 'all 0.3s ease',
              zIndex: 10,
            }}
          />
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

export default memo(InputOutputNode);