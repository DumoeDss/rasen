/**
 * Wire (HTTP JSON) shapes for the read-only management API (design.md D4/D5
 * of `rasen-ui-slice1-readonly-api`). `ApiErrorBody` here is the canonical
 * unified envelope (unify-pipeline-http-api design D6): `config-api/wire-types.ts`
 * re-exports it rather than declaring its own — one shape, one definition.
 */
import { z } from 'zod';

import type { RunState } from '../pipeline-registry/run-state.js';
import type { PortfolioChildStatus } from '../pipeline-registry/portfolio-state.js';
import type { PortfolioState } from '../pipeline-registry/portfolio-state.js';
import type {
  DefinitionArtifact,
  DefinitionPort,
  DefinitionSourceV2,
  PipelineYaml,
  PreparedExecutionCapabilityPathView,
  PreparedExecutionPolicyPathView,
  PreparedBoundedLoopPolicy,
  StageRole,
  ThresholdValue,
} from '../pipeline-registry/index.js';
import type { ReconcilerSupportAnalysis } from '../pipeline-registry/execution-plan-internal.js';
import type {
  AuditRuntime,
  DispatchBridge,
  DispatchMode,
  DispatchRuntime,
} from '../runtime-adapters.js';
import type {
  ThresholdBindingMetadata,
  ThresholdBindingRow,
  ThresholdDiagnostic,
} from '../threshold-resolver.js';
import type {
  ThresholdScheme,
  ThresholdSchemeListEntry,
} from '../threshold-schemes.js';
import type {
  WorkflowDependencySet,
  WorkflowDiagnostic,
  WorkflowRecommendations,
  WorkflowSourceKind,
} from '../workflow-registry/index.js';
import type { WorkflowKind } from '../workflow-registry/types.js';
import type { WorkflowUsage, WorkflowValidationSummary } from '../workflow-library.js';
import type {
  ProjectRollup,
  TargetLineRollup,
  GroupedChanges,
  IssueSummaryPage,
  IssueDetail,
  ResolvedExecutionPlan,
} from '../store/query/types.js';
import type { IssueRecordResult, ExecutionPlanResult } from '../store/issues/types.js';

/** A registered project, or the server's launch project. Mirrors config-api's `ProjectRef`. */
export interface ProjectRef {
  projectId: string;
  name: string;
  root?: string;
}

/**
 * Uniform non-2xx error envelope, matching the config API's vocabulary.
 * `cliExitCode`/`stderr` are populated only for `cli_error` (change-submission
 * design D3): the CLI's own exit code and captured stderr, passed through
 * verbatim rather than paraphrased.
 */
export interface ApiErrorBody {
  error: { code: string; message: string; fix?: string; cliExitCode?: number; stderr?: string };
}

// -----------------------------------------------------------------------
// Pipeline library (pipeline-http-api, unify-pipeline-http-api design D5) —
// `GET`/`POST /api/v1/pipelines`. Moved here from config-api/wire-types.ts
// with no re-export shim: the two routers and `pipeline-submit.ts` are its
// sole importers.
// -----------------------------------------------------------------------

/** An effective value plus the scope-qualified layer that supplied it (`GET /api/v1/pipelines`). */
export interface WireEffectiveValue<T> {
  value: T;
  source: string;
}

/** Resolver-owned threshold provenance; clients display it but never recompute it. */
export interface WireEffectiveThreshold extends WireEffectiveValue<ThresholdValue> {
  binding?: ThresholdBindingMetadata;
  diagnostics?: ThresholdDiagnostic[];
}

/** Pipeline-wide reuse projection, including independently resolved role runtimes. */
export interface WireEffectiveReuse {
  planner: 'auto' | 'never';
  implementer: 'auto' | 'never';
  threshold: ThresholdValue;
  roles: { planner: ThresholdValue; implementer: ThresholdValue };
  sources?: {
    threshold: string;
    roles: { planner: string; implementer: string };
  };
  bindings?: {
    threshold?: ThresholdBindingMetadata;
    roles?: Partial<Record<'planner' | 'implementer', ThresholdBindingMetadata>>;
  };
  diagnostics?: ThresholdDiagnostic[];
}

/**
 * A pipeline stage for `GET /api/v1/pipelines` (pipeline-http-api). Beside its
 * declared identity and its declared `gate` value (a boolean), it reports each
 * EFFECTIVE per-stage value — gate (after the mask), model, handoff threshold,
 * and runtime — with the layer that supplied it, so the UI renders resolution
 * without reimplementing it.
 */
export interface WirePipelineStage {
  id: string;
  role: string | null;
  skill: string | null;
  /** The declared gate value from the pipeline definition, unmasked. */
  gate: boolean;
  /** The effective gate after the mask: `true` pauses, `false` auto-approves. */
  effectiveGate: WireEffectiveValue<boolean>;
  effectiveModel: WireEffectiveValue<string | null>;
  effectiveEffort: WireEffectiveValue<string | null>;
  effectiveHandoff: WireEffectiveThreshold;
  effectiveRuntime: WireEffectiveValue<DispatchRuntime>;
  /** Concrete route selected for the server's available host context. */
  dispatchMode: DispatchMode;
  /** Named executable bridge when `dispatchMode` is `exec-bridge`. */
  bridge: DispatchBridge | null;
  /** Native-v2 additive inspection identity; absent on older v1-only clients. */
  nodePath?: string;
  profilePath?: string;
  requires?: string[];
  capability?: { id: string; version: string };
  workspace?: 'none' | 'read' | 'write';
  verifyPolicy?: string | null;
  leadReview?: boolean;
  effectiveSandbox?: 'read-only' | 'workspace-write';
  sessionReuse?: {
    effective: 'never' | 'same-invocation';
    authored?: 'none' | 'stage' | 'run-planner' | 'review-thread';
    source: string;
  };
}

/**
 * A pipeline's identity, provenance, and per-stage effective configuration for
 * `GET /api/v1/pipelines`. `provenance` marks a built-in versus a user pipeline;
 * `sourceLayer` names the layer the definition resolved from.
 */
