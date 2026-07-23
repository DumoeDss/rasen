/**
 * Hand-maintained mirror of the CLI's wire types (design.md D5 of
 * `unified-config-ui-pkg`). Source of truth: `src/core/config-api/wire-types.ts`
 * and `src/core/config-api/router.ts` in the main `rasen` package — there is
 * no build-time import path between `packages/ui` and the root package (D1:
 * no workspace), so this file is kept in sync by hand and pinned by the
 * `satisfies <ResponseType>` fixtures in `test/fixtures/*.ts` (no `as`/`as
 * unknown as` cast anywhere there — a real `tsc` drift tripwire), exercised
 * from `test/api/fixtures.test.ts` and every other test that imports them.
 *
 * If you change this file, check the CLI source above first — the wire
 * contract is v1-frozen by the `unified-config-api` spec, so a mismatch here
 * is a bug in this mirror, not a sanctioned protocol change.
 */

export type ConfigScope = 'global' | 'store' | 'project';
export type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum' | 'array' | 'threshold';
export type ConfigSource = 'default' | 'global' | 'store' | 'project' | 'env-override';

/** A registered project, or the server's launch project. */
export interface ProjectRef {
  projectId: string;
  name: string;
  root: string;
}

/**
 * The store contributing the store layer to a config read (W1 design D6,
 * mirrored from `StoreLayerRef` in the CLI's wire-types.ts): the inherited
 * store for a project context, or the addressed store's own root for a store
 * context. `null` in a response when no store layer is active.
 */
export interface StoreLayerRef {
  id: string;
  root: string;
}

export interface WireConstraints {
  type: ConfigValueType;
  enumValues?: readonly string[];
  /** For `type: 'number'`, or the fraction branch of `type: 'threshold'`. */
  range?: { gt: number; lte: number };
  /**
   * Present only for `type: 'threshold'`: describes the alternate absolute
   * form, a strict object `{ remainingTokens: N }` where `N` is an integer
   * greater than `remainingTokensGt`.
   */
  remainingTokensGt?: number;
}

/** `ConfigKeyDefinition` minus the unserializable `validate` function, plus derived `constraints`. */
export interface WireConfigKeyDefinition {
  key: string;
  scopes: ConfigScope[];
  type: ConfigValueType;
  enumValues?: readonly string[];
  defaultValue: unknown;
  description: string;
  group: string;
  wildcard?: boolean;
  constraints: WireConstraints;
}

export interface WireConfigEntry {
  definition: WireConfigKeyDefinition;
  value: unknown;
  source: ConfigSource;
  scopeValues: { global?: unknown; store?: unknown; project?: unknown };
  /**
   * The fully-qualified instance path for a wildcard family instance entry
   * (e.g. `pipelines.small-feature.gates.propose`). Absent on fixed keys and
   * on a family's template entry. Mirrors `instanceKey` in the CLI's
   * wire-types.ts — the Pipelines page (this change) is its first consumer.
   */
  instanceKey?: string;
  /** Present only when a raw on-disk scope value fails registry validation. */
  warnings?: string[];
}

/**
 * Uniform non-2xx error envelope. `cliExitCode`/`stderr` are populated only
 * for the change-submission endpoint's `cli_error` code (design D3 of
 * `platform-slice2-task-submission`): the CLI's own exit code and captured
 * stderr, passed through verbatim.
 */
export interface ApiErrorBody {
  error: { code: string; message: string; fix?: string; cliExitCode?: number; stderr?: string };
}

// ---- Response envelopes (router.ts handlers) ----

export interface HealthResponse {
  ok: true;
  version: string;
  project: ProjectRef | null;
}

export interface ListProjectsResponse {
  projects: ProjectRef[];
}

export interface ListConfigResponse {
  project: ProjectRef | null;
  /** The store layer contributing to this read (W1 design D6): the inherited store at a project space, the addressed store at a store space, or null. */
  store: StoreLayerRef | null;
  entries: WireConfigEntry[];
}

