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
  SelectionMode,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type OnSelectionChangeParams,
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
  WireConsultationBinding,
  WireDefinitionNode,
  WireDefinitionPreparation,
  WirePipelineDefinition,
  WirePipelineDefinitionStage,
} from '../api/types.js';
import { useSpace, spaceHref } from '../store/use-space.js';
import { definitionToGraph, draftToGraph, layoutGraph, type PipelineFlowNode } from './layout.js';
import { stageNodeTypes } from './StageNode.js';
import {
  CONTROL_SOURCE_PORT,
  CONTROL_TARGET_PORT,
  createBlankCanvasPipelineDefinitionV2,
  addAtomicStageForCapability,
  addBodyConnection,
  addBodyStage,
  addBoundedLoopOverDeclaration,
  addDeclaration,
  addFinishNode,
  addParallelFrontier,
  addRequire,
  addStage,
  addV2Connection,
  backedgeRegion,
  CanvasSelection,
  completedFrontier,
  definitionIssuePathTarget,
  deriveSubgraphContract,
  detectParallelFrontiers,
  duplicateV2Definition,
  EMPTY_CANVAS_SELECTION,
  extractSubgraph,
  insertCompositeRef,
  isBindableSkill,
  isDeclarationIdUnique,
  isDirty,
  isV2EditableNodeKind,
  issuePathTarget,
  bodyConnectionIdFor,
  removeBodyConnection,
  removeBodyStage,
  removeDeclaration,
  removeRequire,
  removeStage,
  removeV2Connection,
  removeV2Nodes,
  removeParallelPair,
  renameDeclaration,
  renameStage,
  renameV2Node,
  selectionPanelMode,
  setParallelMembers,
  subgraphExtractionRefusals,
  setStageGate,
  singletonConnectionId,
  singletonNodeId,
  spliceConditionOntoConnection,
  stageIdFor,
  synthesizeBoundedLoopFromBackedge,
  synthesizeParallelFrontier,
  unavailableRootGestures,
  unspliceChoice,
  updateBodyStage,
  updateBodyStageExecution,
  updateAtomicStageExecution,
  updateBoundedLoopContract,
  updateConsultationBinding,
  updateDeclaration,
  updateDefinitionContracts,
  updateGateDisposition,
  updateGateDecisions,
  updateParallelContract,
  updateParallelMember,
  updateStageFields,
  updateStageHandoffThreshold,
  updateV2NodeFields,
  v2ConnectionIdFor,
  v2NodeIdFor,
  wouldCreateCycle,
  addConsultationBinding,
  removeConsultationBinding,
  type DefinitionIssueTarget,
} from './draft.js';
import { DeclarationsPanel } from './DeclarationsPanel.js';
import { DefinitionContractPanel } from './DefinitionContractPanel.js';
import type { IntegerContractDraftError } from './IntegerContractField.js';
import { PalettePanel, PALETTE_DND_TYPE } from './PalettePanel.js';
import { StagePanel } from './StagePanel.js';
import { V2NodePanel } from './V2NodePanel.js';
import { V2ConnectionPanel } from './V2ConnectionPanel.js';
import { V2SelectionPanel } from './V2SelectionPanel.js';
import {
  V2ExtractReviewPanel,
  type SubgraphExtractionReview,
} from './V2ExtractReviewPanel.js';
import {
  V2LoopReviewPanel,
  type BoundedLoopSynthesisReview,
} from './V2LoopReviewPanel.js';
import {
  V2ParallelReviewPanel,
  type ParallelFrontierReview,
} from './V2ParallelReviewPanel.js';
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
 * The authoring-draft error scope the loop review's max-iterations field owns
 * (canvas-backedge-loop-inference design D6): an invalid integer blocks
 * confirm until repaired, and the scope is cleared whenever the review closes
 * — the same discipline every other integer field on this page follows.
 */
const LOOP_REVIEW_INTEGER_FIELD = 'loop-review:maxIterations';

/**
 * The authoring-draft error scopes the parallel review's two integer fields
 * own (canvas-parallel-frontier-inference design D3): an invalid cap or
 * budget blocks confirm until repaired, and the scopes are cleared whenever
 * the review closes — the same discipline every other integer field on this
 * page follows.
 */
const PARALLEL_REVIEW_INTEGER_FIELDS = [
  'parallel-review:concurrencyCap',
  'parallel-review:budget',
];

