/**
 * 增强版节点基础组件
 * 提供更美观的UI设计和更直观的连接体验
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
  Zoom,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  PlayArrow as PlayIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Pause as PauseIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

interface EnhancedNodeProps extends NodeProps {
  nodeType: 'llm' | 'data' | 'process' | 'condition' | 'input' | 'output' | 'tool';
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  status?: 'idle' | 'running' | 'success' | 'error';
  showInputHandle?: boolean;
  showOutputHandle?: boolean;
  inputHandleCount?: number;
  outputHandleCount?: number;
  onConfigClick?: () => void;
  onExecuteClick?: () => void;
  children?: React.ReactNode;
}

const EnhancedNodeBase: React.FC<EnhancedNodeProps> = ({
  data,
  selected,
  nodeType,
  icon,
  title,
  subtitle,
  status = 'idle',
  showInputHandle = true,
  showOutputHandle = true,
  inputHandleCount = 1,
  outputHandleCount = 1,
  onConfigClick,
  onExecuteClick,
  children,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [pulseAnimation, setPulseAnimation] = useState(false);

  // 根据节点类型获取颜色主题
  const getNodeTheme = () => {
    switch (nodeType) {
      case 'llm':
        return {
          gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          accentColor: '#00d4ff',
          shadowColor: 'rgba(102, 126, 234, 0.4)',
          handleColor: '#667eea',
        };
      case 'data':
        return {
          gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          accentColor: '#4facfe',
          shadowColor: 'rgba(79, 172, 254, 0.4)',
          handleColor: '#4facfe',
        };
      case 'process':
        return {
          gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
          accentColor: '#43e97b',
          shadowColor: 'rgba(67, 233, 123, 0.4)',
          handleColor: '#43e97b',
        };
      case 'condition':
        return {
          gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
          accentColor: '#fa709a',
          shadowColor: 'rgba(250, 112, 154, 0.4)',
          handleColor: '#fa709a',
        };
      case 'input':
        return {
          gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
          accentColor: '#a8edea',
          shadowColor: 'rgba(168, 237, 234, 0.4)',
          handleColor: '#a8edea',
        };
      case 'output':
        return {
          gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
          accentColor: '#fcb69f',
          shadowColor: 'rgba(252, 182, 159, 0.4)',
          handleColor: '#fcb69f',
        };
      case 'tool':
        return {
          gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
          accentColor: '#ff9a9e',
          shadowColor: 'rgba(255, 154, 158, 0.4)',
          handleColor: '#ff9a9e',
        };
      default:
        return {
          gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          accentColor: '#00d4ff',
          shadowColor: 'rgba(102, 126, 234, 0.4)',
          handleColor: '#667eea',
        };
    }
  };

  const theme = getNodeTheme();

  // 根据状态获取状态图标
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
    if (showInputHandle) {
      for (let i = 0; i < inputHandleCount; i++) {
        const topPercent = inputHandleCount === 1 ? 50 : (100 / (inputHandleCount + 1)) * (i + 1);
        handles.push(
          <Handle
            key={`input-${i}`}
            type="target"
            position={Position.Left}
            id={`input-${i}`}
            style={{
              background: `linear-gradient(45deg, #ffffff 0%, ${theme.accentColor} 100%)`,
              border: `2px solid ${theme.handleColor}`,
              width: 16,
              height: 16,
              borderRadius: '50%',
              boxShadow: `0 2px 8px ${theme.accentColor}40`,
              top: `${topPercent}%`,
              transform: 'translateY(-50%)',
              transition: 'all 0.3s ease',
              zIndex: 10,
            }}
          />
        );
      }
    }

    // 输出连接点
    if (showOutputHandle) {
      for (let i = 0; i < outputHandleCount; i++) {
        const topPercent = outputHandleCount === 1 ? 50 : (100 / (outputHandleCount + 1)) * (i + 1);
        handles.push(
          <Handle
            key={`output-${i}`}
            type="source"
            position={Position.Right}
            id={`output-${i}`}
            style={{
              background: `linear-gradient(45deg, ${theme.accentColor} 0%, #ffffff 100%)`,
              border: `2px solid ${theme.handleColor}`,
              width: 16,
              height: 16,
              borderRadius: '50%',
              boxShadow: `0 2px 8px ${theme.accentColor}40`,
              top: `${topPercent}%`,
              transform: 'translateY(-50%)',
              transition: 'all 0.3s ease',
              zIndex: 10,
            }}
          />
        );
      }
    }

    return handles;
  };

  return (
    <Box
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      sx={{
        background: theme.gradient,
        border: selected ? `2px solid ${theme.accentColor}` : '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: 3,
        padding: 2,
        minWidth: 160,
        maxWidth: 240,
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
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `linear-gradient(135deg, rgba(255, 255, 255, ${isHovered ? 0.2 : 0.1}) 0%, transparent 50%)`,
          borderRadius: 3,
          pointerEvents: 'none',
          transition: 'all 0.3s ease',
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          top: -2,
          left: -2,
          right: -2,
          bottom: -2,
          background: `linear-gradient(45deg, ${theme.accentColor}20, transparent, ${theme.accentColor}20)`,
          borderRadius: 4,
          opacity: selected ? 1 : 0,
          transition: 'opacity 0.3s ease',
          zIndex: -1,
        },
      }}
    >
      {/* 连接点 */}
      {renderHandles()}

      {/* 状态指示器 */}
      {status !== 'idle' && (
        <Box
          sx={{
            position: 'absolute',
            top: -8,
            right: -8,
            zIndex: 20,
          }}
        >
          <Zoom in={true}>
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
          </Zoom>
        </Box>
      )}

      {/* 节点头部 */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ 
          mr: 1.5, 
          fontSize: '1.2rem',
          filter: isHovered ? 'brightness(1.2)' : 'brightness(1)',
          transition: 'filter 0.3s ease',
        }}>
          {icon}
        </Box>
        <Box sx={{ flexGrow: 1 }}>
          <Typography 
            variant="h6" 
            sx={{ 
              fontSize: '0.9rem',
              fontWeight: 600,
              lineHeight: 1.2,
              mb: 0.5,
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography 
              variant="body2" 
              sx={{ 
                fontSize: '0.7rem',
                opacity: 0.8,
                lineHeight: 1.1,
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Fade in={isHovered}>
            <Tooltip title="配置节点" arrow>
              <IconButton
                size="small"
                onClick={onConfigClick}
                sx={{ 
                  color: 'white',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    transform: 'scale(1.1)',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Fade>
          <Fade in={isHovered}>
            <Tooltip title="执行节点" arrow>
              <IconButton
                size="small"
                onClick={onExecuteClick}
                sx={{ 
                  color: 'white',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    transform: 'scale(1.1)',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <PlayIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Fade>
        </Box>
      </Box>

      {/* 节点内容 */}
      <Box sx={{ minHeight: '40px' }}>
        {children}
      </Box>

      {/* 节点类型标签 */}
      <Box sx={{ position: 'absolute', bottom: 8, left: 8 }}>
        <Chip
          label={nodeType.toUpperCase()}
          size="small"
          sx={{
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            color: 'white',
            fontSize: '0.6rem',
            height: 20,
            fontWeight: 600,
            backdropFilter: 'blur(4px)',
            border: `1px solid rgba(255, 255, 255, 0.3)`,
          }}
        />
      </Box>
    </Box>
  );
};

export default memo(EnhancedNodeBase);