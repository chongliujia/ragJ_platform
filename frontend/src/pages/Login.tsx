/**
 * 登录页面 - 现代科技风格
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  Tabs,
  Tab,
  FormControlLabel,
  Checkbox,
  alpha,
  useTheme,
  IconButton,
  InputAdornment,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Visibility,
  VisibilityOff,
  Login as LoginIcon,
  PersonAdd as RegisterIcon,
  SmartToy as BotIcon,
  Security as SecurityIcon,
  Email as EmailIcon,
  Person as PersonIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { AuthManager } from '../services/authApi';
import type { LoginRequest, RegisterRequest } from '../types/auth';

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
      id={`auth-tabpanel-${index}`}
      aria-labelledby={`auth-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 登录表单状态
  const [loginForm, setLoginForm] = useState<LoginRequest>({
    username: '',
    password: '',
  });

  // 注册表单状态
  const [registerForm, setRegisterForm] = useState<RegisterRequest>({
    username: '',
    email: '',
    password: '',
    full_name: '',
    tenant_slug: 'default',
  });

  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const authManager = AuthManager.getInstance();

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    setError(null);
    setSuccess(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await authManager.login(loginForm);
      setSuccess(t('auth.login.loginSuccess'));
      setTimeout(() => {
        navigate('/');
      }, 1000);
    } catch (error: any) {
      setError(error.response?.data?.detail || t('auth.login.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 验证密码确认
    if (registerForm.password !== confirmPassword) {
      setError(t('auth.register.passwordMismatch'));
      return;
    }

    // 基本验证
    if (!registerForm.username || !registerForm.email || !registerForm.password) {
      setError(t('auth.register.fillAllFields'));
      return;
    }

    setLoading(true);

    try {
      await authManager.register(registerForm);
      setSuccess(t('auth.register.registerSuccess'));
      setTimeout(() => {
        navigate('/');
      }, 1000);
    } catch (error: any) {
      setError(error.response?.data?.detail || t('auth.register.registerError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100vw',
        background: `linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 25%, #2a3441 50%, #1a1f2e 75%, #0a0e1a 100%)`,
        backgroundSize: '400% 400%',
        animation: 'gradientShift 15s ease infinite',
        '@keyframes gradientShift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `radial-gradient(circle at 20% 50%, rgba(0, 212, 255, 0.15) 0%, transparent 50%), 
                      radial-gradient(circle at 80% 20%, rgba(255, 107, 53, 0.1) 0%, transparent 50%), 
                      radial-gradient(circle at 40% 80%, rgba(0, 212, 255, 0.08) 0%, transparent 50%)`,
        },
      }}
    >
      {/* 背景动画元素 */}
      <Box
        sx={{
          position: 'absolute',
          top: '10%',
          left: '10%',
          width: 60,
          height: 60,
          background: 'rgba(0, 212, 255, 0.1)',
          borderRadius: '50%',
          animation: 'float 6s ease-in-out infinite',
          '@keyframes float': {
            '0%, 100%': { transform: 'translateY(0px)' },
            '50%': { transform: 'translateY(-20px)' },
          },
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '70%',
          right: '15%',
          width: 40,
          height: 40,
          background: 'rgba(255, 107, 53, 0.12)',
          borderRadius: '50%',
          animation: 'float 4s ease-in-out infinite 1s',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: '20%',
          left: '20%',
          width: 80,
          height: 80,
          background: 'rgba(0, 212, 255, 0.08)',
          borderRadius: '50%',
          animation: 'float 8s ease-in-out infinite 2s',
        }}
      />

	        <Grid 
	          container 
	          sx={{ 
	            minHeight: '100vh',
	            width: '100%'
	          }}
	        >
	          {/* 左侧品牌区域 - 桌面端显示 */}
	          <Grid 
	            size={{ xs: 12, md: 6 }}
	            sx={{ 
	              display: { xs: 'none', md: 'flex' },
	              alignItems: 'center',
	              justifyContent: 'center',
	              p: 4
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                textAlign: 'left',
                height: '100%',
                justifyContent: 'center',
                pr: 4,
              }}
            >
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                mb: { xs: 2, sm: 3 },
                justifyContent: { xs: 'center', lg: 'flex-start' },
                flexDirection: { xs: 'column', sm: 'row' },
                gap: { xs: 1, sm: 2 }
              }}>
                <Box
                  sx={{
                    background: 'linear-gradient(45deg, #00d4ff, #4dd0ff)',
                    borderRadius: 3,
                    p: { xs: 1.5, sm: 2 },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 32px rgba(0, 212, 255, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <BotIcon sx={{ fontSize: { xs: 32, sm: 40 }, color: 'white' }} />
                </Box>
                <Box>
                  <Typography
                    variant="h3"
                    sx={{
                      fontWeight: 800,
                      background: 'linear-gradient(45deg, #00d4ff, #ffffff)',
                      filter: 'drop-shadow(0 0 10px rgba(0, 212, 255, 0.3))',
                      backgroundClip: 'text',
                      textFillColor: 'transparent',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      lineHeight: 1.2,
                      fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' },
                    }}
	                  >
	                    {t('nav.brandName')}
	                  </Typography>
                  <Typography
                    variant="h6"
                    sx={{
                      color: 'rgba(255, 255, 255, 0.95)',
                      textShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
                      fontWeight: 300,
                      letterSpacing: { xs: 1, sm: 2 },
                      fontSize: { xs: '1rem', sm: '1.25rem' },
                    }}
                  >
                    PLATFORM
                  </Typography>
                </Box>
              </Box>
              
              <Typography
                variant="h5"
                sx={{
                  color: 'white',
                  fontWeight: 300,
                  mb: { xs: 1.5, sm: 2 },
                  fontSize: { xs: '1.25rem', sm: '1.5rem', md: '1.75rem' },
                }}
              >
                {t('auth.platform.title')}
              </Typography>
              
              <Typography
                variant="body1"
                sx={{
                  color: alpha(theme.palette.common.white, 0.8),
                  lineHeight: 1.6,
                  maxWidth: { xs: '100%', sm: 400 },
                  fontSize: { xs: '0.9rem', sm: '1rem' },
                  mb: { xs: 2, sm: 0 },
                }}
              >
                {t('auth.platform.description')}
              </Typography>

              {/* 特性标签 */}
              <Box sx={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: { xs: 0.5, sm: 1 }, 
                mt: { xs: 2, sm: 3 },
                justifyContent: { xs: 'center', lg: 'flex-start' }
              }}>
                {[t('auth.platform.features.multiTenant'), t('auth.platform.features.aiDriven'), t('auth.platform.features.realTimeChat'), t('auth.platform.features.secure')].map((feature) => (
                  <Box
                    key={feature}
                    sx={{
                      background: alpha(theme.palette.common.white, 0.1),
                      backdropFilter: 'blur(10px)',
                      border: `1px solid ${alpha(theme.palette.common.white, 0.2)}`,
                      borderRadius: 2,
                      px: { xs: 1.5, sm: 2 },
                      py: { xs: 0.25, sm: 0.5 },
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'white',
                        fontWeight: 500,
                        fontSize: { xs: '0.7rem', sm: '0.75rem' },
                      }}
                    >
                      {feature}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Grid>

	          {/* 手机端简化的品牌区域 */}
	          <Grid 
	            size={12} 
	            sx={{ 
	              display: { xs: 'block', md: 'none' }, // 只在小屏幕显示
	              textAlign: 'center',
	              mb: 2,
	              order: 1
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
              <Box
                sx={{
                  background: `linear-gradient(45deg, ${theme.palette.primary.light}, ${theme.palette.secondary.main})`,
                  borderRadius: 2,
                  p: 1,
                  mr: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 16px ${alpha(theme.palette.primary.main, 0.3)}`,
                }}
              >
                <BotIcon sx={{ fontSize: 24, color: 'white' }} />
              </Box>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 700,
                  color: 'white',
                }}
	              >
	                {t('nav.platformName')}
	              </Typography>
            </Box>
          </Grid>

	          {/* 登录表单 */}
	          <Grid 
	            size={{ xs: 12, md: 6 }}
	            sx={{ 
	              display: 'flex',
	              alignItems: 'center',
	              justifyContent: 'center',
	              p: { xs: 2, md: 4 }
            }}
          >
	            <Paper
	              elevation={0}
	              sx={{
	                background: 'rgba(255, 255, 255, 0.96)',
	                backdropFilter: 'blur(20px)',
	                border: '1px solid rgba(0, 212, 255, 0.1)',
	                borderRadius: { xs: 3, sm: 4 },
	                overflow: 'hidden',
	                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.05)',
	                position: 'relative',
	                transition: 'transform 200ms ease, box-shadow 200ms ease',
	                '&::before': {
	                  content: '""',
	                  position: 'absolute',
	                  top: 0,
	                  left: 0,
	                  right: 0,
	                  height: 2,
	                  background: 'linear-gradient(90deg, rgba(0, 212, 255, 0.9), rgba(255, 107, 53, 0.9))',
	                  opacity: 0.85,
	                },
	                '&:hover': {
	                  transform: { md: 'translateY(-2px)' },
	                  boxShadow:
	                    '0 24px 60px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.06)',
	                },
	                width: '100%',
	                maxWidth: { xs: '100%', sm: 520, md: 440 },
	                mx: 'auto',
	              }}
	            >
              {/* 语言切换器 */}
              <Box sx={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                p: 2,
                borderBottom: '1px solid rgba(0, 212, 255, 0.1)',
                '& .MuiIconButton-root': {
                  color: '#00d4ff',
                  backgroundColor: 'rgba(0, 212, 255, 0.08)',
                  border: '1px solid rgba(0, 212, 255, 0.2)',
                  '&:hover': {
                    backgroundColor: 'rgba(0, 212, 255, 0.15)',
                    transform: 'scale(1.05)',
                    color: '#0099cc'
                  }
                },
                '& .MuiSvgIcon-root': {
                  fontSize: '1.2rem'
                }
              }}>
                <LanguageSwitcher />
              </Box>
              
              {/* 标签栏 */}
              <Box
                sx={{
                  background: 'rgba(0, 212, 255, 0.03)',
                  borderBottom: '1px solid rgba(0, 212, 255, 0.15)',
                }}
              >
                <Tabs 
                  value={tabValue} 
                  onChange={handleTabChange} 
                  centered
                  sx={{
                    '& .MuiTab-root': {
                      textTransform: 'none',
                      fontWeight: 600,
                      fontSize: '1rem',
                      py: 2,
                    },
                    '& .Mui-selected': {
                      color: '#00d4ff',
                      fontWeight: 700,
                    },
                    '& .MuiTabs-indicator': {
                      height: 3,
                      borderRadius: 1.5,
                      background: 'linear-gradient(45deg, #00d4ff, #ff6b35)',
                    },
                  }}
                >
                  <Tab 
                    icon={<LoginIcon />} 
                    iconPosition="start"
                    label={t('auth.login.title')} 
                    id="auth-tab-0" 
                    aria-controls="auth-tabpanel-0" 
                  />
                  <Tab 
                    icon={<RegisterIcon />} 
                    iconPosition="start"
                    label={t('auth.register.title')} 
                    id="auth-tab-1" 
                    aria-controls="auth-tabpanel-1" 
                  />
                </Tabs>
              </Box>

          {/* 登录面板 */}
          <TabPanel value={tabValue} index={0}>
            <Box sx={{ p: { xs: 3, sm: 4 } }}>
              <Box sx={{ textAlign: 'center', mb: { xs: 3, sm: 4 } }}>
                <SecurityIcon sx={{ 
                  fontSize: { xs: 40, sm: 48 }, 
                  color: '#00d4ff',
                  filter: 'drop-shadow(0 0 8px rgba(0, 212, 255, 0.3))', 
                  mb: 2 
                }} />
                <Typography 
                  component="h1" 
                  variant="h4" 
                  fontWeight={700} 
                  gutterBottom
                  sx={{ 
                    fontSize: { xs: '1.75rem', sm: '2.125rem' },
                    color: '#2c3e50',
                    textShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  {t('auth.login.welcome')}
                </Typography>
                <Typography 
                  variant="body2" 
                  color="text.secondary"
                  sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}
                >
                  {t('auth.login.subtitle')}
                </Typography>
              </Box>
              
              {error && (
                <Alert 
                  severity="error" 
                  sx={{ 
                    mb: 3, 
                    borderRadius: 2,
                    '& .MuiAlert-icon': {
                      alignItems: 'center',
                    }
                  }}
                >
                  {error}
                </Alert>
              )}
              {success && (
                <Alert 
                  severity="success" 
                  sx={{ 
                    mb: 3, 
                    borderRadius: 2,
                    '& .MuiAlert-icon': {
                      alignItems: 'center',
                    }
                  }}
                >
                  {success}
                </Alert>
              )}

              <Box component="form" onSubmit={handleLogin}>
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                  placeholder={t('auth.login.usernamePlaceholder')}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonIcon color="action" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: theme.palette.primary.main,
                        },
                      },
                      '&.Mui-focused': {
                        boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.1)}`,
                      },
                    },
                  }}
                />
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  autoComplete="current-password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  placeholder={t('auth.login.passwordPlaceholder')}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle password visibility"
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        '& .MuiOutlinedInput-notchedOutline': {
                          borderColor: theme.palette.primary.main,
                        },
                      },
                      '&.Mui-focused': {
                        boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.1)}`,
                      },
                    },
                  }}
                />
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, mb: 3 }}>
                  <FormControlLabel
	                    control={
	                      <Checkbox
	                        checked={rememberMe}
	                        onChange={(e) => setRememberMe(e.target.checked)}
	                        color="primary"
	                        sx={{
	                          '&.Mui-checked': {
                            color: theme.palette.primary.main,
                          },
                        }}
                      />
                    }
                    label={
                      <Typography variant="body2" color="text.secondary">
                        {t('auth.login.rememberMe')}
                      </Typography>
                    }
                  />
                  <Link 
                    href="#" 
                    variant="body2"
                    sx={{
                      color: theme.palette.primary.main,
                      textDecoration: 'none',
                      fontWeight: 500,
                      '&:hover': {
                        textDecoration: 'underline',
                      },
                    }}
                  >
                    {t('auth.login.forgotPassword')}
                  </Link>
                </Box>

                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  disabled={loading}
                  sx={{
                    mt: 2,
                    mb: 2,
                    py: 1.5,
                    borderRadius: 2,
                    background: 'linear-gradient(45deg, #00d4ff, #0099cc)',
                    color: 'white',
                    fontWeight: 600,
                    boxShadow: '0 8px 32px rgba(0, 212, 255, 0.4)',
                    fontSize: '1rem',
                    textTransform: 'none',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: '0 12px 40px rgba(0, 212, 255, 0.5)',
                    },
                    '&:disabled': {
                      background: theme.palette.action.disabledBackground,
                      color: theme.palette.action.disabled,
                    },
                  }}
                >
                  {loading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        sx={{
                          width: 20,
                          height: 20,
                          border: `2px solid ${alpha(theme.palette.common.white, 0.3)}`,
                          borderTop: `2px solid white`,
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite',
                          '@keyframes spin': {
                            '0%': { transform: 'rotate(0deg)' },
                            '100%': { transform: 'rotate(360deg)' },
                          },
                        }}
                      />
                      {t('auth.login.loginning')}
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LoginIcon />
                      {t('auth.login.loginButton')}
                    </Box>
                  )}
                </Button>
              </Box>
            </Box>
          </TabPanel>

              {/* 注册面板 */}
              <TabPanel value={tabValue} index={1}>
                <Box sx={{ p: { xs: 3, sm: 4 } }}>
                  <Box sx={{ textAlign: 'center', mb: { xs: 3, sm: 4 } }}>
                    <RegisterIcon sx={{ 
                      fontSize: { xs: 40, sm: 48 }, 
                      color: '#ff6b35',
                      filter: 'drop-shadow(0 0 8px rgba(255, 107, 53, 0.3))', 
                      mb: 2 
                    }} />
                    <Typography 
                      component="h1" 
                      variant="h4" 
                      fontWeight={700} 
                      gutterBottom
                      sx={{ 
                        fontSize: { xs: '1.75rem', sm: '2.125rem' },
                        color: '#2c3e50',
                        textShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      {t('auth.register.welcome')}
                    </Typography>
                    <Typography 
                      variant="body2" 
                      color="text.secondary"
                      sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}
                    >
                      {t('auth.register.subtitle')}
                    </Typography>
                  </Box>
                  
                  {error && (
                    <Alert 
                      severity="error" 
                      sx={{ 
                        mb: 3, 
                        borderRadius: 2,
                        '& .MuiAlert-icon': {
                          alignItems: 'center',
                        }
                      }}
                    >
                      {error}
                    </Alert>
                  )}
                  {success && (
                    <Alert 
                      severity="success" 
                      sx={{ 
                        mb: 3, 
                        borderRadius: 2,
                        '& .MuiAlert-icon': {
                          alignItems: 'center',
                        }
                      }}
                    >
                      {success}
                    </Alert>
                  )}

                  <Box component="form" onSubmit={handleRegister}>
	                    <Grid container spacing={2}>
	                      <Grid size={{ xs: 12, sm: 6 }}>
	                        <TextField
	                          autoComplete="given-name"
	                          name="fullName"
                          fullWidth
                          id="fullName"
                          value={registerForm.full_name}
                          onChange={(e) => setRegisterForm({ ...registerForm, full_name: e.target.value })}
                          placeholder={t('auth.register.fullNamePlaceholder')}
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start">
                                <PersonIcon color="action" />
                              </InputAdornment>
                            ),
                          }}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              borderRadius: 2,
                              transition: 'all 0.3s ease',
                              '&:hover': {
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: theme.palette.secondary.main,
                                },
                              },
                              '&.Mui-focused': {
                                boxShadow: `0 0 0 3px ${alpha(theme.palette.secondary.main, 0.1)}`,
                              },
                            },
                          }}
                        />
	                      </Grid>
	                      <Grid size={{ xs: 12, sm: 6 }}>
	                        <TextField
	                          required
	                          fullWidth
                          id="username"
                          name="username"
                          autoComplete="username"
                          value={registerForm.username}
                          onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                          placeholder={t('auth.register.usernamePlaceholder')}
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start">
                                <PersonIcon color="action" />
                              </InputAdornment>
                            ),
                          }}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              borderRadius: 2,
                              transition: 'all 0.3s ease',
                              '&:hover': {
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: theme.palette.secondary.main,
                                },
                              },
                              '&.Mui-focused': {
                                boxShadow: `0 0 0 3px ${alpha(theme.palette.secondary.main, 0.1)}`,
                              },
                            },
                          }}
                        />
	                      </Grid>
	                      <Grid size={12}>
	                        <TextField
	                          required
	                          fullWidth
                          id="email"
                          name="email"
                          autoComplete="email"
                          type="email"
                          value={registerForm.email}
                          onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                          placeholder={t('auth.register.emailPlaceholder')}
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start">
                                <EmailIcon color="action" />
                              </InputAdornment>
                            ),
                          }}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              borderRadius: 2,
                              transition: 'all 0.3s ease',
                              '&:hover': {
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: theme.palette.secondary.main,
                                },
                              },
                              '&.Mui-focused': {
                                boxShadow: `0 0 0 3px ${alpha(theme.palette.secondary.main, 0.1)}`,
                              },
                            },
                          }}
                        />
	                      </Grid>
	                      <Grid size={12}>
	                        <TextField
	                          required
	                          fullWidth
                          name="password"
                          type={showPassword ? 'text' : 'password'}
                          id="password"
                          autoComplete="new-password"
                          value={registerForm.password}
                          onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                          placeholder={t('auth.register.passwordPlaceholder')}
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start">
                                <LockIcon color="action" />
                              </InputAdornment>
                            ),
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton
                                  aria-label="toggle password visibility"
                                  onClick={() => setShowPassword(!showPassword)}
                                  edge="end"
                                >
                                  {showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                              </InputAdornment>
                            ),
                          }}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              borderRadius: 2,
                              transition: 'all 0.3s ease',
                              '&:hover': {
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: theme.palette.secondary.main,
                                },
                              },
                              '&.Mui-focused': {
                                boxShadow: `0 0 0 3px ${alpha(theme.palette.secondary.main, 0.1)}`,
                              },
                            },
                          }}
                        />
	                      </Grid>
	                      <Grid size={12}>
	                        <TextField
	                          required
	                          fullWidth
                          name="confirmPassword"
                          type={showConfirmPassword ? 'text' : 'password'}
                          id="confirmPassword"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder={t('auth.register.confirmPasswordPlaceholder')}
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start">
                                <LockIcon color="action" />
                              </InputAdornment>
                            ),
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton
                                  aria-label="toggle confirm password visibility"
                                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                  edge="end"
                                >
                                  {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                              </InputAdornment>
                            ),
                          }}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              borderRadius: 2,
                              transition: 'all 0.3s ease',
                              '&:hover': {
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: theme.palette.secondary.main,
                                },
                              },
                              '&.Mui-focused': {
                                boxShadow: `0 0 0 3px ${alpha(theme.palette.secondary.main, 0.1)}`,
                              },
                            },
                          }}
                        />
                      </Grid>
                    </Grid>
                    
                    <Button
                      type="submit"
                      fullWidth
                      variant="contained"
                      disabled={loading}
                      sx={{
                        mt: 3,
                        mb: 2,
                        py: 1.5,
                        borderRadius: 2,
                        background: 'linear-gradient(45deg, #ff6b35, #00d4ff)',
                        color: 'white',
                        fontWeight: 600,
                        boxShadow: '0 8px 32px rgba(255, 107, 53, 0.4)',
                        fontSize: '1rem',
                        textTransform: 'none',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: '0 12px 40px rgba(255, 107, 53, 0.5)',
                        },
                        '&:disabled': {
                          background: theme.palette.action.disabledBackground,
                          color: theme.palette.action.disabled,
                        },
                      }}
                    >
                      {loading ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box
                            sx={{
                              width: 20,
                              height: 20,
                              border: `2px solid ${alpha(theme.palette.common.white, 0.3)}`,
                              borderTop: `2px solid white`,
                              borderRadius: '50%',
                              animation: 'spin 1s linear infinite',
                              '@keyframes spin': {
                                '0%': { transform: 'rotate(0deg)' },
                                '100%': { transform: 'rotate(360deg)' },
                              },
                            }}
                          />
                          {t('auth.register.registering')}
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <RegisterIcon />
                          {t('auth.register.registerButton')}
                        </Box>
                      )}
                    </Button>
                  </Box>
                </Box>
              </TabPanel>
            </Paper>
          </Grid>
          {/* 底部版权信息 */}
	          <Grid size={12} sx={{ 
	            position: 'absolute',
	            bottom: 20,
	            left: 0,
	            right: 0,
            textAlign: 'center',
            display: { xs: 'block', md: 'none' }
          }}>
            <Typography 
              variant="body2" 
              sx={{ 
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '0.75rem'
              }}
            >
              © {new Date().getFullYear()} {t('nav.platformName')}. {t('auth.platform.copyright')}
            </Typography>
          </Grid>
        </Grid>
    </Box>
  );
};

export default Login;
