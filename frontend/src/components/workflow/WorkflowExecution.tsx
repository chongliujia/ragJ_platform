/**
 * 工作流执行器组件 - 提供实际的工作流执行和实时监控功能
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Alert,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  BugReport as DebugIcon,
  Visibility as ViewIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Memory as MemoryIcon,
} from '@mui/icons-material';
import { workflowApi } from '../../services/api';
import type { Node, Edge } from 'reactflow';

interface ExecutionStep {
  id: string;
  nodeId: string;
  nodeName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: number;
  endTime?: number;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  memory?: number;
}

interface ExecutionResult {
  id: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  result?: any;
  error?: string;
  startTime: number;
  endTime?: number;
  steps: ExecutionStep[];
  metrics?: {
    totalNodes: number;
    completedNodes: number;
    errorNodes: number;
    totalDuration?: number;
    memoryUsage?: number;
  };
  // 后端返回的执行ID，用于后续单步重试
  backendExecutionId?: string;
}

interface WorkflowExecutionProps {
  workflowId?: string;
  nodes: Node[];
  edges: Edge[];
  onSave?: (workflow: any) => void;
}

const WorkflowExecution: React.FC<WorkflowExecutionProps> = ({
  workflowId,
  nodes,
  edges,
  onSave
}) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [inputTab, setInputTab] = useState<'form' | 'json'>('form');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [executionInput, setExecutionInput] = useState('{}');
  // 表单模式字段
  const [formPrompt, setFormPrompt] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formKnowledgeBase, setFormKnowledgeBase] = useState('');
  const [formTopK, setFormTopK] = useState<number | ''>('');
  const [formTemperature, setFormTemperature] = useState<number | ''>('');
  const [formMaxTokens, setFormMaxTokens] = useState<number | ''>('');
  const [formEnableParallel, setFormEnableParallel] = useState(true);
  const [customFields, setCustomFields] = useState<Array<{ key: string; type: 'string' | 'number' | 'boolean'; value: string }>>([]);
  const [currentExecution, setCurrentExecution] = useState<ExecutionResult | null>(null);
  const [executionHistory, setExecutionHistory] = useState<ExecutionResult[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const executionIdRef = useRef<string | null>(null);

  // 初始化执行历史
  useEffect(() => {
    if (workflowId) {
      loadExecutionHistory();
    }
  }, [workflowId]);

  const loadExecutionHistory = async () => {
    if (!workflowId) return;
    
    try {
      const response = await workflowApi.getExecutionHistory(workflowId);
      const list = response.data?.executions || response.data || [];
      setExecutionHistory(list);
    } catch (error) {
      console.error('Failed to load execution history:', error);
    }
  };

  const handleExecute = async () => {
    // 若未配置输入，打开输入对话框
    if (inputTab === 'json') {
      if (!executionInput.trim()) { setInputDialogOpen(true); return; }
      try { JSON.parse(executionInput); setInputError(null); } catch (e: any) { setInputError(e.message || 'JSON 解析错误'); setInputDialogOpen(true); return; }
    } else {
      // 表单模式无需 JSON 校验
      setInputError(null);
    }

    setIsExecuting(true);
    const executionId = `exec_${Date.now()}`;
    executionIdRef.current = executionId;

    const execution: ExecutionResult = {
      id: executionId,
      status: 'running',
      startTime: Date.now(),
      steps: [],
      metrics: {
        totalNodes: nodes.length,
        completedNodes: 0,
        errorNodes: 0,
      }
    };

    setCurrentExecution(execution);

    try {
      if (!workflowId) {
        // 不再本地模拟；提示需先保存并使用后端执行
        execution.status = 'error';
        execution.error = '请先保存工作流再执行（不提供本地模拟）';
        execution.endTime = Date.now();
        setCurrentExecution({ ...execution });
        return;
      }
      // 使用后端API执行工作流
      await executeWithBackend(workflowId, execution);
    } catch (error) {
      console.error('Execution failed:', error);
      execution.status = 'error';
      execution.error = error instanceof Error ? error.message : '执行失败';
      execution.endTime = Date.now();
      setCurrentExecution({...execution});
    } finally {
      setIsExecuting(false);
      executionIdRef.current = null;
    }
  };

  // 构建推荐输入（简单根据节点类型推断）
  const buildRecommendedInput = () => {
    const hasLLM = nodes.some((n: any) => (n.data?.type || n.type) === 'llm');
    const hasRetriever = nodes.some((n: any) => ['rag_retriever','hybrid_retriever','retriever'].includes((n.data?.type || n.type)));
    const hasInput = nodes.some((n: any) => (n.data?.type || n.type) === 'input');
    if (inputTab === 'json') {
      const recommended: any = {};
      if (hasLLM) {
        recommended.prompt = recommended.prompt || '请用一句话介绍这个系统';
        recommended.system_prompt = '';
        recommended.temperature = 0.7;
      }
      if (hasRetriever) {
        recommended.query = recommended.query || '公司加班政策';
        recommended.top_k = 5;
      }
      if (hasInput) {
        recommended.text = recommended.text || '测试输入';
      }
      setExecutionInput(JSON.stringify(recommended, null, 2));
    } else {
      if (hasLLM) {
        setFormPrompt((v) => v || '请用一句话介绍这个系统');
        setFormTemperature((v) => v === '' ? 0.7 : v);
      }
      if (hasRetriever) {
        setFormTopK((v) => v === '' ? 5 : v);
      }
    }
  };

  const buildFormInputData = () => {
    const data: any = {};
    if (formPrompt) data.prompt = formPrompt;
    if (formSystemPrompt) data.system_prompt = formSystemPrompt;
    if (formKnowledgeBase) data.knowledge_base = formKnowledgeBase;
    if (formTopK !== '') data.top_k = Number(formTopK);
    if (formTemperature !== '') data.temperature = Number(formTemperature);
    if (formMaxTokens !== '') data.max_tokens = Number(formMaxTokens);
    // 若有检索节点但未显式提供 query，默认用 prompt 作为 query
    const hasRetriever = nodes.some((n: any) => ['rag_retriever','hybrid_retriever','retriever'].includes((n.data?.type || n.type)));
    if (hasRetriever && !data.query && data.prompt) data.query = data.prompt;
    // 自定义字段
    customFields.forEach((f) => {
      if (!f.key) return;
      if (f.type === 'number') data[f.key] = Number(f.value);
      else if (f.type === 'boolean') data[f.key] = ['true', '1', 'yes', 'on'].includes(String(f.value).toLowerCase());
      else data[f.key] = f.value;
    });
    return data;
  };

  const executeWithBackend = async (workflowId: string, execution: ExecutionResult) => {
    try {
      let inputData: any;
      if (inputTab === 'json') {
        try {
          inputData = JSON.parse(executionInput);
        } catch {
          inputData = { input: executionInput };
        }
      } else {
        inputData = buildFormInputData();
      }

      await workflowApi.executeStream(
        workflowId,
        {
          input_data: inputData,
          debug: debugMode,
          enable_parallel: formEnableParallel,
        },
        // onProgress
        (progress) => {
          if (progress.step) {
            const step: ExecutionStep = {
              id: progress.step.id,
              nodeId: progress.step.nodeId,
              nodeName: progress.step.nodeName,
              status: progress.step.status,
              startTime: progress.step.startTime,
              endTime: progress.step.endTime,
              duration: progress.step.duration,
              input: progress.step.input,
              output: progress.step.output,
              error: progress.step.error,
              memory: progress.step.memory,
            };

            execution.steps = execution.steps.filter(s => s.id !== step.id);
            execution.steps.push(step);
            
            // 更新指标
            if (execution.metrics) {
              execution.metrics.completedNodes = execution.steps.filter(s => s.status === 'completed').length;
              execution.metrics.errorNodes = execution.steps.filter(s => s.status === 'error').length;
            }

            setCurrentExecution({...execution});
          }
        },
        // onError
        (error) => {
          execution.status = 'error';
          execution.error = error.message || '执行失败';
          execution.endTime = Date.now();
          setCurrentExecution({...execution});
        },
        // onComplete
        (result) => {
          execution.status = 'completed';
          execution.result = result.result;
          // 记录后端执行ID以便单步重试
          try {
            execution.backendExecutionId = result?.result?.execution_id;
          } catch {}
          execution.endTime = Date.now();
          
          if (execution.metrics) {
            execution.metrics.totalDuration = execution.endTime - execution.startTime;
          }

          setCurrentExecution({...execution});
          setExecutionHistory(prev => [execution, ...prev]);
          // 拉取后端的执行历史，确保拿到真实 execution_id
          loadExecutionHistory();
        }
      );
    } catch (error) {
      throw error;
    }
  };

  const executeLocally = async (execution: ExecutionResult) => {
    // 本地模拟执行逻辑
    const steps: ExecutionStep[] = [];
    const visited = new Set<string>();
    
    // 找到起始节点
    const startNodes = nodes.filter(node => 
      !edges.some(edge => edge.target === node.id)
    );
    
    // 生成执行步骤
    const buildExecutionOrder = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        steps.push({
          id: `step_${steps.length}`,
          nodeId: node.id,
          nodeName: node.data.name || node.data.type,
          status: 'pending'
        });
        
        const childEdges = edges.filter(edge => edge.source === nodeId);
        childEdges.forEach(edge => buildExecutionOrder(edge.target));
      }
    };
    
    startNodes.forEach(node => buildExecutionOrder(node.id));

    // 模拟执行
    for (let i = 0; i < steps.length; i++) {
      if (!isExecuting) break;

      const step = steps[i];
      step.status = 'running';
      step.startTime = Date.now();
      
      execution.steps = [...steps];
      setCurrentExecution({...execution});

      // 模拟执行时间
      const executionTime = Math.random() * 3000 + 1000;
      await new Promise(resolve => setTimeout(resolve, executionTime));

      // 模拟执行结果
      const success = Math.random() > 0.1; // 90% 成功率
      
      step.endTime = Date.now();
      step.duration = step.endTime - step.startTime;
      step.memory = Math.floor(Math.random() * 100) + 50;

      if (success) {
        step.status = 'completed';
        step.output = generateMockOutput(nodes.find(n => n.id === step.nodeId)!);
      } else {
        step.status = 'error';
        step.error = '模拟执行错误';
        break;
      }

      execution.steps = [...steps];
      
      if (execution.metrics) {
        execution.metrics.completedNodes = steps.filter(s => s.status === 'completed').length;
        execution.metrics.errorNodes = steps.filter(s => s.status === 'error').length;
      }

      setCurrentExecution({...execution});
    }

    execution.status = steps.some(s => s.status === 'error') ? 'error' : 'completed';
    execution.endTime = Date.now();
    
    if (execution.metrics) {
      execution.metrics.totalDuration = execution.endTime - execution.startTime;
    }

    setCurrentExecution({...execution});
    setExecutionHistory(prev => [execution, ...prev]);
  };

  const generateMockOutput = (node: Node) => {
    switch (node.data.type) {
      case 'llm':
        return { response: 'LLM生成的回复', tokens: 150, model: node.data.config?.model || 'qwen-turbo' };
      case 'rag_retriever':
      case 'retriever':
      case 'hybrid_retriever':
        return { documents: ['文档1', '文档2', '文档3'], scores: [0.95, 0.87, 0.76] };
      case 'classifier':
        return { class: '正面', confidence: 0.92, all_classes: node.data.config?.classes || [] };
      default:
        return { result: `${node.data.name} 执行完成`, timestamp: Date.now() };
    }
  };

  const handleStop = async () => {
    if (workflowId && executionIdRef.current) {
      try {
        await workflowApi.stopExecution(workflowId, executionIdRef.current);
      } catch (error) {
        console.error('Failed to stop execution:', error);
      }
    }
    
    setIsExecuting(false);
    if (currentExecution) {
      currentExecution.status = 'stopped';
      currentExecution.endTime = Date.now();
      setCurrentExecution({...currentExecution});
    }
  };

  const handleSave = async () => {
    if (!workflowName.trim()) {
      setSaveDialogOpen(true);
      return;
    }

    try {
      if (workflowId) {
        // 更新现有工作流
        await workflowApi.update(workflowId, {
          name: workflowName,
          description: workflowDescription,
          nodes,
          edges
        });
      } else {
        // 创建新工作流
        const response = await workflowApi.create({
          name: workflowName,
          description: workflowDescription,
          nodes,
          edges
        });
        onSave?.(response.data);
      }
    } catch (error) {
      console.error('Failed to save workflow:', error);
    }
  };

  const getStepIcon = (step: ExecutionStep) => {
    switch (step.status) {
      case 'completed':
        return <SuccessIcon sx={{ color: '#4caf50' }} />;
      case 'error':
        return <ErrorIcon sx={{ color: '#f44336' }} />;
      case 'running':
        return <ScheduleIcon sx={{ color: '#ff9800' }} />;
      default:
        return <ScheduleIcon sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />;
    }
  };

  // 计算某节点的所有下游节点（用于前端模拟的单步重试）
  const getDescendantNodeIds = (startNodeId: string): string[] => {
    const visited = new Set<string>();
    const queue: string[] = [startNodeId];
    while (queue.length) {
      const nid = queue.shift()!;
      if (visited.has(nid)) continue;
      visited.add(nid);
      const children = edges.filter(e => e.source === nid).map(e => e.target);
      children.forEach((c) => { if (!visited.has(c)) queue.push(c); });
    }
    // 移除起始节点本身仅在需要时处理；这里保留起始节点
    return Array.from(visited);
  };

  // 前端模拟：重试指定步骤（重跑该步及其下游）
  const retryStepLocal = async (stepId: string) => {
    if (!currentExecution) return;
    if (isExecuting) return; // 正在执行时不允许重试

    const exec = { ...currentExecution } as ExecutionResult;
    const step = exec.steps.find(s => s.id === stepId);
    if (!step) return;

    const affectedNodeIds = getDescendantNodeIds(step.nodeId);

    // 将受影响步骤置为pending
    exec.steps = exec.steps.map((s) => (
      affectedNodeIds.includes(s.nodeId)
        ? { ...s, status: 'pending', error: undefined, output: undefined, startTime: undefined, endTime: undefined, duration: undefined }
        : s
    ));
    setCurrentExecution(exec);

    // 顺序重跑：从当前步开始，按当前 steps 顺序依次执行受影响的节点
    for (const s of exec.steps) {
      if (!affectedNodeIds.includes(s.nodeId)) continue;
      s.status = 'running';
      s.startTime = Date.now();
      setCurrentExecution({ ...exec });

      // 模拟耗时
      const executionTime = Math.random() * 1500 + 400;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, executionTime));

      // 90% 成功率
      const success = Math.random() > 0.1;
      s.endTime = Date.now();
      s.duration = s.endTime - s.startTime;
      s.memory = Math.floor(Math.random() * 100) + 50;
      if (success) {
        const node = nodes.find(n => n.id === s.nodeId)!;
        s.status = 'completed';
        s.output = generateMockOutput(node);
      } else {
        s.status = 'error';
        s.error = '模拟执行错误';
        break;
      }
      // 更新指标
      if (exec.metrics) {
        exec.metrics.completedNodes = exec.steps.filter(ss => ss.status === 'completed').length;
        exec.metrics.errorNodes = exec.steps.filter(ss => ss.status === 'error').length;
      }
      setCurrentExecution({ ...exec });
    }
  };

  // 后端：重试指定节点（重跑该节点及其下游）
  const retryStepBackend = async (nodeId: string) => {
    if (!workflowId) {
      alert('请先保存工作流再执行（不提供本地模拟）');
      return;
    }

    // 优先从当前执行获取后端执行ID；否则尝试从历史记录获取最近一次
    let baseExecutionId = currentExecution?.backendExecutionId;
    if (!baseExecutionId) {
      try {
        const res = await workflowApi.getExecutionHistory(workflowId);
        const list = res.data?.executions || [];
        if (list.length > 0) baseExecutionId = list[0].execution_id;
      } catch (e) {
        console.error('加载执行历史失败:', e);
      }
    }

    if (!baseExecutionId) {
      alert('未找到可重试的后端执行ID，请先执行一次工作流');
      return;
    }

    setIsExecuting(true);
    try {
      const response = await workflowApi.retryStep(workflowId, baseExecutionId, nodeId);
      const data = response.data || response;

      // 用返回结果构建新的当前执行视图
      const newExec: ExecutionResult = {
        id: `exec_${Date.now()}`,
        status: data.status || 'completed',
        startTime: Date.now(),
        endTime: Date.now(),
        steps: (data.steps || []).map((s: any) => ({
          id: s.step_id,
          nodeId: s.node_id,
          nodeName: s.node_name,
          status: s.status,
          startTime: undefined,
          endTime: undefined,
          duration: s.duration,
          input: s.input,
          output: s.output,
          error: s.error,
          memory: undefined,
        })),
        metrics: {
          totalNodes: nodes.length,
          completedNodes: (data.steps || []).filter((s: any) => s.status === 'completed').length,
          errorNodes: (data.steps || []).filter((s: any) => s.status === 'error').length,
          totalDuration: undefined,
          memoryUsage: undefined,
        },
        backendExecutionId: data.execution_id,
        result: { output_data: data.output_data },
        error: data.error,
      };

      setCurrentExecution(newExec);
      // 刷新历史
      await loadExecutionHistory();
    } catch (e: any) {
      console.error('单步重试失败:', e);
      alert(`单步重试失败: ${e?.message || '未知错误'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 控制栏 */}
      <Paper sx={{ p: 2, mb: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Button
            startIcon={<PlayIcon />}
            onClick={handleExecute}
            disabled={isExecuting}
            variant="contained"
            sx={{ 
              background: 'linear-gradient(45deg, #4caf50 0%, #388e3c 100%)',
              '&:disabled': { opacity: 0.6 }
            }}
          >
            执行工作流
          </Button>
          
          <Button
            startIcon={<StopIcon />}
            onClick={handleStop}
            disabled={!isExecuting}
            variant="outlined"
            sx={{ color: '#f44336', borderColor: '#f44336' }}
          >
            停止
          </Button>
          
          <Button
            startIcon={<SaveIcon />}
            onClick={handleSave}
            variant="outlined"
            sx={{ color: '#00d4ff', borderColor: '#00d4ff' }}
          >
            保存工作流
          </Button>
          
          <Button
            startIcon={<RefreshIcon />}
            onClick={loadExecutionHistory}
            disabled={!workflowId}
            sx={{ color: '#fff' }}
          >
            刷新历史
          </Button>
          
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel sx={{ color: 'white' }}>执行模式</InputLabel>
            <Select
              value={debugMode ? 'debug' : 'normal'}
              onChange={(e) => setDebugMode(e.target.value === 'debug')}
              label="执行模式"
              sx={{ color: 'white' }}
            >
              <MenuItem value="normal">正常执行</MenuItem>
              <MenuItem value="debug">调试模式</MenuItem>
            </Select>
          </FormControl>

          {/* 输入参数编辑快捷按钮 */}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" variant="outlined" onClick={() => setInputDialogOpen(true)} sx={{ color: '#00d4ff', borderColor: '#00d4ff' }}>
              编辑输入
            </Button>
            <Button size="small" variant="outlined" onClick={buildRecommendedInput} sx={{ color: '#9ccc65', borderColor: '#9ccc65' }}>
              填充建议
            </Button>
          </Box>
        </Box>
        
        {isExecuting && currentExecution && (
          <Box>
            <LinearProgress 
              variant="determinate" 
              value={currentExecution.metrics ? 
                (currentExecution.metrics.completedNodes / currentExecution.metrics.totalNodes) * 100 : 0
              }
              sx={{ 
                height: 8,
                borderRadius: 4,
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                '& .MuiLinearProgress-bar': {
                  background: 'linear-gradient(45deg, #00d4ff 0%, #0099cc 100%)'
                }
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              <Typography variant="body2" sx={{ color: 'white' }}>
                执行进度: {currentExecution.metrics?.completedNodes || 0} / {currentExecution.metrics?.totalNodes || 0}
              </Typography>
              {currentExecution.status === 'running' && (
                <Chip label="执行中" size="small" sx={{ ml: 1, backgroundColor: 'rgba(76, 175, 80, 0.2)' }} />
              )}
            </Box>
          </Box>
        )}
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, height: '100%' }}>
        {/* 当前执行状态 */}
        <Paper sx={{ flex: 1, p: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)', overflow: 'auto' }}>
          <Typography variant="h6" sx={{ color: '#00d4ff', mb: 2, display: 'flex', alignItems: 'center' }}>
            <ViewIcon sx={{ mr: 1 }} />
            当前执行
          </Typography>
          
          {currentExecution ? (
            <Box>
              <Box sx={{ mb: 2 }}>
                <Chip 
                  label={currentExecution.status} 
                  color={
                    currentExecution.status === 'completed' ? 'success' :
                    currentExecution.status === 'error' ? 'error' :
                    currentExecution.status === 'running' ? 'warning' : 'default'
                  }
                  sx={{ mb: 1 }}
                />
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                  开始时间: {new Date(currentExecution.startTime).toLocaleString()}
                </Typography>
                {currentExecution.endTime && (
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                    总耗时: {Math.round((currentExecution.endTime - currentExecution.startTime) / 1000 * 100) / 100}秒
                  </Typography>
                )}
              </Box>

              <Stepper orientation="vertical">
                {currentExecution.steps.map((step, index) => (
                  <Step key={step.id} active={true} completed={step.status === 'completed'}>
                    <StepLabel 
                      icon={getStepIcon(step)}
                      sx={{
                        '& .MuiStepLabel-label': {
                          color: 'white',
                          fontWeight: step.status === 'running' ? 600 : 400
                        }
                      }}
                    >
                      {step.nodeName}
                      {step.duration && (
                        <Chip 
                          label={`${step.duration}ms`} 
                          size="small" 
                          sx={{ ml: 1, backgroundColor: 'rgba(0, 212, 255, 0.2)' }}
                        />
                      )}
                    </StepLabel>
                    <StepContent>
                      <Box sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        <Typography variant="body2">状态: {step.status}</Typography>
                        {step.memory && (
                          <Typography variant="body2">内存: {step.memory} MB</Typography>
                        )}
                        {step.input && (
                          <Accordion sx={{ mt: 1, backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2">输入数据</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <pre style={{ fontSize: '0.75rem', margin: 0 }}>
                                {JSON.stringify(step.input, null, 2)}
                              </pre>
                            </AccordionDetails>
                          </Accordion>
                        )}
                        {step.output && (
                          <Accordion sx={{ mt: 1, backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2">输出数据</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <pre style={{ fontSize: '0.75rem', margin: 0 }}>
                                {JSON.stringify(step.output, null, 2)}
                              </pre>
                            </AccordionDetails>
                          </Accordion>
                        )}
                        {step.error && (
                          <Alert severity="error" sx={{ mt: 1 }}>
                            {step.error}
                          </Alert>
                        )}
                        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined" 
                            onClick={() => retryStepBackend(step.nodeId)}
                          >
                            重试该步
                          </Button>
                        </Box>
                      </Box>
                    </StepContent>
                  </Step>
                ))}
              </Stepper>
            </Box>
          ) : (
            <Alert severity="info">
              点击"执行工作流"开始执行
            </Alert>
          )}
        </Paper>

        {/* 执行历史 */}
        <Paper sx={{ flex: 1, p: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)', overflow: 'auto' }}>
          <Typography variant="h6" sx={{ color: '#00d4ff', mb: 2, display: 'flex', alignItems: 'center' }}>
            <MemoryIcon sx={{ mr: 1 }} />
            执行历史
          </Typography>
          
          <List>
            {executionHistory.map((execution, index) => (
              <React.Fragment key={execution.id}>
                <ListItem>
                  <Card sx={{ width: '100%', backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Chip 
                          label={execution.status}
                          color={
                            execution.status === 'completed' ? 'success' :
                            execution.status === 'error' ? 'error' : 'default'
                          }
                          size="small"
                        />
                        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                          {new Date(execution.startTime).toLocaleString()}
                        </Typography>
                      </Box>
                      
                      <Typography variant="body2" sx={{ color: 'white', mb: 1 }}>
                        节点: {execution.metrics?.completedNodes || 0} / {execution.metrics?.totalNodes || 0}
                      </Typography>
                      
                      {execution.metrics?.totalDuration && (
                        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                          耗时: {Math.round(execution.metrics.totalDuration / 1000 * 100) / 100}秒
                        </Typography>
                      )}
                      
                      {execution.error && (
                        <Typography variant="body2" sx={{ color: '#f44336', mt: 1 }}>
                          错误: {execution.error}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                </ListItem>
                {index < executionHistory.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
          
          {executionHistory.length === 0 && (
            <Alert severity="info">
              暂无执行历史记录
            </Alert>
          )}
        </Paper>
      </Box>

      {/* 输入对话框 */}
      <Dialog open={inputDialogOpen} onClose={() => setInputDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>执行输入参数</DialogTitle>
        <DialogContent>
          <Tabs value={inputTab} onChange={(_, v) => setInputTab(v)} sx={{ mb: 1 }}>
            <Tab label="表单" value="form" />
            <Tab label="JSON" value="json" />
          </Tabs>
          {inputTab === 'form' ? (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <TextField label="Prompt" value={formPrompt} onChange={(e) => setFormPrompt(e.target.value)} fullWidth />
                <TextField label="System Prompt" value={formSystemPrompt} onChange={(e) => setFormSystemPrompt(e.target.value)} fullWidth />
                <TextField label="知识库(可选)" value={formKnowledgeBase} onChange={(e) => setFormKnowledgeBase(e.target.value)} fullWidth />
                <TextField label="Top K" type="number" value={formTopK} onChange={(e) => setFormTopK(e.target.value === '' ? '' : Number(e.target.value))} fullWidth />
                <TextField label="Temperature" type="number" value={formTemperature} onChange={(e) => setFormTemperature(e.target.value === '' ? '' : Number(e.target.value))} fullWidth />
                <TextField label="Max Tokens" type="number" value={formMaxTokens} onChange={(e) => setFormMaxTokens(e.target.value === '' ? '' : Number(e.target.value))} fullWidth />
              </Box>
              <Box sx={{ mt: 1 }}>
                <FormControlLabel control={<Switch checked={formEnableParallel} onChange={(e) => setFormEnableParallel(e.target.checked)} />} label="并行执行" />
                <FormControlLabel control={<Switch checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />} label="调试模式" />
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>自定义字段</Typography>
                {customFields.map((f, idx) => (
                  <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr auto', gap: 1, mb: 1 }}>
                    <TextField placeholder="key" value={f.key} onChange={(e) => {
                      const copy = customFields.slice(); copy[idx].key = e.target.value; setCustomFields(copy);
                    }} />
                    <TextField select value={f.type} onChange={(e) => {
                      const copy = customFields.slice(); copy[idx].type = (e.target.value as any); setCustomFields(copy);
                    }}>
                      <MenuItem value="string">string</MenuItem>
                      <MenuItem value="number">number</MenuItem>
                      <MenuItem value="boolean">boolean</MenuItem>
                    </TextField>
                    <TextField placeholder="value" value={f.value} onChange={(e) => {
                      const copy = customFields.slice(); copy[idx].value = e.target.value; setCustomFields(copy);
                    }} />
                    <Button size="small" onClick={() => setCustomFields(customFields.filter((_, i) => i !== idx))}>删除</Button>
                  </Box>
                ))}
                <Button size="small" onClick={() => setCustomFields([...customFields, { key: '', type: 'string', value: '' }])}>添加字段</Button>
              </Box>
            </>
          ) : (
            <>
              <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                使用 JSON 格式填写工作流执行的 input_data。你也可以点击“填充建议”快速生成示例。
              </Typography>
              <TextField
                fullWidth
                multiline
                minRows={10}
                label="输入数据 (JSON)"
                value={executionInput}
                onChange={(e) => setExecutionInput(e.target.value)}
                placeholder='例如: {"prompt": "你好", "system_prompt": "你是助手"}'
                sx={{ mt: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
              {inputError && <Alert severity="error" sx={{ mt: 1 }}>{inputError}</Alert>}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInputDialogOpen(false)}>取消</Button>
          <Button onClick={buildRecommendedInput}>填充建议</Button>
          <Button 
            onClick={() => {
              if (inputTab === 'json') {
                try { JSON.parse(executionInput); setInputError(null); } catch (e: any) { setInputError(e.message || 'JSON 解析错误'); return; }
              }
              setInputDialogOpen(false);
              handleExecute();
            }} 
            variant="contained"
          >
            开始执行
          </Button>
        </DialogActions>
      </Dialog>

      {/* 保存对话框 */}
      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)}>
        <DialogTitle>保存工作流</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="工作流名称"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            sx={{ mb: 2, mt: 1 }}
          />
          <TextField
            fullWidth
            label="描述"
            multiline
            rows={3}
            value={workflowDescription}
            onChange={(e) => setWorkflowDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>取消</Button>
          <Button 
            onClick={() => {
              setSaveDialogOpen(false);
              handleSave();
            }} 
            variant="contained"
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkflowExecution;
