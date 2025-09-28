import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Alert,
  CircularProgress,
  Paper,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  LinearProgress,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  ExpandMore as ExpandMoreIcon,
  Settings as SettingsIcon,
  Description as FileIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { documentApi } from '../services/api';
import type { ChunkingStrategyConfig, ChunkingStrategy } from '../types/models';
import { useSnackbar } from './SnackbarProvider';

interface DocumentUploadProps {
  open: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  onUploadSuccess: () => void;
}

interface FileUploadStatus {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
}

const ALLOWED_EXTS = ['pdf','docx','txt','md','html'];
const MAX_SIZE_MB = Number((import.meta as any).env?.VITE_MAX_UPLOAD_MB || 100);
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const DocumentUpload: React.FC<DocumentUploadProps> = ({
  open,
  onClose,
  knowledgeBaseId,
  onUploadSuccess,
}) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileUploadStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadControllersRef = useRef<Map<number, AbortController>>(new Map());
  
  // 分片策略相关状态
  const [strategies, setStrategies] = useState<ChunkingStrategyConfig[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<ChunkingStrategy>('recursive');
  const [strategyParams, setStrategyParams] = useState<Record<string, any>>({});
  const [loadingStrategies, setLoadingStrategies] = useState(true);
  const { enqueueSnackbar } = useSnackbar();

  // 获取分片策略列表
  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        setLoadingStrategies(true);
        const response = await documentApi.getChunkingStrategies();
        const strategiesData = response.data.strategies;
        setStrategies(strategiesData);
        
        // 设置默认策略和参数
        if (strategiesData.length > 0) {
          const defaultStrategy = strategiesData[0];
          setSelectedStrategy(defaultStrategy.value);
          
          // 初始化默认参数
          const defaultParams: Record<string, any> = {};
          Object.entries(defaultStrategy.params).forEach(([key, param]) => {
            defaultParams[key] = param.default;
          });
          setStrategyParams(defaultParams);
        }
      } catch (error) {
        console.error('Failed to fetch chunking strategies:', error);
        setError(t('document.upload.strategies.fetchError'));
      } finally {
        setLoadingStrategies(false);
      }
    };

    if (open) {
      fetchStrategies();
    }
  }, [open, t]);

  // 处理策略选择变化
  const handleStrategyChange = (strategy: ChunkingStrategy) => {
    setSelectedStrategy(strategy);
    
    // 重置参数为新策略的默认值
    const strategyConfig = strategies.find(s => s.value === strategy);
    if (strategyConfig) {
      const newParams: Record<string, any> = {};
      Object.entries(strategyConfig.params).forEach(([key, param]) => {
        newParams[key] = param.default;
      });
      setStrategyParams(newParams);
    }
  };

  // 支持拖拽添加文件
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length > 0) {
      const newFiles: FileUploadStatus[] = droppedFiles.map(file => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (!ALLOWED_EXTS.includes(ext)) {
          return { file, status: 'error', progress: 0, error: `不支持的文件类型 .${ext}` };
        }
        if (file.size > MAX_SIZE_BYTES) {
          return { file, status: 'error', progress: 0, error: `文件超过大小限制（≤ ${MAX_SIZE_MB} MB）` };
        }
        return { file, status: 'pending', progress: 0 };
      });
      setFiles(prev => [...prev, ...newFiles]);
      setError(null);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // 处理参数变化
  const handleParamChange = (paramName: string, value: any) => {
    setStrategyParams(prev => ({
      ...prev,
      [paramName]: value,
    }));
  };

  // 处理文件选择（支持多文件）
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length > 0) {
      const newFiles: FileUploadStatus[] = selectedFiles.map(file => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (!ALLOWED_EXTS.includes(ext)) {
          return { file, status: 'error', progress: 0, error: `不支持的文件类型 .${ext}` };
        }
        if (file.size > MAX_SIZE_BYTES) {
          return { file, status: 'error', progress: 0, error: `文件超过大小限制（≤ ${MAX_SIZE_MB} MB）` };
        }
        return { file, status: 'pending', progress: 0 };
      });
      setFiles(prev => [...prev, ...newFiles]);
      setError(null);
    }
  };

  // 删除文件
  const handleRemoveFile = (index: number) => {
    // 若正在上传，先取消
    const controller = uploadControllersRef.current.get(index);
    if (controller) {
      try { controller.abort(); } catch {}
      uploadControllersRef.current.delete(index);
    }
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 处理文件上传（支持多文件）
  const handleUpload = async () => {
    if (files.length === 0) {
      setError(t('document.upload.file.required'));
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setUploadProgress(0);

      const totalFiles = files.length;
      let completedFiles = 0;

      // 逐个上传文件
      for (let i = 0; i < files.length; i++) {
        const fileStatus = files[i];
        if (fileStatus.status === 'error') continue;
        
        // 更新文件状态为上传中
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'uploading', progress: 0 } : f
        ));

        try {
          const formData = new FormData();
          formData.append('file', fileStatus.file);
          formData.append('chunking_strategy', selectedStrategy);
          formData.append('chunking_params', JSON.stringify(strategyParams));
          const controller = new AbortController();
          uploadControllersRef.current.set(i, controller);
          await documentApi.upload(knowledgeBaseId, formData, controller.signal);
          
          // 上传成功
          setFiles(prev => prev.map((f, idx) => 
            idx === i ? { ...f, status: 'success', progress: 100 } : f
          ));
          uploadControllersRef.current.delete(i);
          
          completedFiles++;
          setUploadProgress((completedFiles / totalFiles) * 100);
          
        } catch (error: any) {
          console.error(`Upload failed for file ${fileStatus.file.name}:`, error);
          
          // 上传失败
          setFiles(prev => prev.map((f, idx) => 
            idx === i ? { 
              ...f, 
              status: 'error', 
              progress: 0,
              error: (error?.name === 'CanceledError' || error?.message === 'canceled' || error?.message?.includes('aborted')) 
                ? '已取消'
                : (error?.response?.data?.detail || t('document.upload.error'))
            } : f
          ));
          uploadControllersRef.current.delete(i);
        }
      }

      // 检查是否有成功的上传
      const successfulUploads = files.filter(f => f.status === 'success').length;
      if (successfulUploads > 0) {
        onUploadSuccess();
        enqueueSnackbar('上传已接收，后台处理中', 'success');
      }
      
      // 如果全部成功，关闭对话框
      const failedUploads = files.filter(f => f.status === 'error').length;
      if (failedUploads === 0) {
        handleClose();
      }
      
    } catch (error: any) {
      console.error('Upload process failed:', error);
      setError(error.message || t('document.upload.error'));
      enqueueSnackbar('上传失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  // 重置表单
  const handleClose = () => {
    setFiles([]);
    setError(null);
    setUploading(false);
    setUploadProgress(0);
    onClose();
  };

  // 获取当前策略配置
  const currentStrategyConfig = strategies.find(s => s.value === selectedStrategy);

  // 渲染参数控件
  const renderParamControl = (paramName: string, paramConfig: any) => {
    const value = strategyParams[paramName] || paramConfig.default;

    if (paramConfig.type === 'number') {
      return (
        <TextField
          key={paramName}
          type="number"
          label={paramName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          value={value}
          onChange={(e) => handleParamChange(paramName, parseInt(e.target.value))}
          inputProps={{
            min: paramConfig.min,
            max: paramConfig.max,
          }}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
        />
      );
    } else if (paramConfig.type === 'select') {
      return (
        <FormControl key={paramName} size="small" fullWidth sx={{ mb: 2 }}>
          <InputLabel>{paramName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</InputLabel>
          <Select
            value={value}
            onChange={(e) => handleParamChange(paramName, e.target.value)}
            label={paramName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          >
            {paramConfig.options?.map((option: string) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <UploadIcon />
          {t('document.upload.title')}
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* 文件选择区域 */}
        <Paper
          variant="outlined"
          sx={{
            p: 3,
            mb: 3,
            textAlign: 'center',
            border: '2px dashed',
            borderColor: files.length > 0 ? 'primary.main' : 'grey.300',
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : (files.length > 0 ? 'primary.50' : 'grey.50'),
            cursor: 'pointer',
            transition: 'all 0.2s',
            '&:hover': {
              borderColor: 'primary.main',
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'primary.50',
            },
          }}
          onClick={openFilePicker}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept={ALLOWED_EXTS.map(ext => `.${ext}`).join(',')}
            onChange={handleFileChange}
            multiple
            style={{ display: 'none' }}
            ref={fileInputRef}
          />
          
          <Box>
            <UploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
            <Typography variant="h6" color="primary">
              {files.length > 0 
                ? t('document.upload.file.addMore') 
                : t('document.upload.file.select')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              支持：{ALLOWED_EXTS.map(ext => `.${ext}`).join(', ')} · 最大 {MAX_SIZE_MB} MB
            </Typography>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              sx={{ mt: 2 }}
              size="small"
              onClick={(e) => { e.stopPropagation(); openFilePicker(); }}
            >
              {t('document.upload.file.browse')}
            </Button>
          </Box>
        </Paper>

        {/* 文件列表 */}
        {files.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('document.upload.file.selectedFiles')} ({files.length})
            </Typography>
            <List>
              {files.map((fileStatus, index) => (
                <ListItem key={index} divider>
                  <ListItemIcon>
                    <FileIcon color={
                      fileStatus.status === 'success' ? 'success' :
                      fileStatus.status === 'error' ? 'error' :
                      fileStatus.status === 'uploading' ? 'primary' : 'inherit'
                    } />
                  </ListItemIcon>
                  <ListItemText
                    primary={fileStatus.file.name}
                    secondary={
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {(fileStatus.file.size / 1024 / 1024).toFixed(2)} MB
                        </Typography>
                        {fileStatus.status === 'uploading' && (
                          <LinearProgress 
                            variant="indeterminate" 
                            sx={{ mt: 1, height: 4, borderRadius: 2 }}
                          />
                        )}
                        {fileStatus.status === 'error' && fileStatus.error && (
                          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                            {fileStatus.error}
                          </Typography>
                        )}
                      </Box>
                    }
                    secondaryTypographyProps={{ component: 'div' }}
                  />
                  <ListItemSecondaryAction>
                    <Chip
                      label={
                        fileStatus.status === 'success' ? t('document.upload.status.success') :
                        fileStatus.status === 'error' ? t('document.upload.status.error') :
                        fileStatus.status === 'uploading' ? t('document.upload.status.uploading') :
                        t('document.upload.status.pending')
                      }
                      color={
                        fileStatus.status === 'success' ? 'success' :
                        fileStatus.status === 'error' ? 'error' :
                        fileStatus.status === 'uploading' ? 'primary' : 'default'
                      }
                      size="small"
                      sx={{ mr: 1 }}
                    />
                    {fileStatus.status === 'uploading' ? (
                      <IconButton
                        edge="end"
                        onClick={() => {
                          const c = uploadControllersRef.current.get(index);
                          if (c) {
                            try { c.abort(); } catch {}
                          }
                        }}
                        size="small"
                      >
                        <DeleteIcon />
                      </IconButton>
                    ) : (
                      <IconButton
                        edge="end"
                        onClick={() => handleRemoveFile(index)}
                        size="small"
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {/* 总体上传进度 */}
        {uploading && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('document.upload.progress.overall')}: {uploadProgress.toFixed(0)}%
            </Typography>
            <LinearProgress 
              variant="determinate" 
              value={uploadProgress} 
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}

        {/* 分片策略配置 */}
        {loadingStrategies ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SettingsIcon />
                <Typography variant="h6">
                  {t('document.upload.chunking.title')}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {/* 策略选择 */}
              <FormControl fullWidth sx={{ mb: 3 }}>
                <InputLabel>{t('document.upload.chunking.strategy')}</InputLabel>
                <Select
                  value={selectedStrategy}
                  onChange={(e) => handleStrategyChange(e.target.value as ChunkingStrategy)}
                  label={t('document.upload.chunking.strategy')}
                >
                  {strategies.map((strategy) => (
                    <MenuItem key={strategy.value} value={strategy.value}>
                      <Box>
                        <Typography variant="body1">
                          {strategy.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {strategy.description}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* 策略参数 */}
              {currentStrategyConfig && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {t('document.upload.chunking.parameters')}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                    {Object.entries(currentStrategyConfig.params).map(([paramName, paramConfig]) =>
                      renderParamControl(paramName, paramConfig)
                    )}
                  </Box>
                </Box>
              )}
            </AccordionDetails>
          </Accordion>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button onClick={handleClose} disabled={uploading}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleUpload}
          variant="contained"
          disabled={files.length === 0 || uploading || loadingStrategies}
          startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
        >
          {uploading 
            ? t('document.upload.uploading') 
            : t('document.upload.uploadFiles', { count: files.length })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DocumentUpload;
