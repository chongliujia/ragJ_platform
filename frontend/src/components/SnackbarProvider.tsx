import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Snackbar, Alert } from '@mui/material';
import type { AlertColor } from '@mui/material/Alert';

type Snack = { message: string; severity?: AlertColor; autoHideDuration?: number };

interface SnackbarContextValue {
  enqueueSnackbar: (msg: string, severity?: AlertColor, autoHideMs?: number) => void;
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

export const useSnackbar = (): SnackbarContextValue => {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar must be used within SnackbarProvider');
  return ctx;
};

export const SnackbarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [snack, setSnack] = useState<Snack | null>(null);
  const [open, setOpen] = useState(false);

  const enqueueSnackbar = useCallback((message: string, severity: AlertColor = 'info', autoHideMs = 3000) => {
    setSnack({ message, severity, autoHideDuration: autoHideMs });
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ enqueueSnackbar }), [enqueueSnackbar]);

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Snackbar open={open} autoHideDuration={snack?.autoHideDuration || 3000} onClose={() => setOpen(false)}>
        <Alert onClose={() => setOpen(false)} severity={snack?.severity || 'info'} variant="filled" sx={{ width: '100%' }}>
          {snack?.message}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
};
