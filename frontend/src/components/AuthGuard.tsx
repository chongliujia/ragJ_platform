/**
 * 认证守卫组件 - 保护需要登录的路由
 */

import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import { AuthManager } from '../services/authApi';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  requiredRole?: string;
  requiredPermission?: string;
}

const AuthGuard: React.FC<AuthGuardProps> = ({
  children,
  requireAuth = true,
  requiredRole,
  requiredPermission,
}) => {
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const authManager = AuthManager.getInstance();

  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      
      try {
        // 检查是否需要认证
        if (!requireAuth) {
          setIsAuthorized(true);
          return;
        }

        // 检查是否已登录
        if (!authManager.isAuthenticated()) {
          setIsAuthorized(false);
          return;
        }

        // 加载用户信息
        const user = await authManager.loadUserInfo();
        if (!user) {
          setIsAuthorized(false);
          return;
        }

        // 检查角色权限
        if (requiredRole) {
          // 超级管理员拥有所有权限
          if (user.role === 'super_admin') {
            setIsAuthorized(true);
            return;
          }
          
          // 其他角色需要精确匹配
          if (!authManager.hasRole(requiredRole)) {
            setIsAuthorized(false);
            return;
          }
        }

        // 检查具体权限
        if (requiredPermission && !authManager.hasPermission(requiredPermission)) {
          setIsAuthorized(false);
          return;
        }

        setIsAuthorized(true);
      } catch (error) {
        console.error('Auth check failed:', error);
        setIsAuthorized(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [requireAuth, requiredRole, requiredPermission]);

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthorized) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default AuthGuard;