import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
} from '@mui/material';
import ModelConfigManager from '../components/ModelConfigManager';

const Settings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 3 }}>
        {t('settings.title')}
      </Typography>
      <ModelConfigManager />
    </Box>
  );
};

export default Settings;