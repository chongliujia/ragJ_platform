import type { Edge, Node } from 'reactflow';
import type { BackendWorkflowEdge, BackendWorkflowNode, WorkflowEdgeData, WorkflowNodeData, WorkflowNodeKind } from './types';

export const WORKFLOW_NODE_TYPE = 'workflowNode' as const;

export function toReactFlowNodes(nodes: BackendWorkflowNode[]): Node<WorkflowNodeData>[] {
  return (nodes || []).map((n) => {
    const posAny: any = n.position || {};
    const x = Number(posAny.x);
    const y = Number(posAny.y);
    return {
      id: n.id,
      type: WORKFLOW_NODE_TYPE,
      position: {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
      },
      data: {
        kind: (n.type as WorkflowNodeKind) || 'input',
        name: n.name || n.type || 'node',
        description: n.description || '',
        config: n.config || {},
        enabled: n.enabled ?? true,
      },
    };
  });
}

export function toReactFlowEdges(edges: BackendWorkflowEdge[]): Edge<WorkflowEdgeData>[] {
  return (edges || []).map((e, idx) => ({
    id: e.id || `e_${e.source}_${e.target}_${idx}`,
    source: e.source,
    target: e.target,
    type: 'default',
    // Keep handles in sync so edges attach to the right ports after reload
    sourceHandle: e.source_output || 'output',
    targetHandle: e.target_input || 'input',
    data: {
      source_output: e.source_output,
      target_input: e.target_input,
      condition: e.condition,
      transform: e.transform,
    },
  }));
}

export function toBackendNodes(nodes: Node<WorkflowNodeData>[]): BackendWorkflowNode[] {
  return (nodes || []).map((n) => ({
    id: n.id,
    type: n.data.kind,
    name: n.data.name,
    description: n.data.description,
    config: n.data.config || {},
    position: n.position,
    enabled: n.data.enabled ?? true,
  }));
}

export function toBackendEdges(edges: Edge<WorkflowEdgeData>[]): BackendWorkflowEdge[] {
  return (edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    source_output: e.sourceHandle || e.data?.source_output || 'output',
    target_input: e.targetHandle || e.data?.target_input || 'input',
    condition: e.data?.condition,
    transform: e.data?.transform,
  }));
}