export interface WirePipeline {
  name: string;
  description: string;
  provenance: 'built-in' | 'user';
  sourceLayer: 'project' | 'user' | 'package';
  /** Pipeline-wide role runtimes; stage declarations intentionally do not affect these. */
  roleRuntimes?: Record<StageRole, WireEffectiveValue<DispatchRuntime>>;
  effectiveReuse?: WireEffectiveReuse;
  stages: WirePipelineStage[];
  /** Shared prepared execution order; paths remain distinct across root/declaration scopes. */
  buildOrder?: string[];
  /** Every adapter-free capability path frozen by a native-v2 launch profile. */
  capabilityPaths?: readonly PreparedExecutionCapabilityPathView[];
  /** Every effective policy path frozen by a native-v2 launch profile. */
  policyPaths?: readonly PreparedExecutionPolicyPathView[];
  /** Exact lifecycle policies sealed by preparation. */
  boundedLoops?: readonly PreparedBoundedLoopPolicy[];
  availableEngines?: ReconcilerSupportAnalysis['availableEngines'];
  reconcilerSupport?: ReconcilerSupportAnalysis['reconcilerSupport'];
  authoredVersion: number;
  normalizedVersion: 2;
  definitionValid: boolean;
  planAvailable: boolean;
  executable: boolean;
  executionMode: 'legacy' | 'reconciler' | 'unavailable';
  unavailableReason?: string;
  /** Named migration boundary for an intentionally retained package v1 fixture. */
  compatibilityBoundary?: 'issue-dispatch-0.3.0';
  /** Present when the authoritative winning source failed preparation. */
  diagnostics?: PipelineValidationIssue[];
}

// -----------------------------------------------------------------------
// Threshold scheme catalog and mutations (`/api/v1/threshold-schemes`).
// The catalog is installation-wide; binding writes remain on the scoped
// config API (`thresholds.bindings.<runtime>`).
// -----------------------------------------------------------------------

export interface ThresholdPresetSeed {
  /** Stable display/seed id: the preset's primary match string. */
  id: string;
  match: string[];
  contextWindow: number;
  seed: ThresholdScheme;
  sources: { handoff: 'preset' | 'default'; reuse: 'preset' | 'default' };
}

export interface ThresholdSchemeCatalogResponse {
  schemes: ThresholdSchemeListEntry[];
  presets: ThresholdPresetSeed[];
  bindingRows: ThresholdBindingRow[];
}

export type ThresholdSchemeMutationRequest =
  | { op: 'create' | 'update'; name: string; scheme: ThresholdScheme }
  | { op: 'delete'; name: string };

export type ThresholdSchemeMutationResponse =
  | { op: 'create' | 'update'; name: string; scheme: ThresholdScheme }
  | { op: 'delete'; deleted: string };

/** The `op` discriminated request body for `POST /api/v1/pipelines`. */
export type PipelineMutationRequest =
  | { op: 'import'; path: string; force?: boolean }
  | { op: 'init'; name: string; output: string }
  | { op: 'export'; name: string; path: string; force?: boolean }
  | { op: 'delete'; name: string; force?: boolean }
  | { op: 'save'; name: string; definition: unknown; force?: boolean };

// -----------------------------------------------------------------------
// Pipeline definition API (pipeline-definition-api) — the detail, draft
// validation, and catalog reads plus the `save` mutation the pipeline canvas
// (children 3-4 of pipeline-online-assembly) needs. `packages/ui/src/api/
// types.ts` is DELIBERATELY not mirrored by this change: mirror discipline
// says the mirror is updated by the change that first CONSUMES a shape, and
// no UI code consumes these yet.
// -----------------------------------------------------------------------

/**
 * The JSON projection of a pipeline's declared definition, derived from the
 * loader's own accepted schema (`z.infer<typeof PipelineYamlSchema>`) so no
 * YAML-accepted field is silently dropped — round-tripping this value through
 * `save` and back through `detail` yields a semantically identical pipeline.
 */
export type WirePipelineDefinition = PipelineYaml | DefinitionSourceV2;

/** Public preparation metadata; the opaque compiled plan is intentionally absent. */
export interface WireDefinitionPreparation {
  /** Submitted content version; unsupported future versions remain observable. */
  authoredVersion: number;
  normalizedVersion: 2;
  definitionValid: boolean;
  diagnostics: PipelineValidationIssue[];
  digests?: {
    source: string;
    capability: string;
    plan: string;
  };
  planAvailable: boolean;
  executable: boolean;
  executionMode: 'legacy' | 'reconciler' | 'unavailable';
  unavailableReason?: string;
}

/** `GET /api/v1/pipelines/<name>` response (pipeline-definition-api). */
export interface PipelineDetailResponse {
  pipeline: WirePipeline;
  definition: WirePipelineDefinition;
  preparation: WireDefinitionPreparation;
  /** `false` for built-in (package-provenance) pipelines, which are still returned read-only as save-as templates. */
  editable: boolean;
}

/** `POST /api/v1/pipeline-validation` request body. */
export interface PipelineValidationRequest {
  definition: unknown;
  space?: string;
}

/** One issue reported by draft validation — `severity: 'error'` makes the draft invalid; `'warning'` does not. */
export interface PipelineValidationIssue {
  severity: 'error' | 'warning';
  code?: string;
  /** A JSON-pointer-ish locator into the definition, e.g. `/stages/2/skill`. */
  path: string;
  message: string;
  related?: { path: string; message: string }[];
}

/** `POST /api/v1/pipeline-validation` response — 200 for both a valid and an invalid draft. */
export interface PipelineValidationResponse {
  valid: boolean;
  issues: PipelineValidationIssue[];
  preparation: WireDefinitionPreparation;
}

/** One skill in the pipeline-catalog vocabulary. */
export interface PipelineCatalogSkill {
  id: string;
  description: string;
  /** Whether the skill is enabled in the active profile selection (a disabled skill is still listed, greyed out in the palette). */
  enabled: boolean;
  /**
   * Exact trusted Definition capability revision. Optional so older catalog
   * fixtures and v1-only clients remain source-compatible.
   */
  capability?: {
    id: string;
    version: string;
    inputs: readonly DefinitionPort[];
    artifacts: readonly DefinitionArtifact[];
    outcomes: readonly string[];
  };
}

/** `GET /api/v1/pipeline-catalog` response: the assembly vocabulary for the pipeline canvas. */
export interface PipelineCatalogResponse {
  roles: string[];
  skills: PipelineCatalogSkill[];
  runtimes: DispatchRuntime[];
  stageKinds: string[];
  loopKinds: string[];
  verifyPolicies: string[];
  /** Conventional freeform condition labels, offered as suggestions — the `condition` field itself stays freeform. */
  conditionLabels: string[];
  gate: { default: boolean };
  handoff: { fractionRange: [number, number]; remainingTokensGt: number };
}

