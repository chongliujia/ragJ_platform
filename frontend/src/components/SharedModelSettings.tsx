import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Paper,
  Switch,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { teamApi } from '../services/api';

type TeamSettings = {
  allow_shared_models: boolean;
  shared_model_user_ids: number[];
};

const SharedModelSettings: React.FC = () => {
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sharedCount = useMemo(
    () => (settings?.shared_model_user_ids?.length ?? 0),
    [settings?.shared_model_user_ids]
  );

  const load = async () => {
    try {
      const resp = await teamApi.getCurrentSettings();
      setSettings(resp.data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to load team settings');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onToggle = async (checked: boolean) => {
    if (!settings) return;
    setSaving(true);
    try {
      const resp = await teamApi.updateCurrentSettings({ allow_shared_models: checked });
      setSettings(resp.data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to update team settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
        共享模型
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        开启后，团队管理员可将成员加入白名单，使其在未配置个人模型时可回退使用团队共享模型配置。
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <FormControlLabel
        control={
          <Switch
            checked={!!settings?.allow_shared_models}
            onChange={(_e, checked) => onToggle(checked)}
            disabled={!settings || saving}
          />
        }
        label={settings?.allow_shared_models ? '已开启' : '未开启'}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          白名单用户数：{sharedCount}
        </Typography>
        <Button component={RouterLink} to="/users" size="small" variant="outlined">
          去用户管理
        </Button>
      </Box>
    </Paper>
  );
};

export default SharedModelSettings;