export interface GetConfigKeyResponse {
  entry: WireConfigEntry;
  /** The store layer contributing to this read (W1 design D6); null when no store layer is active. */
  store: StoreLayerRef | null;
}

/** PUT and DELETE both respond with the re-resolved entry. */
export type WriteConfigKeyResponse = GetConfigKeyResponse;

/**
 * A threshold value (mirrors `ThresholdValue` in the CLI's model-presets.ts): a
 * bare fraction of the context window in (0, 1], or an absolute
 * `{ remainingTokens: N }` headroom. A bare number is ALWAYS a fraction.
 */
export type ThresholdValue = number | { remainingTokens: number };

/**
 * An effective per-stage value plus the scope-qualified layer that supplied it
 * (`GET /api/v1/pipelines`; mirrors `WireEffectiveValue<T>` in the CLI's
 * wire-types.ts). `source` is a free-form scope-qualified label
 * (e.g. `stage-override-project`, `store`, `definition`, `default`) rendered
 * verbatim — the UI never re-derives resolution.
 */
export interface WireEffectiveValue<T> {
  value: T;
  source: string;
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
  effectiveHandoff: WireEffectiveValue<ThresholdValue>;
  effectiveRuntime: WireEffectiveValue<'claude' | 'codex'>;
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
  stages: WirePipelineStage[];
}

/** `GET /api/v1/pipelines` response: the addressed space's resolved pipelines. */
export interface ListPipelinesResponse {
  project: ProjectRef | null;
  /** The store layer contributing to this read; null when no store layer is active. */
  store: StoreLayerRef | null;
  pipelines: WirePipeline[];
}

/** `POST /api/v1/pipelines` request body, discriminated by `op` (pipeline-http-api design D6). */
export type PipelineMutationRequest =
  | { op: 'import'; path: string; force?: boolean }
  | { op: 'init'; name: string; output: string }
  | { op: 'export'; name: string; path: string; force?: boolean }
  | { op: 'delete'; name: string; force?: boolean }
  | { op: 'save'; name: string; definition: unknown; force?: boolean };

export interface PipelineImportResponse {
  path: string;
  imported: string[];
  digests: Record<string, string>;
}
export interface PipelineInitResponse {
  pipeline: { name: string; output: string };
}
export interface PipelineExportResponse {
  pipeline: { name: string; path: string };
}
export interface PipelineDeleteResponse {
  deleted: string;
  forcedReferrers: string[];
}

/**
 * `op: 'save'` success payload (mirrors `pipeline save --json` in
 * `src/commands/pipeline-library.ts`): `created` distinguishes a brand-new
 * install (`true`) from an overwrite of an existing user pipeline (`false`) —
 * the client's own `request()` wrapper discards the HTTP status, so this
 * field is the only signal for the 201-vs-200 UX distinction.
 */
export interface PipelineSaveResponse {
  pipeline: { name: string; path: string };
  created: boolean;
}

/** `POST /api/v1/pipelines` success response — one of the five op payloads. */
export type PipelineMutationResponse =
  | PipelineImportResponse
  | PipelineInitResponse
  | PipelineExportResponse
  | PipelineDeleteResponse
  | PipelineSaveResponse;

// ---- Management API mirror (rasen-ui-slice1-readonly-api design.md D7) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root
// package. Same hand-maintained-mirror discipline as the config types above:
// kept in sync by hand, pinned by `satisfies <ResponseType>` fixtures.
// `WireRunState`/`WirePortfolioState` are deliberately a narrow subset of the
// CLI's full (zod, `passthrough()`) run-state shapes — only the fields the
// board actually renders (pipeline name, stage statuses for the escalation
// badge, portfolio children) are mirrored here.

export interface StatusResponse {
  version: string;
  pid: number;
  project: ProjectRef | null;
}

export interface ChangeArtifactStatus {
  id: string;
  status: 'done' | 'ready' | 'blocked';
}

export interface ChangeTaskProgress {
  total: number;
  completed: number;
}

export interface ChangeSummary {
  name: string;
  schemaName: string;
  artifacts: ChangeArtifactStatus[];
  applyReady: boolean;
  isComplete: boolean;
  taskProgress: ChangeTaskProgress;
  hasRunFiles: boolean;
  /**
   * Portfolio-container membership, filesystem-derived like `hasRunFiles`
   * (ui-space-redesign-task-board spec): the longest sibling change directory
   * `P` holding a `planning-context.md` such that this change's name equals
   * `P` or begins with `P-`. Absent when the change is not part of any
   * portfolio — the UI groups it as an implicit single-item Task.
   */
  portfolio?: string;
}

/**
 * A change with a valid `proposal.md` (so the server counts it active) but
 * whose schema/metadata could not be loaded — reported explicitly rather
 * than dropped from `changes` (review round 1 M2), so the board can render
 * a visibly broken card instead of a silent gap.
 */
export interface ChangeLoadError {
  name: string;
  message: string;
}

export interface ChangesResponse {
  changes: ChangeSummary[];
  errors: ChangeLoadError[];
}

// ---- Archive listing (ui-space-redesign-archive-page design D1/D6) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root package
// (`ArchivedChangeSummary`/`ArchiveResponse`). Same hand-maintained-mirror
// discipline as the rest of this file: copied field-for-field, pinned by the
// `satisfies ArchiveResponse` fixture in `test/fixtures/archive.ts`.

/** One archived change as reported by `GET /api/v1/archive`. */
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
  /** Task-checkbox progress of the archived change. */
  taskProgress: ChangeTaskProgress;
}

/** `GET /api/v1/archive` response. */
export interface ArchiveResponse {
  changes: ArchivedChangeSummary[];
}

export type StageStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'escalated';

export interface WireRunStage {
  status: StageStatus;
}

export interface WireRunState {
  pipeline: string;
  stages?: Record<string, WireRunStage>;
}

export interface WirePortfolioChild {
  id: string;
  status: StageStatus;
}

export interface WirePortfolioState {
  parent: string;
  children: WirePortfolioChild[];
}

export interface GoalRunRaw {
  raw: unknown;
}

export type RunFileResult<T> =
  | { kind: 'ok'; state: T }
  | { kind: 'invalid'; reason: string }
  | { kind: 'absent' };

export type ChangeRunEntry =
  | {
      name: string;
      kind: 'ok';
      autoRun: RunFileResult<WireRunState>;
      portfolio: RunFileResult<WirePortfolioState>;
      goalRun: RunFileResult<GoalRunRaw>;
    }
  | { name: string; kind: 'error'; message: string };

export interface RunsResponse {
  runs: ChangeRunEntry[];
}

// ---- Task detail (ui-space-redesign-task-detail design D2) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root package
// (`TaskChildDetail`/`TaskDetailResponse`). Same hand-maintained-mirror
// discipline as the rest of this file: copied field-for-field, kept in sync by
// hand, pinned by the `satisfies TaskDetailResponse` fixture in
// `test/fixtures/task-detail.ts`.

/** One constituent change of a Task, active or archived. */
export interface TaskChildDetail {
  /** The un-dated change name (archived children have their `YYYY-MM-DD-` prefix stripped). */
  name: string;
  /** Whether this child has been archived (⇒ shipped ⇒ done). */
  archived: boolean;
  /** `'YYYY-MM-DD'` archive date, present only for an archived child. */
  archivedAt?: string;
  /** Task-checkbox counts at child level (archived children have no `summary` but still carry counts). */
  taskProgress: ChangeTaskProgress;
  /** Best-effort parsed checklist items — a checklist for a single Task, a bar for portfolio children. */
  tasks: { text: string; done: boolean }[];
  /** The active child's lifecycle facts; `null` for an archived child (column forced `done`). */
  summary: ChangeSummary | null;
  /** The active child's run-state join; `null` for an archived child. */
  run: ChangeRunEntry | null;
  /** Sibling dependencies declared in `portfolio-run.json`; empty when none is recorded. */
  dependsOn: string[];
  /** This child's `portfolio-run.json` status, when a run state is recorded. */
  portfolioStatus?: StageStatus;
  /** An active child whose context failed to load (mirrors `/changes`' per-change error degradation). */
  loadError?: string;
}

