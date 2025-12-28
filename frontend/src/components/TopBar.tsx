import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  Button,
  Menu,
  MenuItem,
  Avatar,
  Chip,
  LinearProgress,
  Tooltip,
  useMediaQuery,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  SmartToy as BotIcon,
  Settings as SettingsIcon,
  AccountTree as WorkflowIcon,
  Logout as LogoutIcon,
  ExpandMore as ExpandIcon,
  AdminPanelSettings as AdminIcon,
  StopCircle as StopIcon,
} from '@mui/icons-material';
import LanguageSwitcher from './LanguageSwitcher';
import { TeamSelector } from './TeamSelector';
import { AuthManager } from '../services/authApi';
import { usePermissions } from '../hooks/usePermissions';
import type { UserInfo } from '../types/auth';
import { mainNavItems, workflowNavItems, adminNavItems } from '../config/navConfig';
import { knowledgeBaseApi } from '../services/api';
import { SEMANTIC_DISCOVERY_TRACKER_KEY } from '../constants/storage';
import { alpha, useTheme } from '@mui/material/styles';

interface DiscoveryTracker {
  kbId: string;
  kbName?: string;
}

interface DiscoveryProgress {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  current?: number;
  total?: number;
  current_chunks?: number;
  total_chunks?: number;
  processed_chunks_total?: number;
  planned_chunks_total?: number;
  document_label?: string;
  cancel_requested?: boolean;
}

