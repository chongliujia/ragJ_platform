/**
 * 快速访问面板
 * 显示常用的智能体组件，方便快速构建工作流
 */

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  IconButton,
  Tooltip,
  Chip,
  Collapse,
  Button,
} from '@mui/material';
import {
  Psychology as AIIcon,
  Search as SearchIcon,
  Code as CodeIcon,
  Analytics as AnalyticsIcon,
  Input as InputIcon,
  Output as OutputIcon,
  Settings as SettingsIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';

interface QuickAccessPanelProps {
  onDragStart: (event: React.DragEvent, nodeTemplate: any) => void;
  onCreateCustomAgent?: () => void;
}

const QuickAccessPanel: React.FC<QuickAccessPanelProps> = ({
  onDragStart,
  onCreateCustomAgent,
}) => {
  const [expanded, setExpanded] = useState(true);

  // 快速访问的组件
  const quickAccessNodes = [
    {
      type: 'llm',
      name: 'AI助手',
      description: '智能对话和文本生成',
      icon: <AIIcon />,
      color: '#00d4ff',
      defaultConfig: {
        model: 'qwen-turbo',
        temperature: 0.7,
        max_tokens: 1000,
        system_prompt: '你是一个有用的AI助手。',
      },
    },
    {
      type: 'reranker',
      name: '结果重排',
      description: '对检索结果进行重排序',
      icon: <SettingsIcon />,
      color: '#f6d365',
      defaultConfig: {
        provider: 'bge',
        top_k: 3,
      },
    },
    {
      type: 'rag_retriever',
      name: '知识检索',
      description: '从知识库检索相关信息',
      icon: <SearchIcon />,
      color: '#4caf50',
      defaultConfig: {
        knowledge_base: '',
        top_k: 5,
        score_threshold: 0.7,
        rerank: true,
      },
    },
    {
      type: 'hybrid_retriever',
      name: '混合检索',
      description: '向量+关键词融合检索',
      icon: <SearchIcon />,
      color: '#2e7d32',
      defaultConfig: {
        knowledge_base: '',
        top_k: 5,
        score_threshold: 0.7,
        rerank: true,
      },
    },
    {
      type: 'retriever',
      name: '统一检索',
      description: '向量/关键词/混合可选',
      icon: <SearchIcon />,
      color: '#1b5e20',
      defaultConfig: {
        knowledge_base: '',
        top_k: 5,
        score_threshold: 0.7,
        mode: 'hybrid',
      },
    },
    {
      type: 'code_executor',
      name: '代码执行',
      description: '执行Python代码',
      icon: <CodeIcon />,
      color: '#ff9800',
      defaultConfig: {
        language: 'python',
        timeout: 30,
        environment: 'sandbox',
      },
    },
    {
      type: 'classifier',
      name: '分类器',
      description: '文本分类和意图识别',
      icon: <AnalyticsIcon />,
      color: '#9c27b0',
      defaultConfig: {
        model: 'qwen-turbo',
        classes: ['正面', '负面', '中性'],
        confidence_threshold: 0.8,
      },
    },
    {
      type: 'input',
      name: '输入节点',
      description: '接收用户输入',
      icon: <InputIcon />,
      color: '#2196f3',
      defaultConfig: {
        input_type: 'text',
        required: true,
        validation: {},
      },
    },
    {
      type: 'output',
      name: '输出节点',
      description: '返回处理结果',
      icon: <OutputIcon />,
      color: '#f44336',
      defaultConfig: {
        output_type: 'text',
        format: 'json',
        template: '',
      },
    },
  ];

  const handleQuickCreate = (nodeTemplate: any) => {
    const event = new DragEvent('dragstart', { bubbles: true });
    onDragStart(event as any, nodeTemplate);
  };

  return (
    <Paper
      sx={{
        mb: 2,
        background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.9) 0%, rgba(15, 20, 25, 0.9) 100%)',
        border: '1px solid rgba(0, 212, 255, 0.2)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {/* 头部 */}
      <Box
        sx={{
          p: 0.3,
          borderBottom: '1px solid rgba(0, 212, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <SettingsIcon sx={{ color: '#00d4ff', mr: 1, fontSize: '1.1rem' }} />
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 600,
              color: 'white',
              fontSize: '0.8rem',
            }}
          >
            快速构建
          </Typography>
          <Chip
            label="常用"
            size="small"
            sx={{
              ml: 0.5,
              height: '16px',
              fontSize: '0.65rem',
              backgroundColor: 'rgba(0, 212, 255, 0.2)',
              color: '#00d4ff',
            }}
          />
        </Box>
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
        >
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      {/* 内容 */}
      <Collapse in={expanded}>
        <Box sx={{ p: 0.3 }}>
          <Grid container spacing={0.5}>
            {quickAccessNodes.map((node) => (
              <Grid size={4} key={node.type}>
                <Tooltip title={node.description} arrow placement="top">
                  <Paper
                    draggable
                    onDragStart={(e) => onDragStart(e, node)}
                    sx={{
                      p: 0.2,
                      cursor: 'grab',
                      textAlign: 'center',
                      background: `linear-gradient(135deg, ${node.color}10 0%, ${node.color}05 100%)`,
                      border: `1px solid ${node.color}30`,
                      borderRadius: 1,
                      transition: 'all 0.2s ease',
                      minHeight: '28px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      '&:hover': {
                        backgroundColor: `${node.color}15`,
                        borderColor: `${node.color}60`,
                        transform: 'translateY(-1px)',
                        boxShadow: `0 4px 12px ${node.color}20`,
                      },
                      '&:active': {
                        cursor: 'grabbing',
                        transform: 'scale(0.95)',
                      },
                    }}
                  >
                    <Box sx={{ color: node.color, mb: 0.25, fontSize: '0.9rem' }}>
                      {React.cloneElement(node.icon, { fontSize: 'small' })}
                    </Box>
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        color: 'white',
                        lineHeight: 1.1,
                      }}
                    >
                      {node.name}
                    </Typography>
                  </Paper>
                </Tooltip>
              </Grid>
            ))}
          </Grid>

          {/* 自定义智能体按钮 */}
          {onCreateCustomAgent && (
            <Button
              fullWidth
              variant="outlined"
              size="small"
              onClick={onCreateCustomAgent}
              sx={{
                mt: 1,
                py: 0.5,
                fontSize: '0.75rem',
                textTransform: 'none',
                borderColor: 'rgba(0, 212, 255, 0.5)',
                color: '#00d4ff',
                '&:hover': {
                  borderColor: '#00d4ff',
                  backgroundColor: 'rgba(0, 212, 255, 0.1)',
                },
              }}
            >
              + 创建自定义智能体
            </Button>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default QuickAccessPanel;
