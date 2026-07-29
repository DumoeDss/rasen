import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  PipelineCatalogResponse,
  PipelineCatalogSkill,
  PipelineDetailResponse,
  PipelineExportResponse,
  PipelineSaveResponse,
  PipelineValidationIssue,
  ThresholdValue,
  WireDefinitionNode,
  WireDefinitionPreparation,
  WirePipelineDefinition,
  WirePipelineDefinitionStage,
} from '../api/types.js';
import { useSpace, spaceHref } from '../store/use-space.js';
import { definitionToGraph, draftToGraph, layoutGraph, type PipelineFlowNode } from './layout.js';
import { stageNodeTypes } from './StageNode.js';
import {
  addRequire,
  addStage,
  addV2Connection,
  addV2Node,
  definitionIssuePathTarget,
  isDirty,
  isV2EditableNodeKind,
  issuePathTarget,
  loopBodyDeclaration,
  referenceableDeclaration,
  removeRequire,
  removeStage,
  removeV2Connection,
  removeV2Node,
  renameStage,
  renameV2Node,
  stageIdFor,
  updateStageFields,
  updateStageHandoffThreshold,
  updateV2NodeFields,
  v2ConnectionIdFor,
  v2NodeIdFor,
  wouldCreateCycle,
  type V2EditableNodeKind,
} from './draft.js';
import { PalettePanel, PALETTE_DND_TYPE } from './PalettePanel.js';
import { StagePanel } from './StagePanel.js';
import { V2NodePanel } from './V2NodePanel.js';
import { IssuesDrawer } from './IssuesDrawer.js';
import { EngineSupportPanel } from './EngineSupportPanel.js';
import { consumePendingDraft, setPendingDraft } from './pending-draft.js';
import { validatePipelineName } from './pipeline-name.js';

type SaveStatus = 'idle' | 'saving' | 'blocked' | 'collision' | 'busy' | 'error';
interface SaveState {
  status: SaveStatus;
  message?: string;
}

interface ExportState {
  open: boolean;
  path: string;
  status: 'idle' | 'exporting' | 'done' | 'error';
  message?: string;
}

/**
 * The pipeline graph route (`/p/:projectId/pipelines/:name`,
 * `/s/:storeId/pipelines/:name`). View mode is child 3's exact read-only
 * behavior; edit mode (pipeline-canvas-edit) turns the same route into the
 * assembly editor: composition from the palette, a properties panel, a
 * validation overlay, and a validate-then-save flow. This page and its
 * `@xyflow/react`/`dagre` dependencies live behind a lazy route so the canvas
 * chunk never loads for a user who never opens a graph.
 */
