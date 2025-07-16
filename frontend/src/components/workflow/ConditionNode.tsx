/**
 * 条件判断节点组件 - 条件分支和逻辑判断节点
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
  FormControlLabel,
  Switch,
  Divider,
} from '@mui/material';
import {
  AccountTree as ConditionIcon,
  Settings as SettingsIcon,
  CheckCircle as TrueIcon,
  Cancel as FalseIcon,
  CheckCircle as CheckCircleIcon,
  CompareArrows as CompareIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

interface ConditionNodeData {
  name: string;
  type: 'if_else' | 'switch' | 'filter' | 'validator';
  config: {
    condition_type?: string;
    condition_value?: string;
    operator?: string;
    field_path?: string;
    cases?: Array<{ value: string; label: string }>;
    default_case?: string;
    strict_mode?: boolean;
    error_handling?: string;
  };
}

const ConditionNode: React.FC<NodeProps<ConditionNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});

  const conditionTypes = [
    { value: 'equals', label: '等于' },
    { value: 'not_equals', label: '不等于' },
    { value: 'contains', label: '包含' },
    { value: 'not_contains', label: '不包含' },
    { value: 'greater_than', label: '大于' },
    { value: 'less_than', label: '小于' },
    { value: 'regex', label: '正则匹配' },
    { value: 'is_empty', label: '为空' },
    { value: 'is_not_empty', label: '不为空' },
    { value: 'custom', label: '自定义条件' },
  ];

  const getNodeIcon = () => {
    switch (data.type) {
      case 'if_else':
        return <ConditionIcon sx={{ color: '#fff' }} />;
      case 'switch':
        return <CompareIcon sx={{ color: '#fff' }} />;
      case 'filter':
        return <TrueIcon sx={{ color: '#fff' }} />;
      case 'validator':
        return <CheckCircleIcon sx={{ color: '#fff' }} />;
      default:
        return <ConditionIcon sx={{ color: '#fff' }} />;
    }
  };

  const getNodeColor = () => {
    switch (data.type) {
      case 'if_else':
        return 'linear-gradient(45deg, #ffecd2 0%, #fcb69f 100%)';
      case 'switch':
        return 'linear-gradient(45deg, #a18cd1 0%, #fbc2eb 100%)';
      case 'filter':
        return 'linear-gradient(45deg, #fad0c4 0%, #ffd1ff 100%)';
      case 'validator':
        return 'linear-gradient(45deg, #ff9a9e 0%, #fecfef 100%)';
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
      case 'if_else':
        return (
          <>
            <TextField
              fullWidth
              label="字段路径"
              value={config.field_path || ''}
              onChange={(e) =>
                setConfig({ ...config, field_path: e.target.value })
              }
              placeholder="例如: result.status 或 data.score"
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>条件类型</InputLabel>
              <Select
                value={config.condition_type || 'equals'}
                onChange={(e) =>
                  setConfig({ ...config, condition_type: e.target.value })
                }
                label="条件类型"
              >
                {conditionTypes.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {!['is_empty', 'is_not_empty'].includes(config.condition_type || '') && (
              <TextField
                fullWidth
                label="比较值"
                value={config.condition_value || ''}
                onChange={(e) =>
                  setConfig({ ...config, condition_value: e.target.value })
                }
                sx={{ mb: 2 }}
              />
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={config.strict_mode || false}
                  onChange={(e) =>
                    setConfig({ ...config, strict_mode: e.target.checked })
                  }
                />
              }
              label="严格模式"
            />
          </>
        );

      case 'switch':
        return (
          <>
            <TextField
              fullWidth
              label="切换字段"
              value={config.field_path || ''}
              onChange={(e) =>
                setConfig({ ...config, field_path: e.target.value })
              }
              placeholder="例如: data.category"
              sx={{ mb: 2, mt: 1 }}
            />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              分支配置
            </Typography>
            <TextField
              fullWidth
              label="分支案例 (JSON格式)"
              multiline
              rows={4}
              value={JSON.stringify(config.cases || [], null, 2)}
              onChange={(e) => {
                try {
                  const cases = JSON.parse(e.target.value);
                  setConfig({ ...config, cases });
                } catch (error) {
                  // Invalid JSON, ignore
                }
              }}
              placeholder={`[
  {"value": "typeA", "label": "类型A"},
  {"value": "typeB", "label": "类型B"}
]`}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="默认分支"
              value={config.default_case || ''}
              onChange={(e) =>
                setConfig({ ...config, default_case: e.target.value })
              }
            />
          </>
        );

      case 'filter':
        return (
          <>
            <TextField
              fullWidth
              label="过滤字段"
              value={config.field_path || ''}
              onChange={(e) =>
                setConfig({ ...config, field_path: e.target.value })
              }
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>过滤条件</InputLabel>
              <Select
                value={config.condition_type || 'not_empty'}
                onChange={(e) =>
                  setConfig({ ...config, condition_type: e.target.value })
                }
                label="过滤条件"
              >
                {conditionTypes.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="过滤值"
              value={config.condition_value || ''}
              onChange={(e) =>
                setConfig({ ...config, condition_value: e.target.value })
              }
            />
          </>
        );

      case 'validator':
        return (
          <>
            <TextField
              fullWidth
              label="验证字段"
              value={config.field_path || ''}
              onChange={(e) =>
                setConfig({ ...config, field_path: e.target.value })
              }
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>验证类型</InputLabel>
              <Select
                value={config.condition_type || 'not_empty'}
                onChange={(e) =>
                  setConfig({ ...config, condition_type: e.target.value })
                }
                label="验证类型"
              >
                {conditionTypes.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>错误处理</InputLabel>
              <Select
                value={config.error_handling || 'stop'}
                onChange={(e) =>
                  setConfig({ ...config, error_handling: e.target.value })
                }
                label="错误处理"
              >
                <MenuItem value="stop">停止执行</MenuItem>
                <MenuItem value="continue">继续执行</MenuItem>
                <MenuItem value="retry">重试</MenuItem>
                <MenuItem value="default">使用默认值</MenuItem>
              </Select>
            </FormControl>
          </>
        );

      default:
        return null;
    }
  };

  const getOutputHandles = () => {
    switch (data.type) {
      case 'if_else':
        return (
          <>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              style={{
                background: '#4caf50',
                border: '2px solid #fff',
                width: 12,
                height: 12,
                top: '40%',
              }}
            />
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              style={{
                background: '#f44336',
                border: '2px solid #fff',
                width: 12,
                height: 12,
                top: '60%',
              }}
            />
          </>
        );
      case 'switch':
        return (
          <>
            {(config.cases || []).map((caseItem, index) => (
              <Handle
                key={`case-${index}`}
                type="source"
                position={Position.Right}
                id={`case-${caseItem.value}`}
                style={{
                  background: '#2196f3',
                  border: '2px solid #fff',
                  width: 12,
                  height: 12,
                  top: `${30 + index * 15}%`,
                }}
              />
            ))}
            <Handle
              type="source"
              position={Position.Right}
              id="default"
              style={{
                background: '#ff9800',
                border: '2px solid #fff',
                width: 12,
                height: 12,
                top: '80%',
              }}
            />
          </>
        );
      default:
        return (
          <Handle
            type="source"
            position={Position.Right}
            style={{
              background: '#fff',
              border: '2px solid #667eea',
              width: 12,
              height: 12,
            }}
          />
        );
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
            boxShadow: '0 8px 25px rgba(255, 236, 210, 0.4)',
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
            {data.name || '条件节点'}
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
          <Typography variant="body2" sx={{ opacity: 0.9, mb: 0.5 }}>
            条件: {config.condition_type || '未设置'}
          </Typography>
          {config.field_path && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              字段: {config.field_path}
            </Typography>
          )}
        </Box>

        {/* 输出连接点 */}
        {getOutputHandles()}

        {/* 输出标签 */}
        {data.type === 'if_else' && (
          <>
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                right: -30,
                top: '35%',
                color: '#4caf50',
                fontWeight: 'bold',
              }}
            >
              True
            </Typography>
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                right: -35,
                top: '55%',
                color: '#f44336',
                fontWeight: 'bold',
              }}
            >
              False
            </Typography>
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

export default memo(ConditionNode);