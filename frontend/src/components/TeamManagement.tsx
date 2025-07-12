/**
 * 团队管理主组件
 */

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
  Divider,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PersonAdd as PersonAddIcon,
  ExitToApp as ExitIcon,
  Group as GroupIcon,
} from '@mui/icons-material';
import { useTeam, useCreateTeam, useInviteUser, useJoinTeam } from '../hooks/useTeam';
import { teamApi } from '../services/api';
import type { Team, CreateTeamData, InviteUserData } from '../types';
import { TEAM_TYPES, MEMBER_TYPES } from '../types';

export const TeamManagement: React.FC = () => {
  const { 
    currentTeam, 
    teamMembers, 
    teamPermissions, 
    loading, 
    error, 
    refreshTeam, 
    refreshMembers,
    isTeamOwner,
    isTeamAdmin 
  } = useTeam();
  
  const { createTeam, loading: createLoading, error: createError } = useCreateTeam();
  const { inviteUser, loading: inviteLoading, error: inviteError } = useInviteUser();
  const { joinTeam, loading: joinLoading, error: joinError } = useJoinTeam();

  // 对话框状态
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // 表单数据
  const [createFormData, setCreateFormData] = useState<CreateTeamData>({
    name: '',
    description: '',
    team_type: 'collaborative',
    max_members: 100,
    is_private: true,
  });

  const [inviteFormData, setInviteFormData] = useState<InviteUserData>({
    email: '',
    target_member_type: 'member',
    message: '',
  });

  const [joinFormData, setJoinFormData] = useState({
    inviteCode: '',
  });

  // 处理创建团队
  const handleCreateTeam = async () => {
    try {
      await createTeam(createFormData);
      setCreateDialogOpen(false);
      setCreateFormData({
        name: '',
        description: '',
        team_type: 'collaborative',
        max_members: 100,
        is_private: true,
      });
      await refreshTeam();
    } catch (error) {
      console.error('Create team failed:', error);
    }
  };

  // 处理邀请用户
  const handleInviteUser = async () => {
    if (!currentTeam) return;

    try {
      await inviteUser(currentTeam.id, inviteFormData);
      setInviteDialogOpen(false);
      setInviteFormData({
        email: '',
        target_member_type: 'member',
        message: '',
      });
      await refreshMembers();
    } catch (error) {
      console.error('Invite user failed:', error);
    }
  };

  // 处理加入团队
  const handleJoinTeam = async () => {
    try {
      await joinTeam(joinFormData.inviteCode);
      setJoinDialogOpen(false);
      setJoinFormData({ inviteCode: '' });
      await refreshTeam();
    } catch (error) {
      console.error('Join team failed:', error);
    }
  };

  // 处理移除成员
  const handleRemoveMember = async (userId: number) => {
    if (!currentTeam) return;

    try {
      await teamApi.removeMember(currentTeam.id, userId);
      await refreshMembers();
    } catch (error) {
      console.error('Remove member failed:', error);
    }
  };

  // 处理离开团队
  const handleLeaveTeam = async () => {
    if (!currentTeam) return;

    const confirmed = window.confirm(
      isTeamOwner 
        ? '作为团队创建者，离开将删除整个团队。确认继续吗？'
        : '确认离开当前团队吗？'
    );

    if (!confirmed) return;

    try {
      if (isTeamOwner) {
        // 如果是团队创建者，删除团队
        await teamApi.deleteTeam(currentTeam.id);
      } else {
        // 如果是普通成员，使用离开团队API
        await teamApi.leaveTeam(currentTeam.id);
      }
      await refreshTeam();
    } catch (error) {
      console.error('Leave team failed:', error);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        团队管理
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {currentTeam ? (
        // 有团队的情况
        <Grid container spacing={3}>
          {/* 团队信息卡片 */}
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                  <Box display="flex" alignItems="center">
                    <GroupIcon sx={{ mr: 1, fontSize: 32 }} />
                    <Typography variant="h5">{currentTeam.name}</Typography>
                    <Chip 
                      label={currentTeam.team_type} 
                      size="small" 
                      sx={{ ml: 2 }} 
                    />
                  </Box>
                  <Box>
                    {isTeamAdmin && (
                      <IconButton onClick={() => setEditDialogOpen(true)}>
                        <EditIcon />
                      </IconButton>
                    )}
                    {isTeamOwner && (
                      <IconButton onClick={handleLeaveTeam} color="error">
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </Box>
                </Box>

                {currentTeam.description && (
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {currentTeam.description}
                  </Typography>
                )}

                <Box display="flex" gap={2} mb={2}>
                  <Typography variant="body2">
                    成员数量: {currentTeam.member_count}/{currentTeam.max_members}
                  </Typography>
                  <Typography variant="body2">
                    我的角色: <Chip label={currentTeam.my_member_type} size="small" />
                  </Typography>
                  <Typography variant="body2">
                    隐私: {currentTeam.is_private ? '私有' : '公开'}
                  </Typography>
                </Box>

                {teamPermissions.can_invite && (
                  <Button
                    variant="contained"
                    startIcon={<PersonAddIcon />}
                    onClick={() => setInviteDialogOpen(true)}
                    sx={{ mr: 2 }}
                  >
                    邀请成员
                  </Button>
                )}

                {!isTeamOwner && (
                  <Button
                    variant="outlined"
                    startIcon={<ExitIcon />}
                    onClick={handleLeaveTeam}
                    color="error"
                  >
                    离开团队
                  </Button>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* 团队成员列表 */}
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  团队成员
                </Typography>
                <List>
                  {teamMembers.map((member) => (
                    <ListItem key={member.user_id}>
                      <ListItemText
                        primary={member.username}
                        secondary={`${member.email} - ${member.member_type}`}
                      />
                      {teamPermissions.can_remove_members && 
                       member.member_type !== MEMBER_TYPES.OWNER && (
                        <ListItemSecondaryAction>
                          <IconButton 
                            edge="end" 
                            onClick={() => handleRemoveMember(member.user_id)}
                            color="error"
                            size="small"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      )}
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      ) : (
        // 没有团队的情况
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              您还没有加入任何团队
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              您可以创建一个新团队或通过邀请码加入现有团队。
            </Typography>
            
            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
              >
                创建团队
              </Button>
              <Button
                variant="outlined"
                onClick={() => setJoinDialogOpen(true)}
              >
                加入团队
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* 创建团队对话框 */}
      <Dialog 
        open={createDialogOpen} 
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>创建新团队</DialogTitle>
        <DialogContent>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}
          
          <TextField
            fullWidth
            label="团队名称"
            value={createFormData.name}
            onChange={(e) => setCreateFormData({
              ...createFormData,
              name: e.target.value
            })}
            margin="normal"
            required
          />
          
          <TextField
            fullWidth
            label="团队描述"
            value={createFormData.description}
            onChange={(e) => setCreateFormData({
              ...createFormData,
              description: e.target.value
            })}
            margin="normal"
            multiline
            rows={3}
          />
          
          <FormControl fullWidth margin="normal">
            <InputLabel>团队类型</InputLabel>
            <Select
              value={createFormData.team_type}
              onChange={(e) => setCreateFormData({
                ...createFormData,
                team_type: e.target.value as any
              })}
            >
              <MenuItem value={TEAM_TYPES.COLLABORATIVE}>协作团队</MenuItem>
              <MenuItem value={TEAM_TYPES.PROJECT}>项目团队</MenuItem>
            </Select>
          </FormControl>
          
          <TextField
            fullWidth
            label="最大成员数"
            type="number"
            value={createFormData.max_members}
            onChange={(e) => setCreateFormData({
              ...createFormData,
              max_members: parseInt(e.target.value) || 100
            })}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>
            取消
          </Button>
          <Button 
            onClick={handleCreateTeam}
            variant="contained"
            disabled={createLoading || !createFormData.name}
          >
            {createLoading ? <CircularProgress size={20} /> : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 邀请用户对话框 */}
      <Dialog 
        open={inviteDialogOpen} 
        onClose={() => setInviteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>邀请用户加入团队</DialogTitle>
        <DialogContent>
          {inviteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {inviteError}
            </Alert>
          )}
          
          <TextField
            fullWidth
            label="邮箱地址"
            type="email"
            value={inviteFormData.email}
            onChange={(e) => setInviteFormData({
              ...inviteFormData,
              email: e.target.value
            })}
            margin="normal"
            required
          />
          
          <FormControl fullWidth margin="normal">
            <InputLabel>成员角色</InputLabel>
            <Select
              value={inviteFormData.target_member_type}
              onChange={(e) => setInviteFormData({
                ...inviteFormData,
                target_member_type: e.target.value as any
              })}
            >
              <MenuItem value={MEMBER_TYPES.MEMBER}>普通成员</MenuItem>
              {isTeamOwner && (
                <MenuItem value={MEMBER_TYPES.ADMIN}>管理员</MenuItem>
              )}
            </Select>
          </FormControl>
          
          <TextField
            fullWidth
            label="邀请消息"
            value={inviteFormData.message}
            onChange={(e) => setInviteFormData({
              ...inviteFormData,
              message: e.target.value
            })}
            margin="normal"
            multiline
            rows={3}
            placeholder="可选：向被邀请人说明邀请原因..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInviteDialogOpen(false)}>
            取消
          </Button>
          <Button 
            onClick={handleInviteUser}
            variant="contained"
            disabled={inviteLoading || !inviteFormData.email}
          >
            {inviteLoading ? <CircularProgress size={20} /> : '发送邀请'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 加入团队对话框 */}
      <Dialog 
        open={joinDialogOpen} 
        onClose={() => setJoinDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>加入团队</DialogTitle>
        <DialogContent>
          {joinError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {joinError}
            </Alert>
          )}
          
          <TextField
            fullWidth
            label="邀请码"
            value={joinFormData.inviteCode}
            onChange={(e) => setJoinFormData({
              ...joinFormData,
              inviteCode: e.target.value
            })}
            margin="normal"
            required
            placeholder="请输入邀请码"
          />
          
          <Alert severity="warning" sx={{ mt: 2 }}>
            加入新团队将自动离开当前团队（如果有）。
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJoinDialogOpen(false)}>
            取消
          </Button>
          <Button 
            onClick={handleJoinTeam}
            variant="contained"
            disabled={joinLoading || !joinFormData.inviteCode}
          >
            {joinLoading ? <CircularProgress size={20} /> : '加入团队'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};