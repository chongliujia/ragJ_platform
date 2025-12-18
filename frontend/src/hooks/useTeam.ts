/**
 * 团队管理相关的自定义 Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { teamApi } from '../services/api';
import type { Team, TeamMember, TeamPermission } from '../types';
import { MEMBER_TYPES } from '../types';

export interface UseTeamResult {
  currentTeam: Team | null;
  teamMembers: TeamMember[];
  teamPermissions: TeamPermission;
  loading: boolean;
  error: string | null;
  refreshTeam: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  isTeamOwner: boolean;
  isTeamAdmin: boolean;
  isTeamMember: boolean;
}

export const useTeam = (teamId?: number): UseTeamResult => {
  const { t } = useTranslation();
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 获取当前团队信息
  const refreshTeam = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      let response;
      if (teamId) {
        response = await teamApi.getTeam(teamId);
      } else {
        response = await teamApi.getCurrentTeam();
      }
      
      setCurrentTeam(response.data);
    } catch (err: any) {
      console.error('Failed to fetch team:', err);
      setError(err.response?.data?.detail || t('team.errors.fetchTeamFailed'));
      setCurrentTeam(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, t]);

  // 获取团队成员
  const refreshMembers = useCallback(async () => {
    if (!currentTeam?.id) return;

    try {
      const response = await teamApi.getTeamMembers(currentTeam.id);
      setTeamMembers(response.data);
    } catch (err: any) {
      console.error('Failed to fetch team members:', err);
      setError(err.response?.data?.detail || t('team.errors.fetchMembersFailed'));
    }
  }, [currentTeam?.id, t]);

  // 计算权限
  const teamPermissions: TeamPermission = {
    can_read: !!currentTeam,
    can_write: currentTeam?.my_member_type === MEMBER_TYPES.OWNER || 
               currentTeam?.my_member_type === MEMBER_TYPES.ADMIN,
    can_create: currentTeam?.my_member_type === MEMBER_TYPES.OWNER || 
                currentTeam?.my_member_type === MEMBER_TYPES.ADMIN,
    can_delete: currentTeam?.my_member_type === MEMBER_TYPES.OWNER,
    can_manage: currentTeam?.my_member_type === MEMBER_TYPES.OWNER,
    can_invite: currentTeam?.my_member_type === MEMBER_TYPES.OWNER || 
                currentTeam?.my_member_type === MEMBER_TYPES.ADMIN,
    can_remove_members: currentTeam?.my_member_type === MEMBER_TYPES.OWNER || 
                        currentTeam?.my_member_type === MEMBER_TYPES.ADMIN,
  };

  // 便捷权限检查
  const isTeamOwner = currentTeam?.my_member_type === MEMBER_TYPES.OWNER;
  const isTeamAdmin = currentTeam?.my_member_type === MEMBER_TYPES.ADMIN || isTeamOwner;
  const isTeamMember = !!currentTeam;

  // 初始化和团队变化时刷新数据
  useEffect(() => {
    refreshTeam();
  }, [refreshTeam]);

  useEffect(() => {
    if (currentTeam) {
      refreshMembers();
    }
  }, [currentTeam, refreshMembers]);

  return {
    currentTeam,
    teamMembers,
    teamPermissions,
    loading,
    error,
    refreshTeam,
    refreshMembers,
    isTeamOwner,
    isTeamAdmin,
    isTeamMember,
  };
};

export const useCreateTeam = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTeam = async (teamData: {
    name: string;
    description?: string;
    team_type?: string;
    max_members?: number;
    is_private?: boolean;
  }) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await teamApi.createTeam(teamData);
      return response.data;
    } catch (err: any) {
      console.error('Failed to create team:', err);
      setError(err.response?.data?.detail || t('team.errors.createTeamFailed'));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { createTeam, loading, error };
};

export const useInviteUser = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviteUser = async (teamId: number, inviteData: {
    email: string;
    target_role?: string;
    target_member_type?: string;
    message?: string;
  }) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await teamApi.inviteUser(teamId, inviteData);
      return response.data;
    } catch (err: any) {
      console.error('Failed to invite user:', err);
      setError(err.response?.data?.detail || t('team.errors.inviteUserFailed'));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { inviteUser, loading, error };
};

export const useJoinTeam = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinTeam = async (inviteCode: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await teamApi.joinTeam(inviteCode);
      return response.data;
    } catch (err: any) {
      console.error('Failed to join team:', err);
      setError(err.response?.data?.detail || t('team.errors.joinTeamFailed'));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { joinTeam, loading, error };
};