/** `POST /api/v1/changes` request body (change-submission design D1). */
export interface SubmitChangeRequest {
  name: string;
  description: string;
  /** Optional planning-space selector (`project:<id|root>` | `store:<id>`); omitted = launch project (planning-space-addressing design D1). */
  space?: string;
}

/**
 * A session's frozen planning-space attribution as sent over the wire
 * (planning-space-addressing design D3). Mirrors `SessionSpace`
 * (session-registry.ts).
 */
export interface SessionSpaceWire {
  type: 'project' | 'store';
  id: string;
  root?: string;
}

/** `POST /api/v1/changes` success response: the CLI-created change, as reported by its own `--json` output. */
export interface SubmitChangeResponse {
  change: {
    id: string;
    path: string;
    schema: string;
  };
}

export interface StatusResponse {
  version: string;
  pid: number;
  project: ProjectRef | null;
}

// ---- Session audits (web-ui-session-audit) ----

export type AuditRuntimeWire = AuditRuntime;

export interface RecentAuditSessionWire {
  runtime: AuditRuntimeWire;
  sessionId: string;
  label: string;
  updatedAt: number;
  startedAt?: number;
  workingDir?: string;
  title?: string;
}

export interface AuditRuntimeDiagnosticWire {
  runtime: AuditRuntimeWire;
  available: boolean;
  message?: string;
}

export interface AuditSessionsResponse {
  sessions: RecentAuditSessionWire[];
  diagnostics: AuditRuntimeDiagnosticWire[];
  limit: number;
}

export interface AuditReportDescriptorWire {
  id: string;
  runtime: AuditRuntimeWire;
  sessionId: string;
  title?: string;
  generatedAt: string;
  sessionStart: number | null;
  sessionEnd: number | null;
  memberCount: number;
  modifiedAt: number;
}

export interface AuditReportsResponse {
  reports: AuditReportDescriptorWire[];
  skipped: number;
}

export interface AuditReportDetailResponse {
  descriptor: AuditReportDescriptorWire;
  report: unknown;
}

/** Per-artifact status, matching `ChangeStatus['artifacts']` from `formatChangeStatus` (design D4). */
export interface ChangeArtifactStatus {
  id: string;
  status: 'done' | 'ready' | 'blocked';
}

export interface ChangeTaskProgress {
  total: number;
  completed: number;
}

/**
 * One active change as reported to the board — facts only, no derived UI
 * policy (design D4: column assignment is a pure function in the UI, not a
 * wire field).
 */
export interface ChangeSummary {
  name: string;
  schemaName: string;
  artifacts: ChangeArtifactStatus[];
  /** All of the schema's `apply.requires` artifacts are done. */
  applyReady: boolean;
  isComplete: boolean;
  taskProgress: ChangeTaskProgress;
  /** Whether any of auto-run.json / goal-run.json / portfolio-run.json exists for this change. */
  hasRunFiles: boolean;
  /**
   * Portfolio-container membership, filesystem-derived like `hasRunFiles`
   * (ui-space-redesign-task-board spec): the longest sibling change directory
   * `P` holding a `planning-context.md` such that this change's name equals
   * `P` or begins with `P-`. Absent when no such container matches — the
   * change is not part of any portfolio.
   */
  portfolio?: string;
}

/**
 * A change whose `proposal.md` exists (so `getActiveChangeIds` counts it as
 * active) but whose schema/metadata could not be loaded — reported
 * explicitly rather than silently dropped from `changes` (review round 1
 * M2), mirroring the `ok | error` degradation `ChangeRunEntry` already uses.
 */
export interface ChangeLoadError {
  name: string;
  message: string;
}

export interface ChangesResponse {
  changes: ChangeSummary[];
  errors: ChangeLoadError[];
}

/**
 * Tagged result of reading one run-state file (design D5): exactly one of a
 * parsed value, an invalid-with-reason report, or absent.
 */
export type RunFileResult<T> =
  | { kind: 'ok'; state: T }
  | { kind: 'invalid'; reason: string }
  | { kind: 'absent' };

/** `goal-run.json` has no typed reader module; surfaced as opaque raw JSON (design D5). */
export interface GoalRunRaw {
  raw: unknown;
}

/** Per-change run-state report, or a degraded per-change error entry (design D5). */
export type ChangeRunEntry =
  | {
      name: string;
      kind: 'ok';
      autoRun: RunFileResult<RunState>;
      portfolio: RunFileResult<PortfolioState>;
      goalRun: RunFileResult<GoalRunRaw>;
    }
  | { name: string; kind: 'error'; message: string };

export interface RunsResponse {
  runs: ChangeRunEntry[];
  /**
   * Reconciler-engine Run summaries from the machine-home store, projected
   * through the shared Change-run projector (task 13.2). Additive to legacy
   * `runs`; absent when the store root does not exist (pre-reconciler install).
   */
  reconcilerRuns?: ReconcilerRunSummary[];
  /**
   * Opaque stable cursor for the next page of reconciler summaries (task
   * 13.3/13.4). Absent when there are no more entries.
   */
  nextCursor?: string;
  /** Whether more reconciler summaries remain beyond this page. */
  hasMore?: boolean;
}

/**
 * One reconciler-engine Run summary in the runs list (task 13.2). Derived
 * from the canonical machine-home Record through the shared projector; never
 * from a secondary index. Includes exact Run identity, frozen engine, status,
 * Record version, and a waits-or-terminal summary.
 */
export interface ReconcilerRunSummary {
  runId: string;
  changeId: string;
  planningSpaceId: string;
  engine: 'reconciler';
  recordVersion: number;
  status: string;
  sourceState: 'active' | 'archived' | 'missing';
  /** Number of active waits (non-terminal Runs). */
  waits?: number;
  /** Terminal outcome summary (terminal Runs). */
  terminal?: unknown;
  /**
   * Present when the Run's Record ledger is corrupt, gapped, oversized, or
   * otherwise unreadable. The Run is reported as an individual error without
   * hiding unrelated Runs or falling back to an earlier revision.
   */
  error?: { code: string; message: string };
}

// -----------------------------------------------------------------------
// Task detail (ui-space-redesign-task-detail design D2) — `GET /api/v1/tasks/:id`.
// A Task's full roster: every constituent change, active AND archived, each
// with lifecycle facts + task progress, plus portfolio dependency hints. The
// only endpoint that can see a portfolio's parent container (no `proposal.md`,
// invisible to `/changes`), its archived children (gone from `/changes`), and
// its `portfolio-run.json` deps (the container is not an active change).
// -----------------------------------------------------------------------

