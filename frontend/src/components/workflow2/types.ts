export type WorkflowNodeKind =
  | 'input'
  | 'llm'
  | 'rag_retriever'
  | 'http_request'
  | 'condition'
  | 'code_executor'
  | 'output';

export type WorkflowNodeData = {
  kind: WorkflowNodeKind;
  name: string;
  description?: string;
  config: Record<string, any>;
  enabled?: boolean;
};

export type WorkflowEdgeData = {
  source_output?: string;
  target_input?: string;
  condition?: string;
  transform?: string;
};

export type BackendWorkflowNode = {
  id: string;
  type: string;
  name?: string;
  description?: string;
  config?: Record<string, any>;
  position?: { x?: number; y?: number } | { x: number; y: number } | Record<string, any>;
  enabled?: boolean;
};

export type BackendWorkflowEdge = {
  id?: string;
  source: string;
  target: string;
  source_output?: string;
  target_input?: string;
  condition?: string;
  transform?: string;
};
