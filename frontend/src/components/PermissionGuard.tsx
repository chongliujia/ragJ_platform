/**
 * 权限守卫组件 - 基于用户权限控制UI显示
 */

import React from 'react';
import { AuthManager } from '../services/authApi';
import type { UserInfo } from '../types/auth';

interface PermissionGuardProps {
  children: React.ReactNode;
  permission?: string;
  role?: string;
  roles?: string[];
  fallback?: React.ReactNode;
  requireAll?: boolean; // 是否需要满足所有权限/角色
}

const PermissionGuard: React.FC<PermissionGuardProps> = ({
  children,
  permission,
  role,
  roles,
  fallback = null,
  requireAll = false,
}) => {
  const authManager = AuthManager.getInstance();
  const currentUser: UserInfo | null = authManager.getCurrentUser();

  if (!currentUser) {
    return <>{fallback}</>;
  }

  // 检查角色权限
  const hasRole = (requiredRole: string): boolean => {
    // 超级管理员拥有所有权限
    if (currentUser.role === 'super_admin') {
      return true;
    }
    
    return currentUser.role === requiredRole;
  };

  // 检查多个角色
  const hasAnyRole = (requiredRoles: string[]): boolean => {
    if (currentUser.role === 'super_admin') {
      return true;
    }
    
    return requiredRoles.includes(currentUser.role);
  };

  // 检查所有角色
  const hasAllRoles = (requiredRoles: string[]): boolean => {
    if (currentUser.role === 'super_admin') {
      return true;
    }
    
    // 对于单个用户来说，检查所有角色意味着用户必须是最高级别的角色
    const roleHierarchy = ['guest', 'user', 'admin', 'super_admin'];
    const userRoleIndex = roleHierarchy.indexOf(currentUser.role);
    const maxRequiredRoleIndex = Math.max(...requiredRoles.map(r => roleHierarchy.indexOf(r)));
    
    return userRoleIndex >= maxRequiredRoleIndex;
  };

  // 检查具体权限 (TODO: 实现具体的权限检查逻辑)
  const hasPermission = (requiredPermission: string): boolean => {
    // 超级管理员拥有所有权限
    if (currentUser.role === 'super_admin') {
      return true;
    }

    // 这里可以根据实际的权限系统实现具体的权限检查
    // 目前简化为基于角色的检查
    const rolePermissions: Record<string, string[]> = {
      'guest': ['view_public_content'],
      'user': ['view_public_content', 'manage_own_data', 'chat_access'],
      'admin': ['view_public_content', 'manage_own_data', 'chat_access', 'manage_users', 'view_analytics'],
      'super_admin': ['*'], // 所有权限
    };

    const userPermissions = rolePermissions[currentUser.role] || [];
    return userPermissions.includes('*') || userPermissions.includes(requiredPermission);
  };

  // 权限检查逻辑
  let hasAccess = true;

  if (permission) {
    hasAccess = hasAccess && hasPermission(permission);
  }

  if (role) {
    hasAccess = hasAccess && hasRole(role);
  }

  if (roles && roles.length > 0) {
    if (requireAll) {
      hasAccess = hasAccess && hasAllRoles(roles);
    } else {
      hasAccess = hasAccess && hasAnyRole(roles);
    }
  }

  return hasAccess ? <>{children}</> : <>{fallback}</>;
};

export default PermissionGuard;