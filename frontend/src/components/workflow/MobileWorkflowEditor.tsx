/**
 * 移动端优化的工作流编辑器
 * 专为小屏幕设备优化的紧凑型界面
 */

import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  IconButton,
  Drawer,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
  Fab,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Add as AddIcon,
  Psychology as AIIcon,
  Search as SearchIcon,
  Code as CodeIcon,
  Input as InputIcon,
  Output as OutputIcon,
  Settings as SettingsIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';

interface MobileWorkflowEditorProps {
  onAddNode: (nodeType: string) => void;
  onOpenSettings: () => void;
  nodeCount: number;
  edgeCount: number;
}

const MobileWorkflowEditor: React.FC<MobileWorkflowEditorProps> = ({
  onAddNode,
  onOpenSettings,
  nodeCount,
  edgeCount,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [speedDialOpen, setSpeedDialOpen] = useState(false);

  // 快速添加节点的选项
  const quickAddNodes = [
    { type: 'llm', label: 'AI助手', icon: <AIIcon />, color: '#00d4ff' },
    { type: 'rag_retriever', label: '检索', icon: <SearchIcon />, color: '#4caf50' },
    { type: 'code_executor', label: '代码', icon: <CodeIcon />, color: '#ff9800' },
    { type: 'input', label: '输入', icon: <InputIcon />, color: '#2196f3' },
    { type: 'output', label: '输出', icon: <OutputIcon />, color: '#f44336' },
  ];

  const handleAddNode = useCallback((nodeType: string) => {
    onAddNode(nodeType);
    setSpeedDialOpen(false);
  }, [onAddNode]);

  if (!isMobile) {
    return null; // 只在移动端显示
  }

  return (
    <>
      {/* 状态栏 */}
      <Paper
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1,
          background: 'rgba(26, 31, 46, 0.95)',
          backdropFilter: 'blur(10px)',
          border: 'none',
          borderBottom: '1px solid rgba(0, 212, 255, 0.3)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ color: 'white', fontSize: '1rem', fontWeight: 600 }}>
            智能体工作流
          </Typography>
          <Chip
            label={`${nodeCount}个组件`}
            size="small"
            sx={{
              height: '20px',
              fontSize: '0.7rem',
              backgroundColor: 'rgba(0, 212, 255, 0.2)',
              color: '#00d4ff',
            }}
          />
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton
            size="small"
            onClick={() => setDrawerOpen(true)}
            sx={{ color: '#00d4ff' }}
          >
            <AddIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={onOpenSettings}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            <SettingsIcon />
          </IconButton>
        </Box>
      </Paper>

      {/* 快速添加悬浮按钮 */}
      <SpeedDial
        ariaLabel="快速添加组件"
        sx={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 1000,
          '& .MuiSpeedDial-fab': {
            backgroundColor: '#00d4ff',
            '&:hover': {
              backgroundColor: '#00b3e6',
            },
          },
        }}
        icon={<SpeedDialIcon />}
        open={speedDialOpen}
        onOpen={() => setSpeedDialOpen(true)}
        onClose={() => setSpeedDialOpen(false)}
      >
        {quickAddNodes.map((node) => (
          <SpeedDialAction
            key={node.type}
            icon={node.icon}
            tooltipTitle={node.label}
            onClick={() => handleAddNode(node.type)}
            sx={{
              '& .MuiSpeedDialAction-fab': {
                backgroundColor: `${node.color}20`,
                color: node.color,
                '&:hover': {
                  backgroundColor: `${node.color}30`,
                },
              },
            }}
          />
        ))}
      </SpeedDial>

      {/* 组件选择抽屉 */}
      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{
          '& .MuiDrawer-paper': {
            backgroundColor: '#1a1f2e',
            maxHeight: '70vh',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            border: '1px solid rgba(0, 212, 255, 0.3)',
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
              添加组件
            </Typography>
            <IconButton size="small" onClick={() => setDrawerOpen(false)} sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              <CloseIcon />
            </IconButton>
          </Box>

          {/* 快速添加网格 */}
          <Typography variant="subtitle2" sx={{ color: '#00d4ff', mb: 1 }}>
            常用组件
          </Typography>
          <Grid container spacing={1} sx={{ mb: 2 }}>
            {quickAddNodes.map((node) => (
              <Grid item xs={4} key={node.type}>
                <Paper
                  onClick={() => handleAddNode(node.type)}
                  sx={{
                    p: 1.5,
                    cursor: 'pointer',
                    textAlign: 'center',
                    background: `linear-gradient(135deg, ${node.color}10 0%, ${node.color}05 100%)`,
                    border: `1px solid ${node.color}30`,
                    borderRadius: 2,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      backgroundColor: `${node.color}15`,
                      borderColor: `${node.color}60`,
                      transform: 'translateY(-2px)',
                    },
                  }}
                >
                  <Box sx={{ color: node.color, mb: 0.5 }}>
                    {React.cloneElement(node.icon, { fontSize: 'small' })}
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'white',
                      lineHeight: 1.2,
                    }}
                  >
                    {node.label}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          {/* 更多组件分类 */}
          <Typography variant="subtitle2" sx={{ color: '#00d4ff', mb: 1 }}>
            更多组件
          </Typography>
          <Accordion
            sx={{
              backgroundColor: 'rgba(26, 31, 46, 0.5)',
              border: '1px solid rgba(0, 212, 255, 0.1)',
              borderRadius: 2,
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#00d4ff' }} />}>
              <Typography sx={{ color: 'white', fontWeight: 600 }}>
                数据处理
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={1}>
                {[
                  { type: 'parser', label: '解析器', icon: '📄' },
                  { type: 'transformer', label: '转换器', icon: '🔄' },
                  { type: 'classifier', label: '分类器', icon: '🏷️' },
                ].map((node) => (
                  <Grid item xs={4} key={node.type}>
                    <Paper
                      onClick={() => handleAddNode(node.type)}
                      sx={{
                        p: 1,
                        cursor: 'pointer',
                        textAlign: 'center',
                        background: 'rgba(26, 31, 46, 0.8)',
                        border: '1px solid rgba(0, 212, 255, 0.2)',
                        borderRadius: 1,
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        },
                      }}
                    >
                      <Box sx={{ fontSize: '1.2rem', mb: 0.5 }}>{node.icon}</Box>
                      <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                        {node.label}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Box>
      </Drawer>
    </>
  );
};

export default MobileWorkflowEditor;