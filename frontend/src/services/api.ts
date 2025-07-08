import axios from 'axios';

// 配置 axios 默认设置
const API_BASE_URL = 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证 token 等
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // 统一错误处理
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// 知识库相关 API
export const knowledgeBaseApi = {
  // 获取知识库列表
  getList: () => api.get('/api/v1/knowledge-bases'),
  
  // 创建知识库
  create: (data: { name: string; description?: string }) => 
    api.post('/api/v1/knowledge-bases', data),
  
  // 删除知识库
  delete: (id: string) => api.delete(`/api/v1/knowledge-bases/${id}`),
  
  // 获取知识库详情
  getDetail: (id: string) => api.get(`/api/v1/knowledge-bases/${id}`),
};

// 聊天相关 API
export const chatApi = {
  // 发送消息
  sendMessage: (data: { message: string; knowledge_base_id?: string; model?: string }) =>
    api.post('/api/v1/chat', data),
  
  // 获取重排提供商
  getRerankingProviders: () => 
    api.get('/api/v1/chat/reranking-providers'),
};

// 文档相关 API
export const documentApi = {
  // 获取文档列表
  getList: (knowledgeBaseId: string) => 
    api.get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`),
  
  // 上传文档
  upload: (knowledgeBaseId: string, formData: FormData) => 
    api.post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),
  
  // 删除文档
  delete: (knowledgeBaseId: string, documentId: string) => 
    api.delete(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`),
  
  // 获取分片策略
  getChunkingStrategies: () => 
    api.get('/api/v1/documents/chunking-strategies'),
};

// 系统状态相关 API
export const systemApi = {
  // 健康检查
  healthCheck: () => api.get('/health'),
  
  // 系统信息
  getInfo: () => api.get('/'),
};

// 导出 api 实例
export { api };
export default api; 