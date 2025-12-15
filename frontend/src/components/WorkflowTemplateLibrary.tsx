/**
 * 工作流模板库组件
 * 提供模板浏览、搜索、预览和使用功能
 */

import React, { useState, useEffect } from 'react';
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
  Translate as TranslateIcon,
  Psychology as AnalyzeIcon,
  Group as TeamIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Visibility as PreviewIcon,
  GetApp as UseIcon,
  Code as CodeIcon,
  Timeline as TimelineIcon,
  TrendingUp as TrendingUpIcon,
  FilterList as FilterIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  tags: string[];
  author: string;
  version: string;
  created_at: string;
  updated_at: string;
  downloads: number;
  rating: number;
  rating_count: number;
  is_featured: boolean;
  is_premium: boolean;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimated_time: string;
  nodes: any[];
  edges: any[];
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

  // 模拟数据
  const mockCategories: TemplateCategory[] = [
    {
      id: 'customer_service',
      name: '客户服务',
      icon: <TeamIcon />,
      color: '#2196f3',
      count: 12,
      subcategories: [
        { id: 'chatbot', name: '聊天机器人', icon: <AIIcon />, color: '#2196f3', count: 8 },
        { id: 'ticket_system', name: '工单系统', icon: <DocumentIcon />, color: '#2196f3', count: 4 },
      ]
    },
    {
      id: 'document_processing',
      name: '文档处理',
      icon: <DocumentIcon />,
      color: '#4caf50',
      count: 15,
      subcategories: [
        { id: 'document_analysis', name: '文档分析', icon: <AnalyzeIcon />, color: '#4caf50', count: 8 },
        { id: 'translation', name: '翻译处理', icon: <TranslateIcon />, color: '#4caf50', count: 7 },
      ]
    },
    {
      id: 'ai_assistant',
      name: 'AI助手',
      icon: <AIIcon />,
      color: '#ff9800',
      count: 10,
      subcategories: [
        { id: 'qa_system', name: '问答系统', icon: <AnalyzeIcon />, color: '#ff9800', count: 6 },
        { id: 'writing_assistant', name: '写作助手', icon: <CodeIcon />, color: '#ff9800', count: 4 },
      ]
    },
    {
      id: 'data_analysis',
      name: '数据分析',
      icon: <TrendingUpIcon />,
      color: '#9c27b0',
      count: 8,
      subcategories: [
        { id: 'report_generation', name: '报表生成', icon: <TimelineIcon />, color: '#9c27b0', count: 5 },
        { id: 'trend_analysis', name: '趋势分析', icon: <TrendingUpIcon />, color: '#9c27b0', count: 3 },
      ]
    },
  ];

  const mockTemplates: WorkflowTemplate[] = [
    {
      id: 'customer-service-bot',
      name: '智能客服机器人',
      description: '基于RAG技术的智能客服系统，支持多轮对话和知识库检索',
      category: 'customer_service',
      subcategory: 'chatbot',
      tags: ['客服', 'RAG', '对话', '知识库'],
      author: 'AI团队',
      version: '2.1.0',
      created_at: '2024-01-10T10:00:00Z',
      updated_at: '2024-01-15T14:30:00Z',
      downloads: 1247,
      rating: 4.8,
      rating_count: 156,
      is_featured: true,
      is_premium: false,
      difficulty: 'intermediate',
      estimated_time: '30分钟',
      nodes: [
        { id: 'input', type: 'input', name: '用户输入' },
        { id: 'intent', type: 'classifier', name: '意图识别' },
        { id: 'rag', type: 'rag_retriever', name: '知识检索' },
        { id: 'llm', type: 'llm', name: '回复生成' },
        { id: 'output', type: 'output', name: '输出回复' },
      ],
      edges: [
        { id: 'e1', source: 'input', target: 'intent' },
        { id: 'e2', source: 'intent', target: 'rag' },
        { id: 'e3', source: 'rag', target: 'llm' },
        { id: 'e4', source: 'llm', target: 'output' },
      ],
      use_cases: ['客户咨询', '技术支持', '售后服务'],
      requirements: ['知识库文档', 'LLM API密钥'],
      similar_templates: ['advanced-chatbot', 'multilingual-support']
    },
    {
      id: 'document-analyzer',
      name: '文档智能分析',
      description: '自动提取文档关键信息并生成结构化摘要',
      category: 'document_processing',
      subcategory: 'document_analysis',
      tags: ['文档', '分析', '摘要', 'NLP'],
      author: '文档处理团队',
      version: '1.5.0',
      created_at: '2024-01-08T09:00:00Z',
      updated_at: '2024-01-12T16:45:00Z',
      downloads: 892,
      rating: 4.6,
      rating_count: 94,
      is_featured: false,
      is_premium: true,
      difficulty: 'advanced',
      estimated_time: '45分钟',
      nodes: [
        { id: 'upload', type: 'input', name: '文档上传' },
        { id: 'extract', type: 'parser', name: '文本提取' },
        { id: 'segment', type: 'data_transformer', name: '文本分割' },
        { id: 'analyze', type: 'llm', name: '内容分析' },
        { id: 'summarize', type: 'llm', name: '摘要生成' },
        { id: 'output', type: 'output', name: '结果输出' },
      ],
      edges: [
        { id: 'e1', source: 'upload', target: 'extract' },
        { id: 'e2', source: 'extract', target: 'segment' },
        { id: 'e3', source: 'segment', target: 'analyze' },
        { id: 'e4', source: 'analyze', target: 'summarize' },
        { id: 'e5', source: 'summarize', target: 'output' },
      ],
      use_cases: ['合同分析', '报告总结', '研究论文摘要'],
      requirements: ['文档上传功能', '高级LLM模型'],
      similar_templates: ['contract-reviewer', 'research-assistant']
    },
    {
      id: 'translation-workflow',
      name: '多语言翻译助手',
      description: '支持多种语言的智能翻译工作流，包含术语一致性检查',
      category: 'document_processing',
      subcategory: 'translation',
      tags: ['翻译', '多语言', '术语', '一致性'],
      author: '国际化团队',
      version: '1.8.0',
      created_at: '2024-01-05T11:30:00Z',
      updated_at: '2024-01-14T10:15:00Z',
      downloads: 634,
      rating: 4.4,
      rating_count: 73,
      is_featured: true,
      is_premium: false,
      difficulty: 'beginner',
      estimated_time: '20分钟',
      nodes: [
        { id: 'input', type: 'input', name: '原文输入' },
        { id: 'detect', type: 'classifier', name: '语言检测' },
        { id: 'translate', type: 'llm', name: '翻译处理' },
        { id: 'check', type: 'classifier', name: '术语检查' },
        { id: 'output', type: 'output', name: '翻译输出' },
      ],
      edges: [
        { id: 'e1', source: 'input', target: 'detect' },
        { id: 'e2', source: 'detect', target: 'translate' },
        { id: 'e3', source: 'translate', target: 'check' },
        { id: 'e4', source: 'check', target: 'output' },
      ],
      use_cases: ['技术文档翻译', '产品说明书', '用户界面本地化'],
      requirements: ['翻译API', '术语词典'],
      similar_templates: ['localization-helper', 'content-translator']
    },
    {
      id: 'qa-system',
      name: '企业问答系统',
      description: '基于企业知识库的智能问答系统，支持复杂查询和上下文理解',
      category: 'ai_assistant',
      subcategory: 'qa_system',
      tags: ['问答', '知识库', '企业', '上下文'],
      author: '企业AI团队',
      version: '3.0.0',
      created_at: '2024-01-03T14:20:00Z',
      updated_at: '2024-01-16T09:45:00Z',
      downloads: 1583,
      rating: 4.9,
      rating_count: 201,
      is_featured: true,
      is_premium: true,
      difficulty: 'advanced',
      estimated_time: '60分钟',
      nodes: [
        { id: 'question', type: 'input', name: '问题输入' },
        { id: 'understand', type: 'llm', name: '问题理解' },
        { id: 'search', type: 'rag_retriever', name: '知识检索' },
        { id: 'rerank', type: 'reranker', name: '结果重排' },
        { id: 'generate', type: 'llm', name: '答案生成' },
        { id: 'verify', type: 'classifier', name: '答案验证' },
        { id: 'output', type: 'output', name: '答案输出' },
      ],
      edges: [
        { id: 'e1', source: 'question', target: 'understand' },
        { id: 'e2', source: 'understand', target: 'search' },
        { id: 'e3', source: 'search', target: 'rerank' },
        { id: 'e4', source: 'rerank', target: 'generate' },
        { id: 'e5', source: 'generate', target: 'verify' },
        { id: 'e6', source: 'verify', target: 'output' },
      ],
      use_cases: ['员工培训', '技术支持', '政策咨询'],
      requirements: ['企业知识库', '高性能向量数据库', '重排序模型'],
      similar_templates: ['help-desk-bot', 'training-assistant']
    },
    {
      id: 'data-report-generator',
      name: '数据报告生成器',
      description: '自动化数据分析和报告生成，支持多种图表和可视化',
      category: 'data_analysis',
      subcategory: 'report_generation',
      tags: ['数据分析', '报告', '可视化', '自动化'],
      author: '数据科学团队',
      version: '2.3.0',
      created_at: '2024-01-07T08:15:00Z',
      updated_at: '2024-01-13T13:20:00Z',
      downloads: 456,
      rating: 4.3,
      rating_count: 52,
      is_featured: false,
      is_premium: false,
      difficulty: 'intermediate',
      estimated_time: '40分钟',
      nodes: [
        { id: 'data_input', type: 'input', name: '数据输入' },
        { id: 'clean', type: 'data_transformer', name: '数据清洗' },
        { id: 'analyze', type: 'code_executor', name: '统计分析' },
        { id: 'visualize', type: 'code_executor', name: '图表生成' },
        { id: 'report', type: 'llm', name: '报告撰写' },
        { id: 'output', type: 'output', name: '报告输出' },
      ],
      edges: [
        { id: 'e1', source: 'data_input', target: 'clean' },
        { id: 'e2', source: 'clean', target: 'analyze' },
        { id: 'e3', source: 'analyze', target: 'visualize' },
        { id: 'e4', source: 'visualize', target: 'report' },
        { id: 'e5', source: 'report', target: 'output' },
      ],
      use_cases: ['销售报告', '用户行为分析', '财务报表'],
      requirements: ['数据源接口', '图表库', '报告模板'],
      similar_templates: ['dashboard-generator', 'kpi-tracker']
    },
  ];

  useEffect(() => {
    // 模拟数据加载
    const loadData = async () => {
      setLoading(true);
      try {
        // 模拟API调用延迟
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        setCategories(mockCategories);
        setTemplates(mockTemplates);
        
        // 从localStorage加载收藏
        const savedFavorites = localStorage.getItem('workflow_template_favorites');
        if (savedFavorites) {
          setFavoriteTemplates(new Set(JSON.parse(savedFavorites)));
        }
      } catch (error) {
        console.error('Failed to load template data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

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
  const handlePreviewTemplate = (template: WorkflowTemplate) => {
    setSelectedTemplate(template);
    setPreviewDialogOpen(true);
  };

  // 处理使用模板
  const handleUseTemplate = (template: WorkflowTemplate) => {
    // 跳转到工作流编辑器并加载模板
    navigate('/workflows/new', { 
      state: { 
        template: {
          name: template.name,
          description: template.description,
          nodes: template.nodes,
          edges: template.edges
        }
      }
    });
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
      case 'beginner': return '初级';
      case 'intermediate': return '中级';
      case 'advanced': return '高级';
      default: return '未知';
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
            label="推荐"
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
            label="高级"
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
                {template.downloads} 次使用
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
                v{template.version}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              {template.author}
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
            预览
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
            使用模板
          </Button>
        </CardActions>
      </Card>
    );
  };

  // 渲染分类过滤器
  const renderCategoryFilter = () => (
    <Paper sx={{ p: 2, mb: 3, backgroundColor: 'rgba(26, 31, 46, 0.8)', border: '1px solid rgba(0, 212, 255, 0.2)' }}>
      <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
        分类筛选
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Chip
          label="全部"
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
            label={`${category.name} (${category.count})`}
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
              label={`${subcat.name} (${subcat.count})`}
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
          工作流模板库
        </Typography>
        <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          发现并使用精选的工作流模板，快速构建您的AI应用
        </Typography>
      </Box>

      {/* 搜索和过滤栏 */}
      <Paper sx={{ p: 2, mb: 3, backgroundColor: 'rgba(26, 31, 46, 0.8)', border: '1px solid rgba(0, 212, 255, 0.2)' }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            placeholder="搜索模板..."
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
            <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>排序方式</InputLabel>
            <Select
              value={sortBy}
              label="排序方式"
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
              <MenuItem value="popular">最受欢迎</MenuItem>
              <MenuItem value="newest">最新发布</MenuItem>
              <MenuItem value="rating">评分最高</MenuItem>
              <MenuItem value="name">名称排序</MenuItem>
            </Select>
          </FormControl>
          
          <FormControl sx={{ minWidth: 100 }}>
            <InputLabel sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>难度</InputLabel>
            <Select
              value={difficultyFilter}
              label="难度"
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
              <MenuItem value="all">全部</MenuItem>
              <MenuItem value="beginner">初级</MenuItem>
              <MenuItem value="intermediate">中级</MenuItem>
              <MenuItem value="advanced">高级</MenuItem>
            </Select>
          </FormControl>
          
          <Button
            startIcon={<FilterIcon />}
            onClick={() => setShowFilters(!showFilters)}
            sx={{ color: '#00d4ff' }}
          >
            {showFilters ? '隐藏' : '显示'}筛选
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
          <Tab label={`全部模板 (${filteredAndSortedTemplates.length})`} />
          <Tab label={`我的收藏 (${favoriteTemplates.size})`} />
          <Tab label="最近使用" />
        </Tabs>
      </Paper>

      {/* 模板网格 */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            加载中...
          </Typography>
        </Box>
      ) : (
        <>
          {filteredAndSortedTemplates.length === 0 ? (
            <Alert
              severity="info"
              sx={{
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                color: '#2196f3',
                border: '1px solid rgba(33, 150, 243, 0.2)'
              }}
            >
              未找到符合条件的模板，请尝试调整搜索条件
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
                      ({selectedTemplate.rating_count} 评价)
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
                    label={`${selectedTemplate.downloads} 次使用`}
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
                    适用场景
                  </Typography>
                  <List>
                    {selectedTemplate.use_cases.map((useCase, index) => (
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
                    所需资源
                  </Typography>
                  <List>
                    {selectedTemplate.requirements.map((req, index) => (
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
                    工作流节点
                  </Typography>
                  <List>
                    {selectedTemplate.nodes.map((node, index) => (
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
                关闭
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
                使用此模板
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

export default WorkflowTemplateLibrary;
