import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { modelConfigApi } from '../services/modelConfigApi';
import { AuthManager } from '../services/authApi';

type MissingReason = 'missing_config' | 'missing_api_key';

function nowMs() {
  return Date.now();
}

function getDismissKey(userId: number | string) {
  return `ragj_model_config_reminder_dismissed_at_u${userId}`;
}

const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

const ModelConfigReminder: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const authManager = AuthManager.getInstance();
  const user = authManager.getCurrentUser();
  const userId = user?.id;

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<MissingReason>('missing_config');
  const [loading, setLoading] = useState(false);

  const shouldSkipByDismiss = useMemo(() => {
    if (!userId) return true;
    try {
      const raw = localStorage.getItem(getDismissKey(userId));
      const ts = raw ? Number(raw) : 0;
      if (!ts || !Number.isFinite(ts)) return false;
      return nowMs() - ts < DISMISS_TTL_MS;
    } catch {
      return false;
    }
  }, [userId]);

  const dismiss = useCallback(() => {
    if (!userId) {
      setOpen(false);
      return;
    }
    try {
      localStorage.setItem(getDismissKey(userId), String(nowMs()));
    } catch {
      // ignore
    }
    setOpen(false);
  }, [userId]);

  const goSettings = useCallback(() => {
    setOpen(false);
    navigate('/settings?tab=model');
  }, [navigate]);

  useEffect(() => {
    if (!authManager.isAuthenticated()) return;
    if (!userId) return;
    if (shouldSkipByDismiss) return;

    let alive = true;
    setLoading(true);

    modelConfigApi
      .getModelConfigDetails('chat')
      .then((res) => {
        if (!alive) return;
        const cfg = res.data as any;
        const enabled = !!cfg?.enabled;
        const provider = String(cfg?.provider || '');
        const hasKey = !!cfg?.has_api_key;
        const ok = enabled && (hasKey || provider === 'local');
        if (!ok) {
          setReason(hasKey ? 'missing_config' : 'missing_api_key');
          setOpen(true);
        }
      })
      .catch((e: any) => {
        if (!alive) return;
        const status = e?.response?.status;
        if (status === 404) {
          setReason('missing_config');
          setOpen(true);
        }
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [authManager, shouldSkipByDismiss, userId]);

  if (!authManager.isAuthenticated()) return null;
  if (!userId) return null;
  if (loading) return null;

  return (
    <Dialog open={open} onClose={dismiss} maxWidth="sm" fullWidth>
      <DialogTitle>{t('modelConfigReminder.title')}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {t('modelConfigReminder.body')}
          </Typography>

          {reason === 'missing_api_key' ? (
            <Alert severity="warning">
              {t('modelConfigReminder.missingKey')}
            </Alert>
          ) : (
            <Alert severity="info">
              {t('modelConfigReminder.missingConfig')}
            </Alert>
          )}

          <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'background.default' }}>
            <Typography variant="caption" color="text.secondary">
              {t('modelConfigReminder.tenantHint')}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={dismiss}>{t('modelConfigReminder.later')}</Button>
        <Button variant="contained" onClick={goSettings}>
          {t('modelConfigReminder.go')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ModelConfigReminder;
