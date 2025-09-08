/**
 * 增强版边组件
 * 提供更美观的连接线和交互效果
 */

import React, { useState } from 'react';
import {
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  useReactFlow,
} from 'reactflow';
import type { EdgeProps } from 'reactflow';
import { IconButton, Tooltip, Box, Typography } from '@mui/material';
import { 
  Close as CloseIcon, 
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';

interface EnhancedEdgeData {
  label?: string;
  animated?: boolean;
  status?: 'idle' | 'active' | 'success' | 'error';
  dataFlow?: {
    throughput?: number;
    latency?: number;
    errors?: number;
  };
}

const EnhancedEdge: React.FC<EdgeProps<EnhancedEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  selected,
  markerEnd,
  sourceHandle,
  targetHandle,
}) => {
  const { setEdges } = useReactFlow();
  const [isHovered, setIsHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onEdgeDelete = () => {
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
  };

  const getEdgeColor = () => {
    switch (data?.status) {
      case 'active':
        return '#00d4ff';
      case 'success':
        return '#4caf50';
      case 'error':
        return '#f44336';
      default:
        return '#666';
    }
  };

  const getEdgeWidth = () => {
    if (selected) return 4;
    if (isHovered) return 3;
    return 2;
  };

  const getAnimationSpeed = () => {
    if (data?.dataFlow?.throughput) {
      return Math.max(0.5, 3 - (data.dataFlow.throughput / 100));
    }
    return 2;
  };

  return (
    <>
      {/* 底层发光效果 */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: getEdgeColor(),
          strokeWidth: getEdgeWidth() + 2,
          opacity: 0.3,
          filter: 'blur(3px)',
        }}
      />
      
      {/* 主边线 */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: getEdgeColor(),
          strokeWidth: getEdgeWidth(),
          strokeDasharray: data?.animated ? '5,5' : 'none',
          animation: data?.animated 
            ? `flowAnimation ${getAnimationSpeed()}s linear infinite`
            : 'none',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
      
      {/* 数据流动效果 */}
      {data?.status === 'active' && (
        <BaseEdge
          path={edgePath}
          style={{
            stroke: '#ffffff',
            strokeWidth: 1,
            strokeDasharray: '3,7',
            animation: 'dataFlow 1s linear infinite',
            opacity: 0.8,
          }}
        />
      )}

      {/* 边标签和控制按钮 */}
      <EdgeLabelRenderer>
        <Box
          sx={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: 'rgba(26, 31, 46, 0.95)',
            border: `1px solid ${getEdgeColor()}`,
            borderRadius: 2,
            padding: '4px 8px',
            fontSize: '0.7rem',
            color: 'white',
            pointerEvents: 'all',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            backdropFilter: 'blur(10px)',
            opacity: isHovered || selected ? 1 : 0.7,
            transition: 'all 0.3s ease',
            boxShadow: `0 2px 8px ${getEdgeColor()}40`,
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* 状态指示器 */}
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: getEdgeColor(),
              animation: data?.status === 'active' ? 'pulse 2s infinite' : 'none',
              '@keyframes pulse': {
                '0%': { opacity: 1 },
                '50%': { opacity: 0.5 },
                '100%': { opacity: 1 },
              },
            }}
          />

          {/* 边标签：源输出 → 目标输入 */}
          {(() => {
            const labelMode = (data as any)?.labelMode || 'always';
            const show = labelMode === 'always' || isHovered || selected;
            if (!show) return null;
            const src = sourceHandle || 'output';
            const tgt = targetHandle || 'input';
            const text = (data?.label as any) || `${src} → ${tgt}`;
            return (
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
                {text}
              </Typography>
            );
          })()}

          {/* 性能指标 */}
          {data?.dataFlow && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SpeedIcon sx={{ fontSize: '0.8rem' }} />
              <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>
                {data.dataFlow.throughput || 0}/s
              </Typography>
            </Box>
          )}

          {/* 控制按钮 */}
          {(isHovered || selected) && (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="暂停数据流" arrow>
                <IconButton
                  size="small"
                  onClick={() => {
                    // 切换动画状态
                    console.log('Toggle animation');
                  }}
                  sx={{
                    width: 20,
                    height: 20,
                    color: 'white',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    },
                  }}
                >
                  {data?.animated ? <PauseIcon sx={{ fontSize: '0.8rem' }} /> : <PlayIcon sx={{ fontSize: '0.8rem' }} />}
                </IconButton>
              </Tooltip>
              <Tooltip title="删除连接" arrow>
                <IconButton
                  size="small"
                  onClick={onEdgeDelete}
                  sx={{
                    width: 20,
                    height: 20,
                    color: '#f44336',
                    '&:hover': {
                      backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    },
                  }}
                >
                  <CloseIcon sx={{ fontSize: '0.8rem' }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>
      </EdgeLabelRenderer>

      {/* 动画样式 */}
      <style>
        {`
          @keyframes flowAnimation {
            to {
              stroke-dashoffset: -10;
            }
          }
          @keyframes dataFlow {
            to {
              stroke-dashoffset: -10;
            }
          }
        `}
      </style>
    </>
  );
};

export default EnhancedEdge;
