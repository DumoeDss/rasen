/**
 * Wire (HTTP JSON) shapes for the read-only management API (design.md D4/D5
 * of `rasen-ui-slice1-readonly-api`). `ApiErrorBody` here is the canonical
 * unified envelope (unify-pipeline-http-api design D6): `config-api/wire-types.ts`
 * re-exports it rather than declaring its own — one shape, one definition.
 */
import type { RunState, StageStatus } from '../pipeline-registry/run-state.js';
import type { PortfolioState } from '../pipeline-registry/portfolio-state.js';
import type { PipelineYaml, ThresholdValue } from '../pipeline-registry/index.js';
import type {
  WorkflowDependencySet,
  WorkflowDiagnostic,
  WorkflowRecommendations,
  WorkflowSourceKind,
} from '../workflow-registry/index.js';
import type { WorkflowKind } from '../workflow-registry/types.js';
import type { WorkflowUsage, WorkflowValidationSummary } from '../workflow-library.js';

/** A registered project, or the server's launch project. Mirrors config-api's `ProjectRef`. */
export interface ProjectRef {
  projectId: string;
  name: string;
  root: string;
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
export type WirePipelineDefinition = PipelineYaml;

/** `GET /api/v1/pipelines/<name>` response (pipeline-definition-api). */
export interface PipelineDetailResponse {
  pipeline: WirePipeline;
  definition: WirePipelineDefinition;
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
  root: string;
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
  portfolioStatus?: StageStatus;
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

// -----------------------------------------------------------------------
// Space creation (space-creation design D4/D5) — `POST /api/v1/spaces`.
// The server never writes workspace files: it spawns the CLI (init / store
// register / store setup), passing the CLI's own errors through verbatim.
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Sessions (session-supervision design D2/D4) — sibling-stable wire shapes
// for the sessions UI child.
// -----------------------------------------------------------------------

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

/** `POST /api/v1/sessions` request body (design D1/D4). */
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
  root: string;
}

/** An in-repo project space (design D6): a live machine-project-registry entry with `mode: 'in-repo'`. */
export interface ProjectSpaceEntry {
  type: 'project';
  id: string;
  name: string;
  root: string;
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
  root: string;
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
  root: string;
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
  /** Whether the addressed space follows the user-wide profile or its own selection override. */
  mode: 'profile' | 'override';
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
  | { root: string; op: 'reset' };
