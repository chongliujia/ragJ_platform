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
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { AuthManager } from '../services/authApi';
import { systemApi } from '../services/api';

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
  const [error, setError] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState<number>(-1);
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
    // Debug: Check current user and token
    console.log('Current user:', currentUser);
    console.log('Auth token:', localStorage.getItem('auth_token'));
    
    loadUsers();
    loadStats();
  }, [page, rowsPerPage, searchTerm, roleFilter, statusFilter]);

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const params = new URLSearchParams({
        skip: (page * rowsPerPage).toString(),
        limit: rowsPerPage.toString(),
      });
      
      if (searchTerm) params.append('search', searchTerm);
      if (roleFilter) params.append('role', roleFilter);
      if (statusFilter) params.append('is_active', statusFilter);

      // Debug log
      console.log('Fetching users from:', `/api/v1/admin/users?${params}`);
      console.log('Using token:', localStorage.getItem('auth_token')?.substring(0, 20) + '...');

      const response = await fetch(`/api/v1/admin/users?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers.get('content-type'));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        
        if (response.status === 403) {
          setError('Access denied: Super admin privileges required');
        } else if (response.status === 401) {
          setError('Authentication failed: Please login again');
        } else {
          setError(`Failed to load users: ${response.status} - ${errorText.substring(0, 100)}...`);
        }
        setUsers([]);
        return;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('Non-JSON response:', responseText.substring(0, 200));
        setError('Server returned invalid response format (HTML instead of JSON)');
        setUsers([]);
        return;
      }

      const totalHeader = response.headers.get('x-total-count');
      if (totalHeader) {
        const parsed = parseInt(totalHeader, 10);
        if (!Number.isNaN(parsed)) setTotalCount(parsed);
      } else {
        setTotalCount(-1);
      }

      const data = await response.json();
      setUsers(data);
      setError(null);
    } catch (error) {
      console.error('Load users error:', error);
      setError(error instanceof Error ? error.message : 'Failed to load users');
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadStats = async () => {
    try {
      // 获取系统总数
      let totalUsers = 0;
      try {
        const sys = await systemApi.getStats();
        totalUsers = sys.data?.total_users || 0;
      } catch (e) {
        // ignore
      }

      // 额外统计（活跃/管理员/本月新增）——基于有限列表近似
      const usersResponse = await fetch('/api/v1/admin/users?limit=1000', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json',
        },
      });

      if (usersResponse.ok) {
        const contentType = usersResponse.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          setStats({ total_users: totalUsers, active_users: 0, admin_users: 0, new_users_this_month: 0 });
          return;
        }

        const userData: UserListItem[] = await usersResponse.json();
        const activeUsers = userData.filter((user) => user.is_active).length;
        const adminUsers = userData.filter((user) => user.role === 'super_admin' || user.role === 'tenant_admin').length;
        const thisMonth = new Date();
        thisMonth.setDate(1);
        const newUsersThisMonth = userData.filter((user) => new Date(user.created_at) >= thisMonth).length;

        setStats({ total_users: totalUsers || userData.length, active_users: activeUsers, admin_users: adminUsers, new_users_this_month: newUsersThisMonth });
      } else {
        setStats({ total_users: totalUsers, active_users: 0, admin_users: 0, new_users_this_month: 0 });
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
      setStats({ total_users: 0, active_users: 0, admin_users: 0, new_users_this_month: 0 });
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
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update user');
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
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete user');
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
      {stats ? (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
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
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
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
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
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
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
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
      ) : (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          {[1,2,3,4].map((i) => (
            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    &nbsp;
                  </Typography>
                  <Box sx={{ height: 28, bgcolor: 'action.hover', borderRadius: 1 }} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* 搜索和过滤 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label={t('userManagement.search.placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('userManagement.search.hint')}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
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
          <Grid size={{ xs: 12, md: 3 }}>
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
          <Grid size={{ xs: 12, md: 2 }}>
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

      {/* 移动端卡片视图 */}
      <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>
        {users.map((user) => (
          <Card key={user.id} sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant="h6" component="div" sx={{ fontWeight: 'bold' }}>
                    {user.username}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {user.email}
                  </Typography>
                  <Typography variant="body2">
                    {user.full_name}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <IconButton
                    size="small"
                    onClick={() => handleEditUser(user)}
                    disabled={
                      (user.role === 'super_admin' && currentUser?.role !== 'super_admin') ||
                      (user.role === 'tenant_admin' && currentUser?.role === 'tenant_admin' && user.id !== currentUser?.id)
                    }
                  >
                    <EditIcon fontSize="small" />
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
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip
                  label={getRoleLabel(user.role)}
                  color={getRoleColor(user.role) as 'error' | 'warning' | 'primary' | 'default'}
                  size="small"
                  icon={user.role.includes('admin') ? <AdminIcon /> : undefined}
                />
                <Chip
                  label={user.is_active ? t('userManagement.status.active') : t('userManagement.status.inactive')}
                  color={user.is_active ? 'success' : 'default'}
                  size="small"
                />
              </Box>
              <Box component="div" sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'text.secondary' }}>
                <Typography variant="body2" component="span">{user.tenant_name}</Typography>
                <Typography variant="body2" component="span">{new Date(user.created_at).toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US')}</Typography>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* 桌面端表格视图 */}
      <TableContainer component={Paper} sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 120 }}>{t('userManagement.table.username')}</TableCell>
              <TableCell sx={{ minWidth: 180 }}>{t('userManagement.table.email')}</TableCell>
              <TableCell sx={{ minWidth: 120 }}>{t('userManagement.table.fullName')}</TableCell>
              <TableCell sx={{ minWidth: 100 }}>{t('userManagement.table.role')}</TableCell>
              <TableCell sx={{ minWidth: 80 }}>{t('userManagement.table.status')}</TableCell>
              <TableCell sx={{ minWidth: 120, display: { xs: 'none', md: 'table-cell' } }}>{t('userManagement.table.tenant')}</TableCell>
              <TableCell sx={{ minWidth: 80, display: { xs: 'none', lg: 'table-cell' } }}>{t('userManagement.table.kbCount')}</TableCell>
              <TableCell sx={{ minWidth: 80, display: { xs: 'none', lg: 'table-cell' } }}>{t('userManagement.table.docCount')}</TableCell>
              <TableCell sx={{ minWidth: 100, display: { xs: 'none', md: 'table-cell' } }}>{t('userManagement.table.created')}</TableCell>
              <TableCell sx={{ minWidth: 120, position: 'sticky', right: 0, backgroundColor: 'background.paper', zIndex: 1 }}>{t('userManagement.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loadingUsers && (
              [...Array(8)].map((_, idx) => (
                <TableRow key={`skeleton-${idx}`}>
                  {Array.from({ length: 10 }).map((__, cidx) => (
                    <TableCell key={cidx}>
                      <Box sx={{ height: 18, bgcolor: 'action.hover', borderRadius: 1 }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
            {!loadingUsers && users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell sx={{ fontWeight: 'medium' }}>{user.username}</TableCell>
                <TableCell 
                  sx={{ 
                    maxWidth: 180, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={user.email}
                >
                  {user.email}
                </TableCell>
                <TableCell 
                  sx={{ 
                    maxWidth: 120, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={user.full_name}
                >
                  {user.full_name}
                </TableCell>
                <TableCell>
                  <Chip
                    label={getRoleLabel(user.role)}
                    color={getRoleColor(user.role) as 'error' | 'warning' | 'primary' | 'default'}
                    size="small"
                    icon={user.role.includes('admin') ? <AdminIcon /> : undefined}
                    sx={{ fontSize: '0.75rem' }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.is_active ? t('userManagement.status.active') : t('userManagement.status.inactive')}
                    color={user.is_active ? 'success' : 'default'}
                    size="small"
                    sx={{ fontSize: '0.75rem' }}
                  />
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  <Box sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={user.tenant_name}>
                    {user.tenant_name}
                  </Box>
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, textAlign: 'center' }}>{user.knowledge_bases_count}</TableCell>
                <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, textAlign: 'center' }}>{user.documents_count}</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  <Box sx={{ fontSize: '0.875rem' }}>
                    {new Date(user.created_at).toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US')}
                  </Box>
                </TableCell>
                <TableCell sx={{ position: 'sticky', right: 0, backgroundColor: 'background.paper', zIndex: 1 }}>
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
          rowsPerPageOptions={[5, 10, 25]}
          component="div"
          count={(totalCount && totalCount >= 0) ? totalCount : (stats?.total_users ?? -1)}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          labelRowsPerPage={t('common.rowsPerPage')}
          labelDisplayedRows={({ from, to, count }) =>
            `${from}-${to} ${t('common.of')} ${count !== -1 ? count : t('common.moreThan')} ${to}`
          }
          sx={{
            '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
              fontSize: { xs: '0.75rem', sm: '0.875rem' },
            },
          }}
        />
      </TableContainer>

      {/* 编辑用户对话框 */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('userManagement.dialog.editUser')}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={12}>
              <TextField
                fullWidth
                label={t('userManagement.dialog.fullName')}
                value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label={t('userManagement.dialog.email')}
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
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
            <Grid size={12}>
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
