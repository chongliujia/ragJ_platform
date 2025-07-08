/**
 * 权限管理钩子
 */

import { useMemo } from 'react';
import { AuthManager } from '../services/authApi';
import type { UserInfo } from '../types/auth';

export const usePermissions = () => {
  const authManager = AuthManager.getInstance();
  const currentUser: UserInfo | null = authManager.getCurrentUser();

  const permissions = useMemo(() => {
    if (!currentUser) {
      return {
        hasRole: () => false,
        hasAnyRole: () => false,
        hasPermission: () => false,
        isAdmin: false,
        isSuperAdmin: false,
        isUser: false,
        isGuest: false,
        canManageUsers: false,
        canManageTenants: false,
        canManagePermissions: false,
        canViewAnalytics: false,
        canManageSystem: false,
      };
    }

    const hasRole = (role: string): boolean => {
      if (currentUser.role === 'super_admin') return true;
      return currentUser.role === role;
    };

    const hasAnyRole = (roles: string[]): boolean => {
      if (currentUser.role === 'super_admin') return true;
      return roles.includes(currentUser.role);
    };

    const hasPermission = (permission: string): boolean => {
      if (currentUser.role === 'super_admin') return true;

      const rolePermissions: Record<string, string[]> = {
        'guest': [
          'view_public_content',
        ],
        'user': [
          'view_public_content',
          'manage_own_data',
          'chat_access',
          'upload_documents',
          'create_knowledge_bases',
        ],
        'admin': [
          'view_public_content',
          'manage_own_data',
          'chat_access',
          'upload_documents',
          'create_knowledge_bases',
          'manage_users',
          'view_analytics',
          'manage_tenant_data',
        ],
        'super_admin': ['*'], // 所有权限
      };

      const userPermissions = rolePermissions[currentUser.role] || [];
      return userPermissions.includes('*') || userPermissions.includes(permission);
    };

    // 角色检查
    const isAdmin = hasAnyRole(['admin', 'super_admin']);
    const isSuperAdmin = hasRole('super_admin');
    const isUser = hasRole('user');
    const isGuest = hasRole('guest');

    // 功能权限检查
    const canManageUsers = hasAnyRole(['admin', 'super_admin']);
    const canManageTenants = hasRole('super_admin');
    const canManagePermissions = hasRole('super_admin');
    const canViewAnalytics = hasAnyRole(['admin', 'super_admin']);
    const canManageSystem = hasAnyRole(['admin', 'super_admin']);

    return {
      hasRole,
      hasAnyRole,
      hasPermission,
      isAdmin,
      isSuperAdmin,
      isUser,
      isGuest,
      canManageUsers,
      canManageTenants,
      canManagePermissions,
      canViewAnalytics,
      canManageSystem,
      user: currentUser,
    };
  }, [currentUser]);

  return permissions;
};

export default usePermissions;