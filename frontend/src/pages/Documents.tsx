import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Typography, Box, Paper, FormControl, InputLabel, Select, MenuItem, Button, Stack } from '@mui/material';
import { CloudUpload as UploadIcon, ListAlt as ListIcon, Refresh as RefreshIcon, Storage as StorageIcon } from '@mui/icons-material';
import { knowledgeBaseApi } from '../services/api';
import DocumentUpload from '../components/DocumentUpload';
import DocumentManager from '../components/DocumentManager';
import { useSnackbar } from '../components/SnackbarProvider';

interface KnowledgeBase { id: string; name: string; }

const Documents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const loadKBs = async () => {
    try {
      const res = await knowledgeBaseApi.getList();
      const list: KnowledgeBase[] = Array.isArray(res.data) ? res.data : [];
      setKbs(list);
      if (list.length === 0) {
        setSelectedKb('');
      } else if (!selectedKb || !list.some(kb => kb.id === selectedKb)) {
        setSelectedKb(list[0].id);
      }
    } catch {
      enqueueSnackbar('加载知识库失败', 'error');
    }
  };

  useEffect(() => { loadKBs(); }, []);

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold' }}>
        {t('documents.title')}
      </Typography>

      {kbs.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <StorageIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 1 }} />
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('documents.empty.noKnowledgeBases')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('documents.empty.createFirst')}
          </Typography>
          <Stack direction="row" spacing={1} justifyContent="center">
            <Button variant="contained" onClick={() => navigate('/knowledge-bases')}>
              {t('documents.actions.goCreateKb')}
            </Button>
            <Button startIcon={<RefreshIcon />} onClick={loadKBs}>
              {t('common.refresh')}
            </Button>
          </Stack>
        </Paper>
      ) : (
        <>
          <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 240 }}>
              <InputLabel>{t('documents.selectKnowledgeBase')}</InputLabel>
              <Select value={selectedKb} label={t('documents.selectKnowledgeBase')} onChange={(e) => setSelectedKb(e.target.value)}>
                {kbs.map(kb => (
                  <MenuItem key={kb.id} value={kb.id}>{kb.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1}>
              <Button startIcon={<UploadIcon />} variant="contained" onClick={() => setUploadOpen(true)}>
                {t('document.upload.title')}
              </Button>
              <Button startIcon={<ListIcon />} variant="outlined" onClick={() => setManagerOpen(true)}>
                {t('document.manager.title')}
              </Button>
              <Button startIcon={<RefreshIcon />} onClick={loadKBs}>
                {t('common.refresh')}
              </Button>
            </Stack>
          </Paper>

          <DocumentUpload
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            knowledgeBaseId={selectedKb}
            onUploadSuccess={() => enqueueSnackbar('上传已接收，后台处理中', 'success')}
          />
          <DocumentManager
            open={managerOpen}
            onClose={() => setManagerOpen(false)}
            knowledgeBaseId={selectedKb}
            onDocumentsChanged={() => enqueueSnackbar('文档列表已更新', 'info')}
          />
        </>
      )}
    </Box>
  );
};

export default Documents;
