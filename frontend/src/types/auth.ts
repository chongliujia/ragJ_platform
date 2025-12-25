/**
 * 认证相关类型定义
 */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  full_name?: string;
  tenant_slug?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: number;
    username: string;
    email: string;
    full_name: string;
    role: string;
    tenant_id: number;
  };
}

export interface UserInfo {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  tenant_id: number;
  tenant_name: string;
  created_at: string;
}

export interface Permission {
  name: string;
  display_name: string;
  description: string;
  category: string;
}

export interface UserConfig {
  id: number;
  user_id: number;
  preferred_chat_model: string;
  preferred_embedding_model: string;
  preferred_rerank_model: string;
  max_tokens: number;
  temperature: string;
  top_p: string;
  retrieval_top_k: number;
  chunk_size: number;
  chunk_overlap: number;
  theme: string;
  language: string;
  custom_settings: Record<string, any>;
  chat_system_prompt?: string;
  created_at: string;
  updated_at: string;
}
