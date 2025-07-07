import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
} from '@mui/material';
import {
  MonetizationOn as EconomyIcon,
  Diamond as PremiumIcon,
  Translate as ChineseIcon,
} from '@mui/icons-material';
import type { ModelsConfig } from '../types/models';

interface ModelPresetsProps {
  onApplyPreset: (config: ModelsConfig) => void;
}

const ModelPresets: React.FC<ModelPresetsProps> = ({ onApplyPreset }) => {
  const { t } = useTranslation();
  
  // 预设配置
  const presets = [
    {
      id: 'economy',
      name: t('settings.presets.economy.name'),
      description: t('settings.presets.economy.description'),
      icon: <EconomyIcon />,
      color: 'success' as const,
      config: {
        chat: {
          type: 'chat' as const,
          provider: 'deepseek' as const,
          apiKey: '',
          model: 'deepseek-chat',
          temperature: 0.7,
          maxTokens: 2000,
          topP: 0.9,
        },
        embedding: {
          type: 'embedding' as const,
          provider: 'siliconflow' as const,
          apiKey: '',
          model: 'BAAI/bge-large-zh-v1.5',
        },
        rerank: {
          type: 'rerank' as const,
          provider: 'siliconflow' as const,
          apiKey: '',
          model: 'BAAI/bge-reranker-v2-m3',
        },
      },
    },
    {
      id: 'premium',
      name: t('settings.presets.premium.name'),
      description: t('settings.presets.premium.description'),
      icon: <PremiumIcon />,
      color: 'primary' as const,
      config: {
        chat: {
          type: 'chat' as const,
          provider: 'qwen' as const,
          apiKey: '',
          model: 'qwen-max',
          temperature: 0.7,
          maxTokens: 4000,
          topP: 0.9,
        },
        embedding: {
          type: 'embedding' as const,
          provider: 'qwen' as const,
          apiKey: '',
          model: 'text-embedding-v2',
        },
        rerank: {
          type: 'rerank' as const,
          provider: 'qwen' as const,
          apiKey: '',
          model: 'gte-rerank',
        },
      },
    },
    {
      id: 'chinese',
      name: t('settings.presets.chinese.name'),
      description: t('settings.presets.chinese.description'),
      icon: <ChineseIcon />,
      color: 'secondary' as const,
      config: {
        chat: {
          type: 'chat' as const,
          provider: 'qwen' as const,
          apiKey: '',
          model: 'qwen-plus',
          temperature: 0.7,
          maxTokens: 3000,
          topP: 0.9,
        },
        embedding: {
          type: 'embedding' as const,
          provider: 'siliconflow' as const,
          apiKey: '',
          model: 'BAAI/bge-large-zh-v1.5',
        },
        rerank: {
          type: 'rerank' as const,
          provider: 'siliconflow' as const,
          apiKey: '',
          model: 'BAAI/bge-reranker-v2-m3',
        },
      },
    },
  ];

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t('settings.presets.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('settings.presets.description')}
      </Typography>
      
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {presets.map((preset) => (
          <Card 
            key={preset.id}
            sx={{ 
              minWidth: 280,
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: 3,
              },
            }}
          >
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    height: 40,
                    borderRadius: 2,
                    backgroundColor: `${preset.color}.100`,
                    color: `${preset.color}.600`,
                    mr: 2,
                  }}
                >
                  {preset.icon}
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {preset.name}
                </Typography>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {preset.description}
              </Typography>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                <Chip 
                  label={`${t('settings.models.chat')}: ${preset.config.chat.provider}`} 
                  size="small" 
                  variant="outlined"
                />
                <Chip 
                  label={`${t('settings.models.embedding')}: ${preset.config.embedding.provider}`} 
                  size="small" 
                  variant="outlined"
                />
                <Chip 
                  label={`${t('settings.models.rerank')}: ${preset.config.rerank.provider}`} 
                  size="small" 
                  variant="outlined"
                />
              </Box>

              <Button
                variant="contained"
                color={preset.color}
                fullWidth
                onClick={() => onApplyPreset(preset.config)}
              >
                {t('common.apply')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
};

export default ModelPresets; 