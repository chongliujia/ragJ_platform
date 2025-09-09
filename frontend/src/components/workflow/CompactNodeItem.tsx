/**
 * 紧凑型节点组件
 * 用于在侧边栏中显示更紧凑的节点
 */

import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Chip,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  InfoOutlined as InfoIcon,
  DragIndicator as DragIcon,
} from '@mui/icons-material';

interface CompactNodeItemProps {
  nodeTemplate: {
    type: string;
    name: string;
    description: string;
    defaultConfig?: any;
  };
  onDragStart: (event: React.DragEvent, nodeTemplate: any) => void;
  onShowInfo?: (nodeTemplate: any) => void;
}

const CompactNodeItem: React.FC<CompactNodeItemProps> = ({
  nodeTemplate,
  onDragStart,
  onShowInfo,
}) => {
  const getNodeTypeColor = (type: string) => {
    const colorMap: { [key: string]: string } = {
      'llm': '#00d4ff',
      'rag_retriever': '#4caf50',
      'retriever': '#1b5e20',
      'hybrid_retriever': '#2e7d32',
      'condition': '#ff9800',
      'process': '#9c27b0',
      'input': '#2196f3',
      'output': '#f44336',
      'tool': '#607d8b',
      'data': '#795548',
    };
    return colorMap[type] || '#00d4ff';
  };

  const getNodeTypeIcon = (type: string) => {
    const iconMap: { [key: string]: string } = {
      'llm': '🧠',
      'rag_retriever': '🔍',
      'retriever': '🔍',
      'hybrid_retriever': '🔍',
      'condition': '🔀',
      'process': '⚙️',
      'input': '📥',
      'output': '📤',
      'tool': '🔧',
      'data': '📊',
    };
    return iconMap[type] || '🔲';
  };

  return (
    <Paper
      draggable
      onDragStart={(e) => onDragStart(e, nodeTemplate)}
      sx={{
        p: 1,
        cursor: 'grab',
        background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.9) 0%, rgba(15, 20, 25, 0.9) 100%)',
        border: `1px solid ${getNodeTypeColor(nodeTemplate.type)}30`,
        borderRadius: 2,
        transition: 'all 0.2s ease',
        position: 'relative',
        minHeight: '64px',
        display: 'flex',
        flexDirection: 'column',
        '&:hover': {
          backgroundColor: `${getNodeTypeColor(nodeTemplate.type)}10`,
          borderColor: `${getNodeTypeColor(nodeTemplate.type)}60`,
          transform: 'translateY(-1px)',
          boxShadow: `0 4px 12px ${getNodeTypeColor(nodeTemplate.type)}20`,
          '& .drag-indicator': {
            opacity: 1,
          },
          '& .info-button': {
            opacity: 1,
          },
        },
        '&:active': {
          cursor: 'grabbing',
          transform: 'scale(0.98)',
        },
      }}
    >
      {/* 拖拽指示器 */}
      <DragIcon
        className="drag-indicator"
        sx={{
          position: 'absolute',
          top: 2,
          right: 2,
          fontSize: '0.8rem',
          color: 'rgba(255, 255, 255, 0.3)',
          opacity: 0,
          transition: 'opacity 0.2s ease',
        }}
      />

      {/* 信息按钮 */}
      {onShowInfo && (
        <IconButton
          className="info-button"
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onShowInfo(nodeTemplate);
          }}
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 16,
            height: 16,
            opacity: 0,
            transition: 'opacity 0.2s ease',
            color: 'rgba(255, 255, 255, 0.6)',
            '&:hover': {
              color: '#00d4ff',
            },
          }}
        >
          <InfoIcon sx={{ fontSize: '0.8rem' }} />
        </IconButton>
      )}

      {/* 节点内容 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', flex: 1 }}>
        {/* 节点图标 */}
        <Box
          sx={{
            fontSize: '1.2rem',
            mr: 1,
            mt: 0.25,
            minWidth: '20px',
            textAlign: 'center',
          }}
        >
          {getNodeTypeIcon(nodeTemplate.type)}
        </Box>

        {/* 节点信息 */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'white',
              mb: 0.25,
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {nodeTemplate.name}
          </Typography>

          <Typography
            variant="caption"
            sx={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.7)',
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {nodeTemplate.description}
          </Typography>
        </Box>
      </Box>

      {/* 节点类型标签 */}
      <Chip
        label={nodeTemplate.type}
        size="small"
        sx={{
          position: 'absolute',
          bottom: 2,
          right: 2,
          height: '16px',
          fontSize: '0.6rem',
          backgroundColor: `${getNodeTypeColor(nodeTemplate.type)}20`,
          color: getNodeTypeColor(nodeTemplate.type),
          border: `1px solid ${getNodeTypeColor(nodeTemplate.type)}40`,
          '& .MuiChip-label': {
            px: 0.5,
          },
        }}
      />
    </Paper>
  );
};

export default CompactNodeItem;
