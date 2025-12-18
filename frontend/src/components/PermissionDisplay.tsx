/**
 * 权限展示组件 - 显示当前用户的权限信息
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  Person as PersonIcon,
  Security as SecurityIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  AdminPanelSettings as AdminIcon,
  SupervisorAccount as SuperAdminIcon,
  Group as UserIcon,
  VisibilityOff as GuestIcon,
} from '@mui/icons-material';
import { usePermissions } from '../hooks/usePermissions';

const PermissionDisplay: React.FC = () => {
  const { t } = useTranslation();
  const permissions = usePermissions();

  if (!permissions.user) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          {t('permissionDisplay.notLoggedIn')}
        </Typography>
      </Paper>
    );
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'super_admin':
        return <SuperAdminIcon color="error" />;
      case 'admin':
        return <AdminIcon color="warning" />;
      case 'user':
        return <UserIcon color="primary" />;
      case 'guest':
        return <GuestIcon color="disabled" />;
      default:
        return <PersonIcon />;
    }
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
        return t('permissionDisplay.roles.superAdmin');
      case 'admin':
        return t('permissionDisplay.roles.admin');
      case 'user':
        return t('permissionDisplay.roles.user');
      case 'guest':
        return t('permissionDisplay.roles.guest');
      default:
        return role;
    }
  };

  const permissionChecks = [
    'view_public_content',
    'manage_own_data',
    'chat_access',
    'upload_documents',
    'create_knowledge_bases',
    'manage_users',
    'view_analytics',
    'manage_tenant_data',
  ] as const;

  const roleCapabilities = [
    { label: t('permissionDisplay.capabilities.isAdmin'), value: permissions.isAdmin },
    { label: t('permissionDisplay.capabilities.isSuperAdmin'), value: permissions.isSuperAdmin },
    { label: t('permissionDisplay.capabilities.canManageUsers'), value: permissions.canManageUsers },
    { label: t('permissionDisplay.capabilities.canManageTenants'), value: permissions.canManageTenants },
    { label: t('permissionDisplay.capabilities.canManagePermissions'), value: permissions.canManagePermissions },
    { label: t('permissionDisplay.capabilities.canViewAnalytics'), value: permissions.canViewAnalytics },
    { label: t('permissionDisplay.capabilities.canManageSystem'), value: permissions.canManageSystem },
  ];

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* 用户基本信息 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PersonIcon />
          {t('permissionDisplay.sections.userInfo')}
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid>
            {getRoleIcon(permissions.user.role)}
          </Grid>
          <Grid>
            <Typography variant="h6">
              {permissions.user.full_name || permissions.user.username}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {permissions.user.email}
            </Typography>
          </Grid>
          <Grid>
            <Chip
              label={getRoleLabel(permissions.user.role)}
              color={getRoleColor(permissions.user.role) as any}
              variant="outlined"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* 角色能力 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon />
          {t('permissionDisplay.sections.capabilities')}
        </Typography>
        <Grid container spacing={1}>
          {roleCapabilities.map((capability) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={capability.label}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {capability.value ? (
                  <CheckIcon color="success" fontSize="small" />
                ) : (
                  <CloseIcon color="disabled" fontSize="small" />
                )}
                <Typography
                  variant="body2"
                  color={capability.value ? 'text.primary' : 'text.disabled'}
                >
                  {capability.label}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* 具体权限 */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon />
          {t('permissionDisplay.sections.permissions')}
        </Typography>
        <List dense>
          {permissionChecks.map((key, index) => {
            const hasPermission = permissions.hasPermission(key);
            return (
              <React.Fragment key={key}>
                <ListItem>
                  <ListItemIcon>
                    {hasPermission ? (
                      <CheckIcon color="success" />
                    ) : (
                      <CloseIcon color="disabled" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`permissionDisplay.permissions.${key}`)}
                    secondary={key}
                    sx={{
                      '& .MuiListItemText-primary': {
                        color: hasPermission ? 'text.primary' : 'text.disabled',
                      },
                      '& .MuiListItemText-secondary': {
                        fontSize: '0.75rem',
                        color: 'text.disabled',
                      },
                    }}
                  />
                </ListItem>
                {index < permissionChecks.length - 1 && <Divider variant="inset" component="li" />}
              </React.Fragment>
            );
          })}
        </List>
      </Paper>

      {/* 超级管理员特殊提示 */}
      {permissions.isSuperAdmin && (
        <Paper sx={{ p: 2, mt: 3, bgcolor: 'error.50', border: '1px solid', borderColor: 'error.200' }}>
          <Typography variant="body2" color="error.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SuperAdminIcon />
            {t('permissionDisplay.superAdminHint')}
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default PermissionDisplay;