/** One constituent change of a Task (design D2), active or archived. */
export interface TaskChildDetail {
  /** The un-dated change name (archived children have their `YYYY-MM-DD-` prefix stripped). */
  name: string;
  /** Whether this child has been archived (⇒ shipped ⇒ done). */
  archived: boolean;
  /** `'YYYY-MM-DD'` archive date, present only for an archived child. */
  archivedAt?: string;
  /** Task-checkbox counts at child level (archived children have no `summary` but still carry counts). */
  taskProgress: ChangeTaskProgress;
  /** Best-effort parsed checklist items — rendered as a checklist for a single Task, a bar for portfolio children. */
  tasks: { text: string; done: boolean }[];
  /** The active child's lifecycle facts (same shape `/changes` reports); `null` for an archived child (column forced `done`). */
  summary: ChangeSummary | null;
  /** The active child's run-state join (same helper `/runs`/`sessions` use); `null` for an archived child. */
  run: ChangeRunEntry | null;
  /** Sibling dependencies declared in `portfolio-run.json`; empty when none is recorded. */
  dependsOn: string[];
  /** This child's `portfolio-run.json` status, when a run state is recorded. */
  portfolioStatus?: PortfolioChildStatus;
  /** An active child whose context failed to load (mirrors `/changes`' per-change error degradation). */
  loadError?: string;
}

/** `GET /api/v1/tasks/:id` response (design D2): the Task, its roster, and task-level load errors. */
export interface TaskDetailResponse {
  task: { id: string; kind: 'portfolio' | 'single'; label: string };
  children: TaskChildDetail[];
  errors: ChangeLoadError[];
}

// -----------------------------------------------------------------------
// Archive listing (ui-space-redesign-archive-page design D1) —
// `GET /api/v1/archive`. The space-wide roster of archived changes, the
// sticky-union of the in-repo archive and the machine-home archive that
// `getArchivedChangeIds` reports. Complementary to `/api/v1/tasks/:id` (which
// reports one Task's archived children): this reports the whole space's
// archived changes with no Task id in hand.
// -----------------------------------------------------------------------

/** One archived change as reported by the archive listing (design D1). */
export interface ArchivedChangeSummary {
  /** The un-dated change name (the `YYYY-MM-DD-` prefix stripped). */
  name: string;
  /** The `YYYY-MM-DD` archive date. */
  archivedAt: string;
  /**
   * Portfolio-container membership by the same longest-prefix rule the changes
   * listing uses; absent when the archived change is under no container.
   */
  portfolio?: string;
  /** Task-checkbox progress of the archived change, best-effort (never throws). */
  taskProgress: ChangeTaskProgress;
}

/** `GET /api/v1/archive` response (design D1). */
export interface ArchiveResponse {
  changes: ArchivedChangeSummary[];
}

// -----------------------------------------------------------------------
// Local-path browsing (local-path-browsing design D3) — `GET /api/v1/local-paths`.
// Read-only directory enumeration feeding the create-space picker: home start
// point, any explicit absolute path, git-repo detection. The browser never
// touches the filesystem itself — every directory fact on screen comes from here.
// -----------------------------------------------------------------------

/** One entry of an enumerated directory (design D3). */
export interface LocalPathEntry {
  name: string;
  isDir: boolean;
  /** True when the entry contains a `.git` directory OR a `.git` file (worktrees/submodules use a file). */
  isGitRepo: boolean;
}

/** `GET /api/v1/local-paths` response (design D3). */
export interface LocalPathsResponse {
  /** The canonical absolute path enumerated. */
  path: string;
  /** The canonical parent path, or null at a filesystem root. */
  parent: string | null;
  /** The platform path separator (`path.sep`). */
  separator: string;
  /** True only for the home start-point response (no `path` param supplied). */
  home?: boolean;
  entries: LocalPathEntry[];
}

/** Selection kinds accepted by the read-only path resolver. */
export type LocalPathSelectionKind = 'directory' | 'file' | 'file-or-directory';

/** `GET /api/v1/local-paths/resolve` response. */
export interface ResolveLocalPathResponse {
  path: string;
  kind: 'directory' | 'file';
  separator: string;
}

/** Fixed chooser modes and filters; callers cannot provide executable text. */
export interface ChooseLocalPathRequest {
  kind: 'directory' | 'file';
  initialDirectory?: string;
  filter?: 'rasen-package';
}

/** `POST /api/v1/local-paths/choose` response. */
export type ChooseLocalPathResponse =
  | {
      status: 'selected';
      path: string;
      kind: 'directory' | 'file';
      separator: string;
    }
  | { status: 'cancelled' }
  | {
      status: 'unavailable';
      reason: 'unsupported' | 'headless' | 'missing-utility' | 'launch-failed' | 'timeout';
    };

// -----------------------------------------------------------------------
// Space creation (space-creation design D4/D5) — `POST /api/v1/spaces`.
// The server never writes workspace files: it spawns the CLI (init / store
// register / store setup), passing the CLI's own errors through verbatim.
// -----------------------------------------------------------------------

/** `POST /api/v1/spaces` request body (design D4). */
export type CreateSpaceRequest =
  | { op: 'create-project'; path: string }
  | { op: 'create-store'; parent: string; id: string }
  | { op: 'register-store'; path: string; id?: string };

/** `POST /api/v1/spaces` success response (design D4): the operation performed plus the new space's listing entry. */
export interface CreateSpaceResponse {
  operation: 'init' | 'store-register' | 'store-setup';
  space: SpaceEntry;
}

// -----------------------------------------------------------------------
// Sessions (session-supervision design D2/D4) — sibling-stable wire shapes
// for the sessions UI child.
// -----------------------------------------------------------------------

/** Mirrors `SessionRecord` (session-registry.ts) as sent over the wire. */
export interface SessionRecordWire {
  id: string;
  kind: 'auto' | 'goal' | 'hosted';
  task: string;
  cwd: string;
  /** Planning-space attribution frozen at launch (design D3); absent when the cwd yielded no derivable space. */
  space?: SessionSpaceWire;
  pid?: number;
  agentSessionId?: string;
  state: 'starting' | 'running' | 'exiting' | 'exited';
  startedAt: number;
  lastOutputAt: number;
  endedAt?: number;
  exitCode?: number | null;
  exitSignal?: string | null;
  terminationReason?:
    | 'exit'
    | 'signal'
    | 'overall-timeout'
    | 'no-output-timeout'
    | 'killed'
    | 'server-shutdown'
    | 'spawn-error'
    | 'retired'
    | 'host-failed';
  changeName?: string;
  /** Additive durable-host lifecycle facts. Existing one-shot records omit them. */
  hostState?: import('../session-host/contracts.js').HostedSessionState;
  backend?: string;
  backendSessionId?: string;
  generation?: number;
  currentRequest?: import('../session-host/contracts.js').SessionHostView['currentRequest'];
  /** Best-effort tier limits published before the workload started; absent means the exact tier. */
  processDeclaration?: import('../session-host/contracts.js').HostedProcessDeclaration;
  /** Permanent honest terminal of a declared best-effort scope, e.g. `cancelled / emptiness-unproven`. */
  processTerminal?: import('../session-host/contracts.js').HostedProcessTerminal;
  recoveryReason?: string;
  retirementReason?: string;
}

