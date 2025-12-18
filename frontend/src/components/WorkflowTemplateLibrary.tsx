/**
 * 工作流模板库组件
 * 提供模板浏览、搜索、预览和使用功能
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Rating,
  IconButton,
  Alert,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import {
  Search as SearchIcon,
  AccountTree as WorkflowIcon,
  SmartToy as AIIcon,
  Description as DocumentIcon,
  Group as TeamIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Visibility as PreviewIcon,
  GetApp as UseIcon,
  TrendingUp as TrendingUpIcon,
  FilterList as FilterIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { workflowApi } from '../services/api';

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  tags: string[];
  author?: string;
  author_id?: number;
  version: string;
  created_at: string;
  updated_at: string;
  downloads: number;
  rating: number;
  rating_count: number;
  is_featured: boolean;
  is_premium: boolean;
  is_public?: boolean;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimated_time: string;
  nodes?: any[];
  edges?: any[];
  preview_image?: string;
  use_cases: string[];
  requirements: string[];
  similar_templates: string[];
}

interface TemplateCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  count: number;
  subcategories?: TemplateCategory[];
}

const WorkflowTemplateLibrary: React.FC = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  
  // 状态管理
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'popular' | 'newest' | 'rating' | 'name'>('popular');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [favoriteTemplates, setFavoriteTemplates] = useState<Set<string>>(new Set());
  const [currentTab, setCurrentTab] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // 分类元信息（用于 UI 图标/颜色）
  const CATEGORY_META: Record<string, { icon: React.ReactNode; color: string }> = {
    customer_service: { icon: <TeamIcon />, color: '#2196f3' },
    document_processing: { icon: <DocumentIcon />, color: '#4caf50' },
    ai_assistant: { icon: <AIIcon />, color: '#ff9800' },
    data_analysis: { icon: <TrendingUpIcon />, color: '#9c27b0' },
    custom: { icon: <WorkflowIcon />, color: '#607d8b' },
  };

  const getCategoryName = (id: string) =>
    t(`workflowTemplates.categories.${id}`, { defaultValue: id });

  const buildCategoriesFromTemplates = (tpls: WorkflowTemplate[]): TemplateCategory[] => {
    const counts: Record<string, number> = {};
    const subcounts: Record<string, Record<string, number>> = {};
    for (const t of tpls) {
      const cat = t.category || 'custom';
      counts[cat] = (counts[cat] || 0) + 1;
      if (t.subcategory) {
        subcounts[cat] = subcounts[cat] || {};
        subcounts[cat][t.subcategory] = (subcounts[cat][t.subcategory] || 0) + 1;
      }
    }
    const cats: TemplateCategory[] = Object.keys(counts)
      .sort()
      .map((id) => {
        const meta = CATEGORY_META[id] || { icon: <WorkflowIcon />, color: '#2196f3' };
        const subs = Object.entries(subcounts[id] || {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([sid, c]) => ({ id: sid, name: sid, icon: meta.icon, color: meta.color, count: c }));
        return { id, name: id, icon: meta.icon, color: meta.color, count: counts[id] || 0, subcategories: subs };
      });
    return cats;
  };

  const normalizeTemplate = (raw: any): WorkflowTemplate => {
    return {
      id: String(raw?.id || raw?.template_id || ''),
      name: String(raw?.name || ''),
      description: String(raw?.description || ''),
      category: String(raw?.category || 'custom'),
      subcategory: raw?.subcategory ? String(raw.subcategory) : undefined,
      tags: Array.isArray(raw?.tags) ? raw.tags.map((x: any) => String(x)) : [],
      author: raw?.author ? String(raw.author) : undefined,
      author_id: typeof raw?.author_id === 'number' ? raw.author_id : undefined,
      version: String(raw?.version || '1.0.0'),
      created_at: String(raw?.created_at || new Date().toISOString()),
      updated_at: String(raw?.updated_at || raw?.created_at || new Date().toISOString()),
      downloads: Number(raw?.downloads || 0),
      rating: Number(raw?.rating || 0),
      rating_count: Number(raw?.rating_count || 0),
      is_featured: !!raw?.is_featured,
      is_premium: !!raw?.is_premium,
      is_public: raw?.is_public != null ? !!raw.is_public : undefined,
      difficulty: (raw?.difficulty as any) || 'intermediate',
      estimated_time: String(raw?.estimated_time || ''),
      nodes: Array.isArray(raw?.nodes) ? raw.nodes : undefined,
      edges: Array.isArray(raw?.edges) ? raw.edges : undefined,
      use_cases: Array.isArray(raw?.use_cases) ? raw.use_cases : [],
      requirements: Array.isArray(raw?.requirements) ? raw.requirements : [],
      similar_templates: Array.isArray(raw?.similar_templates) ? raw.similar_templates : [],
    };
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await workflowApi.getTemplates({ limit: 500, offset: 0, sort_by: 'popular', mine: mineOnly });
        const list = Array.isArray(resp.data) ? resp.data : [];
        const tpls = list.map(normalizeTemplate);
        setTemplates(tpls);
        setCategories(buildCategoriesFromTemplates(tpls));
        const savedFavorites = localStorage.getItem('workflow_template_favorites');
        if (savedFavorites) setFavoriteTemplates(new Set(JSON.parse(savedFavorites)));
      } catch (e: any) {
        setTemplates([]);
        setCategories([]);
        setError(e?.response?.data?.detail || t('workflowTemplates.messages.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [mineOnly, reloadNonce, t, i18n.language]);

  // 过滤和排序模板
  const filteredAndSortedTemplates = React.useMemo(() => {
    let filtered = templates;

    // 分类过滤
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(template => 
        template.category === selectedCategory || 
        template.subcategory === selectedCategory
      );
    }

    // 难度过滤
    if (difficultyFilter !== 'all') {
      filtered = filtered.filter(template => template.difficulty === difficultyFilter);
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(template => 
        template.name.toLowerCase().includes(query) ||
        template.description.toLowerCase().includes(query) ||
        template.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // 排序
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'popular':
          return b.downloads - a.downloads;
        case 'newest':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'rating':
          return b.rating - a.rating;
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return filtered;
  }, [templates, selectedCategory, difficultyFilter, searchQuery, sortBy]);

  // 处理收藏
  const handleToggleFavorite = (templateId: string) => {
    const newFavorites = new Set(favoriteTemplates);
    if (newFavorites.has(templateId)) {
      newFavorites.delete(templateId);
    } else {
      newFavorites.add(templateId);
    }
    
    setFavoriteTemplates(newFavorites);
    localStorage.setItem('workflow_template_favorites', JSON.stringify(Array.from(newFavorites)));
  };

  // 处理模板预览
  const handlePreviewTemplate = async (template: WorkflowTemplate) => {
    setSelectedTemplate(template);
    setPreviewDialogOpen(true);
    try {
      const res = await workflowApi.getTemplateDetail(template.id);
      setSelectedTemplate(normalizeTemplate(res.data));
    } catch (e) {
      console.error('Failed to load template detail:', e);
    }
  };

  // 处理使用模板
  const handleUseTemplate = async (template: WorkflowTemplate) => {
    try {
      const resp = await workflowApi.useTemplate(template.id);
      const workflowId = resp.data?.workflow_id || resp.data?.id;
      if (workflowId) navigate(`/workflows/${workflowId}/edit`);
    } catch (e) {
      console.error('Use template failed:', e);
      alert(t('workflowTemplates.messages.useFailed'));
    }
  };

  // 获取难度颜色
  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner': return '#4caf50';
      case 'intermediate': return '#ff9800';
      case 'advanced': return '#f44336';
      default: return '#9e9e9e';
    }
  };

  // 获取难度文本
  const getDifficultyText = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner': return t('workflowTemplates.difficulty.beginner');
      case 'intermediate': return t('workflowTemplates.difficulty.intermediate');
      case 'advanced': return t('workflowTemplates.difficulty.advanced');
      default: return t('workflowTemplates.difficulty.unknown');
    }
  };

  // 渲染模板卡片
  const renderTemplateCard = (template: WorkflowTemplate) => {
    const isFavorite = favoriteTemplates.has(template.id);
    
    return (
      <Card
        key={template.id}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
          border: '1px solid rgba(0, 212, 255, 0.2)',
          borderRadius: 3,
          transition: 'all 0.3s ease',
          position: 'relative',
          '&:hover': {
            borderColor: 'rgba(0, 212, 255, 0.4)',
            transform: 'translateY(-4px)',
            boxShadow: '0 8px 25px rgba(0, 212, 255, 0.2)',
          },
        }}
      >
        {/* 特色标识 */}
        {template.is_featured && (
          <Chip
            label={t('workflowTemplates.badges.featured')}
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'linear-gradient(45deg, #ff6b6b 0%, #ee5a24 100%)',
              color: 'white',
              fontWeight: 'bold',
              zIndex: 1,
            }}
          />
        )}
        
        {/* 高级标识 */}
        {template.is_premium && (
          <Chip
            label={t('workflowTemplates.badges.premium')}
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              right: template.is_featured ? 72 : 8,
              background: 'linear-gradient(45deg, #f39c12 0%, #e67e22 100%)',
              color: 'white',
              fontWeight: 'bold',
              zIndex: 1,
            }}
          />
        )}

        <CardContent sx={{ flexGrow: 1, pb: 1 }}>
          {/* 头部信息 */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
            <Avatar
              sx={{
                bgcolor: categories.find(c => c.id === template.category)?.color || '#2196f3',
                mr: 2,
                width: 48,
                height: 48,
              }}
            >
              {categories.find(c => c.id === template.category)?.icon || <WorkflowIcon />}
            </Avatar>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 600, mb: 0.5 }}>
                {template.name}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Rating
                  value={template.rating}
                  precision={0.1}
                  size="small"
                  readOnly
                  sx={{
                    '& .MuiRating-iconFilled': { color: '#ffd700' },
                    '& .MuiRating-iconEmpty': { color: 'rgba(255, 255, 255, 0.3)' },
                  }}
                />
                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  ({template.rating_count})
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label={getDifficultyText(template.difficulty)}
                  size="small"
                  sx={{
                    backgroundColor: `${getDifficultyColor(template.difficulty)}20`,
                    color: getDifficultyColor(template.difficulty),
                    fontWeight: 'bold',
                  }}
                />
                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
                  {template.estimated_time}
                </Typography>
              </Box>
            </Box>
            <IconButton
              onClick={() => handleToggleFavorite(template.id)}
              sx={{ color: isFavorite ? '#ffd700' : 'rgba(255, 255, 255, 0.5)' }}
            >
              {isFavorite ? <StarIcon /> : <StarBorderIcon />}
            </IconButton>
          </Box>

          {/* 描述 */}
          <Typography
            variant="body2"
            sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 2, lineHeight: 1.5 }}
          >
            {template.description}
          </Typography>

          {/* 标签 */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
            {template.tags.slice(0, 3).map((tag, index) => (
              <Chip
                key={index}
                label={tag}
                size="small"
                sx={{
                  backgroundColor: 'rgba(0, 212, 255, 0.1)',
                  color: '#00d4ff',
                  fontSize: '0.7rem',
                }}
              />
            ))}
            {template.tags.length > 3 && (
              <Chip
                label={`+${template.tags.length - 3}`}
                size="small"
                sx={{
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.7rem',
                }}
              />
            )}
          </Box>

          {/* 统计信息 */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
                {t('workflowTemplates.stats.uses', { count: template.downloads })}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
                v{template.version}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              {template.author ||
                (template.author_id != null ? t('workflowTemplates.stats.authorId', { id: template.author_id }) : '')}
            </Typography>
          </Box>
        </CardContent>

        <CardActions sx={{ p: 2, pt: 0 }}>
          <Button
            startIcon={<PreviewIcon />}
            size="small"
            sx={{ color: 'rgba(255, 255, 255, 0.8)', mr: 1 }}
            onClick={() => handlePreviewTemplate(template)}
          >
            {t('workflowTemplates.actions.preview')}
          </Button>
          <Button
            startIcon={<UseIcon />}
            size="small"
            variant="contained"
            sx={{
              background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)',
              '&:hover': {
                background: 'linear-gradient(45deg, #0099cc 0%, #007acc 100%)',
              }
            }}
            onClick={() => handleUseTemplate(template)}
          >
            {t('workflowTemplates.actions.useTemplate')}
          </Button>
        </CardActions>
      </Card>
    );
  };

  // 渲染分类过滤器
  const renderCategoryFilter = () => (
    <Paper sx={{ p: 2, mb: 3, backgroundColor: 'rgba(26, 31, 46, 0.8)', border: '1px solid rgba(0, 212, 255, 0.2)' }}>
      <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
        {t('workflowTemplates.filters.categoryTitle')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Chip
          label={t('workflowTemplates.filters.all')}
          onClick={() => setSelectedCategory('all')}
          variant={selectedCategory === 'all' ? 'filled' : 'outlined'}
          sx={{
            ...(selectedCategory === 'all' ? {
              backgroundColor: '#00d4ff',
              color: 'white',
            } : {
              color: '#00d4ff',
              borderColor: '#00d4ff',
            })
          }}
        />
        {categories.map(category => (
          <Chip
            key={category.id}
            label={t('workflowTemplates.filters.categoryChip', {
              name: getCategoryName(category.id),
              count: category.count,
            })}
            onClick={() => setSelectedCategory(category.id)}
            variant={selectedCategory === category.id ? 'filled' : 'outlined'}
            sx={{
              ...(selectedCategory === category.id ? {
                backgroundColor: category.color,
                color: 'white',
              } : {
                color: category.color,
                borderColor: category.color,
              })
            }}
          />
        ))}
      </Box>
      
      {/* 子分类 */}
      {categories.find(c => c.id === selectedCategory)?.subcategories && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {categories.find(c => c.id === selectedCategory)?.subcategories?.map(subcat => (
            <Chip
              key={subcat.id}
              label={t('workflowTemplates.filters.subcategoryChip', { name: subcat.name, count: subcat.count })}
              onClick={() => setSelectedCategory(subcat.id)}
              size="small"
              variant="outlined"
              sx={{
                color: subcat.color,
                borderColor: subcat.color,
                '&:hover': {
                  backgroundColor: `${subcat.color}20`,
                }
              }}
            />
          ))}
        </Box>
      )}
    </Paper>
  );

  return (
    <Box sx={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 50%, #0f1419 100%)',
      p: 3
    }}>
      {/* 头部 */}
      <Box sx={{ mb: 4 }}>
        <Typography 
          variant="h4" 
          sx={{ 
            color: 'white',
            fontWeight: 700,
            mb: 1,
            background: 'linear-gradient(45deg, #00d4ff 30%, #9c27b0 90%)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {t('workflowTemplates.header.title')}
        </Typography>
        <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          {t('workflowTemplates.header.subtitle')}
        </Typography>
      </Box>

      {/* 搜索和过滤栏 */}
      <Paper sx={{ p: 2, mb: 3, backgroundColor: 'rgba(26, 31, 46, 0.8)', border: '1px solid rgba(0, 212, 255, 0.2)' }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            placeholder={t('workflowTemplates.search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />
                </InputAdornment>
              ),
            }}
            sx={{
              flexGrow: 1,
              minWidth: 300,
              '& .MuiOutlinedInput-root': {
                color: 'white',
                '& fieldset': {
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                },
                '&:hover fieldset': {
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#00d4ff',
                },
              },
            }}
          />
          
          <FormControl sx={{ minWidth: 120 }}>
            <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>{t('workflowTemplates.sort.label')}</InputLabel>
            <Select
              value={sortBy}
              label={t('workflowTemplates.sort.label')}
              onChange={(e) => setSortBy(e.target.value as any)}
              sx={{
                color: 'white',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#00d4ff',
                },
              }}
            >
              <MenuItem value="popular">{t('workflowTemplates.sort.popular')}</MenuItem>
              <MenuItem value="newest">{t('workflowTemplates.sort.newest')}</MenuItem>
              <MenuItem value="rating">{t('workflowTemplates.sort.rating')}</MenuItem>
              <MenuItem value="name">{t('workflowTemplates.sort.name')}</MenuItem>
            </Select>
          </FormControl>
          
          <FormControl sx={{ minWidth: 100 }}>
            <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>{t('workflowTemplates.difficultyFilter.label')}</InputLabel>
            <Select
              value={difficultyFilter}
              label={t('workflowTemplates.difficultyFilter.label')}
              onChange={(e) => setDifficultyFilter(e.target.value as string)}
              sx={{
                color: 'white',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#00d4ff',
                },
              }}
            >
              <MenuItem value="all">{t('workflowTemplates.filters.all')}</MenuItem>
              <MenuItem value="beginner">{t('workflowTemplates.difficulty.beginner')}</MenuItem>
              <MenuItem value="intermediate">{t('workflowTemplates.difficulty.intermediate')}</MenuItem>
              <MenuItem value="advanced">{t('workflowTemplates.difficulty.advanced')}</MenuItem>
            </Select>
          </FormControl>
          
          <Button
            startIcon={<FilterIcon />}
            onClick={() => setShowFilters(!showFilters)}
            sx={{ color: '#00d4ff' }}
          >
            {showFilters ? t('workflowTemplates.filters.hideFilters') : t('workflowTemplates.filters.showFilters')}
          </Button>

          <Button
            variant="outlined"
            onClick={() => setMineOnly((v) => !v)}
            sx={{ color: '#00d4ff', borderColor: 'rgba(0, 212, 255, 0.35)' }}
          >
            {mineOnly ? t('workflowTemplates.filters.viewAll') : t('workflowTemplates.filters.mineOnly')}
          </Button>

          <Button
            variant="outlined"
            onClick={async () => {
              try {
                await workflowApi.seedTemplates(false);
                setReloadNonce((n) => n + 1);
              } catch (e) {
                console.error('seed templates failed:', e);
                alert(t('workflowTemplates.messages.seedFailed'));
              }
            }}
            sx={{ color: '#00d4ff', borderColor: 'rgba(0, 212, 255, 0.35)' }}
          >
            {t('workflowTemplates.actions.seedTemplates')}
          </Button>

          <Button
            variant="contained"
            sx={{
              background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)',
              '&:hover': { background: 'linear-gradient(45deg, #0099cc 0%, #007acc 100%)' },
            }}
            onClick={() => navigate('/workflows/new')}
          >
            {t('workflowTemplates.actions.newWorkflow')}
          </Button>
        </Box>
      </Paper>

      {/* 分类过滤器 */}
      {showFilters && renderCategoryFilter()}

      {/* 标签页 */}
      <Paper sx={{ mb: 3, backgroundColor: 'rgba(26, 31, 46, 0.8)', border: '1px solid rgba(0, 212, 255, 0.2)' }}>
        <Tabs
          value={currentTab}
          onChange={(_e, newValue) => setCurrentTab(newValue)}
          sx={{
            '& .MuiTabs-indicator': {
              backgroundColor: '#00d4ff',
            },
            '& .MuiTab-root': {
              color: 'rgba(255, 255, 255, 0.7)',
              '&.Mui-selected': {
                color: '#00d4ff',
              },
            },
          }}
        >
          <Tab label={t('workflowTemplates.tabs.all', { count: filteredAndSortedTemplates.length })} />
          <Tab label={t('workflowTemplates.tabs.favorites', { count: favoriteTemplates.size })} />
          <Tab label={t('workflowTemplates.tabs.recent')} />
        </Tabs>
      </Paper>

      {/* 模板网格 */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            {t('common.loading')}
          </Typography>
        </Box>
      ) : (
        <>
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 2,
                backgroundColor: 'rgba(244, 67, 54, 0.12)',
                color: '#f44336',
                border: '1px solid rgba(244, 67, 54, 0.2)',
              }}
            >
              {error}
            </Alert>
          )}
          {filteredAndSortedTemplates.length === 0 ? (
            <Alert
              severity="info"
              sx={{
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                color: '#2196f3',
                border: '1px solid rgba(33, 150, 243, 0.2)'
              }}
            >
              {t('workflowTemplates.empty.noMatch')}
            </Alert>
          ) : (
            <Grid container spacing={3}>
              {(currentTab === 0 ? filteredAndSortedTemplates : 
                currentTab === 1 ? filteredAndSortedTemplates.filter(t => favoriteTemplates.has(t.id)) :
                [])
                .map(renderTemplateCard)}
            </Grid>
          )}
        </>
      )}

      {/* 模板预览对话框 */}
      <Dialog
        open={previewDialogOpen}
        onClose={() => setPreviewDialogOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(26, 31, 46, 0.95)',
            color: 'white',
            border: '1px solid rgba(0, 212, 255, 0.2)',
          }
        }}
      >
        {selectedTemplate && (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar
                  sx={{
                    bgcolor: categories.find(c => c.id === selectedTemplate.category)?.color || '#2196f3',
                    width: 40,
                    height: 40,
                  }}
                >
                  {categories.find(c => c.id === selectedTemplate.category)?.icon || <WorkflowIcon />}
                </Avatar>
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {selectedTemplate.name}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Rating
                      value={selectedTemplate.rating}
                      precision={0.1}
                      size="small"
                      readOnly
                      sx={{
                        '& .MuiRating-iconFilled': { color: '#ffd700' },
                        '& .MuiRating-iconEmpty': { color: 'rgba(255, 255, 255, 0.3)' },
                      }}
                    />
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                      {t('workflowTemplates.preview.reviews', { count: selectedTemplate.rating_count })}
                    </Typography>
                  </Box>
                </Box>
                <IconButton
                  onClick={() => setPreviewDialogOpen(false)}
                  sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
                >
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            
            <DialogContent>
              <Box sx={{ mb: 3 }}>
                <Typography variant="body1" sx={{ mb: 2, lineHeight: 1.6 }}>
                  {selectedTemplate.description}
                </Typography>
                
                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                  <Chip
                    label={getDifficultyText(selectedTemplate.difficulty)}
                    sx={{
                      backgroundColor: `${getDifficultyColor(selectedTemplate.difficulty)}20`,
                      color: getDifficultyColor(selectedTemplate.difficulty),
                    }}
                  />
                  <Chip
                    label={selectedTemplate.estimated_time}
                    sx={{
                      backgroundColor: 'rgba(0, 212, 255, 0.2)',
                      color: '#00d4ff',
                    }}
                  />
                  <Chip
                    label={t('workflowTemplates.stats.uses', { count: selectedTemplate.downloads })}
                    sx={{
                      backgroundColor: 'rgba(76, 175, 80, 0.2)',
                      color: '#4caf50',
                    }}
                  />
                </Box>
                
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 3 }}>
                  {selectedTemplate.tags.map((tag, index) => (
                    <Chip
                      key={index}
                      label={tag}
                      size="small"
                      sx={{
                        backgroundColor: 'rgba(156, 39, 176, 0.1)',
                        color: '#9c27b0',
                      }}
                    />
                  ))}
                </Box>
              </Box>
              
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Typography variant="h6" sx={{ mb: 2, color: '#00d4ff' }}>
                    {t('workflowTemplates.preview.sections.useCases')}
                  </Typography>
                  <List>
                    {(selectedTemplate.use_cases || []).map((useCase, index) => (
                      <ListItem key={index} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}>
                          <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: '#00d4ff' }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={useCase}
                          primaryTypographyProps={{
                            sx: { color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem' }
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Grid>
                
                <Grid size={{ xs: 12, md: 4 }}>
                  <Typography variant="h6" sx={{ mb: 2, color: '#4caf50' }}>
                    {t('workflowTemplates.preview.sections.requirements')}
                  </Typography>
                  <List>
                    {(selectedTemplate.requirements || []).map((req, index) => (
                      <ListItem key={index} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}>
                          <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: '#4caf50' }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={req}
                          primaryTypographyProps={{
                            sx: { color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem' }
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Grid>
                
                <Grid size={{ xs: 12, md: 4 }}>
                  <Typography variant="h6" sx={{ mb: 2, color: '#ff9800' }}>
                    {t('workflowTemplates.preview.sections.nodes')}
                  </Typography>
                  <List>
                    {(selectedTemplate.nodes || []).map((node, index) => (
                      <ListItem key={index} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}>
                          <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: '#ff9800' }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={node.name}
                          primaryTypographyProps={{
                            sx: { color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem' }
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Grid>
              </Grid>
            </DialogContent>
            
            <DialogActions sx={{ p: 3 }}>
              <Button
                onClick={() => setPreviewDialogOpen(false)}
                sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
              >
                {t('common.close')}
              </Button>
              <Button
                color="error"
                variant="outlined"
                onClick={async () => {
                  if (!selectedTemplate?.id) return;
                  if (!confirm(t('workflowTemplates.preview.confirmDelete'))) return;
                  try {
                    await workflowApi.deleteTemplate(selectedTemplate.id);
                    setPreviewDialogOpen(false);
                    setReloadNonce((n) => n + 1);
                  } catch (e) {
                    console.error('delete template failed:', e);
                    alert(t('workflowTemplates.preview.deleteFailed'));
                  }
                }}
                sx={{ borderColor: 'rgba(244, 67, 54, 0.45)' }}
              >
                {t('workflowTemplates.preview.delete')}
              </Button>
              <Button
                variant="outlined"
                onClick={async () => {
                  if (!selectedTemplate?.id) return;
                  try {
                    const nextPublic = !selectedTemplate.is_public;
                    await workflowApi.updateTemplate(selectedTemplate.id, { is_public: nextPublic });
                    setSelectedTemplate({ ...selectedTemplate, is_public: nextPublic });
                    setReloadNonce((n) => n + 1);
                  } catch (e) {
                    console.error('toggle template visibility failed:', e);
                    alert(t('workflowTemplates.preview.visibilityFailed'));
                  }
                }}
                sx={{ color: '#00d4ff', borderColor: 'rgba(0, 212, 255, 0.35)' }}
              >
                {selectedTemplate.is_public
                  ? t('workflowTemplates.preview.setPrivate')
                  : t('workflowTemplates.preview.setPublic')}
              </Button>
              <Button
                startIcon={<UseIcon />}
                variant="contained"
                onClick={() => {
                  handleUseTemplate(selectedTemplate);
                  setPreviewDialogOpen(false);
                }}
                sx={{
                  background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)',
                  '&:hover': {
                    background: 'linear-gradient(45deg, #0099cc 0%, #007acc 100%)',
                  }
                }}
              >
                {t('workflowTemplates.preview.useThis')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

export default WorkflowTemplateLibrary;
