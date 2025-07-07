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
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  ExpandMore as ExpandMoreIcon,
  Settings as SettingsIcon,
  Description as FileIcon,
} from '@mui/icons-material';
import { documentApi } from '../services/api';
import type { ChunkingStrategyConfig, ChunkingStrategy } from '../types/models';

interface DocumentUploadProps {
  open: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  onUploadSuccess: () => void;
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({
  open,
  onClose,
  knowledgeBaseId,
  onUploadSuccess,
}) => {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 分片策略相关状态
  const [strategies, setStrategies] = useState<ChunkingStrategyConfig[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<ChunkingStrategy>('recursive');
  const [strategyParams, setStrategyParams] = useState<Record<string, any>>({});
  const [loadingStrategies, setLoadingStrategies] = useState(true);

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

  // 处理参数变化
  const handleParamChange = (paramName: string, value: any) => {
    setStrategyParams(prev => ({
      ...prev,
      [paramName]: value,
    }));
  };

  // 处理文件选择
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  // 处理文件上传
  const handleUpload = async () => {
    if (!file) {
      setError(t('document.upload.file.required'));
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('chunking_strategy', selectedStrategy);
      formData.append('chunking_params', JSON.stringify(strategyParams));

      await documentApi.upload(knowledgeBaseId, formData);
      
      // 上传成功
      onUploadSuccess();
      handleClose();
    } catch (error: any) {
      console.error('Upload failed:', error);
      setError(error.response?.data?.detail || t('document.upload.error'));
    } finally {
      setUploading(false);
    }
  };

  // 重置表单
  const handleClose = () => {
    setFile(null);
    setError(null);
    setUploading(false);
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
            borderColor: file ? 'primary.main' : 'grey.300',
            bgcolor: file ? 'primary.50' : 'grey.50',
            cursor: 'pointer',
            transition: 'all 0.2s',
            '&:hover': {
              borderColor: 'primary.main',
              bgcolor: 'primary.50',
            },
          }}
          component="label"
        >
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          
          {file ? (
            <Box>
              <FileIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
              <Typography variant="h6" color="primary">
                {file.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </Typography>
              <Chip
                label={t('document.upload.file.selected')}
                color="primary"
                size="small"
                sx={{ mt: 1 }}
              />
            </Box>
          ) : (
            <Box>
              <UploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" color="text.secondary">
                {t('document.upload.file.select')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('document.upload.file.supportedFormats')}
              </Typography>
            </Box>
          )}
        </Paper>

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
          disabled={!file || uploading || loadingStrategies}
          startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
        >
          {uploading ? t('document.upload.uploading') : t('document.upload.upload')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DocumentUpload;