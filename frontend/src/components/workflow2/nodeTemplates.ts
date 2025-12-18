import type { WorkflowNodeKind } from './types';

export type NodeCategoryId = 'basic' | 'ai' | 'rag' | 'logic' | 'tool';

export type NodeTemplate = {
  kind: WorkflowNodeKind;
  nameKey: string;
  descriptionKey: string;
  defaultConfig: Record<string, any>;
  category: NodeCategoryId;
};

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    category: 'basic',
    kind: 'input',
    nameKey: 'workflow2.nodes.input.name',
    descriptionKey: 'workflow2.nodes.input.description',
    defaultConfig: {},
  },
  {
    category: 'ai',
    kind: 'llm',
    nameKey: 'workflow2.nodes.llm.name',
    descriptionKey: 'workflow2.nodes.llm.description',
    defaultConfig: {
      model: '',
      temperature: 0.7,
      max_tokens: 1000,
      system_prompt: '',
      prompt_key: '',
    },
  },
  {
    category: 'rag',
    kind: 'rag_retriever',
    nameKey: 'workflow2.nodes.rag_retriever.name',
    descriptionKey: 'workflow2.nodes.rag_retriever.description',
    defaultConfig: {
      knowledge_base: '',
      top_k: 5,
    },
  },
  {
    category: 'logic',
    kind: 'condition',
    nameKey: 'workflow2.nodes.condition.name',
    descriptionKey: 'workflow2.nodes.condition.description',
    defaultConfig: {
      field_path: 'value',
      condition_type: 'equals',
      condition_value: '',
    },
  },
  {
    category: 'tool',
    kind: 'code_executor',
    nameKey: 'workflow2.nodes.code_executor.name',
    descriptionKey: 'workflow2.nodes.code_executor.description',
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
    category: 'tool',
    kind: 'http_request',
    nameKey: 'workflow2.nodes.http_request.name',
    descriptionKey: 'workflow2.nodes.http_request.description',
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
    category: 'basic',
    kind: 'output',
    nameKey: 'workflow2.nodes.output.name',
    descriptionKey: 'workflow2.nodes.output.description',
    defaultConfig: {
      format: 'json',
      template: '',
      select_path: '',
    },
  },
];
