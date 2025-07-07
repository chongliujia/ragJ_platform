import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Card,
  CardContent,
  Box,
  Paper,
  LinearProgress,
  Chip,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Description as DocumentIcon,
  Chat as ChatIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { systemApi, knowledgeBaseApi } from '../services/api';

interface SystemStats {
  knowledgeBases: number;
  documents: number;
  totalChats: number;
  systemStatus: 'healthy' | 'warning' | 'error';
}

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SystemStats>({
    knowledgeBases: 0,
    documents: 0,
    totalChats: 0,
    systemStatus: 'healthy',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        
        // 获取知识库数量
        const kbResponse = await knowledgeBaseApi.getList();
        const knowledgeBasesCount = kbResponse.data.length;
        
        // 尝试获取系统统计信息
        let systemStats = {
          documents: 0,
          totalChats: 0,
          systemStatus: 'healthy' as const,
        };
        
        try {
          const statsResponse = await systemApi.getStats();
          systemStats = {
            documents: statsResponse.data.documents || 0,
            totalChats: statsResponse.data.chats || 0,
            systemStatus: statsResponse.data.status || 'healthy',
          };
        } catch (error) {
          // 如果系统统计 API 不可用，使用默认值
          console.log('System stats API not available, using defaults');
        }
        
        setStats({
          knowledgeBases: knowledgeBasesCount,
          documents: systemStats.documents,
          totalChats: systemStats.totalChats,
          systemStatus: systemStats.systemStatus,
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        // 使用默认值
        setStats({
          knowledgeBases: 0,
          documents: 0,
          totalChats: 0,
          systemStatus: 'error',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const StatCard: React.FC<{
    title: string;
    value: number;
    icon: React.ReactNode;
    color: string;
  }> = ({ title, value, icon, color }) => (
    <Card sx={{ height: '100%', minWidth: 200 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              borderRadius: 2,
              backgroundColor: `${color}.100`,
              color: `${color}.600`,
              mr: 2,
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {loading ? '-' : value.toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {title}
            </Typography>
          </Box>
        </Box>
        {loading && <LinearProgress />}
      </CardContent>
    </Card>
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'success';
      case 'warning': return 'warning';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'healthy': return t('dashboard.status.healthy');
      case 'warning': return t('dashboard.status.warning');
      case 'error': return t('dashboard.status.error');
      default: return t('dashboard.status.unknown');
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold' }}>
        {t('dashboard.title')}
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 4, flexWrap: 'wrap' }}>
        <StatCard
          title={t('dashboard.stats.knowledgeBases')}
          value={stats.knowledgeBases}
          icon={<StorageIcon />}
          color="primary"
        />
        <StatCard
          title={t('dashboard.stats.documents')}
          value={stats.documents}
          icon={<DocumentIcon />}
          color="secondary"
        />
        <StatCard
          title={t('dashboard.stats.chats')}
          value={stats.totalChats}
          icon={<ChatIcon />}
          color="info"
        />
        <Card sx={{ height: '100%', minWidth: 200 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  backgroundColor: 'success.100',
                  color: 'success.600',
                  mr: 2,
                }}
              >
                <TrendingUpIcon />
              </Box>
              <Box>
                <Chip
                  label={getStatusText(stats.systemStatus)}
                  color={getStatusColor(stats.systemStatus) as any}
                  size="small"
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t('dashboard.stats.systemStatus')}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 300 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
              {t('dashboard.overview')}
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              {t('dashboard.welcome')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('dashboard.description')}
            </Typography>
            <Box component="ul" sx={{ pl: 2, mb: 0 }}>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                {t('dashboard.features.knowledgeBase')}
              </Typography>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                {t('dashboard.features.documents')}
              </Typography>
              <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                {t('dashboard.features.chat')}
              </Typography>
              <Typography component="li" variant="body2">
                {t('dashboard.features.settings')}
              </Typography>
            </Box>
          </Paper>
        </Box>
        
        <Box sx={{ flex: '0 0 300px' }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
              {t('dashboard.quickActions')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Chip
                label={t('dashboard.actions.createKnowledgeBase')}
                onClick={() => {/* TODO: 导航到创建页面 */}}
                clickable
                color="primary"
                variant="outlined"
              />
              <Chip
                label={t('dashboard.actions.uploadDocument')}
                onClick={() => {/* TODO: 导航到上传页面 */}}
                clickable
                color="secondary"
                variant="outlined"
              />
              <Chip
                label={t('dashboard.actions.startChat')}
                onClick={() => {/* TODO: 导航到聊天页面 */}}
                clickable
                color="info"
                variant="outlined"
              />
            </Box>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard; 