const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const theme = useTheme();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [discoveryTracker, setDiscoveryTracker] = useState<DiscoveryTracker | null>(null);
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress | null>(null);
  const [isCancellingDiscovery, setIsCancellingDiscovery] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);
  const [workflowMenuAnchor, setWorkflowMenuAnchor] = useState<null | HTMLElement>(null);
  const [adminMenuAnchor, setAdminMenuAnchor] = useState<null | HTMLElement>(null);
  const isMobile = useMediaQuery('(max-width:768px)');
  
  const authManager = AuthManager.getInstance();
  const permissions = usePermissions();

  useEffect(() => {
    const currentUser = authManager.getCurrentUser();
    setUser(currentUser);
  }, []);

  const loadDiscoveryTracker = useCallback(() => {
    const raw = localStorage.getItem(SEMANTIC_DISCOVERY_TRACKER_KEY);
    if (!raw) {
      setDiscoveryTracker(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as DiscoveryTracker;
      if (parsed?.kbId) {
        setDiscoveryTracker({ kbId: String(parsed.kbId), kbName: parsed.kbName });
      } else {
        setDiscoveryTracker(null);
      }
    } catch {
      setDiscoveryTracker(null);
    }
  }, []);

  useEffect(() => {
    const handleUpdate = () => loadDiscoveryTracker();
    handleUpdate();
    window.addEventListener('semanticDiscoveryUpdated', handleUpdate);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SEMANTIC_DISCOVERY_TRACKER_KEY) {
        loadDiscoveryTracker();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('semanticDiscoveryUpdated', handleUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, [loadDiscoveryTracker]);

  useEffect(() => {
    if (!discoveryTracker?.kbId) {
      setDiscoveryProgress(null);
      return;
    }
    let cancelled = false;
    const fetchProgress = async () => {
      try {
        const response = await knowledgeBaseApi.getSemanticDiscoveryProgress(discoveryTracker.kbId);
        const data = response.data as DiscoveryProgress;
        if (cancelled) return;
        if (data && typeof data === 'object') {
          setDiscoveryProgress(data);
          if (data.status !== 'running') {
            localStorage.removeItem(SEMANTIC_DISCOVERY_TRACKER_KEY);
            window.dispatchEvent(new Event('semanticDiscoveryUpdated'));
          }
        }
      } catch {
        return;
      }
    };
    fetchProgress();
    const timer = window.setInterval(fetchProgress, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [discoveryTracker?.kbId]);

  const handleCancelDiscovery = useCallback(
    async (event?: React.MouseEvent) => {
      event?.stopPropagation();
      if (!discoveryTracker?.kbId || isCancellingDiscovery) return;
      setIsCancellingDiscovery(true);
      try {
        await knowledgeBaseApi.cancelSemanticDiscovery(discoveryTracker.kbId);
        localStorage.removeItem(SEMANTIC_DISCOVERY_TRACKER_KEY);
        window.dispatchEvent(new Event('semanticDiscoveryUpdated'));
        setDiscoveryProgress((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
      } catch (error) {
        console.error('Cancel discovery error:', error);
      } finally {
        setIsCancellingDiscovery(false);
      }
    },
    [discoveryTracker?.kbId, isCancellingDiscovery]
  );

  const menuItems = mainNavItems.filter(i => i.showInTopBar && (!i.requiredRole || permissions.hasRole(i.requiredRole)));
  const workflowMenuItems = workflowNavItems.filter(i => i.showInTopBar && (!i.requiredRole || permissions.hasRole(i.requiredRole)));
  const adminMenuItems = adminNavItems.filter(i => i.showInTopBar);

  const handleLogout = () => {
    authManager.logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  const visibleAdminItems = adminMenuItems.filter(item => !item.requiredRole || permissions.hasRole(item.requiredRole));
  const shouldShowAdminMenu = visibleAdminItems.length > 0;

  const activeBg = alpha(theme.palette.primary.main, 0.1);
  const activeBorder = alpha(theme.palette.primary.main, 0.3);
  const hoverBg = alpha(theme.palette.primary.main, 0.1);

  const discoveryTotal = discoveryProgress?.total ?? 0;
  const discoveryCurrent = discoveryProgress?.current ?? 0;
  const discoveryChunkTotal = discoveryProgress?.total_chunks ?? 0;
  const discoveryChunkCurrent = discoveryProgress?.current_chunks ?? 0;
  const discoveryPlannedChunksTotal = discoveryProgress?.planned_chunks_total ?? 0;
  const discoveryProcessedChunksTotal = discoveryProgress?.processed_chunks_total ?? 0;
  const hasChunkTotals = discoveryPlannedChunksTotal > 0;
  const chunkTotal = hasChunkTotals ? discoveryPlannedChunksTotal : discoveryChunkTotal;
  const chunkCurrent = hasChunkTotals ? discoveryProcessedChunksTotal : discoveryChunkCurrent;
  const hasChunkProgress = chunkTotal > 0;
  const discoveryPercent = hasChunkProgress
    ? Math.min(100, Math.round((chunkCurrent / chunkTotal) * 100))
    : discoveryTotal > 0
      ? Math.min(100, Math.round((discoveryCurrent / discoveryTotal) * 100))
      : 0;
  const discoveryLabel = hasChunkProgress
    ? t('topBar.discoveryProgressChunks', {
        current: chunkCurrent,
        total: chunkTotal,
      })
    : t('topBar.discoveryProgressDocs', {
        current: discoveryCurrent,
        total: discoveryTotal,
      });
  const discoveryDocLabel = (discoveryProgress?.document_label || '').trim();
  const discoveryTooltip = discoveryDocLabel
    ? `${discoveryLabel} - ${t('topBar.discoveryProgressDocLabel', { doc: discoveryDocLabel })}`
    : discoveryLabel;
  const discoveryCancelRequested = Boolean(discoveryProgress?.cancel_requested);
  const discoveryTitle = discoveryTracker
    ? discoveryPercent > 0
      ? t('topBar.discoveryProgressShort', {
          kb: discoveryTracker.kbName || discoveryTracker.kbId,
          percent: discoveryPercent,
        })
      : t('topBar.discoveryProgressPreparing', {
          kb: discoveryTracker.kbName || discoveryTracker.kbId,
        })
    : '';
  const showDiscoveryProgress = Boolean(discoveryTracker);

  const NavButton: React.FC<{ 
    text: string; 
    icon: React.ReactNode; 
    path: string; 
    onClick?: () => void;
  }> = ({ text, icon, path, onClick }) => (
    <Button
      startIcon={icon}
      onClick={onClick || (() => navigate(path))}
      sx={{
        color: isActive(path) ? theme.palette.primary.main : alpha(theme.palette.common.white, 0.7),
        backgroundColor: isActive(path) ? activeBg : 'transparent',
        border: isActive(path) ? `1px solid ${activeBorder}` : '1px solid transparent',
        borderRadius: 2,
        px: isMobile ? 1 : 2,
        py: 1,
        mx: 0.5,
        fontSize: isMobile ? '0.65rem' : '0.75rem',
        fontWeight: 600,
        textTransform: 'none',
        transition: 'all 0.2s ease',
        '&:hover': {
          backgroundColor: hoverBg,
          borderColor: activeBorder,
          color: theme.palette.primary.main,
          transform: 'translateY(-1px)',
        },
      }}
    >
      {isMobile ? '' : text}
    </Button>
  );

  return (
    <AppBar
      position="sticky"
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
        minHeight: '64px !important',
        px: { xs: 2, md: 3 },
        gap: 2,
      }}>
        {/* 左侧：Logo和标题 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
          <Box
            sx={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              mr: 2,
              '&::before': {
                content: '""',
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
              fontSize: 32, 
              color: '#00d4ff',
              filter: 'drop-shadow(0 0 8px rgba(0, 212, 255, 0.6))',
            }} />
          </Box>
          <Typography variant="h6" sx={{ 
            fontWeight: 'bold', 
            color: 'white',
            fontFamily: 'Inter, sans-serif',
            fontSize: { xs: '1rem', md: '1.25rem' },
            textShadow: '0 0 15px rgba(0, 212, 255, 0.4)',
            background: 'linear-gradient(45deg, #ffffff, #00d4ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            display: { xs: 'none', sm: 'block' },
          }}>
            {t('nav.title')}
          </Typography>
        </Box>

        {/* 中间：导航菜单 */}
        <Box sx={{ 
          flexGrow: 1, 
          display: 'flex', 
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          overflow: 'auto',
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}>
          {!isMobile && menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavButton
                key={item.key}
                text={t(item.translationKey)}
                icon={<Icon />}
                path={item.path}
              />
            );
          })}

          {/* 智能工作流菜单 */}
          <Button
            startIcon={<WorkflowIcon />}
            endIcon={<ExpandIcon />}
            onClick={(e) => setWorkflowMenuAnchor(e.currentTarget)}
            sx={{
              color: location.pathname.startsWith('/workflows') ? theme.palette.primary.main : alpha(theme.palette.common.white, 0.7),
              backgroundColor: location.pathname.startsWith('/workflows') ? activeBg : 'transparent',
              border: location.pathname.startsWith('/workflows') ? `1px solid ${activeBorder}` : '1px solid transparent',
              borderRadius: 2,
              px: isMobile ? 1 : 2,
              py: 1,
              mx: 0.5,
              fontSize: isMobile ? '0.65rem' : '0.75rem',
              fontWeight: 600,
              textTransform: 'none',
              transition: 'all 0.2s ease',
              '&:hover': {
                backgroundColor: hoverBg,
                borderColor: activeBorder,
                color: theme.palette.primary.main,
                transform: 'translateY(-1px)',
              },
            }}
          >
            {isMobile ? '' : t('nav.workflows')}
          </Button>

          {/* 管理功能菜单 */}
          {shouldShowAdminMenu && (
            <Button
              startIcon={<AdminIcon />}
              endIcon={<ExpandIcon />}
              onClick={(e) => setAdminMenuAnchor(e.currentTarget)}
              sx={{
                color: alpha(theme.palette.common.white, 0.7),
                backgroundColor: 'transparent',
                border: '1px solid transparent',
                borderRadius: 2,
                px: isMobile ? 1 : 2,
                py: 1,
                mx: 0.5,
                fontSize: isMobile ? '0.65rem' : '0.75rem',
                fontWeight: 600,
                textTransform: 'none',
                transition: 'all 0.2s ease',
                '&:hover': {
                  backgroundColor: hoverBg,
                  borderColor: activeBorder,
                  color: theme.palette.primary.main,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              {isMobile ? '' : t('nav.adminFeatures')}
            </Button>
          )}
        </Box>

        {/* 右侧：设置、团队选择器、用户菜单 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {showDiscoveryProgress && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Tooltip title={discoveryTooltip}>
                <Box
                  onClick={() => navigate(`/knowledge-bases/${discoveryTracker?.kbId}/semantic`)}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    px: 1,
                    py: 0.5,
                    borderRadius: 1.5,
                    minWidth: isMobile ? 100 : 160,
                    cursor: 'pointer',
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
                    backgroundColor: alpha(theme.palette.primary.main, 0.08),
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.16),
                    },
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: alpha(theme.palette.common.white, 0.85),
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      maxWidth: isMobile ? 90 : 140,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {discoveryTitle}
                  </Typography>
                  <LinearProgress
                    variant={discoveryPercent > 0 ? 'determinate' : 'indeterminate'}
                    value={discoveryPercent}
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: alpha(theme.palette.common.white, 0.1),
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: theme.palette.primary.main,
                      },
                    }}
                  />
                </Box>
              </Tooltip>
              {discoveryProgress?.status === 'running' && (
                <Tooltip
                  title={
                    isCancellingDiscovery || discoveryCancelRequested
                      ? t('topBar.discoveryCancelling')
                      : t('topBar.discoveryCancel')
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleCancelDiscovery}
                      disabled={isCancellingDiscovery || discoveryCancelRequested}
                      sx={{
                        color: theme.palette.error.main,
                        border: `1px solid ${alpha(theme.palette.error.main, 0.35)}`,
                        backgroundColor: alpha(theme.palette.error.main, 0.12),
                        '&:hover': {
                          backgroundColor: alpha(theme.palette.error.main, 0.2),
                        },
                      }}
                    >
                      <StopIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Box>
          )}
          {/* 设置按钮 */}
          <IconButton
            onClick={() => navigate('/settings')}
            sx={{
              color: isActive('/settings') ? theme.palette.primary.main : alpha(theme.palette.common.white, 0.7),
              '&:hover': {
                backgroundColor: hoverBg,
                color: theme.palette.primary.main,
              },
            }}
          >
            <SettingsIcon />
          </IconButton>

          {/* 语言切换器 */}
          <LanguageSwitcher />

          {/* 团队选择器 */}
          {!isMobile && <TeamSelector compact />}

          {/* 用户菜单 */}
          <IconButton
            onClick={(e) => setUserMenuAnchor(e.currentTarget)}
              sx={{
                p: 0.5,
                border: '2px solid transparent',
                '&:hover': {
                borderColor: alpha(theme.palette.primary.main, 0.5),
                backgroundColor: hoverBg,
                },
              }}
            >
              <Avatar
                sx={{
                  width: 36,
                  height: 36,
                  bgcolor: 'primary.main',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                }}
              >
	              {user?.full_name?.charAt(0) || user?.username?.charAt(0) || user?.email?.charAt(0) || 'U'}
	            </Avatar>
	          </IconButton>
        </Box>

        {/* 工作流菜单 */}
        <Menu
          anchorEl={workflowMenuAnchor}
          open={Boolean(workflowMenuAnchor)}
          onClose={() => setWorkflowMenuAnchor(null)}
          PaperProps={{
            sx: {
              backgroundColor: 'rgba(26, 31, 46, 0.95)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              mt: 1,
            },
          }}
        >
	          {workflowMenuItems.map((item) => (
	            <MenuItem
	              key={item.key}
	              onClick={() => {
	                navigate(item.path);
	                setWorkflowMenuAnchor(null);
	              }}
              sx={{
                color: 'white',
                '&:hover': {
                  backgroundColor: 'rgba(0, 212, 255, 0.1)',
                },
	              }}
	            >
	              <ListItemIcon sx={{ color: theme.palette.primary.main }}>
	                {React.createElement(item.icon)}
	              </ListItemIcon>
	              <ListItemText>{t(item.translationKey)}</ListItemText>
	            </MenuItem>
	          ))}
	        </Menu>

        {/* 管理功能菜单 */}
        <Menu
          anchorEl={adminMenuAnchor}
          open={Boolean(adminMenuAnchor)}
          onClose={() => setAdminMenuAnchor(null)}
          PaperProps={{
            sx: {
              backgroundColor: 'rgba(26, 31, 46, 0.95)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              mt: 1,
            },
          }}
        >
	          {visibleAdminItems.map((item) => (
	            <MenuItem
	              key={item.key}
	              onClick={() => {
	                navigate(item.path);
	                setAdminMenuAnchor(null);
	              }}
              sx={{
                color: 'white',
                '&:hover': {
                  backgroundColor: 'rgba(0, 212, 255, 0.1)',
                },
	              }}
	            >
	              <ListItemIcon sx={{ color: theme.palette.primary.main }}>
	                {React.createElement(item.icon)}
	              </ListItemIcon>
	              <ListItemText>{t(item.translationKey)}</ListItemText>
	            </MenuItem>
	          ))}
	        </Menu>

        {/* 用户菜单 */}
        <Menu
          anchorEl={userMenuAnchor}
          open={Boolean(userMenuAnchor)}
          onClose={() => setUserMenuAnchor(null)}
          PaperProps={{
            sx: {
              backgroundColor: 'rgba(26, 31, 46, 0.95)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              mt: 1,
              minWidth: 200,
            },
          }}
        >
          <Box sx={{ p: 2, borderBottom: '1px solid rgba(0, 212, 255, 0.2)' }}>
            <Typography variant="subtitle1" sx={{ color: 'white', fontWeight: 600 }}>
	              {user?.full_name || user?.username || user?.email}
	            </Typography>
            {user?.role && (
              <Chip
                label={
                  user.role === 'super_admin'
                    ? t('topBar.roles.superAdmin')
                    : user.role === 'tenant_admin'
                      ? t('topBar.roles.tenantAdmin')
                      : t('topBar.roles.member')
                }
                size="small"
                sx={{
                  mt: 1,
                  backgroundColor: 'rgba(0, 212, 255, 0.2)',
                  color: '#00d4ff',
                  fontSize: '0.75rem',
                }}
              />
            )}
          </Box>
          
          <MenuItem onClick={handleLogout} sx={{ color: 'white', '&:hover': { backgroundColor: 'rgba(255, 82, 82, 0.1)' } }}>
            <ListItemIcon sx={{ color: '#ff5252' }}>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText>{t('auth.logout')}</ListItemText>
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
};

export default TopBar;
