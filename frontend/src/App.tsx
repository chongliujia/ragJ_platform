import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Box, Typography } from '@mui/material';
import './i18n';
import Sidebar from './components/Sidebar';
import AuthGuard from './components/AuthGuard';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import KnowledgeBases from './pages/KnowledgeBases';
import Documents from './pages/Documents';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import Test from './pages/Test';
import UserManagement from './pages/UserManagement';
import TenantManagement from './pages/TenantManagement';
import PermissionManagement from './pages/PermissionManagement';
import { AuthManager } from './services/authApi';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
    background: {
      default: '#f5f5f5',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
  },
});

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const authManager = AuthManager.getInstance();

  useEffect(() => {
    // 检查认证状态
    const checkAuth = async () => {
      if (authManager.isAuthenticated()) {
        const user = await authManager.loadUserInfo();
        setIsAuthenticated(!!user);
      } else {
        setIsAuthenticated(false);
      }
    };

    checkAuth();
  }, []);

  // 加载状态显示
  if (isAuthenticated === null) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 35%, ${theme.palette.secondary.main} 100%)`,
          }}
        >
          <Box sx={{ textAlign: 'center', color: 'white' }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                border: `4px solid rgba(255,255,255,0.3)`,
                borderTop: `4px solid white`,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px',
                '@keyframes spin': {
                  '0%': { transform: 'rotate(0deg)' },
                  '100%': { transform: 'rotate(360deg)' },
                },
              }}
            />
            <Typography variant="h6">加载中...</Typography>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Routes>
          {/* 登录路由 */}
          <Route 
            path="/login" 
            element={
              isAuthenticated ? <Navigate to="/" replace /> : <Login />
            } 
          />
          
          {/* 受保护的路由 */}
          <Route
            path="/*"
            element={
              <AuthGuard>
                <Box sx={{ display: 'flex' }}>
                  <Sidebar />
                  <Box
                    component="main"
                    sx={{
                      flexGrow: 1,
                      p: 3,
                      width: { sm: `calc(100% - 240px)` },
                      ml: { sm: '240px' },
                      minHeight: '100vh',
                      backgroundColor: 'background.default',
                    }}
                  >
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/knowledge-bases" element={<KnowledgeBases />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/chat" element={<Chat />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/test" element={<Test />} />
                      
                      {/* 管理员路由 */}
                      <Route 
                        path="/users" 
                        element={
                          <AuthGuard requiredRole="admin">
                            <UserManagement />
                          </AuthGuard>
                        } 
                      />
                      
                      {/* 超级管理员路由 */}
                      <Route 
                        path="/tenants" 
                        element={
                          <AuthGuard requiredRole="super_admin">
                            <TenantManagement />
                          </AuthGuard>
                        } 
                      />
                      
                      <Route 
                        path="/permissions" 
                        element={
                          <AuthGuard requiredRole="super_admin">
                            <PermissionManagement />
                          </AuthGuard>
                        } 
                      />
                    </Routes>
                  </Box>
                </Box>
              </AuthGuard>
            }
          />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
