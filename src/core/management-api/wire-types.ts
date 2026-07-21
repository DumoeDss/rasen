/**
 * Wire (HTTP JSON) shapes for the read-only management API (design.md D4/D5
 * of `rasen-ui-slice1-readonly-api`). Sibling of `config-api/wire-types.ts`;
 * shares its `ApiErrorBody` envelope shape (re-declared here rather than
 * imported — the two route groups stay independently deployable) but adds
 * nothing config-api does not already own.
 */
import type { RunState, StageStatus } from '../pipeline-registry/run-state.js';
import type { PortfolioState } from '../pipeline-registry/portfolio-state.js';

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
