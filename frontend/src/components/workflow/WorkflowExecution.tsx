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
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [executionInput, setExecutionInput] = useState('{}');
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
    if (!executionInput.trim()) {
      setInputDialogOpen(true);
      return;
    }
    try { JSON.parse(executionInput); setInputError(null); } catch (e: any) { setInputError(e.message || 'JSON 解析错误'); setInputDialogOpen(true); return; }

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
      if (workflowId) {
        // 使用后端API执行工作流
        await executeWithBackend(workflowId, execution);
      } else {
        // 本地模拟执行
        await executeLocally(execution);
      }
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
    const recommended: any = {};
    const hasLLM = nodes.some((n: any) => (n.data?.type || n.type) === 'llm');
    const hasRetriever = nodes.some((n: any) => (n.data?.type || n.type) === 'rag_retriever');
    const hasInput = nodes.some((n: any) => (n.data?.type || n.type) === 'input');
    if (hasLLM) {
      recommended.prompt = recommended.prompt || '请用一句话介绍这个系统';
      recommended.system_prompt = '';
    }
    if (hasRetriever) {
      recommended.query = recommended.query || '公司加班政策';
    }
    if (hasInput) {
      recommended.text = recommended.text || '测试输入';
    }
    setExecutionInput(JSON.stringify(recommended, null, 2));
  };

  const executeWithBackend = async (workflowId: string, execution: ExecutionResult) => {
    try {
      let inputData;
      try {
        inputData = JSON.parse(executionInput);
      } catch {
        inputData = { input: executionInput };
      }

      await workflowApi.executeStream(
        workflowId,
        {
          input_data: inputData,
          debug: debugMode
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
          execution.endTime = Date.now();
          
          if (execution.metrics) {
            execution.metrics.totalDuration = execution.endTime - execution.startTime;
          }

          setCurrentExecution({...execution});
          setExecutionHistory(prev => [execution, ...prev]);
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
            <Typography variant="body2" sx={{ color: 'white', mt: 1 }}>
              执行进度: {currentExecution.metrics?.completedNodes || 0} / {currentExecution.metrics?.totalNodes || 0}
              {currentExecution.status === 'running' && (
                <Chip label="执行中" size="small" sx={{ ml: 1, backgroundColor: 'rgba(76, 175, 80, 0.2)' }} />
              )}
            </Typography>
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
                          <Button size="small" variant="outlined" onClick={() => alert('单步重试：当前为前端模拟，后端逐步重试接口待对接')}>重试该步</Button>
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInputDialogOpen(false)}>取消</Button>
          <Button onClick={buildRecommendedInput}>填充建议</Button>
          <Button 
            onClick={() => {
              try { JSON.parse(executionInput); setInputError(null); setInputDialogOpen(false); } catch (e: any) { setInputError(e.message || 'JSON 解析错误'); return; }
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
