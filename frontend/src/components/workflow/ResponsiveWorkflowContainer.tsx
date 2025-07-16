/**
 * 响应式工作流容器
 * 根据屏幕尺寸自动调整布局
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  useTheme,
  useMediaQuery,
  IconButton,
  Tooltip,
  Paper,
  Typography,
  Chip,
  Zoom,
} from '@mui/material';
import {
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  Smartphone as MobileIcon,
  Tablet as TabletIcon,
  Computer as DesktopIcon,
  VisibilityOff as HideIcon,
  Visibility as ShowIcon,
} from '@mui/icons-material';

interface ResponsiveWorkflowContainerProps {
  children: React.ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  nodeCount: number;
  edgeCount: number;
  workflowName: string;
}

const ResponsiveWorkflowContainer: React.FC<ResponsiveWorkflowContainerProps> = ({
  children,
  sidebarOpen,
  onToggleSidebar,
  nodeCount,
  edgeCount,
  workflowName,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(true);

  // 全屏切换
  const handleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  // 监听全屏状态变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 根据屏幕尺寸自动调整侧边栏
  useEffect(() => {
    if (isMobile) {
      // 移动端默认关闭侧边栏
      if (sidebarOpen) {
        onToggleSidebar();
      }
    } else if (isTablet) {
      // 平板端可选择性关闭
      if (sidebarOpen && nodeCount > 0) {
        onToggleSidebar();
      }
    }
  }, [isMobile, isTablet, nodeCount]);

  // 获取设备类型图标
  const getDeviceIcon = () => {
    if (isMobile) return <MobileIcon />;
    if (isTablet) return <TabletIcon />;
    return <DesktopIcon />;
  };

  // 获取设备类型标签
  const getDeviceLabel = () => {
    if (isMobile) return '移动端';
    if (isTablet) return '平板端';
    return '桌面端';
  };

  // 计算主要内容区域样式
  const getMainContentStyle = () => {
    let width = '100vw';
    let marginLeft = '0';
    
    if (!isMobile && sidebarOpen) {
      width = 'calc(100vw - 320px)';
      marginLeft = '320px';
    }
    
    return {
      width,
      marginLeft,
      height: '100vh',
      transition: 'all 0.3s ease-in-out',
      position: 'relative' as const,
      overflow: 'hidden',
    };
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 主要内容区域 */}
      <Box sx={getMainContentStyle()}>
        {/* 工作流画布 */}
        <Box
          sx={{
            width: '100%',
            height: '100%',
            position: 'relative',
            background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 50%, #0f1419 100%)',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'radial-gradient(circle at 25% 25%, rgba(0, 212, 255, 0.1) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(0, 153, 204, 0.05) 0%, transparent 50%)',
              pointerEvents: 'none',
              zIndex: 1,
            },
          }}
        >
          {children}
        </Box>

        {/* 响应式控制栏 */}
        <Paper
          sx={{
            position: 'absolute',
            top: 16,
            left: 16,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1,
            background: 'rgba(26, 31, 46, 0.9)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(0, 212, 255, 0.3)',
            borderRadius: 2,
          }}
        >
          {/* 设备类型指示器 */}
          <Tooltip title={getDeviceLabel()} arrow>
            <Box sx={{ color: '#00d4ff', display: 'flex', alignItems: 'center' }}>
              {getDeviceIcon()}
            </Box>
          </Tooltip>

          {/* 工作流名称 */}
          <Typography
            variant="body2"
            sx={{
              color: 'white',
              fontWeight: 600,
              fontSize: '0.85rem',
              maxWidth: isMobile ? '100px' : '200px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {workflowName}
          </Typography>

          {/* 统计信息 */}
          <Zoom in={showStats}>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Chip
                label={`${nodeCount}`}
                size="small"
                sx={{
                  height: '20px',
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(0, 212, 255, 0.2)',
                  color: '#00d4ff',
                }}
              />
              <Chip
                label={`${edgeCount}`}
                size="small"
                sx={{
                  height: '20px',
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(76, 175, 80, 0.2)',
                  color: '#4caf50',
                }}
              />
            </Box>
          </Zoom>

          {/* 控制按钮 */}
          <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
            {/* 统计信息开关 */}
            <Tooltip title={showStats ? '隐藏统计' : '显示统计'} arrow>
              <IconButton
                size="small"
                onClick={() => setShowStats(!showStats)}
                sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
              >
                {showStats ? <HideIcon /> : <ShowIcon />}
              </IconButton>
            </Tooltip>

            {/* 全屏切换 */}
            <Tooltip title={isFullscreen ? '退出全屏' : '全屏模式'} arrow>
              <IconButton
                size="small"
                onClick={handleFullscreen}
                sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
              >
                {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Paper>

        {/* 移动端优化提示 */}
        {isMobile && nodeCount === 0 && (
          <Paper
            sx={{
              position: 'absolute',
              bottom: 80,
              left: 16,
              right: 16,
              zIndex: 1000,
              p: 2,
              background: 'rgba(26, 31, 46, 0.9)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              borderRadius: 2,
              textAlign: 'center',
            }}
          >
            <Typography variant="body2" sx={{ color: 'white', mb: 1 }}>
              🚀 开始构建您的智能体工作流
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              点击右下角的 + 按钮添加组件
            </Typography>
          </Paper>
        )}

        {/* 桌面端快捷提示 */}
        {isDesktop && nodeCount === 0 && !sidebarOpen && (
          <Paper
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 1000,
              p: 3,
              background: 'rgba(26, 31, 46, 0.9)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              borderRadius: 2,
              textAlign: 'center',
              maxWidth: 400,
            }}
          >
            <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
              🎯 智能体工作流编辑器
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 2 }}>
              点击左上角的工作流图标打开组件库，开始构建您的智能体工作流
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.6)' }}>
              提示：您可以拖拽组件到画布上，然后连接它们创建复杂的工作流
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );
};

export default ResponsiveWorkflowContainer;