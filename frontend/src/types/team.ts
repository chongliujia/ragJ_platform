/**
 * 团队管理相关的TypeScript类型定义
 */

export interface Team {
  id: number;
  name: string;
  description?: string;
  team_type: 'personal' | 'collaborative' | 'project';
  max_members: number;
  member_count: number;
  created_by?: number;
  created_at: string;
  my_role?: string;
  my_member_type?: 'owner' | 'admin' | 'member';
  is_private: boolean;
}

export interface TeamMember {
  user_id: number;
  username: string;
  email: string;
  full_name?: string;
  role: string;
  member_type: 'owner' | 'admin' | 'member';
  join_time: string;
  invited_by?: number;
}

export interface TeamInvitation {
  id: string;
  team_id: number;
  team_name: string;
  inviter_id: number;
  inviter_name: string;
  invitee_email: string;
  invite_code: string;
  target_role: string;
  target_member_type: string;
  message?: string;
  expire_time?: string;
  status: '0' | '1' | '2'; // 0-过期 1-有效 2-已使用
  create_time: string;
}

export interface CreateTeamData {
  name: string;
  description?: string;
  team_type?: 'personal' | 'collaborative' | 'project';
  max_members?: number;
  is_private?: boolean;
}

export interface UpdateTeamData {
  name?: string;
  description?: string;
  team_type?: 'personal' | 'collaborative' | 'project';
  max_members?: number;
  is_private?: boolean;
}

export interface InviteUserData {
  email: string;
  target_role?: string;
  target_member_type?: 'owner' | 'admin' | 'member';
  message?: string;
}

export interface TeamStats {
  total_members: number;
  active_members: number;
  knowledge_bases: number;
  documents: number;
  storage_used_mb: number;
  storage_quota_mb: number;
}

export interface TeamPermission {
  can_read: boolean;
  can_write: boolean;
  can_create: boolean;
  can_delete: boolean;
  can_manage: boolean;
  can_invite: boolean;
  can_remove_members: boolean;
}

export const TEAM_TYPES = {
  PERSONAL: 'personal',
  COLLABORATIVE: 'collaborative',
  PROJECT: 'project',
} as const;

export const MEMBER_TYPES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export const TEAM_ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;