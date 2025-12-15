/**
 * 团队选择器组件
 */

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Avatar,
  IconButton,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Group as GroupIcon,
  Settings as SettingsIcon,
  ExitToApp as ExitToAppIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useTeam } from '../hooks/useTeam';

interface TeamSelectorProps {
  onTeamSettingsClick?: () => void;
  onCreateTeamClick?: () => void;
  onJoinTeamClick?: () => void;
  compact?: boolean;
}

export const TeamSelector: React.FC<TeamSelectorProps> = ({
  onTeamSettingsClick,
  onCreateTeamClick,
  onJoinTeamClick,
  compact = false,
}) => {
  const { currentTeam, isTeamOwner, isTeamAdmin } = useTeam();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleMenuItemClick = (action: () => void) => {
    action();
    handleClose();
  };

  if (!currentTeam) {
    return (
      <Box
        display="flex"
        alignItems="center"
        sx={{
          p: compact ? 1 : 2,
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          cursor: 'pointer',
        }}
        onClick={onCreateTeamClick}
      >
        <Avatar sx={{ mr: 1, bgcolor: 'grey.300' }}>
          <AddIcon />
        </Avatar>
        {!compact && (
          <Box>
            <Typography variant="body2" color="text.secondary">
              未加入团队
            </Typography>
            <Typography variant="caption" color="text.secondary">
              点击创建或加入团队
            </Typography>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          p: compact ? 1 : 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          cursor: 'pointer',
          '&:hover': {
            bgcolor: 'action.hover',
          },
        }}
        onClick={handleClick}
      >
        <Box display="flex" alignItems="center" flex={1}>
          <Avatar sx={{ mr: compact ? 0 : 1, bgcolor: 'primary.main' }}>
            <GroupIcon />
          </Avatar>
          {!compact && (
            <Box flex={1} mr={1}>
              <Typography variant="body1" noWrap>
                {currentTeam.name}
              </Typography>
              <Box display="flex" alignItems="center" gap={1}>
                <Chip 
                  label={currentTeam.my_member_type} 
                  size="small" 
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary">
                  {currentTeam.member_count} 成员
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
        <IconButton size="small">
          <ExpandMoreIcon />
        </IconButton>
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        PaperProps={{
          sx: { minWidth: 200 },
        }}
      >
        <Box px={2} py={1}>
          <Typography variant="subtitle2" color="text.secondary">
            当前团队
          </Typography>
          <Typography variant="body1" fontWeight="medium">
            {currentTeam.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {currentTeam.team_type} · {currentTeam.member_count}/{currentTeam.max_members} 成员
          </Typography>
        </Box>
        
        <Divider />
        
        {(isTeamAdmin || isTeamOwner) && onTeamSettingsClick && (
          <MenuItem onClick={() => handleMenuItemClick(onTeamSettingsClick)}>
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>团队设置</ListItemText>
          </MenuItem>
        )}
        
        <Divider />
        
        {onCreateTeamClick && (
          <MenuItem onClick={() => handleMenuItemClick(onCreateTeamClick)}>
            <ListItemIcon>
              <AddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>创建团队</ListItemText>
          </MenuItem>
        )}
        
        {onJoinTeamClick && (
          <MenuItem onClick={() => handleMenuItemClick(onJoinTeamClick)}>
            <ListItemIcon>
              <ExitToAppIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>加入其他团队</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
};
