/**
 * 认证相关API服务
 */

import { api } from './api';
import type {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  UserInfo,
  Permission,
  UserConfig,
} from '../types/auth';

// 重新导出类型以保持向后兼容
export type {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  UserInfo,
  Permission,
  UserConfig,
};

export const authApi = {
  // 用户登录
  login: async (credentials: LoginRequest): Promise<AuthResponse> => {
    const response = await api.post('/api/v1/auth/login', credentials);
    return response.data;
  },

  // 用户注册
  register: async (userData: RegisterRequest): Promise<AuthResponse> => {
    const response = await api.post('/api/v1/auth/register', userData);
    return response.data;
  },

  // 用户登出
  logout: async (): Promise<void> => {
    await api.post('/api/v1/auth/logout');
  },

  // 获取当前用户信息
  getCurrentUser: async (): Promise<UserInfo> => {
    const response = await api.get('/api/v1/auth/me');
    return response.data;
  },

  // 获取用户权限
  getUserPermissions: async (): Promise<{ permissions: Permission[] }> => {
    const response = await api.get('/api/v1/auth/permissions');
    return response.data;
  },

  // 获取用户配置
  getUserConfig: async (): Promise<UserConfig> => {
    const response = await api.get('/api/v1/users/config');
    return response.data;
  },

  // 更新用户配置
  updateUserConfig: async (config: Partial<UserConfig>): Promise<UserConfig> => {
    const response = await api.put('/api/v1/users/config', config);
    return response.data;
  },
};

// 认证状态管理
export class AuthManager {
  private static instance: AuthManager;
  private token: string | null = null;
  private user: UserInfo | null = null;

  private constructor() {
    // 从localStorage恢复token
    this.token = localStorage.getItem('auth_token');
    if (this.token) {
      this.setAuthHeader();
    }
  }

  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  // 设置认证头
  private setAuthHeader(): void {
    if (this.token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
    }
  }

  // 登录
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await authApi.login(credentials);
    this.token = response.access_token;
    localStorage.setItem('auth_token', this.token);
    this.setAuthHeader();
    
    // 获取用户信息
    await this.loadUserInfo();
    
    return response;
  }

  // 注册
  async register(userData: RegisterRequest): Promise<AuthResponse> {
    const response = await authApi.register(userData);
    this.token = response.access_token;
    localStorage.setItem('auth_token', this.token);
    this.setAuthHeader();
    
    // 获取用户信息
    await this.loadUserInfo();
    
    return response;
  }

  // 登出
  async logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.token = null;
      this.user = null;
      localStorage.removeItem('auth_token');
      delete api.defaults.headers.common['Authorization'];
    }
  }

  // 加载用户信息
  async loadUserInfo(): Promise<UserInfo | null> {
    if (!this.token) return null;
    
    try {
      this.user = await authApi.getCurrentUser();
      return this.user;
    } catch (error) {
      console.error('Failed to load user info:', error);
      this.logout(); // 清除无效token
      return null;
    }
  }

  // 检查是否已登录
  isAuthenticated(): boolean {
    return !!this.token;
  }

  // 获取当前用户
  getCurrentUser(): UserInfo | null {
    return this.user;
  }

  // 检查用户权限
  hasPermission(permission: string): boolean {
    if (!this.user) return false;
    
    // 超级管理员拥有所有权限
    if (this.user.role === 'super_admin') return true;
    
    // TODO: 实现具体的权限检查逻辑
    return true;
  }

  // 检查用户角色
  hasRole(role: string): boolean {
    return this.user?.role === role;
  }

  // 是否为管理员（包括超级管理员）
  isAdmin(): boolean {
    return this.user?.role === 'super_admin' || this.user?.role === 'admin';
  }

  // 是否为超级管理员
  isSuperAdmin(): boolean {
    return this.user?.role === 'super_admin';
  }
}