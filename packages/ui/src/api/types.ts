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

export type ConfigScope = 'global' | 'project';
export type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum' | 'array' | 'threshold';
export type ConfigSource = 'default' | 'global' | 'project' | 'env-override';

/** A registered project, or the server's launch project. */
export interface ProjectRef {
  projectId: string;
  name: string;
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
  scopeValues: { global?: unknown; project?: unknown };
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
  entries: WireConfigEntry[];
}

export interface GetConfigKeyResponse {
  entry: WireConfigEntry;
}

/** PUT and DELETE both respond with the re-resolved entry. */
export type WriteConfigKeyResponse = GetConfigKeyResponse;

/**
 * A trimmed projection of a pipeline stage for the read-only gates inventory
 * (design.md D5/D6 of `config-page-coherence`). `gate: 'vet'` marks a stage
 * that ALWAYS pauses, distinct from an ordinary `gate: true`.
 */
export interface WirePipelineStage {
  id: string;
  role: string | null;
  skill: string | null;
  gate: false | true | 'vet';
}

/** A pipeline's identity plus its stage list, for `GET /api/v1/pipelines`. */
export interface WirePipeline {
  name: string;
  description: string;
  stages: WirePipelineStage[];
}

export interface ListPipelinesResponse {
  pipelines: WirePipeline[];
}

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
