import axios from 'axios';
import { streamSSE, streamSSECancelable } from './sse';

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
    // 附加认证令牌：优先使用已设置的 header，否则从 localStorage 读取
    const token = (config.headers as any)?.Authorization || (typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null);
    if (token && !(config.headers as any)?.Authorization) {
      (config.headers as any) = (config.headers as any) || {};
      (config.headers as any).Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      // 401 表示未认证/令牌无效：清除 token 并引导登录
      try { localStorage.removeItem('auth_token'); } catch {}
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    // 403 表示已认证但权限不足，不应清除 token；由页面侧自行提示/处理
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

  // 获取知识库设置
  getSettings: (id: string) => api.get(`/api/v1/knowledge-bases/${id}/settings`),

  // 更新知识库设置
  updateSettings: (
    id: string,
    data: {
      retrieval_top_k?: number;
      rerank_enabled?: boolean;
      rerank_top_k?: number;
    }
  ) => api.patch(`/api/v1/knowledge-bases/${id}/settings`, data),

  // 清空向量（可选清理ES）
  clearVectors: (
    kbName: string,
    data?: { include_es?: boolean }
  ) => api.post(`/api/v1/knowledge-bases/${kbName}/maintenance/clear-vectors`, data || {}),

  // 一致性校验与计数修复（可选删除缺失源文件的文档）
  reconcile: (
    kbName: string,
    data?: { delete_missing?: boolean }
  ) => api.post(`/api/v1/knowledge-bases/${kbName}/maintenance/consistency`, data || {}),
};

// 聊天相关 API
export const chatApi = {
  // 发送消息 - 使用更长的超时时间以适应RAG处理
  sendMessage: (data: { message: string; knowledge_base_id?: string; model?: string; system_prompt?: string }) =>
    // 带结尾斜杠，避免在 Docker/Vite 代理场景触发 307 -> Location: http://backend:8000/... 导致浏览器 Network Error
    api.post('/api/v1/chat/', data, { timeout: 90000 }), // 90秒超时
  
  // 流式聊天
  streamMessage: async (
    data: { message: string; knowledge_base_id?: string; model?: string; system_prompt?: string },
    onChunk: (chunk: any) => void,
    onError: (error: any) => void,
    onComplete: () => void
  ) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      await streamSSE(
        `${API_BASE_URL}/api/v1/chat/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(data),
        },
        { onEvent: onChunk, onError, onComplete },
        { retries: 1, retryDelayBaseMs: 800 }
      );
    } catch (error) {
      console.error('Stream error:', error);
      onError(error);
    }
  },
  
  // 流式聊天（可取消）
  streamMessageCancelable: (
    data: { message: string; knowledge_base_id?: string; model?: string; system_prompt?: string },
    onChunk: (chunk: any) => void,
    onError: (error: any) => void,
    onComplete: () => void
  ) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    return streamSSECancelable(
      `${API_BASE_URL}/api/v1/chat/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      },
      { onEvent: onChunk, onError, onComplete },
      { retries: 1, retryDelayBaseMs: 800 }
    );
  },
  
  // 获取重排提供商
  getRerankingProviders: () => 
    api.get('/api/v1/chat/reranking-providers'),
};

