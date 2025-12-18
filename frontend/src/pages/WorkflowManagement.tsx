/**
 * 工作流管理页面 - 管理已创建的工作流和智能体
 */

import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Paper,
  Button,
  Card,
  CardContent,
  CardActions,
  Grid,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Alert,
  Menu,
  MenuItem,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Avatar,
  Fab,
  Tooltip,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  Add as AddIcon,
  AccountTree as WorkflowIcon,
  SmartToy as AgentIcon,
  PlayArrow as PlayIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  MoreVert as MoreIcon,
  FileCopy as CopyIcon,
  Visibility as ViewIcon,
  GetApp as ExportIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { workflowApi, agentApi } from '../services/api';

interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: any[];
  edges: any[];
  created_at: string;
  updated_at: string;
  status: 'draft' | 'active' | 'archived';
  executions_count: number;
  last_execution?: string;
  is_public?: boolean;
  owner_id?: number;
}

interface Agent {
  id: string;
  name: string;
  description: string;
  workflow_id?: string;
  created_at: string;
  status: 'active' | 'inactive';
  conversations_count: number;
}

const WorkflowManagement: React.FC = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'workflows' | 'agents'>('workflows');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Workflow | Agent | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDescription, setNewWorkflowDescription] = useState('');
  const [newWorkflowIsPublic, setNewWorkflowIsPublic] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Demo data used when backend APIs are unavailable
  const mockWorkflows: Workflow[] = useMemo(() => [
    {
      id: 'mock-1',
      name: t('workflowManagement.demo.workflows.customerService.name'),
      description: t('workflowManagement.demo.workflows.customerService.description'),
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'intent', type: 'classifier', position: { x: 200, y: 0 }, data: {} },
        { id: 'rag', type: 'rag_retriever', position: { x: 400, y: 0 }, data: {} },
        { id: 'llm', type: 'llm', position: { x: 600, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'intent' },
        { id: 'e2', source: 'intent', target: 'rag' },
        { id: 'e3', source: 'rag', target: 'llm' },
      ],
      created_at: '2024-01-15T10:30:00Z',
      updated_at: '2024-01-20T14:22:00Z',
      status: 'active',
      executions_count: 156,
      last_execution: '2024-01-20T14:22:00Z'
    },
    {
      id: 'mock-2',
      name: t('workflowManagement.demo.workflows.documentAnalysis.name'),
      description: t('workflowManagement.demo.workflows.documentAnalysis.description'),
      nodes: [],
      edges: [],
      created_at: '2024-01-18T09:15:00Z',
      updated_at: '2024-01-19T16:45:00Z',
      status: 'draft',
      executions_count: 23,
    }
  ], [i18n.language, t]);

  const mockAgents: Agent[] = useMemo(() => [
    {
      id: 'agent-1',
      name: t('workflowManagement.demo.agents.customerService.name'),
      description: t('workflowManagement.demo.agents.customerService.description'),
      workflow_id: 'mock-1',
      created_at: '2024-01-16T11:00:00Z',
      status: 'active',
      conversations_count: 1247
    },
    {
      id: 'agent-2',
      name: t('workflowManagement.demo.agents.documentAssistant.name'),
      description: t('workflowManagement.demo.agents.documentAssistant.description'),
      workflow_id: 'mock-2',
      created_at: '2024-01-19T08:30:00Z',
      status: 'inactive',
      conversations_count: 45
    }
  ], [i18n.language, t]);

  useEffect(() => {
    loadData();
    try {
      const id = localStorage.getItem('current_workflow_id');
      if (id) setCurrentWorkflowId(id);
      const onStorage = (e: StorageEvent) => {
        if (e.key === 'current_workflow_id') setCurrentWorkflowId(e.newValue);
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    } catch {}
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [workflowsResponse, agentsResponse] = await Promise.all([
        workflowApi.getList().catch(() => ({ data: mockWorkflows })), // 如果失败则使用模拟数据
        agentApi.getList().catch(() => ({ data: mockAgents }))        // 如果失败则使用模拟数据
      ]);
      
      setWorkflows(workflowsResponse.data || mockWorkflows);
      setAgents(agentsResponse.data || mockAgents);
    } catch (error) {
      console.error('Failed to load data:', error);
      // 如果都失败了，使用模拟数据
      setWorkflows(mockWorkflows);
      setAgents(mockAgents);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWorkflow = async () => {
    if (!newWorkflowName.trim()) return;

    try {
      const response = await workflowApi.create({
        name: newWorkflowName,
        description: newWorkflowDescription,
        nodes: [],
        edges: [],
        is_public: newWorkflowIsPublic,
      });
      
      setCreateDialogOpen(false);
      setNewWorkflowName('');
      setNewWorkflowDescription('');
      setNewWorkflowIsPublic(false);
      
      // 跳转到工作流编辑器
      navigate(`/workflows/${response.data.id}/edit`);
    } catch (error) {
      console.error('Failed to create workflow:', error);
      
      // 如果后端接口不可用，直接跳转到新建工作流页面
      setCreateDialogOpen(false);
      setNewWorkflowName('');
      setNewWorkflowDescription('');
      setNewWorkflowIsPublic(false);
      navigate('/workflows/new');
    }
  };

  const openTemplateDialog = async () => {
    setTemplateDialogOpen(true);
    setLoadingTemplates(true);
    try {
      const resp = await workflowApi.getTemplates();
      setTemplates(resp.data || []);
    } catch (e) {
      console.error('Failed to load templates:', e);
      setTemplates([]);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const useTemplate = async (templateId: string) => {
    try {
      const resp = await workflowApi.useTemplate(templateId, newWorkflowName || undefined);
      const workflowId = resp.data?.workflow_id || resp.data?.id;
      setTemplateDialogOpen(false);
      if (workflowId) {
        navigate(`/workflows/${workflowId}/edit`);
      }
    } catch (e) {
      console.error('Use template failed:', e);
      alert(t('workflowManagement.messages.useTemplateFailed'));
    }
  };

  const toggleWorkflowVisibility = async (workflow: Workflow) => {
    try {
      const next = !workflow.is_public;
      await workflowApi.update(workflow.id, { is_public: next });
      setWorkflows((prev) => prev.map((w) => (w.id === workflow.id ? { ...w, is_public: next } : w)));
      setNotice(
        next
          ? t('workflowManagement.messages.setPublic', { name: workflow.name })
          : t('workflowManagement.messages.setPrivate', { name: workflow.name })
      );
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(t('workflowManagement.messages.updateVisibilityFailed'));
      setTimeout(() => setNotice(null), 2000);
    }
  };

  const handleDeleteItem = async () => {
    if (!selectedItem) return;

    try {
      if (selectedTab === 'workflows') {
        await workflowApi.delete(selectedItem.id);
        // 本地状态立即移除
        setWorkflows((prev) => prev.filter(w => w.id !== (selectedItem as Workflow).id));
        try {
          const cur = localStorage.getItem('current_workflow_id');
          if (cur && cur === (selectedItem as Workflow).id) {
            localStorage.removeItem('current_workflow_id');
            setCurrentWorkflowId(null);
          }
        } catch {}
      } else {
        await agentApi.delete(selectedItem.id);
        setAgents((prev) => prev.filter(a => a.id !== (selectedItem as Agent).id));
      }
      
      setDeleteDialogOpen(false);
      setSelectedItem(null);
      // 不强制 reload，避免闪烁
    } catch (error) {
      console.error('Failed to delete item:', error);
      
      // 即使删除失败，也关闭对话框并重新加载数据
      setDeleteDialogOpen(false);
      setSelectedItem(null);
      // 回退：后端不可用情况下就从本地列表移除（前面已移除）
      // 可以在此处追加提示
    }
  };

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>, item: Workflow | Agent) => {
    setMenuAnchor(event.currentTarget);
    setSelectedItem(item);
  };

  const handleMenuClose = () => {
    // 仅关闭菜单，不清空选中项，以便后续操作（删除）可以读取 selectedItem
    setMenuAnchor(null);
  };

  const dateLocale = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(dateLocale);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return '#4caf50';
      case 'draft':
        return '#ff9800';
      case 'archived':
        return '#9e9e9e';
      case 'inactive':
        return '#f44336';
      default:
        return '#9e9e9e';
    }
  };

  const getStatusLabel = (status: string) =>
    t(`workflowManagement.status.${status}`, { defaultValue: status });

  const renderWorkflowCard = (workflow: Workflow) => (
    <Card
      key={workflow.id}
      sx={{
        height: '100%',
        background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
        border: `1px solid ${currentWorkflowId === workflow.id ? 'rgba(102,187,106,0.8)' : 'rgba(0, 212, 255, 0.2)'}`,
        borderRadius: 3,
        transition: 'all 0.3s ease',
        '&:hover': {
          borderColor: 'rgba(0, 212, 255, 0.4)',
          transform: 'translateY(-4px)',
          boxShadow: '0 8px 25px rgba(0, 212, 255, 0.2)',
        },
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: '#00d4ff', mr: 2 }}>
              <WorkflowIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
                {workflow.name}
              </Typography>
              <Chip
                label={getStatusLabel(workflow.status)}
                size="small"
                sx={{
                  backgroundColor: `${getStatusColor(workflow.status)}20`,
                  color: getStatusColor(workflow.status),
                  mt: 0.5
                }}
              />
              <Chip
                label={workflow.is_public ? t('workflowManagement.visibility.public') : t('workflowManagement.visibility.private')}
                size="small"
                sx={{
                  ml: 1,
                  backgroundColor: workflow.is_public ? 'rgba(0, 212, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                  color: workflow.is_public ? '#00d4ff' : 'rgba(255,255,255,0.75)',
                }}
              />
              {currentWorkflowId === workflow.id && (
                <Chip label={t('workflowManagement.current')} size="small" sx={{ ml: 1, backgroundColor: 'rgba(102,187,106,0.2)', color: '#66bb6a' }} />
              )}
            </Box>
          </Box>
          <IconButton
            size="small"
            onClick={(e) => handleMenuClick(e, workflow)}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            <MoreIcon />
          </IconButton>
        </Box>
        
        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
          {workflow.description || t('workflowManagement.noDescription')}
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              {t('workflowManagement.metrics.nodes')}: { (workflow as any).node_count ?? (workflow.nodes?.length || 0) }
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              {t('workflowManagement.metrics.edges')}: { (workflow as any).edge_count ?? (workflow.edges?.length || 0) }
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              {t('workflowManagement.metrics.executions')}: { (workflow as any).execution_count ?? workflow.executions_count ?? 0 }
            </Typography>
          </Box>
        </Box>
        
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
          {t('workflowManagement.updatedAt')}: {formatDate(workflow.updated_at)}
        </Typography>
      </CardContent>
      
      <CardActions sx={{ p: 2, pt: 0 }}>
        <Button
          startIcon={<EditIcon />}
          size="small"
          sx={{ color: '#00d4ff' }}
          onClick={() => {
            navigate(`/workflows/${workflow.id}/edit`);
          }}
        >
          {t('common.edit')}
        </Button>
		        <Button
		          startIcon={<PlayIcon />}
		          size="small"
		          sx={{ color: '#4caf50' }}
		          onClick={() => {
		            navigate(`/workflows/${workflow.id}/test`);
		          }}
		        >
		          {t('workflowManagement.actions.run')}
		        </Button>
		        <Button
		          startIcon={<HistoryIcon />}
		          size="small"
		          sx={{ color: 'rgba(255, 255, 255, 0.75)' }}
		          onClick={() => {
		            navigate(`/workflows/${workflow.id}/executions`);
		          }}
		        >
		          {t('workflowManagement.actions.history')}
		        </Button>
		        <Button
		          startIcon={<ViewIcon />}
		          size="small"
		          sx={{ color: currentWorkflowId === workflow.id ? '#66bb6a' : '#00d4ff' }}
		          onClick={() => {
	            try {
	              localStorage.setItem('current_workflow_id', workflow.id);
	              setCurrentWorkflowId(workflow.id);
	              setNotice(t('workflowManagement.messages.setCurrent', { name: workflow.name }));
	              setTimeout(() => setNotice(null), 2000);
	            } catch {}
	          }}
	        >
	          {t('workflowManagement.actions.setCurrent')}
	        </Button>
      </CardActions>
    </Card>
  );

  const renderAgentCard = (agent: Agent) => (
    <Card
      key={agent.id}
      sx={{
        height: '100%',
        background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.8) 0%, rgba(15, 20, 25, 0.8) 100%)',
        border: '1px solid rgba(156, 39, 176, 0.2)',
        borderRadius: 3,
        transition: 'all 0.3s ease',
        '&:hover': {
          borderColor: 'rgba(156, 39, 176, 0.4)',
          transform: 'translateY(-4px)',
          boxShadow: '0 8px 25px rgba(156, 39, 176, 0.2)',
        },
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: '#9c27b0', mr: 2 }}>
              <AgentIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" sx={{ color: 'white', fontWeight: 600 }}>
                {agent.name}
              </Typography>
              <Chip
                label={getStatusLabel(agent.status)}
                size="small"
                sx={{
                  backgroundColor: `${getStatusColor(agent.status)}20`,
                  color: getStatusColor(agent.status),
                  mt: 0.5
                }}
              />
            </Box>
          </Box>
          <IconButton
            size="small"
            onClick={(e) => handleMenuClick(e, agent)}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            <MoreIcon />
          </IconButton>
        </Box>
        
        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
          {agent.description || t('workflowManagement.noDescription')}
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              {t('workflowManagement.agentMetrics.conversations')}: {agent.conversations_count || 0}
            </Typography>
          </Box>
          {agent.workflow_id && (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
                {t('workflowManagement.agentMetrics.linkedWorkflow')}
              </Typography>
            </Box>
          )}
        </Box>
        
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
          {t('workflowManagement.createdAt')}: {formatDate(agent.created_at)}
        </Typography>
      </CardContent>
      
      <CardActions sx={{ p: 2, pt: 0 }}>
        <Button
          startIcon={<EditIcon />}
          size="small"
          sx={{ color: '#9c27b0' }}
        >
          {t('workflowManagement.actions.configure')}
        </Button>
        <Button
          startIcon={<PlayIcon />}
          size="small"
          sx={{ color: '#4caf50' }}
        >
          {t('workflowManagement.actions.chat')}
        </Button>
      </CardActions>
    </Card>
  );

  return (
    <Box sx={{ 
      height: '100%',
      maxHeight: '100%',
      background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 50%, #0f1419 100%)',
      p: 3,
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column'
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
          {t('workflowManagement.header.title')}
        </Typography>
        <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          {t('workflowManagement.header.subtitle')}
        </Typography>
      </Box>

      {/* 标签页切换 */}
      <Paper sx={{ mb: 3, backgroundColor: 'rgba(26, 31, 46, 0.8)', border: '1px solid rgba(0, 212, 255, 0.2)' }}>
        <Box sx={{ p: 2, display: 'flex', gap: 2 }}>
          <Button
            variant={selectedTab === 'workflows' ? 'contained' : 'outlined'}
            startIcon={<WorkflowIcon />}
            onClick={() => setSelectedTab('workflows')}
            sx={{
              ...(selectedTab === 'workflows' ? {
                background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)',
              } : {
                color: '#00d4ff',
                borderColor: '#00d4ff',
              })
            }}
          >
            {t('workflowManagement.tabs.workflows', { count: workflows.length })}
          </Button>
          <Button
            variant={selectedTab === 'agents' ? 'contained' : 'outlined'}
            startIcon={<AgentIcon />}
            onClick={() => setSelectedTab('agents')}
            sx={{
              ...(selectedTab === 'agents' ? {
                background: 'linear-gradient(45deg, #9c27b0 0%, #673ab7 100%)',
              } : {
                color: '#9c27b0',
                borderColor: '#9c27b0',
              })
            }}
          >
            {t('workflowManagement.tabs.agents', { count: agents.length })}
          </Button>
        </Box>
      </Paper>

      {/* 演示模式提示 */}
      <Alert 
        severity="info" 
        sx={{ 
          mb: 3,
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          color: '#2196f3',
          border: '1px solid rgba(33, 150, 243, 0.2)'
        }}
      >
        {t('workflowManagement.demo.banner')}
      </Alert>

      {/* 内容区域 */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              {t('common.loading')}
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={3}>
            {selectedTab === 'workflows' ? (
              workflows.length > 0 ? (
                workflows.map(renderWorkflowCard)
              ) : (
                <Grid size={12}>
                  <Alert 
                    severity="info" 
                    sx={{ 
                      backgroundColor: 'rgba(33, 150, 243, 0.1)',
                      color: '#2196f3',
                      border: '1px solid rgba(33, 150, 243, 0.2)'
                    }}
                  >
                    {t('workflowManagement.empty.workflows')}
                  </Alert>
                </Grid>
              )
            ) : (
              agents.length > 0 ? (
                agents.map(renderAgentCard)
              ) : (
                <Grid size={12}>
                  <Alert 
                    severity="info"
                    sx={{ 
                      backgroundColor: 'rgba(156, 39, 176, 0.1)',
                      color: '#9c27b0',
                      border: '1px solid rgba(156, 39, 176, 0.2)'
                    }}
                  >
                    {t('workflowManagement.empty.agents')}
                  </Alert>
                </Grid>
              )
            )}
          </Grid>
        )}
      </Box>

      {/* 浮动操作按钮 */}
      <Tooltip title={selectedTab === 'workflows' ? t('workflowManagement.actions.createWorkflow') : t('workflowManagement.actions.createAgent')}>
        <Fab
          color="primary"
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: selectedTab === 'workflows' ? 
              'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)' :
              'linear-gradient(45deg, #9c27b0 0%, #673ab7 100%)',
            '&:hover': {
              transform: 'scale(1.1)',
            }
          }}
          onClick={() => {
            if (selectedTab === 'workflows') {
              setCreateDialogOpen(true);
            } else {
              // 创建智能体逻辑
              console.log('Create agent');
            }
          }}
        >
          <AddIcon />
        </Fab>
      </Tooltip>

      {/* 上下文菜单 */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        {selectedItem && (selectedTab === 'workflows') && (
          <MenuItem onClick={() => { 
            handleMenuClose(); 
            try {
              localStorage.setItem('current_workflow_id', (selectedItem as Workflow).id);
              setCurrentWorkflowId((selectedItem as Workflow).id);
              setNotice(t('workflowManagement.messages.setCurrent', { name: (selectedItem as Workflow).name }));
              setTimeout(() => setNotice(null), 2000);
            } catch {}
          }}>
            <ListItemIcon><ViewIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('workflowManagement.menu.setCurrent')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            handleMenuClose();
            if (selectedItem && selectedTab === 'workflows') {
              const wf = selectedItem as Workflow;
              navigate(`/workflows/${wf.id}/edit`);
            }
          }}
        >
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('common.edit')}</ListItemText>
        </MenuItem>
        {selectedItem && selectedTab === 'workflows' && (
          <MenuItem
            onClick={() => {
              handleMenuClose();
              void toggleWorkflowVisibility(selectedItem as Workflow);
            }}
          >
            <ListItemIcon><ViewIcon fontSize="small" /></ListItemIcon>
            <ListItemText>
              {(selectedItem as Workflow).is_public
                ? t('workflowManagement.menu.setPrivate')
                : t('workflowManagement.menu.setPublic')}
            </ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => { handleMenuClose(); }}>
          <ListItemIcon><CopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('workflowManagement.menu.copy')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { handleMenuClose(); }}>
          <ListItemIcon><ExportIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('workflowManagement.menu.export')}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { handleMenuClose(); setDeleteDialogOpen(true); }}>
          <ListItemIcon><DeleteIcon fontSize="small" sx={{ color: '#f44336' }} /></ListItemIcon>
          <ListItemText sx={{ color: '#f44336' }}>{t('workflowManagement.menu.delete')}</ListItemText>
        </MenuItem>
      </Menu>
      {notice && (
        <Box sx={{ position: 'fixed', bottom: 90, right: 24 }}>
          <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>
        </Box>
      )}

      {/* 创建工作流对话框 */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>{t('workflowManagement.dialogs.create.title')}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label={t('workflowManagement.dialogs.create.fields.name')}
            value={newWorkflowName}
            onChange={(e) => setNewWorkflowName(e.target.value)}
            sx={{ mb: 2, mt: 1 }}
          />
          <TextField
            fullWidth
            label={t('workflowManagement.dialogs.create.fields.description')}
            multiline
            rows={3}
            value={newWorkflowDescription}
            onChange={(e) => setNewWorkflowDescription(e.target.value)}
          />
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Switch
                checked={newWorkflowIsPublic}
                onChange={(_e, checked) => setNewWorkflowIsPublic(checked)}
              />
            }
            label={
              newWorkflowIsPublic
                ? t('workflowManagement.dialogs.create.visibility.publicToTeam')
                : t('workflowManagement.dialogs.create.visibility.privateOnly')
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={openTemplateDialog}>{t('workflowManagement.dialogs.create.actions.fromTemplate')}</Button>
          <Button onClick={handleCreateWorkflow} variant="contained">
            {t('workflowManagement.dialogs.create.actions.createAndEdit')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 模板选择对话框 */}
      <Dialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('workflowManagement.dialogs.templates.title')}</DialogTitle>
        <DialogContent>
          {loadingTemplates ? (
            <Typography>{t('workflowManagement.dialogs.templates.loading')}</Typography>
          ) : (
            <List>
              {templates.map((tpl) => (
                <ListItem key={tpl.id} secondaryAction={
                  <Button variant="contained" size="small" onClick={() => useTemplate(tpl.id)}>
                    {t('workflowManagement.dialogs.templates.use')}
                  </Button>
                }>
                  <ListItemIcon>
                    <WorkflowIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={t('workflowManagement.dialogs.templates.templateTitle', {
                      name: tpl.name,
                      nodeCount: tpl.node_count ?? '-',
                    })}
                    secondary={tpl.description}
                  />
                </ListItem>
              ))}
              {templates.length === 0 && (
                <Typography>{t('workflowManagement.dialogs.templates.empty')}</Typography>
              )}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('workflowManagement.dialogs.delete.title')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('workflowManagement.dialogs.delete.confirm', { name: selectedItem?.name })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleDeleteItem} color="error" variant="contained">
            {t('workflowManagement.dialogs.delete.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkflowManagement;
