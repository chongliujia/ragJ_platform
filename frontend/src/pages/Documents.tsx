import React from 'react';
import { useTranslation } from 'react-i18next';
import { Typography, Box, Paper } from '@mui/material';
import { Construction as ConstructionIcon } from '@mui/icons-material';

const Documents: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold' }}>
        {t('documents.title')}
      </Typography>
      
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <ConstructionIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t('documents.comingSoon')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('documents.description')}
        </Typography>
      </Paper>
    </Box>
  );
};

export default Documents; 