/** `GET /api/v1/tasks/:id` response: the Task, its roster, and task-level load errors. */
export interface TaskDetailResponse {
  task: { id: string; kind: 'portfolio' | 'single'; label: string };
  children: TaskChildDetail[];
  errors: ChangeLoadError[];
}

// ---- Change submission (platform-slice2-task-submission design D1) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root
// package (`SubmitChangeRequest`/`SubmitChangeResponse`).

export interface SubmitChangeRequest {
  name: string;
  description: string;
  /** Optional planning-space selector (`project:<id|root>` | `store:<id>`); omitted = launch project (planning-space-addressing design D1). */
  space?: string;
}

export interface SubmitChangeResponse {
  change: {
    id: string;
    path: string;
    schema: string;
  };
}

// ---- Sessions (slice3-sessions-ui design D6) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root
// package (the "Sessions" section, settled by `slice3-session-runtime`,
// child 1 of this portfolio). Same hand-maintained-mirror discipline as the
// rest of this file: copied field-for-field, kept in sync by hand, pinned
// by `satisfies <ResponseType>` fixtures.

/**
 * A session's frozen planning-space attribution as sent over the wire
 * (planning-space-addressing design D3). Mirrors `SessionSpaceWire`
 * (management-api/wire-types.ts).
 */
export interface SessionSpaceWire {
  type: 'project' | 'store';
  id: string;
  root: string;
}

/** Mirrors `SessionRecord` (session-registry.ts) as sent over the wire. */
export interface SessionRecordWire {
  id: string;
  kind: 'auto' | 'goal';
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
    | 'spawn-error';
  changeName?: string;
}

/** `POST /api/v1/sessions` request body. */
export interface LaunchSessionRequest {
  kind: string;
  task: string;
  changeName?: string;
  /** Optional planning-space selector (`project:<id|root>` | `store:<id>`); omitted = launch project (planning-space-addressing design D3). */
  space?: string;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
}

/**
 * The read-only run-state join for one session: the change's on-disk
 * run-state when the session carries a `changeName`, or `absent` when it
 * does not (an `auto` run that will create its own change is invisible to
 * this join until the change appears — the board's `/runs` polling covers
 * it once it exists).
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

/** `POST /api/v1/sessions` and `DELETE /api/v1/sessions/:id` response shape. */
export interface SessionActionResponse {
  session: SessionRecordWire;
}

// ---- Spaces listing (planning-space-addressing design D6) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root
// package (`GET /api/v1/spaces`). Same hand-maintained-mirror discipline as
// the rest of this file.

/** A store's member project (design D4): a pointer repo whose config `store:` currently names the store. */
export interface SpaceMember {
  projectId: string;
  name: string;
  root: string;
}

/** An in-repo project space (design D6). */
export interface ProjectSpaceEntry {
  type: 'project';
  id: string;
  name: string;
  root: string;
  /** Live worktree count (worktree-aware-spaces D3); present only for a git repo with more than one worktree, absent otherwise. */
  worktreeCount?: number;
}

/** A registered store space (design D6): its members inline (reverse-enumerated per D4). */
export interface StoreSpaceEntry {
  type: 'store';
  id: string;
  name: string;
  root: string;
  members: SpaceMember[];
}

export type SpaceEntry = ProjectSpaceEntry | StoreSpaceEntry;

/** `GET /api/v1/spaces` response (design D6). */
export interface SpacesResponse {
  spaces: SpaceEntry[];
}

/** One worktree of a space's repository (worktree-aware-spaces D3) from `GET /api/v1/spaces/worktrees`. */
export interface SpaceWorktreeEntry {
  root: string;
  branch: string | null;
  isMain: boolean;
  activeChangeCount: number;
}

/** `GET /api/v1/spaces/worktrees` response (worktree-aware-spaces D3): empty for a non-git space root. */
export interface SpaceWorktreesResponse {
  worktrees: SpaceWorktreeEntry[];
}