// 文档相关 API
export const documentApi = {
  // 获取文档列表
  getList: (knowledgeBaseId: string) => 
    api.get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/`),
  
  // 上传文档（使用嵌套路由，避免额外参数解析不一致）
  upload: (knowledgeBaseId: string, formData: FormData, signal?: AbortSignal) => 
    api.post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
    }),
  
  // 删除文档
  delete: (knowledgeBaseId: string, documentId: string) => 
    api.delete(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`),
  
  // 获取分片策略
  getChunkingStrategies: () => 
    api.get('/api/v1/documents/chunking-strategies'),

  // 获取某文档的分片内容（支持分页）
  getChunks: (
    knowledgeBaseId: string,
    documentId: string | number,
    params?: { offset?: number; limit?: number }
  ) => api.get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`, { params }),

  // 预览分片（不落库）
  previewChunks: (knowledgeBaseId: string, formData: FormData, signal?: AbortSignal) =>
    api.post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/preview-chunks`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
    }),

  // 获取文档处理状态（全局路由，无需KB）
  getStatus: (documentId: string | number) =>
    api.get(`/api/v1/documents/${documentId}/status`),

  // 重试处理失败的文档（不重新上传）
  retry: (knowledgeBaseId: string, documentId: string | number) =>
    api.post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/retry`),

  // 批量删除文档
  batchDelete: (
    knowledgeBaseId: string,
    ids: (string | number)[]
  ) => api.post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/batch-delete`, { document_ids: ids.map(id => Number(id)) }),
};

// 系统状态相关 API
export const systemApi = {
  // 健康检查
  healthCheck: () => api.get('/health'),
  
  // 系统信息
  getInfo: () => api.get('/'),

  // 系统统计（需要超级管理员权限；不可用时请捕获异常）
  getStats: () => api.get('/api/v1/admin/stats'),
};