/** `POST /api/v1/sessions` request body (design D1/D4). */
export interface LaunchSessionRequest {
  kind: string;
  task: string;
  changeName?: string;
  /** Optional planning-space selector (`project:<id|root>` | `store:<id>`); omitted = launch project (planning-space-addressing design D3). */
  space?: string;
  /**
   * Runtime-only execution selection. `planning` explicitly runs in a Store's
   * planning root; `project:<selector>` resolves a registered project or one
   * of its linked worktrees server-side. Never persisted on the Session.
   */
  execution?: 'planning' | `project:${string}`;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
}

/**
 * The read-only run-state join for one session (design D4): the change's
 * on-disk run-state when the session carries a `changeName`, or `absent`
 * when it does not (an `auto` run that will create its own change is
 * invisible to this join until the change appears — the board's existing
 * `/runs` polling covers it once it exists).
 */
export type SessionRunStateJoin = ChangeRunEntry | { kind: 'absent' };

export interface SessionListEntry {
  session: SessionRecordWire;
  runState: SessionRunStateJoin;
}

/** `GET /api/v1/sessions` response. */
export interface SessionsResponse {
  sessions: SessionListEntry[];
}

/** `GET /api/v1/sessions/:id` response: the record plus bounded output tails. */
export interface SessionDetailResponse {
  session: SessionRecordWire;
  tails: { stdout: string; stderr: string };
}

/** `POST /api/v1/sessions` and `DELETE /api/v1/sessions/:id` response shape: the record, wrapped like every other sessions response. */
export interface SessionActionResponse {
  session: SessionRecordWire;
}

// -----------------------------------------------------------------------
// Spaces listing (planning-space-addressing design D6) — `GET /api/v1/spaces`.
// -----------------------------------------------------------------------

/** A store's member project (planning-space-addressing design D4): a pointer repo whose config `store:` currently names the store. */
export interface SpaceMember {
  projectId: string;
  name: string;
  root?: string;
}

/** An in-repo project space (design D6): a live machine-project-registry entry with `mode: 'in-repo'`. */
export interface ProjectSpaceEntry {
  type: 'project';
  id: string;
  name: string;
  root?: string;
  /**
   * The project's live worktree count (worktree-aware-spaces D3), derived from
   * `git worktree list` at read time and never persisted. Present only when the
   * root is a git repository with more than one worktree; absent otherwise (no
   * inventory, or a single worktree) so a single-worktree project shows no badge.
   */
  worktreeCount?: number;
}

/** A registered store space (design D6): its members inline (reverse-enumerated per D4). */
export interface StoreSpaceEntry {
  type: 'store';
  id: string;
  name: string;
  root?: string;
  members: SpaceMember[];
}

export type SpaceEntry = ProjectSpaceEntry | StoreSpaceEntry;

/** `GET /api/v1/spaces` response (design D6). */
export interface SpacesResponse {
  spaces: SpaceEntry[];
}

/**
 * One worktree of a space's repository (worktree-aware-spaces D3), from the
 * live `GET /api/v1/spaces/worktrees` inventory — derived from git at read time,
 * never persisted.
 */
export interface SpaceWorktreeEntry {
  /** The worktree's absolute working-tree root. */
  root?: string;
  /** The checked-out branch's short name, or null when detached. */
  branch: string | null;
  /** True for the main checkout. */
  isMain: boolean;
  /** Active changes in this worktree's own `rasen/changes` (same definition as the changes listing: `proposal.md` present). */
  activeChangeCount: number;
}

/** `GET /api/v1/spaces/worktrees` response (worktree-aware-spaces D3): empty for a non-git space root. */
export interface SpaceWorktreesResponse {
  worktrees: SpaceWorktreeEntry[];
}

// -----------------------------------------------------------------------
// Workflow library (workflow-http-api design D3/D4) — the listing, detail,
// validation reads and the CLI-backed mutation bridge. Every read mirrors the
// corresponding `rasen workflow <sub> --json` payload field-for-field so the
// UI never diverges from CLI truth.
// -----------------------------------------------------------------------

/** One valid catalog unit as reported by `GET /api/v1/workflows` (mirrors `workflow list --json`). */
export interface WorkflowListEntry {
  id: string;
  source: WorkflowSourceKind;
  sourcePath: string | null;
  digest: string;
  kind: WorkflowKind;
  skillName: string;
  /** Author-declared display title from the manifest's `skill:` block; null when the workflow declares none. */
  title: string | null;
  /** True only for a user workflow with no detected machine-level consumer (same marker `workflow list` computes). */
  unused: boolean;
}

/** One invalid user entry, reported rather than dropped (mirrors the CLI list's `invalid` collection). */
export interface WorkflowInvalidEntry {
  id: string;
  source: WorkflowSourceKind;
  sourcePath: string;
  valid: false;
  diagnostics: WorkflowDiagnostic[];
}

/** `GET /api/v1/workflows` response. */
export interface WorkflowListResponse {
  workflows: WorkflowListEntry[];
  invalid: WorkflowInvalidEntry[];
  diagnostics: WorkflowDiagnostic[];
}

/** One workflow's dependency associations (workflow-http-api spec / design D7). */
export interface WorkflowDependencyEntryWire {
  /** The workflow id this entry describes. */
  id: string;
  /** The transitive strong dependency closure (excludes `id`; each id once). */
  requires: string[];
  /** The workflow ids this unit weakly enhances. */
  enhances: string[];
}

/** `GET /api/v1/workflow-dependencies` response — the advisory dependency graph. */
export interface WorkflowDependenciesResponse {
  dependencies: WorkflowDependencyEntryWire[];
}

