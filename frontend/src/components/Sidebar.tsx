import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
  Divider,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Storage as StorageIcon,
  Description as DocumentIcon,
  Chat as ChatIcon,
  Settings as SettingsIcon,
  SmartToy as BotIcon,
  BugReport as TestIcon,
} from '@mui/icons-material';
import LanguageSwitcher from './LanguageSwitcher';

const drawerWidth = 240;

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const menuItems = [
    { text: t('nav.dashboard'), icon: <DashboardIcon />, path: '/' },
    { text: t('nav.knowledgeBases'), icon: <StorageIcon />, path: '/knowledge-bases' },
    { text: t('nav.documents'), icon: <DocumentIcon />, path: '/documents' },
    { text: t('nav.chat'), icon: <ChatIcon />, path: '/chat' },
    { text: t('nav.settings'), icon: <SettingsIcon />, path: '/settings' },
    { text: '连接测试', icon: <TestIcon />, path: '/test' },
  ];

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          backgroundColor: '#1e293b',
          color: 'white',
        },
      }}
    >
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
          <BotIcon sx={{ fontSize: 32, color: '#3b82f6', mr: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'white' }}>
            {t('nav.title')}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ color: '#94a3b8' }}>
          {t('nav.subtitle')}
        </Typography>
      </Box>
      
      <Divider sx={{ borderColor: '#334155' }} />
      
      <List sx={{ pt: 2, flex: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              onClick={() => navigate(item.path)}
              sx={{
                mx: 1,
                mb: 0.5,
                borderRadius: 1,
                backgroundColor: location.pathname === item.path ? '#3b82f6' : 'transparent',
                '&:hover': {
                  backgroundColor: location.pathname === item.path ? '#2563eb' : '#334155',
                },
              }}
            >
              <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={item.text}
                sx={{ 
                  '& .MuiListItemText-primary': { 
                    fontSize: '0.9rem',
                    fontWeight: location.pathname === item.path ? 600 : 400,
                  } 
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      {/* Language Switcher at the bottom */}
      <Box sx={{ p: 2, borderTop: '1px solid #334155' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <LanguageSwitcher />
        </Box>
      </Box>
    </Drawer>
  );
};

export default Sidebar; 