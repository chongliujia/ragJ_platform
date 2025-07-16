/**
 * 工具节点组件 - 处理各种工具集成的节点
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
  Code as CodeIcon,
  DashboardCustomize as TemplateIcon,
  Notes as LogIcon,
  Storage as CacheIcon,
  Schedule as ScheduleIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

interface ToolNodeData {
  name: string;
  type: 'code_executor' | 'template_engine' | 'log_writer' | 'cache' | 'scheduler';
  config: {
    language?: string;
    code?: string;
    timeout?: number;
    environment?: string;
    template?: string;
    engine?: string;
    variables?: Record<string, any>;
    level?: string;
    format?: string;
    destination?: string;
    key_template?: string;
    ttl?: number;
    cache_type?: string;
    schedule?: string;
    timezone?: string;
    enabled?: boolean;
  };
}

const ToolNode: React.FC<NodeProps<ToolNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});

  const getNodeIcon = () => {
    switch (data.type) {
      case 'code_executor':
        return <CodeIcon sx={{ color: '#fff' }} />;
      case 'template_engine':
        return <TemplateIcon sx={{ color: '#fff' }} />;
      case 'log_writer':
        return <LogIcon sx={{ color: '#fff' }} />;
      case 'cache':
        return <CacheIcon sx={{ color: '#fff' }} />;
      case 'scheduler':
        return <ScheduleIcon sx={{ color: '#fff' }} />;
      default:
        return <SettingsIcon sx={{ color: '#fff' }} />;
    }
  };

  const getNodeColor = () => {
    switch (data.type) {
      case 'code_executor':
        return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      case 'template_engine':
        return 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
      case 'log_writer':
        return 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
      case 'cache':
        return 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)';
      case 'scheduler':
        return 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)';
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
      case 'code_executor':
        return (
          <>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>编程语言</InputLabel>
              <Select
                value={config.language || 'python'}
                onChange={(e) => setConfig({ ...config, language: e.target.value })}
                label="编程语言"
              >
                <MenuItem value="python">Python</MenuItem>
                <MenuItem value="javascript">JavaScript</MenuItem>
                <MenuItem value="bash">Bash</MenuItem>
                <MenuItem value="sql">SQL</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="代码"
              multiline
              rows={6}
              value={config.code || ''}
              onChange={(e) => setConfig({ ...config, code: e.target.value })}
              sx={{ mb: 2 }}
              placeholder="# 在这里输入你的代码"
            />
            <TextField
              fullWidth
              type="number"
              label="超时时间 (秒)"
              value={config.timeout || 30}
              onChange={(e) => setConfig({ ...config, timeout: parseInt(e.target.value) })}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth>
              <InputLabel>运行环境</InputLabel>
              <Select
                value={config.environment || 'sandbox'}
                onChange={(e) => setConfig({ ...config, environment: e.target.value })}
                label="运行环境"
              >
                <MenuItem value="sandbox">沙箱环境</MenuItem>
                <MenuItem value="container">容器环境</MenuItem>
                <MenuItem value="local">本地环境</MenuItem>
              </Select>
            </FormControl>
          </>
        );

      case 'template_engine':
        return (
          <>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>模板引擎</InputLabel>
              <Select
                value={config.engine || 'jinja2'}
                onChange={(e) => setConfig({ ...config, engine: e.target.value })}
                label="模板引擎"
              >
                <MenuItem value="jinja2">Jinja2</MenuItem>
                <MenuItem value="mustache">Mustache</MenuItem>
                <MenuItem value="handlebars">Handlebars</MenuItem>
                <MenuItem value="liquid">Liquid</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="模板内容"
              multiline
              rows={6}
              value={config.template || ''}
              onChange={(e) => setConfig({ ...config, template: e.target.value })}
              sx={{ mb: 2 }}
              placeholder="Hello {{name}}! Your order {{order_id}} is ready."
            />
            <TextField
              fullWidth
              label="变量 (JSON)"
              multiline
              rows={3}
              value={JSON.stringify(config.variables || {}, null, 2)}
              onChange={(e) => {
                try {
                  const variables = JSON.parse(e.target.value);
                  setConfig({ ...config, variables });
                } catch (error) {
                  // Invalid JSON, ignore
                }
              }}
              placeholder='{"name": "用户", "order_id": "12345"}'
            />
          </>
        );

      case 'log_writer':
        return (
          <>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>日志级别</InputLabel>
              <Select
                value={config.level || 'info'}
                onChange={(e) => setConfig({ ...config, level: e.target.value })}
                label="日志级别"
              >
                <MenuItem value="debug">Debug</MenuItem>
                <MenuItem value="info">Info</MenuItem>
                <MenuItem value="warning">Warning</MenuItem>
                <MenuItem value="error">Error</MenuItem>
                <MenuItem value="critical">Critical</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>日志格式</InputLabel>
              <Select
                value={config.format || 'json'}
                onChange={(e) => setConfig({ ...config, format: e.target.value })}
                label="日志格式"
              >
                <MenuItem value="json">JSON</MenuItem>
                <MenuItem value="text">纯文本</MenuItem>
                <MenuItem value="structured">结构化</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>输出目标</InputLabel>
              <Select
                value={config.destination || 'console'}
                onChange={(e) => setConfig({ ...config, destination: e.target.value })}
                label="输出目标"
              >
                <MenuItem value="console">控制台</MenuItem>
                <MenuItem value="file">文件</MenuItem>
                <MenuItem value="database">数据库</MenuItem>
                <MenuItem value="elk">ELK Stack</MenuItem>
              </Select>
            </FormControl>
          </>
        );

      case 'cache':
        return (
          <>
            <TextField
              fullWidth
              label="缓存键模板"
              value={config.key_template || ''}
              onChange={(e) => setConfig({ ...config, key_template: e.target.value })}
              sx={{ mb: 2, mt: 1 }}
              placeholder="workflow:{{id}}:{{step}}"
            />
            <Typography gutterBottom sx={{ mt: 2 }}>
              TTL (生存时间): {config.ttl || 3600} 秒
            </Typography>
            <Slider
              value={config.ttl || 3600}
              onChange={(e, value) => setConfig({ ...config, ttl: value as number })}
              min={60}
              max={86400}
              step={60}
              sx={{ mb: 3 }}
              valueLabelDisplay="auto"
              valueLabelFormat={(value) => `${Math.floor(value / 60)} 分钟`}
            />
            <FormControl fullWidth>
              <InputLabel>缓存类型</InputLabel>
              <Select
                value={config.cache_type || 'memory'}
                onChange={(e) => setConfig({ ...config, cache_type: e.target.value })}
                label="缓存类型"
              >
                <MenuItem value="memory">内存缓存</MenuItem>
                <MenuItem value="redis">Redis</MenuItem>
                <MenuItem value="memcached">Memcached</MenuItem>
                <MenuItem value="file">文件缓存</MenuItem>
              </Select>
            </FormControl>
          </>
        );

      case 'scheduler':
        return (
          <>
            <TextField
              fullWidth
              label="Cron 表达式"
              value={config.schedule || '0 0 * * *'}
              onChange={(e) => setConfig({ ...config, schedule: e.target.value })}
              sx={{ mb: 2, mt: 1 }}
              placeholder="0 0 * * * (每天午夜)"
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>时区</InputLabel>
              <Select
                value={config.timezone || 'UTC'}
                onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
                label="时区"
              >
                <MenuItem value="UTC">UTC</MenuItem>
                <MenuItem value="Asia/Shanghai">Asia/Shanghai</MenuItem>
                <MenuItem value="America/New_York">America/New_York</MenuItem>
                <MenuItem value="Europe/London">Europe/London</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={config.enabled || true}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                />
              }
              label="启用调度"
            />
            <Box sx={{ mt: 2, p: 2, backgroundColor: 'rgba(0, 212, 255, 0.1)', borderRadius: 1 }}>
              <Typography variant="body2" sx={{ color: 'rgba(0, 212, 255, 0.8)' }}>
                💡 Cron 表达式格式: 分 时 日 月 周
                <br />
                例如: 0 0 * * * = 每天午夜
                <br />
                0 */6 * * * = 每6小时
              </Typography>
            </Box>
          </>
        );

      default:
        return null;
    }
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
          {getNodeIcon()}
          <Typography variant="h6" sx={{ flexGrow: 1, fontSize: '0.8rem', ml: 1 }}>
            {data.name || '工具节点'}
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
          {data.type === 'code_executor' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              语言: {config.language || 'python'}
            </Typography>
          )}
          {data.type === 'template_engine' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              引擎: {config.engine || 'jinja2'}
            </Typography>
          )}
          {data.type === 'log_writer' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              级别: {config.level || 'info'}
            </Typography>
          )}
          {data.type === 'cache' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              TTL: {Math.floor((config.ttl || 3600) / 60)} 分钟
            </Typography>
          )}
          {data.type === 'scheduler' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              状态: {config.enabled ? '启用' : '禁用'}
            </Typography>
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
      </Box>

      {/* 配置对话框 */}
      <Dialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        maxWidth="md"
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

export default memo(ToolNode);