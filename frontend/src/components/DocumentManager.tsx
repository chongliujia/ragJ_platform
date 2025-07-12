import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Checkbox,
  IconButton,
  Alert,
  CircularProgress,
  Chip,
  Toolbar,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  TextField,
  InputAdornment,
  LinearProgress,
} from '@mui/material';
import {
  Description as DocumentIcon,
  Delete as DeleteIcon,
  CloudSync as ProcessIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  MoreVert as MoreIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Schedule as PendingIcon,
  Refresh as RefreshIcon,
  SelectAll as SelectAllIcon,
} from '@mui/icons-material';
import { documentApi } from '../services/api';

interface Document {
  id: string;
  filename: string;
  size: number;
  upload_time: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunks_count?: number;
  error_message?: string;
  content_type?: string;
}

interface DocumentManagerProps {
  open: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  onDocumentsChanged: () => void;
}

const DocumentManager: React.FC<DocumentManagerProps> = ({
  open,
  onClose,
  knowledgeBaseId,
  onDocumentsChanged,
}) => {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionMenuAnchor, setActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [processingDocuments, setProcessingDocuments] = useState<string[]>([]);
  const [deletingDocuments, setDeletingDocuments] = useState<string[]>([]);

  // 获取文档列表
  const fetchDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      // 注意：这里使用的是模拟数据，实际需要后端API支持
      // const response = await documentApi.getList(knowledgeBaseId);
      // setDocuments(response.data);
      
      // 模拟数据
      const mockDocuments: Document[] = [
        {
          id: '1',
          filename: 'sample_document.pdf',
          size: 1024 * 1024 * 2.5, // 2.5MB
          upload_time: new Date().toISOString(),
          status: 'completed',
          chunks_count: 25,
          content_type: 'application/pdf',
        },
        {
          id: '2',
          filename: 'user_manual.docx',
          size: 1024 * 1024 * 1.2, // 1.2MB
          upload_time: new Date(Date.now() - 3600000).toISOString(),
          status: 'processing',
          content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        {
          id: '3',
          filename: 'data_analysis.xlsx',
          size: 1024 * 512, // 512KB
          upload_time: new Date(Date.now() - 7200000).toISOString(),
          status: 'failed',
          error_message: 'Unsupported file format',
          content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ];
      setDocuments(mockDocuments);
    } catch (error: any) {
      console.error('Failed to fetch documents:', error);
      setError(error.response?.data?.detail || t('document.manager.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  // 删除文档
  const deleteDocuments = async (documentIds: string[]) => {
    try {
      setDeletingDocuments(documentIds);
      
      // 逐个删除文档
      for (const docId of documentIds) {
        await documentApi.delete(knowledgeBaseId, docId);
      }
      
      // 更新本地状态
      setDocuments(prev => prev.filter(doc => !documentIds.includes(doc.id)));
      setSelectedDocuments(prev => prev.filter(id => !documentIds.includes(id)));
      
      // 通知父组件文档已变更
      onDocumentsChanged();
    } catch (error: any) {
      console.error('Failed to delete documents:', error);
      setError(error.response?.data?.detail || t('document.manager.deleteError'));
    } finally {
      setDeletingDocuments([]);
    }
  };

  // 处理文档选择
  const handleDocumentSelect = (documentId: string) => {
    setSelectedDocuments(prev => 
      prev.includes(documentId) 
        ? prev.filter(id => id !== documentId)
        : [...prev, documentId]
    );
  };

  // 全选/取消全选
  const handleSelectAll = () => {
    const filteredDocs = getFilteredDocuments();
    const allSelected = filteredDocs.every(doc => selectedDocuments.includes(doc.id));
    
    if (allSelected) {
      // 取消全选
      const filteredIds = filteredDocs.map(doc => doc.id);
      setSelectedDocuments(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      // 全选
      const newSelections = filteredDocs.map(doc => doc.id);
      setSelectedDocuments(prev => [...new Set([...prev, ...newSelections])]);
    }
  };

  // 过滤文档
  const getFilteredDocuments = () => {
    return documents.filter(doc => {
      const matchesSearch = doc.filename.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  };

  // 获取状态显示
  const getStatusChip = (status: string, error?: string) => {
    const config = {
      completed: { color: 'success' as const, icon: <CheckIcon />, label: t('document.manager.status.completed') },
      processing: { color: 'warning' as const, icon: <PendingIcon />, label: t('document.manager.status.processing') },
      failed: { color: 'error' as const, icon: <ErrorIcon />, label: t('document.manager.status.failed') },
      pending: { color: 'default' as const, icon: <PendingIcon />, label: t('document.manager.status.pending') },
    };
    
    const statusConfig = config[status as keyof typeof config] || config.pending;
    
    return (
      <Tooltip title={error || ''}>
        <Chip
          icon={statusConfig.icon}
          label={statusConfig.label}
          color={statusConfig.color}
          size="small"
          variant={status === 'processing' ? 'filled' : 'outlined'}
        />
      </Tooltip>
    );
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 格式化时间
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  useEffect(() => {
    if (open) {
      fetchDocuments();
    }
  }, [open, knowledgeBaseId]);

  const filteredDocuments = getFilteredDocuments();
  const selectedCount = selectedDocuments.length;
  const filteredSelectedCount = filteredDocuments.filter(doc => selectedDocuments.includes(doc.id)).length;
  const allFilteredSelected = filteredDocuments.length > 0 && filteredSelectedCount === filteredDocuments.length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DocumentIcon />
          {t('document.manager.title')}
          <Chip label={`${documents.length} ${t('document.manager.documentsCount')}`} size="small" />
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* 工具栏 */}
        <Toolbar sx={{ px: 0, minHeight: 'auto !important', mb: 2 }}>
          <TextField
            placeholder={t('document.manager.search.placeholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            sx={{ minWidth: 300 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
          
          <Box sx={{ flexGrow: 1 }} />
          
          <Button
            size="small"
            onClick={handleSelectAll}
            startIcon={<SelectAllIcon />}
            disabled={filteredDocuments.length === 0}
          >
            {allFilteredSelected ? t('document.manager.actions.deselectAll') : t('document.manager.actions.selectAll')}
          </Button>
          
          <Button
            size="small"
            onClick={fetchDocuments}
            startIcon={<RefreshIcon />}
            disabled={loading}
          >
            {t('document.manager.actions.refresh')}
          </Button>
          
          <Button
            size="small"
            onClick={(e) => setActionMenuAnchor(e.currentTarget)}
            startIcon={<MoreIcon />}
            disabled={selectedCount === 0}
          >
            {t('document.manager.actions.actions')} ({selectedCount})
          </Button>
        </Toolbar>

        {/* 文档列表 */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      indeterminate={filteredSelectedCount > 0 && !allFilteredSelected}
                      checked={allFilteredSelected}
                      onChange={handleSelectAll}
                    />
                  </TableCell>
                  <TableCell>{t('document.manager.table.filename')}</TableCell>
                  <TableCell>{t('document.manager.table.size')}</TableCell>
                  <TableCell>{t('document.manager.table.uploadTime')}</TableCell>
                  <TableCell>{t('document.manager.table.status')}</TableCell>
                  <TableCell>{t('document.manager.table.chunks')}</TableCell>
                  <TableCell>{t('document.manager.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredDocuments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        {searchTerm || statusFilter !== 'all' 
                          ? t('document.manager.empty.noMatches')
                          : t('document.manager.empty.noDocuments')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDocuments.map((doc) => (
                    <TableRow key={doc.id} hover>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedDocuments.includes(doc.id)}
                          onChange={() => handleDocumentSelect(doc.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <DocumentIcon color="primary" />
                          <Box>
                            <Typography variant="body2" fontWeight="medium">
                              {doc.filename}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {doc.content_type}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatFileSize(doc.size)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatTime(doc.upload_time)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {getStatusChip(doc.status, doc.error_message)}
                        {doc.status === 'processing' && (
                          <LinearProgress 
                            size="small" 
                            sx={{ mt: 1, width: 80 }} 
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {doc.chunks_count || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => deleteDocuments([doc.id])}
                          disabled={deletingDocuments.includes(doc.id)}
                          color="error"
                        >
                          {deletingDocuments.includes(doc.id) ? (
                            <CircularProgress size={16} />
                          ) : (
                            <DeleteIcon />
                          )}
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* 操作菜单 */}
        <Menu
          anchorEl={actionMenuAnchor}
          open={Boolean(actionMenuAnchor)}
          onClose={() => setActionMenuAnchor(null)}
        >
          <MenuItem 
            onClick={() => {
              deleteDocuments(selectedDocuments);
              setActionMenuAnchor(null);
            }}
            disabled={deletingDocuments.length > 0}
          >
            <ListItemIcon>
              <DeleteIcon />
            </ListItemIcon>
            <ListItemText>{t('document.manager.actions.deleteSelected')}</ListItemText>
          </MenuItem>
        </Menu>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DocumentManager;