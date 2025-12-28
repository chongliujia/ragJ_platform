import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Autocomplete,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  AutoAwesome as AutoAwesomeIcon,
  AccountTree as SemanticIcon,
  AddCircleOutline as AddIcon,
  CancelOutlined as RejectIcon,
  CheckCircleOutline as ApproveIcon,
  Close as CloseIcon,
  East as EastIcon,
  EditOutlined as EditIcon,
  FactCheck as ReviewIcon,
  KeyboardArrowDown as ExpandMoreIcon,
  KeyboardArrowUp as ExpandLessIcon,
  OpenInFull as OpenInFullIcon,
  OpenInNew as OpenInNewIcon,
  PublishOutlined as PublishIcon,
  Refresh as RefreshIcon,
  RestartAlt as ResetIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import ForceGraph3D from 'react-force-graph-3d';
import type { ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import { documentApi, knowledgeBaseApi } from '../services/api';
import { authApi } from '../services/authApi';
import { SEMANTIC_DISCOVERY_TRACKER_KEY } from '../constants/storage';

type CandidateStatus = 'pending' | 'approved' | 'rejected';
type CandidateType = 'entity' | 'relation' | 'attribute' | 'structure' | 'insight';
type ChunkStrategy = 'uniform' | 'leading' | 'head_tail' | 'diverse';
type ExtractionMode = 'direct' | 'summary';
type DiscoveryMode = 'facts' | 'insights';
type InsightScope = 'document' | 'cross' | '';
type DiscoveryStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

interface SemanticEvidence {
  source: string;
  snippet: string;
  documentId?: string;
  chunkIndex?: number;
}

interface SemanticCandidate {
  id: string;
  name: string;
  type: CandidateType;
  confidence: number;
  status: CandidateStatus;
  evidence: SemanticEvidence[];
  aliases?: string[];
  relation?: {
    source: string;
    relation: string;
    target: string;
  };
  attributes?: Record<string, any>;
}

interface DiscoveryProgress {
  status: DiscoveryStatus;
  current: number;
  total: number;
  current_chunks?: number;
  total_chunks?: number;
  processed_chunks_total?: number;
  planned_chunks_total?: number;
  document_label?: string;
  run_id?: string;
  cancel_requested?: boolean;
  message?: string;
  updated_at?: string;
}

type OntologyDraftStatus = 'idle' | 'running' | 'completed' | 'failed';
type OntologyItemKind = 'entity_type' | 'relation_type' | 'attribute_type' | 'structure_type';
type OntologyItemStatus = 'pending' | 'approved' | 'rejected';

interface OntologyDraftProgress {
  status: OntologyDraftStatus;
  current: number;
  total: number;
  version_id?: number;
  message?: string;
  updated_at?: string;
}

interface OntologyItem {
  id: number;
  kind: OntologyItemKind;
  name: string;
  description?: string;
  aliases?: string[];
  constraints?: Record<string, any>;
  confidence: number;
  evidence: Array<{ document_id?: number; source?: string; snippet?: string }>;
  status: OntologyItemStatus;
  meta?: Record<string, any>;
}

interface OntologyVersion {
  id: number;
  name: string;
  status: 'draft' | 'active' | 'archived';
  source: string;
  created_at?: string;
  updated_at?: string;
  config?: Record<string, any>;
  stats?: {
    total?: number;
    by_status?: Record<string, number>;
    by_kind?: Record<string, number>;
  };
}

interface CanonicalEntity {
  name: string;
  aliases: string[];
  attributes: Record<string, any>;
}

type GraphNodeKind = 'entity' | 'attribute' | 'structure' | 'document';
type GraphEdgeKind = 'relation' | 'attribute';
type GraphMode = 'all' | 'structure';
type GraphLabelMode = 'auto' | 'show' | 'hide';

interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  status: CandidateStatus;
  candidateId?: string;
  parentId?: string;
  structureLevel?: number;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  status: CandidateStatus;
  label?: string;
  candidateId?: string;
  relationKind?: 'structure';
}

type WebGLGraphProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layoutMode: 'radial' | 'grid';
  mode: GraphMode;
  groupByDoc: boolean;
  labelEnabled: boolean;
  interactive?: boolean;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  focusSelection?: boolean;
  onReady?: (graph: ForceGraphMethods) => void;
};

const EXTRACTION_MAX_CHUNKS_LIMIT = 50;
const EXTRACTION_MAX_TEXT_CHARS_LIMIT = 4000;
const EXTRACTION_MAX_ITEMS_LIMIT = 30;
const EXTRACTION_DEFAULT_MAX_CHUNKS = 3;
const EXTRACTION_DEFAULT_MAX_TEXT_CHARS = 1800;
const EXTRACTION_DEFAULT_MAX_ITEMS = 12;
const EXTRACTION_DEFAULT_DOCUMENT_LIMIT = 6;
const EXTRACTION_DEFAULT_MODE: ExtractionMode = 'direct';
const EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS = 6;
const EXTRACTION_DEFAULT_PROGRESSIVE_STEP = 3;
const EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS = 2000;
const EXTRACTION_DEFAULT_BATCH_SIZE = 1;
const EXTRACTION_DEFAULT_CONCURRENCY = 3;
const EXTRACTION_MAX_DOCUMENT_LIMIT = 50;
const EXTRACTION_MAX_PROGRESSIVE_ITEMS = 50;
const EXTRACTION_MAX_PROGRESSIVE_STEP = 50;
const EXTRACTION_MAX_SUMMARY_CHARS = 4000;
const DOCUMENT_SEARCH_PAGE_SIZE = 30;
const GRAPH_DEFAULT_STRUCTURE_LEVEL = 2;
const GRAPH_DEFAULT_NODE_LIMIT = 1200;
const GRAPH_MIN_NODE_LIMIT = 200;
const GRAPH_MAX_NODE_LIMIT = 10000;
const GRAPH_LABEL_AUTO_THRESHOLD = 800;

