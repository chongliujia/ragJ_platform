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
    console.error('Model Config API Error:', error);
    return Promise.reject(error);
  }
);

// 提供商配置接口
export interface ProviderConfig {
  provider: string;
  display_name: string;
  api_base: string;
  has_api_key: boolean;
  enabled: boolean;
  available_models: Record<string, string[]>;
  description: string;
}

// 模型配置接口
export interface ModelConfig {
  model_type: string;
  provider: string;
  model_name: string;
  has_api_key: boolean;
  enabled: boolean;
  api_key?: string; // 用于编辑时显示已保存的API密钥
  api_base?: string; // 用于编辑时显示已保存的API端点
  temperature?: number;
  max_tokens?: number;
}

// 更新模型配置请求
export interface UpdateModelConfigRequest {
  provider: string;
  model_name: string;
  api_key?: string; // 允许为空，保持现有密钥
  api_base?: string;
  temperature?: number;
  max_tokens?: number;
  enabled?: boolean;
}

// 更新提供商请求
export interface UpdateProviderRequest {
  api_key: string;
  api_base?: string;
  enabled?: boolean;
}

// 预设配置
export interface PresetConfig {
  name: string;
  description: string;
  models: Record<string, {
    provider: string;
    model_name: string;
  }>;
}

// 模型配置 API
export const modelConfigApi = {
  // 获取提供商列表
  getProviders: () => api.get<ProviderConfig[]>('/api/v1/model-config/providers'),
  
  // 获取指定提供商的模型列表
  getProviderModels: (provider: string, modelType: string) => 
    api.get(`/api/v1/model-config/providers/${provider}/models/${modelType}`),
  
  // 获取当前活跃模型
  getActiveModels: () => api.get<ModelConfig[]>('/api/v1/model-config/active-models'),
  
  // 获取模型配置详情（包含API密钥）
  getModelConfigDetails: (modelType: string) => 
    api.get<ModelConfig>(`/api/v1/model-config/active-models/${modelType}/details`),
  
  // 更新活跃模型
  updateActiveModel: (modelType: string, config: UpdateModelConfigRequest) =>
    api.put(`/api/v1/model-config/active-models/${modelType}`, config),
  
  // 更新提供商配置
  updateProvider: (provider: string, config: UpdateProviderRequest) =>
    api.put(`/api/v1/model-config/providers/${provider}`, config),
  
  // 获取配置摘要
  getConfigSummary: () => api.get('/api/v1/model-config/summary'),
  
  // 测试提供商连接
  testProviderConnection: (provider: string) =>
    api.post(`/api/v1/model-config/test/${provider}`),
  
  // 获取预设配置
  getPresets: () => api.get<{ presets: Record<string, PresetConfig> }>('/api/v1/model-config/presets'),
};

export default api;