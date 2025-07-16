/**
 * 工作流调试器组件 - 提供工作流执行调试和监控功能
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Alert,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Accordion,
  AccordionSummary,
  AccordionDetails,
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
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Stop as StopIcon,
  BugReport as DebugIcon,
  Timeline as TimelineIcon,
  Visibility as ViewIcon,
  ExpandMore as ExpandMoreIcon,
  Error as ErrorIcon,
  CheckCircle as SuccessIcon,
  Schedule as ScheduleIcon,
  Memory as MemoryIcon,
} from '@mui/icons-material';
import type { Node, Edge } from 'reactflow';

interface DebugStep {
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

interface WorkflowDebuggerProps {
  nodes: Node[];
  edges: Edge[];
  onExecute?: (debugMode: boolean, breakpoints?: string[]) => void;
}

const WorkflowDebugger: React.FC<WorkflowDebuggerProps> = ({ nodes, edges, onExecute }) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [debugSteps, setDebugSteps] = useState<DebugStep[]>([]);
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [executionMode, setExecutionMode] = useState<'normal' | 'debug' | 'step'>('normal');
  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [executionInput, setExecutionInput] = useState('');
  const [executionLogs, setExecutionLogs] = useState<Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    message: string;
    nodeId?: string;
  }>>([]);

  // 初始化调试步骤
  useEffect(() => {
    const steps: DebugStep[] = [];
    const visited = new Set<string>();
    
    // 找到起始节点
    const startNodes = nodes.filter(node => 
      !edges.some(edge => edge.target === node.id)
    );
    
    // 使用拓扑排序生成执行顺序
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
        
        // 添加子节点
        const childEdges = edges.filter(edge => edge.source === nodeId);
        childEdges.forEach(edge => buildExecutionOrder(edge.target));
      }
    };
    
    startNodes.forEach(node => buildExecutionOrder(node.id));
    setDebugSteps(steps);
  }, [nodes, edges]);

  // 模拟工作流执行
  const simulateExecution = async () => {
    setIsExecuting(true);
    setCurrentStep(0);
    setExecutionLogs([]);
    
    const updatedSteps = [...debugSteps];
    
    for (let i = 0; i < updatedSteps.length; i++) {
      if (!isExecuting) break;
      
      setCurrentStep(i);
      
      // 检查断点
      if (breakpoints.has(updatedSteps[i].nodeId) && executionMode === 'debug') {
        setIsPaused(true);
        addLog('info', `在节点 "${updatedSteps[i].nodeName}" 处暂停`, updatedSteps[i].nodeId);
        
        // 等待用户继续
        while (isPaused && isExecuting) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // 开始执行步骤
      updatedSteps[i].status = 'running';
      updatedSteps[i].startTime = Date.now();
      setDebugSteps([...updatedSteps]);
      
      addLog('info', `开始执行节点: ${updatedSteps[i].nodeName}`, updatedSteps[i].nodeId);
      
      // 模拟执行时间
      const executionTime = Math.random() * 2000 + 500;
      await new Promise(resolve => setTimeout(resolve, executionTime));
      
      // 模拟执行结果
      const success = Math.random() > 0.1; // 90% 成功率
      
      updatedSteps[i].endTime = Date.now();
      updatedSteps[i].duration = updatedSteps[i].endTime! - updatedSteps[i].startTime!;
      updatedSteps[i].memory = Math.floor(Math.random() * 100) + 50; // MB
      
      if (success) {
        updatedSteps[i].status = 'completed';
        updatedSteps[i].output = generateMockOutput(nodes.find(n => n.id === updatedSteps[i].nodeId)!);
        addLog('info', `节点执行成功: ${updatedSteps[i].nodeName} (${updatedSteps[i].duration}ms)`, updatedSteps[i].nodeId);
      } else {
        updatedSteps[i].status = 'error';
        updatedSteps[i].error = '模拟执行错误';
        addLog('error', `节点执行失败: ${updatedSteps[i].nodeName}`, updatedSteps[i].nodeId);
        break;
      }
      
      setDebugSteps([...updatedSteps]);
      
      // 在步进模式下暂停
      if (executionMode === 'step') {
        setIsPaused(true);
        while (isPaused && isExecuting) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    
    setIsExecuting(false);
    setIsPaused(false);
    addLog('info', '工作流执行完成');
  };

  const generateMockOutput = (node: Node) => {
    switch (node.data.type) {
      case 'llm':
        return { response: '这是LLM生成的回复', tokens: 150, model: node.data.config?.model || 'qwen-turbo' };
      case 'rag_retriever':
        return { documents: ['文档1', '文档2', '文档3'], scores: [0.95, 0.87, 0.76] };
      case 'classifier':
        return { class: '正面', confidence: 0.92, all_classes: node.data.config?.classes || [] };
      default:
        return { result: `${node.data.name} 执行完成`, timestamp: Date.now() };
    }
  };

  const addLog = (level: 'info' | 'warn' | 'error', message: string, nodeId?: string) => {
    setExecutionLogs(prev => [...prev, {
      timestamp: Date.now(),
      level,
      message,
      nodeId
    }]);
  };

  const handleStart = () => {
    if (executionInput.trim()) {
      simulateExecution();
    } else {
      setInputDialogOpen(true);
    }
  };

  const handlePause = () => {
    setIsPaused(!isPaused);
  };

  const handleStop = () => {
    setIsExecuting(false);
    setIsPaused(false);
    setCurrentStep(0);
  };

  const toggleBreakpoint = (nodeId: string) => {
    const newBreakpoints = new Set(breakpoints);
    if (newBreakpoints.has(nodeId)) {
      newBreakpoints.delete(nodeId);
    } else {
      newBreakpoints.add(nodeId);
    }
    setBreakpoints(newBreakpoints);
  };

  const getStepIcon = (step: DebugStep) => {
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
            onClick={handleStart}
            disabled={isExecuting}
            variant="contained"
            sx={{ background: 'linear-gradient(45deg, #4caf50 0%, #388e3c 100%)' }}
          >
            开始执行
          </Button>
          
          <Button
            startIcon={<PauseIcon />}
            onClick={handlePause}
            disabled={!isExecuting}
            variant="outlined"
            sx={{ color: '#ff9800', borderColor: '#ff9800' }}
          >
            {isPaused ? '继续' : '暂停'}
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
          
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel sx={{ color: 'white' }}>执行模式</InputLabel>
            <Select
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value as any)}
              label="执行模式"
              sx={{ color: 'white' }}
            >
              <MenuItem value="normal">正常执行</MenuItem>
              <MenuItem value="debug">调试模式</MenuItem>
              <MenuItem value="step">步进执行</MenuItem>
            </Select>
          </FormControl>
          
          <Chip
            label={`断点: ${breakpoints.size}`}
            size="small"
            sx={{ backgroundColor: 'rgba(255, 152, 0, 0.2)', color: '#ff9800' }}
          />
        </Box>
        
        {isExecuting && (
          <Box sx={{ mb: 1 }}>
            <LinearProgress 
              variant="determinate" 
              value={(currentStep / debugSteps.length) * 100}
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
              执行进度: {currentStep} / {debugSteps.length} 
              {isPaused && <Chip label="已暂停" size="small" sx={{ ml: 1, backgroundColor: 'rgba(255, 152, 0, 0.2)' }} />}
            </Typography>
          </Box>
        )}
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, height: '100%' }}>
        {/* 执行步骤 */}
        <Paper sx={{ flex: 1, p: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)', overflow: 'auto' }}>
          <Typography variant="h6" sx={{ color: '#00d4ff', mb: 2, display: 'flex', alignItems: 'center' }}>
            <TimelineIcon sx={{ mr: 1 }} />
            执行步骤
          </Typography>
          
          <Stepper activeStep={currentStep} orientation="vertical">
            {debugSteps.map((step, index) => (
              <Step key={step.id}>
                <StepLabel 
                  icon={getStepIcon(step)}
                  sx={{
                    '& .MuiStepLabel-label': {
                      color: 'white',
                      fontWeight: step.status === 'running' ? 600 : 400
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {step.nodeName}
                    <IconButton
                      size="small"
                      onClick={() => toggleBreakpoint(step.nodeId)}
                      sx={{ 
                        color: breakpoints.has(step.nodeId) ? '#f44336' : 'rgba(255, 255, 255, 0.5)',
                        ml: 1
                      }}
                    >
                      <DebugIcon fontSize="small" />
                    </IconButton>
                    {step.duration && (
                      <Chip 
                        label={`${step.duration}ms`} 
                        size="small" 
                        sx={{ backgroundColor: 'rgba(0, 212, 255, 0.2)' }}
                      />
                    )}
                  </Box>
                </StepLabel>
                <StepContent>
                  <Box sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                    <Typography variant="body2">节点ID: {step.nodeId}</Typography>
                    <Typography variant="body2">状态: {step.status}</Typography>
                    {step.memory && (
                      <Typography variant="body2">内存使用: {step.memory} MB</Typography>
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
                  </Box>
                </StepContent>
              </Step>
            ))}
          </Stepper>
        </Paper>

        {/* 执行日志 */}
        <Paper sx={{ flex: 1, p: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)', overflow: 'auto' }}>
          <Typography variant="h6" sx={{ color: '#00d4ff', mb: 2, display: 'flex', alignItems: 'center' }}>
            <ViewIcon sx={{ mr: 1 }} />
            执行日志
          </Typography>
          
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>时间</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>级别</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>消息</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>节点</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {executionLogs.map((log, index) => (
                  <TableRow key={index}>
                    <TableCell sx={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.75rem' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={log.level}
                        size="small"
                        sx={{
                          backgroundColor: 
                            log.level === 'error' ? 'rgba(244, 67, 54, 0.2)' :
                            log.level === 'warn' ? 'rgba(255, 152, 0, 0.2)' :
                            'rgba(76, 175, 80, 0.2)',
                          color:
                            log.level === 'error' ? '#f44336' :
                            log.level === 'warn' ? '#ff9800' :
                            '#4caf50'
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'white', fontSize: '0.875rem' }}>
                      {log.message}
                    </TableCell>
                    <TableCell sx={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.75rem' }}>
                      {log.nodeId || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      {/* 输入对话框 */}
      <Dialog open={inputDialogOpen} onClose={() => setInputDialogOpen(false)}>
        <DialogTitle>设置执行输入</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="输入数据"
            value={executionInput}
            onChange={(e) => setExecutionInput(e.target.value)}
            placeholder="请输入工作流的初始数据..."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInputDialogOpen(false)}>取消</Button>
          <Button 
            onClick={() => {
              setInputDialogOpen(false);
              simulateExecution();
            }} 
            variant="contained"
          >
            开始执行
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkflowDebugger;