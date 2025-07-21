/**
 * 工作流数据流管理器
 * 负责管理节点间的数据传递、验证和转换
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Alert,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  Button,
  Grid,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  DataUsage as DataIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  CheckCircle as SuccessIcon,
  Visibility as ViewIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import type { Node, Edge } from 'reactflow';

interface DataFlowValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

interface NodeDataSchema {
  inputs: { [key: string]: any };
  outputs: { [key: string]: any };
  config: { [key: string]: any };
}

interface DataFlowConnection {
  sourceNode: string;
  sourceOutput: string;
  targetNode: string;
  targetInput: string;
  dataType: string;
  isValid: boolean;
  error?: string;
}

interface WorkflowDataFlowManagerProps {
  nodes: Node[];
  edges: Edge[];
  onDataFlowUpdate?: (validation: DataFlowValidation) => void;
  onConnectionFix?: (connection: DataFlowConnection) => void;
}

const WorkflowDataFlowManager: React.FC<WorkflowDataFlowManagerProps> = ({
  nodes,
  edges,
  onDataFlowUpdate,
  onConnectionFix
}) => {
  const [validation, setValidation] = useState<DataFlowValidation>({
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: []
  });
  
  const [connections, setConnections] = useState<DataFlowConnection[]>([]);
  const [nodeSchemas, setNodeSchemas] = useState<{ [key: string]: NodeDataSchema }>({});
  const [selectedConnection, setSelectedConnection] = useState<DataFlowConnection | null>(null);
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false);

  // 节点类型的默认数据模式
  const getDefaultNodeSchema = useCallback((nodeType: string): NodeDataSchema => {
    const schemas: { [key: string]: NodeDataSchema } = {
      llm: {
        inputs: {
          prompt: { type: 'string', required: true, description: '输入提示' },
          system_prompt: { type: 'string', required: false, description: '系统提示' },
          temperature: { type: 'number', required: false, default: 0.7 },
          max_tokens: { type: 'number', required: false, default: 1000 }
        },
        outputs: {
          content: { type: 'string', description: '生成的内容' },
          metadata: { type: 'object', description: '元数据信息' }
        },
        config: {}
      },
      rag_retriever: {
        inputs: {
          query: { type: 'string', required: true, description: '检索查询' },
          knowledge_base: { type: 'string', required: false, description: '知识库名称' }
        },
        outputs: {
          documents: { type: 'array', description: '检索到的文档' },
          scores: { type: 'array', description: '相似度分数' }
        },
        config: {
          top_k: { type: 'number', default: 5 },
          score_threshold: { type: 'number', default: 0.7 }
        }
      },
      classifier: {
        inputs: {
          text: { type: 'string', required: true, description: '待分类文本' }
        },
        outputs: {
          class: { type: 'string', description: '分类结果' },
          confidence: { type: 'number', description: '置信度' },
          all_classes: { type: 'array', description: '所有类别' }
        },
        config: {
          classes: { type: 'array', default: [] }
        }
      },
      condition: {
        inputs: {
          value: { type: 'any', required: true, description: '待判断的值' }
        },
        outputs: {
          condition_result: { type: 'boolean', description: '条件结果' },
          evaluated_value: { type: 'any', description: '评估的值' }
        },
        config: {
          condition_type: { type: 'string', default: 'equals' },
          condition_value: { type: 'string', default: '' }
        }
      },
      input: {
        inputs: {},
        outputs: {
          data: { type: 'object', description: '输入数据' }
        },
        config: {}
      },
      output: {
        inputs: {
          data: { type: 'object', required: true, description: '输出数据' }
        },
        outputs: {
          result: { type: 'object', description: '格式化结果' }
        },
        config: {}
      }
    };

    return schemas[nodeType] || {
      inputs: {},
      outputs: {},
      config: {}
    };
  }, []);

  // 验证数据流
  const validateDataFlow = useCallback(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    const newConnections: DataFlowConnection[] = [];

    // 构建节点映射
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    
    // 初始化节点模式
    const schemas: { [key: string]: NodeDataSchema } = {};
    nodes.forEach(node => {
      schemas[node.id] = getDefaultNodeSchema(node.data.type || node.type);
    });

    // 验证边连接
    edges.forEach(edge => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode || !targetNode) {
        errors.push(`连接 ${edge.id} 的源节点或目标节点不存在`);
        return;
      }

      const sourceSchema = schemas[edge.source];
      const targetSchema = schemas[edge.target];

      // 检查输出是否存在
      const sourceOutput = edge.sourceHandle || 'output';
      const targetInput = edge.targetHandle || 'input';

      let isValid = true;
      let error: string | undefined;

      if (sourceSchema && !sourceSchema.outputs[sourceOutput]) {
        isValid = false;
        error = `源节点 ${sourceNode.data.name} 没有输出 ${sourceOutput}`;
        errors.push(error);
      }

      if (targetSchema && !targetSchema.inputs[targetInput]) {
        isValid = false;
        error = `目标节点 ${targetNode.data.name} 没有输入 ${targetInput}`;
        errors.push(error);
      }

      // 检查数据类型兼容性
      if (isValid && sourceSchema && targetSchema) {
        const sourceOutputType = sourceSchema.outputs[sourceOutput]?.type;
        const targetInputType = targetSchema.inputs[targetInput]?.type;

        if (sourceOutputType && targetInputType && 
            sourceOutputType !== 'any' && targetInputType !== 'any' &&
            sourceOutputType !== targetInputType) {
          warnings.push(
            `数据类型不匹配: ${sourceNode.data.name}.${sourceOutput} (${sourceOutputType}) -> ${targetNode.data.name}.${targetInput} (${targetInputType})`
          );
        }
      }

      const connection: DataFlowConnection = {
        sourceNode: edge.source,
        sourceOutput,
        targetNode: edge.target,
        targetInput,
        dataType: sourceSchema?.outputs[sourceOutput]?.type || 'unknown',
        isValid,
        error
      };

      newConnections.push(connection);
    });

    // 检查必需输入
    nodes.forEach(node => {
      const schema = schemas[node.id];
      if (schema) {
        Object.entries(schema.inputs).forEach(([inputName, inputDef]) => {
          if (inputDef.required) {
            const hasConnection = edges.some(edge => 
              edge.target === node.id && (edge.targetHandle || 'input') === inputName
            );
            
            if (!hasConnection) {
              warnings.push(`节点 ${node.data.name} 的必需输入 ${inputName} 未连接`);
            }
          }
        });
      }
    });

    // 检查孤立节点
    const connectedNodes = new Set([
      ...edges.map(e => e.source),
      ...edges.map(e => e.target)
    ]);
    
    const isolatedNodes = nodes.filter(node => !connectedNodes.has(node.id));
    if (isolatedNodes.length > 0) {
      warnings.push(`发现 ${isolatedNodes.length} 个孤立节点`);
    }

    // 生成建议
    if (errors.length === 0 && warnings.length === 0) {
      suggestions.push('数据流配置正确，可以执行工作流');
    } else if (errors.length === 0) {
      suggestions.push('数据流基本正确，建议查看警告信息并优化');
    } else {
      suggestions.push('请修复数据流错误后再执行工作流');
    }

    const newValidation: DataFlowValidation = {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions
    };

    setValidation(newValidation);
    setConnections(newConnections);
    setNodeSchemas(schemas);
    
    onDataFlowUpdate?.(newValidation);
  }, [nodes, edges, getDefaultNodeSchema, onDataFlowUpdate]);

  // 监听节点和边的变化
  useEffect(() => {
    validateDataFlow();
  }, [validateDataFlow]);

  // 修复连接
  const handleFixConnection = useCallback((connection: DataFlowConnection) => {
    setSelectedConnection(connection);
    onConnectionFix?.(connection);
  }, [onConnectionFix]);

  // 获取状态图标
  const getStatusIcon = (isValid: boolean, hasWarning: boolean) => {
    if (!isValid) {
      return <ErrorIcon sx={{ color: '#f44336' }} />;
    } else if (hasWarning) {
      return <WarningIcon sx={{ color: '#ff9800' }} />;
    } else {
      return <SuccessIcon sx={{ color: '#4caf50' }} />;
    }
  };

  return (
    <Box sx={{ width: '100%' }}>
      {/* 验证状态概览 */}
      <Paper sx={{ p: 2, mb: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <DataIcon sx={{ mr: 1, color: '#00d4ff' }} />
          <Typography variant="h6" sx={{ color: 'white' }}>
            数据流验证
          </Typography>
          <Box sx={{ ml: 'auto' }}>
            {getStatusIcon(validation.isValid, validation.warnings.length > 0)}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            label={`${connections.length} 个连接`}
            size="small"
            sx={{ backgroundColor: 'rgba(0, 212, 255, 0.2)', color: '#00d4ff' }}
          />
          {validation.errors.length > 0 && (
            <Chip
              label={`${validation.errors.length} 个错误`}
              size="small"
              color="error"
            />
          )}
          {validation.warnings.length > 0 && (
            <Chip
              label={`${validation.warnings.length} 个警告`}
              size="small"
              sx={{ backgroundColor: 'rgba(255, 152, 0, 0.2)', color: '#ff9800' }}
            />
          )}
          <Chip
            label={validation.isValid ? '验证通过' : '验证失败'}
            size="small"
            color={validation.isValid ? 'success' : 'error'}
          />
        </Box>
      </Paper>

      {/* 详细信息 */}
      <Accordion defaultExpanded={!validation.isValid}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1" sx={{ color: 'white' }}>
            验证详情
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {validation.errors.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ color: '#f44336', mb: 1 }}>
                错误:
              </Typography>
              <List dense>
                {validation.errors.map((error, index) => (
                  <ListItem key={index}>
                    <ListItemIcon>
                      <ErrorIcon sx={{ color: '#f44336' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={error}
                      sx={{ color: 'white' }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {validation.warnings.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ color: '#ff9800', mb: 1 }}>
                警告:
              </Typography>
              <List dense>
                {validation.warnings.map((warning, index) => (
                  <ListItem key={index}>
                    <ListItemIcon>
                      <WarningIcon sx={{ color: '#ff9800' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={warning}
                      sx={{ color: 'white' }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {validation.suggestions.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ color: '#4caf50', mb: 1 }}>
                建议:
              </Typography>
              <List dense>
                {validation.suggestions.map((suggestion, index) => (
                  <ListItem key={index}>
                    <ListItemIcon>
                      <SuccessIcon sx={{ color: '#4caf50' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={suggestion}
                      sx={{ color: 'white' }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* 连接详情 */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1" sx={{ color: 'white' }}>
            连接详情 ({connections.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <List>
            {connections.map((connection, index) => {
              const sourceNode = nodes.find(n => n.id === connection.sourceNode);
              const targetNode = nodes.find(n => n.id === connection.targetNode);
              
              return (
                <ListItem
                  key={index}
                  sx={{
                    border: `1px solid ${connection.isValid ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)'}`,
                    borderRadius: 1,
                    mb: 1,
                    backgroundColor: connection.isValid ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)'
                  }}
                >
                  <ListItemIcon>
                    {connection.isValid ? 
                      <SuccessIcon sx={{ color: '#4caf50' }} /> : 
                      <ErrorIcon sx={{ color: '#f44336' }} />
                    }
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box>
                        <Typography variant="body2" sx={{ color: 'white' }}>
                          {sourceNode?.data.name || connection.sourceNode}.{connection.sourceOutput}
                          {' → '}
                          {targetNode?.data.name || connection.targetNode}.{connection.targetInput}
                        </Typography>
                        <Chip
                          label={connection.dataType}
                          size="small"
                          sx={{
                            mt: 0.5,
                            backgroundColor: 'rgba(0, 212, 255, 0.2)',
                            color: '#00d4ff'
                          }}
                        />
                      </Box>
                    }
                    secondary={connection.error}
                    sx={{
                      '& .MuiListItemText-secondary': {
                        color: '#f44336'
                      }
                    }}
                  />
                  <Box>
                    <Tooltip title="查看详情">
                      <IconButton
                        size="small"
                        onClick={() => setSelectedConnection(connection)}
                        sx={{ color: '#00d4ff' }}
                      >
                        <ViewIcon />
                      </IconButton>
                    </Tooltip>
                    {!connection.isValid && (
                      <Tooltip title="修复连接">
                        <IconButton
                          size="small"
                          onClick={() => handleFixConnection(connection)}
                          sx={{ color: '#ff9800' }}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </ListItem>
              );
            })}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* 节点模式对话框 */}
      <Dialog
        open={schemaDialogOpen}
        onClose={() => setSchemaDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>节点数据模式</DialogTitle>
        <DialogContent>
          <Grid container spacing={2}>
            {nodes.map(node => {
              const schema = nodeSchemas[node.id];
              if (!schema) return null;

              return (
                <Grid item xs={12} md={6} key={node.id}>
                  <Paper sx={{ p: 2, backgroundColor: 'rgba(26, 31, 46, 0.8)' }}>
                    <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
                      {node.data.name}
                    </Typography>
                    
                    <Typography variant="subtitle2" sx={{ color: '#4caf50', mb: 1 }}>
                      输入:
                    </Typography>
                    {Object.entries(schema.inputs).map(([key, value]) => (
                      <Typography key={key} variant="body2" sx={{ color: 'white', ml: 1 }}>
                        • {key}: {value.type} {value.required && '(必需)'}
                      </Typography>
                    ))}

                    <Typography variant="subtitle2" sx={{ color: '#ff9800', mb: 1, mt: 2 }}>
                      输出:
                    </Typography>
                    {Object.entries(schema.outputs).map(([key, value]) => (
                      <Typography key={key} variant="body2" sx={{ color: 'white', ml: 1 }}>
                        • {key}: {value.type}
                      </Typography>
                    ))}
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default WorkflowDataFlowManager;