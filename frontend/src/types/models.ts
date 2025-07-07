// 支持的模型提供商
export type ModelProvider = 'deepseek' | 'qwen' | 'siliconflow';

// 模型配置接口
export interface ModelConfig {
  provider: ModelProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

// 聊天模型配置
export interface ChatModelConfig extends ModelConfig {
  type: 'chat';
}

// 嵌入模型配置
export interface EmbeddingModelConfig extends ModelConfig {
  type: 'embedding';
}

// 重排模型配置
export interface RerankModelConfig extends ModelConfig {
  type: 'rerank';
}

// 完整的模型配置
export interface ModelsConfig {
  chat: ChatModelConfig;
  embedding: EmbeddingModelConfig;
  rerank: RerankModelConfig;
}

// 预定义的模型选项
export const MODEL_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: {
      chat: ['deepseek-chat', 'deepseek-coder'],
      embedding: ['deepseek-embedding'], // 模拟，实际可能不支持
    },
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: {
      chat: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
      embedding: ['text-embedding-v1', 'text-embedding-v2'],
      rerank: ['gte-rerank'],
    },
  },
  siliconflow: {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: {
      chat: ['deepseek-ai/DeepSeek-V2.5', 'Qwen/Qwen2.5-72B-Instruct'],
      embedding: ['BAAI/bge-large-zh-v1.5', 'BAAI/bge-m3'],
      rerank: ['BAAI/bge-reranker-v2-m3'],
    },
  },
} as const;

// 默认配置
export const DEFAULT_MODEL_CONFIG: ModelsConfig = {
  chat: {
    type: 'chat',
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.7,
    maxTokens: 2000,
    topP: 0.9,
  },
  embedding: {
    type: 'embedding',
    provider: 'siliconflow',
    apiKey: '',
    model: 'BAAI/bge-large-zh-v1.5',
  },
  rerank: {
    type: 'rerank',
    provider: 'qwen',
    apiKey: '',
    model: 'gte-rerank',
  },
}; 