const CHUNK_STRATEGY_OPTIONS: Array<{ value: ChunkStrategy; labelKey: string }> = [
  { value: 'uniform', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.chunkStrategyUniform' },
  { value: 'leading', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.chunkStrategyLeading' },
  { value: 'head_tail', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.chunkStrategyHeadTail' },
  { value: 'diverse', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.chunkStrategyDiverse' },
];

const EXTRACTION_MODE_OPTIONS: Array<{ value: ExtractionMode; labelKey: string }> = [
  { value: 'direct', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.modeDirect' },
  { value: 'summary', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.modeSummary' },
];

const DISCOVERY_MODE_OPTIONS: Array<{ value: DiscoveryMode; labelKey: string }> = [
  { value: 'facts', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.discoveryModeFacts' },
  { value: 'insights', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.discoveryModeInsights' },
];

const INSIGHT_SCOPE_OPTIONS: Array<{ value: Exclude<InsightScope, ''>; labelKey: string }> = [
  { value: 'document', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightScopeDocument' },
  { value: 'cross', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightScopeCross' },
];

const INSIGHT_DOMAIN_OPTIONS = [
  { value: 'general', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightDomainGeneral' },
  { value: 'legal', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightDomainLegal' },
  { value: 'medical', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightDomainMedical' },
  { value: 'math', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightDomainMath' },
  { value: 'business', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightDomainBusiness' },
  { value: 'news', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightDomainNews' },
  { value: 'intelligence', labelKey: 'knowledgeBase.semanticLayer.discoveryDialog.insightDomainIntelligence' },
];

const GRAPH_MODE_OPTIONS: Array<{ value: GraphMode; labelKey: string }> = [
  { value: 'all', labelKey: 'knowledgeBase.semanticLayer.graph.modeAll' },
  { value: 'structure', labelKey: 'knowledgeBase.semanticLayer.graph.modeStructure' },
];

const GRAPH_LABEL_MODE_OPTIONS: Array<{ value: GraphLabelMode; labelKey: string }> = [
  { value: 'auto', labelKey: 'knowledgeBase.semanticLayer.graph.labelAuto' },
  { value: 'show', labelKey: 'knowledgeBase.semanticLayer.graph.labelShow' },
  { value: 'hide', labelKey: 'knowledgeBase.semanticLayer.graph.labelHide' },
];

const CANDIDATE_ROW_HEIGHT = 56;
const CANDIDATE_OVERSCAN = 6;

const toLimitString = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(fallback);
  const clamped = Math.min(max, Math.max(min, Math.trunc(parsed)));
  return String(clamped);
};

const toChunkStrategy = (value: unknown, fallback: ChunkStrategy): ChunkStrategy => {
  if (value === 'uniform' || value === 'leading' || value === 'head_tail' || value === 'diverse') {
    return value;
  }
  return fallback;
};

const toExtractionMode = (value: unknown, fallback: ExtractionMode): ExtractionMode => {
  if (value === 'direct' || value === 'summary') {
    return value;
  }
  return fallback;
};

const toDiscoveryMode = (value: unknown, fallback: DiscoveryMode): DiscoveryMode => {
  if (value === 'facts' || value === 'insights') {
    return value;
  }
  return fallback;
};

const toInsightScope = (value: unknown): InsightScope => {
  if (value === 'document' || value === 'cross') {
    return value;
  }
  return '';
};

const parseTypeList = (value: string) =>
  value
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

type DocumentOption = {
  id: string;
  label: string;
  status?: string;
};

const WebGLGraph: React.FC<WebGLGraphProps> = ({
  nodes,
  edges,
  layoutMode,
  mode,
  groupByDoc,
  labelEnabled,
  interactive = true,
  selectedNodeId,
  selectedEdgeId,
  focusSelection,
  onReady,
}) => {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const layoutPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    if (nodes.length === 0) return positions;

    const centerPositions = () => {
      let sumX = 0;
      let sumY = 0;
      positions.forEach((pos) => {
        sumX += pos.x;
        sumY += pos.y;
      });
      const count = positions.size || 1;
      const offsetX = sumX / count;
      const offsetY = sumY / count;
      positions.forEach((pos, key) => {
        positions.set(key, { x: pos.x - offsetX, y: pos.y - offsetY });
      });
    };

    if (layoutMode === 'radial') {
      if (mode === 'structure') {
        const levelGroups = new Map<number, GraphNode[]>();
        nodes.forEach((node) => {
          if (node.kind === 'document') {
            positions.set(node.id, { x: 0, y: 0 });
            return;
          }
          const level = node.structureLevel ?? 1;
          const list = levelGroups.get(level) ?? [];
          list.push(node);
          levelGroups.set(level, list);
        });
        const ringSpacing = 70;
        Array.from(levelGroups.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([level, group]) => {
            const count = group.length || 1;
            group.forEach((node, index) => {
              const angle = (index / count) * Math.PI * 2;
              const radius = ringSpacing * level;
              positions.set(node.id, {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
              });
            });
          });
      } else {
        const kindOrder: GraphNodeKind[] = ['document', 'structure', 'entity', 'attribute'];
        const ringIndex = new Map<GraphNodeKind, number>();
        kindOrder.forEach((kind, index) => ringIndex.set(kind, index));
        const ringSpacing = 140;
        const byKind = new Map<GraphNodeKind, GraphNode[]>();
        nodes.forEach((node) => {
          const list = byKind.get(node.kind) ?? [];
          list.push(node);
          byKind.set(node.kind, list);
        });
        kindOrder.forEach((kind) => {
          const list = byKind.get(kind) || [];
          const count = list.length || 1;
          const ring = ringIndex.get(kind) ?? 1;
          list.forEach((node, index) => {
            const angle = (index / count) * Math.PI * 2;
            const radius = ringSpacing * (ring + 1);
            positions.set(node.id, {
              x: Math.cos(angle) * radius,
              y: Math.sin(angle) * radius,
            });
          });
        });
      }
      centerPositions();
      return positions;
    }

    if (mode === 'structure' && groupByDoc) {
      const groupMap = new Map<string, GraphNode[]>();
      const docNodes = nodes.filter((node) => node.kind === 'document');
      const docOrder = docNodes.map((node) => node.id);
      nodes.forEach((node) => {
        const groupKey = node.kind === 'document' ? node.id : node.parentId || 'ungrouped';
        const list = groupMap.get(groupKey) ?? [];
        list.push(node);
        groupMap.set(groupKey, list);
      });
      const groupKeys = Array.from(groupMap.keys()).sort((a, b) => {
        const aIndex = docOrder.indexOf(a);
        const bIndex = docOrder.indexOf(b);
        if (aIndex !== -1 || bIndex !== -1) {
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        }
        return a.localeCompare(b);
      });
      const groupSpacing = 240;
      const levelSpacing = 90;
      const rowSpacing = 44;
      const colSpacing = 90;
      const columns = 4;
      const docOffset = 70;
      groupKeys.forEach((groupKey, groupIndex) => {
        const groupNodes = groupMap.get(groupKey) || [];
        const docNode = groupNodes.find((node) => node.kind === 'document');
        if (docNode) {
          positions.set(docNode.id, { x: groupIndex * groupSpacing, y: 0 });
        }
        const bucketByLevel = new Map<number, GraphNode[]>();
        groupNodes
          .filter((node) => node.kind !== 'document')
          .forEach((node) => {
            const level = node.structureLevel ?? 1;
            const list = bucketByLevel.get(level) ?? [];
            list.push(node);
            bucketByLevel.set(level, list);
          });
        Array.from(bucketByLevel.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([level, list]) => {
            list.sort((a, b) => a.label.localeCompare(b.label));
            list.forEach((node, index) => {
              const row = Math.floor(index / columns);
              const col = index % columns;
              positions.set(node.id, {
                x: groupIndex * groupSpacing + col * colSpacing,
                y: docOffset + (level - 1) * levelSpacing + row * rowSpacing,
              });
            });
          });
      });
      centerPositions();
      return positions;
    }

    const spacing = 70;
    const columnCount = Math.ceil(Math.sqrt(nodes.length));
    const ordered = [...nodes].sort((a, b) => a.kind.localeCompare(b.kind));
    ordered.forEach((node, index) => {
      const row = Math.floor(index / columnCount);
      const col = index % columnCount;
      positions.set(node.id, { x: col * spacing, y: row * spacing });
    });
    centerPositions();
    return positions;
  }, [groupByDoc, layoutMode, mode, nodes]);

  const graphPayload = useMemo(() => {
    const statusColors: Record<CandidateStatus, string> = {
      approved: theme.palette.success.main,
      pending: theme.palette.warning.main,
      rejected: theme.palette.error.main,
    };
    const kindBase: Record<GraphNodeKind, string> = {
      document: theme.palette.secondary.main,
      structure: theme.palette.info.main,
      entity: theme.palette.primary.main,
      attribute: theme.palette.text.secondary,
    };
    const highlightNodes = new Set<string>();
    const highlightEdges = new Set<string>();
    if (selectedEdgeId) {
      const edge = edges.find((item) => item.id === selectedEdgeId);
      if (edge) {
        highlightEdges.add(edge.id);
        highlightNodes.add(edge.from);
        highlightNodes.add(edge.to);
      }
    }
    if (selectedNodeId) {
      highlightNodes.add(selectedNodeId);
      edges.forEach((edge) => {
        if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
          highlightEdges.add(edge.id);
          highlightNodes.add(edge.from);
          highlightNodes.add(edge.to);
        }
      });
    }
    const hasHighlight = highlightNodes.size > 0 || highlightEdges.size > 0;
    const nodeSize: Record<GraphNodeKind, number> = {
      document: 11,
      structure: 8,
      entity: 9,
      attribute: 7,
    };
    const depthIndex: Record<GraphNodeKind, number> = {
      document: -2,
      structure: -1,
      entity: 0,
      attribute: 1,
    };
    const zSpacing = 140;
    const structureZSpacing = 40;

    const graphNodes = nodes.map((node) => {
      const baseColor = node.kind === 'document' ? kindBase.document : statusColors[node.status];
      const color =
        hasHighlight && !highlightNodes.has(node.id) && !focusSelection
          ? alpha(baseColor, 0.2)
          : baseColor;
      const baseDepth = depthIndex[node.kind] ?? 0;
      const z = baseDepth * zSpacing +
        (node.kind === 'structure' ? (node.structureLevel ?? 1) * structureZSpacing : 0);
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        x: layoutPositions.get(node.id)?.x ?? 0,
        y: layoutPositions.get(node.id)?.y ?? 0,
        z,
        size: nodeSize[node.kind] || 6,
        color,
      };
    });

    const graphLinks = edges.map((edge) => {
      const baseColor = theme.palette.common.black;
      const color =
        hasHighlight && !highlightEdges.has(edge.id) && !focusSelection
          ? alpha(baseColor, 0.2)
          : baseColor;
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label || '',
        color,
      };
    });

    return { nodes: graphNodes, links: graphLinks };
  }, [
    edges,
    focusSelection,
    layoutPositions,
    mode,
    nodes,
    selectedEdgeId,
    selectedNodeId,
    theme,
  ]);

  const nodeThreeObject = useCallback(
    (node: { label?: string; size?: number }) => {
      if (!labelEnabled) return null;
      const sprite = new SpriteText(node.label || '');
      sprite.color = '#111';
      sprite.textHeight = 5;
      sprite.backgroundColor = 'rgba(255,255,255,0)';
      sprite.borderWidth = 0;
      sprite.material.depthWrite = false;
      sprite.position.x = (node.size ?? 6) * 1.6;
      sprite.position.y = (node.size ?? 6) * 0.2;
      return sprite;
    },
    [labelEnabled]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      setDimensions({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (graphRef.current) {
      onReady?.(graphRef.current);
    }
  }, [onReady, graphPayload]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || typeof graph.d3Force !== 'function') return;
    const linkForce = graph.d3Force('link');
    if (linkForce && typeof linkForce.distance === 'function') {
      linkForce
        .distance((link: any) => {
          const sourceKind = link?.source?.kind;
          const targetKind = link?.target?.kind;
          if (sourceKind === 'document' || targetKind === 'document') {
            return 90;
          }
          if (sourceKind === 'structure' || targetKind === 'structure') {
            return 70;
          }
          return 55;
        })
        .strength?.(0.9);
    }
    const chargeForce = graph.d3Force('charge');
    chargeForce?.strength?.(-60);
    graph.d3ReheatSimulation?.();
  }, [graphPayload]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        pointerEvents: interactive ? 'auto' : 'none',
        bgcolor: '#fff',
      }}
    >
      {dimensions.width > 0 && dimensions.height > 0 && (
        <ForceGraph3D
          ref={graphRef}
          graphData={graphPayload}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#ffffff"
          showNavInfo={false}
          forceEngine="ngraph"
          cooldownTicks={180}
          nodeRelSize={4}
          nodeVal="size"
          nodeColor={(node) => (node as { color: string }).color}
          linkColor={(link) => (link as { color: string }).color}
          linkOpacity={0.85}
          linkWidth={1}
          nodeLabel={(node) => (node as { label?: string }).label || ''}
          linkLabel={(link) => (link as { label?: string }).label || ''}
          enableNodeDrag={interactive}
          enableNavigationControls={interactive}
          nodeThreeObject={labelEnabled ? nodeThreeObject : undefined}
          nodeThreeObjectExtend={labelEnabled}
        />
      )}
    </Box>
  );
};

const STATUS_PRIORITY: Record<CandidateStatus, number> = {
  approved: 3,
  pending: 2,
  rejected: 1,
};
const GRAPH_MIN_DISTANCE = 120;
const GRAPH_MAX_DISTANCE = 8000;
const normalize = (value: string) => value.trim().toLowerCase();
const extractStructureLabel = (value: string) => {
  const parts = value.split(' / ');
  if (parts.length >= 2) {
    return parts[parts.length - 1].trim() || value;
  }
  return value;
};
const extractDocLabel = (value: string) => {
  const parts = value.split(' / ');
  if (parts.length >= 2) {
    return parts[0].trim() || '';
  }
  return '';
};
const coerceStructureLevel = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  const level = Math.trunc(parsed);
  if (level <= 0) return 1;
  return level;
};
const formatTimestamp = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};
const getAttributeKey = (candidate: SemanticCandidate) => {
  if (candidate.type !== 'attribute') return null;
  if (candidate.name.includes('.')) {
    const parts = candidate.name.split('.');
    if (parts.length >= 2) {
      return parts.slice(1).join('.');
    }
  }
  return candidate.attributes?.key || null;
};
const getAttributeEntity = (candidate: SemanticCandidate) => {
  if (candidate.type !== 'attribute') return null;
  if (candidate.name.includes('.')) {
    return candidate.name.split('.')[0];
  }
  return candidate.attributes?.entity || null;
};
const getAttributeValue = (candidate: SemanticCandidate) => {
  if (candidate.type !== 'attribute') return null;
  if (candidate.attributes?.value) return String(candidate.attributes.value);
  return null;
};

const KnowledgeBaseSemantic: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { kbId } = useParams();
  const theme = useTheme();

  const kbName = (location.state as { kbName?: string } | undefined)?.kbName || kbId || '-';
  const [candidates, setCandidates] = useState<SemanticCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeMode, setMergeMode] = useState<'existing' | 'new'>('existing');
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeAlias, setMergeAlias] = useState(true);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const [mergeMap, setMergeMap] = useState<
    Record<string, { mode: 'existing' | 'new'; target: string; alias: boolean }>
  >({});
  const [scope, setScope] = useState('all');
  const [includeRelations, setIncludeRelations] = useState(true);
  const [queuedAt, setQueuedAt] = useState<string | null>(null);
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress | null>(null);
  const discoveryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isCancellingDiscovery, setIsCancellingDiscovery] = useState(false);
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confidenceMin, setConfidenceMin] = useState('0.6');
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphDialogOpen, setGraphDialogOpen] = useState(false);
  const [graphLayoutMode, setGraphLayoutMode] = useState<'radial' | 'grid'>('radial');
  const [graphShowRelations, setGraphShowRelations] = useState(true);
  const [graphShowAttributes, setGraphShowAttributes] = useState(true);
  const [graphShowStructures, setGraphShowStructures] = useState(true);
  const [graphMode, setGraphMode] = useState<GraphMode>('all');
  const [graphStructureLevel, setGraphStructureLevel] = useState(
    String(GRAPH_DEFAULT_STRUCTURE_LEVEL)
  );
  const [graphLimitEnabled, setGraphLimitEnabled] = useState(true);
  const [graphMaxNodes, setGraphMaxNodes] = useState(String(GRAPH_DEFAULT_NODE_LIMIT));
  const [graphLabelMode, setGraphLabelMode] = useState<GraphLabelMode>('show');
  const [graphGroupStructuresByDoc, setGraphGroupStructuresByDoc] = useState(true);
  const [graphCollapseDocuments, setGraphCollapseDocuments] = useState(false);
  const [graphFocusSelection, setGraphFocusSelection] = useState(false);
  const graphPreviewRef = useRef<ForceGraphMethods | null>(null);
  const graphDialogRef = useRef<ForceGraphMethods | null>(null);
  const [ontologyDraftOpen, setOntologyDraftOpen] = useState(false);
  const [ontologyDraftProgress, setOntologyDraftProgress] = useState<OntologyDraftProgress | null>(null);
  const [ontologyDraftItems, setOntologyDraftItems] = useState<OntologyItem[]>([]);
  const [ontologyDraftLoading, setOntologyDraftLoading] = useState(false);
  const [ontologyDraftSelected, setOntologyDraftSelected] = useState<number[]>([]);
  const [ontologyDraftStatusFilter, setOntologyDraftStatusFilter] = useState('pending');
  const [ontologyDraftKindFilter, setOntologyDraftKindFilter] = useState('all');
  const [ontologyVersions, setOntologyVersions] = useState<OntologyVersion[]>([]);
  const [ontologyVersionsLoading, setOntologyVersionsLoading] = useState(false);
  const [ontologyDraftSearch, setOntologyDraftSearch] = useState('');
  const [ontologyDraftExpanded, setOntologyDraftExpanded] = useState<number | null>(null);
  const [ontologyDraftEditOpen, setOntologyDraftEditOpen] = useState(false);
  const [ontologyDraftEditItem, setOntologyDraftEditItem] = useState<OntologyItem | null>(null);
  const [ontologyDraftEditKind, setOntologyDraftEditKind] = useState<OntologyItemKind>('entity_type');
  const [ontologyDraftEditName, setOntologyDraftEditName] = useState('');
  const [ontologyDraftEditDescription, setOntologyDraftEditDescription] = useState('');
  const [ontologyDraftEditAliases, setOntologyDraftEditAliases] = useState('');
  const [ontologyDraftEditConstraints, setOntologyDraftEditConstraints] = useState('');
  const [ontologyDraftEditStatus, setOntologyDraftEditStatus] =
    useState<OntologyItemStatus>('pending');
  const [ontologyDraftEditError, setOntologyDraftEditError] = useState<string | null>(null);
  const [ontologyPublishOpen, setOntologyPublishOpen] = useState(false);
  const [ontologyPublishName, setOntologyPublishName] = useState('');
  const [ontologyPublishError, setOntologyPublishError] = useState<string | null>(null);
  const ontologyDraftPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [maxChunks, setMaxChunks] = useState(String(EXTRACTION_DEFAULT_MAX_CHUNKS));
  const [maxTextChars, setMaxTextChars] = useState(String(EXTRACTION_DEFAULT_MAX_TEXT_CHARS));
  const [maxItems, setMaxItems] = useState(String(EXTRACTION_DEFAULT_MAX_ITEMS));
  const [documentLimit, setDocumentLimit] = useState(String(EXTRACTION_DEFAULT_DOCUMENT_LIMIT));
  const [fullChunkScan, setFullChunkScan] = useState(false);
  const [batchSize, setBatchSize] = useState(String(EXTRACTION_DEFAULT_BATCH_SIZE));
  const [batchConcurrency, setBatchConcurrency] = useState(
    String(EXTRACTION_DEFAULT_CONCURRENCY)
  );
  const [autoChunking, setAutoChunking] = useState(false);
  const [chunkStrategy, setChunkStrategy] = useState<ChunkStrategy>('uniform');
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(EXTRACTION_DEFAULT_MODE);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('facts');
  const [insightScope, setInsightScope] = useState<InsightScope>('');
  const [insightDomain, setInsightDomain] = useState('general');
  const [documentOptions, setDocumentOptions] = useState<DocumentOption[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<DocumentOption[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentQuery, setDocumentQuery] = useState('');
  const [documentOffset, setDocumentOffset] = useState(0);
  const [documentHasMore, setDocumentHasMore] = useState(true);
  const [progressiveEnabled, setProgressiveEnabled] = useState(false);
  const [progressiveMinItems, setProgressiveMinItems] = useState(
    String(EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS)
  );
  const [progressiveStep, setProgressiveStep] = useState(
    String(EXTRACTION_DEFAULT_PROGRESSIVE_STEP)
  );
  const [summaryMaxChars, setSummaryMaxChars] = useState(
    String(EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS)
  );
  const [entityTypeWhitelist, setEntityTypeWhitelist] = useState('');
  const [relationTypeWhitelist, setRelationTypeWhitelist] = useState('');
  const limitsTouchedRef = useRef(false);
  const scopeTouchedRef = useRef(false);
  const documentSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentRequestRef = useRef(0);
  const selectedDocumentsRef = useRef<DocumentOption[]>([]);
  const candidateListRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [candidateListHeight, setCandidateListHeight] = useState(320);
  const [candidateScrollTop, setCandidateScrollTop] = useState(0);

  const mergeDocumentOptions = useCallback(
    (base: DocumentOption[], selected: DocumentOption[]) => {
      const map = new Map<string, DocumentOption>();
      base.forEach((item) => {
        map.set(item.id, item);
      });
      selected.forEach((item) => {
        if (!map.has(item.id)) {
          map.set(item.id, item);
        }
      });
      return Array.from(map.values());
    },
    []
  );

  const isInsightMode = discoveryMode === 'insights';
  const isSingleDocInsight = isInsightMode && insightScope === 'document';
  const requiresSelection = scope === 'selected' || isSingleDocInsight;


  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId) || null,
    [candidates, selectedId]
  );

  useEffect(() => {
    if (!selectedCandidate && graphFocusSelection) {
      setGraphFocusSelection(false);
    }
  }, [graphFocusSelection, selectedCandidate]);

  useEffect(() => {
    selectedDocumentsRef.current = selectedDocuments;
    setDocumentOptions((prev) => mergeDocumentOptions(prev, selectedDocuments));
  }, [mergeDocumentOptions, selectedDocuments]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const node = candidateListRef.current;
    if (!node) return;
    const updateHeight = () => {
      const nextHeight = node.clientHeight || 0;
      if (nextHeight) {
        setCandidateListHeight(nextHeight);
      }
    };
    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateHeight();
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  const counts = useMemo(
    () => ({
      entities: candidates.filter((c) => c.type === 'entity').length,
      relations: candidates.filter((c) => c.type === 'relation').length,
      attributes: candidates.filter((c) => c.type === 'attribute').length,
      structures: candidates.filter((c) => c.type === 'structure').length,
      insights: candidates.filter((c) => c.type === 'insight').length,
    }),
    [candidates]
  );

  const candidateCount = candidates.length;
  const hasCandidates = candidateCount > 0;
  const discoveryStatus = discoveryProgress?.status || 'idle';
  const discoveryTotal = discoveryProgress?.total ?? 0;
  const discoveryCurrent = discoveryProgress?.current ?? 0;
  const discoveryChunkTotal = discoveryProgress?.total_chunks ?? 0;
  const discoveryChunkCurrent = discoveryProgress?.current_chunks ?? 0;
  const discoveryPlannedChunksTotal = discoveryProgress?.planned_chunks_total ?? 0;
  const discoveryProcessedChunksTotal = discoveryProgress?.processed_chunks_total ?? 0;
  const hasChunkProgress = discoveryChunkTotal > 0;
  const hasChunkTotals = discoveryPlannedChunksTotal > 0;
  const discoveryDocPercent =
    discoveryTotal > 0 ? Math.min(100, Math.round((discoveryCurrent / discoveryTotal) * 100)) : 0;
  const discoveryChunkPercent = hasChunkProgress
    ? Math.min(100, Math.round((discoveryChunkCurrent / discoveryChunkTotal) * 100))
    : 0;
  const discoveryOverallChunkPercent = hasChunkTotals
    ? Math.min(
        100,
        Math.round((discoveryProcessedChunksTotal / discoveryPlannedChunksTotal) * 100)
      )
    : 0;
  const discoveryPercent = hasChunkTotals
    ? discoveryOverallChunkPercent
    : hasChunkProgress
      ? discoveryChunkPercent
      : discoveryDocPercent;
  const discoveryDocLabel = (discoveryProgress?.document_label || '').trim();
  const discoveryChunkLabel = hasChunkProgress
    ? discoveryDocLabel
      ? t('knowledgeBase.semanticLayer.progress.runningChunksDoc', {
          doc: discoveryDocLabel,
          current: discoveryChunkCurrent,
          total: discoveryChunkTotal,
        })
      : t('knowledgeBase.semanticLayer.progress.runningChunks', {
          current: discoveryChunkCurrent,
          total: discoveryChunkTotal,
        })
    : '';
  const discoveryCancelRequested = Boolean(discoveryProgress?.cancel_requested);
  const ontologyStatus = ontologyDraftProgress?.status || 'idle';
  const ontologyCurrent = ontologyDraftProgress?.current ?? 0;
  const ontologyTotal = ontologyDraftProgress?.total ?? 0;
  const ontologyPercent =
    ontologyTotal > 0 ? Math.min(100, Math.round((ontologyCurrent / ontologyTotal) * 100)) : 0;
  const discoveryDocProgressLabel =
    discoveryTotal > 0
      ? t('knowledgeBase.semanticLayer.progress.running', {
          current: discoveryCurrent,
          total: discoveryTotal,
        })
      : t('knowledgeBase.semanticLayer.progress.preparing');
  const discoveryDocLabelText =
    !hasChunkProgress && discoveryDocLabel
      ? t('knowledgeBase.semanticLayer.progress.currentDoc', { doc: discoveryDocLabel })
      : '';
  const discoveryOverallChunkLabel = hasChunkTotals
    ? t('knowledgeBase.semanticLayer.progress.overallChunks', {
        current: discoveryProcessedChunksTotal,
        total: discoveryPlannedChunksTotal,
      })
    : '';
  const activeOntology = useMemo(
    () => ontologyVersions.find((item) => item.status === 'active') || null,
    [ontologyVersions]
  );
  const draftOntology = useMemo(() => {
    if (ontologyDraftProgress?.version_id) {
      return (
        ontologyVersions.find((item) => item.id === ontologyDraftProgress.version_id) || null
      );
    }
    return ontologyVersions.find((item) => item.status === 'draft') || null;
  }, [ontologyDraftProgress?.version_id, ontologyVersions]);
  const ontologyDraftVersionId = draftOntology?.id ?? ontologyDraftProgress?.version_id;
  const hasDraftVersion = Boolean(ontologyDraftVersionId);

  const canonicalEntities = useMemo(() => {
    const approved = candidates.filter(
      (candidate) => candidate.type === 'entity' && candidate.status === 'approved'
    );
    const base: CanonicalEntity[] = approved.map((candidate) => ({
      name: candidate.name,
      aliases: candidate.aliases ?? [],
      attributes: candidate.attributes ?? {},
    }));
    const merged = new Map<string, CanonicalEntity>();
    base.forEach((entity) => {
      const key = entity.name.trim().toLowerCase();
      if (!key) return;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          name: entity.name,
          aliases: Array.from(new Set(entity.aliases)),
          attributes: { ...entity.attributes },
        });
        return;
      }
      merged.set(key, {
        name: existing.name,
        aliases: Array.from(new Set([...existing.aliases, ...entity.aliases])),
        attributes: { ...existing.attributes, ...entity.attributes },
      });
    });
    return Array.from(merged.values());
  }, [candidates]);

  const canonicalRelations = useMemo(() => {
    const approved = candidates.filter(
      (candidate) => candidate.type === 'relation' && candidate.status === 'approved' && candidate.relation
    );
    const relations = approved
      .map((candidate) => candidate.relation)
      .filter(
        (relation): relation is { source: string; relation: string; target: string } => Boolean(relation)
      );
    return relations;
  }, [candidates]);

  const minConfidence = useMemo(() => {
    const parsed = Number(confidenceMin);
    if (!Number.isFinite(parsed)) return 0;
    if (parsed > 1) return Math.min(parsed / 100, 1);
    return Math.max(parsed, 0);
  }, [confidenceMin]);

  const filteredCandidates = useMemo(() => {
    const text = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (tab === 1 && candidate.type !== 'entity') return false;
      if (tab === 2 && candidate.type !== 'relation') return false;
      if (tab === 3 && candidate.type !== 'attribute') return false;
      if (tab === 4 && candidate.type !== 'structure') return false;
      if (tab === 5 && candidate.type !== 'insight') return false;
      if (statusFilter !== 'all' && candidate.status !== statusFilter) return false;
      if (candidate.confidence < minConfidence) return false;
      if (!text) return true;
      const haystack = [
        candidate.name,
        candidate.relation?.source,
        candidate.relation?.relation,
        candidate.relation?.target,
        ...(candidate.aliases ?? []),
        ...(candidate.attributes ? Object.entries(candidate.attributes).flat() : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(text);
    });
  }, [candidates, minConfidence, search, statusFilter, tab]);

  const filteredOntologyDraftItems = useMemo(() => {
    const query = ontologyDraftSearch.trim().toLowerCase();
    if (!query) return ontologyDraftItems;
    return ontologyDraftItems.filter((item) => {
      const haystack = [
        item.name,
        item.description,
        ...(item.aliases ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [ontologyDraftItems, ontologyDraftSearch]);

  const ontologyDraftStats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    ontologyDraftItems.forEach((item) => {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    });
    return {
      total: ontologyDraftItems.length,
      byStatus,
      byKind,
    };
  }, [ontologyDraftItems]);

  const visibleOntologyDraftIds = useMemo(
    () => filteredOntologyDraftItems.map((item) => item.id),
    [filteredOntologyDraftItems]
  );
  const ontologyDraftSummary = useMemo(() => {
    const stats = draftOntology?.stats;
    return {
      total: stats?.total ?? ontologyDraftStats.total,
      byStatus: stats?.by_status ?? ontologyDraftStats.byStatus,
      byKind: stats?.by_kind ?? ontologyDraftStats.byKind,
    };
  }, [draftOntology, ontologyDraftStats]);

  const virtualWindow = useMemo(() => {
    const total = filteredCandidates.length;
    const visible = Math.ceil(candidateListHeight / CANDIDATE_ROW_HEIGHT);
    const start = Math.max(0, Math.floor(candidateScrollTop / CANDIDATE_ROW_HEIGHT) - CANDIDATE_OVERSCAN);
    const end = Math.min(total, start + visible + CANDIDATE_OVERSCAN * 2);
    return {
      total,
      start,
      end,
      paddingTop: start * CANDIDATE_ROW_HEIGHT,
      paddingBottom: Math.max(0, (total - end) * CANDIDATE_ROW_HEIGHT),
      items: filteredCandidates.slice(start, end),
    };
  }, [candidateListHeight, candidateScrollTop, filteredCandidates]);

  useEffect(() => {
    const totalHeight = filteredCandidates.length * CANDIDATE_ROW_HEIGHT;
    if (candidateScrollTop <= totalHeight) return;
    if (candidateListRef.current) {
      candidateListRef.current.scrollTop = 0;
    }
    setCandidateScrollTop(0);
  }, [candidateScrollTop, filteredCandidates.length]);

  const highlightTerms = useMemo(() => {
    const terms = new Set<string>();
    const query = search.trim();
    if (query) {
      terms.add(query);
    }
    if (selectedCandidate?.name) {
      terms.add(selectedCandidate.name);
    }
    return Array.from(terms).filter(Boolean);
  }, [search, selectedCandidate]);

  const selectedVisibleIds = useMemo(
    () => selectedIds.filter((id) => filteredCandidates.some((candidate) => candidate.id === id)),
    [filteredCandidates, selectedIds]
  );
  const allSelected =
    filteredCandidates.length > 0 &&
    filteredCandidates.every((candidate) => selectedIds.includes(candidate.id));
  const indeterminate = selectedVisibleIds.length > 0 && !allSelected;

  const parseOptionalInt = (value: string) => {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.trunc(parsed);
  };

  const handleLimitChange = (setter: React.Dispatch<React.SetStateAction<string>>) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      limitsTouchedRef.current = true;
      setter(event.target.value);
    };

  const markLimitsTouched = () => {
    limitsTouchedRef.current = true;
  };

  const handleDocumentInputChange = useCallback(
    (_: React.SyntheticEvent, value: string, reason: string) => {
      if (reason === 'reset' && !isSingleDocInsight) {
        setDocumentQuery('');
        return;
      }
      setDocumentQuery(value);
    },
    [isSingleDocInsight]
  );

  const handleDocumentListScroll = (event: React.SyntheticEvent) => {
    if (documentsLoading || !documentHasMore) return;
    const listboxNode = event.currentTarget as HTMLElement;
    const threshold = 40;
    if (listboxNode.scrollTop + listboxNode.clientHeight >= listboxNode.scrollHeight - threshold) {
      fetchDocumentOptions(documentQuery.trim(), documentOffset, true);
    }
  };

  const handleCandidateListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const nextTop = event.currentTarget.scrollTop;
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        setCandidateScrollTop(nextTop);
      });
    },
    []
  );

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => filteredCandidates.some((candidate) => candidate.id === id))
    );
    if (selectedId && !filteredCandidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredCandidates, selectedId]);

  const parseError = useCallback(
    (err: any, fallback: string) => err?.response?.data?.detail || err?.message || fallback,
    []
  );

  const fetchCandidates = useCallback(async () => {
    if (!kbId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await knowledgeBaseApi.getSemanticCandidates(kbId);
      const items = Array.isArray(response.data) ? response.data : [];
      const mapped: SemanticCandidate[] = items.map((item: any) => ({
        id: String(item.id),
        name: String(item.name || ''),
        type: item.type as CandidateType,
        status: item.status as CandidateStatus,
        confidence: Number(item.confidence || 0),
        aliases: Array.isArray(item.aliases) ? item.aliases : [],
        relation: item.relation || undefined,
        attributes: item.attributes || undefined,
        evidence: Array.isArray(item.evidence)
          ? item.evidence.map((e: any) => ({
              source: String(e.source || ''),
              snippet: String(e.snippet || ''),
              documentId: e.document_id !== undefined ? String(e.document_id) : undefined,
              chunkIndex: typeof e.chunk_index === 'number' ? e.chunk_index : undefined,
            }))
          : [],
      }));
      const mergeState: Record<string, { mode: 'existing' | 'new'; target: string; alias: boolean }> = {};
      items.forEach((item: any) => {
        if (item.merge_target) {
          mergeState[String(item.id)] = {
            mode: item.merge_mode === 'new' ? 'new' : 'existing',
            target: String(item.merge_target),
            alias: item.merge_alias !== false,
          };
        }
      });
      setCandidates(mapped);
      setMergeMap(mergeState);
    } catch (err: any) {
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.fetchError')));
    } finally {
      setLoading(false);
    }
  }, [kbId, parseError, t]);

  const fetchDiscoveryProgress = useCallback(async () => {
    if (!kbId) return null;
    try {
      const response = await knowledgeBaseApi.getSemanticDiscoveryProgress(kbId);
      const data = response.data as DiscoveryProgress;
      if (data && typeof data === 'object') {
        setDiscoveryProgress(data);
      }
      return data;
    } catch {
      return null;
    }
  }, [kbId]);

  const fetchOntologyDraftProgress = useCallback(async () => {
    if (!kbId) return null;
    try {
      const response = await knowledgeBaseApi.getOntologyDraftStatus(kbId);
      const data = response.data as OntologyDraftProgress;
      if (data && typeof data === 'object') {
        setOntologyDraftProgress(data);
      }
      return data;
    } catch {
      return null;
    }
  }, [kbId]);

  const fetchOntologyVersions = useCallback(async () => {
    if (!kbId) return;
    setOntologyVersionsLoading(true);
    try {
      const response = await knowledgeBaseApi.getOntologyVersions(kbId);
      const items = Array.isArray(response.data) ? response.data : [];
      setOntologyVersions(items as OntologyVersion[]);
    } catch (err: any) {
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.ontologyError')));
    } finally {
      setOntologyVersionsLoading(false);
    }
  }, [kbId, parseError, t]);

  const stopOntologyDraftPolling = useCallback(() => {
    if (ontologyDraftPollRef.current) {
      clearInterval(ontologyDraftPollRef.current);
      ontologyDraftPollRef.current = null;
    }
  }, []);

  const startOntologyDraftPolling = useCallback(() => {
    if (!kbId) return;
    if (ontologyDraftPollRef.current) return;
    fetchOntologyDraftProgress();
    ontologyDraftPollRef.current = window.setInterval(async () => {
      const data = await fetchOntologyDraftProgress();
      if (data && data.status !== 'running') {
        stopOntologyDraftPolling();
        fetchOntologyVersions();
      }
    }, 2000);
  }, [fetchOntologyDraftProgress, fetchOntologyVersions, kbId, stopOntologyDraftPolling]);

  const fetchOntologyDraftItems = useCallback(async () => {
    if (!kbId) return;
    setOntologyDraftLoading(true);
    try {
      const params = {
        status_filter: ontologyDraftStatusFilter === 'all' ? undefined : ontologyDraftStatusFilter,
        kind: ontologyDraftKindFilter === 'all' ? undefined : ontologyDraftKindFilter,
        version_id: ontologyDraftVersionId || undefined,
      };
      const response = await knowledgeBaseApi.getOntologyDraftItems(kbId, params);
      const items = Array.isArray(response.data) ? response.data : [];
      setOntologyDraftItems(items as OntologyItem[]);
      setOntologyDraftSelected([]);
    } catch (err: any) {
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.ontologyError')));
    } finally {
      setOntologyDraftLoading(false);
    }
  }, [
    kbId,
    ontologyDraftKindFilter,
    ontologyDraftStatusFilter,
    ontologyDraftVersionId,
    parseError,
    t,
  ]);

  const stopDiscoveryPolling = useCallback(() => {
    if (discoveryPollRef.current) {
      clearInterval(discoveryPollRef.current);
      discoveryPollRef.current = null;
    }
  }, []);

  const startDiscoveryPolling = useCallback(() => {
    if (!kbId) return;
    if (discoveryPollRef.current) return;
    fetchDiscoveryProgress();
    discoveryPollRef.current = window.setInterval(async () => {
      const data = await fetchDiscoveryProgress();
      if (data && data.status !== 'running') {
        stopDiscoveryPolling();
        if (data.status === 'completed') {
          fetchCandidates();
        }
      }
    }, 1500);
  }, [fetchCandidates, fetchDiscoveryProgress, kbId, stopDiscoveryPolling]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  useEffect(() => {
    fetchDiscoveryProgress();
  }, [fetchDiscoveryProgress]);

  useEffect(() => {
    fetchOntologyDraftProgress();
  }, [fetchOntologyDraftProgress]);

  useEffect(() => {
    fetchOntologyVersions();
  }, [fetchOntologyVersions]);

  useEffect(() => {
    if (discoveryProgress?.status === 'running' && !discoveryPollRef.current) {
      startDiscoveryPolling();
    }
  }, [discoveryProgress, startDiscoveryPolling]);

  useEffect(() => {
    if (ontologyDraftProgress?.status === 'running' && !ontologyDraftPollRef.current) {
      startOntologyDraftPolling();
    }
  }, [ontologyDraftProgress, startOntologyDraftPolling]);

  useEffect(() => {
    if (!ontologyDraftOpen) return;
    fetchOntologyDraftItems();
  }, [fetchOntologyDraftItems, ontologyDraftKindFilter, ontologyDraftOpen, ontologyDraftStatusFilter]);

  useEffect(() => {
    if (!discoveryProgress) return;
    if (discoveryProgress.status === 'running') return;
    localStorage.removeItem(SEMANTIC_DISCOVERY_TRACKER_KEY);
    window.dispatchEvent(new Event('semanticDiscoveryUpdated'));
  }, [discoveryProgress]);

  useEffect(
    () => () => {
      stopDiscoveryPolling();
    },
    [stopDiscoveryPolling]
  );

  useEffect(
    () => () => {
      stopOntologyDraftPolling();
    },
    [stopOntologyDraftPolling]
  );

  useEffect(() => {
    const loadDiscoveryDefaults = async () => {
      try {
        const config = await authApi.getUserConfig();
        if (limitsTouchedRef.current) return;
        setMaxChunks(
          toLimitString(
            (config as any)?.extraction_max_chunks,
            EXTRACTION_DEFAULT_MAX_CHUNKS,
            1,
            EXTRACTION_MAX_CHUNKS_LIMIT
          )
        );
        setMaxTextChars(
          toLimitString(
            (config as any)?.extraction_max_text_chars,
            EXTRACTION_DEFAULT_MAX_TEXT_CHARS,
            200,
            EXTRACTION_MAX_TEXT_CHARS_LIMIT
          )
        );
        setMaxItems(
          toLimitString(
            (config as any)?.extraction_max_items,
            EXTRACTION_DEFAULT_MAX_ITEMS,
            1,
            EXTRACTION_MAX_ITEMS_LIMIT
          )
        );
        setDocumentLimit(
          toLimitString(
            (config as any)?.extraction_document_limit,
            EXTRACTION_DEFAULT_DOCUMENT_LIMIT,
            1,
            EXTRACTION_MAX_DOCUMENT_LIMIT
          )
        );
        setAutoChunking(Boolean((config as any)?.extraction_auto_chunking));
        setChunkStrategy(
          toChunkStrategy((config as any)?.extraction_chunk_strategy, 'uniform')
        );
        setExtractionMode(
          toExtractionMode((config as any)?.extraction_mode, EXTRACTION_DEFAULT_MODE)
        );
        setProgressiveEnabled(Boolean((config as any)?.extraction_progressive_enabled));
        setProgressiveMinItems(
          toLimitString(
            (config as any)?.extraction_progressive_min_items,
            EXTRACTION_DEFAULT_PROGRESSIVE_MIN_ITEMS,
            1,
            EXTRACTION_MAX_PROGRESSIVE_ITEMS
          )
        );
        setProgressiveStep(
          toLimitString(
            (config as any)?.extraction_progressive_step,
            EXTRACTION_DEFAULT_PROGRESSIVE_STEP,
            1,
            EXTRACTION_MAX_PROGRESSIVE_STEP
          )
        );
        setSummaryMaxChars(
          toLimitString(
            (config as any)?.extraction_summary_max_chars,
            EXTRACTION_DEFAULT_SUMMARY_MAX_CHARS,
            200,
            EXTRACTION_MAX_SUMMARY_CHARS
          )
        );
        setEntityTypeWhitelist(String((config as any)?.extraction_entity_type_whitelist || ''));
        setRelationTypeWhitelist(
          String((config as any)?.extraction_relation_type_whitelist || '')
        );
      } catch (err) {
        // Ignore failures; fall back to built-in defaults.
      }
    };
    loadDiscoveryDefaults();
  }, []);

  useEffect(() => {
    if (discoveryMode !== 'insights') return;
    if (!scopeTouchedRef.current && scope === 'all') {
      setScope('recent');
    }
  }, [discoveryMode, scope]);

  useEffect(() => {
    if (discoveryMode !== 'insights') return;
    if (insightScope === 'document' && scope !== 'selected') {
      setScope('selected');
    }
  }, [discoveryMode, insightScope, scope]);

  useEffect(() => {
    if (!isSingleDocInsight) return;
    if (selectedDocuments.length <= 1) return;
    setSelectedDocuments((prev) => (prev.length > 0 ? [prev[0]] : []));
  }, [isSingleDocInsight, selectedDocuments.length]);

  const fetchDocumentOptions = useCallback(
    async (query: string, offset: number, append: boolean) => {
      if (!kbId) return;
      const requestId = ++documentRequestRef.current;
      setDocumentsLoading(true);
      try {
        const response = await documentApi.search(kbId, {
          q: query || undefined,
          offset,
          limit: DOCUMENT_SEARCH_PAGE_SIZE,
        });
        if (documentRequestRef.current !== requestId) return;
        const payload = response.data as { total?: number; items?: any[] };
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const total = Number.isFinite(payload?.total) ? Number(payload?.total) : offset + items.length;
        const mapped = items.map((item: any) => ({
          id: String(item.id),
          label: String(item.label || `doc-${item.id}`),
          status: item.status || undefined,
        }));
        setDocumentOptions((prev) => {
          const base = append ? [...prev, ...mapped] : mapped;
          return mergeDocumentOptions(base, selectedDocumentsRef.current);
        });
        const nextOffset = offset + mapped.length;
        setDocumentOffset(nextOffset);
        setDocumentHasMore(nextOffset < total);
      } catch {
        if (documentRequestRef.current !== requestId) return;
        if (!append) {
          setDocumentOptions(mergeDocumentOptions([], selectedDocumentsRef.current));
        }
        setDocumentHasMore(false);
      } finally {
        if (documentRequestRef.current === requestId) {
          setDocumentsLoading(false);
        }
      }
    },
    [kbId, mergeDocumentOptions]
  );

  useEffect(() => {
    if (!dialogOpen) return;
    setDocumentOptions([]);
    setDocumentOffset(0);
    setDocumentHasMore(true);
  }, [dialogOpen, kbId]);

  useEffect(() => {
    if (!dialogOpen || !kbId) return;
    if (!requiresSelection) return;
    if (documentSearchTimerRef.current) {
      clearTimeout(documentSearchTimerRef.current);
    }
    setDocumentOffset(0);
    setDocumentHasMore(true);
    const query = documentQuery.trim();
    documentSearchTimerRef.current = window.setTimeout(() => {
      fetchDocumentOptions(query, 0, false);
    }, 250);
    return () => {
      if (documentSearchTimerRef.current) {
        clearTimeout(documentSearchTimerRef.current);
        documentSearchTimerRef.current = null;
      }
    };
  }, [dialogOpen, documentQuery, fetchDocumentOptions, kbId, requiresSelection]);

  const requestDiscovery = async () => {
    if (!kbId) return;
    setDialogOpen(false);
    setQueuedAt(new Date().toLocaleString());
    const payload: {
      scope: string;
      include_relations: boolean;
      document_limit?: number;
      max_chunks?: number;
      max_text_chars?: number;
      max_items?: number;
      auto_chunking?: boolean;
      chunk_strategy?: ChunkStrategy;
      mode?: ExtractionMode;
      full_chunk_scan?: boolean;
      progressive_enabled?: boolean;
      progressive_min_items?: number;
      progressive_step?: number;
      summary_max_chars?: number;
      entity_types?: string[];
      relation_types?: string[];
      discovery_mode?: DiscoveryMode;
      insight_scope?: InsightScope;
      insight_domain?: string;
      document_ids?: number[];
      resume?: boolean;
    } = {
      scope,
      include_relations: includeRelations,
    };
    const includeLimits = limitsTouchedRef.current;
    const parsedMaxChunks = parseOptionalInt(maxChunks);
    const parsedMaxTextChars = parseOptionalInt(maxTextChars);
    const parsedMaxItems = parseOptionalInt(maxItems);
    const parsedDocumentLimit = parseOptionalInt(documentLimit);
    const parsedBatchSize = parseOptionalInt(batchSize);
    const parsedBatchConcurrency = parseOptionalInt(batchConcurrency);
    const parsedProgressiveMinItems = parseOptionalInt(progressiveMinItems);
    const parsedProgressiveStep = parseOptionalInt(progressiveStep);
    const parsedSummaryMaxChars = parseOptionalInt(summaryMaxChars);
    if (includeLimits) {
      if (parsedMaxChunks !== undefined) payload.max_chunks = parsedMaxChunks;
      if (parsedMaxTextChars !== undefined) payload.max_text_chars = parsedMaxTextChars;
      if (parsedMaxItems !== undefined) payload.max_items = parsedMaxItems;
      if (parsedDocumentLimit !== undefined) payload.document_limit = parsedDocumentLimit;
      if (parsedBatchSize !== undefined) payload.batch_size = parsedBatchSize;
      if (parsedBatchConcurrency !== undefined) payload.batch_concurrency = parsedBatchConcurrency;
      if (parsedProgressiveMinItems !== undefined) {
        payload.progressive_min_items = parsedProgressiveMinItems;
      }
      if (parsedProgressiveStep !== undefined) {
        payload.progressive_step = parsedProgressiveStep;
      }
      if (parsedSummaryMaxChars !== undefined) {
        payload.summary_max_chars = parsedSummaryMaxChars;
      }
      payload.auto_chunking = autoChunking;
      payload.chunk_strategy = chunkStrategy;
      payload.mode = extractionMode;
      payload.full_chunk_scan = fullChunkScan;
      payload.progressive_enabled = progressiveEnabled;
      payload.entity_types = parseTypeList(entityTypeWhitelist);
      payload.relation_types = parseTypeList(relationTypeWhitelist);
    }
    payload.discovery_mode = discoveryMode;
    if (discoveryMode === 'insights') {
      if (insightScope) {
        payload.insight_scope = insightScope;
      }
      payload.insight_domain = insightDomain;
    }
    payload.run_async = true;
    payload.resume = true;
    if (scope === 'selected' && selectedDocuments.length > 0) {
      payload.document_ids = selectedDocuments
        .map((doc) => Number(doc.id))
        .filter((id) => Number.isFinite(id));
    }
    try {
      localStorage.setItem(
        SEMANTIC_DISCOVERY_TRACKER_KEY,
        JSON.stringify({ kbId, kbName })
      );
      window.dispatchEvent(new Event('semanticDiscoveryUpdated'));
      startDiscoveryPolling();
      await knowledgeBaseApi.discoverSemanticCandidates(kbId, {
        ...payload,
      });
      await fetchDiscoveryProgress();
      if (discoveryMode === 'insights') {
        setTab(5);
      }
    } catch (err: any) {
      stopDiscoveryPolling();
      localStorage.removeItem(SEMANTIC_DISCOVERY_TRACKER_KEY);
      window.dispatchEvent(new Event('semanticDiscoveryUpdated'));
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.discoveryError')));
    }
  };

  const cancelDiscovery = async () => {
    if (!kbId || isCancellingDiscovery) return;
    setIsCancellingDiscovery(true);
    try {
      await knowledgeBaseApi.cancelSemanticDiscovery(kbId);
      await fetchDiscoveryProgress();
    } catch (err: any) {
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.discoveryError')));
    } finally {
      setIsCancellingDiscovery(false);
    }
  };

  const requestOntologyDraft = async () => {
    if (!kbId) return;
    try {
      startOntologyDraftPolling();
      await knowledgeBaseApi.createOntologyDraft(kbId, { run_async: true });
      await fetchOntologyDraftProgress();
      await fetchOntologyVersions();
    } catch (err: any) {
      stopOntologyDraftPolling();
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.ontologyError')));
    }
  };

  const publishOntologyDraft = async () => {
    if (!kbId) return;
    try {
      const payload: { version_id?: number; name?: string } = {};
      const name = ontologyPublishName.trim();
      if (ontologyDraftVersionId) {
        payload.version_id = ontologyDraftVersionId;
      }
      if (name) {
        payload.name = name;
      }
      await knowledgeBaseApi.publishOntology(kbId, payload);
      setOntologyPublishOpen(false);
      setOntologyPublishName('');
      setOntologyPublishError(null);
      await fetchOntologyDraftProgress();
      await fetchOntologyVersions();
    } catch (err: any) {
      setOntologyPublishError(parseError(err, t('knowledgeBase.semanticLayer.messages.ontologyError')));
    }
  };

  const applyOntologyDraftStatus = async (ids: number[], status: OntologyItemStatus) => {
    if (!kbId || ids.length === 0) return;
    try {
      await knowledgeBaseApi.updateOntologyDraftItemsStatus(kbId, { ids, status });
      await fetchOntologyDraftItems();
      await fetchOntologyVersions();
    } catch (err: any) {
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.updateError')));
    }
  };

  const openOntologyDraftEditor = (item?: OntologyItem) => {
    setOntologyDraftEditError(null);
    if (item) {
      setOntologyDraftEditItem(item);
      setOntologyDraftEditKind(item.kind);
      setOntologyDraftEditName(item.name);
      setOntologyDraftEditDescription(item.description || '');
      setOntologyDraftEditAliases((item.aliases || []).join(', '));
      setOntologyDraftEditConstraints(
        item.constraints && Object.keys(item.constraints).length > 0
          ? JSON.stringify(item.constraints, null, 2)
          : ''
      );
      setOntologyDraftEditStatus(item.status);
    } else {
      setOntologyDraftEditItem(null);
      setOntologyDraftEditKind('entity_type');
      setOntologyDraftEditName('');
      setOntologyDraftEditDescription('');
      setOntologyDraftEditAliases('');
      setOntologyDraftEditConstraints('');
      setOntologyDraftEditStatus('pending');
    }
    setOntologyDraftEditOpen(true);
  };

  const closeOntologyDraftEditor = () => {
    setOntologyDraftEditOpen(false);
    setOntologyDraftEditItem(null);
    setOntologyDraftEditError(null);
  };

  const saveOntologyDraftItem = async () => {
    if (!kbId) return;
    const name = ontologyDraftEditName.trim();
    if (!name) {
      setOntologyDraftEditError(t('knowledgeBase.semanticLayer.ontology.dialog.nameRequired'));
      return;
    }
    let constraints: Record<string, any> = {};
    const constraintsRaw = ontologyDraftEditConstraints.trim();
    if (constraintsRaw) {
      try {
        const parsed = JSON.parse(constraintsRaw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setOntologyDraftEditError(t('knowledgeBase.semanticLayer.ontology.dialog.invalidJson'));
          return;
        }
        constraints = parsed;
      } catch {
        setOntologyDraftEditError(t('knowledgeBase.semanticLayer.ontology.dialog.invalidJson'));
        return;
      }
    }
    const aliases = parseTypeList(ontologyDraftEditAliases);
    const description = ontologyDraftEditDescription.trim();
    try {
      if (ontologyDraftEditItem) {
        await knowledgeBaseApi.updateOntologyDraftItem(kbId, ontologyDraftEditItem.id, {
          name,
          description,
          aliases,
          constraints,
          status: ontologyDraftEditStatus,
        });
      } else {
        await knowledgeBaseApi.createOntologyDraftItem(kbId, {
          kind: ontologyDraftEditKind,
          name,
          description,
          aliases,
          constraints,
          status: ontologyDraftEditStatus,
        });
      }
      setOntologyDraftEditOpen(false);
      setOntologyDraftEditItem(null);
      await fetchOntologyDraftItems();
      await fetchOntologyVersions();
    } catch (err: any) {
      setOntologyDraftEditError(parseError(err, t('knowledgeBase.semanticLayer.messages.ontologyError')));
    }
  };

  const reviewCandidates = () => {
    if (candidates.length === 0) return;
    setTab(0);
    setSelectedId(candidates[0].id);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !filteredCandidates.some((candidate) => candidate.id === id))
      );
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredCandidates.forEach((candidate) => next.add(candidate.id));
      return Array.from(next);
    });
  };

  const toggleOntologyDraftSelection = (id: number) => {
    setOntologyDraftSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleOntologyDraftSelectAll = () => {
    if (visibleOntologyDraftIds.length === 0) return;
    const allSelectedVisible = visibleOntologyDraftIds.every((id) =>
      ontologyDraftSelected.includes(id)
    );
    if (allSelectedVisible) {
      setOntologyDraftSelected((prev) =>
        prev.filter((id) => !visibleOntologyDraftIds.includes(id))
      );
      return;
    }
    setOntologyDraftSelected((prev) => Array.from(new Set([...prev, ...visibleOntologyDraftIds])));
  };

  const toggleOntologyDraftExpanded = (id: number) => {
    setOntologyDraftExpanded((prev) => (prev === id ? null : id));
  };

  const applyStatusLocal = (ids: string[], status: CandidateStatus) => {
    setCandidates((prev) =>
      prev.map((candidate) => (ids.includes(candidate.id) ? { ...candidate, status } : candidate))
    );
  };

  const applyStatus = async (ids: string[], status: CandidateStatus) => {
    if (ids.length === 0) return;
    const snapshot = candidates;
    applyStatusLocal(ids, status);
    if (!kbId) return;
    const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (numericIds.length === 0) return;
    try {
      await knowledgeBaseApi.updateSemanticCandidateStatus(kbId, { ids: numericIds, status });
    } catch (err: any) {
      setCandidates(snapshot);
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.updateError')));
    }
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setConfidenceMin('0.6');
    setTab(0);
  };

  const openMergeDialog = () => {
    if (!selectedCandidate) return;
    const existing = mergeMap[selectedCandidate.id];
    setMergeMode(existing?.mode ?? 'existing');
    setMergeTarget(existing?.target ?? selectedCandidate.name);
    setMergeAlias(existing?.alias ?? true);
    setMergeError(null);
    setMergeDialogOpen(true);
  };

  const confirmMerge = () => {
    if (!selectedCandidate) return;
    if (!kbId) {
      setMergeError(t('knowledgeBase.semanticLayer.messages.mergeError'));
      return;
    }
    const target = mergeTarget.trim();
    if (!target) {
      setMergeError(t('knowledgeBase.semanticLayer.merge.error'));
      return;
    }
    const targetEntity = getEntityByName(target);
    const aliasDuplicate =
      mergeMode === 'existing' &&
      mergeAlias &&
      targetEntity &&
      (normalize(target) === normalize(selectedCandidate.name) ||
        targetEntity.aliases.some((alias) => normalize(alias) === normalize(selectedCandidate.name)));
    const aliasApplied = mergeAlias && !aliasDuplicate && mergeMode === 'existing';
    const candidateId = Number(selectedCandidate.id);
    if (!Number.isFinite(candidateId)) {
      setMergeError(t('knowledgeBase.semanticLayer.merge.error'));
      return;
    }
    knowledgeBaseApi
      .mergeSemanticCandidate(kbId, candidateId, {
        mode: mergeMode,
        target,
        alias: aliasApplied,
      })
      .then(() => {
        setMergeMap((prev) => ({
          ...prev,
          [selectedCandidate.id]: { mode: mergeMode, target, alias: aliasApplied },
        }));
        applyStatusLocal([selectedCandidate.id], 'approved');
        setMergeDialogOpen(false);
        setMergeNotice(
          aliasDuplicate
            ? t('knowledgeBase.semanticLayer.merge.noticeAliasSkipped', {
                name: selectedCandidate.name,
                target,
              })
            : t('knowledgeBase.semanticLayer.merge.notice', {
                name: selectedCandidate.name,
                target,
              })
        );
      })
      .catch((err: any) => {
        setMergeError(parseError(err, t('knowledgeBase.semanticLayer.messages.mergeError')));
      });
  };

  const jumpToEvidence = (item: SemanticEvidence) => {
    if (!item.documentId || !kbId) {
      setJumpNotice(t('knowledgeBase.semanticLayer.evidence.unavailable'));
      return;
    }
    const params = new URLSearchParams();
    params.set('kbId', kbId);
    params.set('docId', item.documentId);
    if (typeof item.chunkIndex === 'number') {
      params.set('chunk', String(item.chunkIndex));
    }
    if (selectedCandidate?.name) {
      params.set('terms', selectedCandidate.name);
    }
    params.set('open', 'chunks');
    navigate(`/documents?${params.toString()}`);
  };

  const statusLabel = (status: CandidateStatus) => {
    switch (status) {
      case 'approved':
        return t('knowledgeBase.semanticLayer.status.approved');
      case 'rejected':
        return t('knowledgeBase.semanticLayer.status.rejected');
      default:
        return t('knowledgeBase.semanticLayer.status.pending');
    }
  };

  const typeLabel = (type: CandidateType) => {
    switch (type) {
      case 'relation':
        return t('knowledgeBase.semanticLayer.types.relation');
      case 'attribute':
        return t('knowledgeBase.semanticLayer.types.attribute');
      case 'structure':
        return t('knowledgeBase.semanticLayer.types.structure');
      case 'insight':
        return t('knowledgeBase.semanticLayer.types.insight');
      default:
        return t('knowledgeBase.semanticLayer.types.entity');
    }
  };

  const ontologyKindLabel = (kind: OntologyItemKind) => {
    switch (kind) {
      case 'relation_type':
        return t('knowledgeBase.semanticLayer.types.relation');
      case 'attribute_type':
        return t('knowledgeBase.semanticLayer.types.attribute');
      case 'structure_type':
        return t('knowledgeBase.semanticLayer.types.structure');
      default:
        return t('knowledgeBase.semanticLayer.types.entity');
    }
  };

  const ontologyVersionStatusLabel = (status: OntologyVersion['status']) => {
    switch (status) {
      case 'active':
        return t('knowledgeBase.semanticLayer.ontology.versionStatus.active');
      case 'archived':
        return t('knowledgeBase.semanticLayer.ontology.versionStatus.archived');
      default:
        return t('knowledgeBase.semanticLayer.ontology.versionStatus.draft');
    }
  };

  const ontologyVersionStatusColor = (status: OntologyVersion['status']) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'draft':
        return 'warning';
      default:
        return 'default';
    }
  };

  const ontologySourceLabel = (source?: string) => {
    if (source === 'auto') return t('knowledgeBase.semanticLayer.ontology.source.auto');
    if (source === 'manual') return t('knowledgeBase.semanticLayer.ontology.source.manual');
    if (source === 'import') return t('knowledgeBase.semanticLayer.ontology.source.import');
    return t('knowledgeBase.semanticLayer.ontology.source.unknown');
  };

  const insightScopeLabel = (scope?: string) => {
    if (!scope) return '';
    if (scope === 'document') {
      return t('knowledgeBase.semanticLayer.discoveryDialog.insightScopeDocument');
    }
    if (scope === 'cross') {
      return t('knowledgeBase.semanticLayer.discoveryDialog.insightScopeCross');
    }
    return scope;
  };

  const statusColor = (status: CandidateStatus) => {
    switch (status) {
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      default:
        return 'warning';
    }
  };


  const selectedCount = selectedIds.length;
  const ontologyDraftSelectedCount = ontologyDraftSelected.length;
  const ontologyDraftAllSelected =
    visibleOntologyDraftIds.length > 0 &&
    visibleOntologyDraftIds.every((id) => ontologyDraftSelected.includes(id));
  const selectedMerge = selectedCandidate ? mergeMap[selectedCandidate.id] : null;
  const mergeSuggestions = useMemo(
    () => canonicalEntities.map((entity) => entity.name),
    [canonicalEntities]
  );
  const candidateConflicts = selectedCandidate ? getCandidateConflicts(selectedCandidate) : [];
  const canSubmitDiscovery = !requiresSelection
    ? !isInsightMode || Boolean(insightScope)
    : isSingleDocInsight
      ? selectedDocuments.length === 1
      : selectedDocuments.length > 0;
  const mergeConflicts = useMemo(() => {
    if (!selectedCandidate) return [];
    const conflicts: string[] = [];
    const target = mergeTarget.trim();
    if (mergeMode === 'existing') {
      const targetEntity = getEntityByName(target);
      if (targetEntity) {
        if (normalize(target) === normalize(selectedCandidate.name)) {
          conflicts.push(t('knowledgeBase.semanticLayer.conflicts.aliasSame'));
        }
        if (
          mergeAlias &&
          targetEntity.aliases.some((alias) => normalize(alias) === normalize(selectedCandidate.name))
        ) {
          conflicts.push(t('knowledgeBase.semanticLayer.conflicts.aliasExists'));
        }
        if (selectedCandidate.type === 'attribute') {
          const attributeKey = getAttributeKey(selectedCandidate);
          const attributeValue = getAttributeValue(selectedCandidate);
          if (attributeKey && targetEntity.attributes[attributeKey]) {
            const existing = targetEntity.attributes[attributeKey];
            if (attributeValue && existing !== attributeValue) {
              conflicts.push(
                t('knowledgeBase.semanticLayer.conflicts.attributeConflict', {
                  key: attributeKey,
                  existing: String(existing),
                })
              );
            }
          }
        }
      } else if (target) {
        conflicts.push(t('knowledgeBase.semanticLayer.conflicts.targetMissing'));
      }
    }
    if (selectedCandidate.type === 'relation' && relationExists(selectedCandidate.relation)) {
      conflicts.push(t('knowledgeBase.semanticLayer.conflicts.relationExists'));
    }
    if (selectedCandidate.type === 'entity' && mergeMode === 'new') {
      const exists = canonicalEntities.some(
        (entity) => normalize(entity.name) === normalize(target) && normalize(target) !== normalize(selectedCandidate.name)
      );
      if (exists) {
        conflicts.push(t('knowledgeBase.semanticLayer.conflicts.nameCollision'));
      }
    }
    return conflicts;
  }, [
    canonicalEntities,
    canonicalRelations,
    mergeAlias,
    mergeMode,
    mergeTarget,
    selectedCandidate,
    t,
  ]);

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const resetGraphView = useCallback(() => {
    const graph = graphDialogRef.current;
    if (!graph) return;
    graph.zoomToFit?.(400, 60);
  }, []);
  const zoomGraph = useCallback((factor: number) => {
    const graph = graphDialogRef.current;
    if (!graph) return;
    const camera = graph.camera();
    const controls = graph.controls();
    if (!camera) return;
    const target = controls?.target || { x: 0, y: 0, z: 0 };
    const dx = camera.position.x - target.x;
    const dy = camera.position.y - target.y;
    const dz = camera.position.z - target.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const nextDistance = clamp(distance / factor, GRAPH_MIN_DISTANCE, GRAPH_MAX_DISTANCE);
    const ratio = nextDistance / distance;
    graph.cameraPosition(
      {
        x: target.x + dx * ratio,
        y: target.y + dy * ratio,
        z: target.z + dz * ratio,
      },
      target,
      200
    );
  }, []);
  const showAllGraph = useCallback(() => {
    setGraphLimitEnabled(false);
    setGraphStructureLevel('0');
    setGraphLabelMode('show');
  }, []);

  function getEntityByName(name?: string | null) {
    if (!name) return null;
    const key = normalize(name);
    return canonicalEntities.find((entity) => normalize(entity.name) === key) || null;
  }

  function relationKey(relation?: { source: string; relation: string; target: string } | undefined) {
    if (!relation) return '';
    return `${normalize(relation.source)}|${normalize(relation.relation)}|${normalize(relation.target)}`;
  }

  function relationExists(relation?: { source: string; relation: string; target: string } | undefined) {
    if (!relation) return false;
    const key = relationKey(relation);
    return canonicalRelations.some((item) => relationKey(item) === key);
  }

  function getCandidateConflicts(candidate: SemanticCandidate) {
    const conflicts: string[] = [];
    if (candidate.type === 'insight') {
      return conflicts;
    }
    if (candidate.type === 'entity') {
      const exists = canonicalEntities.some(
        (entity) =>
          normalize(entity.name) === normalize(candidate.name) ||
          entity.aliases.some((alias) => normalize(alias) === normalize(candidate.name))
      );
      if (exists) {
        conflicts.push(t('knowledgeBase.semanticLayer.conflicts.entityExists'));
      }
    }
    if (candidate.type === 'relation' && relationExists(candidate.relation)) {
      conflicts.push(t('knowledgeBase.semanticLayer.conflicts.relationExists'));
    }
    if (candidate.type === 'attribute') {
      const entityName = getAttributeEntity(candidate);
      const attributeKey = getAttributeKey(candidate);
      const attributeValue = getAttributeValue(candidate);
      const entity = getEntityByName(entityName);
      if (entity && attributeKey) {
        const existingValue = entity.attributes[attributeKey];
        if (existingValue && attributeValue && existingValue !== attributeValue) {
          conflicts.push(
            t('knowledgeBase.semanticLayer.conflicts.attributeConflict', {
              key: attributeKey,
              existing: String(existingValue),
            })
          );
        } else if (existingValue) {
          conflicts.push(t('knowledgeBase.semanticLayer.conflicts.attributeExists', { key: attributeKey }));
        }
      }
    }
    return conflicts;
  }

  const highlightText = (text: string, terms: string[]) => {
    const cleaned = terms.map((term) => term.trim()).filter(Boolean);
    if (cleaned.length === 0) return text;
    const escaped = cleaned.map(escapeRegExp);
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(regex);
    const lowerTerms = cleaned.map((term) => term.toLowerCase());
    return parts.map((part, index) => {
      const isMatch = lowerTerms.includes(part.toLowerCase());
      if (!isMatch) return part;
      return (
        <Box
          key={`${part}-${index}`}
          component="span"
          sx={{
            backgroundColor: 'rgba(255, 213, 79, 0.3)',
            borderRadius: 0.5,
            px: 0.4,
          }}
        >
          {part}
        </Box>
      );
    });
  };

  const graphData = useMemo(() => {
    type NodeDraft = {
      key: string;
      id: string;
      label: string;
      status: CandidateStatus;
      kind: GraphNodeKind;
      candidateId?: string;
      parentId?: string;
      structureLevel?: number;
    };
    type AttributeDraft = {
      id: string;
      label: string;
      status: CandidateStatus;
      candidateId: string;
      entityKey: string;
    };

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const entityMap = new Map<string, NodeDraft>();
    const docMap = new Map<string, { id: string; label: string; count: number; itemKeys: Set<string> }>();
    const attributeDrafts: AttributeDraft[] = [];
    const graphCandidates = filteredCandidates.filter((candidate) => candidate.type !== 'insight');
    const getStructureLabel = (candidate: SemanticCandidate) =>
      String(candidate.attributes?.title || '').trim() ||
      extractStructureLabel(candidate.name) ||
      candidate.name;
    const getStructureDocLabel = (candidate: SemanticCandidate) =>
      String(candidate.attributes?.doc || '').trim() || extractDocLabel(candidate.name);
    const getStructureLevel = (candidate: SemanticCandidate) =>
      coerceStructureLevel(candidate.attributes?.level);

    const ensureDocNode = (docLabel: string, itemKey?: string) => {
      const trimmed = docLabel.trim();
      if (!trimmed) return undefined;
      const key = normalize(trimmed);
      const normalizedItemKey = itemKey ? normalize(itemKey) : '';
      const existing = docMap.get(key);
      if (existing) {
        if (normalizedItemKey && !existing.itemKeys.has(normalizedItemKey)) {
          existing.itemKeys.add(normalizedItemKey);
          existing.count += 1;
        }
        return existing.id;
      }
      const id = `document:${key}`;
      const itemKeys = new Set<string>();
      let count = 0;
      if (normalizedItemKey) {
        itemKeys.add(normalizedItemKey);
        count = 1;
      }
      docMap.set(key, {
        id,
        label: trimmed,
        count,
        itemKeys,
      });
      return id;
    };

    const ensureNode = (
      name: string,
      status: CandidateStatus,
      kind: GraphNodeKind = 'entity',
      candidateId?: string,
      labelOverride?: string,
      parentId?: string,
      structureLevel?: number
    ) => {
      const key = normalize(name);
      if (!key) return;
      const existing = entityMap.get(key);
      if (!existing) {
        entityMap.set(key, {
          key,
          id: `${kind}:${key}`,
          label: labelOverride || name,
          status,
          kind,
          candidateId,
          parentId,
          structureLevel,
        });
        return;
      }
      const nextKind = existing.kind === 'structure' ? 'structure' : kind;
      const nextId = existing.kind === nextKind ? existing.id : `${nextKind}:${key}`;
      const nextStatus =
        STATUS_PRIORITY[status] > STATUS_PRIORITY[existing.status] ? status : existing.status;
      const nextStructureLevel =
        existing.structureLevel !== undefined && structureLevel !== undefined
          ? Math.min(existing.structureLevel, structureLevel)
          : existing.structureLevel ?? structureLevel;
      entityMap.set(key, {
        ...existing,
        id: nextId,
        status: nextStatus,
        kind: nextKind,
        candidateId: existing.candidateId ?? candidateId,
        label: labelOverride || existing.label,
        parentId: existing.parentId ?? parentId,
        structureLevel: nextStructureLevel,
      });
    };

    graphCandidates.forEach((candidate) => {
      if (candidate.type === 'entity') {
        ensureNode(candidate.name, candidate.status, 'entity', candidate.id);
      }
      if (candidate.type === 'structure') {
        let parentId: string | undefined;
        if (graphGroupStructuresByDoc) {
          parentId = ensureDocNode(getStructureDocLabel(candidate), candidate.name);
        }
        ensureNode(
          candidate.name,
          candidate.status,
          'structure',
          candidate.id,
          getStructureLabel(candidate),
          parentId,
          getStructureLevel(candidate)
        );
      }
    });

    graphCandidates.forEach((candidate) => {
      if (candidate.type === 'relation' && candidate.relation) {
        const isStructureRelation = candidate.attributes?.relation_kind === 'structure';
        const sourceLabel = isStructureRelation
          ? extractStructureLabel(candidate.relation.source)
          : undefined;
        const targetLabel = isStructureRelation
          ? extractStructureLabel(candidate.relation.target)
          : undefined;
        const sourceDoc = isStructureRelation ? extractDocLabel(candidate.relation.source) : '';
        const targetDoc = isStructureRelation ? extractDocLabel(candidate.relation.target) : '';
        ensureNode(
          candidate.relation.source,
          candidate.status,
          isStructureRelation ? 'structure' : 'entity',
          undefined,
          sourceLabel,
          graphGroupStructuresByDoc ? ensureDocNode(sourceDoc, candidate.relation.source) : undefined
        );
        ensureNode(
          candidate.relation.target,
          candidate.status,
          isStructureRelation ? 'structure' : 'entity',
          undefined,
          targetLabel,
          graphGroupStructuresByDoc ? ensureDocNode(targetDoc, candidate.relation.target) : undefined
        );
      }
      if (candidate.type === 'attribute') {
        const entityName = getAttributeEntity(candidate);
        if (!entityName) return;
        ensureNode(entityName, candidate.status);
        const attrKey = getAttributeKey(candidate);
        const attrValue = getAttributeValue(candidate);
        const label = attrKey ? `${attrKey}${attrValue ? `: ${attrValue}` : ''}` : candidate.name;
        attributeDrafts.push({
          id: `attribute:${candidate.id}`,
          label,
          status: candidate.status,
          candidateId: candidate.id,
          entityKey: normalize(entityName),
        });
      }
    });

    const entityNodes = new Map<string, GraphNode>();
    if (graphGroupStructuresByDoc) {
      docMap.forEach((doc) => {
        nodes.push({
          id: doc.id,
          label: `${doc.label}${doc.count > 0 ? ` (${doc.count})` : ''}`,
          kind: 'document',
          status: 'approved',
        });
      });
    }
    const entities = Array.from(entityMap.values());
    entities.forEach((entity) => {
      const node: GraphNode = {
        id: entity.id,
        label: entity.label,
        kind: entity.kind,
        status: entity.status,
        candidateId: entity.candidateId,
        parentId: entity.parentId,
        structureLevel: entity.structureLevel,
      };
      nodes.push(node);
      entityNodes.set(entity.key, node);
    });

    const attributesByEntity = new Map<string, AttributeDraft[]>();
    attributeDrafts.forEach((draft) => {
      if (!entityNodes.has(draft.entityKey)) return;
      const list = attributesByEntity.get(draft.entityKey) ?? [];
      list.push(draft);
      attributesByEntity.set(draft.entityKey, list);
    });

    attributesByEntity.forEach((attrs, entityKey) => {
      const base = entityNodes.get(entityKey);
      if (!base) return;
      attrs.forEach((attr) => {
        nodes.push({
          id: attr.id,
          label: attr.label,
          kind: 'attribute',
          status: attr.status,
          candidateId: attr.candidateId,
        });
        edges.push({
          id: `attribute-edge:${attr.candidateId}`,
          from: base.id,
          to: attr.id,
          kind: 'attribute',
          status: attr.status,
          candidateId: attr.candidateId,
        });
      });
    });

    graphCandidates.forEach((candidate) => {
      if (candidate.type !== 'relation' || !candidate.relation) return;
      const isStructureRelation = candidate.attributes?.relation_kind === 'structure';
      const sourceKey = normalize(candidate.relation.source);
      const targetKey = normalize(candidate.relation.target);
      const source = entityNodes.get(sourceKey);
      const target = entityNodes.get(targetKey);
      if (!source || !target) return;
      edges.push({
        id: `relation:${candidate.id}`,
        from: source.id,
        to: target.id,
        kind: 'relation',
        status: candidate.status,
        label: isStructureRelation ? '' : candidate.relation.relation,
        candidateId: candidate.id,
        relationKind: isStructureRelation ? 'structure' : undefined,
      });
    });

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    return { nodes, edges, nodeMap };
  }, [filteredCandidates, graphGroupStructuresByDoc]);

  const maxStructureLevel = useMemo(() => {
    let maxLevel = 1;
    graphData.nodes.forEach((node) => {
      if (node.kind === 'structure' && node.structureLevel) {
        maxLevel = Math.max(maxLevel, node.structureLevel);
      }
    });
    return maxLevel;
  }, [graphData.nodes]);

  const parsedGraphStructureLevel = parseOptionalInt(graphStructureLevel);
  const graphStructureLevelLimit =
    parsedGraphStructureLevel && parsedGraphStructureLevel > 0
      ? Math.min(Math.max(parsedGraphStructureLevel, 1), Math.max(1, maxStructureLevel))
      : 0;
  const parsedGraphMaxNodes = parseOptionalInt(graphMaxNodes);
  const graphNodeLimit = graphLimitEnabled
    ? Math.min(
        Math.max(parsedGraphMaxNodes ?? GRAPH_DEFAULT_NODE_LIMIT, GRAPH_MIN_NODE_LIMIT),
        GRAPH_MAX_NODE_LIMIT
      )
    : 0;
  const graphShowStructuresEffective = graphMode === 'structure' ? true : graphShowStructures;
  const graphShowAttributesEffective = graphMode === 'structure' ? false : graphShowAttributes;

  const selectedGraphNodeId = useMemo(() => {
    if (!selectedCandidate) return null;
    if (selectedCandidate.type === 'entity') {
      return `entity:${normalize(selectedCandidate.name)}`;
    }
    if (selectedCandidate.type === 'structure') {
      return `structure:${normalize(selectedCandidate.name)}`;
    }
    if (selectedCandidate.type === 'attribute') {
      return `attribute:${selectedCandidate.id}`;
    }
    return null;
  }, [selectedCandidate]);

  const selectedGraphEdgeId = useMemo(() => {
    if (!selectedCandidate) return null;
    if (selectedCandidate.type === 'relation') {
      return `relation:${selectedCandidate.id}`;
    }
    if (selectedCandidate.type === 'attribute') {
      return `attribute-edge:${selectedCandidate.id}`;
    }
    return null;
  }, [selectedCandidate]);

  const graphView = useMemo(() => {
    let nodes = [...graphData.nodes];
    let edges = [...graphData.edges];

    if (graphMode === 'structure') {
      nodes = nodes.filter((node) => node.kind === 'structure' || node.kind === 'document');
      edges = edges.filter((edge) => edge.relationKind === 'structure');
    }

    if (!graphShowRelations) {
      edges = edges.filter((edge) => edge.kind !== 'relation');
    }
    if (!graphShowAttributesEffective) {
      edges = edges.filter((edge) => edge.kind !== 'attribute');
      nodes = nodes.filter((node) => node.kind !== 'attribute');
    }
    if (!graphShowStructuresEffective) {
      nodes = nodes.filter((node) => node.kind !== 'structure' && node.kind !== 'document');
      edges = edges.filter((edge) => edge.relationKind !== 'structure');
    } else if (graphCollapseDocuments && graphGroupStructuresByDoc) {
      nodes = nodes.filter((node) => node.kind !== 'structure');
      edges = edges.filter((edge) => edge.relationKind !== 'structure');
    }

    if (graphStructureLevelLimit > 0) {
      nodes = nodes.filter((node) => {
        if (node.kind !== 'structure') return true;
        const level = node.structureLevel ?? 1;
        return level <= graphStructureLevelLimit;
      });
    }

    if (graphNodeLimit > 0 && nodes.length > graphNodeLimit) {
      const kindPriority: Record<GraphNodeKind, number> = {
        document: 0,
        structure: 1,
        entity: 2,
        attribute: 3,
      };
      const selectedNode = selectedGraphNodeId
        ? nodes.find((node) => node.id === selectedGraphNodeId)
        : undefined;
      const docNodes = nodes.filter((node) => node.kind === 'document');
      const reservedIds = new Set(docNodes.map((node) => node.id));
      const pinnedNodes = [...docNodes];
      if (selectedNode && !reservedIds.has(selectedNode.id)) {
        reservedIds.add(selectedNode.id);
        pinnedNodes.push(selectedNode);
      }
      const remaining = graphNodeLimit - pinnedNodes.length;
      const sortableNodes = nodes.filter((node) => !reservedIds.has(node.id));
      sortableNodes.sort((a, b) => {
        const kindDelta = kindPriority[a.kind] - kindPriority[b.kind];
        if (kindDelta !== 0) return kindDelta;
        const levelA = a.kind === 'structure' ? a.structureLevel ?? 1 : 99;
        const levelB = b.kind === 'structure' ? b.structureLevel ?? 1 : 99;
        if (levelA !== levelB) return levelA - levelB;
        const statusDelta = STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
        if (statusDelta !== 0) return statusDelta;
        return a.label.localeCompare(b.label);
      });
      const kept = remaining > 0 ? sortableNodes.slice(0, remaining) : [];
      nodes = [...pinnedNodes, ...kept];
    }

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    edges = edges.filter((edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to));

    if (graphFocusSelection && (selectedGraphNodeId || selectedGraphEdgeId)) {
      const focusNodes = new Set<string>();
      const focusEdges = new Set<string>();

      if (selectedGraphEdgeId) {
        const edge = edges.find((item) => item.id === selectedGraphEdgeId);
        if (edge) {
          focusEdges.add(edge.id);
          focusNodes.add(edge.from);
          focusNodes.add(edge.to);
        }
      }

      if (selectedGraphNodeId) {
        focusNodes.add(selectedGraphNodeId);
        edges.forEach((edge) => {
          if (edge.from === selectedGraphNodeId || edge.to === selectedGraphNodeId) {
            focusEdges.add(edge.id);
            focusNodes.add(edge.from);
            focusNodes.add(edge.to);
          }
        });
      }

      const filteredNodes = nodes.filter((node) => focusNodes.has(node.id));
      const filteredNodeMap = new Map(filteredNodes.map((node) => [node.id, node]));
      const filteredEdges = edges.filter(
        (edge) => focusEdges.has(edge.id) && filteredNodeMap.has(edge.from) && filteredNodeMap.has(edge.to)
      );
      return {
        nodes: filteredNodes,
        edges: filteredEdges,
        nodeMap: filteredNodeMap,
      };
    }

    return { nodes, edges, nodeMap };
  }, [
    graphData.edges,
    graphData.nodes,
    graphMode,
    graphShowRelations,
    graphShowAttributes,
    graphShowStructures,
    graphShowAttributesEffective,
    graphShowStructuresEffective,
    graphStructureLevelLimit,
    graphNodeLimit,
    graphGroupStructuresByDoc,
    graphCollapseDocuments,
    graphFocusSelection,
    selectedGraphEdgeId,
    selectedGraphNodeId,
  ]);

  const graphViewMeta = useMemo(() => {
    const totalNodes = graphData.nodes.length;
    const totalEdges = graphData.edges.length;
    const visibleNodes = graphView.nodes.length;
    const visibleEdges = graphView.edges.length;
    return {
      totalNodes,
      totalEdges,
      visibleNodes,
      visibleEdges,
      prunedNodes: Math.max(0, totalNodes - visibleNodes),
      prunedEdges: Math.max(0, totalEdges - visibleEdges),
    };
  }, [graphData.edges.length, graphData.nodes.length, graphView.edges.length, graphView.nodes.length]);

  const graphLabelEnabled = useMemo(() => {
    if (graphLabelMode === 'show') return true;
    if (graphLabelMode === 'hide') return false;
    return graphView.nodes.length <= GRAPH_LABEL_AUTO_THRESHOLD;
  }, [graphLabelMode, graphView.nodes.length]);

  const handlePreviewGraph = useCallback((graph: ForceGraphMethods) => {
    graphPreviewRef.current = graph;
  }, []);

  const handleDialogGraph = useCallback((graph: ForceGraphMethods) => {
    graphDialogRef.current = graph;
  }, []);

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <SemanticIcon sx={{ color: 'primary.main' }} />
            {t('knowledgeBase.semanticLayer.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('knowledgeBase.semanticLayer.kbLabel')}: {kbName}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('knowledgeBase.semanticLayer.description')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<AutoAwesomeIcon />} onClick={() => setDialogOpen(true)}>
            {t('knowledgeBase.semanticLayer.actions.startDiscovery')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<ReviewIcon />}
            disabled={!hasCandidates}
            onClick={reviewCandidates}
          >
            {t('knowledgeBase.semanticLayer.actions.review')}
          </Button>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/knowledge-bases')}>
            {t('common.back')}
          </Button>
        </Stack>
      </Box>

      {queuedAt && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('knowledgeBase.semanticLayer.queued', { time: queuedAt })}
        </Alert>
      )}
      {discoveryStatus === 'running' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Stack spacing={1}>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {hasChunkTotals
                ? discoveryOverallChunkLabel
                : hasChunkProgress
                  ? discoveryChunkLabel
                  : discoveryDocProgressLabel}
            </Typography>
            {hasChunkTotals && hasChunkProgress && (
              <Typography variant="caption" color="text.secondary">
                {discoveryChunkLabel}
              </Typography>
            )}
            {hasChunkProgress && (
              <Typography variant="caption" color="text.secondary">
                {discoveryDocProgressLabel}
              </Typography>
            )}
            {!hasChunkProgress && discoveryDocLabelText && (
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                {discoveryDocLabelText}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {t('knowledgeBase.semanticLayer.progress.backgroundNote')}
            </Typography>
            {discoveryCancelRequested && discoveryProgress?.message && (
              <Typography variant="caption" color="warning.main">
                {discoveryProgress.message}
              </Typography>
            )}
            <LinearProgress
              variant={hasChunkTotals || hasChunkProgress || discoveryTotal > 0 ? 'determinate' : 'indeterminate'}
              value={discoveryPercent}
            />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button
                size="small"
                color="error"
                variant="outlined"
                disabled={isCancellingDiscovery || discoveryCancelRequested}
                onClick={cancelDiscovery}
              >
                {isCancellingDiscovery || discoveryCancelRequested
                  ? t('knowledgeBase.semanticLayer.progress.cancelling')
                  : t('knowledgeBase.semanticLayer.progress.cancel')}
              </Button>
            </Stack>
          </Stack>
        </Alert>
      )}
      {discoveryStatus === 'completed' && discoveryProgress && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setDiscoveryProgress(null)}>
          {t('knowledgeBase.semanticLayer.progress.completed', { total: discoveryTotal })}
        </Alert>
      )}
      {discoveryStatus === 'cancelled' && discoveryProgress && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setDiscoveryProgress(null)}>
          {t('knowledgeBase.semanticLayer.progress.cancelled')}
        </Alert>
      )}
      {discoveryStatus === 'failed' && discoveryProgress && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDiscoveryProgress(null)}>
          {t('knowledgeBase.semanticLayer.progress.failed', {
            message: discoveryProgress.message || t('common.error'),
          })}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {mergeNotice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMergeNotice(null)}>
          {mergeNotice}
        </Alert>
      )}
      {jumpNotice && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setJumpNotice(null)}>
          {jumpNotice}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box>
              <Typography variant="h6">{t('knowledgeBase.semanticLayer.ontology.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('knowledgeBase.semanticLayer.ontology.description')}
              </Typography>
              {ontologyDraftProgress && (
                <Typography variant="caption" color="text.secondary">
                  {t(`knowledgeBase.semanticLayer.ontology.status.${ontologyStatus}`, {
                    current: ontologyCurrent,
                    total: ontologyTotal,
                    message: ontologyDraftProgress.message || t('common.error'),
                  })}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<AutoAwesomeIcon />}
                onClick={requestOntologyDraft}
                disabled={ontologyStatus === 'running'}
              >
                {t('knowledgeBase.semanticLayer.ontology.actions.generate')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ReviewIcon />}
                onClick={() => setOntologyDraftOpen(true)}
                disabled={!hasDraftVersion}
              >
                {t('knowledgeBase.semanticLayer.ontology.actions.review')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => openOntologyDraftEditor()}
              >
                {t('knowledgeBase.semanticLayer.ontology.actions.addItem')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PublishIcon />}
                onClick={() => setOntologyPublishOpen(true)}
                disabled={!hasDraftVersion || ontologyStatus === 'running'}
              >
                {t('knowledgeBase.semanticLayer.ontology.actions.publish')}
              </Button>
            </Stack>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">
                  {t('knowledgeBase.semanticLayer.ontology.cards.activeTitle')}
                </Typography>
                {activeOntology ? (
                  <>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {activeOntology.name}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={ontologyVersionStatusLabel(activeOntology.status)}
                        color={ontologyVersionStatusColor(activeOntology.status) as any}
                      />
                      <Chip size="small" variant="outlined" label={ontologySourceLabel(activeOntology.source)} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t('knowledgeBase.semanticLayer.ontology.cards.updatedAt', {
                        time: formatTimestamp(activeOntology.updated_at || activeOntology.created_at),
                      })}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${t('knowledgeBase.semanticLayer.ontology.versions.stats.total')}: ${
                          activeOntology.stats?.total ?? 0
                        }`}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${t('knowledgeBase.semanticLayer.ontology.versions.stats.approved')}: ${
                          activeOntology.stats?.by_status?.approved ?? 0
                        }`}
                      />
                    </Stack>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('knowledgeBase.semanticLayer.ontology.cards.activeEmpty')}
                  </Typography>
                )}
              </Stack>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">
                  {t('knowledgeBase.semanticLayer.ontology.cards.draftTitle')}
                </Typography>
                {hasDraftVersion ? (
                  <>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {draftOntology?.name || t('knowledgeBase.semanticLayer.ontology.cards.draftDefault')}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={ontologyVersionStatusLabel(draftOntology?.status || 'draft')}
                        color={ontologyVersionStatusColor(draftOntology?.status || 'draft') as any}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={ontologySourceLabel(draftOntology?.source)}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t('knowledgeBase.semanticLayer.ontology.cards.updatedAt', {
                        time: formatTimestamp(draftOntology?.updated_at || draftOntology?.created_at),
                      })}
                    </Typography>
                    {ontologyStatus === 'running' && (
                      <LinearProgress
                        variant={ontologyTotal > 0 ? 'determinate' : 'indeterminate'}
                        value={ontologyPercent}
                      />
                    )}
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.total')}: ${
                          ontologyDraftSummary.total
                        }`}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.pending')}: ${
                          ontologyDraftSummary.byStatus.pending ?? 0
                        }`}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.approved')}: ${
                          ontologyDraftSummary.byStatus.approved ?? 0
                        }`}
                      />
                    </Stack>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('knowledgeBase.semanticLayer.ontology.cards.draftEmpty')}
                  </Typography>
                )}
              </Stack>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">
                  {t('knowledgeBase.semanticLayer.ontology.cards.rulesTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {activeOntology
                    ? t('knowledgeBase.semanticLayer.ontology.cards.rulesActive')
                    : t('knowledgeBase.semanticLayer.ontology.cards.rulesInactive')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('knowledgeBase.semanticLayer.ontology.cards.structureHint')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('knowledgeBase.semanticLayer.progress.backgroundNote')}
                </Typography>
              </Stack>
            </Paper>
          </Box>

          <Divider />

          <Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                mb: 1,
                flexWrap: 'wrap',
              }}
            >
              <Typography variant="subtitle1">
                {t('knowledgeBase.semanticLayer.ontology.versions.title')}
              </Typography>
              <Button
                size="small"
                variant="text"
                startIcon={<RefreshIcon />}
                onClick={fetchOntologyVersions}
                disabled={ontologyVersionsLoading}
              >
                {t('knowledgeBase.semanticLayer.ontology.actions.refresh')}
              </Button>
            </Box>
            {ontologyVersionsLoading ? (
              <Typography variant="body2" color="text.secondary">
                {t('knowledgeBase.semanticLayer.list.loading')}
              </Typography>
            ) : ontologyVersions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('knowledgeBase.semanticLayer.ontology.versions.empty')}
              </Typography>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('knowledgeBase.semanticLayer.ontology.versions.columns.name')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.ontology.versions.columns.status')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.ontology.versions.columns.source')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.ontology.versions.columns.items')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.ontology.versions.columns.updated')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.ontology.versions.columns.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ontologyVersions.map((version) => {
                      const total = version.stats?.total ?? 0;
                      const approved = version.stats?.by_status?.approved ?? 0;
                      const pending = version.stats?.by_status?.pending ?? 0;
                      return (
                        <TableRow key={version.id} hover>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {version.name}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={ontologyVersionStatusLabel(version.status)}
                              color={ontologyVersionStatusColor(version.status) as any}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip size="small" variant="outlined" label={ontologySourceLabel(version.source)} />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{total}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {t('knowledgeBase.semanticLayer.ontology.versions.stats.approved')}: {approved} ·{' '}
                              {t('knowledgeBase.semanticLayer.ontology.versions.stats.pending')}: {pending}
                            </Typography>
                          </TableCell>
                          <TableCell>{formatTimestamp(version.updated_at || version.created_at)}</TableCell>
                          <TableCell>
                            {version.status === 'draft' ? (
                              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                                <Button size="small" variant="text" onClick={() => setOntologyDraftOpen(true)}>
                                  {t('knowledgeBase.semanticLayer.ontology.actions.review')}
                                </Button>
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() => setOntologyPublishOpen(true)}
                                  disabled={ontologyStatus === 'running'}
                                >
                                  {t('knowledgeBase.semanticLayer.ontology.actions.publish')}
                                </Button>
                              </Stack>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                -
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Stack>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(6, 1fr)' },
          gap: 2,
          mb: 2,
        }}
      >
        <Paper sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('knowledgeBase.semanticLayer.stats.total')}
          </Typography>
          <Typography variant="h6">{candidateCount}</Typography>
        </Paper>
        <Paper sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('knowledgeBase.semanticLayer.stats.entities')}
          </Typography>
          <Typography variant="h6">{counts.entities}</Typography>
        </Paper>
        <Paper sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('knowledgeBase.semanticLayer.stats.relations')}
          </Typography>
          <Typography variant="h6">{counts.relations}</Typography>
        </Paper>
        <Paper sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('knowledgeBase.semanticLayer.stats.attributes')}
          </Typography>
          <Typography variant="h6">{counts.attributes}</Typography>
        </Paper>
        <Paper sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('knowledgeBase.semanticLayer.stats.structures')}
          </Typography>
          <Typography variant="h6">{counts.structures}</Typography>
        </Paper>
        <Paper sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('knowledgeBase.semanticLayer.stats.insights')}
          </Typography>
          <Typography variant="h6">{counts.insights}</Typography>
        </Paper>
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h6">{t('knowledgeBase.semanticLayer.graph.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('knowledgeBase.semanticLayer.graph.description')}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInFullIcon />}
            disabled={graphData.nodes.length === 0}
            onClick={() => setGraphDialogOpen(true)}
          >
            {t('knowledgeBase.semanticLayer.graph.open')}
          </Button>
        </Box>
        {graphView.nodes.length === 0 ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('knowledgeBase.semanticLayer.graph.empty')}
            </Typography>
            {graphMode !== 'all' && graphData.nodes.length > 0 && (
              <Box>
                <Button size="small" variant="outlined" onClick={() => setGraphMode('all')}>
                  {t('knowledgeBase.semanticLayer.graph.modeAll')}
                </Button>
              </Box>
            )}
          </Stack>
        ) : (
          <Box
            sx={{
              mt: 2,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.default',
              p: 1,
            }}
          >
            <Box sx={{ width: '100%', height: { xs: 240, md: 340 } }}>
              <WebGLGraph
                nodes={graphView.nodes}
                edges={graphView.edges}
                layoutMode={graphLayoutMode}
                mode={graphMode}
                groupByDoc={graphGroupStructuresByDoc}
                labelEnabled={graphLabelEnabled}
                interactive
                selectedNodeId={selectedGraphNodeId}
                selectedEdgeId={selectedGraphEdgeId}
                focusSelection={graphFocusSelection}
                onReady={handlePreviewGraph}
              />
            </Box>
          </Box>
        )}
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Paper
          sx={{
            p: 2,
            position: { md: 'sticky' },
            top: { md: 88 },
            alignSelf: { md: 'start' },
            maxHeight: { md: 'calc(100vh - 120px)' },
            overflow: { md: 'hidden' },
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h6">{t('knowledgeBase.semanticLayer.listTitle')}</Typography>
              {selectedCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('knowledgeBase.semanticLayer.list.selected', { count: selectedCount })}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              {candidateCount > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${filteredCandidates.length}/${candidateCount}`}
                />
              )}
              <Button
                size="small"
                variant="contained"
                disabled={selectedCount === 0}
                onClick={() => applyStatus(selectedIds, 'approved')}
              >
                {t('knowledgeBase.semanticLayer.list.actions.bulkApprove')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={selectedCount === 0}
                onClick={() => applyStatus(selectedIds, 'rejected')}
              >
                {t('knowledgeBase.semanticLayer.list.actions.bulkReject')}
              </Button>
            </Stack>
          </Box>
          <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mt: 1 }}>
            <Tab label={t('knowledgeBase.semanticLayer.tabs.all')} />
            <Tab label={t('knowledgeBase.semanticLayer.tabs.entities')} />
            <Tab label={t('knowledgeBase.semanticLayer.tabs.relations')} />
            <Tab label={t('knowledgeBase.semanticLayer.tabs.attributes')} />
            <Tab label={t('knowledgeBase.semanticLayer.tabs.structure')} />
            <Tab label={t('knowledgeBase.semanticLayer.tabs.insights')} />
          </Tabs>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label={t('knowledgeBase.semanticLayer.filters.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 220 }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>{t('knowledgeBase.semanticLayer.filters.status')}</InputLabel>
              <Select
                value={statusFilter}
                label={t('knowledgeBase.semanticLayer.filters.status')}
                onChange={(e) => setStatusFilter(String(e.target.value))}
              >
                <MenuItem value="all">{t('knowledgeBase.semanticLayer.filters.statusAll')}</MenuItem>
                <MenuItem value="pending">{t('knowledgeBase.semanticLayer.filters.statusPending')}</MenuItem>
                <MenuItem value="approved">{t('knowledgeBase.semanticLayer.filters.statusApproved')}</MenuItem>
                <MenuItem value="rejected">{t('knowledgeBase.semanticLayer.filters.statusRejected')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="number"
              label={t('knowledgeBase.semanticLayer.filters.confidenceMin')}
              value={confidenceMin}
              onChange={(e) => setConfidenceMin(e.target.value)}
              inputProps={{ min: 0, max: 1, step: 0.1 }}
              sx={{ width: 140 }}
            />
          </Box>
          <Divider sx={{ my: 1 }} />
          <TableContainer
            ref={candidateListRef}
            onScroll={handleCandidateListScroll}
            sx={{ flex: 1, minHeight: 260, overflow: 'auto' }}
          >
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      indeterminate={indeterminate}
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={filteredCandidates.length === 0}
                    />
                  </TableCell>
                  <TableCell>{t('knowledgeBase.semanticLayer.list.columns.name')}</TableCell>
                  <TableCell>{t('knowledgeBase.semanticLayer.list.columns.type')}</TableCell>
                  <TableCell>{t('knowledgeBase.semanticLayer.list.columns.confidence')}</TableCell>
                  <TableCell>{t('knowledgeBase.semanticLayer.list.columns.evidence')}</TableCell>
                  <TableCell>{t('knowledgeBase.semanticLayer.list.columns.status')}</TableCell>
                  <TableCell>{t('knowledgeBase.semanticLayer.list.columns.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" color="text.secondary">
                          {t('common.loading')}
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ) : filteredCandidates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      {candidates.length === 0 ? (
                        <Stack spacing={1}>
                          <Typography variant="body2" color="text.secondary">
                            {t('knowledgeBase.semanticLayer.empty.title')}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {t('knowledgeBase.semanticLayer.empty.description')}
                          </Typography>
                          <Button size="small" startIcon={<AutoAwesomeIcon />} onClick={() => setDialogOpen(true)}>
                            {t('knowledgeBase.semanticLayer.empty.action')}
                          </Button>
                        </Stack>
                      ) : (
                        <Stack spacing={1}>
                          <Typography variant="body2" color="text.secondary">
                            {t('knowledgeBase.semanticLayer.list.emptyFiltered')}
                          </Typography>
                          <Button size="small" onClick={resetFilters}>
                            {t('knowledgeBase.semanticLayer.filters.reset')}
                          </Button>
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {virtualWindow.paddingTop > 0 && (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ p: 0, border: 0, height: virtualWindow.paddingTop }} />
                      </TableRow>
                    )}
                    {virtualWindow.items.map((candidate) => (
                      <TableRow
                        key={candidate.id}
                        hover
                        selected={candidate.id === selectedId}
                        onClick={() => setSelectedId(candidate.id)}
                        sx={{ cursor: 'pointer', height: CANDIDATE_ROW_HEIGHT }}
                      >
                      <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.includes(candidate.id)}
                          onChange={() => toggleSelection(candidate.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {candidate.name}
                        </Typography>
                        {candidate.aliases && candidate.aliases.length > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            {candidate.aliases[0]}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={typeLabel(candidate.type)} />
                      </TableCell>
                      <TableCell>{Math.round(candidate.confidence * 100)}%</TableCell>
                      <TableCell>{candidate.evidence.length}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={statusLabel(candidate.status)}
                          color={statusColor(candidate.status) as any}
                        />
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Stack direction="row" spacing={1}>
                          <Tooltip title={t('knowledgeBase.semanticLayer.list.actions.approve')}>
                            <span>
                              <IconButton
                                size="small"
                                color="primary"
                                disabled={candidate.status === 'approved'}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedId(candidate.id);
                                  applyStatus([candidate.id], 'approved');
                                }}
                              >
                                <ApproveIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={t('knowledgeBase.semanticLayer.list.actions.reject')}>
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                disabled={candidate.status === 'rejected'}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedId(candidate.id);
                                  applyStatus([candidate.id], 'rejected');
                                }}
                              >
                                <RejectIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                    ))}
                    {virtualWindow.paddingBottom > 0 && (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ p: 0, border: 0, height: virtualWindow.paddingBottom }} />
                      </TableRow>
                    )}
                  </>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        <Paper
          sx={{
            p: 2,
            position: { md: 'sticky' },
            top: { md: 88 },
            alignSelf: { md: 'start' },
            maxHeight: { md: 'calc(100vh - 120px)' },
            overflow: { md: 'auto' },
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h6">{t('knowledgeBase.semanticLayer.details.title')}</Typography>
            {selectedCandidate && (
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={selectedCandidate.status === 'approved'}
                  onClick={() => applyStatus([selectedCandidate.id], 'approved')}
                >
                  {t('knowledgeBase.semanticLayer.details.actions.approve')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={selectedCandidate.status === 'rejected'}
                  onClick={() => applyStatus([selectedCandidate.id], 'rejected')}
                >
                  {t('knowledgeBase.semanticLayer.details.actions.reject')}
                </Button>
                {selectedCandidate.type === 'entity' && (
                  <Button size="small" variant="outlined" onClick={openMergeDialog}>
                    {t('knowledgeBase.semanticLayer.details.actions.merge')}
                  </Button>
                )}
              </Stack>
            )}
          </Box>
          {!selectedCandidate ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('knowledgeBase.semanticLayer.details.empty')}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Chip size="small" label={t('knowledgeBase.semanticLayer.features.discovery')} />
                <Chip size="small" label={t('knowledgeBase.semanticLayer.features.review')} />
                <Chip size="small" label={t('knowledgeBase.semanticLayer.features.linking')} />
              </Stack>
            </>
          ) : (
            <>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                {selectedCandidate.name}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
                <Chip
                  size="small"
                  label={`${t('knowledgeBase.semanticLayer.details.meta.type')}: ${typeLabel(selectedCandidate.type)}`}
                />
                <Chip
                  size="small"
                  label={`${t('knowledgeBase.semanticLayer.details.meta.status')}: ${statusLabel(selectedCandidate.status)}`}
                  color={statusColor(selectedCandidate.status) as any}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${t('knowledgeBase.semanticLayer.details.meta.confidence')}: ${Math.round(
                    selectedCandidate.confidence * 100
                  )}%`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${t('knowledgeBase.semanticLayer.list.columns.evidence')}: ${selectedCandidate.evidence.length}`}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={highlightEnabled}
                    onChange={(event) => setHighlightEnabled(event.target.checked)}
                  />
                }
                label={t('knowledgeBase.semanticLayer.details.highlight')}
                sx={{ mb: 2 }}
              />
              {selectedCandidate.type === 'insight' && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('knowledgeBase.semanticLayer.details.sections.insight')}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
                    {selectedCandidate.attributes?.insight_type && (
                      <Chip
                        size="small"
                        label={`${t('knowledgeBase.semanticLayer.details.insight.type')}: ${selectedCandidate.attributes.insight_type}`}
                      />
                    )}
                    {selectedCandidate.attributes?.scope && (
                      <Chip
                        size="small"
                        label={`${t('knowledgeBase.semanticLayer.details.insight.scope')}: ${insightScopeLabel(
                          String(selectedCandidate.attributes.scope)
                        )}`}
                      />
                    )}
                  </Stack>
                  {selectedCandidate.attributes?.notes && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {selectedCandidate.attributes.notes}
                    </Typography>
                  )}
                </>
              )}
              {selectedCandidate.type === 'structure' && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('knowledgeBase.semanticLayer.details.sections.structure')}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
                    {selectedCandidate.attributes?.doc && (
                      <Chip
                        size="small"
                        label={`${t('knowledgeBase.semanticLayer.details.structure.doc')}: ${
                          selectedCandidate.attributes.doc
                        }`}
                      />
                    )}
                    {selectedCandidate.attributes?.level !== undefined && (
                      <Chip
                        size="small"
                        label={`${t('knowledgeBase.semanticLayer.details.structure.level')}: ${
                          selectedCandidate.attributes.level
                        }`}
                      />
                    )}
                    {selectedCandidate.attributes?.parent && (
                      <Chip
                        size="small"
                        label={`${t('knowledgeBase.semanticLayer.details.structure.parent')}: ${
                          selectedCandidate.attributes.parent
                        }`}
                      />
                    )}
                  </Stack>
                  {selectedCandidate.attributes?.summary && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {selectedCandidate.attributes.summary}
                    </Typography>
                  )}
                </>
              )}
              {selectedMerge && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('knowledgeBase.semanticLayer.details.sections.merge')}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
                    <Chip
                      size="small"
                      label={`${t('knowledgeBase.semanticLayer.merge.modeLabel')}: ${
                        selectedMerge.mode === 'new'
                          ? t('knowledgeBase.semanticLayer.merge.modeNew')
                          : t('knowledgeBase.semanticLayer.merge.modeExisting')
                      }`}
                    />
                    <Chip
                      size="small"
                      label={`${t('knowledgeBase.semanticLayer.merge.targetLabel')}: ${selectedMerge.target}`}
                    />
                      {selectedMerge.alias && selectedMerge.mode === 'existing' && (
                        <Chip size="small" label={t('knowledgeBase.semanticLayer.merge.aliasChip')} />
                      )}
                    </Stack>
                </>
              )}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('knowledgeBase.semanticLayer.details.sections.conflicts')}
              </Typography>
              {candidateConflicts.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('knowledgeBase.semanticLayer.details.noConflicts')}
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {candidateConflicts.map((item, index) => (
                    <Alert key={`${selectedCandidate.id}-conflict-${index}`} severity="warning">
                      {item}
                    </Alert>
                  ))}
                </Stack>
              )}
              {selectedCandidate.relation && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('knowledgeBase.semanticLayer.details.sections.relation')}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
                    <Chip size="small" label={selectedCandidate.relation.source} />
                    <Chip size="small" label={selectedCandidate.relation.relation} />
                    <Chip size="small" label={selectedCandidate.relation.target} />
                  </Stack>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('knowledgeBase.semanticLayer.details.sections.graph')}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                    <Chip size="small" label={selectedCandidate.relation.source} />
                    <EastIcon fontSize="small" />
                    <Chip size="small" label={selectedCandidate.relation.relation} />
                    <EastIcon fontSize="small" />
                    <Chip size="small" label={selectedCandidate.relation.target} />
                  </Box>
                </>
              )}
              {selectedCandidate.aliases && selectedCandidate.aliases.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('knowledgeBase.semanticLayer.details.sections.aliases')}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
                    {selectedCandidate.aliases.map((alias) => (
                      <Chip key={alias} size="small" label={alias} />
                    ))}
                  </Stack>
                </>
              )}
              {selectedCandidate.type !== 'structure' &&
                selectedCandidate.attributes &&
                Object.keys(selectedCandidate.attributes).length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('knowledgeBase.semanticLayer.details.sections.attributes')}
                  </Typography>
                  <Stack spacing={1} sx={{ mb: 2 }}>
                    {Object.entries(selectedCandidate.attributes).map(([key, value]) => (
                      <Box key={key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                        <Typography variant="body2">{key}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {value}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </>
              )}
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('knowledgeBase.semanticLayer.details.sections.evidence')}
              </Typography>
              <Stack spacing={1}>
                {selectedCandidate.evidence.map((item, index) => (
                  <Paper key={`${selectedCandidate.id}-evidence-${index}`} variant="outlined" sx={{ p: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="text.secondary">
                        {item.source}
                      </Typography>
                      <Tooltip
                        title={
                          item.documentId
                            ? t('knowledgeBase.semanticLayer.evidence.open')
                            : t('knowledgeBase.semanticLayer.evidence.unavailable')
                        }
                      >
                        <span>
                          <Button
                            size="small"
                            variant="text"
                            startIcon={<OpenInNewIcon />}
                            onClick={() => jumpToEvidence(item)}
                            disabled={!item.documentId || !kbId}
                          >
                            {t('knowledgeBase.semanticLayer.evidence.open')}
                          </Button>
                        </span>
                      </Tooltip>
                    </Box>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {highlightEnabled ? highlightText(item.snippet, highlightTerms) : item.snippet}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </>
          )}
        </Paper>
      </Box>

      <Dialog open={ontologyDraftOpen} onClose={() => setOntologyDraftOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{t('knowledgeBase.semanticLayer.ontology.dialog.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {ontologyStatus === 'running' && (
              <Alert severity="info">
                {t(`knowledgeBase.semanticLayer.ontology.status.${ontologyStatus}`, {
                  current: ontologyCurrent,
                  total: ontologyTotal,
                  message: ontologyDraftProgress?.message || t('common.error'),
                })}
              </Alert>
            )}
            {draftOntology && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle2">{draftOntology.name}</Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Chip
                      size="small"
                      label={ontologyVersionStatusLabel(draftOntology.status)}
                      color={ontologyVersionStatusColor(draftOntology.status) as any}
                    />
                    <Chip size="small" variant="outlined" label={ontologySourceLabel(draftOntology.source)} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {t('knowledgeBase.semanticLayer.ontology.cards.updatedAt', {
                      time: formatTimestamp(draftOntology.updated_at || draftOntology.created_at),
                    })}
                  </Typography>
                </Stack>
              </Paper>
            )}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>{t('knowledgeBase.semanticLayer.filters.status')}</InputLabel>
                <Select
                  value={ontologyDraftStatusFilter}
                  label={t('knowledgeBase.semanticLayer.filters.status')}
                  onChange={(e) => setOntologyDraftStatusFilter(String(e.target.value))}
                >
                  <MenuItem value="all">{t('knowledgeBase.semanticLayer.filters.statusAll')}</MenuItem>
                  <MenuItem value="pending">{t('knowledgeBase.semanticLayer.status.pending')}</MenuItem>
                  <MenuItem value="approved">{t('knowledgeBase.semanticLayer.status.approved')}</MenuItem>
                  <MenuItem value="rejected">{t('knowledgeBase.semanticLayer.status.rejected')}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>{t('knowledgeBase.semanticLayer.ontology.dialog.kindLabel')}</InputLabel>
                <Select
                  value={ontologyDraftKindFilter}
                  label={t('knowledgeBase.semanticLayer.ontology.dialog.kindLabel')}
                  onChange={(e) => setOntologyDraftKindFilter(String(e.target.value))}
                >
                  <MenuItem value="all">{t('knowledgeBase.semanticLayer.tabs.all')}</MenuItem>
                  <MenuItem value="entity_type">{t('knowledgeBase.semanticLayer.types.entity')}</MenuItem>
                  <MenuItem value="relation_type">{t('knowledgeBase.semanticLayer.types.relation')}</MenuItem>
                  <MenuItem value="attribute_type">{t('knowledgeBase.semanticLayer.types.attribute')}</MenuItem>
                  <MenuItem value="structure_type">{t('knowledgeBase.semanticLayer.types.structure')}</MenuItem>
                </Select>
              </FormControl>
              <TextField
                size="small"
                label={t('knowledgeBase.semanticLayer.ontology.dialog.search')}
                value={ontologyDraftSearch}
                onChange={(e) => setOntologyDraftSearch(e.target.value)}
                sx={{ minWidth: 200 }}
              />
              <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={fetchOntologyDraftItems}>
                {t('common.refresh')}
              </Button>
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => openOntologyDraftEditor()}>
                {t('knowledgeBase.semanticLayer.ontology.actions.addItem')}
              </Button>
            </Box>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.total')}: ${ontologyDraftSummary.total}`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.pending')}: ${
                  ontologyDraftSummary.byStatus.pending ?? 0
                }`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.approved')}: ${
                  ontologyDraftSummary.byStatus.approved ?? 0
                }`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.rejected')}: ${
                  ontologyDraftSummary.byStatus.rejected ?? 0
                }`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.entities')}: ${
                  ontologyDraftSummary.byKind.entity_type ?? 0
                }`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.relations')}: ${
                  ontologyDraftSummary.byKind.relation_type ?? 0
                }`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.attributes')}: ${
                  ontologyDraftSummary.byKind.attribute_type ?? 0
                }`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${t('knowledgeBase.semanticLayer.ontology.draftSummary.structures')}: ${
                  ontologyDraftSummary.byKind.structure_type ?? 0
                }`}
              />
            </Stack>

            {ontologyDraftLoading ? (
              <Typography variant="body2" color="text.secondary">
                {t('knowledgeBase.semanticLayer.list.loading')}
              </Typography>
            ) : filteredOntologyDraftItems.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('knowledgeBase.semanticLayer.ontology.dialog.empty')}
              </Typography>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={ontologyDraftAllSelected}
                          onChange={toggleOntologyDraftSelectAll}
                        />
                      </TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.list.columns.name')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.list.columns.type')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.list.columns.confidence')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.list.columns.status')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.list.columns.evidence')}</TableCell>
                      <TableCell>{t('knowledgeBase.semanticLayer.ontology.versions.columns.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredOntologyDraftItems.map((item) => {
                      const expanded = ontologyDraftExpanded === item.id;
                      const hasConstraints =
                        item.constraints && Object.keys(item.constraints).length > 0;
                      const hasMeta = item.meta && Object.keys(item.meta).length > 0;
                      return (
                        <React.Fragment key={item.id}>
                          <TableRow hover>
                            <TableCell padding="checkbox">
                              <IconButton size="small" onClick={() => toggleOntologyDraftExpanded(item.id)}>
                                {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                              </IconButton>
                            </TableCell>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={ontologyDraftSelected.includes(item.id)}
                                onChange={() => toggleOntologyDraftSelection(item.id)}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {item.name}
                              </Typography>
                              {item.description && (
                                <Typography variant="caption" color="text.secondary">
                                  {item.description}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              <Chip size="small" variant="outlined" label={ontologyKindLabel(item.kind)} />
                            </TableCell>
                            <TableCell>{Math.round(item.confidence * 100)}%</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={statusLabel(item.status)}
                                color={statusColor(item.status) as any}
                              />
                            </TableCell>
                            <TableCell>{item.evidence?.length ?? 0}</TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={1}>
                                <Tooltip title={t('knowledgeBase.semanticLayer.ontology.actions.approve')}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="success"
                                      onClick={() => applyOntologyDraftStatus([item.id], 'approved')}
                                      disabled={item.status === 'approved'}
                                    >
                                      <ApproveIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title={t('knowledgeBase.semanticLayer.ontology.actions.reject')}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      color="error"
                                      onClick={() => applyOntologyDraftStatus([item.id], 'rejected')}
                                      disabled={item.status === 'rejected'}
                                    >
                                      <RejectIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title={t('knowledgeBase.semanticLayer.ontology.actions.edit')}>
                                  <IconButton size="small" onClick={() => openOntologyDraftEditor(item)}>
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell colSpan={8} sx={{ p: 0, borderBottom: 0 }}>
                              <Collapse in={expanded} timeout="auto" unmountOnExit>
                                <Box sx={{ p: 2, bgcolor: 'background.default' }}>
                                  <Stack spacing={1}>
                                    {item.aliases?.length > 0 && (
                                      <Box>
                                        <Typography variant="caption" color="text.secondary">
                                          {t('knowledgeBase.semanticLayer.ontology.dialog.aliases')}
                                        </Typography>
                                        <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                                          {item.aliases.map((alias) => (
                                            <Chip key={alias} size="small" variant="outlined" label={alias} />
                                          ))}
                                        </Stack>
                                      </Box>
                                    )}
                                    {hasConstraints && (
                                      <Box>
                                        <Typography variant="caption" color="text.secondary">
                                          {t('knowledgeBase.semanticLayer.ontology.dialog.constraints')}
                                        </Typography>
                                        <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: 'background.paper' }}>
                                          <Typography variant="body2" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>
                                            {JSON.stringify(item.constraints, null, 2)}
                                          </Typography>
                                        </Paper>
                                      </Box>
                                    )}
                                    {item.evidence?.length > 0 && (
                                      <Box>
                                        <Typography variant="caption" color="text.secondary">
                                          {t('knowledgeBase.semanticLayer.ontology.dialog.evidence')}
                                        </Typography>
                                        <Stack spacing={1} sx={{ mt: 0.5 }}>
                                          {item.evidence.slice(0, 3).map((evidence, index) => (
                                            <Paper key={`${item.id}-evidence-${index}`} variant="outlined" sx={{ p: 1 }}>
                                              <Typography variant="caption" color="text.secondary">
                                                {evidence.source || t('knowledgeBase.semanticLayer.ontology.dialog.details')}
                                              </Typography>
                                              {evidence.snippet && (
                                                <Typography variant="body2" sx={{ mt: 0.5 }}>
                                                  {evidence.snippet}
                                                </Typography>
                                              )}
                                            </Paper>
                                          ))}
                                        </Stack>
                                      </Box>
                                    )}
                                    {hasMeta && (
                                      <Box>
                                        <Typography variant="caption" color="text.secondary">
                                          {t('knowledgeBase.semanticLayer.ontology.dialog.meta')}
                                        </Typography>
                                        <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: 'background.paper' }}>
                                          <Typography variant="body2" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>
                                            {JSON.stringify(item.meta, null, 2)}
                                          </Typography>
                                        </Paper>
                                      </Box>
                                    )}
                                  </Stack>
                                </Box>
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            size="small"
            variant="contained"
            disabled={ontologyDraftSelectedCount === 0}
            onClick={() => applyOntologyDraftStatus(ontologyDraftSelected, 'approved')}
          >
            {t('knowledgeBase.semanticLayer.list.actions.bulkApprove')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={ontologyDraftSelectedCount === 0}
            onClick={() => applyOntologyDraftStatus(ontologyDraftSelected, 'rejected')}
          >
            {t('knowledgeBase.semanticLayer.list.actions.bulkReject')}
          </Button>
          <Button size="small" onClick={() => setOntologyDraftOpen(false)}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={ontologyDraftEditOpen} onClose={closeOntologyDraftEditor} maxWidth="sm" fullWidth>
        <DialogTitle>
          {ontologyDraftEditItem
            ? t('knowledgeBase.semanticLayer.ontology.dialog.editTitle')
            : t('knowledgeBase.semanticLayer.ontology.dialog.addTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>{t('knowledgeBase.semanticLayer.ontology.dialog.kindLabel')}</InputLabel>
              <Select
                value={ontologyDraftEditKind}
                label={t('knowledgeBase.semanticLayer.ontology.dialog.kindLabel')}
                onChange={(e) => setOntologyDraftEditKind(e.target.value as OntologyItemKind)}
                disabled={Boolean(ontologyDraftEditItem)}
              >
                <MenuItem value="entity_type">{t('knowledgeBase.semanticLayer.types.entity')}</MenuItem>
                <MenuItem value="relation_type">{t('knowledgeBase.semanticLayer.types.relation')}</MenuItem>
                <MenuItem value="attribute_type">{t('knowledgeBase.semanticLayer.types.attribute')}</MenuItem>
                <MenuItem value="structure_type">{t('knowledgeBase.semanticLayer.types.structure')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label={t('knowledgeBase.semanticLayer.ontology.dialog.nameLabel')}
              value={ontologyDraftEditName}
              onChange={(e) => setOntologyDraftEditName(e.target.value)}
              required
              fullWidth
            />
            <TextField
              size="small"
              label={t('knowledgeBase.semanticLayer.ontology.dialog.descriptionLabel')}
              value={ontologyDraftEditDescription}
              onChange={(e) => setOntologyDraftEditDescription(e.target.value)}
              fullWidth
            />
            <TextField
              size="small"
              label={t('knowledgeBase.semanticLayer.ontology.dialog.aliasesLabel')}
              value={ontologyDraftEditAliases}
              onChange={(e) => setOntologyDraftEditAliases(e.target.value)}
              helperText={t('knowledgeBase.semanticLayer.ontology.dialog.aliasesHint')}
              fullWidth
            />
            <TextField
              size="small"
              label={t('knowledgeBase.semanticLayer.ontology.dialog.constraintsLabel')}
              value={ontologyDraftEditConstraints}
              onChange={(e) => setOntologyDraftEditConstraints(e.target.value)}
              helperText={t('knowledgeBase.semanticLayer.ontology.dialog.constraintsHint')}
              multiline
              minRows={3}
              fullWidth
            />
            <FormControl size="small" fullWidth>
              <InputLabel>{t('knowledgeBase.semanticLayer.ontology.dialog.statusLabel')}</InputLabel>
              <Select
                value={ontologyDraftEditStatus}
                label={t('knowledgeBase.semanticLayer.ontology.dialog.statusLabel')}
                onChange={(e) => setOntologyDraftEditStatus(e.target.value as OntologyItemStatus)}
              >
                <MenuItem value="pending">{t('knowledgeBase.semanticLayer.status.pending')}</MenuItem>
                <MenuItem value="approved">{t('knowledgeBase.semanticLayer.status.approved')}</MenuItem>
                <MenuItem value="rejected">{t('knowledgeBase.semanticLayer.status.rejected')}</MenuItem>
              </Select>
            </FormControl>
            {ontologyDraftEditError && <Alert severity="error">{ontologyDraftEditError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeOntologyDraftEditor}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={saveOntologyDraftItem}>
            {t('knowledgeBase.semanticLayer.ontology.dialog.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={ontologyPublishOpen}
        onClose={() => {
          setOntologyPublishOpen(false);
          setOntologyPublishError(null);
          setOntologyPublishName('');
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('knowledgeBase.semanticLayer.ontology.publishDialog.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('knowledgeBase.semanticLayer.ontology.publishDialog.description')}
            </Typography>
            <TextField
              size="small"
              label={t('knowledgeBase.semanticLayer.ontology.publishDialog.nameLabel')}
              value={ontologyPublishName}
              onChange={(e) => setOntologyPublishName(e.target.value)}
              fullWidth
            />
            {ontologyPublishError && <Alert severity="error">{ontologyPublishError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setOntologyPublishOpen(false);
              setOntologyPublishError(null);
              setOntologyPublishName('');
            }}
          >
            {t('knowledgeBase.semanticLayer.ontology.publishDialog.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={publishOntologyDraft}
            disabled={!hasDraftVersion || ontologyStatus === 'running'}
          >
            {t('knowledgeBase.semanticLayer.ontology.publishDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('knowledgeBase.semanticLayer.discoveryDialog.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('knowledgeBase.semanticLayer.discoveryDialog.scope')}</InputLabel>
              <Select
                value={scope}
                label={t('knowledgeBase.semanticLayer.discoveryDialog.scope')}
                onChange={(e) => {
                  scopeTouchedRef.current = true;
                  setScope(String(e.target.value));
                }}
              >
                <MenuItem value="all">{t('knowledgeBase.semanticLayer.discoveryDialog.scopeAll')}</MenuItem>
                <MenuItem value="recent">{t('knowledgeBase.semanticLayer.discoveryDialog.scopeRecent')}</MenuItem>
                <MenuItem value="selected">{t('knowledgeBase.semanticLayer.discoveryDialog.scopeSelected')}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t('knowledgeBase.semanticLayer.discoveryDialog.discoveryMode')}</InputLabel>
              <Select
                value={discoveryMode}
                label={t('knowledgeBase.semanticLayer.discoveryDialog.discoveryMode')}
                onChange={(e) => {
                  setDiscoveryMode(toDiscoveryMode(e.target.value, 'facts'));
                }}
              >
                {DISCOVERY_MODE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch checked={includeRelations} onChange={(e) => setIncludeRelations(e.target.checked)} />
              }
              label={t('knowledgeBase.semanticLayer.discoveryDialog.includeRelations')}
            />
            {discoveryMode === 'insights' && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
                <FormControl size="small">
                  <InputLabel>{t('knowledgeBase.semanticLayer.discoveryDialog.insightScope')}</InputLabel>
                  <Select
                    value={insightScope}
                    label={t('knowledgeBase.semanticLayer.discoveryDialog.insightScope')}
                    displayEmpty
                    onChange={(e) => {
                      setInsightScope(toInsightScope(e.target.value));
                    }}
                  >
                    <MenuItem value="">
                      {t('knowledgeBase.semanticLayer.discoveryDialog.insightScopePlaceholder')}
                    </MenuItem>
                    {INSIGHT_SCOPE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <InputLabel>{t('knowledgeBase.semanticLayer.discoveryDialog.insightDomain')}</InputLabel>
                  <Select
                    value={insightDomain}
                    label={t('knowledgeBase.semanticLayer.discoveryDialog.insightDomain')}
                    onChange={(e) => {
                      setInsightDomain(String(e.target.value));
                    }}
                  >
                    {INSIGHT_DOMAIN_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}
            {requiresSelection && (
              <Autocomplete
                multiple={!isSingleDocInsight}
                options={documentOptions}
                loading={documentsLoading}
                inputValue={documentQuery}
                value={
                  isSingleDocInsight ? selectedDocuments[0] || null : selectedDocuments
                }
                onInputChange={handleDocumentInputChange}
                onChange={(_, value) => {
                  if (Array.isArray(value)) {
                    setSelectedDocuments(value as DocumentOption[]);
                    return;
                  }
                  if (value) {
                    setSelectedDocuments([value as DocumentOption]);
                    return;
                  }
                  setSelectedDocuments([]);
                }}
                filterOptions={(options) => options}
                ListboxProps={{ onScroll: handleDocumentListScroll }}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                getOptionLabel={(option) => option.label}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label={t('knowledgeBase.semanticLayer.discoveryDialog.documentSelect')}
                    helperText={t(
                      isSingleDocInsight
                        ? 'knowledgeBase.semanticLayer.discoveryDialog.documentSelectSingleHelp'
                        : 'knowledgeBase.semanticLayer.discoveryDialog.documentSelectHelp'
                    )}
                  />
                )}
              />
            )}
            <Divider />
            <Typography variant="subtitle2">
              {t('knowledgeBase.semanticLayer.discoveryDialog.limitsTitle')}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: 2,
              }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={autoChunking}
                    onChange={(e) => {
                      markLimitsTouched();
                      setAutoChunking(e.target.checked);
                    }}
                    disabled={fullChunkScan}
                  />
                }
                label={t('knowledgeBase.semanticLayer.discoveryDialog.autoChunking')}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={fullChunkScan}
                    onChange={(e) => {
                      markLimitsTouched();
                      const next = e.target.checked;
                      setFullChunkScan(next);
                      if (next) {
                        setAutoChunking(false);
                      }
                    }}
                  />
                }
                label={t('knowledgeBase.semanticLayer.discoveryDialog.fullChunkScan')}
              />
              <FormControl size="small">
                <InputLabel>{t('knowledgeBase.semanticLayer.discoveryDialog.chunkStrategy')}</InputLabel>
                <Select
                  value={chunkStrategy}
                  label={t('knowledgeBase.semanticLayer.discoveryDialog.chunkStrategy')}
                  onChange={(e) => {
                    markLimitsTouched();
                    setChunkStrategy(e.target.value as ChunkStrategy);
                  }}
                  disabled={fullChunkScan}
                >
                  {CHUNK_STRATEGY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.documentLimit')}
                value={documentLimit}
                onChange={handleLimitChange(setDocumentLimit)}
                inputProps={{ min: 1, max: EXTRACTION_MAX_DOCUMENT_LIMIT, step: 1 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.documentLimitHelper')}
              />
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.maxChunks')}
                value={maxChunks}
                onChange={handleLimitChange(setMaxChunks)}
                inputProps={{ min: 1, max: EXTRACTION_MAX_CHUNKS_LIMIT, step: 1 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.maxChunksHelper')}
                disabled={fullChunkScan}
              />
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.maxTextChars')}
                value={maxTextChars}
                onChange={handleLimitChange(setMaxTextChars)}
                inputProps={{ min: 200, max: EXTRACTION_MAX_TEXT_CHARS_LIMIT, step: 50 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.maxTextCharsHelper')}
              />
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.maxItems')}
                value={maxItems}
                onChange={handleLimitChange(setMaxItems)}
                inputProps={{ min: 1, max: EXTRACTION_MAX_ITEMS_LIMIT, step: 1 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.maxItemsHelper')}
              />
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.batchSize')}
                value={batchSize}
                onChange={handleLimitChange(setBatchSize)}
                inputProps={{ min: 1, max: 6, step: 1 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.batchSizeHelper')}
                disabled={progressiveEnabled}
              />
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.batchConcurrency')}
                value={batchConcurrency}
                onChange={handleLimitChange(setBatchConcurrency)}
                inputProps={{ min: 1, max: 8, step: 1 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.batchConcurrencyHelper')}
                disabled={progressiveEnabled}
              />
            </Box>
            <Divider />
            <Typography variant="subtitle2">
              {t('knowledgeBase.semanticLayer.discoveryDialog.strategyTitle')}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                gap: 2,
              }}
            >
              <FormControl size="small">
                <InputLabel>{t('knowledgeBase.semanticLayer.discoveryDialog.mode')}</InputLabel>
                <Select
                  value={extractionMode}
                  label={t('knowledgeBase.semanticLayer.discoveryDialog.mode')}
                  onChange={(e) => {
                    markLimitsTouched();
                    setExtractionMode(e.target.value as ExtractionMode);
                  }}
                >
                  {EXTRACTION_MODE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.summaryMaxChars')}
                value={summaryMaxChars}
                onChange={handleLimitChange(setSummaryMaxChars)}
                inputProps={{ min: 200, max: EXTRACTION_MAX_SUMMARY_CHARS, step: 50 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.summaryMaxCharsHelper')}
                disabled={extractionMode !== 'summary'}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={progressiveEnabled}
                    onChange={(e) => {
                      markLimitsTouched();
                      setProgressiveEnabled(e.target.checked);
                    }}
                  />
                }
                label={t('knowledgeBase.semanticLayer.discoveryDialog.progressiveEnabled')}
              />
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.progressiveMinItems')}
                value={progressiveMinItems}
                onChange={handleLimitChange(setProgressiveMinItems)}
                inputProps={{ min: 1, max: EXTRACTION_MAX_PROGRESSIVE_ITEMS, step: 1 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.progressiveMinItemsHelper')}
                disabled={!progressiveEnabled}
              />
              <TextField
                size="small"
                type="number"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.progressiveStep')}
                value={progressiveStep}
                onChange={handleLimitChange(setProgressiveStep)}
                inputProps={{ min: 1, max: EXTRACTION_MAX_PROGRESSIVE_STEP, step: 1 }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.progressiveStepHelper')}
                disabled={!progressiveEnabled}
              />
            </Box>
            <Divider />
            <Typography variant="subtitle2">
              {t('knowledgeBase.semanticLayer.discoveryDialog.whitelistTitle')}
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.entityTypes')}
                value={entityTypeWhitelist}
                onChange={(e) => {
                  markLimitsTouched();
                  setEntityTypeWhitelist(e.target.value);
                }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.entityTypesHelper')}
                multiline
                minRows={2}
              />
              <TextField
                size="small"
                label={t('knowledgeBase.semanticLayer.discoveryDialog.relationTypes')}
                value={relationTypeWhitelist}
                onChange={(e) => {
                  markLimitsTouched();
                  setRelationTypeWhitelist(e.target.value);
                }}
                helperText={t('knowledgeBase.semanticLayer.discoveryDialog.relationTypesHelper')}
                multiline
                minRows={2}
              />
            </Stack>
            <Alert severity="info">{t('knowledgeBase.semanticLayer.discoveryDialog.note')}</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={requestDiscovery} disabled={!canSubmitDiscovery}>
            {t('knowledgeBase.semanticLayer.discoveryDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mergeDialogOpen} onClose={() => setMergeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('knowledgeBase.semanticLayer.merge.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('knowledgeBase.semanticLayer.merge.mode')}</InputLabel>
              <Select
                value={mergeMode}
                label={t('knowledgeBase.semanticLayer.merge.mode')}
                onChange={(event) => setMergeMode(event.target.value as 'existing' | 'new')}
              >
                <MenuItem value="existing">{t('knowledgeBase.semanticLayer.merge.modeExisting')}</MenuItem>
                <MenuItem value="new">{t('knowledgeBase.semanticLayer.merge.modeNew')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={t('knowledgeBase.semanticLayer.merge.target')}
              size="small"
              value={mergeTarget}
              onChange={(event) => {
                setMergeTarget(event.target.value);
                if (mergeError) setMergeError(null);
              }}
              error={Boolean(mergeError)}
              helperText={mergeError || t('knowledgeBase.semanticLayer.merge.helper')}
            />
            {mergeSuggestions.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t('knowledgeBase.semanticLayer.merge.suggestions')}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 1 }}>
                  {mergeSuggestions.map((name) => (
                    <Chip
                      key={name}
                      size="small"
                      label={name}
                      variant={mergeTarget === name ? 'filled' : 'outlined'}
                      onClick={() => setMergeTarget(name)}
                    />
                  ))}
                </Stack>
              </Box>
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={mergeAlias}
                  onChange={(event) => setMergeAlias(event.target.checked)}
                />
              }
              label={t('knowledgeBase.semanticLayer.merge.addAlias')}
              disabled={mergeMode === 'new'}
            />
            {mergeConflicts.length > 0 && (
              <Alert severity="warning">
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('knowledgeBase.semanticLayer.merge.conflicts')}
                </Typography>
                <Stack spacing={0.5}>
                  {mergeConflicts.map((item, index) => (
                    <Typography variant="body2" key={`merge-conflict-${index}`}>
                      {item}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            )}
            <Alert severity="info">{t('knowledgeBase.semanticLayer.merge.note')}</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={confirmMerge}>
            {t('knowledgeBase.semanticLayer.merge.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={graphDialogOpen}
        onClose={() => setGraphDialogOpen(false)}
        fullScreen
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <SemanticIcon color="primary" />
            <Typography variant="h6">{t('knowledgeBase.semanticLayer.graph.title')}</Typography>
          </Stack>
          <IconButton onClick={() => setGraphDialogOpen(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, height: 'calc(100vh - 72px)', overflow: 'hidden' }}>
          <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
            <Paper
              sx={{
                position: 'absolute',
                top: 16,
                left: 16,
                zIndex: 2,
                p: 1.5,
                minWidth: 220,
                maxWidth: 280,
              }}
            >
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('knowledgeBase.semanticLayer.graph.controls')}
              </Typography>
              <Stack spacing={1}>
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('knowledgeBase.semanticLayer.graph.modeLabel')}</InputLabel>
                  <Select
                    value={graphMode}
                    label={t('knowledgeBase.semanticLayer.graph.modeLabel')}
                    onChange={(event) => {
                      const mode = event.target.value as GraphMode;
                      setGraphMode(mode);
                      if (mode === 'structure') {
                        setGraphShowStructures(true);
                        setGraphShowAttributes(false);
                      }
                      resetGraphView();
                    }}
                  >
                    {GRAPH_MODE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('knowledgeBase.semanticLayer.graph.layoutLabel')}</InputLabel>
                  <Select
                    value={graphLayoutMode}
                    label={t('knowledgeBase.semanticLayer.graph.layoutLabel')}
                    onChange={(event) => {
                      setGraphLayoutMode(event.target.value as 'radial' | 'grid');
                      resetGraphView();
                    }}
                  >
                    <MenuItem value="radial">{t('knowledgeBase.semanticLayer.graph.layoutRadial')}</MenuItem>
                    <MenuItem value="grid">{t('knowledgeBase.semanticLayer.graph.layoutGrid')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={graphShowRelations}
                      onChange={(event) => setGraphShowRelations(event.target.checked)}
                    />
                  }
                  label={t('knowledgeBase.semanticLayer.graph.showRelations')}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={graphShowStructures}
                      onChange={(event) => setGraphShowStructures(event.target.checked)}
                    />
                  }
                  label={t('knowledgeBase.semanticLayer.graph.showStructures')}
                  disabled={graphMode === 'structure'}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={graphGroupStructuresByDoc}
                      onChange={(event) => setGraphGroupStructuresByDoc(event.target.checked)}
                      disabled={!graphShowStructures}
                    />
                  }
                  label={t('knowledgeBase.semanticLayer.graph.groupStructures')}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={graphCollapseDocuments}
                      onChange={(event) => setGraphCollapseDocuments(event.target.checked)}
                      disabled={!graphShowStructures || !graphGroupStructuresByDoc}
                    />
                  }
                  label={t('knowledgeBase.semanticLayer.graph.collapseDocuments')}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t('knowledgeBase.semanticLayer.graph.structureDepth')}
                  value={graphStructureLevel}
                  onChange={(event) => setGraphStructureLevel(event.target.value)}
                  inputProps={{ min: 0, max: maxStructureLevel, step: 1 }}
                  helperText={t('knowledgeBase.semanticLayer.graph.structureDepthHelper', {
                    max: maxStructureLevel,
                  })}
                  disabled={!graphShowStructuresEffective}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={graphLimitEnabled}
                      onChange={(event) => setGraphLimitEnabled(event.target.checked)}
                    />
                  }
                  label={t('knowledgeBase.semanticLayer.graph.nodeLimitToggle')}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t('knowledgeBase.semanticLayer.graph.nodeLimit')}
                  value={graphMaxNodes}
                  onChange={(event) => setGraphMaxNodes(event.target.value)}
                  inputProps={{ min: GRAPH_MIN_NODE_LIMIT, max: GRAPH_MAX_NODE_LIMIT, step: 50 }}
                  helperText={t('knowledgeBase.semanticLayer.graph.nodeLimitHelper', {
                    min: GRAPH_MIN_NODE_LIMIT,
                    max: GRAPH_MAX_NODE_LIMIT,
                  })}
                  disabled={!graphLimitEnabled}
                />
                <FormControl size="small" fullWidth>
                  <InputLabel>{t('knowledgeBase.semanticLayer.graph.labelMode')}</InputLabel>
                  <Select
                    value={graphLabelMode}
                    label={t('knowledgeBase.semanticLayer.graph.labelMode')}
                    onChange={(event) => setGraphLabelMode(event.target.value as GraphLabelMode)}
                  >
                    {GRAPH_LABEL_MODE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={graphShowAttributes}
                      onChange={(event) => setGraphShowAttributes(event.target.checked)}
                    />
                  }
                  label={t('knowledgeBase.semanticLayer.graph.showAttributes')}
                  disabled={graphMode === 'structure'}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={graphFocusSelection}
                      onChange={(event) => setGraphFocusSelection(event.target.checked)}
                    />
                  }
                  disabled={!selectedCandidate}
                  label={t('knowledgeBase.semanticLayer.graph.focusSelection')}
                />
                {(graphViewMeta.prunedNodes > 0 || graphViewMeta.prunedEdges > 0) && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('knowledgeBase.semanticLayer.graph.prunedNotice', {
                        visible: graphViewMeta.visibleNodes,
                        total: graphViewMeta.totalNodes,
                      })}
                    </Typography>
                    <Button size="small" onClick={showAllGraph}>
                      {t('knowledgeBase.semanticLayer.graph.showAll')}
                    </Button>
                  </Box>
                )}
              </Stack>
            </Paper>
            <Box
              sx={{
                position: 'absolute',
                top: 16,
                right: 16,
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <Tooltip title={t('knowledgeBase.semanticLayer.graph.zoomIn')}>
                <span>
                  <IconButton
                    color="primary"
                    disabled={graphView.nodes.length === 0}
                    onClick={() => zoomGraph(1.2)}
                  >
                    <ZoomInIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('knowledgeBase.semanticLayer.graph.zoomOut')}>
                <span>
                  <IconButton
                    color="primary"
                    disabled={graphView.nodes.length === 0}
                    onClick={() => zoomGraph(0.85)}
                  >
                    <ZoomOutIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('knowledgeBase.semanticLayer.graph.reset')}>
                <span>
                  <IconButton
                    color="primary"
                    disabled={graphView.nodes.length === 0}
                    onClick={resetGraphView}
                  >
                    <ResetIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
            <Box
              sx={{
                width: '100%',
                height: '100%',
                minHeight: '70vh',
                bgcolor: 'background.default',
              }}
            >
              {graphView.nodes.length === 0 ? (
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'text.secondary',
                  }}
                >
                  <Stack spacing={1} alignItems="center">
                    <Typography variant="body2">
                      {t('knowledgeBase.semanticLayer.graph.empty')}
                    </Typography>
                    {graphMode !== 'all' && graphData.nodes.length > 0 && (
                      <Button size="small" variant="outlined" onClick={() => setGraphMode('all')}>
                        {t('knowledgeBase.semanticLayer.graph.modeAll')}
                      </Button>
                    )}
                  </Stack>
                </Box>
              ) : (
                <WebGLGraph
                  nodes={graphView.nodes}
                  edges={graphView.edges}
                  layoutMode={graphLayoutMode}
                  mode={graphMode}
                  groupByDoc={graphGroupStructuresByDoc}
                  labelEnabled={graphLabelEnabled}
                  interactive
                  selectedNodeId={selectedGraphNodeId}
                  selectedEdgeId={selectedGraphEdgeId}
                  focusSelection={graphFocusSelection}
                  onReady={handleDialogGraph}
                />
              )}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default KnowledgeBaseSemantic;
