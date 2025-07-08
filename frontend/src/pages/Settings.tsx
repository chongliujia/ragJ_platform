import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  Tabs,
  Tab,
  Paper,
} from '@mui/material';
import {
  Person as PersonIcon,
  Settings as SystemIcon,
} from '@mui/icons-material';
import ModelConfigManager from '../components/ModelConfigManager';
import UserSettings from '../components/UserSettings';
import { AuthManager } from '../services/authApi';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [tabValue, setTabValue] = useState(0);
  const authManager = AuthManager.getInstance();
  const currentUser = authManager.getCurrentUser();

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 3 }}>
        {t('settings.title')}
      </Typography>
      
      <Paper sx={{ mb: 2 }}>
        <Tabs 
          value={tabValue} 
          onChange={handleTabChange}
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '1rem',
            },
          }}
        >
          <Tab 
            icon={<PersonIcon />} 
            iconPosition="start"
            label={t('settings.tabs.personal')} 
            id="settings-tab-0" 
            aria-controls="settings-tabpanel-0" 
          />
          {/* 只有管理员及以上才能看到系统设置 */}
          {currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin') && (
            <Tab 
              icon={<SystemIcon />} 
              iconPosition="start"
              label={t('settings.tabs.system')} 
              id="settings-tab-1" 
              aria-controls="settings-tabpanel-1" 
            />
          )}
        </Tabs>
      </Paper>

      <TabPanel value={tabValue} index={0}>
        <UserSettings />
      </TabPanel>
      
      {currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin') && (
        <TabPanel value={tabValue} index={1}>
          <ModelConfigManager />
        </TabPanel>
      )}
    </Box>
  );
};

export default Settings;