/**
 * 团队管理页面
 */

import React from 'react';
import { Container, Box } from '@mui/material';
import { TeamManagement } from '../components/TeamManagement';

export const Teams: React.FC = () => {
  return (
    <Container maxWidth="xl">
      <Box py={4}>
        <TeamManagement />
      </Box>
    </Container>
  );
};

export default Teams;