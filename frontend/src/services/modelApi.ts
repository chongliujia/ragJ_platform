import api from './api';
import type { ModelsConfig, ModelProvider } from '../types/models';

// 模型配置相关 API
export const modelConfigApi = {
  // 获取当前模型配置
  getConfig: () => api.get<ModelsConfig>('/api/models/config'),
  
  // 更新模型配置
  updateConfig: (config: ModelsConfig) => 
    api.put('/api/models/config', config),
  
  // 测试模型连接
  testConnection: (provider: ModelProvider, apiKey: string, baseUrl?: string) =>
    api.post('/api/models/test', { provider, apiKey, baseUrl }),
  
  // 获取可用模型列表
  getAvailableModels: (provider: ModelProvider, apiKey: string) =>
    api.get(`/api/models/available/${provider}`, {
      headers: { 'X-API-Key': apiKey }
    }),
};

// 模型测试相关 API
export const modelTestApi = {
  // 测试聊天模型
  testChat: (message: string, config: any) =>
    api.post('/api/models/test/chat', { message, config }),
  
  // 测试嵌入模型
  testEmbedding: (text: string, config: any) =>
    api.post('/api/models/test/embedding', { text, config }),
  
  // 测试重排模型
  testRerank: (query: string, documents: string[], config: any) =>
    api.post('/api/models/test/rerank', { query, documents, config }),
};

export default modelConfigApi; 