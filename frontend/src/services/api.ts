import axios from 'axios';

// 配置 axios 默认设置
// 使用环境变量以便在不同环境（本地、Docker、生产）下正确指向后端
// 在开发环境（vite dev）下一律走 Vite 代理：baseURL 置空，所有请求使用相对路径 `/api/...`
// 在生产环境（build 后部署）才读取 VITE_BACKEND_URL
const isViteDev = !!(import.meta as any).hot || (import.meta as any).env?.DEV;
const isLocalDevHost = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
const isDev = isViteDev || isLocalDevHost;
const API_BASE_URL = isDev ? '' : ((import.meta as any).env?.VITE_BACKEND_URL || '');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // 增加到60秒，适应RAG处理的复杂性
  headers: {
    'Content-Type': 'application/json',
  },
});

// 保险：在本地开发时强制使用相对路径，确保走 Vite 代理
if (isDev) {
  api.defaults.baseURL = '';
}

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 开发模式强制相对路径，避免任何遗留 baseURL 导致 backend:8000 直连
    if (isDev) {
      config.baseURL = '';
    }
    // 可以在这里添加认证 token 等（已由 AuthManager 统一设置）
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
  // 获取知识库列表（带结尾斜杠，避免 307 重定向导致浏览器跳到不可解析的主机名）
  getList: () => api.get('/api/v1/knowledge-bases/'),
  
  // 创建知识库
  create: (data: { name: string; description?: string }) => 
    api.post('/api/v1/knowledge-bases/', data),
  
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
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const response = await fetch(`${API_BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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
  
  // 上传文档（使用嵌套路由，避免额外参数解析不一致）
  upload: (knowledgeBaseId: string, formData: FormData) => 
    api.post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
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

// 团队管理相关 API
export const teamApi = {
  // 获取当前用户所属的团队
  getCurrentTeam: () => api.get('/api/v1/teams/current'),
  
  // 创建团队
  createTeam: (data: {
    name: string;
    description?: string;
    team_type?: string;
    max_members?: number;
    is_private?: boolean;
  }) => api.post('/api/v1/teams', data),
  
  // 获取团队详情
  getTeam: (teamId: number) => api.get(`/api/v1/teams/${teamId}`),
  
  // 更新团队信息
  updateTeam: (teamId: number, data: {
    name?: string;
    description?: string;
    team_type?: string;
    max_members?: number;
    is_private?: boolean;
  }) => api.put(`/api/v1/teams/${teamId}`, data),
  
  // 删除团队
  deleteTeam: (teamId: number) => api.delete(`/api/v1/teams/${teamId}`),
  
  // 获取团队成员列表
  getTeamMembers: (teamId: number) => api.get(`/api/v1/teams/${teamId}/members`),
  
  // 邀请用户加入团队
  inviteUser: (teamId: number, data: {
    email: string;
    target_role?: string;
    target_member_type?: string;
    message?: string;
  }) => api.post(`/api/v1/teams/${teamId}/invite`, data),
  
  // 通过邀请码加入团队
  joinTeam: (inviteCode: string) => api.post('/api/v1/teams/join', { invite_code: inviteCode }),
  
  // 移除团队成员
  removeMember: (teamId: number, userId: number) => 
    api.delete(`/api/v1/teams/${teamId}/members/${userId}`),
  
  // 离开团队
  leaveTeam: (teamId: number) => api.post(`/api/v1/teams/${teamId}/leave`),
};

// 工作流相关 API
export const workflowApi = {
  // 创建工作流
  create: (data: { 
    name: string; 
    description?: string; 
    nodes: any[]; 
    edges: any[]; 
    config?: any; 
  }) => api.post('/api/v1/workflows/', data),
  
  // 获取工作流列表
  getList: () => api.get('/api/v1/workflows/'),
  
  // 获取工作流详情
  getDetail: (id: string) => api.get(`/api/v1/workflows/${id}`),
  
  // 更新工作流
  update: (id: string, data: {
    name?: string;
    description?: string;
    nodes?: any[];
    edges?: any[];
    config?: any;
  }) => api.put(`/api/v1/workflows/${id}`, data),
  
  // 删除工作流
  delete: (id: string) => api.delete(`/api/v1/workflows/${id}`),
  
  // 执行工作流
  execute: (id: string, data: {
    input_data: any;
    config?: any;
    debug?: boolean;
  }) => api.post(`/api/v1/workflows/${id}/execute`, data, { timeout: 300000 }), // 5分钟超时
  
  // 流式执行工作流
  executeStream: async (
    id: string,
    data: { input_data: any; config?: any; debug?: boolean },
    onProgress: (progress: any) => void,
    onError: (error: any) => void,
    onComplete: (result: any) => void
  ) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const response = await fetch(`${API_BASE_URL}/api/v1/workflows/${id}/execute/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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
                return;
              }
              
              try {
                const parsed = JSON.parse(data);
                
                if (parsed.type === 'progress') {
                  onProgress(parsed);
                } else if (parsed.type === 'complete') {
                  onComplete(parsed);
                } else if (parsed.type === 'error') {
                  onError(parsed);
                }
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
      console.error('Workflow execution stream error:', error);
      onError(error);
    }
  },
  
  // 获取执行历史
  getExecutionHistory: (id: string) => api.get(`/api/v1/workflows/${id}/executions`),
  
  // 停止工作流执行
  stopExecution: (id: string, executionId: string) => 
    api.post(`/api/v1/workflows/${id}/executions/${executionId}/stop`),
  
  // 验证工作流配置
  validate: (data: { nodes: any[]; edges: any[] }) => 
    api.post('/api/v1/workflows/validate', data),
  
  // 生成LangGraph代码
  generateCode: (data: { nodes: any[]; edges: any[] }) => 
    api.post('/api/v1/workflows/generate-code', data),

  // 获取工作流模板列表
  getTemplates: () => api.get('/api/v1/workflows/templates'),

  // 使用模板创建工作流
  useTemplate: (templateId: string, workflowName?: string) =>
    api.post(`/api/v1/workflows/templates/${templateId}/use`, null, {
      params: workflowName ? { workflow_name: workflowName } : undefined,
    }),
  
  // 保存代码
  saveCode: (id: string, data: { code: string; language: string }) =>
    api.post(`/api/v1/workflows/${id}/code`, data),
  
  // 获取代码
  getCode: (id: string) => api.get(`/api/v1/workflows/${id}/code`),
};

