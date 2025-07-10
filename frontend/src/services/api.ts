import axios from 'axios';

// 配置 axios 默认设置
const API_BASE_URL = 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // 增加到60秒，适应RAG处理的复杂性
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
  // 发送消息 - 使用更长的超时时间以适应RAG处理
  sendMessage: (data: { message: string; knowledge_base_id?: string; model?: string }) =>
    api.post('/api/v1/chat', data, { timeout: 90000 }), // 90秒超时
  
  // 流式聊天
  streamMessage: async (
    data: { message: string; knowledge_base_id?: string; model?: string },
    onChunk: (chunk: any) => void,
    onError: (error: any) => void,
    onComplete: () => void
  ) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No reader available');
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                onComplete();
                return;
              }
              
              try {
                const parsed = JSON.parse(data);
                onChunk(parsed);
              } catch (e) {
                console.warn('Failed to parse SSE data:', data);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('Stream error:', error);
      onError(error);
    }
  },
  
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