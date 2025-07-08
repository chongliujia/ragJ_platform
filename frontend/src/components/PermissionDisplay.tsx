/**
 * 权限展示组件 - 显示当前用户的权限信息
 */

import React from 'react';
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
  const permissions = usePermissions();

  if (!permissions.user) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          未登录用户
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

  const permissionChecks = [
    { label: '查看公共内容', key: 'view_public_content' },
    { label: '管理个人数据', key: 'manage_own_data' },
    { label: '聊天访问', key: 'chat_access' },
    { label: '上传文档', key: 'upload_documents' },
    { label: '创建知识库', key: 'create_knowledge_bases' },
    { label: '管理用户', key: 'manage_users' },
    { label: '查看分析', key: 'view_analytics' },
    { label: '管理租户数据', key: 'manage_tenant_data' },
  ];

  const roleCapabilities = [
    { label: '管理员权限', value: permissions.isAdmin },
    { label: '超级管理员权限', value: permissions.isSuperAdmin },
    { label: '用户管理权限', value: permissions.canManageUsers },
    { label: '租户管理权限', value: permissions.canManageTenants },
    { label: '权限管理权限', value: permissions.canManagePermissions },
    { label: '查看分析权限', value: permissions.canViewAnalytics },
    { label: '系统管理权限', value: permissions.canManageSystem },
  ];

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* 用户基本信息 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PersonIcon />
          用户信息
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item>
            {getRoleIcon(permissions.user.role)}
          </Grid>
          <Grid item>
            <Typography variant="h6">
              {permissions.user.full_name || permissions.user.username}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {permissions.user.email}
            </Typography>
          </Grid>
          <Grid item>
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
          角色能力
        </Typography>
        <Grid container spacing={1}>
          {roleCapabilities.map((capability) => (
            <Grid item xs={12} sm={6} md={4} key={capability.label}>
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
          具体权限
        </Typography>
        <List dense>
          {permissionChecks.map((permission, index) => {
            const hasPermission = permissions.hasPermission(permission.key);
            return (
              <React.Fragment key={permission.key}>
                <ListItem>
                  <ListItemIcon>
                    {hasPermission ? (
                      <CheckIcon color="success" />
                    ) : (
                      <CloseIcon color="disabled" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={permission.label}
                    secondary={permission.key}
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
            超级管理员拥有系统所有权限，包括上述列表中未显示的权限。
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default PermissionDisplay;