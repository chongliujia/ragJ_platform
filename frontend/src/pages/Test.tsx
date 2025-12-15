import React, { useState } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  Alert,
  TextField,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  HealthAndSafety as HealthIcon,
  Storage as KnowledgeIcon,
  Chat as ChatIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import { systemApi, knowledgeBaseApi, chatApi } from '../services/api';

const Test: React.FC = () => {
  const [results, setResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [testKbName, setTestKbName] = useState('test_kb_' + Date.now());

  const setResult = (key: string, result: any) => {
    setResults(prev => ({ ...prev, [key]: result }));
  };

  const updateLoading = (key: string, isLoading: boolean) => {
    setLoading(prev => ({ ...prev, [key]: isLoading }));
  };

  // 测试后端健康状态
  const testHealthCheck = async () => {
    updateLoading('health', true);
    try {
      const response = await systemApi.healthCheck();
      setResult('health', { status: 'success', data: response.data });
    } catch (error: any) {
      setResult('health', { 
        status: 'error', 
        error: error.response?.data || error.message 
      });
    }
    updateLoading('health', false);
  };

  // 测试系统信息
  const testSystemInfo = async () => {
    updateLoading('info', true);
    try {
      const response = await systemApi.getInfo();
      setResult('info', { status: 'success', data: response.data });
    } catch (error: any) {
      setResult('info', { 
        status: 'error', 
        error: error.response?.data || error.message 
      });
    }
    updateLoading('info', false);
  };

  // 测试知识库列表
  const testKnowledgeBases = async () => {
    updateLoading('kbs', true);
    try {
      const response = await knowledgeBaseApi.getList();
      setResult('kbs', { status: 'success', data: response.data });
    } catch (error: any) {
      setResult('kbs', { 
        status: 'error', 
        error: error.response?.data || error.message 
      });
    }
    updateLoading('kbs', false);
  };

  // 测试创建知识库
  const testCreateKnowledgeBase = async () => {
    updateLoading('createKb', true);
    try {
      const response = await knowledgeBaseApi.create({
        name: testKbName,
        description: '测试知识库 - 可以删除'
      });
      setResult('createKb', { status: 'success', data: response.data });
      // 自动刷新知识库列表
      testKnowledgeBases();
    } catch (error: any) {
      setResult('createKb', { 
        status: 'error', 
        error: error.response?.data || error.message 
      });
    }
    updateLoading('createKb', false);
  };

  // 测试聊天接口（需要先有知识库）
  const testChat = async () => {
    updateLoading('chat', true);
    
    try {
      // 先刷新知识库列表
      const kbResponse = await knowledgeBaseApi.getList();
      const kbList = kbResponse.data;
      
      if (!kbList || kbList.length === 0) {
        setResult('chat', { 
          status: 'error', 
          error: '没有可用的知识库。请先创建一个知识库再测试聊天功能。' 
        });
        return;
      }

      const firstKb = kbList[0];
      const response = await chatApi.sendMessage({
        message: '你好，这是一个测试消息',
        knowledge_base_id: firstKb.name || firstKb.id
      });
      setResult('chat', { status: 'success', data: response.data });
    } catch (error: any) {
      setResult('chat', { 
        status: 'error', 
        error: error.response?.data || error.message 
      });
    } finally {
      updateLoading('chat', false);
    }
  };

  // 运行所有测试
  const runAllTests = async () => {
    await testHealthCheck();
    await testSystemInfo();
    await testKnowledgeBases();
  };

  const renderResult = (key: string, title: string) => {
    const result = results[key];
    const isLoading = loading[key];

    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {title}
        </Typography>
        {isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">测试中...</Typography>
          </Box>
        ) : result ? (
          <Alert 
            severity={result.status === 'success' ? 'success' : 'error'}
            sx={{ wordBreak: 'break-all' }}
          >
            {result.status === 'success' ? (
              <Typography component="div" variant="body2">
                <strong>成功:</strong><br />
                <pre style={{ margin: 0, fontSize: '12px' }}>
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </Typography>
            ) : (
              <Typography component="div" variant="body2">
                <strong>错误:</strong><br />
                <pre style={{ margin: 0, fontSize: '12px' }}>
                  {JSON.stringify(result.error, null, 2)}
                </pre>
              </Typography>
            )}
          </Alert>
        ) : (
          <Typography variant="body2" color="text.secondary">
            未测试
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 3 }}>
        前后端连接测试
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            快速测试
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<HealthIcon />}
              onClick={testHealthCheck}
              disabled={loading.health}
            >
              健康检查
            </Button>
            <Button
              variant="contained"
              startIcon={<HealthIcon />}
              onClick={testSystemInfo}
              disabled={loading.info}
            >
              系统信息
            </Button>
            <Button
              variant="contained"
              startIcon={<KnowledgeIcon />}
              onClick={testKnowledgeBases}
              disabled={loading.kbs}
            >
              知识库列表
            </Button>
            <Button
              variant="outlined"
              onClick={runAllTests}
              disabled={Object.values(loading).some(Boolean)}
            >
              运行所有基础测试
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="h6" sx={{ mb: 2 }}>
            创建测试
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
            <TextField
              label="测试知识库名称"
              value={testKbName}
              onChange={(e) => setTestKbName(e.target.value)}
              size="small"
              helperText="只能包含字母、数字和下划线"
              error={Boolean(testKbName) && !/^[a-zA-Z0-9_]+$/.test(testKbName)}
            />
            <Button
              variant="contained"
              startIcon={<UploadIcon />}
              onClick={testCreateKnowledgeBase}
              disabled={loading.createKb || !testKbName.trim() || !/^[a-zA-Z0-9_]+$/.test(testKbName)}
            >
              创建测试知识库
            </Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<ChatIcon />}
              onClick={testChat}
              disabled={loading.chat}
            >
              测试聊天
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            测试结果
          </Typography>
          
          {renderResult('health', '健康检查')}
          {renderResult('info', '系统信息')}
          {renderResult('kbs', '知识库列表')}
          {renderResult('createKb', '创建知识库')}
          {renderResult('chat', '聊天测试')}
        </CardContent>
      </Card>
    </Box>
  );
};

export default Test;
