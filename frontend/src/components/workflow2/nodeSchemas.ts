import type { WorkflowNodeKind } from './types';

export type SchemaOption = { value: string; label: string };

export type NodeFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'template'
  | 'json_object'
  | 'code';

export type NodeFieldSchema = {
  key: string;
  label: string;
  type: NodeFieldType;
  group?: string;
  required?: boolean;
  helperText?: string;
  placeholder?: string;
  minRows?: number;
  inputProps?: Record<string, any>;
  options?: SchemaOption[] | ((ctx: { knowledgeBases: string[]; availableChatModels: string[] }) => SchemaOption[]);
};

export const NODE_SCHEMAS: Record<WorkflowNodeKind, NodeFieldSchema[]> = {
  input: [],
  llm: [
    {
      group: '基础配置',
      key: 'model',
      label: 'model',
      type: 'select',
      options: ({ availableChatModels }) => [
        { value: '', label: '（使用默认/按租户配置）' },
        ...availableChatModels.map((m) => ({ value: m, label: m })),
      ],
    },
    {
      group: '基础配置',
      key: 'temperature',
      label: 'temperature',
      type: 'number',
      inputProps: { step: 0.1, min: 0, max: 2 },
      helperText: '控制输出随机性（0~2）。',
    },
    {
      group: '基础配置',
      key: 'max_tokens',
      label: 'max_tokens',
      type: 'number',
      inputProps: { step: 50, min: 1 },
      helperText: '限制输出最大 token 数。',
    },
    {
      group: '提示词',
      key: 'system_prompt',
      label: 'system_prompt',
      type: 'template',
      minRows: 4,
      helperText: '支持模板：{{变量}}（运行时按 data/input/context 解析）。',
    },
  ],
  rag_retriever: [
    {
      group: '基础配置',
      key: 'knowledge_base',
      label: '知识库',
      type: 'select',
      required: true,
      options: ({ knowledgeBases }) => [
        { value: '', label: '请选择' },
        ...knowledgeBases.map((kb) => ({ value: kb, label: kb })),
      ],
    },
    {
      group: '检索参数',
      key: 'top_k',
      label: 'top_k',
      type: 'number',
      inputProps: { step: 1, min: 1, max: 50 },
      helperText: '返回最相关的 K 条结果（1~50）。',
    },
  ],
  http_request: [
    {
      group: '基础配置',
      key: 'method',
      label: 'method',
      type: 'select',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'PATCH', label: 'PATCH' },
        { value: 'DELETE', label: 'DELETE' },
      ],
    },
    {
      group: '基础配置',
      key: 'url',
      label: 'url',
      type: 'template',
      placeholder: 'https://example.com/api',
      helperText: '支持模板：{{变量}}（例如 {{query}}）。',
    },
    {
      group: '基础配置',
      key: 'timeout',
      label: 'timeout（秒）',
      type: 'number',
      inputProps: { step: 1, min: 1 },
      helperText: '请求超时（秒）。',
    },
    {
      group: '请求内容',
      key: 'headers',
      label: 'headers（JSON 对象，可选）',
      type: 'json_object',
      helperText: '例如：{"Authorization":"Bearer xxx"}',
    },
    {
      group: '请求内容',
      key: 'params',
      label: 'params（JSON 对象，可选）',
      type: 'json_object',
      helperText: 'GET 查询参数，例如：{"q":"{{query}}"}',
    },
    {
      group: '请求内容',
      key: 'data',
      label: 'data（JSON 对象，可选，用作请求体）',
      type: 'json_object',
      helperText: 'POST/PUT/PATCH 请求体，例如：{"text":"{{prompt}}"}',
    },
  ],
  condition: [
    {
      group: '基础配置',
      key: 'field_path',
      label: 'field_path',
      type: 'text',
      helperText: '支持嵌套路径，例如 data.class',
    },
    {
      group: '基础配置',
      key: 'condition_type',
      label: 'condition_type',
      type: 'select',
      options: [
        { value: 'equals', label: 'equals' },
        { value: 'contains', label: 'contains' },
        { value: 'greater_than', label: 'greater_than' },
        { value: 'less_than', label: 'less_than' },
        { value: 'truthy', label: 'truthy' },
      ],
    },
    {
      group: '基础配置',
      key: 'condition_value',
      label: 'condition_value',
      type: 'template',
      helperText: '支持模板：{{变量}}（truthy 可留空）。',
    },
  ],
  code_executor: [
    {
      group: '基础配置',
      key: 'language',
      label: 'language',
      type: 'select',
      options: [{ value: 'python', label: 'python' }],
    },
    {
      group: '代码',
      key: 'code',
      label: 'code',
      type: 'code',
    },
    {
      group: 'Sandbox',
      key: 'timeout_sec',
      label: 'timeout_sec（秒）',
      type: 'number',
      inputProps: { step: 0.1, min: 0.1, max: 30 },
      helperText: '超时会直接终止子进程（默认 3s）。',
    },
    {
      group: 'Sandbox',
      key: 'max_memory_mb',
      label: 'max_memory_mb',
      type: 'number',
      inputProps: { step: 16, min: 16, max: 4096 },
      helperText: '子进程内存限制（MB）。',
    },
    {
      group: 'Sandbox',
      key: 'max_stdout_chars',
      label: 'max_stdout_chars',
      type: 'number',
      inputProps: { step: 1000, min: 1000, max: 200000 },
      helperText: '限制 stdout 输出长度，超限会截断。',
    },
    {
      group: 'Sandbox',
      key: 'max_input_bytes',
      label: 'max_input_bytes',
      type: 'number',
      inputProps: { step: 10000, min: 10000, max: 50000000 },
      helperText: '限制 input/context 的 JSON 体积，超限会报错。',
    },
    {
      group: 'Sandbox',
      key: 'max_result_bytes',
      label: 'max_result_bytes',
      type: 'number',
      inputProps: { step: 10000, min: 10000, max: 50000000 },
      helperText: '限制 result 的 JSON 体积，超限会报错。',
    },
  ],
  output: [
    {
      group: '基础配置',
      key: 'format',
      label: 'format',
      type: 'select',
      options: [
        { value: 'json', label: 'json' },
        { value: 'text', label: 'text' },
        { value: 'markdown', label: 'markdown' },
      ],
    },
    {
      group: '模板',
      key: 'template',
      label: 'template（可选）',
      type: 'template',
      minRows: 4,
      helperText: '留空则直接输出 input_data（兼容 data 包装）。',
    },
  ],
};