// ---- Local-path browsing (local-path-browsing design D3) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root package
// (`GET /api/v1/local-paths`). Same hand-maintained-mirror discipline.

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
  /** The platform path separator. */
  separator: string;
  /** True only for the home start-point response (no `path` param supplied). */
  home?: boolean;
  entries: LocalPathEntry[];
}

// ---- Space creation (space-creation design D4) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root package
// (`POST /api/v1/spaces`). On failure the thrown `ApiError.message` is the
// CLI's own error text, verbatim.

/** `POST /api/v1/spaces` request body (design D4). */
export interface CreateSpaceRequest {
  kind: 'project' | 'store';
  /** An absolute filesystem path — the space's target directory. */
  path: string;
  /** Store id; required only for a fresh store (a directory with no `rasen/` root). */
  id?: string;
}

/** `POST /api/v1/spaces` success response (design D4): the operation performed plus the new space's listing entry. */
export interface CreateSpaceResponse {
  operation: 'init' | 'store-register' | 'store-setup';
  space: SpaceEntry;
}

// ---- Workflow library (workflow-http-api design D3/D4) ----
// Source of truth: `src/core/management-api/wire-types.ts` in the root package.
// Same hand-maintained-mirror discipline as the rest of this file: copied
// field-for-field, pinned by the `satisfies` fixtures in `test/fixtures`.

export type WorkflowSourceKind = 'built-in' | 'user';
export type WorkflowKind = 'task' | 'driver' | 'internal' | 'expert';

/** A validation/registry diagnostic (mirrors `WorkflowDiagnostic`). */
export interface WorkflowDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  sourcePath?: string;
  details?: Record<string, string | number | boolean | string[]>;
}

/** A known consumer of a workflow (mirrors `WorkflowUsage`). */
export interface WorkflowUsage {
  kind: 'global-selection' | 'profile' | 'dependency' | 'pipeline' | 'ledger';
  consumer: string;
  path?: string;
  hard: true;
}

/** The four dependency slots (mirrors `WorkflowDependencySet`). */
export interface WorkflowDependencySet {
  workflows: string[];
  skills: string[];
  pipelines: string[];
  schemas: string[];
}

/** One valid catalog unit from `GET /api/v1/workflows`. */
export interface WorkflowListEntry {
  id: string;
  source: WorkflowSourceKind;
  sourcePath: string | null;
  digest: string;
  kind: WorkflowKind;
  skillName: string;
  /** Author-declared display title from the manifest's `skill:` block; null when the workflow declares none. */
  title: string | null;
  unused: boolean;
}

/** One invalid user entry, reported rather than dropped. */
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

/** The full definition from `GET /api/v1/workflows/<id>` (mirrors `workflowDefinitionForJson`). */
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
  recommends: { workflows: string[] };
  files: { path: string; sha256: string }[];
}

/** `GET /api/v1/workflows/<id>` response. */
export interface WorkflowDetailResponse {
  workflow: WorkflowDefinitionWire;
  usage: WorkflowUsage[];
}

/** The validation verdict (mirrors `WorkflowValidationSummary`). */
export interface WorkflowValidationSummary {
  valid: boolean;
  kind: 'installed' | 'directory' | 'package';
  id?: string;
  packageKind?: string;
  diagnostics: WorkflowDiagnostic[];
}

/** `GET /api/v1/workflow-validation` response. */
export interface WorkflowValidationResponse {
  validation: WorkflowValidationSummary;
}

/** `POST /api/v1/workflows` request, discriminated by `op`. */
export type WorkflowMutationRequest =
  | { op: 'import'; path: string }
  | { op: 'init'; id: string; output: string }
  | { op: 'export'; id: string; path: string; force?: boolean }
  | { op: 'delete'; id: string; force?: boolean };

export interface WorkflowImportResponse {
  imported: string[];
  reused: string[];
  roots?: string[];
}
export interface WorkflowInitResponse {
  workflow: { id: string; output: string };
}
export interface WorkflowExportResponse {
  workflow: { id: string; path: string };
}
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

/** One selectable catalog unit's enablement state in an addressed space (space-workflow-enablement design D4). */
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

