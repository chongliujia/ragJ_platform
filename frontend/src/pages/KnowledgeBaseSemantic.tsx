import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
  Close as CloseIcon,
  East as EastIcon,
  FactCheck as ReviewIcon,
  OpenInFull as OpenInFullIcon,
  OpenInNew as OpenInNewIcon,
  RestartAlt as ResetIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { knowledgeBaseApi } from '../services/api';
import { authApi } from '../services/authApi';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions } from 'cytoscape';

type CandidateStatus = 'pending' | 'approved' | 'rejected';
type CandidateType = 'entity' | 'relation' | 'attribute';
type ChunkStrategy = 'uniform' | 'leading' | 'head_tail' | 'diverse';
type ExtractionMode = 'direct' | 'summary';
type DiscoveryStatus = 'idle' | 'running' | 'completed' | 'failed';

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
  message?: string;
  updated_at?: string;
}

interface CanonicalEntity {
  name: string;
  aliases: string[];
  attributes: Record<string, any>;
}

type GraphNodeKind = 'entity' | 'attribute';
type GraphEdgeKind = 'relation' | 'attribute';

interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  status: CandidateStatus;
  candidateId?: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  status: CandidateStatus;
  label?: string;
  candidateId?: string;
}

type CytoscapeGraphProps = {
  elements: ElementDefinition[];
  stylesheet: any;
  layout: LayoutOptions;
  interactive: boolean;
  onReady: (cy: Core) => void;
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
const EXTRACTION_MAX_DOCUMENT_LIMIT = 50;
const EXTRACTION_MAX_PROGRESSIVE_ITEMS = 50;
const EXTRACTION_MAX_PROGRESSIVE_STEP = 50;
const EXTRACTION_MAX_SUMMARY_CHARS = 4000;

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

const parseTypeList = (value: string) =>
  value
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const CytoscapeGraph: React.FC<CytoscapeGraphProps> = ({
  elements,
  stylesheet,
  layout,
  interactive,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: stylesheet,
      layout,
      wheelSensitivity: 0.2,
    });
    cy.userZoomingEnabled(interactive);
    cy.userPanningEnabled(interactive);
    cy.autoungrabify(!interactive);
    cy.autounselectify(true);
    cy.boxSelectionEnabled(false);
    cyRef.current = cy;
    onReady(cy);
    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.json({ elements });
    });
    cy.style().fromJson(stylesheet).update();
    cy.userZoomingEnabled(interactive);
    cy.userPanningEnabled(interactive);
    cy.autoungrabify(!interactive);
    cy.autounselectify(true);
    cy.boxSelectionEnabled(false);
    const layoutRun = cy.layout(layout);
    layoutRun.run();
  }, [elements, interactive, layout, stylesheet]);

  return <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />;
};

