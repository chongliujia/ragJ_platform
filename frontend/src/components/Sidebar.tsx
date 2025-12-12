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
  useMediaQuery,
  Tooltip,
} from '@mui/material';
import {
  SmartToy as BotIcon,
  AccountCircle as AccountIcon,
  Logout as LogoutIcon,
  ExpandLess,
  ExpandMore,
  AdminPanelSettings as AdminIcon,
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  AccountTree as WorkflowIcon,
} from '@mui/icons-material';
import LanguageSwitcher from './LanguageSwitcher';
import { TeamSelector } from './TeamSelector';
import { AuthManager } from '../services/authApi';
import { usePermissions } from '../hooks/usePermissions';
import type { UserInfo } from '../types/auth';
import { mainNavItems, workflowNavItems, adminNavItems } from '../config/navConfig';
import { alpha, useTheme } from '@mui/material/styles';

const drawerWidth = 240;
const collapsedWidth = 64;

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ open, onToggle }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const theme = useTheme();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width:768px)');
  
  const authManager = AuthManager.getInstance();
  const permissions = usePermissions();

  useEffect(() => {
    const currentUser = authManager.getCurrentUser();
    setUser(currentUser);
  }, []);

  const menuItems = mainNavItems.filter(i => i.showInSidebar);
  const workflowItems = workflowNavItems.filter(i => i.showInSidebar);
  const adminItems = adminNavItems.filter(i => i.showInSidebar);

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
      case 'tenant_admin':
        return 'warning';
      case 'user':
        return 'primary';
      default:
        return 'default';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'super_admin':
        return t('nav.roles.superAdmin');
      case 'tenant_admin':
        return t('nav.roles.tenantAdmin');
      case 'user':
        return t('nav.roles.user');
      default:
        return role;
    }
  };

  const canAccessMenuItem = (requiredRole?: string) => {
    if (!requiredRole) return true;
    return permissions.hasRole(requiredRole);
  };

  const visibleMenuItems = menuItems.filter(i => canAccessMenuItem(i.requiredRole));
  const visibleWorkflowItems = workflowItems.filter(i => canAccessMenuItem(i.requiredRole));
  const visibleAdminItems = adminItems.filter(i => canAccessMenuItem(i.requiredRole));
  const canAccessAdminMenu = () => visibleAdminItems.length > 0;

  const activeBg = alpha(theme.palette.primary.main, 0.2);
  const activeBgHover = alpha(theme.palette.primary.main, 0.28);
  const hoverBg = alpha(theme.palette.primary.main, 0.08);

  return (
    <Drawer
      variant={isMobile ? 'temporary' : 'permanent'}
      open={isMobile ? open : true}
      onClose={isMobile ? onToggle : undefined}
      sx={{
        width: open ? drawerWidth : collapsedWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: open ? drawerWidth : collapsedWidth,
          boxSizing: 'border-box',
          transition: 'width 0.3s ease-in-out',
          overflowX: 'hidden',
          // 确保在移动设备上侧边栏的z-index低于TopBar
          zIndex: (theme) => theme.zIndex.drawer,
          // 移动设备下的样式调整
          '@media (max-width: 768px)': {
            top: 64, // 为TopBar留出空间
            height: 'calc(100% - 64px)',
          },
        },
      }}
    >
      {/* 在折叠状态下显示切换按钮 */}
      {!isMobile && (
        <Box sx={{ display: 'flex', justifyContent: open ? 'flex-end' : 'center', p: 1 }}>
          <IconButton onClick={onToggle} sx={{ color: 'white' }}>
            {open ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
        </Box>
      )}

      <Box sx={{ p: open ? 2 : 1, textAlign: 'center', transition: 'all 0.3s ease-in-out' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
          <BotIcon sx={{ fontSize: 32, color: 'primary.main', mr: open ? 1 : 0 }} />
          {open && (
            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'white' }}>
              {t('nav.title')}
            </Typography>
          )}
        </Box>
        {open && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('nav.subtitle')}
          </Typography>
        )}
      </Box>
      
      <Divider />
      
      {/* 团队选择器 */}
      {open && (
        <Box sx={{ p: 2, pb: 1 }}>
          <TeamSelector 
            onTeamSettingsClick={() => navigate('/teams')}
            onCreateTeamClick={() => navigate('/teams')}
            onJoinTeamClick={() => navigate('/teams')}
          />
        </Box>
      )}
      
      <List sx={{ pt: open ? 1 : 2, flex: 1 }}>
        {/* 主菜单项 */}
        {visibleMenuItems.map((item) => (
          <ListItem key={item.key} disablePadding>
            <Tooltip title={!open ? t(item.translationKey) : ''} placement="right">
              <ListItemButton
                onClick={() => navigate(item.path)}
                sx={{
                  mx: 1,
                  mb: 0.5,
                  borderRadius: 1,
                  backgroundColor: location.pathname === item.path ? activeBg : 'transparent',
                  justifyContent: open ? 'initial' : 'center',
                  '&:hover': {
                    backgroundColor: location.pathname === item.path ? activeBgHover : hoverBg,
                  },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: open ? 40 : 0, justifyContent: 'center' }}>
                  {React.createElement(item.icon)}
                </ListItemIcon>
                {open && (
                  <ListItemText 
                    primary={t(item.translationKey)}
                    sx={{ 
                      '& .MuiListItemText-primary': { 
                        fontSize: '0.9rem',
                        fontWeight: location.pathname === item.path ? 600 : 400,
                      } 
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}

        {/* 工作流菜单 */}
        {open ? (
          <>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => setWorkflowMenuOpen(!workflowMenuOpen)}
                sx={{
                  mx: 1,
                  mb: 0.5,
                  borderRadius: 1,
                  backgroundColor: location.pathname.startsWith('/workflows') ? activeBg : 'transparent',
                  '&:hover': {
                    backgroundColor: location.pathname.startsWith('/workflows') ? activeBgHover : hoverBg,
                  },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                  <WorkflowIcon />
                </ListItemIcon>
                <ListItemText 
                  primary={t('nav.workflows')}
                  sx={{ 
                    '& .MuiListItemText-primary': { 
                      fontSize: '0.9rem',
                      fontWeight: location.pathname.startsWith('/workflows') ? 600 : 400,
                    } 
                  }}
                />
                {workflowMenuOpen ? <ExpandLess /> : <ExpandMore />}
              </ListItemButton>
            </ListItem>
            <Collapse in={workflowMenuOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                {visibleWorkflowItems.map((item) => (
                  <ListItem key={item.key} disablePadding>
                    <ListItemButton
                      onClick={() => navigate(item.path)}
                      sx={{
                        mx: 2,
                        mb: 0.5,
                        borderRadius: 1,
                        backgroundColor: location.pathname === item.path ? activeBg : 'transparent',
                        '&:hover': {
                          backgroundColor: location.pathname === item.path ? activeBgHover : hoverBg,
                        },
                      }}
                    >
                      <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                        {React.createElement(item.icon)}
                      </ListItemIcon>
                      <ListItemText 
                        primary={t(item.translationKey)}
                        sx={{ 
                          '& .MuiListItemText-primary': { 
                            fontSize: '0.85rem',
                            fontWeight: location.pathname === item.path ? 600 : 400,
                          } 
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Collapse>
          </>
        ) : visibleWorkflowItems.length > 0 ? (
          // 折叠状态下显示工作流图标
          <ListItem disablePadding>
            <Tooltip title={t('nav.workflows')} placement="right">
              <ListItemButton
                onClick={() => navigate('/workflows')}
              sx={{
                mx: 1,
                mb: 0.5,
                borderRadius: 1,
                backgroundColor: location.pathname.startsWith('/workflows') ? activeBg : 'transparent',
                justifyContent: 'center',
                '&:hover': {
                  backgroundColor: location.pathname.startsWith('/workflows') ? activeBgHover : hoverBg,
                },
              }}
            >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 0, justifyContent: 'center' }}>
                  <WorkflowIcon />
                </ListItemIcon>
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ) : null}

        {/* 管理员菜单 */}
        {canAccessAdminMenu() && (
          <>
            <Divider sx={{ my: 1 }} />
            {open ? (
              <>
                <ListItem disablePadding>
                  <ListItemButton
                    onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                    sx={{
                      mx: 1,
                      mb: 0.5,
                      borderRadius: 1,
                      '&:hover': {
                        backgroundColor: hoverBg,
                      },
                    }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                      <AdminIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary={t('nav.adminFeatures')}
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
                    {visibleAdminItems.map((item) => (
                        <ListItem key={item.key} disablePadding>
                          <ListItemButton
                            onClick={() => navigate(item.path)}
                            sx={{
                              mx: 2,
                              mb: 0.5,
                              borderRadius: 1,
                              backgroundColor: location.pathname === item.path ? activeBg : 'transparent',
                              '&:hover': {
                                backgroundColor: location.pathname === item.path ? activeBgHover : hoverBg,
                              },
                            }}
                          >
                            <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                              {React.createElement(item.icon)}
                            </ListItemIcon>
                            <ListItemText 
                              primary={t(item.translationKey)}
                              sx={{ 
                                '& .MuiListItemText-primary': { 
                                  fontSize: '0.85rem',
                                  fontWeight: location.pathname === item.path ? 600 : 400,
                                } 
                              }}
                            />
                          </ListItemButton>
                        </ListItem>
                    ))}
                  </List>
                </Collapse>
              </>
            ) : (
              // 折叠状态下，直接显示管理员菜单项
              visibleAdminItems.map((item) => (
                  <ListItem key={item.key} disablePadding>
                    <Tooltip title={t(item.translationKey)} placement="right">
                      <ListItemButton
                        onClick={() => navigate(item.path)}
                        sx={{
                          mx: 1,
                          mb: 0.5,
                          borderRadius: 1,
                          backgroundColor: location.pathname === item.path ? activeBg : 'transparent',
                          justifyContent: 'center',
                          '&:hover': {
                            backgroundColor: location.pathname === item.path ? activeBgHover : hoverBg,
                          },
                        }}
                      >
                        <ListItemIcon sx={{ color: 'inherit', minWidth: 0, justifyContent: 'center' }}>
                          {React.createElement(item.icon)}
                        </ListItemIcon>
                      </ListItemButton>
                    </Tooltip>
                  </ListItem>
              ))
            )}
          </>
        )}
      </List>

      {/* 用户信息和语言切换 */}
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        {/* 用户信息 */}
        {user && (
          <Box sx={{ p: open ? 2 : 1 }}>
            <Tooltip title={!open ? user.full_name || user.username : ''} placement="right">
              <ListItemButton
                onClick={handleUserMenuOpen}
                sx={{
                  borderRadius: 1,
                  justifyContent: open ? 'initial' : 'center',
                  '&:hover': {
                    backgroundColor: hoverBg,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: open ? 40 : 0, justifyContent: 'center' }}>
                  <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                    {user.username.charAt(0).toUpperCase()}
                  </Avatar>
                </ListItemIcon>
                {open && (
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
                )}
              </ListItemButton>
            </Tooltip>
            
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
                {t('nav.userSettings')}
              </MenuItem>
              <MenuItem onClick={handleLogout}>
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                {t('nav.logout')}
              </MenuItem>
            </Menu>
          </Box>
        )}
        
        {/* 语言切换 */}
        {open && (
          <Box sx={{ p: 2, pt: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <LanguageSwitcher />
            </Box>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default Sidebar;
