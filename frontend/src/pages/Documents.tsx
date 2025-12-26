import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const { enqueueSnackbar } = useSnackbar();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const jumpHandledRef = useRef(false);

  const jumpParams = useMemo(() => {
    const kbId = searchParams.get('kbId') || '';
    const docId = searchParams.get('docId') || '';
    const chunkRaw = searchParams.get('chunk');
    const parsed = chunkRaw ? Number(chunkRaw) : NaN;
    const chunkIndex = Number.isFinite(parsed) ? parsed : undefined;
    const termsRaw = searchParams.get('terms') || '';
    const terms = termsRaw ? termsRaw.split(',').map((term) => term.trim()).filter(Boolean) : [];
    const openTarget = searchParams.get('open') || '';
    return { kbId, docId, chunkIndex, terms, openTarget };
  }, [searchParams]);

  useEffect(() => {
    jumpHandledRef.current = false;
  }, [jumpParams.docId, jumpParams.kbId, jumpParams.openTarget]);

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
      if (!jumpHandledRef.current && jumpParams.docId) {
        const targetKb = list.find((kb) => kb.id === jumpParams.kbId) || list[0];
        if (targetKb) {
          setSelectedKb(targetKb.id);
          if (jumpParams.openTarget === 'chunks') {
            setManagerOpen(true);
          }
        }
        jumpHandledRef.current = true;
      }
    } catch {
      enqueueSnackbar(t('documents.messages.loadKnowledgeBasesFailed'), 'error');
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
            onUploadSuccess={() => enqueueSnackbar(t('documents.messages.uploadAccepted'), 'success')}
          />
          <DocumentManager
            open={managerOpen}
            onClose={() => setManagerOpen(false)}
            knowledgeBaseId={selectedKb}
            onDocumentsChanged={() => enqueueSnackbar(t('documents.messages.documentsUpdated'), 'info')}
            initialDocumentId={jumpParams.docId || undefined}
            initialChunkIndex={jumpParams.chunkIndex}
            highlightTerms={jumpParams.terms}
          />
        </>
      )}
    </Box>
  );
};

export default Documents;
