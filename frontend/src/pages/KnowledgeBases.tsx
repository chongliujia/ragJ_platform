import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  Card,
  CardContent,
  CardActions,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Storage as StorageIcon,
  Description as DocumentIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import { knowledgeBaseApi } from '../services/api';
import type { KnowledgeBase } from '../types/models';
import DocumentUpload from '../components/DocumentUpload';
import DocumentManager from '../components/DocumentManager';


const KnowledgeBases: React.FC = () => {
  const { t } = useTranslation();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKbName, setNewKbName] = useState('');
  const [newKbDescription, setNewKbDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  
  // 文档上传相关状态
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedKbId, setSelectedKbId] = useState<string>('');
  
  // 文档管理相关状态
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  // 获取知识库列表
  const fetchKnowledgeBases = async (silent: boolean = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await knowledgeBaseApi.getList();
      setKnowledgeBases(response.data);
      setError(null);
    } catch (error) {
      console.error('Failed to fetch knowledge bases:', error);
      setError(t('knowledgeBase.messages.fetchError'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 创建知识库
  const normalizeKbName = (raw: string) => {
    // 允许字母数字下划线；将空格和连字符替换为下划线，移除其他字符
    let s = raw.trim();
    s = s.replace(/[\s-]+/g, '_');
    s = s.replace(/[^A-Za-z0-9_]/g, '');
    return s;
  };

  const validateKbName = (name: string) => {
    if (!name) return '名称不能为空';
    if (!/^[A-Za-z0-9_]+$/.test(name)) return '仅允许字母、数字和下划线';
    if (name.length > 255) return '名称过长（≤255）';
    return null;
  };

  const createKnowledgeBase = async () => {
    const normalized = normalizeKbName(newKbName);
    const err = validateKbName(normalized);
    if (err) { setNameError(err); return; }

    try {
      setCreating(true);
      setError(null);
      
      const response = await knowledgeBaseApi.create({
        name: normalized,
        description: newKbDescription.trim(),
      });

      // 添加新创建的知识库到列表
      setKnowledgeBases(prev => [...prev, response.data.data]);
      
      // 重置表单
      setNewKbName('');
      setNewKbDescription('');
      setCreateDialogOpen(false);
    } catch (error: any) {
      console.error('Failed to create knowledge base:', error);
      // 显示后端的详细错误
      setError(error?.response?.data?.detail || t('knowledgeBase.messages.createError'));
    } finally {
      setCreating(false);
    }
  };

  // 删除知识库
  const deleteKnowledgeBase = async (id: string) => {
    if (!window.confirm(t('knowledgeBase.messages.deleteConfirm'))) {
      return;
    }

    try {
      await knowledgeBaseApi.delete(id);
      setKnowledgeBases(prev => prev.filter(kb => kb.id !== id));
      setError(null);
    } catch (error: any) {
      console.error('Failed to delete knowledge base:', error);
      setError(error.response?.data?.detail || t('knowledgeBase.messages.deleteError'));
    }
  };

  // 处理文档上传
  const handleUploadDocuments = (kbId: string) => {
    setSelectedKbId(kbId);
    setUploadDialogOpen(true);
  };

  // 处理文档管理
  const handleManageDocuments = (kbId: string) => {
    setSelectedKbId(kbId);
    setManageDialogOpen(true);
  };

  // 上传成功后刷新知识库列表
  const handleUploadSuccess = () => {
    fetchKnowledgeBases();
  };

  // 文档变更后刷新知识库列表
  const handleDocumentsChanged = () => {
    fetchKnowledgeBases();
  };

  useEffect(() => {
    fetchKnowledgeBases();
  }, []);

  // 自动刷新：上传/管理对话框打开时加快刷新频率，否则低频刷新
  const kbRefreshTimerRef = useRef<any>(null);
  useEffect(() => {
    // 计算刷新间隔：对话框打开时 2s，否则 10s
    const intervalMs = (uploadDialogOpen || manageDialogOpen) ? 2000 : 10000;

    // 清理旧定时器
    if (kbRefreshTimerRef.current) {
      clearInterval(kbRefreshTimerRef.current);
      kbRefreshTimerRef.current = null;
    }

    // 启动新定时器
    kbRefreshTimerRef.current = setInterval(() => {
      // 若页面隐藏，跳过本次（减少无谓请求）
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchKnowledgeBases(true);
    }, intervalMs);

    // 卸载时清理
    return () => {
      if (kbRefreshTimerRef.current) {
        clearInterval(kbRefreshTimerRef.current);
        kbRefreshTimerRef.current = null;
      }
    };
  }, [uploadDialogOpen, manageDialogOpen]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'processing': return 'warning';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return t('knowledgeBase.status.active');
      case 'processing': return t('knowledgeBase.status.processing');
      case 'error': return t('knowledgeBase.status.error');
      default: return t('knowledgeBase.status.unknown');
    }
  };

  const humanFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const thresh = 1024;
    if (Math.abs(bytes) < thresh) return bytes + ' B';
    const units = ['KB','MB','GB','TB'];
    let u = -1;
    let b = bytes;
    do {
      b /= thresh;
      ++u;
    } while (Math.abs(b) >= thresh && u < units.length - 1);
    return b.toFixed(1) + ' ' + units[u];
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
          {t('knowledgeBase.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          {t('knowledgeBase.create')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {knowledgeBases.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8, width: '100%' }}>
              <StorageIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary">
                {t('knowledgeBase.empty.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('knowledgeBase.empty.description')}
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
              >
                {t('knowledgeBase.create')}
              </Button>
            </Box>
          ) : (
            knowledgeBases.map((kb) => (
              <Card key={kb.id} sx={{ minWidth: 300, maxWidth: 400 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <StorageIcon sx={{ mr: 1, color: 'primary.main' }} />
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {kb.name}
                    </Typography>
                  </Box>
                  
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {kb.description || t('knowledgeBase.card.noDescription')}
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <DocumentIcon sx={{ fontSize: 16, mr: 0.5 }} />
                      <Typography variant="body2">
                        {kb.document_count} {t('knowledgeBase.card.documentsCount')}
                      </Typography>
                    </Box>
                    {'total_chunks' in kb && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`分片: ${kb.total_chunks || 0}`}
                      />
                    )}
                    {'total_size_bytes' in kb && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`大小: ${humanFileSize(kb.total_size_bytes)}`}
                      />
                    )}
                    <Chip
                      label={getStatusText(kb.status)}
                      color={getStatusColor(kb.status) as any}
                      size="small"
                    />
                  </Box>

                  <Typography variant="caption" color="text.secondary">
                    {t('knowledgeBase.card.createdAt')}: {new Date(kb.created_at).toLocaleDateString()}
                  </Typography>
                </CardContent>
                
                <CardActions>
                  <Button 
                    size="small" 
                    color="primary"
                    onClick={() => handleUploadDocuments(kb.id)}
                    startIcon={<UploadIcon />}
                  >
                    {t('knowledgeBase.card.uploadDocuments')}
                  </Button>
                  <Button 
                    size="small" 
                    color="primary"
                    onClick={() => handleManageDocuments(kb.id)}
                  >
                    {t('knowledgeBase.card.manageDocuments')}
                  </Button>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => deleteKnowledgeBase(kb.id)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </CardActions>
              </Card>
            ))
          )}
        </Box>
      )}

      {/* 创建知识库对话框 */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('knowledgeBase.createDialog.title')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={t('knowledgeBase.createDialog.nameLabel')}
            fullWidth
            variant="outlined"
            value={newKbName}
            onChange={(e) => {
              const raw = e.target.value;
              setNewKbName(raw);
              // 即时校验并提供自动修复建议
              const normalized = normalizeKbName(raw);
              const err = validateKbName(normalized);
              setNameError(err);
            }}
            error={!!nameError}
            helperText={nameError ? nameError : '仅允许字母、数字、下划线。会自动将空格和连字符转换为下划线。'}
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              规范化后名称：{normalizeKbName(newKbName) || '-'}
            </Typography>
            <Button size="small" onClick={() => setNewKbName(normalizeKbName(newKbName))}>
              自动修复
            </Button>
          </Box>
          <TextField
            margin="dense"
            label={t('knowledgeBase.createDialog.descriptionLabel')}
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            value={newKbDescription}
            onChange={(e) => setNewKbDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={createKnowledgeBase}
            variant="contained"
            disabled={creating}
          >
            {creating ? t('common.loading') : t('common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 文档上传对话框 */}
      <DocumentUpload
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        knowledgeBaseId={selectedKbId}
        onUploadSuccess={handleUploadSuccess}
      />

      {/* 文档管理对话框 */}
      <DocumentManager
        open={manageDialogOpen}
        onClose={() => setManageDialogOpen(false)}
        knowledgeBaseId={selectedKbId}
        onDocumentsChanged={handleDocumentsChanged}
      />
    </Box>
  );
};

export default KnowledgeBases; 
