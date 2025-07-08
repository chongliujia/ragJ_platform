import React, { useState, useEffect } from 'react';
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
  Avatar,
  Menu,
  MenuItem,
  Chip,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Storage as StorageIcon,
  Description as DocumentIcon,
  Chat as ChatIcon,
  Settings as SettingsIcon,
  SmartToy as BotIcon,
  BugReport as TestIcon,
  People as UsersIcon,
  Business as BusinessIcon,
  Security as PermissionsIcon,
  AccountCircle as AccountIcon,
  Logout as LogoutIcon,
  ExpandLess,
  ExpandMore,
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import LanguageSwitcher from './LanguageSwitcher';
import { AuthManager } from '../services/authApi';
import { usePermissions } from '../hooks/usePermissions';
import type { UserInfo } from '../types/auth';

const drawerWidth = 240;

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  
  const authManager = AuthManager.getInstance();
  const permissions = usePermissions();

  useEffect(() => {
    const currentUser = authManager.getCurrentUser();
    setUser(currentUser);
  }, []);

  const menuItems = [
    { text: t('nav.dashboard'), icon: <DashboardIcon />, path: '/' },
    { text: t('nav.knowledgeBases'), icon: <StorageIcon />, path: '/knowledge-bases' },
    { text: t('nav.documents'), icon: <DocumentIcon />, path: '/documents' },
    { text: t('nav.chat'), icon: <ChatIcon />, path: '/chat' },
    { text: t('nav.settings'), icon: <SettingsIcon />, path: '/settings' },
    { text: '连接测试', icon: <TestIcon />, path: '/test' },
  ];

  const adminMenuItems = [
    { text: '用户管理', icon: <UsersIcon />, path: '/users', role: 'admin' },
    { text: '租户管理', icon: <BusinessIcon />, path: '/tenants', role: 'super_admin' },
    { text: '权限管理', icon: <PermissionsIcon />, path: '/permissions', role: 'super_admin' },
  ];

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleLogout = async () => {
    await authManager.logout();
    navigate('/login');
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'super_admin':
        return 'error';
      case 'admin':
        return 'warning';
      case 'user':
        return 'primary';
      case 'guest':
        return 'default';
      default:
        return 'default';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'super_admin':
        return '超级管理员';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      case 'guest':
        return '访客';
      default:
        return role;
    }
  };

  const canAccessAdminMenu = () => {
    return permissions.isAdmin;
  };

  const canAccessMenuItem = (requiredRole: string) => {
    return permissions.hasRole(requiredRole);
  };

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
        {/* 主菜单项 */}
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

        {/* 管理员菜单 */}
        {canAccessAdminMenu() && (
          <>
            <Divider sx={{ my: 1, borderColor: '#334155' }} />
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                sx={{
                  mx: 1,
                  mb: 0.5,
                  borderRadius: 1,
                  '&:hover': {
                    backgroundColor: '#334155',
                  },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                  <AdminIcon />
                </ListItemIcon>
                <ListItemText 
                  primary="管理功能"
                  sx={{ 
                    '& .MuiListItemText-primary': { 
                      fontSize: '0.9rem',
                      fontWeight: 500,
                    } 
                  }}
                />
                {adminMenuOpen ? <ExpandLess /> : <ExpandMore />}
              </ListItemButton>
            </ListItem>
            <Collapse in={adminMenuOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                {adminMenuItems.map((item) => (
                  canAccessMenuItem(item.role) && (
                    <ListItem key={item.text} disablePadding>
                      <ListItemButton
                        onClick={() => navigate(item.path)}
                        sx={{
                          mx: 2,
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
                              fontSize: '0.85rem',
                              fontWeight: location.pathname === item.path ? 600 : 400,
                            } 
                          }}
                        />
                      </ListItemButton>
                    </ListItem>
                  )
                ))}
              </List>
            </Collapse>
          </>
        )}
      </List>

      {/* 用户信息和语言切换 */}
      <Box sx={{ borderTop: '1px solid #334155' }}>
        {/* 用户信息 */}
        {user && (
          <Box sx={{ p: 2 }}>
            <ListItemButton
              onClick={handleUserMenuOpen}
              sx={{
                borderRadius: 1,
                '&:hover': {
                  backgroundColor: '#334155',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Avatar sx={{ width: 32, height: 32, bgcolor: '#3b82f6' }}>
                  {user.username.charAt(0).toUpperCase()}
                </Avatar>
              </ListItemIcon>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{ 
                    color: 'white', 
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.full_name || user.username}
                </Typography>
                <Chip
                  label={getRoleLabel(user.role)}
                  color={getRoleColor(user.role) as any}
                  size="small"
                  sx={{ fontSize: '0.7rem', height: 16 }}
                />
              </Box>
            </ListItemButton>
            
            <Menu
              anchorEl={userMenuAnchor}
              open={Boolean(userMenuAnchor)}
              onClose={handleUserMenuClose}
              anchorOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
              }}
            >
              <MenuItem onClick={() => { navigate('/settings'); handleUserMenuClose(); }}>
                <ListItemIcon>
                  <AccountIcon fontSize="small" />
                </ListItemIcon>
                个人设置
              </MenuItem>
              <MenuItem onClick={handleLogout}>
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                退出登录
              </MenuItem>
            </Menu>
          </Box>
        )}
        
        {/* 语言切换 */}
        <Box sx={{ p: 2, pt: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <LanguageSwitcher />
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
};

export default Sidebar; 