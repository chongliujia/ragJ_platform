/**
 * 权限管理页面 - 超级管理员功能
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Card,
  CardContent,
  CardHeader,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormGroup,
  FormControlLabel,
  Button,
  Alert,
  Divider,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Security as SecurityIcon,
  Person as PersonIcon,
  Storage as StorageIcon,
  Chat as ChatIcon,
  Settings as SettingsIcon,
  AdminPanelSettings as AdminIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import PermissionDisplay from '../components/PermissionDisplay';

interface Permission {
  id: number;
  name: string;
  display_name: string;
  description: string;
  category: string;
}

interface RolePermissions {
  role: string;
  permissions: Permission[];
}

interface PermissionsByCategory {
  [category: string]: Permission[];
}

interface TenantOverview {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  current_users: number;
  max_users: number;
  current_knowledge_bases: number;
  max_knowledge_bases: number;
}

const roles = [
  { value: 'super_admin', label: '超级管理员', color: 'error' },
  { value: 'admin', label: '管理员', color: 'warning' },
  { value: 'user', label: '用户', color: 'primary' },
  { value: 'guest', label: '访客', color: 'default' },
];

const categoryIcons: { [key: string]: React.ReactNode } = {
  system: <SecurityIcon />,
  knowledge_base: <StorageIcon />,
  document: <StorageIcon />,
  chat: <ChatIcon />,
  config: <SettingsIcon />,
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`permission-tabpanel-${index}`}
      aria-labelledby={`permission-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const PermissionManagement: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [selectedRole, setSelectedRole] = useState('user');
  const [permissions, setPermissions] = useState<PermissionsByCategory>({});
  const [rolePermissions, setRolePermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOverview[]>([]);
  
  // 租户管理对话框
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const [newTenant, setNewTenant] = useState({
    name: '',
    slug: '',
    description: '',
    max_users: 10,
    max_knowledge_bases: 5,
    max_documents: 1000,
    storage_quota_mb: 1024,
  });

  useEffect(() => {
    loadPermissions();
    loadTenants();
  }, []);

  useEffect(() => {
    if (selectedRole) {
      loadRolePermissions();
    }
  }, [selectedRole]);

  const loadPermissions = async () => {
    try {
      const response = await fetch('/api/v1/admin/permissions', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load permissions');
      }

      const data = await response.json();
      setPermissions(data.permissions);
    } catch (error: any) {
      setError(error.message);
    }
  };

  const loadRolePermissions = async () => {
    try {
      const response = await fetch(`/api/v1/admin/roles/${selectedRole}/permissions`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load role permissions');
      }

      const data = await response.json();
      setRolePermissions(data.permissions);
    } catch (error: any) {
      setError(error.message);
    }
  };

  const loadTenants = async () => {
    try {
      const response = await fetch('/api/v1/admin/tenants', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTenants(data);
      }
    } catch (error) {
      console.error('Failed to load tenants:', error);
    }
  };

  const handlePermissionChange = (permission: Permission, checked: boolean) => {
    if (checked) {
      setRolePermissions([...rolePermissions, permission]);
    } else {
      setRolePermissions(rolePermissions.filter(p => p.id !== permission.id));
    }
  };

  const handleSavePermissions = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/v1/admin/roles/${selectedRole}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({
          role: selectedRole,
          permission_names: rolePermissions.map(p => p.name),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update permissions');
      }

      setSuccess('权限更新成功！');
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async () => {
    try {
      const response = await fetch('/api/v1/admin/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(newTenant),
      });

      if (!response.ok) {
        throw new Error('Failed to create tenant');
      }

      setTenantDialogOpen(false);
      loadTenants();
      setNewTenant({
        name: '',
        slug: '',
        description: '',
        max_users: 10,
        max_knowledge_bases: 5,
        max_documents: 1000,
        storage_quota_mb: 1024,
      });
    } catch (error: any) {
      setError(error.message);
    }
  };

  const isPermissionSelected = (permission: Permission) => {
    return rolePermissions.some(p => p.id === permission.id);
  };

  const getSelectedRole = () => {
    return roles.find(r => r.value === selectedRole);
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        权限与租户管理
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <Paper sx={{ mb: 3 }}>
        <Tabs 
          value={tabValue} 
          onChange={handleTabChange}
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '1rem',
            },
          }}
        >
          <Tab 
            icon={<AdminIcon />} 
            iconPosition="start"
            label="权限管理" 
            id="permission-tab-0" 
            aria-controls="permission-tabpanel-0" 
          />
          <Tab 
            icon={<ViewIcon />} 
            iconPosition="start"
            label="我的权限" 
            id="permission-tab-1" 
            aria-controls="permission-tabpanel-1" 
          />
        </Tabs>
      </Paper>

      <TabPanel value={tabValue} index={0}>

      <Grid container spacing={3}>
        {/* 权限管理 */}
        <Grid item xs={12} lg={8}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6">角色权限管理</Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl sx={{ minWidth: 200 }}>
                  <InputLabel>选择角色</InputLabel>
                  <Select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    label="选择角色"
                  >
                    {roles.map((role) => (
                      <MenuItem key={role.value} value={role.value}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            label={role.label}
                            color={role.color as any}
                            size="small"
                            icon={role.value.includes('admin') ? <AdminIcon /> : <PersonIcon />}
                          />
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={loadRolePermissions}
                >
                  刷新
                </Button>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSavePermissions}
                  disabled={loading}
                >
                  保存权限
                </Button>
              </Box>
            </Box>

            {selectedRole && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  正在配置角色: <Chip 
                    label={getSelectedRole()?.label} 
                    color={getSelectedRole()?.color as any} 
                    size="small" 
                  />
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  已选择 {rolePermissions.length} 个权限
                </Typography>
              </Box>
            )}

            <Grid container spacing={2}>
              {Object.entries(permissions).map(([category, categoryPermissions]) => (
                <Grid item xs={12} md={6} key={category}>
                  <Card variant="outlined">
                    <CardHeader
                      avatar={categoryIcons[category] || <SettingsIcon />}
                      title={
                        <Typography variant="h6">
                          {category === 'system' && '系统权限'}
                          {category === 'knowledge_base' && '知识库权限'}
                          {category === 'document' && '文档权限'}
                          {category === 'chat' && '聊天权限'}
                          {category === 'config' && '配置权限'}
                        </Typography>
                      }
                      sx={{ pb: 1 }}
                    />
                    <CardContent sx={{ pt: 0 }}>
                      <FormGroup>
                        {categoryPermissions.map((permission) => (
                          <FormControlLabel
                            key={permission.id}
                            control={
                              <Checkbox
                                checked={isPermissionSelected(permission)}
                                onChange={(e) => handlePermissionChange(permission, e.target.checked)}
                                disabled={selectedRole === 'super_admin'} // 超级管理员权限不可修改
                              />
                            }
                            label={
                              <Box>
                                <Typography variant="body2">
                                  {permission.display_name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {permission.description}
                                </Typography>
                              </Box>
                            }
                          />
                        ))}
                      </FormGroup>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>

        {/* 租户管理 */}
        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h6">租户管理</Typography>
              <Button
                variant="contained"
                size="small"
                onClick={() => setTenantDialogOpen(true)}
              >
                添加租户
              </Button>
            </Box>

            <List>
              {tenants.map((tenant) => (
                <ListItem key={tenant.id} divider>
                  <ListItemIcon>
                    <Switch
                      checked={tenant.is_active}
                      size="small"
                      // onChange={() => toggleTenantStatus(tenant.id)}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2">{tenant.name}</Typography>
                        <Chip
                          label={tenant.is_active ? '活跃' : '禁用'}
                          color={tenant.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="caption" display="block">
                          用户: {tenant.current_users}/{tenant.max_users}
                        </Typography>
                        <Typography variant="caption" display="block">
                          知识库: {tenant.current_knowledge_bases}/{tenant.max_knowledge_bases}
                        </Typography>
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Paper>

          {/* 系统概览 */}
          <Paper sx={{ p: 3, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              系统概览
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: 'center', py: 2 }}>
                    <Typography variant="h5" color="primary">
                      {tenants.length}
                    </Typography>
                    <Typography variant="caption">
                      租户总数
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: 'center', py: 2 }}>
                    <Typography variant="h5" color="success.main">
                      {tenants.filter(t => t.is_active).length}
                    </Typography>
                    <Typography variant="caption">
                      活跃租户
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: 'center', py: 2 }}>
                    <Typography variant="h5" color="info.main">
                      {tenants.reduce((sum, t) => sum + t.current_users, 0)}
                    </Typography>
                    <Typography variant="caption">
                      总用户数
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: 'center', py: 2 }}>
                    <Typography variant="h5" color="warning.main">
                      {tenants.reduce((sum, t) => sum + t.current_knowledge_bases, 0)}
                    </Typography>
                    <Typography variant="caption">
                      知识库数
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>

      {/* 创建租户对话框 */}
      <Dialog open={tenantDialogOpen} onClose={() => setTenantDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>创建新租户</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="租户名称"
                value={newTenant.name}
                onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="租户标识符"
                value={newTenant.slug}
                onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value })}
                required
                helperText="用于URL，只能包含字母、数字和连字符"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="描述"
                value={newTenant.description}
                onChange={(e) => setNewTenant({ ...newTenant, description: e.target.value })}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="最大用户数"
                type="number"
                value={newTenant.max_users}
                onChange={(e) => setNewTenant({ ...newTenant, max_users: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="最大知识库数"
                type="number"
                value={newTenant.max_knowledge_bases}
                onChange={(e) => setNewTenant({ ...newTenant, max_knowledge_bases: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="最大文档数"
                type="number"
                value={newTenant.max_documents}
                onChange={(e) => setNewTenant({ ...newTenant, max_documents: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="存储配额(MB)"
                type="number"
                value={newTenant.storage_quota_mb}
                onChange={(e) => setNewTenant({ ...newTenant, storage_quota_mb: parseInt(e.target.value) })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTenantDialogOpen(false)}>取消</Button>
          <Button onClick={handleCreateTenant} variant="contained">创建</Button>
        </DialogActions>
      </Dialog>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <PermissionDisplay />
      </TabPanel>
    </Box>
  );
};

export default PermissionManagement;