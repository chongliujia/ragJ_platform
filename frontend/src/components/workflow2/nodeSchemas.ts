import type { WorkflowNodeKind } from './types';

export type SchemaOption = { value: string; label?: string; labelKey?: string };

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
  labelKey?: string;
  type: NodeFieldType;
  group?: string;
  groupKey?: string;
  required?: boolean;
  helperText?: string;
  helperTextKey?: string;
  placeholder?: string;
  placeholderKey?: string;
  minRows?: number;
  inputProps?: Record<string, any>;
  options?: SchemaOption[] | ((ctx: { knowledgeBases: string[]; availableChatModels: string[] }) => SchemaOption[]);
};

export const NODE_SCHEMAS: Record<WorkflowNodeKind, NodeFieldSchema[]> = {
  input: [],
  llm: [
    {
      group: 'basic',
      key: 'model',
      label: 'model',
      type: 'select',
      options: ({ availableChatModels }) => [
        { value: '', labelKey: 'workflow2.schema.options.llmModelDefault' },
        ...availableChatModels.map((m) => ({ value: m, label: m })),
      ],
    },
    {
      group: 'basic',
      key: 'temperature',
      label: 'temperature',
      type: 'number',
      inputProps: { step: 0.1, min: 0, max: 2 },
      helperTextKey: 'workflow2.schema.helpers.temperature',
    },
    {
      group: 'basic',
      key: 'max_tokens',
      label: 'max_tokens',
      type: 'number',
      inputProps: { step: 50, min: 1 },
      helperTextKey: 'workflow2.schema.helpers.max_tokens',
    },
    {
      group: 'prompt',
      key: 'system_prompt',
      label: 'system_prompt',
      type: 'template',
      minRows: 4,
      helperTextKey: 'workflow2.schema.helpers.templateSupport',
    },
    {
      group: 'prompt',
      key: 'prompt_key',
      label: 'prompt_key',
      labelKey: 'workflow2.schema.fields.prompt_key',
      type: 'select',
      options: [
        { value: '', labelKey: 'workflow2.schema.options.promptKeyAuto' },
        { value: 'prompt', label: 'prompt' },
        { value: 'input', labelKey: 'workflow2.schema.options.promptKeyInputDify' },
        { value: 'text', label: 'text' },
        { value: 'query', label: 'query' },
        { value: 'message', label: 'message' },
      ],
    },
  ],
  rag_retriever: [
    {
      group: 'basic',
      key: 'knowledge_base',
      label: 'knowledge_base',
      labelKey: 'workflow2.schema.fields.knowledge_base',
      type: 'select',
      required: true,
      options: ({ knowledgeBases }) => [
        { value: '', labelKey: 'workflow2.schema.options.selectPlaceholder' },
        ...knowledgeBases.map((kb) => ({ value: kb, label: kb })),
      ],
    },
    {
      group: 'retrieval',
      key: 'top_k',
      label: 'top_k',
      type: 'number',
      inputProps: { step: 1, min: 1, max: 50 },
      helperTextKey: 'workflow2.schema.helpers.top_k',
    },
  ],
  http_request: [
    {
      group: 'basic',
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
      group: 'basic',
      key: 'url',
      label: 'url',
      type: 'template',
      placeholder: 'https://example.com/api',
      helperTextKey: 'workflow2.schema.helpers.urlTemplate',
    },
    {
      group: 'basic',
      key: 'timeout',
      label: 'timeout',
      labelKey: 'workflow2.schema.fields.timeoutSec',
      type: 'number',
      inputProps: { step: 1, min: 1 },
      helperTextKey: 'workflow2.schema.helpers.timeoutSec',
    },
    {
      group: 'request',
      key: 'headers',
      label: 'headers',
      labelKey: 'workflow2.schema.fields.headersJsonOptional',
      type: 'json_object',
      helperTextKey: 'workflow2.schema.helpers.headersExample',
    },
    {
      group: 'request',
      key: 'params',
      label: 'params',
      labelKey: 'workflow2.schema.fields.paramsJsonOptional',
      type: 'json_object',
      helperTextKey: 'workflow2.schema.helpers.paramsExample',
    },
    {
      group: 'request',
      key: 'data',
      label: 'data',
      labelKey: 'workflow2.schema.fields.dataJsonOptional',
      type: 'json_object',
      helperTextKey: 'workflow2.schema.helpers.dataExample',
    },
  ],
  condition: [
    {
      group: 'basic',
      key: 'field_path',
      label: 'field_path',
      type: 'text',
      helperTextKey: 'workflow2.schema.helpers.fieldPath',
    },
    {
      group: 'basic',
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
      group: 'basic',
      key: 'condition_value',
      label: 'condition_value',
      type: 'template',
      helperTextKey: 'workflow2.schema.helpers.conditionValue',
    },
  ],
  code_executor: [
    {
      group: 'basic',
      key: 'language',
      label: 'language',
      type: 'select',
      options: [{ value: 'python', label: 'python' }],
    },
    {
      group: 'code',
      key: 'code',
      label: 'code',
      type: 'code',
    },
    {
      group: 'sandbox',
      key: 'timeout_sec',
      label: 'timeout_sec',
      labelKey: 'workflow2.schema.fields.timeoutSec',
      type: 'number',
      inputProps: { step: 0.1, min: 0.1, max: 30 },
      helperTextKey: 'workflow2.schema.helpers.sandboxTimeout',
    },
    {
      group: 'sandbox',
      key: 'max_memory_mb',
      label: 'max_memory_mb',
      type: 'number',
      inputProps: { step: 16, min: 16, max: 4096 },
      helperTextKey: 'workflow2.schema.helpers.maxMemoryMb',
    },
    {
      group: 'sandbox',
      key: 'max_stdout_chars',
      label: 'max_stdout_chars',
      type: 'number',
      inputProps: { step: 1000, min: 1000, max: 200000 },
      helperTextKey: 'workflow2.schema.helpers.maxStdoutChars',
    },
    {
      group: 'sandbox',
      key: 'max_input_bytes',
      label: 'max_input_bytes',
      type: 'number',
      inputProps: { step: 10000, min: 10000, max: 50000000 },
      helperTextKey: 'workflow2.schema.helpers.maxInputBytes',
    },
    {
      group: 'sandbox',
      key: 'max_result_bytes',
      label: 'max_result_bytes',
      type: 'number',
      inputProps: { step: 10000, min: 10000, max: 50000000 },
      helperTextKey: 'workflow2.schema.helpers.maxResultBytes',
    },
  ],
  output: [
    {
      group: 'basic',
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
      group: 'template',
      key: 'template',
      label: 'template',
      labelKey: 'workflow2.schema.fields.templateOptional',
      type: 'template',
      minRows: 4,
      helperTextKey: 'workflow2.schema.helpers.outputTemplate',
    },
  ],
};
