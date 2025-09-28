import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Typography, Box, Paper, FormControl, InputLabel, Select, MenuItem, Button, Stack } from '@mui/material';
import { CloudUpload as UploadIcon, ListAlt as ListIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { knowledgeBaseApi } from '../services/api';
import DocumentUpload from '../components/DocumentUpload';
import DocumentManager from '../components/DocumentManager';
import { useSnackbar } from '../components/SnackbarProvider';

interface KnowledgeBase { id: string; name: string; }

const Documents: React.FC = () => {
  const { t } = useTranslation();
  const { enqueueSnackbar } = useSnackbar();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const loadKBs = async () => {
    try {
      const res = await knowledgeBaseApi.getList();
      setKbs(res.data || []);
      if (!selectedKb && res.data?.length) {
        setSelectedKb(res.data[0].id);
      }
    } catch (e) {
      enqueueSnackbar('加载知识库失败', 'error');
    }
  };

  useEffect(() => { loadKBs(); }, []);

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold' }}>
        文档管理
      </Typography>

      <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>知识库</InputLabel>
          <Select value={selectedKb} label="知识库" onChange={(e) => setSelectedKb(e.target.value)}>
            {kbs.map(kb => (
              <MenuItem key={kb.id} value={kb.id}>{kb.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<UploadIcon />} variant="contained" disabled={!selectedKb} onClick={() => setUploadOpen(true)}>
            上传文档
          </Button>
          <Button startIcon={<ListIcon />} variant="outlined" disabled={!selectedKb} onClick={() => setManagerOpen(true)}>
            管理文档
          </Button>
          <Button startIcon={<RefreshIcon />} onClick={loadKBs}>刷新</Button>
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
    </Box>
  );
};

export default Documents;