// 智能体相关 API
export const agentApi = {
  // 获取智能体列表
  getList: () => api.get('/api/v1/agents'),
  
  // 创建智能体
  create: (data: {
    name: string;
    description?: string;
    workflow_id?: string;
    config?: any;
  }) => api.post('/api/v1/agents', data),
  
  // 获取智能体详情
  getDetail: (id: string) => api.get(`/api/v1/agents/${id}`),
  
  // 更新智能体
  update: (id: string, data: {
    name?: string;
    description?: string;
    workflow_id?: string;
    config?: any;
  }) => api.put(`/api/v1/agents/${id}`, data),
  
  // 删除智能体
  delete: (id: string) => api.delete(`/api/v1/agents/${id}`),
  
  // 与智能体对话
  chat: (id: string, data: {
    message: string;
    context?: any;
  }) => api.post(`/api/v1/agents/${id}/chat`, data, { timeout: 90000 }),
  
  // 流式对话
  chatStream: async (
    id: string,
    data: { message: string; context?: any },
    onChunk: (chunk: any) => void,
    onError: (error: any) => void,
    onComplete: () => void
  ) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const response = await fetch(`${API_BASE_URL}/api/v1/agents/${id}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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
      console.error('Agent chat stream error:', error);
      onError(error);
    }
  },
};

// 导出 api 实例
export { api };
export default api; 