const STATUS_PRIORITY: Record<CandidateStatus, number> = {
  approved: 3,
  pending: 2,
  rejected: 1,
};
const GRAPH_MIN_ZOOM = 0.05;
const GRAPH_MAX_ZOOM = 2.8;
const normalize = (value: string) => value.trim().toLowerCase();
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
  const [graphFocusSelection, setGraphFocusSelection] = useState(false);
  const graphPreviewRef = useRef<Core | null>(null);
  const graphDialogRef = useRef<Core | null>(null);
  const [maxChunks, setMaxChunks] = useState(String(EXTRACTION_DEFAULT_MAX_CHUNKS));
  const [maxTextChars, setMaxTextChars] = useState(String(EXTRACTION_DEFAULT_MAX_TEXT_CHARS));
  const [maxItems, setMaxItems] = useState(String(EXTRACTION_DEFAULT_MAX_ITEMS));
  const [documentLimit, setDocumentLimit] = useState(String(EXTRACTION_DEFAULT_DOCUMENT_LIMIT));
  const [autoChunking, setAutoChunking] = useState(false);
  const [chunkStrategy, setChunkStrategy] = useState<ChunkStrategy>('uniform');
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(EXTRACTION_DEFAULT_MODE);
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

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId) || null,
    [candidates, selectedId]
  );

  useEffect(() => {
    if (!selectedCandidate && graphFocusSelection) {
      setGraphFocusSelection(false);
    }
  }, [graphFocusSelection, selectedCandidate]);

  const counts = useMemo(
    () => ({
      entities: candidates.filter((c) => c.type === 'entity').length,
      relations: candidates.filter((c) => c.type === 'relation').length,
      attributes: candidates.filter((c) => c.type === 'attribute').length,
    }),
    [candidates]
  );

  const candidateCount = candidates.length;
  const hasCandidates = candidateCount > 0;
  const discoveryStatus = discoveryProgress?.status || 'idle';
  const discoveryTotal = discoveryProgress?.total ?? 0;
  const discoveryCurrent = discoveryProgress?.current ?? 0;
  const discoveryPercent =
    discoveryTotal > 0 ? Math.min(100, Math.round((discoveryCurrent / discoveryTotal) * 100)) : 0;

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

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => filteredCandidates.some((candidate) => candidate.id === id))
    );
    if (selectedId && !filteredCandidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredCandidates, selectedId]);

  const parseError = (err: any, fallback: string) =>
    err?.response?.data?.detail || err?.message || fallback;

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
      }
    }, 1500);
  }, [fetchDiscoveryProgress, stopDiscoveryPolling]);

  const fetchCandidates = async () => {
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
  };

  useEffect(() => {
    fetchCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId]);

  useEffect(() => {
    fetchDiscoveryProgress();
  }, [fetchDiscoveryProgress]);

  useEffect(() => {
    if (discoveryProgress?.status === 'running' && !discoveryPollRef.current) {
      startDiscoveryPolling();
    }
  }, [discoveryProgress, startDiscoveryPolling]);

  useEffect(
    () => () => {
      stopDiscoveryPolling();
    },
    [stopDiscoveryPolling]
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
      progressive_enabled?: boolean;
      progressive_min_items?: number;
      progressive_step?: number;
      summary_max_chars?: number;
      entity_types?: string[];
      relation_types?: string[];
    } = {
      scope,
      include_relations: includeRelations,
    };
    const parsedMaxChunks = parseOptionalInt(maxChunks);
    const parsedMaxTextChars = parseOptionalInt(maxTextChars);
    const parsedMaxItems = parseOptionalInt(maxItems);
    const parsedDocumentLimit = parseOptionalInt(documentLimit);
    const parsedProgressiveMinItems = parseOptionalInt(progressiveMinItems);
    const parsedProgressiveStep = parseOptionalInt(progressiveStep);
    const parsedSummaryMaxChars = parseOptionalInt(summaryMaxChars);
    if (parsedMaxChunks !== undefined) payload.max_chunks = parsedMaxChunks;
    if (parsedMaxTextChars !== undefined) payload.max_text_chars = parsedMaxTextChars;
    if (parsedMaxItems !== undefined) payload.max_items = parsedMaxItems;
    if (parsedDocumentLimit !== undefined) payload.document_limit = parsedDocumentLimit;
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
    payload.progressive_enabled = progressiveEnabled;
    payload.entity_types = parseTypeList(entityTypeWhitelist);
    payload.relation_types = parseTypeList(relationTypeWhitelist);
    try {
      startDiscoveryPolling();
      await knowledgeBaseApi.discoverSemanticCandidates(kbId, {
        ...payload,
      });
      await fetchDiscoveryProgress();
      await fetchCandidates();
    } catch (err: any) {
      setError(parseError(err, t('knowledgeBase.semanticLayer.messages.discoveryError')));
    } finally {
      stopDiscoveryPolling();
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
      default:
        return t('knowledgeBase.semanticLayer.types.entity');
    }
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
  const selectedMerge = selectedCandidate ? mergeMap[selectedCandidate.id] : null;
  const mergeSuggestions = useMemo(
    () => canonicalEntities.map((entity) => entity.name),
    [canonicalEntities]
  );
  const candidateConflicts = selectedCandidate ? getCandidateConflicts(selectedCandidate) : [];
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
  const graphStyles = useMemo(
    () => [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          color: theme.palette.text.primary,
          'background-color': theme.palette.background.paper,
          'border-color': theme.palette.divider,
          'border-width': 1.4,
          shape: 'round-rectangle',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': 160,
          'font-size': 11,
          padding: 8,
          width: 'label',
          height: 'label',
        },
      },
      {
        selector: 'node[kind = "attribute"]',
        style: {
          'font-size': 10,
          padding: 6,
          'text-max-width': 140,
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.2,
          'curve-style': 'bezier',
          'line-color': theme.palette.divider,
          'target-arrow-color': theme.palette.divider,
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.6,
          label: 'data(label)',
          'font-size': 9,
          color: theme.palette.text.secondary,
          'text-wrap': 'wrap',
          'text-max-width': 120,
          'text-background-color': theme.palette.background.paper,
          'text-background-opacity': 0.85,
          'text-background-padding': 2,
        },
      },
      {
        selector: 'edge[kind = "attribute"]',
        style: {
          'line-style': 'dashed',
          'target-arrow-shape': 'none',
        },
      },
      {
        selector: '.status-approved',
        style: {
          'border-color': theme.palette.success.main,
          'background-color': alpha(theme.palette.success.light, 0.2),
          'line-color': theme.palette.success.main,
          'target-arrow-color': theme.palette.success.main,
        },
      },
      {
        selector: '.status-pending',
        style: {
          'border-color': theme.palette.warning.main,
          'background-color': alpha(theme.palette.warning.light, 0.18),
          'line-color': theme.palette.warning.main,
          'target-arrow-color': theme.palette.warning.main,
        },
      },
      {
        selector: '.status-rejected',
        style: {
          'border-color': theme.palette.error.main,
          'background-color': alpha(theme.palette.error.light, 0.2),
          'line-color': theme.palette.error.main,
          'target-arrow-color': theme.palette.error.main,
        },
      },
      {
        selector: '.is-selected',
        style: {
          'border-width': 2.4,
          'border-color': theme.palette.primary.main,
          'line-color': theme.palette.primary.main,
          'target-arrow-color': theme.palette.primary.main,
        },
      },
      {
        selector: '.is-dimmed',
        style: {
          opacity: 0.25,
        },
      },
    ],
    [theme]
  );
  const graphLayout = useMemo(
    () =>
      graphLayoutMode === 'grid'
        ? {
            name: 'grid',
            fit: true,
            padding: 40,
            avoidOverlap: true,
            avoidOverlapPadding: 12,
            animate: false,
            nodeDimensionsIncludeLabels: true,
          }
        : {
            name: 'cose',
            fit: true,
            padding: 50,
            animate: false,
            randomize: true,
            nodeOverlap: 10,
            idealEdgeLength: 120,
            nodeRepulsion: 9000,
            gravity: 1,
            nodeDimensionsIncludeLabels: true,
          },
    [graphLayoutMode]
  );
  const resetGraphView = useCallback(() => {
    const cy = graphDialogRef.current;
    if (!cy) return;
    cy.fit(undefined, 40);
  }, []);
  const zoomGraph = useCallback((factor: number) => {
    const cy = graphDialogRef.current;
    if (!cy) return;
    const container = cy.container();
    const rect = container?.getBoundingClientRect();
    const nextZoom = clamp(cy.zoom() * factor, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
    if (rect) {
      cy.zoom({ level: nextZoom, renderedPosition: { x: rect.width / 2, y: rect.height / 2 } });
      return;
    }
    cy.zoom(nextZoom);
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
    type EntityDraft = {
      key: string;
      id: string;
      label: string;
      status: CandidateStatus;
      candidateId?: string;
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
    const entityMap = new Map<string, EntityDraft>();
    const attributeDrafts: AttributeDraft[] = [];

    const ensureEntity = (name: string, status: CandidateStatus, candidateId?: string) => {
      const key = normalize(name);
      if (!key) return;
      const existing = entityMap.get(key);
      if (!existing) {
        entityMap.set(key, {
          key,
          id: `entity:${key}`,
          label: name,
          status,
          candidateId,
        });
        return;
      }
      const nextStatus =
        STATUS_PRIORITY[status] > STATUS_PRIORITY[existing.status] ? status : existing.status;
      entityMap.set(key, {
        ...existing,
        status: nextStatus,
        candidateId: existing.candidateId ?? candidateId,
      });
    };

    filteredCandidates.forEach((candidate) => {
      if (candidate.type === 'entity') {
        ensureEntity(candidate.name, candidate.status, candidate.id);
      }
    });

    filteredCandidates.forEach((candidate) => {
      if (candidate.type === 'relation' && candidate.relation) {
        ensureEntity(candidate.relation.source, candidate.status);
        ensureEntity(candidate.relation.target, candidate.status);
      }
      if (candidate.type === 'attribute') {
        const entityName = getAttributeEntity(candidate);
        if (!entityName) return;
        ensureEntity(entityName, candidate.status);
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
    const entities = Array.from(entityMap.values());
    entities.forEach((entity) => {
      const node: GraphNode = {
        id: entity.id,
        label: entity.label,
        kind: 'entity',
        status: entity.status,
        candidateId: entity.candidateId,
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

    filteredCandidates.forEach((candidate) => {
      if (candidate.type !== 'relation' || !candidate.relation) return;
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
        label: candidate.relation.relation,
        candidateId: candidate.id,
      });
    });

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    return { nodes, edges, nodeMap };
  }, [filteredCandidates]);

  const selectedGraphNodeId = useMemo(() => {
    if (!selectedCandidate) return null;
    if (selectedCandidate.type === 'entity') {
      return `entity:${normalize(selectedCandidate.name)}`;
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
    let nodes = graphData.nodes;
    let edges = graphData.edges;

    if (!graphShowRelations) {
      edges = edges.filter((edge) => edge.kind !== 'relation');
    }
    if (!graphShowAttributes) {
      edges = edges.filter((edge) => edge.kind !== 'attribute');
      nodes = nodes.filter((node) => node.kind !== 'attribute');
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
    graphShowRelations,
    graphShowAttributes,
    graphFocusSelection,
    selectedGraphEdgeId,
    selectedGraphNodeId,
  ]);

  const hasGraphSelection = Boolean(selectedGraphNodeId || selectedGraphEdgeId);
  const graphElements = useMemo<ElementDefinition[]>(() => {
    const elements: ElementDefinition[] = [];
    graphView.nodes.forEach((node) => {
      elements.push({
        data: {
          id: node.id,
          label: node.label,
          kind: node.kind,
          status: node.status,
        },
        classes: `status-${node.status} kind-${node.kind}`,
      });
    });
    graphView.edges.forEach((edge) => {
      elements.push({
        data: {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          label: edge.kind === 'relation' ? edge.label ?? '' : '',
          kind: edge.kind,
          status: edge.status,
        },
        classes: `status-${edge.status} kind-${edge.kind}`,
      });
    });
    return elements;
  }, [graphView.edges, graphView.nodes]);

  const applyGraphSelection = useCallback(
    (cy: Core | null) => {
      if (!cy) return;
      cy.batch(() => {
        cy.elements().removeClass('is-selected is-dimmed');
        if (!hasGraphSelection) return;
        cy.elements().addClass('is-dimmed');
        let selected = cy.collection();
        if (selectedGraphEdgeId) {
          const edge = cy.getElementById(selectedGraphEdgeId);
          if (edge && edge.length > 0) {
            selected = selected.union(edge).union(edge.connectedNodes());
          }
        }
        if (selectedGraphNodeId) {
          const node = cy.getElementById(selectedGraphNodeId);
          if (node && node.length > 0) {
            const edges = node.connectedEdges();
            selected = selected.union(node).union(edges).union(edges.connectedNodes());
          }
        }
        selected.removeClass('is-dimmed').addClass('is-selected');
      });
    },
    [hasGraphSelection, selectedGraphEdgeId, selectedGraphNodeId]
  );

  useEffect(() => {
    applyGraphSelection(graphPreviewRef.current);
    if (graphDialogOpen) {
      applyGraphSelection(graphDialogRef.current);
    }
  }, [applyGraphSelection, graphDialogOpen, graphElements]);

  const handlePreviewCy = useCallback(
    (cy: Core) => {
      graphPreviewRef.current = cy;
      cy.minZoom(GRAPH_MIN_ZOOM);
      cy.maxZoom(GRAPH_MAX_ZOOM);
      cy.userZoomingEnabled(false);
      cy.userPanningEnabled(false);
      cy.autoungrabify(true);
      cy.autounselectify(true);
      cy.boxSelectionEnabled(false);
      applyGraphSelection(cy);
    },
    [applyGraphSelection]
  );

  const handleDialogCy = useCallback(
    (cy: Core) => {
      graphDialogRef.current = cy;
      cy.minZoom(GRAPH_MIN_ZOOM);
      cy.maxZoom(GRAPH_MAX_ZOOM);
      cy.userZoomingEnabled(true);
      cy.userPanningEnabled(true);
      cy.autoungrabify(false);
      cy.autounselectify(true);
      cy.boxSelectionEnabled(false);
      applyGraphSelection(cy);
    },
    [applyGraphSelection]
  );

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
            <Typography variant="body2">
              {t('knowledgeBase.semanticLayer.progress.running', {
                current: discoveryCurrent,
                total: discoveryTotal,
              })}
            </Typography>
            <LinearProgress
              variant={discoveryTotal > 0 ? 'determinate' : 'indeterminate'}
              value={discoveryPercent}
            />
          </Stack>
        </Alert>
      )}
      {discoveryStatus === 'completed' && discoveryProgress && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setDiscoveryProgress(null)}>
          {t('knowledgeBase.semanticLayer.progress.completed', { total: discoveryTotal })}
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

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
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
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t('knowledgeBase.semanticLayer.graph.empty')}
          </Typography>
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
              <CytoscapeGraph
                elements={graphElements}
                stylesheet={graphStyles}
                layout={graphLayout}
                interactive={false}
                onReady={handlePreviewCy}
              />
            </Box>
          </Box>
        )}
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2 }}>
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h6">{t('knowledgeBase.semanticLayer.listTitle')}</Typography>
              {selectedCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('knowledgeBase.semanticLayer.list.selected', { count: selectedCount })}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1}>
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
          </Tabs>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
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
          <Divider sx={{ my: 2 }} />
          <Table size="small">
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
                filteredCandidates.map((candidate) => (
                  <TableRow
                    key={candidate.id}
                    hover
                    selected={candidate.id === selectedId}
                    onClick={() => setSelectedId(candidate.id)}
                    sx={{ cursor: 'pointer' }}
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
                        <Button
                          size="small"
                          variant="contained"
                          disabled={candidate.status === 'approved'}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(candidate.id);
                            applyStatus([candidate.id], 'approved');
                          }}
                        >
                          {t('knowledgeBase.semanticLayer.list.actions.approve')}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={candidate.status === 'rejected'}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(candidate.id);
                            applyStatus([candidate.id], 'rejected');
                          }}
                        >
                          {t('knowledgeBase.semanticLayer.list.actions.reject')}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('knowledgeBase.semanticLayer.details.title')}
          </Typography>
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
              {selectedCandidate.attributes && Object.keys(selectedCandidate.attributes).length > 0 && (
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
              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
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
                <Button size="small" variant="outlined" onClick={openMergeDialog}>
                  {t('knowledgeBase.semanticLayer.details.actions.merge')}
                </Button>
              </Stack>
            </>
          )}
        </Paper>
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('knowledgeBase.semanticLayer.discoveryDialog.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('knowledgeBase.semanticLayer.discoveryDialog.scope')}</InputLabel>
              <Select
                value={scope}
                label={t('knowledgeBase.semanticLayer.discoveryDialog.scope')}
                onChange={(e) => setScope(String(e.target.value))}
              >
                <MenuItem value="all">{t('knowledgeBase.semanticLayer.discoveryDialog.scopeAll')}</MenuItem>
                <MenuItem value="recent">{t('knowledgeBase.semanticLayer.discoveryDialog.scopeRecent')}</MenuItem>
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch checked={includeRelations} onChange={(e) => setIncludeRelations(e.target.checked)} />
              }
              label={t('knowledgeBase.semanticLayer.discoveryDialog.includeRelations')}
            />
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
                  />
                }
                label={t('knowledgeBase.semanticLayer.discoveryDialog.autoChunking')}
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
          <Button variant="contained" onClick={requestDiscovery}>
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
                      checked={graphShowAttributes}
                      onChange={(event) => setGraphShowAttributes(event.target.checked)}
                    />
                  }
                  label={t('knowledgeBase.semanticLayer.graph.showAttributes')}
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
                <IconButton
                  color="primary"
                  disabled={graphView.nodes.length === 0}
                  onClick={() => zoomGraph(1.2)}
                >
                  <ZoomInIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('knowledgeBase.semanticLayer.graph.zoomOut')}>
                <IconButton
                  color="primary"
                  disabled={graphView.nodes.length === 0}
                  onClick={() => zoomGraph(0.85)}
                >
                  <ZoomOutIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('knowledgeBase.semanticLayer.graph.reset')}>
                <IconButton
                  color="primary"
                  disabled={graphView.nodes.length === 0}
                  onClick={resetGraphView}
                >
                  <ResetIcon />
                </IconButton>
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
                  <Typography variant="body2">
                    {t('knowledgeBase.semanticLayer.graph.empty')}
                  </Typography>
                </Box>
              ) : (
                <CytoscapeGraph
                  elements={graphElements}
                  stylesheet={graphStyles}
                  layout={graphLayout}
                  interactive
                  onReady={handleDialogCy}
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
