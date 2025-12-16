import type { WorkflowNodeKind } from './types';

export type NodeTemplate = {
  kind: WorkflowNodeKind;
  name: string;
  description: string;
  defaultConfig: Record<string, any>;
  category: '基础' | 'AI' | 'RAG' | '逻辑' | '工具';
};

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    category: '基础',
    kind: 'input',
    name: '输入',
    description: '接收执行输入数据',
    defaultConfig: {},
  },
  {
    category: 'AI',
    kind: 'llm',
    name: 'LLM',
    description: '调用大语言模型生成文本',
    defaultConfig: {
      model: '',
      temperature: 0.7,
      max_tokens: 1000,
      system_prompt: '',
      prompt_key: '',
    },
  },
  {
    category: 'RAG',
    kind: 'rag_retriever',
    name: 'RAG 检索',
    description: '在知识库中检索相关内容',
    defaultConfig: {
      knowledge_base: '',
      top_k: 5,
    },
  },
  {
    category: '逻辑',
    kind: 'condition',
    name: '条件判断',
    description: '对输入字段做条件判断（输出 condition_result）',
    defaultConfig: {
      field_path: 'value',
      condition_type: 'equals',
      condition_value: '',
    },
  },
  {
    category: '工具',
    kind: 'code_executor',
    name: '代码执行',
    description: '执行 Python 代码（输出 result）',
    defaultConfig: {
      language: 'python',
      code: 'result = input_data',
      timeout_sec: 3,
      max_memory_mb: 256,
      max_stdout_chars: 10000,
      max_input_bytes: 2000000,
      max_result_bytes: 2000000,
    },
  },
  {
    category: '工具',
    kind: 'http_request',
    name: 'HTTP 请求',
    description: '发起 HTTP 请求并返回 response_data/status_code',
    defaultConfig: {
      method: 'GET',
      url: '',
      timeout: 30,
      headers: {},
      params: {},
      data: {},
    },
  },
  {
    category: '基础',
    kind: 'output',
    name: '输出',
    description: '格式化输出数据',
    defaultConfig: {
      format: 'json',
      template: '',
      select_path: '',
    },
  },
];
