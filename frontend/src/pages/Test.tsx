import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        description: t('testPage.sampleKnowledgeBaseDescription')
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
          error: t('testPage.errors.noKnowledgeBases') 
        });
        return;
      }

      const firstKb = kbList[0];
      const response = await chatApi.sendMessage({
        message: t('testPage.sampleMessage'),
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
            <Typography variant="body2">{t('testPage.status.testing')}</Typography>
          </Box>
        ) : result ? (
          <Alert 
            severity={result.status === 'success' ? 'success' : 'error'}
            sx={{ wordBreak: 'break-all' }}
          >
            {result.status === 'success' ? (
              <Typography component="div" variant="body2">
                <strong>{t('testPage.status.success')}:</strong><br />
                <pre style={{ margin: 0, fontSize: '12px' }}>
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </Typography>
            ) : (
              <Typography component="div" variant="body2">
                <strong>{t('testPage.status.error')}:</strong><br />
                <pre style={{ margin: 0, fontSize: '12px' }}>
                  {JSON.stringify(result.error, null, 2)}
                </pre>
              </Typography>
            )}
          </Alert>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('testPage.status.notRun')}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 3 }}>
        {t('testPage.title')}
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('testPage.sections.quick')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<HealthIcon />}
              onClick={testHealthCheck}
              disabled={loading.health}
            >
              {t('testPage.tests.health')}
            </Button>
            <Button
              variant="contained"
              startIcon={<HealthIcon />}
              onClick={testSystemInfo}
              disabled={loading.info}
            >
              {t('testPage.tests.info')}
            </Button>
            <Button
              variant="contained"
              startIcon={<KnowledgeIcon />}
              onClick={testKnowledgeBases}
              disabled={loading.kbs}
            >
              {t('testPage.tests.knowledgeBases')}
            </Button>
            <Button
              variant="outlined"
              onClick={runAllTests}
              disabled={Object.values(loading).some(Boolean)}
            >
              {t('testPage.actions.runAll')}
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('testPage.sections.create')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
            <TextField
              label={t('testPage.fields.testKnowledgeBaseName')}
              value={testKbName}
              onChange={(e) => setTestKbName(e.target.value)}
              size="small"
              helperText={t('testPage.fields.testKnowledgeBaseNameHint')}
              error={Boolean(testKbName) && !/^[a-zA-Z0-9_]+$/.test(testKbName)}
            />
            <Button
              variant="contained"
              startIcon={<UploadIcon />}
              onClick={testCreateKnowledgeBase}
              disabled={loading.createKb || !testKbName.trim() || !/^[a-zA-Z0-9_]+$/.test(testKbName)}
            >
              {t('testPage.actions.createTestKnowledgeBase')}
            </Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<ChatIcon />}
              onClick={testChat}
              disabled={loading.chat}
            >
              {t('testPage.actions.testChat')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('testPage.sections.results')}
          </Typography>
          
          {renderResult('health', t('testPage.tests.health'))}
          {renderResult('info', t('testPage.tests.info'))}
          {renderResult('kbs', t('testPage.tests.knowledgeBases'))}
          {renderResult('createKb', t('testPage.tests.createKnowledgeBase'))}
          {renderResult('chat', t('testPage.tests.chat'))}
        </CardContent>
      </Card>
    </Box>
  );
};

export default Test;
