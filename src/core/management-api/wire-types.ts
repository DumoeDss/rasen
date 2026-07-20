/**
 * Wire (HTTP JSON) shapes for the read-only management API (design.md D4/D5
 * of `rasen-ui-slice1-readonly-api`). Sibling of `config-api/wire-types.ts`;
 * shares its `ApiErrorBody` envelope shape (re-declared here rather than
 * imported — the two route groups stay independently deployable) but adds
 * nothing config-api does not already own.
 */
import type { RunState } from '../pipeline-registry/run-state.js';
import type { PortfolioState } from '../pipeline-registry/portfolio-state.js';

/** A registered project, or the server's launch project. Mirrors config-api's `ProjectRef`. */
export interface ProjectRef {
  projectId: string;
  name: string;
  root: string;
}

/** Uniform non-2xx error envelope, matching the config API's vocabulary. */
export interface ApiErrorBody {
  error: { code: string; message: string; fix?: string };
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
