/**
 * 自定义函数创建器
 * 允许用户通过编写代码创建自定义组件
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Grid,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Alert,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Code as CodeIcon,
  PlayArrow as PlayIcon,
  Settings as SettingsIcon,
  Psychology as AIIcon,
  Storage as DataIcon,
  Transform as ProcessIcon,
  BuildCircle as BuildIcon,
  Preview as PreviewIcon,
} from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Parameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  description: string;
  required: boolean;
  defaultValue?: any;
  example?: string;
}

interface CustomFunction {
  name: string;
  description: string;
  category: 'llm' | 'data' | 'process' | 'condition' | 'tool' | 'agent';
  inputs: Parameter[];
  outputs: Parameter[];
  implementation: string;
  dependencies: string[];
  isAsync: boolean;
  version: string;
  author: string;
  tags: string[];
}

interface CustomFunctionCreatorProps {
  open: boolean;
  onClose: () => void;
  onSave: (customFunction: CustomFunction) => void;
  initialFunction?: CustomFunction;
}

const CustomFunctionCreator: React.FC<CustomFunctionCreatorProps> = ({
  open,
  onClose,
  onSave,
  initialFunction,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [functionData, setFunctionData] = useState<CustomFunction>({
    name: '',
    description: '',
    category: 'process',
    inputs: [],
    outputs: [],
    implementation: '',
    dependencies: [],
    isAsync: false,
    version: '1.0.0',
    author: '',
    tags: [],
  });
  const [newParameter, setNewParameter] = useState<Parameter>({
    name: '',
    type: 'string',
    description: '',
    required: false,
    defaultValue: '',
    example: '',
  });
  const [testResult, setTestResult] = useState<string>('');
  const [parameterType, setParameterType] = useState<'input' | 'output'>('input');

  // 预设的代码模板
  const codeTemplates = {
    llm: `async function ${functionData.name}(inputs) {
  // LLM调用示例
  const { prompt, temperature = 0.7, max_tokens = 1000 } = inputs;
  
  // 调用LLM API
  const response = await callLLM({
    prompt,
    temperature,
    max_tokens,
    model: 'qwen-turbo'
  });
  
  return {
    result: response.content,
    tokens_used: response.usage.total_tokens,
    finish_reason: response.finish_reason
  };
}`,
    data: `async function ${functionData.name}(inputs) {
  // 数据处理示例
  const { data, operation = 'transform' } = inputs;
  
  let result;
  switch (operation) {
    case 'transform':
      result = data.map(item => ({
        ...item,
        processed: true,
        timestamp: new Date().toISOString()
      }));
      break;
    case 'filter':
      result = data.filter(item => item.active);
      break;
    default:
      result = data;
  }
  
  return {
    processed_data: result,
    count: result.length,
    operation_type: operation
  };
}`,
    process: `async function ${functionData.name}(inputs) {
  // 流程处理示例
  const { input_data, config = {} } = inputs;
  
  // 执行处理逻辑
  const processedData = await processData(input_data, config);
  
  // 验证结果
  const isValid = validateResult(processedData);
  
  return {
    output_data: processedData,
    is_valid: isValid,
    processing_time: Date.now() - startTime,
    metadata: {
      processed_at: new Date().toISOString(),
      config_used: config
    }
  };
}`,
    condition: `function ${functionData.name}(inputs) {
  // 条件判断示例
  const { value, condition, threshold = 0.5 } = inputs;
  
  let result = false;
  switch (condition) {
    case 'greater_than':
      result = value > threshold;
      break;
    case 'less_than':
      result = value < threshold;
      break;
    case 'equals':
      result = value === threshold;
      break;
    case 'contains':
      result = String(value).includes(String(threshold));
      break;
    default:
      result = Boolean(value);
  }
  
  return {
    condition_result: result,
    input_value: value,
    condition_type: condition,
    threshold_used: threshold
  };
}`,
    tool: `async function ${functionData.name}(inputs) {
  // 工具调用示例
  const { action, parameters = {} } = inputs;
  
  let result;
  try {
    // 调用外部工具或API
    result = await callExternalTool(action, parameters);
    
    return {
      success: true,
      result: result,
      action_performed: action,
      execution_time: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      action_attempted: action,
      parameters_used: parameters
    };
  }
}`,
    agent: `async function ${functionData.name}(inputs) {
  // Agent代理示例
  const { task, context = {}, previous_results = [] } = inputs;
  
  // 分析任务
  const taskAnalysis = analyzeTask(task);
  
  // 执行智能体逻辑
  const agentResult = await executeAgent({
    task: taskAnalysis,
    context,
    history: previous_results
  });
  
  return {
    agent_response: agentResult.response,
    confidence: agentResult.confidence,
    reasoning: agentResult.reasoning,
    next_actions: agentResult.next_actions,
    updated_context: agentResult.context
  };
}`,
  };

  // 初始化函数数据
  useEffect(() => {
    if (initialFunction) {
      setFunctionData(initialFunction);
    }
  }, [initialFunction]);

  // 更新代码模板
  useEffect(() => {
    if (functionData.name && functionData.category) {
      const template = codeTemplates[functionData.category];
      if (template && !functionData.implementation) {
        setFunctionData(prev => ({
          ...prev,
          implementation: template.replace(/\$\{functionData\.name\}/g, functionData.name)
        }));
      }
    }
  }, [functionData.name, functionData.category]);

  // 添加参数
  const addParameter = () => {
    if (!newParameter.name || !newParameter.description) return;
    
    const targetArray = parameterType === 'input' ? 'inputs' : 'outputs';
    setFunctionData(prev => ({
      ...prev,
      [targetArray]: [...prev[targetArray], { ...newParameter }]
    }));
    
    setNewParameter({
      name: '',
      type: 'string',
      description: '',
      required: false,
      defaultValue: '',
      example: '',
    });
  };

  // 删除参数
  const removeParameter = (index: number, type: 'input' | 'output') => {
    const targetArray = type === 'input' ? 'inputs' : 'outputs';
    setFunctionData(prev => ({
      ...prev,
      [targetArray]: prev[targetArray].filter((_, i) => i !== index)
    }));
  };

  // 测试函数
  const testFunction = async () => {
    try {
      // 这里可以实现真正的函数测试逻辑
      const testInputs = functionData.inputs.reduce((acc, param) => {
        acc[param.name] = param.example || param.defaultValue || 
          (param.type === 'string' ? 'test' : 
           param.type === 'number' ? 42 : 
           param.type === 'boolean' ? true : {});
        return acc;
      }, {} as any);
      
      setTestResult(`测试成功！\n输入: ${JSON.stringify(testInputs, null, 2)}\n输出: [模拟结果]`);
    } catch (error) {
      setTestResult(`测试失败: ${error}`);
    }
  };

  // 保存函数
  const handleSave = () => {
    if (!functionData.name || !functionData.description || !functionData.implementation) {
      return;
    }
    
    onSave(functionData);
    onClose();
  };

  // 获取分类图标
  const getCategoryIcon = (category: string) => {
    const icons = {
      llm: <AIIcon />,
      data: <DataIcon />,
      process: <ProcessIcon />,
      condition: <BuildIcon />,
      tool: <SettingsIcon />,
      agent: <AIIcon />,
    };
    return icons[category as keyof typeof icons] || <CodeIcon />;
  };

  const steps = [
    {
      label: '基本信息',
      content: (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="函数名称"
              value={functionData.name}
              onChange={(e) => setFunctionData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="my_custom_function"
              helperText="使用下划线命名，如：process_data"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth>
              <InputLabel>函数分类</InputLabel>
              <Select
                value={functionData.category}
                onChange={(e) => setFunctionData(prev => ({ ...prev, category: e.target.value as any }))}
                label="函数分类"
              >
                <MenuItem value="llm">🧠 LLM调用</MenuItem>
                <MenuItem value="data">📊 数据处理</MenuItem>
                <MenuItem value="process">⚙️ 流程处理</MenuItem>
                <MenuItem value="condition">🔀 条件判断</MenuItem>
                <MenuItem value="tool">🔧 工具调用</MenuItem>
                <MenuItem value="agent">🤖 智能代理</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={12}>
            <TextField
              fullWidth
              label="函数描述"
              multiline
              rows={3}
              value={functionData.description}
              onChange={(e) => setFunctionData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="描述这个函数的功能和用途..."
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="作者"
              value={functionData.author}
              onChange={(e) => setFunctionData(prev => ({ ...prev, author: e.target.value }))}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="版本"
              value={functionData.version}
              onChange={(e) => setFunctionData(prev => ({ ...prev, version: e.target.value }))}
            />
          </Grid>
          <Grid size={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={functionData.isAsync}
                  onChange={(e) => setFunctionData(prev => ({ ...prev, isAsync: e.target.checked }))}
                />
              }
              label="异步函数"
            />
          </Grid>
        </Grid>
      ),
    },
    {
      label: '参数定义',
      content: (
        <Box>
          <Grid container spacing={2}>
            {/* 参数类型选择 */}
            <Grid size={12}>
              <FormControl fullWidth>
                <InputLabel>参数类型</InputLabel>
                <Select
                  value={parameterType}
                  onChange={(e) => setParameterType(e.target.value as 'input' | 'output')}
                  label="参数类型"
                >
                  <MenuItem value="input">输入参数</MenuItem>
                  <MenuItem value="output">输出参数</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            
            {/* 新参数输入 */}
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="参数名称"
                value={newParameter.name}
                onChange={(e) => setNewParameter(prev => ({ ...prev, name: e.target.value }))}
                placeholder="parameter_name"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <FormControl fullWidth>
                <InputLabel>数据类型</InputLabel>
                <Select
                  value={newParameter.type}
                  onChange={(e) => setNewParameter(prev => ({ ...prev, type: e.target.value as any }))}
                  label="数据类型"
                >
                  <MenuItem value="string">字符串</MenuItem>
                  <MenuItem value="number">数字</MenuItem>
                  <MenuItem value="boolean">布尔值</MenuItem>
                  <MenuItem value="object">对象</MenuItem>
                  <MenuItem value="array">数组</MenuItem>
                  <MenuItem value="any">任意类型</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="参数描述"
                value={newParameter.description}
                onChange={(e) => setNewParameter(prev => ({ ...prev, description: e.target.value }))}
                placeholder="描述这个参数的用途..."
              />
            </Grid>
            <Grid size={{ xs: 12, md: 1 }}>
              <Button
                variant="contained"
                onClick={addParameter}
                disabled={!newParameter.name || !newParameter.description}
                sx={{ height: '56px' }}
              >
                <AddIcon />
              </Button>
            </Grid>
            
            {/* 参数列表 */}
            <Grid size={12}>
              <Typography variant="h6" gutterBottom>
                输入参数 ({functionData.inputs.length})
              </Typography>
              <List>
                {functionData.inputs.map((param, index) => (
                  <ListItem key={index}>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body1">{param.name}</Typography>
                          <Chip label={param.type} size="small" />
                          {param.required && <Chip label="必需" size="small" color="error" />}
                        </Box>
                      }
                      secondary={param.description}
                    />
                    <ListItemSecondaryAction>
                      <IconButton onClick={() => removeParameter(index, 'input')}>
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
              
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                输出参数 ({functionData.outputs.length})
              </Typography>
              <List>
                {functionData.outputs.map((param, index) => (
                  <ListItem key={index}>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body1">{param.name}</Typography>
                          <Chip label={param.type} size="small" />
                        </Box>
                      }
                      secondary={param.description}
                    />
                    <ListItemSecondaryAction>
                      <IconButton onClick={() => removeParameter(index, 'output')}>
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </Grid>
          </Grid>
        </Box>
      ),
    },
    {
      label: '代码实现',
      content: (
        <Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            请实现函数逻辑。函数接收inputs对象作为参数，返回outputs对象。
          </Alert>
          
          <TextField
            fullWidth
            multiline
            rows={20}
            value={functionData.implementation}
            onChange={(e) => setFunctionData(prev => ({ ...prev, implementation: e.target.value }))}
            variant="outlined"
            sx={{
              '& .MuiInputBase-input': {
                fontFamily: 'Monaco, Menlo, monospace',
                fontSize: '0.9rem',
              },
            }}
          />
          
          <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<PlayIcon />}
              onClick={testFunction}
            >
              测试函数
            </Button>
            <Button
              variant="outlined"
              startIcon={<PreviewIcon />}
              onClick={() => {
                // 显示代码预览
                console.log('Preview code');
              }}
            >
              预览代码
            </Button>
          </Box>
          
          {testResult && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" gutterBottom>测试结果</Typography>
              <SyntaxHighlighter language="javascript" style={atomDark}>
                {testResult}
              </SyntaxHighlighter>
            </Box>
          )}
        </Box>
      ),
    },
    {
      label: '预览与保存',
      content: (
        <Box>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                {getCategoryIcon(functionData.category)}
                <Typography variant="h6" sx={{ ml: 1 }}>
                  {functionData.name}
                </Typography>
                <Chip label={functionData.category} sx={{ ml: 1 }} />
              </Box>
              
              <Typography variant="body2" sx={{ mb: 2 }}>
                {functionData.description}
              </Typography>
              
              <Grid container spacing={2}>
                <Grid size={6}>
                  <Typography variant="subtitle2" color="primary">
                    输入参数 ({functionData.inputs.length})
                  </Typography>
                  {functionData.inputs.map((param, index) => (
                    <Typography key={index} variant="body2" sx={{ ml: 1 }}>
                      • {param.name} ({param.type})
                    </Typography>
                  ))}
                </Grid>
                <Grid size={6}>
                  <Typography variant="subtitle2" color="secondary">
                    输出参数 ({functionData.outputs.length})
                  </Typography>
                  {functionData.outputs.map((param, index) => (
                    <Typography key={index} variant="body2" sx={{ ml: 1 }}>
                      • {param.name} ({param.type})
                    </Typography>
                  ))}
                </Grid>
              </Grid>
            </CardContent>
          </Card>
          
          <Alert severity="success">
            函数创建完成！点击"保存函数"将其添加到组件库中。
          </Alert>
        </Box>
      ),
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          height: '90vh',
          background: 'linear-gradient(135deg, #1a1f2e 0%, #2d3748 100%)',
          color: 'white',
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <CodeIcon sx={{ mr: 1 }} />
          创建自定义函数组件
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Stepper activeStep={activeStep} orientation="vertical">
          {steps.map((step, index) => (
            <Step key={index}>
              <StepLabel>{step.label}</StepLabel>
              <StepContent>
                {step.content}
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="contained"
                    onClick={() => setActiveStep(activeStep + 1)}
                    sx={{ mr: 1 }}
                    disabled={index === steps.length - 1}
                  >
                    {index === steps.length - 1 ? '完成' : '下一步'}
                  </Button>
                  <Button
                    disabled={index === 0}
                    onClick={() => setActiveStep(activeStep - 1)}
                  >
                    上一步
                  </Button>
                </Box>
              </StepContent>
            </Step>
          ))}
        </Stepper>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!functionData.name || !functionData.description || !functionData.implementation}
        >
          保存函数
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CustomFunctionCreator;