/** The full definition as reported by `GET /api/v1/workflows/<id>` (mirrors `workflowDefinitionForJson`). */
export interface WorkflowDefinitionWire {
  id: string;
  source: WorkflowSourceKind;
  sourcePath: string | null;
  manifestVersion: number;
  kind: WorkflowKind;
  /** Author-declared presentation metadata from the manifest's `skill:` block; null when not declared. */
  title: string | null;
  category: string | null;
  tags: string[] | null;
  digest: string;
  skill: { name: string; dirName: string; description: string };
  requires: WorkflowDependencySet;
  recommends: WorkflowRecommendations;
  files: { path: string; sha256: string }[];
}

/** `GET /api/v1/workflows/<id>` response (mirrors `workflow show --json`). */
export interface WorkflowDetailResponse {
  workflow: WorkflowDefinitionWire;
  usage: WorkflowUsage[];
}

/** `GET /api/v1/workflow-validation` response (mirrors `workflow validate --json`). */
export interface WorkflowValidationResponse {
  validation: WorkflowValidationSummary;
}

/**
 * `POST /api/v1/workflows` request body, discriminated by `op` (design D3/D4).
 * `import` takes a source path; `init` a new id and output directory; `export`
 * an id, a destination path, and an optional overwrite flag; `delete` an id
 * and an optional force flag (confirmation is the UI's job, so the bridge
 * always runs the CLI's `--yes` form).
 */
export type WorkflowMutationRequest =
  | { op: 'import'; path: string }
  | { op: 'init'; id: string; output: string }
  | { op: 'export'; id: string; path: string; force?: boolean }
  | { op: 'delete'; id: string; force?: boolean };

/** `import` success payload (passed through from `workflow import --json`). */
export interface WorkflowImportResponse {
  imported: string[];
  reused: string[];
  roots?: string[];
}

/** `init` success payload (passed through from `workflow init --json`). */
export interface WorkflowInitResponse {
  workflow: { id: string; output: string };
}

/** `export` success payload (passed through from `workflow export --json`). */
export interface WorkflowExportResponse {
  workflow: { id: string; path: string };
}

/** `delete` success payload (passed through from `workflow delete --json`). */
export interface WorkflowDeleteResponse {
  deleted: string;
  forcedReferrers: string[];
}

/** `POST /api/v1/workflows` success response — one of the four op payloads. */
export type WorkflowMutationResponse =
  | WorkflowImportResponse
  | WorkflowInitResponse
  | WorkflowExportResponse
  | WorkflowDeleteResponse;

/**
 * One selectable catalog unit's enablement state in an addressed space
 * (space-workflow-enablement design D4). `title` already carries the
 * skill-name fallback (never null/empty) — the same presentation rule
 * `workflowDefinitionForJson` applies for the library page.
 */
export interface WorkflowEnablementUnit {
  id: string;
  kind: WorkflowKind;
  source: WorkflowSourceKind;
  title: string;
  skillName: string;
  enabled: boolean;
  installed: boolean;
  /** True when enabled only because an enabled workflow's dependency closure requires it. */
  requiredByClosure: boolean;
}

/** `GET /api/v1/workflow-enablement?root=<...>` response (design D4). */
export interface WorkflowEnablementResponse {
  /**
   * Whether the addressed space follows the user-wide profile, its own
   * selection override, or a profile lock in its config (init-profile-lock).
   */
  mode: 'profile' | 'override' | 'locked-profile';
  /**
   * The profile name a `locked-profile` space is locked to
   * (ui-profile-workflow-split design D2): `full`, `core`, or a saved profile
   * name. Absent for the `profile`/`override` modes so the client can show
   * *which* profile governs, not merely that a lock exists.
   */
  lockedProfile?: string;
  units: WorkflowEnablementUnit[];
}

/**
 * `POST /api/v1/workflow-enablement` request body, discriminated by `op`
 * (design D5). `enable`/`disable` require a known catalog unit id; `reset`
 * takes none. Every op addresses a space via `root` (an absolute path
 * matching a registered space — no `space` selector namespace here, since a
 * space toggle always targets one concrete filesystem root).
 */
export type WorkflowEnablementMutationRequest =
  | { root: string; op: 'enable'; id: string }
  | { root: string; op: 'disable'; id: string }
  | { root: string; op: 'reset' }
  // ui-profile-workflow-split design D2: switch a space's profile lock. `set-profile`
  // writes the project `profile` key to `full`/`core`/a saved name AND clears the
  // `workflows` override in the same write (D4); `clear-profile` unsets the lock only.
  | { root: string; op: 'set-profile'; profile: string }
  | { root: string; op: 'clear-profile' }
  // ui-profile-polish M1: make a space follow the user-wide profile — clears BOTH
  // the `workflows` override AND the `profile` lock in one atomic write. Distinct
  // from `reset` (clears the override only, revealing any lock) and from
  // `clear-profile` (clears the lock only, leaving an override in place): those
  // two are silent no-ops when the *other* layer still governs, so a space in
  // override mode needs this to genuinely return to the global profile.
  | { root: string; op: 'follow-global' };

// -----------------------------------------------------------------------
// Named workflow profiles (ui-profile-workflow-split profile-http-api design
// D1) — `GET`/`POST /api/v1/profiles`. An in-process wrapper over
// `named-profiles.ts` (the same code path the `rasen profile` CLI uses):
// profile writes touch only a YAML file, so no bounded-CLI bridge is involved.
// -----------------------------------------------------------------------

/** One available profile as reported by `GET /api/v1/profiles`. A broken saved file carries `error` instead of `workflows`. */
export interface WireProfileEntry {
  name: string;
  builtIn: boolean;
  /** The (normalized, closure-expanded) workflow membership; absent when the file failed to parse. */
  workflows?: string[];
  /** A parse/validation error description for a broken saved profile; absent when the entry is valid. */
  error?: string;
}

/** `GET /api/v1/profiles` response. */
export interface ProfileListResponse {
  profiles: WireProfileEntry[];
}

/**
 * `POST /api/v1/profiles` request body, discriminated by `op` (design D1).
 * `create`/`update` carry the desired membership list (validated + normalized
 * server-side); `delete` names the saved profile to remove. Built-in and
 * reserved names are refused by the library's own validation.
 */
export type ProfileMutationRequest =
  | { op: 'create'; name: string; workflows: string[] }
  | { op: 'update'; name: string; workflows: string[] }
  | { op: 'delete'; name: string };

/** `POST /api/v1/profiles` success response: the normalized entry for create/update, or the deleted name. */
export type ProfileMutationResponse = { profile: WireProfileEntry } | { deleted: string };

