import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Box, Typography } from '@mui/material';
import './i18n';
import TopBar from './components/TopBar';
import { SnackbarProvider } from './components/SnackbarProvider';
import AuthGuard from './components/AuthGuard';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import KnowledgeBases from './pages/KnowledgeBases';
import Documents from './pages/Documents';
import Chat from './pages/Chat';
import Teams from './pages/Teams';
import Settings from './pages/Settings';
import WorkflowEditor from './pages/WorkflowEditor';
import WorkflowManagement from './pages/WorkflowManagement';
import WorkflowTemplateLibrary from './components/WorkflowTemplateLibrary';
import WorkflowTester from './pages/WorkflowTester';
import Test from './pages/Test';
import UserManagement from './pages/UserManagement';
import TenantManagement from './pages/TenantManagement';
import PermissionManagement from './pages/PermissionManagement';
import { AuthManager } from './services/authApi';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00d4ff',
      light: '#4dd0ff',
      dark: '#0099cc',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#ff6b35',
      light: '#ff9a66',
      dark: '#cc4f24',
      contrastText: '#ffffff',
    },
    background: {
      default: '#0a0e1a',
      paper: '#1a1f2e',
    },
    text: {
      primary: '#ffffff',
      secondary: '#b0b7c3',
    },
    divider: '#2d3748',
    error: {
      main: '#ff5252',
    },
    warning: {
      main: '#ffb74d',
    },
    info: {
      main: '#29b6f6',
    },
    success: {
      main: '#66bb6a',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 700,
      fontSize: '2.5rem',
      lineHeight: 1.2,
    },
    h2: {
      fontWeight: 600,
      fontSize: '2rem',
      lineHeight: 1.3,
    },
    h3: {
      fontWeight: 600,
      fontSize: '1.5rem',
      lineHeight: 1.4,
    },
    h4: {
      fontWeight: 600,
      fontSize: '1.25rem',
      lineHeight: 1.4,
    },
    h5: {
      fontWeight: 600,
      fontSize: '1.125rem',
      lineHeight: 1.5,
    },
    h6: {
      fontWeight: 600,
      fontSize: '1rem',
      lineHeight: 1.5,
    },
    body1: {
      fontSize: '0.875rem',
      lineHeight: 1.6,
    },
    body2: {
      fontSize: '0.75rem',
      lineHeight: 1.6,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarWidth: 'thin',
          scrollbarColor: '#4a5568 #1a202c',
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: '#1a202c',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: '#4a5568',
            borderRadius: '4px',
            '&:hover': {
              backgroundColor: '#718096',
            },
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          padding: '8px 24px',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 4px 12px rgba(0, 212, 255, 0.3)',
          },
        },
        contained: {
          background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
          boxShadow: '0 2px 8px rgba(0, 212, 255, 0.2)',
          '&:hover': {
            background: 'linear-gradient(135deg, #4dd0ff 0%, #00b3e6 100%)',
            boxShadow: '0 6px 20px rgba(0, 212, 255, 0.4)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#1a1f2e',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(10px)',
          transition: 'all 0.2s ease-in-out',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(26, 31, 46, 0.6) 100%)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          transition: 'all 0.3s ease-in-out',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 12px 30px rgba(0, 212, 255, 0.15)',
            borderColor: 'rgba(0, 212, 255, 0.3)',
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: 'rgba(26, 31, 46, 0.5)',
            borderRadius: 8,
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              backgroundColor: 'rgba(26, 31, 46, 0.7)',
            },
            '&.Mui-focused': {
              backgroundColor: 'rgba(26, 31, 46, 0.8)',
              boxShadow: '0 0 0 2px rgba(0, 212, 255, 0.2)',
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          backgroundColor: 'transparent',
        },
        head: {
          backgroundColor: 'rgba(0, 212, 255, 0.1)',
          fontWeight: 700,
          fontSize: '0.875rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: 'linear-gradient(180deg, #0a0e1a 0%, #1a1f2e 100%)',
          borderRight: '1px solid rgba(0, 212, 255, 0.2)',
          backdropFilter: 'blur(10px)',
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(45deg, transparent 0%, rgba(0, 212, 255, 0.05) 50%, transparent 100%)',
            pointerEvents: 'none',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 100%)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(0, 212, 255, 0.3)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(90deg, transparent 0%, rgba(0, 212, 255, 0.1) 50%, transparent 100%)',
            pointerEvents: 'none',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: 'all 0.3s ease-in-out',
          '&:hover': {
            transform: 'scale(1.1)',
            background: 'rgba(0, 212, 255, 0.1)',
            boxShadow: '0 0 15px rgba(0, 212, 255, 0.3)',
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          transition: 'all 0.3s ease-in-out',
          position: 'relative',
          '&:hover': {
            transform: 'translateX(4px)',
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '3px',
              background: 'linear-gradient(180deg, #00d4ff 0%, #0099cc 100%)',
              borderRadius: '0 2px 2px 0',
            },
          },
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
        },
      },
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
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'radial-gradient(circle at 50% 50%, rgba(0, 212, 255, 0.1) 0%, transparent 70%)',
              animation: 'pulse 3s ease-in-out infinite',
            },
            '@keyframes pulse': {
              '0%, 100%': { opacity: 0.5 },
              '50%': { opacity: 1 },
            },
          }}
        >
          <Box sx={{ textAlign: 'center', color: 'white' }}>
            <Box
              sx={{
                position: 'relative',
                width: 60,
                height: 60,
                margin: '0 auto 24px',
              }}
            >
              {/* 外圈旋转环 */}
              <Box
                sx={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  border: `3px solid rgba(0, 212, 255, 0.2)`,
                  borderTop: `3px solid #00d4ff`,
                  borderRadius: '50%',
                  animation: 'spin 1.5s linear infinite',
                  '@keyframes spin': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                  },
                }}
              />
              {/* 内圈脉冲 */}
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 30,
                  height: 30,
                  background: 'radial-gradient(circle, #00d4ff 0%, transparent 70%)',
                  borderRadius: '50%',
                  animation: 'pulse 2s ease-in-out infinite',
                  '@keyframes pulse': {
                    '0%, 100%': { 
                      transform: 'translate(-50%, -50%) scale(0.8)',
                      opacity: 0.5,
                    },
                    '50%': { 
                      transform: 'translate(-50%, -50%) scale(1.2)',
                      opacity: 1,
                    },
                  },
                }}
              />
              {/* 科技感粒子效果 */}
              <Box
                sx={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: -2,
                    left: -2,
                    right: -2,
                    bottom: -2,
                    background: 'conic-gradient(from 0deg, transparent, #00d4ff, transparent)',
                    borderRadius: '50%',
                    animation: 'rotate 3s linear infinite',
                    opacity: 0.3,
                  },
                  '@keyframes rotate': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                  },
                }}
              />
            </Box>
            <Typography variant="h6">加载中...</Typography>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider>
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
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  height: '100vh',
                  maxHeight: '100vh',
                  overflow: 'hidden'
                }}>
                  {/* 顶部导航栏 */}
                  <TopBar />
                  
                  {/* 主内容区域 */}
                  <Box
                    component="main"
                    sx={{
                      flexGrow: 1,
                      height: 'calc(100vh - 64px)', // 减去TopBar高度
                      overflow: 'auto',
                      backgroundColor: 'background.default',
                      p: { xs: 1, sm: 2, md: 3 },
                      // 针对移动设备优化
                      '@media (max-width: 768px)': {
                        p: 1,
                        height: 'calc(100vh - 56px)', // 移动端TopBar可能更小
                      },
                      // 针对平板设备优化
                      '@media (min-width: 769px) and (max-width: 1024px)': {
                        p: 2,
                      },
                      // 针对大屏幕设备优化
                      '@media (min-width: 1440px)': {
                        p: 4,
                      },
                    }}
                  >
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/knowledge-bases" element={<KnowledgeBases />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/chat" element={<Chat />} />
                      <Route path="/teams" element={<Teams />} />
                      <Route path="/workflows" element={<WorkflowManagement />} />
                      <Route path="/workflows/new" element={<WorkflowEditor />} />
                      <Route path="/workflows/:id/edit" element={<WorkflowEditor />} />
                      <Route path="/workflows/templates" element={<WorkflowTemplateLibrary />} />
                      <Route path="/workflows/:id/test" element={<WorkflowTester />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route 
                        path="/test" 
                        element={
                          <AuthGuard requiredRole="tenant_admin">
                            <Test />
                          </AuthGuard>
                        } 
                      />
                      
                      {/* 管理员路由 */}
                      <Route 
                        path="/users" 
                        element={
                          <AuthGuard requiredRole="tenant_admin">
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
      </SnackbarProvider>
    </ThemeProvider>
  );
}

export default App;
