/**
 * 用户管理页面 - 管理员功能
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Alert,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Grid,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Visibility as ViewIcon,
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { AuthManager } from '../services/authApi';
import type { UserInfo } from '../types/auth';

interface UserListItem {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  tenant_id: number;
  tenant_name: string;
  knowledge_bases_count: number;
  documents_count: number;
  created_at: string;
  last_login_at?: string;
}

interface UserStats {
  total_users: number;
  active_users: number;
  admin_users: number;
  new_users_this_month: number;
}

const UserManagement: React.FC = () => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // 对话框状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: '',
    email: '',
    role: '',
    is_active: true,
  });

  const authManager = AuthManager.getInstance();
  const currentUser = authManager.getCurrentUser();

  useEffect(() => {
    loadUsers();
    loadStats();
  }, [page, rowsPerPage, searchTerm, roleFilter, statusFilter]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        skip: (page * rowsPerPage).toString(),
        limit: rowsPerPage.toString(),
      });
      
      if (searchTerm) params.append('search', searchTerm);
      if (roleFilter) params.append('role', roleFilter);
      if (statusFilter) params.append('is_active', statusFilter);

      const response = await fetch(`/api/v1/users?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load users');
      }

      const data = await response.json();
      setUsers(data);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch('/api/v1/users/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStats({
          total_users: data.total_users,
          active_users: data.active_users,
          admin_users: data.admin_users,
          new_users_this_month: data.new_users_this_month,
        });
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleEditUser = (user: UserListItem) => {
    setSelectedUser(user);
    setEditForm({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteUser = (user: UserListItem) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const handleSaveUser = async () => {
    if (!selectedUser) return;

    try {
      const response = await fetch(`/api/v1/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(editForm),
      });

      if (!response.ok) {
        throw new Error('Failed to update user');
      }

      setEditDialogOpen(false);
      loadUsers();
    } catch (error: any) {
      setError(error.message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedUser) return;

    try {
      const response = await fetch(`/api/v1/users/${selectedUser.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete user');
      }

      setDeleteDialogOpen(false);
      loadUsers();
    } catch (error: any) {
      setError(error.message);
    }
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

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        {t('userManagement.title')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* 统计卡片 */}
      {stats && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  {t('userManagement.stats.totalUsers')}
                </Typography>
                <Typography variant="h5" component="div">
                  {stats.total_users}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  {t('userManagement.stats.activeUsers')}
                </Typography>
                <Typography variant="h5" component="div">
                  {stats.active_users}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  {t('userManagement.stats.adminUsers')}
                </Typography>
                <Typography variant="h5" component="div">
                  {stats.admin_users}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  {t('userManagement.stats.newThisMonth')}
                </Typography>
                <Typography variant="h5" component="div">
                  {stats.new_users_this_month}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* 搜索和过滤 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label={t('userManagement.search.placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('userManagement.search.hint')}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>{t('userManagement.filters.role')}</InputLabel>
              <Select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                label={t('userManagement.filters.role')}
              >
                <MenuItem value="">{t('userManagement.filters.all')}</MenuItem>
                <MenuItem value="super_admin">{t('nav.roles.superAdmin')}</MenuItem>
                <MenuItem value="tenant_admin">{t('nav.roles.tenantAdmin')}</MenuItem>
                <MenuItem value="user">{t('nav.roles.user')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>{t('userManagement.filters.status')}</InputLabel>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                label={t('userManagement.filters.status')}
              >
                <MenuItem value="">{t('userManagement.filters.all')}</MenuItem>
                <MenuItem value="true">{t('userManagement.filters.active')}</MenuItem>
                <MenuItem value="false">{t('userManagement.filters.disabled')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {/* TODO: 实现添加用户 */}}
            >
              {t('userManagement.actions.addUser')}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* 用户表格 */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('userManagement.table.username')}</TableCell>
              <TableCell>{t('userManagement.table.email')}</TableCell>
              <TableCell>{t('userManagement.table.fullName')}</TableCell>
              <TableCell>{t('userManagement.table.role')}</TableCell>
              <TableCell>{t('userManagement.table.status')}</TableCell>
              <TableCell>{t('userManagement.table.tenant')}</TableCell>
              <TableCell>{t('userManagement.table.knowledgeBases')}</TableCell>
              <TableCell>{t('userManagement.table.documents')}</TableCell>
              <TableCell>{t('userManagement.table.createdAt')}</TableCell>
              <TableCell>{t('userManagement.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.username}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.full_name}</TableCell>
                <TableCell>
                  <Chip
                    label={getRoleLabel(user.role)}
                    color={getRoleColor(user.role) as any}
                    size="small"
                    icon={user.role.includes('admin') ? <AdminIcon /> : undefined}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.is_active ? t('userManagement.filters.active') : t('userManagement.filters.disabled')}
                    color={user.is_active ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>{user.tenant_name}</TableCell>
                <TableCell>{user.knowledge_bases_count}</TableCell>
                <TableCell>{user.documents_count}</TableCell>
                <TableCell>
                  {new Date(user.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    onClick={() => handleEditUser(user)}
                    disabled={
                      (user.role === 'super_admin' && currentUser?.role !== 'super_admin') ||
                      (user.role === 'tenant_admin' && currentUser?.role === 'tenant_admin' && user.id !== currentUser?.id)
                    }
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteUser(user)}
                    disabled={
                      user.id === currentUser?.id ||
                      (user.role === 'super_admin' && currentUser?.role !== 'super_admin') ||
                      (user.role === 'tenant_admin' && currentUser?.role === 'tenant_admin' && user.id !== currentUser?.id)
                    }
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          rowsPerPageOptions={[10, 25, 50]}
          component="div"
          count={-1} // 未知总数
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </TableContainer>

      {/* 编辑用户对话框 */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('userManagement.dialog.editUser')}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={t('userManagement.dialog.fullName')}
                value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={t('userManagement.dialog.email')}
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>{t('userManagement.dialog.role')}</InputLabel>
                <Select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  label={t('userManagement.dialog.role')}
                  disabled={selectedUser?.role === 'super_admin' && currentUser?.role !== 'super_admin'}
                >
                  <MenuItem value="user">{t('nav.roles.user')}</MenuItem>
                  {(currentUser?.role === 'super_admin' || currentUser?.role === 'tenant_admin') && (
                    <MenuItem value="tenant_admin">{t('nav.roles.tenantAdmin')}</MenuItem>
                  )}
                  {currentUser?.role === 'super_admin' && (
                    <MenuItem value="super_admin">{t('nav.roles.superAdmin')}</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                  />
                }
                label={t('userManagement.dialog.accountStatus')}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>{t('userManagement.actions.cancel')}</Button>
          <Button onClick={handleSaveUser} variant="contained">{t('userManagement.actions.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('userManagement.dialog.confirmDelete')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('userManagement.dialog.deleteMessage', { username: selectedUser?.username })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('userManagement.actions.cancel')}</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            {t('userManagement.actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserManagement;