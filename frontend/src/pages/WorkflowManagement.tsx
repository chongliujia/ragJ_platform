/**
 * 工作流管理页面 - 管理已创建的工作流和智能体
 */

import React, { useState, useEffect } from 'react';
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
  History as HistoryIcon,
  Code as CodeIcon,
  BugReport as DebugIcon,
  Visibility as ViewIcon,
  GetApp as ExportIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'workflows' | 'agents'>('workflows');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Workflow | Agent | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDescription, setNewWorkflowDescription] = useState('');
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 模拟数据，当后端接口不可用时使用
  const mockWorkflows: Workflow[] = [
    {
      id: 'mock-1',
      name: '智能客服工作流',
      description: '自动处理客户咨询，包含意图识别、知识检索和回复生成',
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
      name: '文档分析处理',
      description: '批量处理文档，提取关键信息并生成摘要',
      nodes: [],
      edges: [],
      created_at: '2024-01-18T09:15:00Z',
      updated_at: '2024-01-19T16:45:00Z',
      status: 'draft',
      executions_count: 23,
    }
  ];

  const mockAgents: Agent[] = [
    {
      id: 'agent-1',
      name: '智能客服助手',
      description: '基于智能客服工作流的对话机器人',
      workflow_id: 'mock-1',
      created_at: '2024-01-16T11:00:00Z',
      status: 'active',
      conversations_count: 1247
    },
    {
      id: 'agent-2',
      name: '文档处理助手',
      description: '专门处理文档分析任务的智能助手',
      workflow_id: 'mock-2',
      created_at: '2024-01-19T08:30:00Z',
      status: 'inactive',
      conversations_count: 45
    }
  ];

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
        edges: []
      });
      
      setCreateDialogOpen(false);
      setNewWorkflowName('');
      setNewWorkflowDescription('');
      
      // 跳转到工作流编辑器
      navigate(`/workflows/${response.data.id}/edit`);
    } catch (error) {
      console.error('Failed to create workflow:', error);
      
      // 如果后端接口不可用，直接跳转到新建工作流页面
      setCreateDialogOpen(false);
      setNewWorkflowName('');
      setNewWorkflowDescription('');
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
      alert('使用模板失败');
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
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
                label={workflow.status}
                size="small"
                sx={{
                  backgroundColor: `${getStatusColor(workflow.status)}20`,
                  color: getStatusColor(workflow.status),
                  mt: 0.5
                }}
              />
              {currentWorkflowId === workflow.id && (
                <Chip label="当前" size="small" sx={{ ml: 1, backgroundColor: 'rgba(102,187,106,0.2)', color: '#66bb6a' }} />
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
          {workflow.description || '暂无描述'}
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              节点: { (workflow as any).node_count ?? (workflow.nodes?.length || 0) }
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              连接: { (workflow as any).edge_count ?? (workflow.edges?.length || 0) }
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              执行: { (workflow as any).execution_count ?? workflow.executions_count ?? 0 }
            </Typography>
          </Box>
        </Box>
        
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
          更新于: {formatDate(workflow.updated_at)}
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
          编辑
        </Button>
        <Button
          startIcon={<PlayIcon />}
          size="small"
          sx={{ color: '#4caf50' }}
          onClick={() => {
            // 执行工作流
            console.log('Execute workflow:', workflow.id);
          }}
        >
          执行
        </Button>
        <Button
          startIcon={<ViewIcon />}
          size="small"
          sx={{ color: currentWorkflowId === workflow.id ? '#66bb6a' : '#00d4ff' }}
          onClick={() => {
            try {
              localStorage.setItem('current_workflow_id', workflow.id);
              setCurrentWorkflowId(workflow.id);
              setNotice(`已设为当前工作流：${workflow.name}`);
              setTimeout(() => setNotice(null), 2000);
            } catch {}
          }}
        >
          设为当前
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
                label={agent.status}
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
          {agent.description || '暂无描述'}
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
              对话: {agent.conversations_count || 0}
            </Typography>
          </Box>
          {agent.workflow_id && (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
                关联工作流
              </Typography>
            </Box>
          )}
        </Box>
        
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.5)' }}>
          创建于: {formatDate(agent.created_at)}
        </Typography>
      </CardContent>
      
      <CardActions sx={{ p: 2, pt: 0 }}>
        <Button
          startIcon={<EditIcon />}
          size="small"
          sx={{ color: '#9c27b0' }}
        >
          配置
        </Button>
        <Button
          startIcon={<PlayIcon />}
          size="small"
          sx={{ color: '#4caf50' }}
        >
          对话
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
          智能体工作流管理
        </Typography>
        <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          管理您的工作流和智能体
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
            工作流 ({workflows.length})
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
            智能体 ({agents.length})
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
        💡 当前运行在演示模式下，显示的是模拟数据。工作流编辑器功能完全可用，创建的工作流将保存到本地存储。
      </Alert>

      {/* 内容区域 */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
              加载中...
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
                    暂无工作流，点击右下角按钮创建您的第一个工作流
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
                    暂无智能体，创建工作流后可以基于工作流创建智能体
                  </Alert>
                </Grid>
              )
            )}
          </Grid>
        )}
      </Box>

      {/* 浮动操作按钮 */}
      <Tooltip title={selectedTab === 'workflows' ? '创建工作流' : '创建智能体'}>
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
              setNotice(`已设为当前工作流：${(selectedItem as Workflow).name}`);
              setTimeout(() => setNotice(null), 2000);
            } catch {}
          }}>
            <ListItemIcon><ViewIcon fontSize="small" /></ListItemIcon>
            <ListItemText>设为当前</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => { handleMenuClose(); setEditDialogOpen(true); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>编辑</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { handleMenuClose(); }}>
          <ListItemIcon><CopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>复制</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { handleMenuClose(); }}>
          <ListItemIcon><ExportIcon fontSize="small" /></ListItemIcon>
          <ListItemText>导出</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { handleMenuClose(); setDeleteDialogOpen(true); }}>
          <ListItemIcon><DeleteIcon fontSize="small" sx={{ color: '#f44336' }} /></ListItemIcon>
          <ListItemText sx={{ color: '#f44336' }}>删除</ListItemText>
        </MenuItem>
      </Menu>
      {notice && (
        <Box sx={{ position: 'fixed', bottom: 90, right: 24 }}>
          <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>
        </Box>
      )}

      {/* 创建工作流对话框 */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>创建新工作流</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="工作流名称"
            value={newWorkflowName}
            onChange={(e) => setNewWorkflowName(e.target.value)}
            sx={{ mb: 2, mt: 1 }}
          />
          <TextField
            fullWidth
            label="描述"
            multiline
            rows={3}
            value={newWorkflowDescription}
            onChange={(e) => setNewWorkflowDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>取消</Button>
          <Button onClick={openTemplateDialog}>从模板创建</Button>
          <Button onClick={handleCreateWorkflow} variant="contained">
            创建并编辑
          </Button>
        </DialogActions>
      </Dialog>

      {/* 模板选择对话框 */}
      <Dialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>选择模板</DialogTitle>
        <DialogContent>
          {loadingTemplates ? (
            <Typography>加载模板中...</Typography>
          ) : (
            <List>
              {templates.map((tpl) => (
                <ListItem key={tpl.id} secondaryAction={
                  <Button variant="contained" size="small" onClick={() => useTemplate(tpl.id)}>使用</Button>
                }>
                  <ListItemIcon>
                    <WorkflowIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={`${tpl.name}（节点: ${tpl.node_count ?? '-'}）`}
                    secondary={tpl.description}
                  />
                </ListItem>
              ))}
              {templates.length === 0 && (
                <Typography>暂无可用模板</Typography>
              )}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialogOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除 "{selectedItem?.name}" 吗？此操作无法撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button onClick={handleDeleteItem} color="error" variant="contained">
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkflowManagement;