/** `GET /api/v1/workflow-enablement?root=<...>` response. */
export interface WorkflowEnablementResponse {
  /** Whether the addressed space follows the user-wide profile or its own selection override. */
  mode: 'profile' | 'override';
  units: WorkflowEnablementUnit[];
}

/** `POST /api/v1/workflow-enablement` request, discriminated by `op`. */
export type WorkflowEnablementMutationRequest =
  | { root: string; op: 'enable'; id: string }
  | { root: string; op: 'disable'; id: string }
  | { root: string; op: 'reset' };

// ---- Pipeline definition (pipeline-definition-api, pipeline-canvas-view) ----
// Mirrors `WirePipelineDefinition` / `PipelineDetailResponse` in the CLI's
// `src/core/management-api/wire-types.ts` (which types the definition as
// `PipelineYaml`, `z.infer<typeof PipelineYamlSchema>` in
// `src/core/pipeline-registry/types.ts`). Declared IN FULL — every
// loader-accepted field — per pipeline-canvas-view design D5, so child 4 (the
// canvas editor) adds no further mirror entries for the definition shape.
// Validation/catalog shapes are DELIBERATELY not mirrored here; child 4 is
// their first consumer.

export type PipelineAgentRuntime = 'claude' | 'codex';
export type PipelineAgentRuntimeSessionReuse = 'none' | 'stage' | 'run-planner' | 'review-thread';
export type PipelineAgentRuntimeSandbox = 'read-only' | 'workspace-write';

export interface PipelineAgentRuntimeConfig {
  runtime: PipelineAgentRuntime;
  sessionReuse?: PipelineAgentRuntimeSessionReuse;
  sandbox?: PipelineAgentRuntimeSandbox;
  model?: string;
  effort?: string;
}

export type PipelineAgentRuntimeConfigValue = PipelineAgentRuntime | PipelineAgentRuntimeConfig;

export interface PipelineAgentRuntimeOverrides {
  planner?: PipelineAgentRuntimeConfigValue;
  implementer?: PipelineAgentRuntimeConfigValue;
  reviewer?: PipelineAgentRuntimeConfigValue;
  fixer?: PipelineAgentRuntimeConfigValue;
  shipper?: PipelineAgentRuntimeConfigValue;
}

export interface PipelineHandoffRoles {
  planner?: ThresholdValue;
  implementer?: ThresholdValue;
  reviewer?: ThresholdValue;
  fixer?: ThresholdValue;
  shipper?: ThresholdValue;
}

export interface PipelineHandoffConfig {
  threshold?: ThresholdValue;
  roles?: PipelineHandoffRoles;
  maxRelays?: number;
  stallLimit?: number;
}

/** Per-stage handoff overrides — same shape as `PipelineHandoffConfig` minus `roles` (pipeline-level only). */
export type PipelineStageHandoffConfig = Omit<PipelineHandoffConfig, 'roles'>;

export type PipelineReuseMode = 'auto' | 'never';

export interface PipelineReuseRoles {
  planner?: ThresholdValue;
  implementer?: ThresholdValue;
}

export interface PipelineReuseConfig {
  planner?: PipelineReuseMode;
  implementer?: PipelineReuseMode;
  threshold?: ThresholdValue;
  roles?: PipelineReuseRoles;
}

/** `loop.kind: 'review-cycle'` — the bounded review/fix loop. */
export interface PipelineStageLoopReviewCycle {
  kind: 'review-cycle';
  maxRounds: number;
}

export type PipelineGoalGate =
  | {
      kind: 'measure';
      command?: string;
      threshold?: number;
      target?: number;
      direction: 'gte' | 'lte';
      timeoutSec: number;
    }
  | {
      kind: 'evaluate';
      goal?: string;
      rubric?: string;
    };

/** `loop.kind: 'goal'` — the goal-driven iterate/judge loop. */
export interface PipelineStageLoopGoal {
  kind: 'goal';
  gate: PipelineGoalGate;
  maxRounds: number;
  loopStallLimit: number;
  runArtifact: string;
}

