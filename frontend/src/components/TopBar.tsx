import React from 'react';
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  useMediaQuery,
} from '@mui/material';
import {
  Menu as MenuIcon,
  SmartToy as BotIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { TeamSelector } from './TeamSelector';

interface TopBarProps {
  open: boolean;
  onToggle: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ open, onToggle }) => {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width:768px)');

  // 仅在移动设备上显示顶部导航栏
  if (!isMobile) {
    return null;
  }

  return (
    <AppBar
      position="fixed"
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 100%)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0, 212, 255, 0.3)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(0, 212, 255, 0.1) 50%, transparent 100%)',
          pointerEvents: 'none',
        },
      }}
    >
      <Toolbar sx={{ 
        position: 'relative',
        zIndex: 1,
        minHeight: 64,
        px: 2
      }}>
        <IconButton
          color="inherit"
          edge="start"
          onClick={onToggle}
          sx={{ 
            mr: 2,
            transition: 'all 0.3s ease-in-out',
            borderRadius: 2,
            '&:hover': {
              transform: 'scale(1.1)',
              background: 'rgba(0, 212, 255, 0.1)',
              boxShadow: '0 0 15px rgba(0, 212, 255, 0.3)',
            },
          }}
        >
          <MenuIcon sx={{ fontSize: 24 }} />
        </IconButton>
        
        <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
          <Box
            sx={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              mr: 2,
              '&::before': {
                content: '\"\"',
                position: 'absolute',
                width: '100%',
                height: '100%',
                background: 'radial-gradient(circle, rgba(0, 212, 255, 0.3) 0%, transparent 70%)',
                borderRadius: '50%',
                animation: 'glow 3s ease-in-out infinite alternate',
                zIndex: -1,
              },
              '@keyframes glow': {
                '0%': { 
                  transform: 'scale(0.8)',
                  opacity: 0.4,
                },
                '100%': { 
                  transform: 'scale(1.3)',
                  opacity: 0.8,
                },
              },
            }}
          >
            <BotIcon sx={{ 
              fontSize: 28, 
              color: '#00d4ff',
              filter: 'drop-shadow(0 0 8px rgba(0, 212, 255, 0.6))',
            }} />
          </Box>
          <Typography variant="h6" sx={{ 
            fontWeight: 'bold', 
            color: 'white',
            fontFamily: 'Inter, sans-serif',
            fontSize: '1.25rem',
            textShadow: '0 0 15px rgba(0, 212, 255, 0.4)',
            background: 'linear-gradient(45deg, #ffffff, #00d4ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {t('nav.title')}
          </Typography>
          
          {/* 团队选择器 - 仅在移动设备上显示紧凑版本 */}
          <Box sx={{ ml: 'auto', mr: 1 }}>
            <TeamSelector compact />
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default TopBar;