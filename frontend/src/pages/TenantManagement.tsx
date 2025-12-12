/**
 * 租户管理页面 - 超级管理员功能
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
  Grid,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Business as TenantIcon,
  Storage as StorageIcon,
  People as UsersIcon,
  Description as DocsIcon,
} from '@mui/icons-material';
import { AuthManager } from '../services/authApi';
import { systemApi } from '../services/api';

interface TenantInfo {
  id: number;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  max_users: number;
  max_knowledge_bases: number;
  storage_quota_mb: number;
  current_users: number;
  current_knowledge_bases: number;
  current_storage_mb: number;
  created_at: string;
  updated_at: string;
}

interface SystemStats {
  total_tenants: number;
  active_tenants: number;
  total_users: number;
  total_knowledge_bases: number;
  total_documents: number;
}

const TenantManagement: React.FC = () => {
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState<number>(-1);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // 对话框状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantInfo | null>(null);
  const [tenantForm, setTenantForm] = useState({
    name: '',
    slug: '',
    description: '',
    is_active: true,
    max_users: 100,
    max_knowledge_bases: 50,
    storage_quota_mb: 10240, // 10GB
  });

  const authManager = AuthManager.getInstance();

  useEffect(() => {
    // Check if user has super admin permissions
    const currentUser = authManager.getCurrentUser();
    if (currentUser?.role !== 'super_admin') {
      console.error('Access denied: Super admin privileges required');
      return;
    }
    loadTenants();
    loadStats();
  }, [page, rowsPerPage, searchTerm, statusFilter]);

  const loadTenants = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        skip: (page * rowsPerPage).toString(),
        limit: rowsPerPage.toString(),
      });
      
      if (searchTerm) params.append('search', searchTerm);
      if (statusFilter) params.append('is_active', statusFilter);

      const response = await fetch(`/api/v1/admin/tenants?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load tenants');
      }

      const totalHeader = response.headers.get('x-total-count');
      if (totalHeader) {
        const parsed = parseInt(totalHeader, 10);
        if (!Number.isNaN(parsed)) setTotalCount(parsed);
      } else {
        setTotalCount(-1);
      }

      const data = await response.json();
      setTenants(data);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await systemApi.getStats();
      setStats(res.data);
    } catch (error) {
      console.error('Failed to load system stats:', error);
      setStats(null);
    }
  };

  const handleCreateTenant = () => {
    setTenantForm({
      name: '',
      slug: '',
      description: '',
      is_active: true,
      max_users: 100,
      max_knowledge_bases: 50,
      storage_quota_mb: 10240,
    });
    setCreateDialogOpen(true);
  };

  const handleEditTenant = (tenant: TenantInfo) => {
    setSelectedTenant(tenant);
    setTenantForm({
      name: tenant.name,
      slug: tenant.slug,
      description: tenant.description,
      is_active: tenant.is_active,
      max_users: tenant.max_users,
      max_knowledge_bases: tenant.max_knowledge_bases,
      storage_quota_mb: tenant.storage_quota_mb,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteTenant = (tenant: TenantInfo) => {
    setSelectedTenant(tenant);
    setDeleteDialogOpen(true);
  };

  const handleSaveTenant = async () => {
    try {
      const url = selectedTenant 
        ? `/api/v1/admin/tenants/${selectedTenant.id}`
        : '/api/v1/admin/tenants';
      
      const method = selectedTenant ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(tenantForm),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${selectedTenant ? 'update' : 'create'} tenant`);
      }

      setEditDialogOpen(false);
      setCreateDialogOpen(false);
      loadTenants();
      loadStats();
    } catch (error: any) {
      setError(error.message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedTenant) return;

    try {
      const response = await fetch(`/api/v1/admin/tenants/${selectedTenant.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete tenant');
      }

      setDeleteDialogOpen(false);
      loadTenants();
      loadStats();
    } catch (error: any) {
      setError(error.message);
    }
  };

  const formatStorage = (mb: number) => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  };

  const getUsagePercentage = (current: number, max: number) => {
    return max > 0 ? (current / max) * 100 : 0;
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'error';
    if (percentage >= 70) return 'warning';
    return 'success';
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        租户管理
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
                  总租户数
                </Typography>
                <Typography variant="h5" component="div">
                  {stats.total_tenants}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  活跃租户
                </Typography>
                <Typography variant="h5" component="div">
                  {stats.active_tenants}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom>
                  总用户数
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
                  总文档
                </Typography>
                <Typography variant="h5" component="div">
                  {stats.total_documents}
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
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="搜索租户"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="租户名称或标识"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <FormControl fullWidth>
              <InputLabel>状态</InputLabel>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                label="状态"
              >
                <MenuItem value="">全部</MenuItem>
                <MenuItem value="true">活跃</MenuItem>
                <MenuItem value="false">禁用</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleCreateTenant}
            >
              添加租户
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* 租户表格 */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>租户名称</TableCell>
              <TableCell>标识</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>用户使用率</TableCell>
              <TableCell>知识库使用率</TableCell>
              <TableCell>存储使用率</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              [...Array(5)].map((_, idx) => (
                <TableRow key={`skeleton-${idx}`}>
                  {Array.from({ length: 8 }).map((__, cidx) => (
                    <TableCell key={cidx}>
                      <Box sx={{ height: 18, bgcolor: 'action.hover', borderRadius: 1 }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
            {!loading && tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell>{tenant.name}</TableCell>
                <TableCell>{tenant.slug}</TableCell>
                <TableCell>
                  <Chip
                    label={tenant.is_active ? '活跃' : '禁用'}
                    color={tenant.is_active ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <UsersIcon fontSize="small" />
                    <Typography variant="body2">
                      {tenant.current_users}/{tenant.max_users}
                    </Typography>
                    <Chip
                      label={`${getUsagePercentage(tenant.current_users, tenant.max_users).toFixed(0)}%`}
                      color={getUsageColor(getUsagePercentage(tenant.current_users, tenant.max_users)) as any}
                      size="small"
                    />
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StorageIcon fontSize="small" />
                    <Typography variant="body2">
                      {tenant.current_knowledge_bases}/{tenant.max_knowledge_bases}
                    </Typography>
                    <Chip
                      label={`${getUsagePercentage(tenant.current_knowledge_bases, tenant.max_knowledge_bases).toFixed(0)}%`}
                      color={getUsageColor(getUsagePercentage(tenant.current_knowledge_bases, tenant.max_knowledge_bases)) as any}
                      size="small"
                    />
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DocsIcon fontSize="small" />
                    <Typography variant="body2">
                      {formatStorage(tenant.current_storage_mb)}/{formatStorage(tenant.storage_quota_mb)}
                    </Typography>
                    <Chip
                      label={`${getUsagePercentage(tenant.current_storage_mb, tenant.storage_quota_mb).toFixed(0)}%`}
                      color={getUsageColor(getUsagePercentage(tenant.current_storage_mb, tenant.storage_quota_mb)) as any}
                      size="small"
                    />
                  </Box>
                </TableCell>
                <TableCell>
                  {new Date(tenant.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    onClick={() => handleEditTenant(tenant)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteTenant(tenant)}
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
          count={(totalCount && totalCount >= 0) ? totalCount : (stats?.total_tenants ?? -1)}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </TableContainer>

      {/* 创建/编辑租户对话框 */}
      <Dialog 
        open={editDialogOpen || createDialogOpen} 
        onClose={() => {
          setEditDialogOpen(false);
          setCreateDialogOpen(false);
        }} 
        maxWidth="md" 
        fullWidth
      >
        <DialogTitle>
          {selectedTenant ? '编辑租户' : '创建租户'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="租户名称"
                value={tenantForm.name}
                onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="租户标识"
                value={tenantForm.slug}
                onChange={(e) => setTenantForm({ ...tenantForm, slug: e.target.value })}
                disabled={!!selectedTenant} // 编辑时不允许修改slug
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="描述"
                multiline
                rows={3}
                value={tenantForm.description}
                onChange={(e) => setTenantForm({ ...tenantForm, description: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="最大用户数"
                type="number"
                value={tenantForm.max_users}
                onChange={(e) => setTenantForm({ ...tenantForm, max_users: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="最大知识库数"
                type="number"
                value={tenantForm.max_knowledge_bases}
                onChange={(e) => setTenantForm({ ...tenantForm, max_knowledge_bases: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="存储配额 (MB)"
                type="number"
                value={tenantForm.storage_quota_mb}
                onChange={(e) => setTenantForm({ ...tenantForm, storage_quota_mb: parseInt(e.target.value) })}
              />
            </Grid>
            <Grid size={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={tenantForm.is_active}
                    onChange={(e) => setTenantForm({ ...tenantForm, is_active: e.target.checked })}
                  />
                }
                label="活跃状态"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setEditDialogOpen(false);
            setCreateDialogOpen(false);
          }}>
            取消
          </Button>
          <Button onClick={handleSaveTenant} variant="contained">
            {selectedTenant ? '更新' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除租户 "{selectedTenant?.name}" 吗？此操作将删除该租户下的所有用户和数据，且无法撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TenantManagement;
