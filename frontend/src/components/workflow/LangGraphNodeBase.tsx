/**
 * LangGraph节点基础组件
 * 设计理念：每个组件就是一个函数，显示输入输出参数
 */

import React, { memo, useState, useEffect } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip,
  Badge,
  Fade,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  PlayArrow as PlayIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Pause as PauseIcon,
  ExpandMore as ExpandMoreIcon,
  Input as InputIcon,
  Output as OutputIcon,
  Code as CodeIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

// 参数类型定义
interface Parameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  description: string;
  required?: boolean;
  defaultValue?: any;
  example?: string;
}

// 函数签名定义
interface FunctionSignature {
  name: string;
  description: string;
  inputs: Parameter[];
  outputs: Parameter[];
  category: 'llm' | 'data' | 'process' | 'condition' | 'tool' | 'agent';
}

interface LangGraphNodeProps extends NodeProps {
  functionSignature: FunctionSignature;
  status?: 'idle' | 'running' | 'success' | 'error';
  executionTime?: number;
  memoryUsage?: number;
  onConfigClick?: () => void;
  onExecuteClick?: () => void;
  children?: React.ReactNode;
}

const LangGraphNodeBase: React.FC<LangGraphNodeProps> = ({
  data,
  selected,
  functionSignature,
  status = 'idle',
  executionTime,
  memoryUsage,
  onConfigClick,
  onExecuteClick,
  children,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [pulseAnimation, setPulseAnimation] = useState(false);

  // 根据函数类型获取颜色主题
  const getNodeTheme = () => {
    switch (functionSignature.category) {
      case 'llm':
        return {
          gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          accentColor: '#00d4ff',
          shadowColor: 'rgba(102, 126, 234, 0.4)',
          icon: '🧠',
        };
      case 'data':
        return {
          gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          accentColor: '#4facfe',
          shadowColor: 'rgba(79, 172, 254, 0.4)',
          icon: '📊',
        };
      case 'process':
        return {
          gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
          accentColor: '#43e97b',
          shadowColor: 'rgba(67, 233, 123, 0.4)',
          icon: '⚙️',
        };
      case 'condition':
        return {
          gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
          accentColor: '#fa709a',
          shadowColor: 'rgba(250, 112, 154, 0.4)',
          icon: '🔀',
        };
      case 'tool':
        return {
          gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
          accentColor: '#ff9a9e',
          shadowColor: 'rgba(255, 154, 158, 0.4)',
          icon: '🔧',
        };
      case 'agent':
        return {
          gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
          accentColor: '#a8edea',
          shadowColor: 'rgba(168, 237, 234, 0.4)',
          icon: '🤖',
        };
      default:
        return {
          gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          accentColor: '#00d4ff',
          shadowColor: 'rgba(102, 126, 234, 0.4)',
          icon: '🔲',
        };
    }
  };

  const theme = getNodeTheme();

  // 获取状态图标
  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <PauseIcon sx={{ color: '#ffc107', fontSize: '1rem' }} />;
      case 'success':
        return <CheckIcon sx={{ color: '#4caf50', fontSize: '1rem' }} />;
      case 'error':
        return <ErrorIcon sx={{ color: '#f44336', fontSize: '1rem' }} />;
      default:
        return null;
    }
  };

  // 获取参数类型颜色
  const getTypeColor = (type: string) => {
    const colors = {
      string: '#4caf50',
      number: '#2196f3',
      boolean: '#ff9800',
      object: '#9c27b0',
      array: '#f44336',
      any: '#666666',
    };
    return colors[type as keyof typeof colors] || '#666666';
  };

  // 状态变化时的脉冲动画
  useEffect(() => {
    if (status === 'running') {
      setPulseAnimation(true);
      const timer = setTimeout(() => setPulseAnimation(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // 渲染连接点
  const renderHandles = () => {
    const handles = [];
    
    // 输入连接点
    functionSignature.inputs.forEach((input, index) => {
      const topPercent = functionSignature.inputs.length === 1 ? 50 : 
        (100 / (functionSignature.inputs.length + 1)) * (index + 1);
      
      handles.push(
        <React.Fragment key={`input-${index}`}>
          <Handle
            type="target"
            position={Position.Left}
            id={`input-${index}`}
            style={{
              background: `linear-gradient(45deg, #ffffff 0%, ${theme.accentColor} 100%)`,
              border: `2px solid ${getTypeColor(input.type)}`,
              width: 14,
              height: 14,
              borderRadius: '50%',
              boxShadow: `0 2px 8px ${theme.accentColor}40`,
              top: `${topPercent}%`,
              transform: 'translateY(-50%)',
              transition: 'all 0.3s ease',
              zIndex: 10,
            }}
          />
          {/* 输入参数标签 */}
          {(isHovered || selected) && (
            <Box
              sx={{
                position: 'absolute',
                left: -100,
                top: `${topPercent}%`,
                transform: 'translateY(-50%)',
                background: 'rgba(26, 31, 46, 0.95)',
                color: 'white',
                padding: '2px 6px',
                borderRadius: 1,
                fontSize: '0.6rem',
                fontWeight: 600,
                border: `1px solid ${getTypeColor(input.type)}`,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                zIndex: 20,
                whiteSpace: 'nowrap',
                backdropFilter: 'blur(10px)',
              }}
            >
              {input.name}
              <Box component="span" sx={{ ml: 0.5, opacity: 0.7 }}>
                ({input.type})
              </Box>
            </Box>
          )}
        </React.Fragment>
      );
    });

    // 输出连接点
    functionSignature.outputs.forEach((output, index) => {
      const topPercent = functionSignature.outputs.length === 1 ? 50 : 
        (100 / (functionSignature.outputs.length + 1)) * (index + 1);
      
      handles.push(
        <React.Fragment key={`output-${index}`}>
          <Handle
            type="source"
            position={Position.Right}
            id={`output-${index}`}
            style={{
              background: `linear-gradient(45deg, ${theme.accentColor} 0%, #ffffff 100%)`,
              border: `2px solid ${getTypeColor(output.type)}`,
              width: 14,
              height: 14,
              borderRadius: '50%',
              boxShadow: `0 2px 8px ${theme.accentColor}40`,
              top: `${topPercent}%`,
              transform: 'translateY(-50%)',
              transition: 'all 0.3s ease',
              zIndex: 10,
            }}
          />
          {/* 输出参数标签 */}
          {(isHovered || selected) && (
            <Box
              sx={{
                position: 'absolute',
                right: -100,
                top: `${topPercent}%`,
                transform: 'translateY(-50%)',
                background: 'rgba(26, 31, 46, 0.95)',
                color: 'white',
                padding: '2px 6px',
                borderRadius: 1,
                fontSize: '0.6rem',
                fontWeight: 600,
                border: `1px solid ${getTypeColor(output.type)}`,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                zIndex: 20,
                whiteSpace: 'nowrap',
                backdropFilter: 'blur(10px)',
              }}
            >
              {output.name}
              <Box component="span" sx={{ ml: 0.5, opacity: 0.7 }}>
                ({output.type})
              </Box>
            </Box>
          )}
        </React.Fragment>
      );
    });

    return handles;
  };

  // 渲染参数列表
  const renderParameterList = (params: Parameter[], type: 'input' | 'output') => (
    <List dense sx={{ p: 0 }}>
      {params.map((param, index) => (
        <ListItem key={index} sx={{ px: 1, py: 0.5 }}>
          <ListItemText
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
                  {param.name}
                </Typography>
                <Chip
                  label={param.type}
                  size="small"
                  sx={{
                    backgroundColor: getTypeColor(param.type),
                    color: 'white',
                    fontSize: '0.6rem',
                    height: 16,
                  }}
                />
                {param.required && (
                  <Chip
                    label="必需"
                    size="small"
                    sx={{
                      backgroundColor: '#f44336',
                      color: 'white',
                      fontSize: '0.6rem',
                      height: 16,
                    }}
                  />
                )}
              </Box>
            }
            secondary={
              <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.8 }}>
                {param.description}
                {param.example && (
                  <Box component="span" sx={{ display: 'block', fontStyle: 'italic', mt: 0.5 }}>
                    例: {param.example}
                  </Box>
                )}
              </Typography>
            }
          />
        </ListItem>
      ))}
    </List>
  );

  return (
    <Box
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      sx={{
        background: theme.gradient,
        border: selected ? `2px solid ${theme.accentColor}` : '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: 3,
        minWidth: 200,
        maxWidth: 320,
        color: 'white',
        position: 'relative',
        boxShadow: selected 
          ? `0 8px 32px ${theme.accentColor}40` 
          : isHovered 
            ? `0 8px 25px ${theme.shadowColor}` 
            : '0 4px 20px rgba(0, 0, 0, 0.3)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: 'pointer',
        backdropFilter: 'blur(10px)',
        transform: isHovered ? 'translateY(-2px) scale(1.02)' : 'translateY(0) scale(1)',
        animation: pulseAnimation ? 'pulse 1s infinite' : 'none',
        '@keyframes pulse': {
          '0%': { boxShadow: `0 0 0 0 ${theme.accentColor}40` },
          '70%': { boxShadow: `0 0 0 10px ${theme.accentColor}00` },
          '100%': { boxShadow: `0 0 0 0 ${theme.accentColor}00` },
        },
      }}
    >
      {/* 连接点 */}
      {renderHandles()}

      {/* 状态指示器 */}
      {status !== 'idle' && (
        <Box sx={{ position: 'absolute', top: -8, right: -8, zIndex: 20 }}>
          <Badge
            badgeContent={getStatusIcon()}
            sx={{
              '& .MuiBadge-badge': {
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                borderRadius: '50%',
                padding: '4px',
                minWidth: 24,
                height: 24,
              },
            }}
          />
        </Box>
      )}

      {/* 函数头部 */}
      <Box sx={{ p: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Box sx={{ fontSize: '1.2rem', mr: 1 }}>{theme.icon}</Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" sx={{ fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.2 }}>
              {functionSignature.name}
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.7rem', opacity: 0.8, lineHeight: 1.1 }}>
              {functionSignature.description}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="查看函数签名" arrow>
              <IconButton
                size="small"
                onClick={() => setShowParams(!showParams)}
                sx={{ 
                  color: 'white',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.2)' },
                }}
              >
                <CodeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Fade in={isHovered}>
              <Tooltip title="配置节点" arrow>
                <IconButton
                  size="small"
                  onClick={onConfigClick}
                  sx={{ 
                    color: 'white',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.2)' },
                  }}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Fade>
            <Fade in={isHovered}>
              <Tooltip title="执行函数" arrow>
                <IconButton
                  size="small"
                  onClick={onExecuteClick}
                  sx={{ 
                    color: 'white',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.2)' },
                  }}
                >
                  <PlayIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Fade>
          </Box>
        </Box>

        {/* 函数签名简要信息 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Chip
            label={`${functionSignature.inputs.length} 输入`}
            size="small"
            icon={<InputIcon />}
            sx={{
              backgroundColor: 'rgba(76, 175, 80, 0.2)',
              color: '#4caf50',
              fontSize: '0.6rem',
              height: 20,
            }}
          />
          <Chip
            label={`${functionSignature.outputs.length} 输出`}
            size="small"
            icon={<OutputIcon />}
            sx={{
              backgroundColor: 'rgba(33, 150, 243, 0.2)',
              color: '#2196f3',
              fontSize: '0.6rem',
              height: 20,
            }}
          />
          <Chip
            label={functionSignature.category}
            size="small"
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              fontSize: '0.6rem',
              height: 20,
            }}
          />
        </Box>

        {/* 性能指标 */}
        {(executionTime || memoryUsage) && (
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            {executionTime && (
              <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>
                ⏱️ {executionTime}ms
              </Typography>
            )}
            {memoryUsage && (
              <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>
                💾 {memoryUsage}MB
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {/* 参数详情 */}
      {showParams && (
        <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.2)' }}>
          <Accordion
            sx={{
              backgroundColor: 'transparent',
              boxShadow: 'none',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: 'white' }} />}
              sx={{ minHeight: '32px', py: 0 }}
            >
              <Typography variant="body2" sx={{ fontSize: '0.7rem', color: '#4caf50' }}>
                输入参数 ({functionSignature.inputs.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0 }}>
              {renderParameterList(functionSignature.inputs, 'input')}
            </AccordionDetails>
          </Accordion>

          <Accordion
            sx={{
              backgroundColor: 'transparent',
              boxShadow: 'none',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: 'white' }} />}
              sx={{ minHeight: '32px', py: 0 }}
            >
              <Typography variant="body2" sx={{ fontSize: '0.7rem', color: '#2196f3' }}>
                输出参数 ({functionSignature.outputs.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ py: 0 }}>
              {renderParameterList(functionSignature.outputs, 'output')}
            </AccordionDetails>
          </Accordion>
        </Box>
      )}

      {/* 自定义内容 */}
      {children && (
        <Box sx={{ p: 2, pt: 0 }}>
          {children}
        </Box>
      )}
    </Box>
  );
};

export default memo(LangGraphNodeBase);