// 团队管理相关 API
export const teamApi = {
  // 获取当前用户所属的团队
  getCurrentTeam: () => api.get('/api/v1/teams/current'),

  // 获取当前团队 settings（共享模型开关/白名单）
  getCurrentSettings: () => api.get('/api/v1/teams/current/settings'),

  // 更新当前团队 settings（需要团队管理员/Owner）
  updateCurrentSettings: (data: {
    allow_shared_models?: boolean;
    shared_model_user_ids?: number[];
  }) => api.put('/api/v1/teams/current/settings', data),

  // 将用户加入共享模型白名单
  addSharedModelUser: (userId: number) => api.post(`/api/v1/teams/current/settings/shared-model-users/${userId}`),

  // 将用户移出共享模型白名单
  removeSharedModelUser: (userId: number) => api.delete(`/api/v1/teams/current/settings/shared-model-users/${userId}`),
  
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
    global_config?: any;
    is_public?: boolean;
    // 兼容旧字段（历史代码使用 config）
    config?: any; 
  }) => api.post('/api/v1/workflows/', {
    ...data,
    global_config: (data as any).global_config ?? (data as any).config ?? {},
  }),
  
  // 获取工作流列表
  getList: () => api.get('/api/v1/workflows/'),
  
  // 获取工作流详情
  getDetail: (id: string) => api.get(`/api/v1/workflows/${id}`),

  // 推导工作流级入参/出参 schema（用于 Tester 自动生成表单）
  getIOSchema: (id: string) => api.get(`/api/v1/workflows/${id}/io-schema`),
  
  // 更新工作流
  update: (id: string, data: {
    name?: string;
    description?: string;
    nodes?: any[];
    edges?: any[];
    global_config?: any;
    is_public?: boolean;
    // 兼容旧字段（历史代码使用 config）
    config?: any;
  }) => api.put(`/api/v1/workflows/${id}`, {
    ...data,
    global_config: (data as any).global_config ?? (data as any).config,
  }),
  
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
      let gotComplete = false;
      await streamSSE(
        `${API_BASE_URL}/api/v1/workflows/${id}/execute/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(data),
        },
        {
          onEvent: (evt) => {
            if (evt?.type === 'progress') onProgress(evt);
            else if (evt?.type === 'complete') {
              gotComplete = true;
              onComplete(evt);
            } else if (evt?.type === 'error') onError(evt);
          },
          onError,
          onComplete: () => {
            // Only send null-complete when backend didn't emit a complete payload.
            if (!gotComplete) onComplete(null);
          },
        },
        { retries: 1, retryDelayBaseMs: 800 }
      );
    } catch (error) {
      console.error('Workflow execution stream error:', error);
      onError(error);
    }
  },
  // 流式执行工作流（可取消）
  executeStreamCancelable: (
    id: string,
    data: { input_data: any; config?: any; debug?: boolean },
    onProgress: (progress: any) => void,
    onError: (error: any) => void,
    onComplete: (result: any) => void
  ) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    let gotComplete = false;
    return streamSSECancelable(
      `${API_BASE_URL}/api/v1/workflows/${id}/execute/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      },
      {
        onEvent: (evt) => {
          if (evt?.type === 'progress') onProgress(evt);
          else if (evt?.type === 'complete') {
            gotComplete = true;
            onComplete(evt);
          }
          else if (evt?.type === 'error') onError(evt);
        },
        onError,
        onComplete: () => {
          if (!gotComplete) onComplete(null);
        },
      },
      { retries: 1, retryDelayBaseMs: 800 }
    );
  },
  
  // 获取执行历史
  getExecutionHistory: (id: string, params?: { limit?: number; offset?: number }) =>
    api.get(`/api/v1/workflows/${id}/executions`, { params }),

  // 获取某次执行的完整详情（含步骤 input/output）
  getExecutionDetail: (id: string, executionId: string) =>
    api.get(`/api/v1/workflows/${id}/executions/${executionId}`),
  
  // 停止工作流执行
  stopExecution: (id: string, executionId: string) => 
    api.post(`/api/v1/workflows/${id}/executions/${executionId}/stop`),

  // 单步重试：从指定节点及其下游重新执行
  retryStep: (
    id: string,
    executionId: string,
    nodeId: string
  ) => api.post(`/api/v1/workflows/${id}/executions/${executionId}/steps/${nodeId}/retry`),
  
  // 验证工作流配置
  validate: (data: { nodes: any[]; edges: any[] }) => 
    api.post('/api/v1/workflows/validate', data),
  
  // 生成LangGraph代码
  generateCode: (data: { nodes: any[]; edges: any[] }) => 
    api.post('/api/v1/workflows/generate-code', data),

  // 获取工作流模板列表
  getTemplates: (params?: {
    category?: string;
    difficulty?: string;
    sort_by?: string;
    limit?: number;
    offset?: number;
    query?: string;
    mine?: boolean;
  }) => api.get('/api/v1/workflows/templates', { params }),

  // 获取工作流模板详情
  getTemplateDetail: (templateId: string) => api.get(`/api/v1/workflows/templates/${templateId}`),

  // 创建工作流模板
  createTemplate: (data: any) => api.post('/api/v1/workflows/templates', data),

  // 更新工作流模板
  updateTemplate: (templateId: string, data: any) => api.put(`/api/v1/workflows/templates/${templateId}`, data),

  // 删除工作流模板
  deleteTemplate: (templateId: string) => api.delete(`/api/v1/workflows/templates/${templateId}`),

  // 导入示例模板（管理员）
  seedTemplates: (overwrite?: boolean) =>
    api.post('/api/v1/workflows/templates/seed', null, { params: overwrite ? { overwrite: true } : undefined }),

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

// API Keys (Admin)
export const apiKeyApi = {
  create: (data: {
    name: string;
    tenant_id?: number;
    scopes?: string;
    allowed_kb?: string | null;
    allowed_workflow_id?: string | null;
    rate_limit_per_min?: number;
    expire_in_days?: number | null;
  }) => api.post('/api/v1/admin/api-keys', data),
  list: () => api.get('/api/v1/admin/api-keys'),
  revoke: (id: number) => api.delete(`/api/v1/admin/api-keys/${id}`),
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
      await streamSSE(
        `${API_BASE_URL}/api/v1/agents/${id}/chat/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(data),
        },
        { onEvent: onChunk, onError, onComplete },
        { retries: 1, retryDelayBaseMs: 800 }
      );
    } catch (error) {
      console.error('Agent chat stream error:', error);
      onError(error);
    }
  },
};

// 导出 api 实例
export { api };
export default api; 
