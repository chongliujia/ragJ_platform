/**
 * 数据节点组件 - 数据处理和检索节点
 */

import React, { memo, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
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
  Chip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Storage as DataIcon,
  Settings as SettingsIcon,
  Search as SearchIcon,
  Description as DocIcon,
} from '@mui/icons-material';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

interface DataNodeData {
  name: string;
  type: 'rag_retriever' | 'parser' | 'database' | 'embeddings' | 'reranker' | 'data_transformer';
  config: {
    knowledge_base?: string;
    top_k?: number;
    score_threshold?: number;
    file_types?: string[];
    extract_images?: boolean;
    connection?: string;
    query_type?: string;
    model?: string;
    dimensions?: number;
    // reranker
    rerank_top_k?: number;
    // data_transformer
    transform_type?: 'json' | 'extract' | 'custom';
    fields?: string[];
    transform_code?: string;
  };
}

const DataNode: React.FC<NodeProps<DataNodeData>> = ({ data, selected }) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState(data.config || {});
  const status = (data as any).status as 'idle' | 'running' | 'success' | 'error' | undefined;

  const getNodeIcon = () => {
    switch (data.type) {
      case 'rag_retriever':
        return <SearchIcon sx={{ color: '#fff' }} />;
      case 'parser':
        return <DocIcon sx={{ color: '#fff' }} />;
      case 'database':
        return <DataIcon sx={{ color: '#fff' }} />;
      case 'embeddings':
        return <DataIcon sx={{ color: '#fff' }} />;
      default:
        return <DataIcon sx={{ color: '#fff' }} />;
    }
  };

  const getNodeColor = () => {
    switch (data.type) {
      case 'rag_retriever':
        return 'linear-gradient(45deg, #4facfe 0%, #00f2fe 100%)';
      case 'parser':
        return 'linear-gradient(45deg, #43e97b 0%, #38f9d7 100%)';
      case 'database':
        return 'linear-gradient(45deg, #fa709a 0%, #fee140 100%)';
      case 'embeddings':
        return 'linear-gradient(45deg, #a8edea 0%, #fed6e3 100%)';
      case 'reranker':
        return 'linear-gradient(45deg, #f6d365 0%, #fda085 100%)';
      case 'data_transformer':
        return 'linear-gradient(45deg, #90f7ec 0%, #32ccbc 100%)';
      default:
        return 'linear-gradient(45deg, #667eea 0%, #764ba2 100%)';
    }
  };

  const handleConfigSave = () => {
    data.config = config;
    setConfigOpen(false);
  };

  const renderConfigFields = () => {
    switch (data.type) {
      case 'rag_retriever':
        return (
          <>
            <TextField
              fullWidth
              label="知识库"
              value={config.knowledge_base || ''}
              onChange={(e) =>
                setConfig({ ...config, knowledge_base: e.target.value })
              }
              sx={{ mb: 2, mt: 1 }}
            />
            <TextField
              fullWidth
              type="number"
              label="检索数量 (top_k)"
              value={config.top_k || 5}
              onChange={(e) =>
                setConfig({ ...config, top_k: parseInt(e.target.value) })
              }
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="number"
              label="相似度阈值"
              value={config.score_threshold || 0.7}
              onChange={(e) =>
                setConfig({
                  ...config,
                  score_threshold: parseFloat(e.target.value),
                })
              }
              inputProps={{ step: 0.1, min: 0, max: 1 }}
            />
          </>
        );
      case 'parser':
        return (
          <>
            <TextField
              fullWidth
              label="支持的文件类型"
              value={(config.file_types || []).join(', ')}
              onChange={(e) =>
                setConfig({
                  ...config,
                  file_types: e.target.value.split(', '),
                })
              }
              placeholder="pdf, docx, txt"
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={config.extract_images || false}
                  onChange={(e) =>
                    setConfig({ ...config, extract_images: e.target.checked })
                  }
                />
              }
              label="提取图片"
            />
          </>
        );
      case 'database':
        return (
          <>
            <TextField
              fullWidth
              label="数据库连接"
              value={config.connection || ''}
              onChange={(e) =>
                setConfig({ ...config, connection: e.target.value })
              }
              sx={{ mb: 2, mt: 1 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>查询类型</InputLabel>
              <Select
                value={config.query_type || 'SELECT'}
                onChange={(e) =>
                  setConfig({ ...config, query_type: e.target.value })
                }
                label="查询类型"
              >
                <MenuItem value="SELECT">SELECT</MenuItem>
                <MenuItem value="INSERT">INSERT</MenuItem>
                <MenuItem value="UPDATE">UPDATE</MenuItem>
                <MenuItem value="DELETE">DELETE</MenuItem>
              </Select>
            </FormControl>
          </>
        );
      case 'embeddings':
        return (
          <>
            <TextField
              fullWidth
              label="嵌入模型"
              value={config.model || 'text-embedding-ada-002'}
              onChange={(e) =>
                setConfig({ ...config, model: e.target.value })
              }
              sx={{ mb: 2, mt: 1 }}
            />
            <TextField
              fullWidth
              type="number"
              label="向量维度"
              value={config.dimensions || 1536}
              onChange={(e) =>
                setConfig({ ...config, dimensions: parseInt(e.target.value) })
              }
            />
          </>
        );
      case 'reranker':
        return (
          <>
            <TextField
              fullWidth
              type="number"
              label="重排Top K"
              value={config.rerank_top_k || 5}
              onChange={(e) => setConfig({ ...config, rerank_top_k: parseInt(e.target.value) })}
              sx={{ mb: 2, mt: 1 }}
            />
            <Alert severity="info">输入：query + documents，输出：reranked_documents</Alert>
          </>
        );
      case 'data_transformer':
        return (
          <>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>变换类型</InputLabel>
              <Select
                value={config.transform_type || 'json'}
                onChange={(e) => setConfig({ ...config, transform_type: e.target.value })}
                label="变换类型"
              >
                <MenuItem value="json">JSON</MenuItem>
                <MenuItem value="extract">字段提取</MenuItem>
                <MenuItem value="custom">自定义代码</MenuItem>
              </Select>
            </FormControl>
            {config.transform_type === 'extract' && (
              <TextField
                fullWidth
                label="字段列表（逗号分隔）"
                value={(config.fields || []).join(', ')}
                onChange={(e) => setConfig({ ...config, fields: e.target.value.split(',').map((s: string) => s.trim()) })}
              />
            )}
            {config.transform_type === 'custom' && (
              <TextField
                fullWidth
                label="JS表达式（value 为输入值）"
                multiline
                rows={3}
                value={config.transform_code || ''}
                onChange={(e) => setConfig({ ...config, transform_code: e.target.value })}
                placeholder="例如：({foo: value?.bar})"
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Box
        sx={{
          background: getNodeColor(),
          border: selected
            ? '2px solid #00d4ff'
            : status === 'running'
              ? '2px solid #00d4ff'
              : status === 'success'
                ? '2px solid #4caf50'
                : status === 'error'
                  ? '2px solid #f44336'
                  : '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 3,
          padding: 0.5,
          minWidth: 100,
          color: 'white',
          position: 'relative',
          boxShadow: selected
            ? '0 8px 32px rgba(0, 212, 255, 0.3)'
            : status === 'running'
              ? '0 8px 28px rgba(0, 212, 255, 0.35)'
              : status === 'success'
                ? '0 8px 28px rgba(76, 175, 80, 0.35)'
                : status === 'error'
                  ? '0 8px 28px rgba(244, 67, 54, 0.35)'
                  : '0 4px 20px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.3s ease',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 25px rgba(79, 172, 254, 0.4)',
            borderColor: 'rgba(0, 212, 255, 0.5)',
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 50%)',
            borderRadius: 3,
            pointerEvents: 'none',
          },
        }}
      >
        {/* 输入连接点（语义句柄）*/}
        <Handle
          type="target"
          position={Position.Left}
          id={
            data.type === 'rag_retriever' ? 'query' :
            data.type === 'parser' ? 'text' :
            data.type === 'embeddings' ? 'text' :
            data.type === 'reranker' ? 'query' :
            data.type === 'data_transformer' ? 'data' : 'input'
          }
          style={{
            background: 'linear-gradient(45deg, #ffffff 0%, #00d4ff 100%)',
            border: '2px solid #4facfe',
            width: 14,
            height: 14,
            boxShadow: '0 2px 8px rgba(0, 212, 255, 0.3)',
          }}
        />

        {/* 节点头部 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          {getNodeIcon()}
          <Typography variant="h6" sx={{ flexGrow: 1, fontSize: '0.8rem', ml: 1 }}>
            {data.name || '数据节点'}
          </Typography>
          <IconButton
            size="small"
            onClick={() => setConfigOpen(true)}
            sx={{ color: '#fff' }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* 节点内容 */}
        <Box>
          <Chip
            label={data.type}
            size="small"
            sx={{
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              mb: 0.5,
            }}
          />
          {data.type === 'rag_retriever' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              检索: {config.top_k || 5} 条
            </Typography>
          )}
          {data.type === 'parser' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              文件: {(config.file_types || []).join(', ') || 'pdf, docx'}
            </Typography>
          )}
          {data.type === 'database' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              操作: {config.query_type || 'SELECT'}
            </Typography>
          )}
          {data.type === 'embeddings' && (
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.7rem' }}>
              维度: {config.dimensions || 1536}
            </Typography>
          )}
        </Box>

        {/* 输出连接点（语义句柄）*/}
        <Handle
          type="source"
          position={Position.Right}
          id={
            data.type === 'rag_retriever' ? 'documents' :
            data.type === 'parser' ? 'parsed_data' :
            data.type === 'embeddings' ? 'embedding' :
            data.type === 'reranker' ? 'reranked_documents' :
            data.type === 'data_transformer' ? 'json_output' : 'result'
          }
          style={{
            background: 'linear-gradient(45deg, #ffffff 0%, #00d4ff 100%)',
            border: '2px solid #4facfe',
            width: 14,
            height: 14,
            boxShadow: '0 2px 8px rgba(0, 212, 255, 0.3)',
          }}
        />
      </Box>

      {/* 配置对话框 */}
      <Dialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{data.name} 配置</DialogTitle>
        <DialogContent>{renderConfigFields()}</DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigOpen(false)}>取消</Button>
          <Button onClick={handleConfigSave} variant="contained">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default memo(DataNode);
