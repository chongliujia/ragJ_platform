/**
 * 超紧凑型节点组件
 * 专为极小空间设计的节点显示组件
 */

import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Tooltip,
} from '@mui/material';

interface UltraCompactNodeItemProps {
  nodeTemplate: {
    type: string;
    name: string;
    description: string;
    defaultConfig?: any;
  };
  onDragStart: (event: React.DragEvent, nodeTemplate: any) => void;
  onShowInfo?: (nodeTemplate: any) => void;
}

const UltraCompactNodeItem: React.FC<UltraCompactNodeItemProps> = ({
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
      'code_executor': '#ff9800',
      'classifier': '#9c27b0',
      'summarizer': '#00d4ff',
      'translator': '#00d4ff',
      'parser': '#795548',
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
      'code_executor': '💻',
      'classifier': '🏷️',
      'summarizer': '📝',
      'translator': '🌐',
      'parser': '📄',
    };
    return iconMap[type] || '🔲';
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onShowInfo) {
      onShowInfo(nodeTemplate);
    }
  };

  return (
    <Tooltip title={`${nodeTemplate.name} - ${nodeTemplate.description}`} arrow placement="top">
      <Paper
        draggable
        onDragStart={(e) => onDragStart(e, nodeTemplate)}
        onDoubleClick={handleDoubleClick}
        sx={{
          p: 0.2,
          cursor: 'grab',
          background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.9) 0%, rgba(15, 20, 25, 0.9) 100%)',
          border: `1px solid ${getNodeTypeColor(nodeTemplate.type)}30`,
          borderRadius: 1,
          transition: 'all 0.2s ease',
          position: 'relative',
          minHeight: '28px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          '&:hover': {
            backgroundColor: `${getNodeTypeColor(nodeTemplate.type)}10`,
            borderColor: `${getNodeTypeColor(nodeTemplate.type)}60`,
            transform: 'translateY(-1px)',
            boxShadow: `0 3px 8px ${getNodeTypeColor(nodeTemplate.type)}20`,
          },
          '&:active': {
            cursor: 'grabbing',
            transform: 'scale(0.98)',
          },
        }}
      >
        {/* 节点图标 */}
        <Box
          sx={{
            fontSize: '0.8rem',
            mb: 0,
            color: getNodeTypeColor(nodeTemplate.type),
          }}
        >
          {getNodeTypeIcon(nodeTemplate.type)}
        </Box>

        {/* 节点名称 */}
        <Typography
          variant="caption"
          sx={{
            fontSize: '0.6rem',
            fontWeight: 600,
            color: 'white',
            lineHeight: 1.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {nodeTemplate.name}
        </Typography>

        {/* 类型标签 */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 1,
            right: 1,
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: getNodeTypeColor(nodeTemplate.type),
            opacity: 0.7,
          }}
        />
      </Paper>
    </Tooltip>
  );
};

export default UltraCompactNodeItem;