/** The toast's optional action (design D4): a button riding the toast. */
interface ToastAction {
  label: string;
  onClick: () => void;
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
  /**
   * The canvas selection mirror (canvas-multi-selection design D1): React
   * Flow owns the interaction truth (box-select via Shift+drag, augmentation
   * via the platform multi-select key, click, pane click) and
   * `onSelectionChange` mirrors every user-driven change here; the only
   * other writers are the page's programmatic replacers (gesture adds,
   * rename id-follow, issue navigation, edit-mode entry/exit). Panels derive
   * their mode from this set via `selectionPanelMode` — singleton behavior
   * is preserved by derivation, not by parallel state.
   */
  const [selection, setSelection] = useState<CanvasSelection>(EMPTY_CANVAS_SELECTION);
  /** The Custom Composite declaration open in the declaration editor, if any.
   * Deliberately still a single scalar — the declaration editor edits
   * exactly one declaration (design D1/D2). */
  const [selectedDeclarationId, setSelectedDeclarationId] = useState<string | null>(null);
  const [selectedIssueTarget, setSelectedIssueTarget] =
    useState<DefinitionIssueTarget | null>(null);
  const [selectedIssueSeverity, setSelectedIssueSeverity] =
    useState<'error' | 'warning' | null>(null);
  const [authoringDraftErrors, setAuthoringDraftErrors] = useState<
    Record<string, IntegerContractDraftError>
  >({});

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
  /**
   * The current toast's optional action (design D4): while present the toast
   * renders a button and never auto-dismisses — a toast with an action is a
   * question (the parallel-frontier offer), not a notification. Every
   * existing `showToast` caller passes no action and keeps today's behavior.
   */
  const [toastAction, setToastAction] = useState<ToastAction | null>(null);
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);
  const [duplicateDialog, setDuplicateDialog] = useState<{ name: string; error: string | null } | null>(null);
  /**
   * The open package-into-reusable-block review (canvas-subgraph-extraction
   * design D4): which nodes are being packaged, the derivation defaults the
   * dialog opened with, the body summary, and the model's last confirm-time
   * refusal. Null when no review is open; the nodeIds are captured at open so
   * the transaction judges the exact set the author reviewed.
   */
  const [extractReview, setExtractReview] = useState<{
    nodeIds: ReadonlySet<string>;
    derived: ReturnType<typeof deriveSubgraphContract>;
    stageCount: number;
    internalConnectionCount: number;
    defaultId: string;
    error: string | null;
  } | null>(null);
  /**
   * The open back-edge loop review (canvas-backedge-loop-inference design
   * D6): the drawn edge's endpoints, the enclosed region, the derivation
   * defaults, the definition's outcomes (captured at open — the review is
   * modal, the draft cannot change underneath it), the open-time refusals,
   * and the model's last confirm-time refusal. Null when no review is open;
   * the drawn Connection itself is NEVER written to the draft, so cancel
   * equals today's pre-change refusal outcome exactly.
   */
  const [loopReview, setLoopReview] = useState<{
    from: string;
    to: string;
    nodeIds: ReadonlySet<string>;
    derived: ReturnType<typeof deriveSubgraphContract>;
    definitionOutcomes: readonly string[];
    refusals: readonly string[];
    stageCount: number;
    internalConnectionCount: number;
    defaultId: string;
    error: string | null;
  } | null>(null);
  /**
   * The open parallel-frontier review (canvas-parallel-frontier-inference
   * design D1/D3): the drawn sandwich's outer endpoints and its clean
   * branches (re-detected at open — a stale offer refuses cleanly), the
   * open-time refusals, and the model's last confirm-time refusal. Null when
   * no review is open; the drawn edges are LEGAL and stay in the draft, so
   * cancel changes nothing.
   */
  const [parallelReview, setParallelReview] = useState<{
    source: string;
    target: string;
    branches: readonly string[];
    refusals: readonly string[];
    error: string | null;
  } | null>(null);

  const hasAuthoringDraftErrors = Object.keys(authoringDraftErrors).length > 0;
  const dirty =
    (draft !== null && loadedDefinition !== null && isDirty(draft, loadedDefinition)) ||
    hasAuthoringDraftErrors;

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
        : createBlankCanvasPipelineDefinitionV2(pending.name);
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
    setAuthoringDraftErrors({});
    setSelectedIssueSeverity(null);
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
    setSelectedIssueTarget(null);
    setSelectedIssueSeverity(null);
    setSaveState((state) =>
      state.status === 'blocked' ? { status: 'idle' } : state
    );
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

  /**
   * Re-stamps `selected` on the current flow nodes/edges from the given
   * selection — the React Flow half of every programmatic selection write
   * (review B1). RF's SelectionListener keys its effect on the
   * `onSelectionChange` callback identity — a fresh function on every page
   * render — so it re-fires with its OWN store truth after every commit,
   * and that store adopts the `selected` flags we pass
   * (`StoreUpdater`/`adoptUserNodes`). A mirror write that leaves the flags
   * at the old value is therefore reverted one commit later: issue
   * navigation's panel closed again, and every panel close reopened.
   * Pairing the write with this re-stamp makes the next listener firing
   * carry a value equal to the mirror, which `onSelectionChange`'s
   * same-state guard absorbs.
   */
  function syncFlowSelection(next: CanvasSelection) {
    setFlowNodes((nodes) =>
      nodes.map((node) =>
        next.nodeIds.has(node.id) === !!node.selected
          ? node
          : { ...node, selected: next.nodeIds.has(node.id) }
      )
    );
    setFlowEdges((edges) =>
      edges.map((edge) =>
        next.connectionIds.has(edge.id) === !!edge.selected
          ? edge
          : { ...edge, selected: next.connectionIds.has(edge.id) }
      )
    );
  }

  /**
   * Replaces the whole selection — the programmatic replacer (design D1).
   * Writes BOTH truths in one update: the mirror the panels derive from,
   * and the flow's `selected` flags React Flow's store adopts (see
   * `syncFlowSelection`). Handlers that rebuild the whole flow in the same
   * tick (`recomputeFlow` with a `selectionOverride`) already keep the two
   * equal; this is the pairing for writes that don't.
   */
  function replaceSelection(
    nodeIds: readonly string[],
    connectionIds: readonly string[] = []
  ) {
    const next: CanvasSelection = {
      nodeIds: new Set(nodeIds),
      connectionIds: new Set(connectionIds),
    };
    setSelection(next);
    syncFlowSelection(next);
  }

  /**
   * Drops every selected id the next draft no longer contains — the
   * "elements removed by any edit SHALL leave the selection" half of the
   * selection-survival rule. Idempotent and shape-preserving: live ids are
   * never touched, so non-destructive edits keep the selection intact.
   */
  function pruneSelectionToDraft(nextDraft: WirePipelineDefinition) {
    setSelection((current) => {
      const nodeIds = new Set(
        [...current.nodeIds].filter((id) =>
          nextDraft.version === 2
            ? nextDraft.root.nodes.some((node) => node.id === id)
            : nextDraft.stages.some((stage) => stage.id === id)
        )
      );
      const connectionIds = new Set(
        [...current.connectionIds].filter(
          (id) =>
            nextDraft.version === 2 &&
            nextDraft.root.connections.some(
              (connection) => connection.id === id
            )
        )
      );
      if (
        nodeIds.size === current.nodeIds.size &&
        connectionIds.size === current.connectionIds.size
      ) {
        return current;
      }
      return { nodeIds, connectionIds };
    });
  }

  function recomputeFlow(
    def: WirePipelineDefinition,
    catalogOverride: PipelineCatalogResponse | null = catalog,
    selectionOverride: CanvasSelection = selection
  ) {
    const { nodes, edges } = draftToGraph(def, catalogOverride);
    const laidOut = layoutGraph(nodes, edges).map((node) =>
      node.type === 'stage' && def.version === 1
        ? { ...node, draggable: true, connectable: true, deletable: true }
        : node
    );
    // Selection-carry (design D3): rebuilt nodes/edges re-stamp `selected`
    // from the mirror by id, so a non-destructive mutation no longer
    // visually deselects everything. Handlers that replace the selection in
    // the same tick pass the NEXT selection explicitly — this closure's
    // `selection` is still the pre-replace value.
    setFlowNodes(
      laidOut.map((node) =>
        selectionOverride.nodeIds.has(node.id)
          ? { ...node, selected: true }
          : node
      )
    );
    setFlowEdges(
      edges.map((edge) =>
        selectionOverride.connectionIds.has(edge.id)
          ? { ...edge, selected: true }
          : edge
      )
    );
  }

  function enterEditWith(
    seed: WirePipelineDefinition,
    preparation: WireDefinitionPreparation | null = null,
    initialIssues: PipelineValidationIssue[] = []
  ) {
    setDraft(seed);
    setLoadedDefinition(seed);
    setMode('edit');
    setSelection(EMPTY_CANVAS_SELECTION);
    setSelectedDeclarationId(null);
    setSelectedIssueTarget(null);
    setSelectedIssueSeverity(null);
    setAuthoringDraftErrors({});
    setIssues(initialIssues);
    setLatestPreparation(preparation);
    setLastValidation(null);
    setSaveState({ status: 'idle' });
    setExportState({ open: false, path: '', status: 'idle' });
    recomputeFlow(seed, catalog, EMPTY_CANVAS_SELECTION);
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

  /**
   * The live toast's auto-dismiss timer (review m1): exactly one handle, so a
   * previous toast's pending clear can never fire against a newer toast — a
   * notification within the 2.5s window used to wipe a freshly surfaced
   * parallel offer, which nothing re-offers (the completing connection is
   * already drawn).
   */
  const toastTimerRef = useRef<number | null>(null);

  function clearToast() {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast('');
    setToastAction(null);
  }

  function showToast(message: string, action?: ToastAction) {
    // Clear the previous toast's timer before replacing it — only the newest
    // toast's clear may ever run (see toastTimerRef).
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(message);
    setToastAction(action ?? null);
    // A toast with an action is a question, not a notification (design D4):
    // it stays until answered (the action), dismissed, or replaced by the
    // next toast. Every existing caller passes no action and keeps the
    // auto-dismiss.
    if (action) return;
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast('');
    }, 2500);
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
    setSelection(EMPTY_CANVAS_SELECTION);
    setSelectedDeclarationId(null);
    setSelectedIssueTarget(null);
    setSelectedIssueSeverity(null);
    setAuthoringDraftErrors({});
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
      if (target.kind !== 'connection') continue;
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
      setSelectedIssueTarget(null);
      setSelectedIssueSeverity(null);
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
    if (hasAuthoringDraftErrors) {
      setSaveState({
        status: 'blocked',
        message: 'Fix the invalid integer field before validating or saving.',
      });
      return;
    }
    setSaveState({ status: 'idle' });
    setExportState({ open: false, path: '', status: 'idle' });
    await runValidate(
      draft.version === 1 ? { ...draft, origin: 'ui' } : draft
    );
  }

  async function handleSave(force = false) {
    if (!draft || !selector) return;
    if (hasAuthoringDraftErrors) {
      setSaveState({
        status: 'blocked',
        message: 'Fix the invalid integer field before validating or saving.',
      });
      return;
    }
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
        setSelection(EMPTY_CANVAS_SELECTION);
        setSelectedDeclarationId(null);
        setSelectedIssueTarget(null);
        setSelectedIssueSeverity(null);
        setAuthoringDraftErrors({});
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
    if (
      !draft ||
      draft.version !== 2 ||
      !selector ||
      !exportState.path.trim() ||
      hasAuthoringDraftErrors
    ) {
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
      // A refused cycle-closing draw IS loop intent by construction
      // (canvas-backedge-loop-inference design D1) — in the v2 editor, over
      // editable nodes, it opens the loop review instead of dead-ending. The
      // toast still fires first (the author sees why the edge was not added
      // as a plain connection); cancel leaves exactly this state. v1 and
      // non-editable endpoints keep the plain refusal. `wouldCreateCycle`
      // stays the single owner of cycle semantics — there is no second
      // "is this a back-edge" predicate to drift.
      const refusal = `Rejected: ${connection.source} → ${connection.target} would create a cycle`;
      if (draft.version === 2) {
        const sourceNode = draft.root.nodes.find(
          (node) => node.id === connection.source
        );
        const targetNode = draft.root.nodes.find(
          (node) => node.id === connection.target
        );
        if (
          sourceNode &&
          targetNode &&
          isV2EditableNodeKind(sourceNode.kind) &&
          isV2EditableNodeKind(targetNode.kind)
        ) {
          showToast(refusal);
          openLoopReview(connection.source, connection.target);
          return;
        }
      }
      showToast(refusal);
      return;
    }
    if (draft.version === 2) {
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
      // Rendered typed/control handle ids are authoritative. Fall back to the
      // same conventional control ports only when React Flow omits an id.
      // This keeps root and declaration-body authoring on one convention.
      const endpoints = {
        source: connection.source,
        sourcePort: connection.sourceHandle ?? CONTROL_SOURCE_PORT,
        target: connection.target,
        targetPort: connection.targetHandle ?? CONTROL_TARGET_PORT,
      };
      const nextDraft = addV2Connection(draft, {
        id: v2ConnectionIdFor(draft, endpoints),
        from: { node: endpoints.source, port: endpoints.sourcePort },
        to: { node: endpoints.target, port: endpoints.targetPort },
      });
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
      // A successfully drawn connection that completes a drawn
      // fan-out/reconverge sandwich earns the non-blocking parallel offer
      // (canvas-parallel-frontier-inference design D1): detection over the
      // POST-connect draft, filtered to frontiers whose branch-edge set
      // contains this connection. The edge is legal and stays either way —
      // dismissing or declining the offer changes nothing.
      const frontier = completedFrontier(nextDraft, {
        source: endpoints.source,
        target: endpoints.target,
      });
      if (frontier) {
        showToast(
          `Detected a parallel frontier: ${frontier.source} fans out to ` +
            `${frontier.branches.length} branches that reconverge at ` +
            `${frontier.target}.`,
          {
            label: 'Run in parallel',
            onClick: () =>
              openParallelReviewRef.current(frontier.source, frontier.target),
          }
        );
      }
      return;
    }
    setDraft(addRequire(draft, connection.source, connection.target));
    setFlowEdges((eds) => addEdge({ ...connection, id: `${connection.source}->${connection.target}` }, eds));
    markDraftChanged();
  }

  /**
   * One batch removal over a set of selected v2 node ids and connection ids
   * (canvas-multi-selection design D5) — the path BOTH the Delete key (via
   * `onNodesChange`/`onEdgesChange`) and the selection panel's delete button
   * take. `removeV2Nodes` owns every node rule (pair co-deletion, refusals,
   * reference cleanup); selected connections go through the same
   * editable-endpoint guard the Delete key's edge path has always used. The
   * page's only added behavior: pruning the selection of removed ids,
   * clearing authoring-error scopes, and showing ONE summary toast when
   * nodes were refused.
   */
  function applyV2BatchRemoval(
    nodeIds: ReadonlySet<string>,
    connectionIds: ReadonlySet<string>
  ) {
    if (!draft || draft.version !== 2) return;
    const plan = removeV2Nodes(draft, nodeIds);
    let nextDraft = plan.next;
    const removedConnectionIds = new Set<string>();
    for (const id of connectionIds) {
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
        removedConnectionIds.add(id);
      }
    }
    if (
      plan.removedIds.length === 0 &&
      plan.refused.length === 0 &&
      removedConnectionIds.size === 0
    ) {
      return;
    }
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    pruneSelectionToDraft(nextDraft);
    const removedFanOutIds = plan.removedIds.filter(
      (id) =>
        draft.root.nodes.find((node) => node.id === id)?.kind === 'FanOut'
    );
    removeAuthoringDraftErrorScopes([
      ...plan.removedIds.map((id) => `root-node:${id}`),
      ...removedFanOutIds.map((id) => `parallel:${id}`),
    ]);
    if (plan.refused.length > 0) {
      showToast(
        `Deleted ${plan.removedIds.length + removedConnectionIds.size}` +
          ` · ${plan.refused.length} refused: ` +
          plan.refused
            .map((refusal) => `${refusal.id} (${refusal.reason})`)
            .join('; ')
      );
    }
    markDraftChanged();
  }

  function onNodesChange(changes: NodeChange[]) {
    const removed = changes.filter((c) => c.type === 'remove');
    if (removed.length > 0 && draft) {
      if (draft.version === 2) {
        applyV2BatchRemoval(
          new Set(removed.map((change) => (change as { id: string }).id)),
          new Set<string>()
        );
        return;
      }
      let nextDraft = draft;
      for (const change of removed) nextDraft = removeStage(nextDraft, (change as { id: string }).id);
      setDraft(nextDraft);
      const removedIds = new Set(removed.map((c) => (c as { id: string }).id));
      setFlowEdges((eds) => eds.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)));
      pruneSelectionToDraft(nextDraft);
      markDraftChanged();
    }
    setFlowNodes((nds) => applyNodeChanges(changes, nds) as PipelineFlowNode[]);
  }

  function onEdgesChange(changes: EdgeChange[]) {
    const removed = changes.filter((c) => c.type === 'remove');
    if (removed.length > 0 && draft) {
      if (draft.version === 2) {
        applyV2BatchRemoval(
          new Set<string>(),
          new Set(removed.map((change) => (change as { id: string }).id))
        );
        return;
      }
      let nextDraft = draft;
      for (const change of removed) {
        const edge = flowEdges.find((e) => e.id === (change as { id: string }).id);
        if (edge) nextDraft = removeRequire(nextDraft, edge.source, edge.target);
      }
      setDraft(nextDraft);
      pruneSelectionToDraft(nextDraft);
      markDraftChanged();
    }
    setFlowEdges((eds) => applyEdgeChanges(changes, eds));
  }

  /**
   * The single user-action mirror writer (canvas-multi-selection design
   * D1/D3): React Flow reports every interaction-driven selection change —
   * plain click, Shift+drag box-select, multi-select-key augmentation, pane
   * click, delete — and the page mirrors it verbatim. The hand-rolled
   * `onNodeClick`/`onEdgeClick`/`onPaneClick` XOR clearing this replaces
   * could not represent the multi state at all.
   *
   * Same value → same state, deliberately: React Flow's SelectionListener
   * runs its effect on this callback's IDENTITY (and once at mount), so a
   * fresh object for an unchanged selection would re-render the page, mint
   * a new callback, re-fire the listener, and spin the renderer forever —
   * found as a hard tab freeze in the task 5.1 real-browser check.
   */
  function onSelectionChange({ nodes, edges }: OnSelectionChangeParams) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const connectionIds = new Set(edges.map((edge) => edge.id));
    setSelection((current) => {
      const sameNodes =
        current.nodeIds.size === nodeIds.size &&
        [...nodeIds].every((id) => current.nodeIds.has(id));
      const sameConnections =
        current.connectionIds.size === connectionIds.size &&
        [...connectionIds].every((id) => current.connectionIds.has(id));
      return sameNodes && sameConnections
        ? current
        : { nodeIds, connectionIds };
    });
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

  /**
   * Gesture handlers (design D2/D3). Each delegates composition to the pure
   * `draft.ts` helper and follows this module's established mutation-handler
   * convention: mutate via the model, `setDraft` + `recomputeFlow` +
   * `markDraftChanged`, surface a refusal as a toast. No gesture handler
   * re-decides a rule the model owns — replaces the old `addV2RootNode`
   * switch, which built every node kind's shape inline.
   */
  /**
   * Selects the node(s) a gesture just created — a UNION, not a replace:
   * the spec's "Selection survives a non-destructive edit" scenario pins
   * that previously selected nodes stay selected across a palette add
   * (select a region, keep adding to it — the workflow every later
   * portfolio child builds on). Unioning also preserves the pre-change
   * singleton behavior: from an empty selection the new node is the whole
   * selection and its panel opens exactly as before.
   */
  function selectAddedNodes(ids: readonly string[]) {
    const nextSelection: CanvasSelection = {
      nodeIds: new Set([...selection.nodeIds, ...ids]),
      connectionIds: selection.connectionIds,
    };
    setSelection(nextSelection);
    return nextSelection;
  }

  function addStageGesture(capability: { id: string; version: string }) {
    if (!draft || draft.version !== 2) return;
    const id = v2NodeIdFor('AtomicStage', draft);
    let nextDraft;
    try {
      nextDraft = addAtomicStageForCapability(draft, capability);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add the stage.');
      return;
    }
    setDraft(nextDraft);
    recomputeFlow(nextDraft, catalog, selectAddedNodes([id]));
    markDraftChanged();
  }

  function addRootGesture(gesture: 'parallel' | 'loop' | 'finish') {
    if (!draft || draft.version !== 2) return;
    let ids: readonly string[];
    let nextDraft;
    try {
      if (gesture === 'parallel') {
        // The parallel gesture creates a PAIR; both halves land in the
        // selection together, because the pair is one structural unit.
        ids = [v2NodeIdFor('FanOut', draft), v2NodeIdFor('Join', draft)];
        nextDraft = addParallelFrontier(draft);
      } else if (gesture === 'loop') {
        ids = [v2NodeIdFor('BoundedLoop', draft)];
        nextDraft = addBoundedLoopOverDeclaration(draft);
      } else {
        ids = [v2NodeIdFor('Finish', draft)];
        nextDraft = addFinishNode(draft);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add this gesture.');
      return;
    }
    setDraft(nextDraft);
    recomputeFlow(nextDraft, catalog, selectAddedNodes(ids));
    markDraftChanged();
  }

  /** Toggles the approval `Gate` targeting an `AtomicStage` (design D4). */
  function toggleStageGate(stageId: string, enabled: boolean) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = setStageGate(draft, stageId, enabled);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not change approval on this stage.');
    }
  }

  /** Splices a condition onto the selected connection (design D5). The
   * spliced connection no longer exists afterward, so the Connection panel
   * closes (the removed id leaves the selection); the new Choice node is
   * left selectable on the canvas. */
  function spliceConnectionCondition(connectionId: string, expression: string) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = spliceConditionOntoConnection(draft, connectionId, expression);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      pruneSelectionToDraft(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add this condition.');
    }
  }

  /** Removes a spliced `Choice`, restoring its direct connection (design D5). */
  function unspliceSelectedChoice(choiceId: string) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = unspliceChoice(draft, choiceId);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      pruneSelectionToDraft(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove this condition.');
    }
  }

  /** Appends a `CompositeRef` targeting the chosen declaration (design D6). */
  function insertDeclarationRef(declarationId: string) {
    if (!draft || draft.version !== 2) return;
    const id = v2NodeIdFor('CompositeRef', draft);
    try {
      const nextDraft = insertCompositeRef(draft, declarationId);
      setDraft(nextDraft);
      recomputeFlow(nextDraft, catalog, selectAddedNodes([id]));
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not insert this declaration.');
    }
  }

  // --- Package-into-reusable-block (canvas-subgraph-extraction design D4) --

  /**
   * Opens the extraction review with the derivation defaults. The rules and
   * the cut live in `draft.ts` (`subgraphExtractionRefusals` /
   * `deriveSubgraphContract`); this handler only captures what the author is
   * about to review.
   */
  function openExtractReview() {
    if (!draft || draft.version !== 2 || selection.nodeIds.size === 0) return;
    const derived = deriveSubgraphContract(draft, selection.nodeIds);
    const internalConnectionCount = draft.root.connections.filter(
      (connection) =>
        selection.nodeIds.has(connection.from.node) &&
        selection.nodeIds.has(connection.to.node)
    ).length;
    // `block`, `block-2`, … — the `v2NodeIdFor` suffix convention over the
    // model's uniqueness rule.
    let defaultId = 'block';
    for (let suffix = 2; !isDeclarationIdUnique(draft, defaultId); suffix += 1) {
      defaultId = `block-${suffix}`;
    }
    setExtractReview({
      nodeIds: new Set(selection.nodeIds),
      derived,
      stageCount: selection.nodeIds.size,
      internalConnectionCount,
      defaultId,
      error: null,
    });
  }

  /**
   * Confirms the review: one `extractSubgraph` transaction, then the
   * selectionOverride path — both selection truths in the same tick (the
   * `syncFlowSelection` discipline: the moved ids are gone from the draft, so
   * the mirror must become the ref in the same update that rebuilds the
   * flow, or React Flow's listener reverts it one commit later). A model
   * refusal keeps the draft unchanged, toasts the message, and leaves the
   * review open with its edits intact.
   */
  function confirmExtractReview(review: SubgraphExtractionReview) {
    if (!draft || draft.version !== 2 || !extractReview) return;
    let result;
    try {
      result = extractSubgraph(draft, { nodeIds: extractReview.nodeIds, ...review });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not package this selection.';
      setExtractReview((current) => (current ? { ...current, error: message } : current));
      showToast(message);
      return;
    }
    setExtractReview(null);
    const nextSelection: CanvasSelection = {
      nodeIds: new Set([result.refId]),
      connectionIds: new Set<string>(),
    };
    setDraft(result.next);
    setSelection(nextSelection);
    recomputeFlow(result.next, catalog, nextSelection);
    markDraftChanged();
    showToast(
      `Packaged ${extractReview.stageCount} stage${extractReview.stageCount === 1 ? '' : 's'} into '${result.declarationId}'.`
    );
  }

  // --- Back-edge loop inference (canvas-backedge-loop-inference D1/D6) ----

  /**
   * Opens the loop review for a refused cycle-closing draw. The region, the
   * derivation, and the refusals live in `draft.ts` (`backedgeRegion`,
   * `deriveSubgraphContract`, `subgraphExtractionRefusals`); this handler
   * only captures what the author is about to review. The drawn connection
   * is never written to the draft — the review state carries the endpoints
   * as data, so cancel reproduces today's refusal outcome exactly.
   */
  function openLoopReview(from: string, to: string) {
    if (!draft || draft.version !== 2) return;
    const nodeIds = backedgeRegion(draft, from, to);
    const derived = deriveSubgraphContract(draft, nodeIds);
    const refusals = subgraphExtractionRefusals(draft, {
      nodeIds,
      connectionIds: new Set<string>(),
    });
    const internalConnectionCount = draft.root.connections.filter(
      (connection) =>
        nodeIds.has(connection.from.node) && nodeIds.has(connection.to.node)
    ).length;
    // `loop-body`, `loop-body-2`, … — the `v2NodeIdFor` suffix convention
    // over the model's uniqueness rule.
    let defaultId = 'loop-body';
    for (let suffix = 2; !isDeclarationIdUnique(draft, defaultId); suffix += 1) {
      defaultId = `loop-body-${suffix}`;
    }
    removeAuthoringDraftErrorScopes([LOOP_REVIEW_INTEGER_FIELD]);
    setLoopReview({
      from,
      to,
      nodeIds: new Set(nodeIds),
      derived,
      definitionOutcomes: [...draft.outcomes],
      refusals,
      stageCount: nodeIds.size,
      internalConnectionCount,
      defaultId,
      error: null,
    });
  }

  /**
   * Confirms the review: one `synthesizeBoundedLoopFromBackedge` transaction,
   * then the same selectionOverride pairing `confirmExtractReview` uses —
   * both selection truths in the same tick (the region's node ids are gone
   * from the draft, so the mirror must become the loop in the same update
   * that rebuilds the flow, or React Flow's listener reverts it one commit
   * later). A model refusal keeps the draft unchanged, toasts the message,
   * and leaves the review open with its edits intact (child-2's rule).
   */
  function confirmLoopReview(review: BoundedLoopSynthesisReview) {
    if (!draft || draft.version !== 2 || !loopReview) return;
    let result;
    try {
      result = synthesizeBoundedLoopFromBackedge(draft, {
        from: loopReview.from,
        to: loopReview.to,
        ...review,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not turn this back-edge into a loop.';
      setLoopReview((current) => (current ? { ...current, error: message } : current));
      showToast(message);
      return;
    }
    setLoopReview(null);
    removeAuthoringDraftErrorScopes([LOOP_REVIEW_INTEGER_FIELD]);
    const nextSelection: CanvasSelection = {
      nodeIds: new Set([result.loopId]),
      connectionIds: new Set<string>(),
    };
    setDraft(result.next);
    setSelection(nextSelection);
    recomputeFlow(result.next, catalog, nextSelection);
    markDraftChanged();
    showToast(
      `Loop created from back-edge over ${loopReview.stageCount} stage${loopReview.stageCount === 1 ? '' : 's'} ('${result.declarationId}').`
    );
  }

  /**
   * Cancels the review: today's refusal outcome, exactly — the draft was
   * never touched (the drawn edge never entered it) and the draw-time
   * rejection toast stands. Only the review's integer-error scope needs
   * clearing, so it cannot linger to block the next authoring action.
   */
  function cancelLoopReview() {
    setLoopReview(null);
    removeAuthoringDraftErrorScopes([LOOP_REVIEW_INTEGER_FIELD]);
  }

  // --- Parallel frontier inference (canvas-parallel-frontier-inference D1/D3) -

  /**
   * Opens the parallel review from the offer's action. The branches are
   * RE-DETECTED here against the live draft: the offer carried `(source,
   * target)` as data and the toast does not block the editor, so the draft may
   * have moved under it — a stale offer must refuse cleanly rather than
   * confirm against a shape that no longer exists. The drawn edges stay in
   * the draft the whole time; cancel changes nothing.
   */
  function openParallelReview(source: string, target: string) {
    if (!draft || draft.version !== 2) return;
    const frontier = detectParallelFrontiers(draft).find(
      (candidate) => candidate.source === source && candidate.target === target
    );
    const refusals = frontier
      ? []
      : [
          'The drawn connections changed — this fan-out and reconverge shape is no longer a clean parallel frontier.',
        ];
    removeAuthoringDraftErrorScopes(PARALLEL_REVIEW_INTEGER_FIELDS);
    setParallelReview({
      source,
      target,
      branches: frontier?.branches ?? [],
      refusals,
      error: null,
    });
  }

  /**
   * Confirms the review: one `synthesizeParallelFrontier` transaction
   * (consume the drawn sandwich, mint the pair, wire the four families),
   * then the same selectionOverride pairing `confirmLoopReview` uses — both
   * selection truths in the same tick, with the fan-out as the selection. A
   * model refusal keeps the draft unchanged, toasts the message, and leaves
   * the review open with its edits intact (child-2's rule).
   */
  function confirmParallelReview(review: ParallelFrontierReview) {
    if (!draft || draft.version !== 2 || !parallelReview) return;
    let result;
    try {
      result = synthesizeParallelFrontier(draft, {
        source: parallelReview.source,
        target: parallelReview.target,
        members: review.members,
        concurrencyCap: review.concurrencyCap,
        budget: review.budget,
        outcomes: review.outcomes,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not turn these branches into a parallel frontier.';
      setParallelReview((current) =>
        current ? { ...current, error: message } : current
      );
      showToast(message);
      return;
    }
    setParallelReview(null);
    removeAuthoringDraftErrorScopes(PARALLEL_REVIEW_INTEGER_FIELDS);
    const nextSelection: CanvasSelection = {
      nodeIds: new Set([result.fanOutId]),
      connectionIds: new Set<string>(),
    };
    setDraft(result.next);
    setSelection(nextSelection);
    recomputeFlow(result.next, catalog, nextSelection);
    markDraftChanged();
    showToast(`Parallel frontier created over ${review.members.length} branches.`);
  }

  /**
   * Cancels the review: the drawn connections are legal and stay exactly as
   * drawn — the offer was never blocking. Only the integer-error scopes need
   * clearing, so they cannot linger to block the next authoring action.
   */
  function cancelParallelReview() {
    setParallelReview(null);
    removeAuthoringDraftErrorScopes(PARALLEL_REVIEW_INTEGER_FIELDS);
  }

  // The offer's toast action outlives the render that created it (its
  // auto-dismiss is suppressed), so it must reach the LATEST
  // `openParallelReview` — the one closing over the draft the completing
  // edge landed in — not the pre-connect closure it was minted with. The
  // ref is re-stamped every render; the re-detection inside stays the
  // staleness guard (a draft that genuinely moved under the offer refuses).
  const openParallelReviewRef = useRef(openParallelReview);
  openParallelReviewRef.current = openParallelReview;

  // --- Custom Composite declaration authoring (ECP-2 8.5/8.6) -------------
  //
  // Every handler delegates to the pure `draft.ts` model and reports the
  // model's own refusal as a toast — the panel never re-decides a rule the
  // model owns (uniqueness, reference guarding). `recomputeFlow` runs after
  // each mutation because a CompositeRef/BoundedLoop card's ports are looked
  // up from its declaration, so a contract edit changes the graph's handles.

  /** The first enabled catalog capability with an exact revision, if any. */
  function firstExactCapability() {
    return exactCapabilities()[0];
  }

  /**
   * Every enabled exact capability revision the trusted catalog offers — the
   * list the root graph's `V2NodePanel` select already renders, so the body
   * stage editor offers the same set from the same filter rather than a second
   * reading of "which capabilities may a stage bind".
   */
  function exactCapabilities() {
    return (catalog?.skills ?? [])
      .filter(isBindableSkill)
      .map((skill) => skill.capability!);
  }

  function setAuthoringDraftError(
    field: string,
    error: IntegerContractDraftError | null
  ) {
    setAuthoringDraftErrors((current) => {
      if (error === null) {
        if (!(field in current)) return current;
        const next = { ...current };
        delete next[field];
        return next;
      }
      return current[field]?.raw === error.raw &&
        current[field]?.message === error.message
        ? current
        : { ...current, [field]: error };
    });
  }

  function removeAuthoringDraftErrorScopes(scopes: readonly string[]) {
    setAuthoringDraftErrors((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([field]) =>
            !scopes.some(
              (scope) => field === scope || field.startsWith(`${scope}/`)
            )
        )
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }

  function renameAuthoringDraftErrorScope(from: string, to: string) {
    setAuthoringDraftErrors((current) => {
      const matching = Object.entries(current).filter(
        ([field]) => field === from || field.startsWith(`${from}/`)
      );
      if (matching.length === 0) return current;
      const next = { ...current };
      for (const [field, error] of matching) {
        delete next[field];
        next[`${to}${field.slice(from.length)}`] = error;
      }
      return next;
    });
  }

  function patchDefinitionContract(
    patch: Parameters<typeof updateDefinitionContracts>[1]
  ) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = updateDefinitionContracts(draft, patch);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not edit the definition contract.');
    }
  }

  function createDeclaration(id: string) {
    if (!draft || draft.version !== 2) return;
    let nextDraft;
    try {
      nextDraft = addDeclaration(draft, id);
    } catch (error) {
      // Duplicate id — the spec's "reject the creation with a duplicate-id
      // diagnostic". The model is the single owner of that rule.
      showToast(error instanceof Error ? error.message : 'Could not add the declaration.');
      return;
    }
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    setSelectedDeclarationId(id);
    markDraftChanged();
  }

  function deleteDeclaration(id: string) {
    if (!draft || draft.version !== 2) return;
    let nextDraft;
    try {
      nextDraft = removeDeclaration(draft, id);
    } catch (error) {
      // "The Canvas SHALL NOT allow deleting a declaration that is still
      // referenced by a root-level `CompositeRef` or `BoundedLoop`."
      showToast(error instanceof Error ? error.message : 'Could not delete the declaration.');
      return;
    }
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    if (selectedDeclarationId === id) setSelectedDeclarationId(null);
    markDraftChanged();
  }

  function renameCustomDeclaration(id: string, nextId: string) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = renameDeclaration(draft, id, nextId);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      setSelectedDeclarationId(nextId.trim());
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not rename the declaration.');
    }
  }

  function patchDeclaration(
    id: string,
    patch: Parameters<typeof updateDeclaration>[2]
  ) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = updateDeclaration(draft, id, patch);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not edit the declaration contract.');
    }
  }

  function createBodyStage(declarationId: string) {
    if (!draft || draft.version !== 2) return;
    const capability = firstExactCapability();
    if (!capability) {
      showToast('No enabled exact capability revision is available.');
      return;
    }
    const declaration = (draft.declarations ?? []).find((d) => d.id === declarationId);
    if (!declaration) return;
    const existing = new Set(
      (declaration.graph?.nodes ?? []).map((node) => (node as { id: string }).id)
    );
    let stageId = 'stage';
    let suffix = 2;
    while (existing.has(stageId)) {
      stageId = `stage-${suffix}`;
      suffix += 1;
    }
    const nextDraft = addBodyStage(draft, declarationId, {
      id: stageId,
      capability: { id: capability.id, version: capability.version },
      execution: {
        version: 1,
        role: 'implementer',
        workspace: { access: 'write' },
      },
    });
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function deleteBodyStage(declarationId: string, stageId: string) {
    if (!draft || draft.version !== 2) return;
    const nextDraft = removeBodyStage(draft, declarationId, stageId);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchBodyStage(
    declarationId: string,
    stageId: string,
    patch: Parameters<typeof updateBodyStage>[3]
  ) {
    if (!draft || draft.version !== 2) return;
    let nextDraft;
    try {
      nextDraft = updateBodyStage(draft, declarationId, stageId, patch);
    } catch (error) {
      // Blank / duplicate body stage id — the model's rule, surfaced verbatim.
      showToast(error instanceof Error ? error.message : 'Could not edit the body stage.');
      return;
    }
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchBodyExecution(
    declarationId: string,
    stageId: string,
    patch: Parameters<typeof updateBodyStageExecution>[3]
  ) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = updateBodyStageExecution(draft, declarationId, stageId, patch);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not edit body execution.');
    }
  }

  function createBodyConnection(declarationId: string, from: string, to: string) {
    if (!draft || draft.version !== 2) return;
    // Ports follow the AtomicStage convention the root graph uses; the model
    // owns every legality question (unknown stage, duplicate edge, cycle).
    const endpoints = {
      source: from,
      sourcePort: CONTROL_SOURCE_PORT,
      target: to,
      targetPort: CONTROL_TARGET_PORT,
    };
    let nextDraft;
    try {
      nextDraft = addBodyConnection(draft, declarationId, {
        id: bodyConnectionIdFor(draft, declarationId, endpoints),
        from: { node: from, port: endpoints.sourcePort },
        to: { node: to, port: endpoints.targetPort },
      });
    } catch (error) {
      // "#### Scenario: Body connection creating a cycle is rejected" — the
      // Canvas rejects it, and the server's GRAPH_CYCLE confirms on prepare.
      showToast(error instanceof Error ? error.message : 'Could not add the connection.');
      return;
    }
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function deleteBodyConnection(declarationId: string, connectionId: string) {
    if (!draft || draft.version !== 2) return;
    const nextDraft = removeBodyConnection(draft, declarationId, connectionId);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchV2Node(
    id: string,
    patch: Partial<WireDefinitionNode>
  ): boolean {
    if (!draft || draft.version !== 2) return false;
    const node = draft.root.nodes.find((candidate) => candidate.id === id);
    if (!node || !isV2EditableNodeKind(node.kind)) return false;
    const nextDraft =
      node.kind === 'Gate' && 'outcomes' in patch && Array.isArray(patch.outcomes)
        ? updateGateDecisions(draft, id, patch.outcomes)
        : updateV2NodeFields(draft, id, patch);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
    return true;
  }

  function patchAtomicExecution(
    id: string,
    patch: Parameters<typeof updateAtomicStageExecution>[2]
  ) {
    if (!draft || draft.version !== 2) return;
    const nextDraft = updateAtomicStageExecution(draft, id, patch);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchGateDisposition(
    id: string,
    decision: string,
    disposition: Parameters<typeof updateGateDisposition>[3]
  ) {
    if (!draft || draft.version !== 2) return;
    const nextDraft = updateGateDisposition(draft, id, decision, disposition);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchBoundedLoop(
    id: string,
    patch: Parameters<typeof updateBoundedLoopContract>[2]
  ) {
    if (!draft || draft.version !== 2) return;
    const nextDraft = updateBoundedLoopContract(draft, id, patch);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchConsultationAdd(binding: WireConsultationBinding) {
    if (!draft) return;
    const nextDraft = addConsultationBinding(draft, binding);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchConsultationUpdate(
    sourceStage: string,
    patch: Parameters<typeof updateConsultationBinding>[2]
  ) {
    if (!draft) return;
    const nextDraft = updateConsultationBinding(draft, sourceStage, patch);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function patchConsultationRemove(sourceStage: string) {
    if (!draft) return;
    const nextDraft = removeConsultationBinding(draft, sourceStage);
    setDraft(nextDraft);
    recomputeFlow(nextDraft);
    markDraftChanged();
  }

  function editParallelMembers(fanOutId: string, memberIds: readonly string[]) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = setParallelMembers(draft, fanOutId, memberIds);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not edit parallel members.');
    }
  }

  function editParallelMember(
    fanOutId: string,
    memberId: string,
    patch: Parameters<typeof updateParallelMember>[3]
  ) {
    if (!draft || draft.version !== 2) return;
    try {
      const nextDraft = updateParallelMember(draft, fanOutId, memberId, patch);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not edit the parallel member.');
    }
  }

  function editParallelContract(
    fanOutId: string,
    patch: Parameters<typeof updateParallelContract>[2]
  ) {
    if (!draft || draft.version !== 2) return;
    try {
      const previousJoin = draft.root.nodes.find(
        (candidate) => candidate.kind === 'FanOut' && candidate.id === fanOutId
      );
      const oldJoinId = previousJoin?.kind === 'FanOut' ? previousJoin.joinNodeId : null;
      const nextDraft = updateParallelContract(draft, fanOutId, patch);
      // Join-rename follow: when the renamed Join was THE selection, the
      // selection follows to the new id (a rename is the element surviving
      // under a new name, not a removal).
      const followJoinId =
        patch.joinId && oldJoinId !== null && singletonNodeId(selection) === oldJoinId
          ? patch.joinId.trim()
          : null;
      const nextSelection: CanvasSelection = followJoinId
        ? { nodeIds: new Set([followJoinId]), connectionIds: new Set() }
        : selection;
      setDraft(nextDraft);
      recomputeFlow(nextDraft, catalog, nextSelection);
      if (followJoinId) setSelection(nextSelection);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not edit the parallel contract.');
    }
  }

  function deleteParallel(fanOutId: string) {
    if (!draft || draft.version !== 2) return;
    try {
      const fanOut = draft.root.nodes.find(
        (candidate) => candidate.kind === 'FanOut' && candidate.id === fanOutId
      );
      const nextDraft = removeParallelPair(draft, fanOutId);
      setDraft(nextDraft);
      recomputeFlow(nextDraft);
      // Both halves left the draft, so both leave the selection; any other
      // selected element survives.
      pruneSelectionToDraft(nextDraft);
      removeAuthoringDraftErrorScopes([
        `parallel:${fanOutId}`,
        `root-node:${fanOutId}`,
        ...(fanOut?.kind === 'FanOut'
          ? [`root-node:${fanOut.joinNodeId}`]
          : []),
      ]);
      markDraftChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove the parallel pair.');
    }
  }

  function renameSelectedV2Node(newId: string) {
    if (!draft || draft.version !== 2) return;
    const currentId = singletonNodeId(selection);
    if (!currentId) return;
    const node = draft.root.nodes.find(
      (candidate) => candidate.id === currentId
    );
    if (
      !node ||
      !isV2EditableNodeKind(node.kind) ||
      newId === currentId ||
      draft.root.nodes.some((candidate) => candidate.id === newId)
    ) {
      return;
    }
    const nextDraft = renameV2Node(draft, currentId, newId);
    // The renamed node survives under its new id — the selection follows
    // the rename rather than being cleared (design D3).
    const nextSelection: CanvasSelection = {
      nodeIds: new Set([newId]),
      connectionIds: new Set(),
    };
    setDraft(nextDraft);
    recomputeFlow(nextDraft, catalog, nextSelection);
    setSelection(nextSelection);
    renameAuthoringDraftErrorScope(
      `root-node:${currentId}`,
      `root-node:${newId}`
    );
    if (node.kind === 'FanOut') {
      renameAuthoringDraftErrorScope(
        `parallel:${currentId}`,
        `parallel:${newId}`
      );
    }
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
    if (!draft || draft.version !== 1) return;
    const currentId = singletonNodeId(selection);
    if (!currentId) return;
    const nextDraft = renameStage(draft, currentId, newId);
    setDraft(nextDraft);
    markDraftChanged();
    setFlowNodes((nodes) =>
      nodes.map((n) =>
        n.id === currentId && n.type === 'stage' ? { ...n, id: newId, data: { ...n.data, id: newId } } : n
      )
    );
    // The id rewrite below assumes an edge's source and target are never BOTH
    // `currentId` at once — relies on the no-self-edges invariant
    // (`wouldCreateCycle` rejects a self-loop, so a stage can never require
    // itself) — otherwise the `${newId}->${e.target}` branch would silently
    // drop a rewritten target half of a self-referencing id.
    setFlowEdges((eds) =>
      eds.map((e) => ({
        ...e,
        id: e.id === `${currentId}->${e.target}` || e.source === currentId ? `${newId}->${e.target}` : e.id,
        source: e.source === currentId ? newId : e.source,
        target: e.target === currentId ? newId : e.target,
      }))
    );
    // The renamed stage survives under its new id — the selection follows.
    replaceSelection([newId]);
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
    setPendingDraft({
      name: newName,
      definition:
        detail.definition.version === 2
          ? duplicateV2Definition(detail.definition, newName)
          : detail.definition,
    });
    setDuplicateDialog(null);
    route(spaceHref(space, 'pipelines', newName));
  }

  function startAssembling() {
    if (!name) return;
    setPendingDraft({ name });
    enterEditWith(createBlankCanvasPipelineDefinitionV2(name));
  }

  const backHref = space ? spaceHref(space, 'pipelines') : '/';

  // Singleton derivations (design D3): the panel objects come from
  // `singletonNodeId`/`singletonConnectionId`, so singleton panel behavior —
  // including `key={id}` remount semantics below — is unchanged while a
  // multi or mixed selection yields null and opens no singleton panel.
  const primarySelectedNodeId = singletonNodeId(selection);
  const primarySelectedConnectionId = singletonConnectionId(selection);
  const selectedStage = useMemo(
    () =>
      draft?.version === 1 && primarySelectedNodeId
        ? draft.stages.find((stage) => stage.id === primarySelectedNodeId) ?? null
        : null,
    [draft, primarySelectedNodeId]
  );
  const selectedV2Node = useMemo(
    () =>
      draft?.version === 2 && primarySelectedNodeId
        ? draft.root.nodes.find((node) => node.id === primarySelectedNodeId) ?? null
        : null,
    [draft, primarySelectedNodeId]
  );
  const selectedConnection = useMemo(
    () =>
      draft?.version === 2 && primarySelectedConnectionId
        ? draft.root.connections.find((connection) => connection.id === primarySelectedConnectionId) ?? null
        : null,
    [draft, primarySelectedConnectionId]
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
    if (!draft || draft.version !== 1 || !primarySelectedNodeId) return result;
    for (const issue of issues) {
      const target = issuePathTarget(issue.path, draft.stages.length);
      if (!target || !target.field) continue;
      if (draft.stages[target.stageIndex]?.id !== primarySelectedNodeId) continue;
      if (result[target.field] !== 'error') result[target.field] = issue.severity;
    }
    return result;
  }, [draft, primarySelectedNodeId, issues]);
  const selectedV2NodeFieldIssues = useMemo(() => {
    const result: Record<string, 'error' | 'warning'> = {};
    if (!draft || draft.version !== 2 || !primarySelectedNodeId) return result;
    for (const issue of issues) {
      const target = definitionIssuePathTarget(draft, issue.path);
      if (
        target?.kind !== 'node' ||
        target.id !== primarySelectedNodeId ||
        !target.field
      ) {
        continue;
      }
      if (result[target.field] !== 'error') {
        result[target.field] = issue.severity;
      }
    }
    return result;
  }, [draft, primarySelectedNodeId, issues]);

  /**
   * The selection summary panel's kind breakdown (`AtomicStage × 2`), read
   * from the v2 draft in draft order. Empty for v1 — its stages carry no
   * node kinds — and empty whenever no selected id matches a node.
   */
  const selectionNodeKindSummary = useMemo(() => {
    if (draft?.version !== 2) return [];
    const counts = new Map<string, number>();
    for (const node of draft.root.nodes) {
      if (!selection.nodeIds.has(node.id)) continue;
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => `${kind} × ${count}`);
  }, [draft, selection]);

  /**
   * The package action's availability, read once from the model
   * (canvas-subgraph-extraction design D3/D4): the selection panel offers the
   * button only when this is empty and renders the strings as muted text
   * otherwise — the panel decides nothing. v2 edit mode only.
   */
  const packageRefusals = useMemo(() => {
    if (draft?.version !== 2) return [];
    return subgraphExtractionRefusals(draft, selection);
  }, [draft, selection]);

  function selectIssueTarget(
    target: DefinitionIssueTarget,
    severity: 'error' | 'warning'
  ) {
    setSelectedIssueTarget(target);
    setSelectedIssueSeverity(severity);
    if (!draft) return;
    // "Selecting an issue in the issues list SHALL leave exactly the one
    // element the issue points at selected, opening its panel" — every
    // branch REPLACES the selection (through the paired replacer, which
    // also re-stamps the flow so the listener cannot revert it one commit
    // later — review B1), so a box-selection is not left half-standing
    // behind the newly focused element.
    if (target.kind === 'definition') {
      replaceSelection([]);
      setSelectedDeclarationId(null);
      return;
    }
    if (target.kind === 'node') {
      setSelectedDeclarationId(null);
      replaceSelection([target.id]);
      return;
    }
    if (target.kind === 'connection' && draft.version === 2) {
      const consuming = draft.root.connections[target.index]?.to.node;
      if (consuming) replaceSelection([consuming]);
      else replaceSelection([]);
      setSelectedDeclarationId(null);
      return;
    }
    if (
      target.kind === 'declaration' ||
      target.kind === 'body-node' ||
      target.kind === 'body-connection'
    ) {
      replaceSelection([]);
      setSelectedDeclarationId(
        target.kind === 'declaration' ? target.id : target.declarationId
      );
    }
  }

  /**
   * The selection summary panel's delete action — the same batch path the
   * Delete key takes. v2 routes the whole node set through
   * `applyV2BatchRemoval` (pair co-deletion, one refusal summary); v1 keeps
   * its existing `removeStage` loop, which is already batch-capable and
   * cleans every `requires` reference (design D5).
   */
  function deleteSelection() {
    if (!draft || selection.nodeIds.size === 0) return;
    if (draft.version === 2) {
      applyV2BatchRemoval(selection.nodeIds, selection.connectionIds);
      return;
    }
    let nextDraft: WirePipelineDefinition = draft;
    for (const id of selection.nodeIds) nextDraft = removeStage(nextDraft, id);
    const removedIds = new Set(selection.nodeIds);
    setDraft(nextDraft);
    setFlowEdges((eds) =>
      eds.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target))
    );
    // Canvas truth in the same update (review M1): unlike the Delete key,
    // whose `applyNodeChanges` tail drops the removed cards, this path
    // never rebuilt the flow — the deleted stages survived as still-
    // selected ghosts, and with the selection listener live they re-popped
    // the summary panel reporting the deleted stages. Drop the cards, then
    // clear mirror and flags together through the paired replacer.
    setFlowNodes((nodes) => nodes.filter((node) => !removedIds.has(node.id)));
    replaceSelection([]);
    markDraftChanged();
  }

  function selectDeclaration(id: string | null) {
    setSelectedDeclarationId(id);
    setSelectedIssueTarget(null);
    setSelectedIssueSeverity(null);
  }

  const definitionFocusedField =
    selectedIssueTarget?.kind === 'definition'
      ? selectedIssueTarget.field ?? null
      : null;
  const selectedIssueDeclarationId =
    selectedIssueTarget?.kind === 'declaration'
      ? selectedIssueTarget.id
      : selectedIssueTarget?.kind === 'body-node' ||
          selectedIssueTarget?.kind === 'body-connection'
        ? selectedIssueTarget.declarationId
        : null;
  const selectedIssueOwnsOpenDeclaration =
    selectedIssueDeclarationId !== null &&
    selectedIssueDeclarationId === selectedDeclarationId;
  const declarationFocusedField =
    selectedIssueTarget?.kind === 'declaration' &&
    selectedIssueTarget.id === selectedDeclarationId
      ? selectedIssueTarget.field ?? null
      : selectedIssueTarget?.kind === 'body-node' &&
          selectedIssueOwnsOpenDeclaration
        ? selectedIssueTarget.field ?? null
        : null;
  const selectedBodyStageFromIssue =
    selectedIssueTarget?.kind === 'body-node' &&
    selectedIssueOwnsOpenDeclaration
      ? selectedIssueTarget.id
      : null;
  const selectedBodyConnectionIssue =
    selectedIssueTarget?.kind === 'body-connection' &&
    selectedIssueOwnsOpenDeclaration
      ? {
          declarationId: selectedIssueTarget.declarationId,
          id: selectedIssueTarget.id,
          field: selectedIssueTarget.field ?? null,
          severity: selectedIssueSeverity ?? 'error',
        }
      : null;
  const selectedRootFocusedField =
    selectedIssueTarget?.kind === 'node' &&
    selectedIssueTarget.id === primarySelectedNodeId
      ? selectedIssueTarget.field ?? null
      : null;

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
                hasAuthoringDraftErrors ||
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
                  disabled={
                    hasAuthoringDraftErrors || v2DefinitionValid === false
                  }
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

      {extractReview && (
        <V2ExtractReviewPanel
          defaultId={extractReview.defaultId}
          derived={extractReview.derived}
          bodySummary={{
            stageCount: extractReview.stageCount,
            internalConnectionCount: extractReview.internalConnectionCount,
          }}
          error={extractReview.error}
          onConfirm={confirmExtractReview}
          onCancel={() => setExtractReview(null)}
        />
      )}

      {loopReview && (
        <V2LoopReviewPanel
          from={loopReview.from}
          to={loopReview.to}
          regionNodeIds={[...loopReview.nodeIds]}
          definitionOutcomes={loopReview.definitionOutcomes}
          defaultId={loopReview.defaultId}
          derived={loopReview.derived}
          defaultMaxIterations={3}
          refusals={loopReview.refusals}
          integerDraftError={authoringDraftErrors[LOOP_REVIEW_INTEGER_FIELD] ?? null}
          onIntegerDraftError={setAuthoringDraftError}
          error={loopReview.error}
          onConfirm={confirmLoopReview}
          onCancel={cancelLoopReview}
        />
      )}

      {parallelReview && (
        <V2ParallelReviewPanel
          source={parallelReview.source}
          target={parallelReview.target}
          branchIds={[...parallelReview.branches]}
          definitionOutcomes={
            draft?.version === 2 ? [...draft.outcomes] : []
          }
          defaultConcurrencyCap={Math.max(
            1,
            Math.min(3, parallelReview.branches.length)
          )}
          defaultBudget={Math.max(1, parallelReview.branches.length)}
          refusals={parallelReview.refusals}
          capDraftError={
            authoringDraftErrors['parallel-review:concurrencyCap'] ?? null
          }
          budgetDraftError={
            authoringDraftErrors['parallel-review:budget'] ?? null
          }
          onIntegerDraftError={setAuthoringDraftError}
          error={parallelReview.error}
          onConfirm={confirmParallelReview}
          onCancel={cancelParallelReview}
        />
      )}

      <div class="pipeline-canvas__body">
        {editable && (
          <PalettePanel
            skills={catalog?.skills ?? null}
            loading={catalogLoading}
            definitionVersion={draft?.version ?? 1}
            // Same rule the insertion uses, read once — the panel decides
            // nothing about which gestures are available (design D2).
            disabledGestures={
              draft?.version === 2
                ? unavailableRootGestures(draft, { exactCapabilities: exactCapabilities() })
                : undefined
            }
            onAddStage={addStageGesture}
            onAddGesture={addRootGesture}
          />
        )}

        {/* Custom Composite declaration authoring — v2 edit mode only. This is
            the affordance ECP-2's spec requires and its tasks 8.5/8.6 claimed;
            without it the Canvas could reference a declaration but never
            create one. */}
        {editable && draft?.version === 2 && (
          <div class="pipeline-canvas__authoring-contracts">
            <DefinitionContractPanel
              definition={draft}
              focusedField={definitionFocusedField}
              draftErrors={authoringDraftErrors}
              onPatch={patchDefinitionContract}
              onInvalidChange={setAuthoringDraftError}
            />
            <DeclarationsPanel
              definition={draft}
              selectedId={selectedDeclarationId}
              selectedIssueDeclarationId={selectedIssueDeclarationId}
              selectedBodyStageId={selectedBodyStageFromIssue}
              selectedBodyStageSeverity={
                selectedIssueTarget?.kind === 'body-node' &&
                selectedIssueOwnsOpenDeclaration
                  ? selectedIssueSeverity
                  : null
              }
              selectedBodyConnectionIssue={selectedBodyConnectionIssue}
              focusedField={declarationFocusedField}
              catalog={catalog}
              onSelect={selectDeclaration}
              onCreate={createDeclaration}
              onDelete={deleteDeclaration}
              onRename={renameCustomDeclaration}
              onPatch={patchDeclaration}
              onAddBodyStage={createBodyStage}
              onRemoveBodyStage={deleteBodyStage}
              onPatchBodyStage={patchBodyStage}
              onPatchBodyExecution={patchBodyExecution}
              onAddBodyConnection={createBodyConnection}
              onRemoveBodyConnection={deleteBodyConnection}
              onInsertRef={insertDeclarationRef}
            />
          </div>
        )}

        {/* The flow and the issues drawer share one vertical column so the
            drawer is a bottom panel of the canvas, always on-screen inside the
            viewport-locked page (pipelines-ui spec). */}
        <div class="pipeline-canvas__flow-column">
          <div class="pipeline-canvas__flow" data-testid="pipeline-canvas-flow">
            {toast && (
              <div
                class={`pipeline-canvas__toast${
                  toastAction ? ' pipeline-canvas__toast--with-action' : ''
                }`}
                data-testid="pipeline-canvas-toast"
              >
                <span class="pipeline-canvas__toast-message">{toast}</span>
                {toastAction && (
                  <>
                    <button
                      type="button"
                      class="pipeline-canvas__toast-action"
                      data-testid="pipeline-canvas-toast-action"
                      onClick={() => {
                        const action = toastAction;
                        clearToast();
                        action.onClick();
                      }}
                    >
                      {toastAction.label}
                    </button>
                    <button
                      type="button"
                      class="pipeline-canvas__toast-dismiss"
                      data-testid="pipeline-canvas-toast-dismiss"
                      aria-label="Dismiss"
                      onClick={clearToast}
                    >
                      ×
                    </button>
                  </>
                )}
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
                onSelectionChange={onSelectionChange}
                onDropStage={onDropStage}
              />
            </ReactFlowProvider>
          </div>

          {(editable ? draft : detail?.definition) && issues.length > 0 && (
            <IssuesDrawer
              issues={issues}
              draft={(editable ? draft : detail!.definition)!}
              onSelectTarget={selectIssueTarget}
              onDismiss={
                editable
                  ? () => {
                      setIssues([]);
                      setSelectedIssueTarget(null);
                      setSelectedIssueSeverity(null);
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
            onClose={() => replaceSelection([])}
          />
        )}
        {editable && selectedV2Node && (
          <V2NodePanel
            key={selectedV2Node.id}
            node={selectedV2Node}
            catalog={catalog}
            definition={draft?.version === 2 ? draft : null}
            fullDefinition={draft ?? null}
            fieldIssues={selectedV2NodeFieldIssues}
            draftErrors={authoringDraftErrors}
            focusedField={selectedRootFocusedField}
            onRename={renameSelectedV2Node}
            onPatch={(patch) => patchV2Node(selectedV2Node.id, patch)}
            onAtomicExecutionPatch={(patch) =>
              patchAtomicExecution(selectedV2Node.id, patch)
            }
            onStageGateToggle={toggleStageGate}
            onGateDisposition={(decision, disposition) =>
              patchGateDisposition(selectedV2Node.id, decision, disposition)
            }
            onUnspliceChoice={unspliceSelectedChoice}
            onBoundedLoopPatch={(patch) =>
              patchBoundedLoop(selectedV2Node.id, patch)
            }
            onConsultationAdd={(binding) => patchConsultationAdd(binding)}
            onConsultationPatch={(sourceStage, patch) =>
              patchConsultationUpdate(sourceStage, patch)
            }
            onConsultationRemove={(sourceStage) =>
              patchConsultationRemove(sourceStage)
            }
            onParallelMembers={editParallelMembers}
            onParallelMemberPatch={editParallelMember}
            onParallelContractPatch={editParallelContract}
            onDeleteParallelPair={deleteParallel}
            onInvalidChange={setAuthoringDraftError}
            onClose={() => replaceSelection([])}
          />
        )}
        {editable && selectedConnection && (
          <V2ConnectionPanel
            key={selectedConnection.id}
            connection={selectedConnection}
            onSpliceCondition={spliceConnectionCondition}
            onClose={() => replaceSelection([])}
          />
        )}
        {editable && draft && selectionPanelMode(selection) === 'multi' && (
          <V2SelectionPanel
            // The summary serves both editors; v1's elements are stage
            // cards, so its heading names that mode's vocabulary (review t1).
            title={draft.version === 1 ? 'Selected stages' : 'Selection'}
            nodeCount={selection.nodeIds.size}
            connectionCount={selection.connectionIds.size}
            nodeKinds={selectionNodeKindSummary}
            // The package gesture is v2-only, and offered only when the
            // model's refusal list is empty — the refusals render instead.
            onPackage={
              draft.version === 2 && packageRefusals.length === 0
                ? openExtractReview
                : undefined
            }
            packageRefusals={draft.version === 2 ? packageRefusals : undefined}
            onDelete={deleteSelection}
            onClose={() => replaceSelection([])}
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
  onSelectionChange,
  onDropStage,
}: {
  nodes: PipelineFlowNode[];
  edges: Edge[];
  editable: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectionChange: (params: OnSelectionChangeParams) => void;
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
    // Box-select is pinned to Shift+drag explicitly (canvas-multi-selection
    // design D4) so the interaction contract is visible in code instead of
    // relying on the library default; multiSelectionKeyCode stays at its
    // platform-aware default (Control on Windows/Linux, Command on macOS)
    // and selectionOnDrag stays false, preserving plain-drag panning.
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
      selectionKeyCode="Shift"
      selectionMode={SelectionMode.Partial}
      deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
      onNodesChange={editable ? onNodesChange : undefined}
      onEdgesChange={editable ? onEdgesChange : undefined}
      onConnect={editable ? onConnect : undefined}
      onSelectionChange={editable ? onSelectionChange : undefined}
      onDrop={editable ? onDrop : undefined}
      onDragOver={editable ? onDragOver : undefined}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
