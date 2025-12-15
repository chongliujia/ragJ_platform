import React, { useEffect, useState } from 'react';
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
  SmartToy as ModelIcon,
} from '@mui/icons-material';
import ModelConfigManager from '../components/ModelConfigManager';
import UserSettings from '../components/UserSettings';
import SharedModelSettings from '../components/SharedModelSettings';
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
  const [currentUser, setCurrentUser] = useState(authManager.getCurrentUser());

  useEffect(() => {
    if (authManager.isAuthenticated()) {
      authManager.loadUserInfo()
        .then((u) => setCurrentUser(u))
        .catch(() => setCurrentUser(null));
    } else {
      setCurrentUser(null);
    }
  }, []);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
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
          <Tab
            icon={<ModelIcon />}
            iconPosition="start"
            label="模型配置"
            id="settings-tab-1"
            aria-controls="settings-tabpanel-1"
          />
          {/* 只有管理员及以上才能看到系统设置 */}
          {currentUser && (currentUser.role === 'tenant_admin' || currentUser.role === 'super_admin') && (
            <Tab 
              icon={<SystemIcon />} 
              iconPosition="start"
              label={t('settings.tabs.system')} 
              id="settings-tab-2" 
              aria-controls="settings-tabpanel-2" 
            />
          )}
        </Tabs>
      </Paper>

      <TabPanel value={tabValue} index={0}>
        <UserSettings />
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <ModelConfigManager scope="me" />
      </TabPanel>
      
      {currentUser && (currentUser.role === 'tenant_admin' || currentUser.role === 'super_admin') && (
        <TabPanel value={tabValue} index={2}>
          <SharedModelSettings />
          <ModelConfigManager scope="tenant" />
        </TabPanel>
      )}
    </Box>
  );
};

export default Settings;