// -----------------------------------------------------------------------
// Durable reusable sessions (`rasen-reusable-session-api/1`).
// -----------------------------------------------------------------------

export const REUSABLE_SESSION_API_SCHEMA = 'rasen-reusable-session-api/1' as const;

export interface ReusableSessionTouchPolicyWire {
  mode: 'auto' | 'never';
  deadlineAt?: string;
  maxTouches: number;
  touchesUsed: number;
  deadlineAction: 'stop' | 'retire-silent';
}

export interface ReusableSessionTerminalWire {
  admittedAt: string;
  dispatchFenceAt?: string;
  settledAt: string;
  outcome: 'completed' | 'pre_delivery_failed' | 'delivery_uncertain';
  kind?: 'interactive' | 'touch';
  touchOrdinal?: number;
  touchAttempt?: number;
  code?: string;
}

export interface ReusableSessionProjectionWire {
  runId: string;
  sessionKey: string;
  role: string;
  status: 'starting' | 'idle' | 'waking' | 'lost' | 'stale' | 'retiring' | 'retired';
  cwd: string;
  lifecycle: {
    createdAt: string;
    updatedAt: string;
    lastWakeAt?: string;
    lostAt?: string;
    recoveredAt?: string;
    retirementRequestedAt?: string;
    retiredAt?: string;
    reason?: string;
  };
  touchPolicy: ReusableSessionTouchPolicyWire;
  wakes: ReusableSessionTerminalWire[];
}

export interface ReusableSessionInteractiveWakeRequest {
  schema: typeof REUSABLE_SESSION_API_SCHEMA;
  op: 'wake';
  kind: 'interactive';
  runId: string;
  sessionKey: string;
  action: unknown;
  cwd: string;
  messageId?: string;
  touchPolicy: Omit<ReusableSessionTouchPolicyWire, 'touchesUsed'>;
}

export interface ReusableSessionTouchWakeRequest {
  schema: typeof REUSABLE_SESSION_API_SCHEMA;
  op: 'wake';
  kind: 'touch';
  runId: string;
  sessionKey: string;
  messageId: string;
  message: string;
  expectedLastWakeAt: string;
  touchOrdinal: number;
  touchAttempt: number;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
}

export type ReusableSessionWakeRequest =
  | ReusableSessionInteractiveWakeRequest
  | ReusableSessionTouchWakeRequest;

export interface ReusableSessionRetireRequest {
  schema: typeof REUSABLE_SESSION_API_SCHEMA;
  op: 'retire';
  runId: string;
  sessionKey: string;
  reason: string;
}

export interface ReusableSessionTouchPolicyRequest {
  schema: typeof REUSABLE_SESSION_API_SCHEMA;
  op: 'touch-policy';
  runId: string;
  sessionKey: string;
  expectedLastWakeAt?: string;
  policy: ReusableSessionTouchPolicyWire;
}

export interface ReusableSessionApiSuccess {
  schema: typeof REUSABLE_SESSION_API_SCHEMA;
  ok: true;
  operation: 'wake' | 'list' | 'retire' | 'touch-policy';
  code: string;
  runId?: string;
  sessionKey?: string;
  disposition?: 'completed' | 'duplicate';
  terminalDisposition?: 'completed' | 'pre_delivery_failed' | 'delivery_uncertain';
  session?: ReusableSessionProjectionWire;
  sessions?: ReusableSessionProjectionWire[];
}

export interface ReusableSessionOwnerShutdownDiagnosticWire {
  runId?: string;
  code: string;
  message: string;
}

export interface ReusableSessionApiFailure {
  schema: typeof REUSABLE_SESSION_API_SCHEMA;
  ok: false;
  operation: 'wake' | 'list' | 'retire' | 'touch-policy';
  code: string;
  message: string;
  runId?: string;
  sessionKey?: string;
  session?: ReusableSessionProjectionWire;
  failures?: ReusableSessionOwnerShutdownDiagnosticWire[];
}

export type ReusableSessionApiResponse =
  | ReusableSessionApiSuccess
  | ReusableSessionApiFailure;

const ReusableSessionTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
});

const ReusableSessionTouchPolicyResponseSchema = z
  .object({
    mode: z.enum(['auto', 'never']),
    deadlineAt: ReusableSessionTimestampSchema.optional(),
    maxTouches: z.number().int().nonnegative(),
    touchesUsed: z.number().int().nonnegative(),
    deadlineAction: z.enum(['stop', 'retire-silent']),
  })
  .strict();

const ReusableSessionTerminalResponseSchema = z
  .object({
    admittedAt: ReusableSessionTimestampSchema,
    dispatchFenceAt: ReusableSessionTimestampSchema.optional(),
    settledAt: ReusableSessionTimestampSchema,
    outcome: z.enum([
      'completed',
      'pre_delivery_failed',
      'delivery_uncertain',
    ]),
    kind: z.enum(['interactive', 'touch']).optional(),
    touchOrdinal: z.number().int().positive().optional(),
    touchAttempt: z.number().int().positive().optional(),
    code: z.string().min(1).optional(),
  })
  .strict();

const ReusableSessionProjectionResponseSchema = z
  .object({
    runId: z.string().min(1),
    sessionKey: z.string().min(1),
    role: z.string().min(1),
    status: z.enum([
      'starting',
      'idle',
      'waking',
      'lost',
      'stale',
      'retiring',
      'retired',
    ]),
    cwd: z.string().min(1),
    lifecycle: z
      .object({
        createdAt: ReusableSessionTimestampSchema,
        updatedAt: ReusableSessionTimestampSchema,
        lastWakeAt: ReusableSessionTimestampSchema.optional(),
        lostAt: ReusableSessionTimestampSchema.optional(),
        recoveredAt: ReusableSessionTimestampSchema.optional(),
        retirementRequestedAt: ReusableSessionTimestampSchema.optional(),
        retiredAt: ReusableSessionTimestampSchema.optional(),
        reason: z.string().optional(),
      })
      .strict(),
    touchPolicy: ReusableSessionTouchPolicyResponseSchema,
    wakes: z.array(ReusableSessionTerminalResponseSchema),
  })
  .strict();

const ReusableSessionWakeSuccessResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(true),
    operation: z.literal('wake'),
    code: z.string().min(1),
    runId: z.string().min(1),
    sessionKey: z.string().min(1),
    disposition: z.enum(['completed', 'duplicate']),
    terminalDisposition: z.enum([
      'completed',
      'pre_delivery_failed',
      'delivery_uncertain',
    ]),
    session: ReusableSessionProjectionResponseSchema,
  })
  .strict();

const ReusableSessionListSuccessResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(true),
    operation: z.literal('list'),
    code: z.string().min(1),
    runId: z.string().min(1).optional(),
    sessions: z.array(ReusableSessionProjectionResponseSchema),
  })
  .strict();

const ReusableSessionMutationSuccessResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(true),
    operation: z.enum(['retire', 'touch-policy']),
    code: z.string().min(1),
    runId: z.string().min(1),
    sessionKey: z.string().min(1),
    session: ReusableSessionProjectionResponseSchema,
  })
  .strict();

const ReusableSessionOwnerShutdownDiagnosticResponseSchema = z
  .object({
    runId: z.string().min(1).optional(),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  })
  .strict();

const ReusableSessionFailureResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(false),
    operation: z.enum(['wake', 'list', 'retire', 'touch-policy']),
    code: z.string().min(1),
    message: z.string(),
    runId: z.string().min(1).optional(),
    sessionKey: z.string().min(1).optional(),
    session: ReusableSessionProjectionResponseSchema.optional(),
    failures: z
      .array(ReusableSessionOwnerShutdownDiagnosticResponseSchema)
      .optional(),
  })
  .strict();

const ReusableSessionApiResponseSchema = z.union([
  ReusableSessionWakeSuccessResponseSchema,
  ReusableSessionListSuccessResponseSchema,
  ReusableSessionMutationSuccessResponseSchema,
  ReusableSessionFailureResponseSchema,
]);

export type ReusableSessionApiResponseExpectation =
  | {
      operation: 'list';
      runId: string;
    }
  | {
      operation: 'list';
      scope: 'all';
    }
  | {
      operation: 'wake' | 'retire' | 'touch-policy';
      runId: string;
      sessionKey: string;
    };

function responseIdentityMatchesExpectation(
  response: ReusableSessionApiResponse,
  expectation: ReusableSessionApiResponseExpectation
): boolean {
  const projections = [
    ...(response.session === undefined ? [] : [response.session]),
    ...('sessions' in response ? (response.sessions ?? []) : []),
  ];

  if ('scope' in expectation) {
    return response.runId === undefined && response.sessionKey === undefined;
  }

  if (
    (response.runId !== undefined && response.runId !== expectation.runId)
    || projections.some(
      (projection) => projection.runId !== expectation.runId
    )
  ) {
    return false;
  }

  if (
    response.ok
    && response.operation === 'list'
    && response.runId !== expectation.runId
  ) {
    return false;
  }

  if ('sessionKey' in expectation) {
    return (
      (
        response.sessionKey === undefined
        || response.sessionKey === expectation.sessionKey
      )
      && projections.every(
        (projection) => projection.sessionKey === expectation.sessionKey
      )
    );
  }

  return (
    response.sessionKey === undefined
    || projections.every(
      (projection) => projection.sessionKey === response.sessionKey
    )
  );
}

/**
 * The one runtime trust boundary for reusable-session HTTP responses.
 * Unknown keys and operation/projection drift are rejected before callers
 * render or forward any daemon-provided value.
 */
export function decodeReusableSessionApiResponse(
  value: unknown,
  expectation: ReusableSessionApiResponseExpectation
): ReusableSessionApiResponse | null {
  const decoded = ReusableSessionApiResponseSchema.safeParse(value);
  if (
    !decoded.success
    || decoded.data.operation !== expectation.operation
    || !responseIdentityMatchesExpectation(
      decoded.data as ReusableSessionApiResponse,
      expectation
    )
  ) {
    return null;
  }
  return decoded.data as ReusableSessionApiResponse;
}

// -----------------------------------------------------------------------
// Store aggregate (store-issue-resources) — `GET`/`POST /api/v1/stores/*`.
// Every read/mutation handler in `stores.ts` sends its `StoreHandlerResult`
// UNWRAPPED (`sendJson(res, 200, result.response)`, `router.ts`) — the wire
// body is exactly the handler's own return type, never a hand-authored
// envelope. Re-declaring these shapes here would be a second source of truth
// the domain type could drift out from under, so each response type below is
// a direct alias, not a redeclaration; only the three POST request bodies
// are wire-specific, because an HTTP body is untrusted JSON and each field's
// wire type is the OPTIONAL, loosely-typed shape `stores.ts` itself validates
// at runtime (`typeof body.x === '...'`), not the complete domain input type.
// -----------------------------------------------------------------------

/** `GET /api/v1/stores/projects` response. */
export type StoreProjectsResponse = ProjectRollup;

/** `GET /api/v1/stores/target-lines` response. */
export type StoreTargetLinesResponse = TargetLineRollup;

/** `GET /api/v1/stores/changes` response. */
export type StoreChangesResponse = GroupedChanges;

/** `GET /api/v1/stores/issues` response. */
export type StoreIssuesResponse = IssueSummaryPage;

/** `GET /api/v1/stores/issue` response. */
export type StoreIssueDetailResponse = IssueDetail;

/** `GET /api/v1/stores/issue-references` response. */
export type StoreIssueReferencesResponse = IssueSummaryPage;

/** `GET /api/v1/stores/execution-plan` response. */
export type StoreExecutionPlanResponse = ResolvedExecutionPlan;

/** `POST /api/v1/stores/issues` and `POST /api/v1/stores/issue-state` response — both write one Issue record. */
export type StoreIssueRecordResponse = IssueRecordResult;

/** `POST /api/v1/stores/execution-plan` response. */
export type StoreExecutionPlanPublishResponse = ExecutionPlanResult;

/** `POST /api/v1/stores/issues` request body. */
export interface StoreIssueCreateRequest {
  issueId?: string;
  title?: string;
  readme?: boolean;
}

/** `POST /api/v1/stores/issue-state` request body. */
export interface StoreIssueSetStateRequest {
  issueId?: string;
  state?: string;
  reason?: string;
}

/** One node of a `POST /api/v1/stores/execution-plan` request body — the untrusted-JSON counterpart of `ExecutionPlanNodeInput`. */
export interface StoreExecutionPlanNodeInput {
  nodeId?: string;
  kind?: string;
  projectId?: string;
  targetLineId?: string;
  changeInstanceId?: string;
  changeAlias?: string;
  summary?: string;
  dependsOn?: string[];
}

/** `POST /api/v1/stores/execution-plan` request body. */
export interface StoreExecutionPlanPublishRequest {
  issueId?: string;
  nodes?: StoreExecutionPlanNodeInput[];
}
