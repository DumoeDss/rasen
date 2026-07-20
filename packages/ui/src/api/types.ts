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
}

export interface SubmitChangeResponse {
  change: {
    id: string;
    path: string;
    schema: string;
  };
}