export type PipelineStageLoop = PipelineStageLoopReviewCycle | PipelineStageLoopGoal;

export type PipelineStageKind = 'standard' | 'decompose';
export type PipelineVerifyPolicy = 'adaptive' | 'standard' | 'light';

/**
 * A single stage in a pipeline definition (mirrors `Stage` /
 * `WirePipelineDefinitionStage`) — every loader-accepted field. `requires` and
 * `parallelGroup` exist ONLY here (the resolved `WirePipelineStage` above
 * carries neither); the canvas draws its edges and groups from this shape.
 */
export interface WirePipelineDefinitionStage {
  id: string;
  kind: PipelineStageKind;
  skill?: string;
  childPipeline?: string;
  role?: 'planner' | 'implementer' | 'reviewer' | 'fixer' | 'shipper';
  requires: string[];
  gate: boolean;
  loop?: PipelineStageLoop;
  parallelGroup?: string;
  condition?: string;
  leadReview: boolean;
  verifyPolicy?: PipelineVerifyPolicy;
  runtime?: PipelineAgentRuntime;
  sessionReuse?: PipelineAgentRuntimeSessionReuse;
  sandbox?: PipelineAgentRuntimeSandbox;
  model?: string;
  effort?: string;
  handoff?: PipelineStageHandoffConfig;
}

/**
 * A pipeline's full declared definition (mirrors `WirePipelineDefinition` =
 * `PipelineYaml`) — the JSON projection of the loader's own accepted schema.
 * Round-tripping this value through a future `save` and back through `detail`
 * (child 4) is meant to be lossless.
 */
export interface WirePipelineDefinition {
  name: string;
  description?: string;
  agents?: PipelineAgentRuntimeOverrides;
  handoff?: PipelineHandoffConfig;
  reuse?: PipelineReuseConfig;
  /** Marks a machine-assembled pipeline: `'composed'` (autopilot LEAD) or `'ui'` (this canvas' future editor). Absent = human-authored. */
  origin?: 'composed' | 'ui';
  stages: WirePipelineDefinitionStage[];
}

/** `GET /api/v1/pipelines/<name>` response (pipeline-definition-api). */
export interface PipelineDetailResponse {
  pipeline: WirePipeline;
  definition: WirePipelineDefinition;
  /** `false` for built-in (package-provenance) pipelines, returned read-only as save-as templates. */
  editable: boolean;
}

// ---- Draft validation + catalog (pipeline-definition-api; pipeline-canvas-edit
// is their first UI consumer, per that change's design D9) ----

/** `POST /api/v1/pipeline-validation` request body. */
export interface PipelineValidationRequest {
  definition: unknown;
  space?: string;
}

/** One issue reported by draft validation — `severity: 'error'` makes the draft invalid; `'warning'` does not. */
export interface PipelineValidationIssue {
  severity: 'error' | 'warning';
  /** A JSON-pointer-ish locator into the definition, e.g. `/stages/2/skill`. */
  path: string;
  message: string;
}

/** `POST /api/v1/pipeline-validation` response — 200 for both a valid and an invalid draft. */
export interface PipelineValidationResponse {
  valid: boolean;
  issues: PipelineValidationIssue[];
}

/** One skill in the pipeline-catalog vocabulary. */
export interface PipelineCatalogSkill {
  id: string;
  description: string;
  /** Whether the skill is enabled in the active profile selection (a disabled skill is still listed, greyed out in the palette). */
  enabled: boolean;
}

/** `GET /api/v1/pipeline-catalog` response: the assembly vocabulary for the pipeline canvas. */
export interface PipelineCatalogResponse {
  roles: string[];
  skills: PipelineCatalogSkill[];
  runtimes: string[];
  stageKinds: string[];
  loopKinds: string[];
  verifyPolicies: string[];
  /** Conventional freeform condition labels, offered as suggestions — the `condition` field itself stays freeform. */
  conditionLabels: string[];
  gate: { default: boolean };
  handoff: { fractionRange: [number, number]; remainingTokensGt: number };
}