export function PipelineCanvasPage() {
  const space = useSpace();
  const selector = space?.selector;
  const { params } = useRoute();
  const { route } = useLocation();
  const name = params.name ?? '';

  const [detail, setDetail] = useState<PipelineDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<WirePipelineDefinition | null>(null);
  const [loadedDefinition, setLoadedDefinition] = useState<WirePipelineDefinition | null>(null);
  const [flowNodes, setFlowNodes] = useState<PipelineFlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<PipelineCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [issues, setIssues] = useState<PipelineValidationIssue[]>([]);
  const [latestPreparation, setLatestPreparation] =
    useState<WireDefinitionPreparation | null>(null);
  // The last validation's outcome, shown as an always-visible result chip beside
  // the Validate/Save controls (pipelines-ui spec). Reset to null on any draft
  // edit so a stale "No issues" can never present against a newer draft.
  const [lastValidation, setLastValidation] = useState<
    { errorCount: number; warningCount: number; clean: boolean } | null
  >(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [exportState, setExportState] = useState<ExportState>({
    open: false,
    path: '',
    status: 'idle',
  });
  // A ref mirror of "a save is in flight" — the `disabled` attribute on the
  // Save/Overwrite/Retry buttons only reflects `saveState` after the next
  // render, so a rapid double-click can call `handleSave` twice before that
  // render happens; the ref is set/read synchronously with the click instead
  // (spec: never submit a second mutation while one is in flight).
  const savingRef = useRef(false);
  const [toast, setToast] = useState('');
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);
  const [duplicateDialog, setDuplicateDialog] = useState<{ name: string; error: string | null } | null>(null);

  const dirty = draft !== null && loadedDefinition !== null && isDirty(draft, loadedDefinition);

  // Detail fetch (view mode) OR pending-draft consumption (new/duplicate drafts, design D6).
  useEffect(() => {
    if (!selector || !name) {
      setLoading(false);
      return;
    }
    const pending = consumePendingDraft(name);
    if (pending) {
      const seed: WirePipelineDefinition = pending.definition
        ? pending.definition.version === 1
          ? { ...pending.definition, name: pending.name, origin: 'ui' }
          : { ...pending.definition, name: pending.name }
        : { version: 1, name: pending.name, origin: 'ui', stages: [] };
      setDetail(null);
      setLoading(false);
      setNotFound(false);
      setPageError(null);
      enterEditWith(seed);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setPageError(null);
    setMode('view');
    setDraft(null);
    setIssues([]);
    setLatestPreparation(null);
    client
      .getPipelineDetail(name, selector)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setIssues([...(res.preparation?.diagnostics ?? [])]);
        setLatestPreparation(
          res.preparation ? structuredClone(res.preparation) : null
        );
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.code === 'not_found' || err.status === 404)) {
          setNotFound(true);
        } else if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'Failed to load the pipeline.' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, selector]);

  // Catalog fetch, once per editor entry (cached for the page's lifetime).
  useEffect(() => {
    if (mode !== 'edit' || catalog || catalogLoading) return;
    setCatalogLoading(true);
    client
      .getPipelineCatalog()
      .then((res) => {
        setCatalog(res);
        if (draft?.version === 2) recomputeFlow(draft, res);
      })
      .catch(() => {
        /* the palette degrades to an empty list; StagePanel vocabularies fall back to no options */
      })
      .finally(() => setCatalogLoading(false));
  }, [mode, catalog, catalogLoading]);

  // Browser unload guard, engaged only while dirty (design D8c).
  useEffect(() => {
    if (mode !== 'edit' || !dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [mode, dirty]);

  // Any draft mutation invalidates the previous validation result (spec:
  // editing after a validation clears the previous result so it never goes
  // stale). Clears the chip, the issue list/drawer, AND the per-node issue
  // badges together (m1) — a partial clear would leave the drawer and glowing
  // nodes asserting stale findings against a newer draft.
  function markDraftChanged() {
    setLastValidation(null);
    setLatestPreparation(null);
    setIssues([]);
    setFlowNodes((nodes) =>
      nodes.map((n) =>
        n.type === 'stage' && n.data.issueSeverity
          ? { ...n, data: { ...n.data, issueSeverity: undefined } }
          : n
      )
    );
    setFlowEdges((edges) =>
      edges.map((edge) =>
        edge.data?.issueSeverity
          ? { ...edge, data: { ...edge.data, issueSeverity: undefined } }
          : edge
      )
    );
  }

  function recomputeFlow(
    def: WirePipelineDefinition,
    catalogOverride: PipelineCatalogResponse | null = catalog
  ) {
    const { nodes, edges } = draftToGraph(def, catalogOverride);
    const laidOut = layoutGraph(nodes, edges).map((node) =>
      node.type === 'stage' && def.version === 1
        ? { ...node, draggable: true, connectable: true, deletable: true }
        : node
    );
    setFlowNodes(laidOut);
    setFlowEdges(edges);
  }

  function enterEditWith(
    seed: WirePipelineDefinition,
    preparation: WireDefinitionPreparation | null = null,
    initialIssues: PipelineValidationIssue[] = []
  ) {
    setDraft(seed);
    setLoadedDefinition(seed);
    setMode('edit');
    setSelectedStageId(null);
    setIssues(initialIssues);
    setLatestPreparation(preparation);
    setLastValidation(null);
    setSaveState({ status: 'idle' });
    setExportState({ open: false, path: '', status: 'idle' });
    recomputeFlow(seed);
    if (initialIssues.length > 0) {
      applyIssueMarkers(initialIssues, seed);
    }
  }

  function enterEdit() {
    if (!detail) return;
    enterEditWith(
      structuredClone(detail.definition),
      detail.preparation ? structuredClone(detail.preparation) : null,
      [...(detail.preparation?.diagnostics ?? [])]
    );
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  }

  function requestExit(action: () => void) {
    if (dirty) {
      setPendingExit(() => action);
    } else {
      action();
    }
  }

  function backToViewAfterDiscard() {
    setMode('view');
    setDraft(null);
    setLoadedDefinition(null);
    setSelectedStageId(null);
    setIssues([]);
    setLatestPreparation(null);
    setLastValidation(null);
    setSaveState({ status: 'idle' });
  }

  function discard() {
    if (detail) {
      backToViewAfterDiscard();
    } else {
      route(backHref);
    }
  }

  function applyIssueMarkers(nextIssues: PipelineValidationIssue[], def: WirePipelineDefinition) {
    const severityByNode = new Map<string, 'error' | 'warning'>();
    const severityByEdge = new Map<string, 'error' | 'warning'>();
    const recordSeverity = (
      target: Map<string, 'error' | 'warning'>,
      id: string,
      severity: 'error' | 'warning'
    ) => {
      if (target.get(id) !== 'error') target.set(id, severity);
    };
    for (const issue of nextIssues) {
      const target = definitionIssuePathTarget(def, issue.path);
      if (!target) continue;
      if (target.kind === 'node') {
        recordSeverity(severityByNode, target.id, issue.severity);
        continue;
      }
      recordSeverity(severityByEdge, target.id, issue.severity);
      if (def.version === 2) {
        const consumingNode = def.root.connections[target.index]?.to.node;
        if (consumingNode) {
          recordSeverity(severityByNode, consumingNode, issue.severity);
        }
      }
    }
    setFlowNodes((nodes) =>
      nodes.map((node) =>
        node.type === 'stage'
          ? {
              ...node,
              data: {
                ...node.data,
                issueSeverity: severityByNode.get(node.id),
              },
            }
          : node
      )
    );
    setFlowEdges((edges) =>
      edges.map((edge) => ({
        ...edge,
        data: {
          ...edge.data,
          issueSeverity: severityByEdge.get(edge.id),
        },
      }))
    );
  }

  async function runValidate(def: WirePipelineDefinition) {
    if (!selector) return null;
    try {
      const res = await client.validatePipeline(def, selector);
      setIssues(res.issues);
      setLatestPreparation(res.preparation ?? null);
      applyIssueMarkers(res.issues, def);
      const errorCount = res.issues.filter((i) => i.severity === 'error').length;
      const warningCount = res.issues.filter((i) => i.severity === 'warning').length;
      setLastValidation({ errorCount, warningCount, clean: res.issues.length === 0 });
      return res;
    } catch (err) {
      setSaveState({ status: 'error', message: err instanceof ApiError ? err.message : 'Validation failed.' });
      return null;
    }
  }

  async function handleValidate() {
    if (!draft) return;
    setSaveState({ status: 'idle' });
    setExportState({ open: false, path: '', status: 'idle' });
    await runValidate(
      draft.version === 1 ? { ...draft, origin: 'ui' } : draft
    );
  }

  async function handleSave(force = false) {
    if (!draft || !selector) return;
    // Guard against a second concurrent save mutation (rapid double-click on
    // Save/Overwrite/Retry): the buttons' `disabled` attribute only reflects
    // `saveState` after the next render, so a ref is read/set synchronously
    // with the click instead (spec: never submit a second mutation while one
    // is in flight).
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const withOrigin: WirePipelineDefinition =
        draft.version === 1 ? { ...draft, origin: 'ui' } : draft;
      setSaveState({ status: 'saving' });
      const validation = await runValidate(withOrigin);
      if (!validation) {
        // runValidate already surfaced the validation-API failure as
        // saveState = error (M1): do NOT clobber it back to idle, or the Save
        // path goes silent when the server hiccups — the spec requires save
        // feedback to always be visible.
        return;
      }
      const blockingCount = validation.issues.filter((i) => i.severity === 'error').length;
      if (blockingCount > 0) {
        setSaveState({
          status: 'blocked',
          message: `${blockingCount} blocking issue${blockingCount === 1 ? '' : 's'} below — fix ${blockingCount === 1 ? 'it' : 'them'} before saving.`,
        });
        return;
      }
      try {
        const result = (await client.mutatePipeline({
          op: 'save',
          name: withOrigin.name,
          definition: withOrigin,
          force,
        })) as PipelineSaveResponse;
        const refreshed = await client.getPipelineDetail(withOrigin.name, selector);
        setDetail(refreshed);
        setLoadedDefinition(refreshed.definition);
        setDraft(null);
        setMode('view');
        setIssues([]);
        setSelectedStageId(null);
        setSaveState({ status: 'idle', message: result.created ? 'Created.' : 'Saved.' });
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 409) setSaveState({ status: 'busy', message: err.message });
          else if (err.status === 422 && !force) setSaveState({ status: 'collision', message: err.message });
          else setSaveState({ status: 'error', message: err.message });
        } else {
          setSaveState({ status: 'error', message: 'Save failed.' });
        }
      }
    } finally {
      savingRef.current = false;
    }
  }

  async function handleExport(event: Event) {
    event.preventDefault();
    if (!draft || draft.version !== 2 || !selector || !exportState.path.trim()) {
      return;
    }
    if (dirty) {
      setExportState((state) => ({
        ...state,
        status: 'error',
        message: 'Save the validated draft before exporting it.',
      }));
      return;
    }
    setExportState((state) => ({
      ...state,
      status: 'exporting',
      message: undefined,
    }));
    const validation = await runValidate(draft);
    if (
      !validation ||
      validation.issues.some((issue) => issue.severity === 'error')
    ) {
      setExportState((state) => ({
        ...state,
        status: 'error',
        message: 'Export is blocked until the Definition is valid.',
      }));
      return;
    }
    try {
      const result = (await client.mutatePipeline({
        op: 'export',
        name: draft.name,
        path: exportState.path.trim(),
      })) as PipelineExportResponse;
      setExportState((state) => ({
        ...state,
        status: 'done',
        message: `Exported to ${result.pipeline.path}`,
      }));
    } catch (error) {
      setExportState((state) => ({
        ...state,
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Export failed.',
      }));
    }
  }

  function onConnect(connection: Connection) {
    if (!draft || !connection.source || !connection.target) return;
    if (wouldCreateCycle(draft, connection.source, connection.target)) {
      showToast(`Rejected: ${connection.source} → ${connection.target} would create a cycle`);
      return;
    }
    if (draft.version === 2) {
      if (!connection.sourceHandle || !connection.targetHandle) {
        showToast('Rejected: choose a typed source and target port.');
        return;
      }
      const sourceNode = draft.root.nodes.find(
        (node) => node.id === connection.source
      );
      const targetNode = draft.root.nodes.find(
        (node) => node.id === connection.target
      );
      if (
        !sourceNode ||
        !targetNode ||
        !isV2EditableNodeKind(sourceNode.kind) ||
        !isV2EditableNodeKind(targetNode.kind)
      ) {
        showToast(
          'Rejected: this connection touches a preserved read-only node.'
        );
        return;
      }
      const endpoints = {
        source: connection.source,
        sourcePort: connection.sourceHandle,
        target: connection.target,
        targetPort: connection.targetHandle,
      };
      const nextDraft = addV2Connection(draft, {
        id: v2ConnectionIdFor(draft, endpoints),
        from: { node: endpoints.source, port: endpoints.sourcePort },
        to: { node: endpoints.target, port: endpoints.targetPort },
      });
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
      return;
    }
    setDraft(addRequire(draft, connection.source, connection.target));
    setFlowEdges((eds) => addEdge({ ...connection, id: `${connection.source}->${connection.target}` }, eds));
    markDraftChanged();
  }

  function onNodesChange(changes: NodeChange[]) {
    const removed = changes.filter((c) => c.type === 'remove');
    if (removed.length > 0 && draft) {
      if (draft.version === 2) {
        let nextDraft = draft;
        for (const change of removed) {
          const id = (change as { id: string }).id;
          const node = nextDraft.root.nodes.find(
            (candidate) => candidate.id === id
          );
          if (node && isV2EditableNodeKind(node.kind)) {
            nextDraft = removeV2Node(nextDraft, id);
          }
        }
        setDraft(nextDraft);
        recomputeFlow(nextDraft);
        if (
          selectedStageId &&
          !nextDraft.root.nodes.some((node) => node.id === selectedStageId)
        ) {
          setSelectedStageId(null);
        }
        markDraftChanged();
        return;
      }
      let nextDraft = draft;
      for (const change of removed) nextDraft = removeStage(nextDraft, (change as { id: string }).id);
      setDraft(nextDraft);
      const removedIds = new Set(removed.map((c) => (c as { id: string }).id));
      setFlowEdges((eds) => eds.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)));
      if (selectedStageId && removedIds.has(selectedStageId)) setSelectedStageId(null);
      markDraftChanged();
    }
    setFlowNodes((nds) => applyNodeChanges(changes, nds) as PipelineFlowNode[]);
  }

  function onEdgesChange(changes: EdgeChange[]) {
    const removed = changes.filter((c) => c.type === 'remove');
    if (removed.length > 0 && draft) {
      if (draft.version === 2) {
        let nextDraft = draft;
        for (const change of removed) {
          const id = (change as { id: string }).id;
          const connection = nextDraft.root.connections.find(
            (candidate) => candidate.id === id
          );
          if (!connection) continue;
          const sourceNode = nextDraft.root.nodes.find(
            (node) => node.id === connection.from.node
          );
          const targetNode = nextDraft.root.nodes.find(
            (node) => node.id === connection.to.node
          );
          if (
            sourceNode &&
            targetNode &&
            isV2EditableNodeKind(sourceNode.kind) &&
            isV2EditableNodeKind(targetNode.kind)
          ) {
            nextDraft = removeV2Connection(nextDraft, id);
          }
        }
        setDraft(nextDraft);
        recomputeFlow(nextDraft);
        markDraftChanged();
        return;
      }
      let nextDraft = draft;
      for (const change of removed) {
        const edge = flowEdges.find((e) => e.id === (change as { id: string }).id);
        if (edge) nextDraft = removeRequire(nextDraft, edge.source, edge.target);
      }
      setDraft(nextDraft);
      markDraftChanged();
    }
    setFlowEdges((eds) => applyEdgeChanges(changes, eds));
  }

  function onNodeClick(_event: unknown, node: { id: string; type?: string }) {
    if (node.type === 'stage') setSelectedStageId(node.id);
  }

  function onPaneClick() {
    setSelectedStageId(null);
  }

  function onDropStage(skill: PipelineCatalogSkill, position: { x: number; y: number }) {
    if (!draft || draft.version !== 1 || !skill.enabled) return;
    const id = stageIdFor(skill.id, draft);
    const newStage: WirePipelineDefinitionStage = {
      id,
      kind: 'standard',
      skill: skill.id,
      requires: [],
      gate: catalog?.gate.default ?? false,
      leadReview: false,
    };
    setDraft(addStage(draft, newStage));
    const newNode: PipelineFlowNode = {
      id,
      type: 'stage',
      position,
      draggable: true,
      connectable: true,
      data: {
        id,
        role: null,
        skill: skill.id,
        effectiveGate: { value: newStage.gate, source: 'draft' },
        effectiveModel: { value: null, source: 'draft' },
        effectiveHandoff: { value: 0.5, source: 'draft' },
        effectiveRuntime: { value: 'claude', source: 'draft' },
      },
    };
    setFlowNodes((nodes) => [...nodes, newNode]);
    markDraftChanged();
  }

  function addV2RootNode(kind: V2EditableNodeKind) {
    if (!draft || draft.version !== 2) return;
    const id = v2NodeIdFor(kind, draft);
    let node: WireDefinitionNode;
    if (kind === 'AtomicStage') {
      const capability = (catalog?.skills ?? []).find(
        (skill) => skill.enabled && skill.capability
      )?.capability;
      if (!capability) {
        showToast('No enabled exact capability revision is available.');
        return;
      }
      node = {
        id,
        kind,
        capability: { id: capability.id, version: capability.version },
      };
    } else if (kind === 'Gate') {
      node = { id, kind, outcomes: ['approved', 'rejected'] };
    } else if (kind === 'Choice') {
      node = { id, kind, outcomes: ['default'] };
    } else if (kind === 'CompositeRef') {
      const declaration = referenceableDeclaration(draft);
      if (!declaration) {
        showToast('No declaration available to reference.');
        return;
      }
      node = { id, kind, declarationId: declaration.id };
    } else if (kind === 'BoundedLoop') {
      const declaration = loopBodyDeclaration(draft);
      if (!declaration) {
        showToast('No declaration available for loop body.');
        return;
      }
      node = {
        id,
        kind,
        body: declaration.id,
        limits: { maxIterations: 3 },
        exits: {
          clean: { action: 'exit', outcome: draft.outcomes[0] ?? 'done' },
          needs_fix: { action: 'continue' },
        },
      };
    } else {
      node = {
        id,
        kind,
        outcome: draft.outcomes[0] ?? 'done',
      };
    }
    const nextDraft = addV2Node(draft, node);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    setSelectedStageId(id);
    markDraftChanged();
  }

  function patchV2Node(
    id: string,
    patch: Partial<WireDefinitionNode>
  ): boolean {
    if (!draft || draft.version !== 2) return false;
    const node = draft.root.nodes.find((candidate) => candidate.id === id);
    if (!node || !isV2EditableNodeKind(node.kind)) return false;
    const nextDraft = updateV2NodeFields(draft, id, patch);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
    return true;
  }

  function renameSelectedV2Node(newId: string) {
    if (!draft || draft.version !== 2 || !selectedStageId) return;
    const node = draft.root.nodes.find(
      (candidate) => candidate.id === selectedStageId
    );
    if (
      !node ||
      !isV2EditableNodeKind(node.kind) ||
      newId === selectedStageId ||
      draft.root.nodes.some((candidate) => candidate.id === newId)
    ) {
      return;
    }
    const nextDraft = renameV2Node(draft, selectedStageId, newId);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    setSelectedStageId(newId);
    markDraftChanged();
  }

  function patchStage(id: string, patch: Partial<WirePipelineDefinitionStage>) {
    if (!draft || draft.version !== 1) return;
    const nextDraft = updateStageFields(draft, id, patch);
    setDraft(nextDraft);
    markDraftChanged();
    if ('parallelGroup' in patch) {
      // Structural edit — group membership changed, re-run auto-layout so
      // group containers stay truthful (design D4).
      recomputeFlow(nextDraft);
      return;
    }
    setFlowNodes((nodes) =>
      nodes.map((n) => {
        if (n.id !== id || n.type !== 'stage') return n;
        const stage = nextDraft.stages.find((s) => s.id === id);
        if (!stage) return n;
        return {
          ...n,
          data: {
            ...n.data,
            role: stage.role ?? null,
            skill: stage.skill ?? null,
            effectiveGate: { value: stage.gate, source: 'draft' },
            effectiveModel: { value: stage.model ?? null, source: 'draft' },
            effectiveRuntime: { value: stage.runtime ?? 'claude', source: 'draft' },
          },
        };
      })
    );
  }

  function patchStageHandoffThreshold(
    id: string,
    threshold: ThresholdValue | undefined
  ) {
    if (!draft || draft.version !== 1) return;
    const nextDraft = updateStageHandoffThreshold(draft, id, threshold);
    setDraft(nextDraft);
    markDraftChanged();
    setFlowNodes((nodes) =>
      nodes.map((node) =>
        node.id === id && node.type === 'stage'
          ? {
              ...node,
              data: {
                ...node.data,
                effectiveHandoff: {
                  value: threshold ?? 0.5,
                  source: 'draft',
                },
              },
            }
          : node
      )
    );
  }

  function renameSelectedStage(newId: string) {
    if (!draft || draft.version !== 1 || !selectedStageId) return;
    const nextDraft = renameStage(draft, selectedStageId, newId);
    setDraft(nextDraft);
    markDraftChanged();
    setFlowNodes((nodes) =>
      nodes.map((n) =>
        n.id === selectedStageId && n.type === 'stage' ? { ...n, id: newId, data: { ...n.data, id: newId } } : n
      )
    );
    // The id rewrite below assumes an edge's source and target are never BOTH
    // `selectedStageId` at once — relies on the no-self-edges invariant
    // (`wouldCreateCycle` rejects a self-loop, so a stage can never require
    // itself) — otherwise the `${newId}->${e.target}` branch would silently
    // drop a rewritten target half of a self-referencing id.
    setFlowEdges((eds) =>
      eds.map((e) => ({
        ...e,
        id: e.id === `${selectedStageId}->${e.target}` || e.source === selectedStageId ? `${newId}->${e.target}` : e.id,
        source: e.source === selectedStageId ? newId : e.source,
        target: e.target === selectedStageId ? newId : e.target,
      }))
    );
    setSelectedStageId(newId);
  }

  function relayout() {
    if (!draft) return;
    recomputeFlow(draft);
  }

  function startDuplicate() {
    setDuplicateDialog({ name: '', error: null });
  }

  function submitDuplicate(event: Event) {
    event.preventDefault();
    if (!duplicateDialog || !detail || !space) return;
    const validationError = validatePipelineName(duplicateDialog.name);
    if (validationError) {
      setDuplicateDialog({ ...duplicateDialog, error: validationError });
      return;
    }
    const newName = duplicateDialog.name.trim();
    setPendingDraft({ name: newName, definition: detail.definition });
    setDuplicateDialog(null);
    route(spaceHref(space, 'pipelines', newName));
  }

  function startAssembling() {
    if (!name) return;
    setPendingDraft({ name });
    enterEditWith({ version: 1, name, origin: 'ui', stages: [] });
  }

  const backHref = space ? spaceHref(space, 'pipelines') : '/';

  const selectedStage = useMemo(
    () =>
      draft?.version === 1 && selectedStageId
        ? draft.stages.find((stage) => stage.id === selectedStageId) ?? null
        : null,
    [draft, selectedStageId]
  );
  const selectedV2Node = useMemo(
    () =>
      draft?.version === 2 && selectedStageId
        ? draft.root.nodes.find((node) => node.id === selectedStageId) ?? null
        : null,
    [draft, selectedStageId]
  );
  const existingGroups = useMemo(
    () =>
      draft?.version === 1
        ? Array.from(
            new Set(
              draft.stages
                .map((stage) => stage.parallelGroup)
                .filter((group): group is string => !!group)
            )
          )
        : [],
    [draft]
  );
  /** Field-level issue severities for the currently open stage panel (design D5's "panel field highlight"). */
  const selectedStageFieldIssues = useMemo(() => {
    const result: Record<string, 'error' | 'warning'> = {};
    if (!draft || draft.version !== 1 || !selectedStageId) return result;
    for (const issue of issues) {
      const target = issuePathTarget(issue.path, draft.stages.length);
      if (!target || !target.field) continue;
      if (draft.stages[target.stageIndex]?.id !== selectedStageId) continue;
      if (result[target.field] !== 'error') result[target.field] = issue.severity;
    }
    return result;
  }, [draft, selectedStageId, issues]);
  const selectedV2NodeFieldIssues = useMemo(() => {
    const result: Record<string, 'error' | 'warning'> = {};
    if (!draft || draft.version !== 2 || !selectedStageId) return result;
    for (const issue of issues) {
      const target = definitionIssuePathTarget(draft, issue.path);
      if (
        target?.kind !== 'node' ||
        target.id !== selectedStageId ||
        !target.field
      ) {
        continue;
      }
      if (result[target.field] !== 'error') {
        result[target.field] = issue.severity;
      }
    }
    return result;
  }, [draft, selectedStageId, issues]);

  if (!selector) {
    return (
      <p class="pipeline-canvas__no-space" data-testid="pipeline-canvas-no-space">
        Pick a planning space to view a pipeline graph.
      </p>
    );
  }

  if (loading) {
    return <p class="pipeline-canvas__loading" data-testid="pipeline-canvas-loading">Loading pipeline…</p>;
  }

  if (notFound && mode === 'view') {
    return (
      <div class="pipeline-canvas__not-found" data-testid="pipeline-canvas-not-found">
        <h2>Pipeline not found</h2>
        <p>
          No pipeline named <code>{name}</code> in this space.
        </p>
        <button type="button" data-testid="pipeline-canvas-start-assembling" onClick={startAssembling}>
          Start assembling &quot;{name}&quot;
        </button>
        <a href={backHref}>← Back to Pipelines</a>
      </div>
    );
  }

  if (mode === 'view' && (pageError || !detail)) {
    return (
      <div class="pipeline-canvas__error" data-testid="pipeline-canvas-error">
        <p>
          {pageError?.message ?? 'Failed to load the pipeline.'}
          {pageError?.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <a href={backHref}>← Back to Pipelines</a>
      </div>
    );
  }

  const editable = mode === 'edit';
  // Computed once as a plain boolean, not re-derived inside the collision/busy
  // JSX blocks below — TS narrows `saveState.status` to their own literal
  // there (it can never actually be 'saving' while those blocks are showing,
  // since a save in flight replaces them), which would make an inline
  // `saveState.status === 'saving'` a compile error rather than useful.
  const isSaving = saveState.status === 'saving';
  const v2Preparation =
    draft?.version === 2
      ? latestPreparation ??
        (!dirty && detail?.definition.version === 2
          ? detail.preparation ?? null
          : null)
      : null;
  const v2DefinitionValid = v2Preparation?.definitionValid ?? null;

  return (
    <div class="pipeline-canvas" data-testid="pipeline-canvas-page">
      <div class="pipeline-canvas__header">
        <a
          class="pipeline-canvas__back"
          href={backHref}
          onClick={(e) => {
            if (editable) {
              e.preventDefault();
              requestExit(() => route(backHref));
            }
          }}
        >
          ← Pipelines
        </a>
        {mode === 'view' && detail && (
          <>
            <h2 class="pipeline-canvas__name">{detail.pipeline.name}</h2>
            <span
              class={`pipeline-section__provenance pipeline-section__provenance--${detail.pipeline.provenance}`}
              data-testid="pipeline-canvas-provenance"
            >
              {detail.pipeline.provenance}
            </span>
            {/* Engine support analysis (task 14.7/14.8): renders the SAME
                shared analyzer's availableEngines/reconcilerSupport/profileDigest/
                reason that `pipeline show`/`pipeline start`/management detail use.
                LEGACY_NORMALIZED executionMode is kept as separate compat info. */}
            <EngineSupportPanel pipeline={detail.pipeline} />
            {!detail.editable && (
              <>
                <span class="pipeline-canvas__readonly" data-testid="pipeline-canvas-readonly-notice">
                  Built-in — read-only
                </span>
                <button type="button" data-testid="pipeline-canvas-duplicate" onClick={startDuplicate}>
                  Duplicate to edit
                </button>
              </>
            )}
            {detail.editable && (
              <button
                type="button"
                data-testid="pipeline-canvas-edit"
                disabled={detail.preparation?.definitionValid === false}
                title={
                  detail.preparation?.definitionValid === false
                    ? 'This invalid authored definition is shown read-only; fix the source diagnostics before editing.'
                    : undefined
                }
                onClick={enterEdit}
              >
                Edit
              </button>
            )}
          </>
        )}
        {editable && draft && (
          <>
            <h2 class="pipeline-canvas__name">{draft.name}</h2>
            {dirty && (
              <span class="pipeline-canvas__dirty-chip" data-testid="pipeline-canvas-dirty-chip">
                Unsaved changes
              </span>
            )}
            <input
              type="text"
              class="pipeline-canvas__description-input"
              data-testid="pipeline-canvas-description"
              placeholder="Description"
              value={draft.description ?? ''}
              onInput={(e) => {
                setDraft({ ...draft, description: (e.target as HTMLInputElement).value || undefined });
                markDraftChanged();
              }}
            />
            <button type="button" class="btn--ghost" data-testid="pipeline-canvas-relayout" onClick={relayout}>
              Re-layout
            </button>
            <button type="button" data-testid="pipeline-canvas-validate" onClick={handleValidate}>
              Validate
            </button>
            <button
              type="button"
              class="btn--primary"
              data-testid="pipeline-canvas-save"
              disabled={
                isSaving ||
                (draft.version === 2 && v2DefinitionValid === false)
              }
              onClick={() => handleSave(false)}
            >
              {saveState.status === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" class="btn--ghost" data-testid="pipeline-canvas-discard" onClick={discard}>
              Discard
            </button>
            {draft.version === 2 && (
              <>
                <button
                  type="button"
                  data-testid="pipeline-canvas-export"
                  disabled={v2DefinitionValid === false}
                  onClick={() =>
                    setExportState((state) => ({
                      ...state,
                      open: true,
                      status: 'idle',
                      message: undefined,
                    }))
                  }
                >
                  Export
                </button>
                <button
                  type="button"
                  data-testid="pipeline-canvas-run"
                  disabled
                  title={
                    v2Preparation?.unavailableReason ??
                    'Validate to check runtime availability.'
                  }
                >
                  Run ·{' '}
                  {v2Preparation?.unavailableReason ??
                    'runtime availability unknown'}
                </button>
                {v2Preparation && (
                  <span class="pipeline-canvas__capability-states">
                    <span data-testid="pipeline-canvas-state-valid">
                      {v2Preparation.definitionValid ? 'Valid' : 'Invalid'}
                    </span>
                    <span data-testid="pipeline-canvas-state-plan">
                      {v2Preparation.planAvailable
                        ? 'Plan available'
                        : 'Plan unavailable'}
                    </span>
                    <span data-testid="pipeline-canvas-state-executable">
                      {v2Preparation.executable
                        ? 'Executable'
                        : 'Not executable'}
                    </span>
                  </span>
                )}
              </>
            )}
            {lastValidation && (
              <span
                class={`pipeline-canvas__validation pipeline-canvas__validation--${lastValidation.clean ? 'clean' : lastValidation.errorCount > 0 ? 'error' : 'warning'}`}
                data-testid="pipeline-canvas-validation-result"
                role="status"
              >
                {lastValidation.clean
                  ? '✓ No issues'
                  : `✕ ${lastValidation.errorCount} error${lastValidation.errorCount === 1 ? '' : 's'}` +
                    (lastValidation.warningCount > 0
                      ? ` · ${lastValidation.warningCount} warning${lastValidation.warningCount === 1 ? '' : 's'}`
                      : '')}
              </span>
            )}
          </>
        )}
      </div>

      {saveState.status === 'blocked' && (
        <p class="pipeline-canvas__save-message pipeline-canvas__save-message--error" data-testid="pipeline-canvas-save-blocked">
          {saveState.message}
        </p>
      )}
      {saveState.status === 'collision' && (
        <div class="pipeline-canvas__save-message pipeline-canvas__save-message--error" data-testid="pipeline-canvas-save-collision">
          <p>{saveState.message}</p>
          <button
            type="button"
            data-testid="pipeline-canvas-save-overwrite"
            disabled={isSaving}
            onClick={() => handleSave(true)}
          >
            Overwrite and save
          </button>
        </div>
      )}
      {saveState.status === 'busy' && (
        <div class="pipeline-canvas__save-message pipeline-canvas__save-message--warning" data-testid="pipeline-canvas-save-busy">
          <p>{saveState.message}</p>
          <button
            type="button"
            data-testid="pipeline-canvas-save-retry"
            disabled={isSaving}
            onClick={() => handleSave(false)}
          >
            Retry
          </button>
        </div>
      )}
      {saveState.status === 'error' && (
        <p class="pipeline-canvas__save-message pipeline-canvas__save-message--error" data-testid="pipeline-canvas-save-error">
          {saveState.message}
        </p>
      )}
      {saveState.status === 'idle' && saveState.message && (
        <p class="pipeline-canvas__save-message pipeline-canvas__save-message--success" data-testid="pipeline-canvas-save-success">
          {saveState.message}
        </p>
      )}

      {exportState.open && draft?.version === 2 && (
        <form
          class="pipeline-canvas__confirm"
          data-testid="pipeline-canvas-export-dialog"
          onSubmit={handleExport}
        >
          <label>
            <span>Export package path</span>
            <input
              data-testid="pipeline-canvas-export-path"
              value={exportState.path}
              onInput={(event) =>
                setExportState((state) => ({
                  ...state,
                  path: (event.target as HTMLInputElement).value,
                  status: 'idle',
                  message: undefined,
                }))
              }
            />
          </label>
          <button
            type="submit"
            data-testid="pipeline-canvas-export-submit"
            disabled={
              exportState.status === 'exporting' ||
              exportState.path.trim().length === 0 ||
              v2DefinitionValid === false
            }
          >
            {exportState.status === 'exporting' ? 'Exporting…' : 'Export'}
          </button>
          <button
            type="button"
            onClick={() =>
              setExportState({ open: false, path: '', status: 'idle' })
            }
          >
            Cancel
          </button>
          {exportState.message && (
            <span data-testid="pipeline-canvas-export-message">
              {exportState.message}
            </span>
          )}
        </form>
      )}

      {pendingExit && (
        <div class="pipeline-canvas__confirm" data-testid="pipeline-canvas-nav-confirm">
          <p>You have unsaved changes. Discard them and continue?</p>
          <button
            type="button"
            data-testid="pipeline-canvas-nav-confirm-discard"
            onClick={() => {
              const action = pendingExit;
              setPendingExit(null);
              backToViewAfterDiscard();
              action();
            }}
          >
            Discard and continue
          </button>
          <button type="button" data-testid="pipeline-canvas-nav-confirm-stay" onClick={() => setPendingExit(null)}>
            Keep editing
          </button>
        </div>
      )}

      {duplicateDialog && (
        <div class="pipeline-canvas__dialog-overlay" data-testid="pipeline-canvas-duplicate-dialog">
          <form class="pipeline-canvas__dialog" onSubmit={submitDuplicate}>
            <label>
              <span>New pipeline name</span>
              <input
                type="text"
                data-testid="pipeline-canvas-duplicate-name"
                value={duplicateDialog.name}
                onInput={(e) => setDuplicateDialog({ name: (e.target as HTMLInputElement).value, error: null })}
              />
            </label>
            {duplicateDialog.error && (
              <p class="pipeline-canvas__dialog-error" role="alert" data-testid="pipeline-canvas-duplicate-error">
                {duplicateDialog.error}
              </p>
            )}
            <div class="pipeline-canvas__dialog-actions">
              <button type="submit" data-testid="pipeline-canvas-duplicate-submit">
                Duplicate
              </button>
              <button type="button" data-testid="pipeline-canvas-duplicate-cancel" onClick={() => setDuplicateDialog(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div class="pipeline-canvas__body">
        {editable && (
          <PalettePanel
            skills={catalog?.skills ?? null}
            loading={catalogLoading}
            definitionVersion={draft?.version ?? 1}
            // Same rule the insertion uses, read once — a CompositeRef needs a
            // referenceable declaration and a BoundedLoop needs one with a body.
            disabledKinds={
              draft?.version === 2
                ? [
                    ...(referenceableDeclaration(draft) ? [] : (['CompositeRef'] as const)),
                    ...(loopBodyDeclaration(draft) ? [] : (['BoundedLoop'] as const)),
                  ]
                : undefined
            }
            onAddV2Node={addV2RootNode}
          />
        )}

        {/* The flow and the issues drawer share one vertical column so the
            drawer is a bottom panel of the canvas, always on-screen inside the
            viewport-locked page (pipelines-ui spec). */}
        <div class="pipeline-canvas__flow-column">
          <div class="pipeline-canvas__flow" data-testid="pipeline-canvas-flow">
            {toast && (
              <div class="pipeline-canvas__toast" data-testid="pipeline-canvas-toast">
                {toast}
              </div>
            )}
            <ReactFlowProvider>
              <CanvasFlow
                nodes={mode === 'view' ? viewFlowNodes(detail) : flowNodes}
                edges={mode === 'view' ? viewFlowEdges(detail) : flowEdges}
                editable={editable}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onDropStage={onDropStage}
              />
            </ReactFlowProvider>
          </div>

          {(editable ? draft : detail?.definition) && issues.length > 0 && (
            <IssuesDrawer
              issues={issues}
              draft={(editable ? draft : detail!.definition)!}
              onSelectStage={(id) => setSelectedStageId(id)}
              onDismiss={
                editable
                  ? () => {
                      setIssues([]);
                      // Don't orphan the blocked-save message (which points "below")
                      // once its issue list is gone (m2).
                      if (saveState.status === 'blocked') {
                        setSaveState({ status: 'idle' });
                      }
                    }
                  : undefined
              }
            />
          )}
        </div>

        {editable && selectedStage && (
          <StagePanel
            // Remounts the panel on selection change so its local Id-input
            // draft state (`useState(stage.id)`) re-initializes from the
            // newly-selected stage instead of carrying over the previous
            // stage's typed value — otherwise switching selection updates
            // every prop-driven field but leaves the Id input stale (a QA
            // finding on pipeline-canvas-edit; display-only, the definition
            // sent to the API was always correct).
            key={selectedStage.id}
            stage={selectedStage}
            catalog={catalog}
            existingGroups={existingGroups}
            fieldIssues={selectedStageFieldIssues}
            onRename={renameSelectedStage}
            onPatch={(patch) => patchStage(selectedStage.id, patch)}
            onHandoffThreshold={(threshold) =>
              patchStageHandoffThreshold(selectedStage.id, threshold)
            }
            onClose={() => setSelectedStageId(null)}
          />
        )}
        {editable && selectedV2Node && (
          <V2NodePanel
            key={selectedV2Node.id}
            node={selectedV2Node}
            catalog={catalog}
            definition={draft?.version === 2 ? draft : null}
            fieldIssues={selectedV2NodeFieldIssues}
            onRename={renameSelectedV2Node}
            onPatch={(patch) => patchV2Node(selectedV2Node.id, patch)}
            onClose={() => setSelectedStageId(null)}
          />
        )}
      </div>
    </div>
  );
}

/** Rebuilds view-mode nodes/edges from the loaded detail — child 3's exact read-only computation (`definitionToGraph`), unchanged. */
function viewFlowNodes(detail: PipelineDetailResponse | null): PipelineFlowNode[] {
  if (!detail) return [];
  const { nodes, edges } = definitionToGraph(detail);
  return layoutGraph(nodes, edges);
}
function viewFlowEdges(detail: PipelineDetailResponse | null): Edge[] {
  if (!detail) return [];
  return definitionToGraph(detail).edges;
}

function CanvasFlow({
  nodes,
  edges,
  editable,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onPaneClick,
  onDropStage,
}: {
  nodes: PipelineFlowNode[];
  edges: Edge[];
  editable: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeClick: (event: unknown, node: { id: string; type?: string }) => void;
  onPaneClick: () => void;
  onDropStage: (skill: PipelineCatalogSkill, position: { x: number; y: number }) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const raw = event.dataTransfer?.getData(PALETTE_DND_TYPE);
    if (!raw) return;
    const skill = JSON.parse(raw) as PipelineCatalogSkill;
    if (!skill.enabled) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onDropStage(skill, position);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={stageNodeTypes}
      proOptions={{ hideAttribution: true }}
      fitView
      nodesDraggable={!editable ? false : undefined}
      nodesConnectable={!editable ? false : undefined}
      edgesFocusable={editable}
      elementsSelectable
      deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
      onNodesChange={editable ? onNodesChange : undefined}
      onEdgesChange={editable ? onEdgesChange : undefined}
      onConnect={editable ? onConnect : undefined}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onDrop={editable ? onDrop : undefined}
      onDragOver={editable ? onDragOver : undefined}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
