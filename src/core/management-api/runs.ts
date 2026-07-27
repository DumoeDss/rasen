/**
 * `GET /api/v1/runs` and `GET /api/v1/runs/<changeId>/<runId>` handlers
 * (design.md §13 of `ecp-run-spine`).
 *
 * The list handler resolves the machine home read-only (`ensure: false` —
 * never mints identity or creates directories) and reads `auto-run.json`,
 * `portfolio-run.json`, and `goal-run.json` from their resolved locations
 * (work directory first, change directory as legacy fallback). Every file is
 * reported as `ok` / `invalid` / `absent`; a failure while handling one
 * change degrades to an `error` entry for that change, never a whole-response
 * failure.
 *
 * Reconciler-engine Run summaries (tasks 13.2–13.6) are derived from the
 * canonical machine-home Run store through the shared Change-run projector,
 * filtered to the WorkspaceInstanceId of the selected project root,
 * stable-sorted, and cursor-paginated within fixed candidate/byte/work
 * budgets. A Run whose source Change was archived/moved/deleted remains listed
 * with `sourceState: "archived" | "missing"`. Discovery creates no writable
 * index or second truth. Reads never mint a registry/project identity.
 *
 * The detail handler performs a read-only `inspect` (`ensure: false`) through
 * the same shared projector and never mints identity. A Run from a different
 * worktree is projected read-only with `workspace.scope: "other"` and no
 * controls.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { resolveProjectHome, type ProjectHome } from '../project-home.js';
import { getActiveChangeIds } from '../../utils/item-discovery.js';
import { readRunStateDetailed, resolveRunStateLocation } from '../pipeline-registry/run-state.js';
import {
  parsePortfolioState,
  resolvePortfolioStateLocation,
} from '../pipeline-registry/portfolio-state.js';
import type { RunState } from '../pipeline-registry/run-state.js';
import type { PortfolioState } from '../pipeline-registry/portfolio-state.js';
import type {
  ChangeRunEntry,
  GoalRunRaw,
  ReconcilerRunSummary,
  RunFileResult,
  RunsResponse,
} from './wire-types.js';

// Reconciler-engine imports — reaching into internal modules exactly like
// `src/commands/pipeline.ts` does (the identity derivation chain is the same
// read-only path: statSync + pure SHA-256 hashes, zero writes).
import {
  derivePlanningSpaceId,
  deriveWorkspaceInstanceId,
  readPhysicalIdentity,
} from '../change-run/internal/identity.js';
import { projectRunView } from '../change-run/internal/projector.js';
import { decodeCanonicalRunRecord, type CanonicalRunRecord } from '../change-run/internal/record.js';
import type {
  ChangeRunView,
  RootDagViewSection,
} from '../change-run/contracts.js';

/** No typed reader module exists for this file (design D5); read as opaque raw JSON. */
const GOAL_RUN_STATE_FILENAME = 'goal-run.json';

// ---------------------------------------------------------------------------
// Pagination budgets (task 9.7 spec: 100-summary / 512-candidate / 256-MiB page).
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_CANDIDATES = 512;

/** Cursor payload — opaque to the client, stable across requests. */
interface CursorPayload {
  /** Exclusive lower bound: only Runs whose runId sorts strictly after this are returned. */
  afterRunId: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'afterRunId' in parsed &&
      typeof (parsed as { afterRunId: unknown }).afterRunId === 'string'
    ) {
      return { afterRunId: (parsed as { afterRunId: string }).afterRunId };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Workspace identity derivation (read-only, mirrors pipeline.ts exactly).
// ---------------------------------------------------------------------------

/**
 * Derives the WorkspaceInstanceId for a project root using the same chain as
 * the CLI `pipeline start/status` command: `projectRoot → sha256 → planningSpaceHome
 * → derivePlanningSpaceId → statSync → readPhysicalIdentity → deriveWorkspaceInstanceId`.
 * All steps are read-only (stat + pure hashes); no writes, no identity minting.
 * Returns `null` when the root does not exist or cannot be stat'd.
 */
function deriveWorkspaceIdFromRoot(root: string): string | null {
  try {
    const planningSpaceHome = `project-${createHash('sha256')
      .update(root)
      .digest('hex')
      .slice(0, 12)}`;
    const planningSpaceId = derivePlanningSpaceId(planningSpaceHome);
    const st = fs.statSync(root, { bigint: true });
    const physical = readPhysicalIdentity({
      device: st.dev,
      ino: st.ino,
      birthtimeMs: st.birthtimeMs,
    });
    return deriveWorkspaceInstanceId(planningSpaceId, physical) as string;
  } catch {
    return null;
  }
}

/**
 * Derives the PlanningSpaceId for a project root using the same `project-<sha256>.slice(0,12)`
 * home derivation as the CLI. Returns `null` only if the hash fails (effectively never).
 */
function derivePlanningSpaceIdFromRoot(root: string): string | null {
  try {
    const planningSpaceHome = `project-${createHash('sha256')
      .update(root)
      .digest('hex')
      .slice(0, 12)}`;
    return derivePlanningSpaceId(planningSpaceHome) as string;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source-state determination.
// ---------------------------------------------------------------------------

/**
 * Determines the source-state of a Run's Change directory relative to the
 * selected project root. "active" when the change directory still exists in
 * `rasen/changes/<changeId>/`; "archived" when the project home has an archive
 * entry for it; "missing" otherwise.
 */
function resolveSourceState(
  changeId: string,
  root: string | undefined,
  home: ProjectHome | null
): 'active' | 'archived' | 'missing' {
  if (root) {
    const changeDir = path.join(root, WORKSPACE_DIR_NAME, 'changes', changeId);
    if (fs.existsSync(changeDir)) return 'active';
  }
  if (home) {
    const archiveDir = home.archiveDir;
    if (fs.existsSync(archiveDir)) {
      try {
        for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
          // Archived change directories are named `YYYY-MM-DD-<changeId>`.
          if (entry.isDirectory() && entry.name.endsWith(`-${changeId}`)) {
            return 'archived';
          }
        }
      } catch {
        // unreadable archive dir — fall through to missing
      }
    }
  }
  return 'missing';
}

// ---------------------------------------------------------------------------
// Reconciler Run discovery, projection, filtering, and pagination.
// ---------------------------------------------------------------------------

/** Internal candidate discovered from the store directory before projection. */
interface RunCandidate {
  /** Filesystem directory name inside `<globalDataDir>/runs`. */
  dirName: string;
  /** Absolute path to the Run directory. */
  dirPath: string;
}

interface ProjectedRun {
  runId: string;
  record: CanonicalRunRecord;
  view: ChangeRunView;
}

/**
 * Enumerates Run directories under the store root (bounded by MAX_CANDIDATES).
 * Does not decode Records — just lists directories that look like Run homes.
 */
function enumerateRunCandidates(storeRoot: string): RunCandidate[] {
  if (!fs.existsSync(storeRoot)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(storeRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: RunCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    candidates.push({ dirName: entry.name, dirPath: path.join(storeRoot, entry.name) });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

/**
 * Finds the head record-v<N>.json file in a Run directory. Returns the full
 * path and version number, or null when no record file exists.
 */
function findHeadRecord(dirPath: string): { file: string; version: number } | null {
  let files: string[];
  try {
    files = fs.readdirSync(dirPath);
  } catch {
    return null;
  }
  let bestVersion = -1;
  for (const file of files) {
    const match = /^record-v(\d+)\.json$/.exec(file);
    if (match) {
      const version = Number.parseInt(match[1]!, 10);
      if (version > bestVersion) bestVersion = version;
    }
  }
  if (bestVersion === -1) return null;
  return { file: path.join(dirPath, `record-v${bestVersion}.json`), version: bestVersion };
}

/**
 * Attempts to read, parse, and decode the head Record from a Run directory.
 * Returns either a projected Run or a per-entry error. Never throws — a
 * corrupt/oversized/gapped Record is isolated as `{ error }`.
 */
function tryProjectRun(dirPath: string): { ok: true; run: ProjectedRun } | { ok: false; error: { code: string; message: string }; dirName: string } {
  const dirName = path.basename(dirPath);
  const head = findHeadRecord(dirPath);
  if (head === null) {
    return { ok: false, dirName, error: { code: 'run_not_found', message: `No record file found in Run directory ${dirName}.` } };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(head.file, 'utf-8');
  } catch (err) {
    return { ok: false, dirName, error: { code: 'run_store_unavailable', message: err instanceof Error ? err.message : String(err) } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, dirName, error: { code: 'run_store_corrupt', message: `Record JSON parse failed: ${err instanceof Error ? err.message : String(err)}` } };
  }
  // Decode through the canonical codec — enforces full-chain integrity, no
  // earlier-revision fallback, budget limits, and invariant checks.
  let record: CanonicalRunRecord;
  try {
    record = decodeCanonicalRunRecord(parsed);
  } catch (err) {
    const code =
      err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'run_store_corrupt';
    return { ok: false, dirName, error: { code, message: err instanceof Error ? err.message : String(err) } };
  }
  let view: ChangeRunView;
  try {
    view = projectRunView(record);
  } catch (err) {
    return { ok: false, dirName, error: { code: 'run_store_corrupt', message: `Projection failed: ${err instanceof Error ? err.message : String(err)}` } };
  }
  return { ok: true, run: { runId: record.runId as string, record, view } };
}

/**
 * Builds a reconciler Run summary from a projected Run, applying the
 * source-state determination and the workspace/planning-space filter.
 */
function buildSummary(
  run: ProjectedRun,
  root: string | undefined,
  home: ProjectHome | null
): ReconcilerRunSummary {
  const sourceState = resolveSourceState(run.record.change.changeId, root, home);
  const rootSection = run.view.sections.find(
    (s): s is Extract<typeof s, { kind: 'root-dag' }> => s.kind === 'root-dag'
  );
  const isTerminal = run.record.terminal !== undefined;
  return {
    runId: run.runId,
    changeId: run.record.change.changeId,
    planningSpaceId: run.record.change.planningSpaceId as string,
    engine: 'reconciler',
    recordVersion: run.record.recordVersion,
    status: run.record.status,
    sourceState,
    ...(isTerminal
      ? { terminal: run.record.terminal }
      : { waits: rootSection?.waits.length ?? 0 }),
  };
}

/**
 * Options for the reconciler discovery inside `handleRuns`.
 */
export interface ReconcilerListOptions {
  /** Opaque cursor from a previous page. */
  cursor?: string;
  /** Page size (default 100, clamped to [1, 100]). */
  limit?: number;
  /**
   * Exact PlanningSpaceId override (from a `planning:<id>` selector). When set,
   * Runs are filtered by `change.planningSpaceId` match instead of by derived
   * WorkspaceInstanceId. No root is needed — legacy runs are empty and source
   * state defaults to "missing" since no change directory can be checked.
   */
  planningSpaceId?: string;
}

/**
 * Result of the reconciler list — either a page of summaries + pagination, or
 * an error envelope (store unavailable).
 */
interface ReconcilerListResult {
  summaries: ReconcilerRunSummary[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Discovers, projects, filters, and paginates reconciler-engine Runs from the
 * machine-home filesystem store (task 13.2/13.3/13.4). The store root is
 * `<globalDataDir>/runs`. Each Run is projected through the shared projector;
 * invalid/corrupt/oversized entries are reported as per-entry errors without
 * failing the whole list or hiding unrelated Runs. Default summaries are
 * filtered to the WorkspaceInstanceId of the selected project root.
 */
async function discoverReconcilerRuns(
  root: string | undefined,
  home: ProjectHome | null,
  options: ReconcilerListOptions = {}
): Promise<ReconcilerListResult> {
  let storeRoot: string;
  try {
    const { getGlobalDataDir } = await import('../global-config.js');
    storeRoot = path.join(getGlobalDataDir(), 'runs');
  } catch {
    return { summaries: [], hasMore: false };
  }

  const workspaceFilter = root ? deriveWorkspaceIdFromRoot(root) : null;
  const planningFilter = options.planningSpaceId ?? null;
  const candidates = enumerateRunCandidates(storeRoot);

  // Decode + project all candidates, collecting valid Runs and per-entry errors.
  const validRuns: ProjectedRun[] = [];
  const errorEntries: ReconcilerRunSummary[] = [];

  for (const candidate of candidates) {
    const result = tryProjectRun(candidate.dirPath);
    if (result.ok) {
      validRuns.push(result.run);
    } else {
      // An invalid Run is reported as a per-entry error — its directory name
      // serves as a fallback identifier since the runId itself may be
      // unreadable from a corrupt Record.
      errorEntries.push({
        runId: result.dirName,
        changeId: '',
        planningSpaceId: '',
        engine: 'reconciler',
        recordVersion: -1,
        status: 'unknown',
        sourceState: 'missing',
        error: result.error,
      });
    }
  }

  // Filter: when a planningSpaceId override is set (from `planning:<id>`
  // selector), filter by change.planningSpaceId match. Otherwise, filter by
  // the derived WorkspaceInstanceId (linked-worktree isolation). When neither
  // is derivable (no root, no override), all Runs are included.
  const filtered = planningFilter
    ? validRuns.filter((run) => (run.record.change.planningSpaceId as string) === planningFilter)
    : workspaceFilter
      ? validRuns.filter((run) => run.record.workspaceInstanceId === workspaceFilter)
      : validRuns;

  // Stable-sort by runId (deterministic ordering across requests).
  filtered.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));

  // Apply cursor: skip entries at or before the cursor's afterRunId.
  const cursorPayload = options.cursor ? decodeCursor(options.cursor) : null;
  const afterRunId = cursorPayload?.afterRunId;
  const paged = afterRunId
    ? filtered.filter((run) => run.runId > afterRunId)
    : filtered;

  // Clamp page size.
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, options.limit ?? DEFAULT_PAGE_SIZE));

  // Slice the page; error entries are always included (they are bounded by
  // MAX_CANDIDATES and small in number).
  const page = paged.slice(0, pageSize);
  const hasMore = paged.length > pageSize;
  const lastRunId = page.length > 0 ? page[page.length - 1]!.runId : undefined;
  const nextCursor = hasMore && lastRunId ? encodeCursor({ afterRunId: lastRunId }) : undefined;

  const summaries = page.map((run) => buildSummary(run, root, home));
  // Error entries come first (they represent Runs that need attention).
  return { summaries: [...errorEntries, ...summaries], nextCursor, hasMore };
}

// ---------------------------------------------------------------------------
// Detail handler (task 13.5/13.6).
// ---------------------------------------------------------------------------

/**
 * The read-only detail result — either the projected view or a typed error.
 */
export type RunDetailResult =
  | { ok: true; view: ChangeRunView }
  | { ok: false; status: number; code: string; message: string };

/**
 * Handles `GET /api/v1/runs/<changeId>/<runId>?space=...` (task 13.5/13.6).
 *
 * Performs a read-only `inspect` (`ensure: false`) of the exact Run through
 * the shared projector. Never mints a project identity, never creates a
 * directory, plan, Record, or lock file. A Run from a different worktree
 * (WorkspaceInstanceId mismatch) is projected read-only with
 * `workspace.scope: "other"` and no controls or granted Actions.
 */
export async function handleRunDetail(
  changeId: string,
  runId: string,
  root: string | undefined,
  home: ProjectHome | null
): Promise<RunDetailResult> {
  let storeRoot: string;
  try {
    const { getGlobalDataDir } = await import('../global-config.js');
    storeRoot = path.join(getGlobalDataDir(), 'runs');
  } catch {
    return { ok: false, status: 500, code: 'run_store_unavailable', message: 'Machine data directory is not available.' };
  }

  if (!fs.existsSync(storeRoot)) {
    return { ok: false, status: 404, code: 'run_not_found', message: `No Run with id ${runId}.` };
  }

  // The filesystem store sanitizes runId into a directory name by replacing
  // non-alphanumeric characters with `_`. Replicate that to locate the dir.
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const dirPath = path.join(storeRoot, dirName);

  const result = tryProjectRun(dirPath);
  if (!result.ok) {
    return { ok: false, status: 404, code: result.error.code, message: result.error.message };
  }

  const { record, view } = result.run;

  // Verify the path's changeId matches the Record's changeId (exact identity).
  if (record.change.changeId !== changeId) {
    return {
      ok: false,
      status: 404,
      code: 'run_not_found',
      message: `Run ${runId} does not belong to change ${changeId}.`,
    };
  }

  // Determine workspace scope: "current" when the Run's workspaceInstanceId
  // matches the selected root's derived workspace, "other" otherwise.
  const workspaceFilter = root ? deriveWorkspaceIdFromRoot(root) : null;
  const isOtherWorkspace =
    workspaceFilter !== null && record.workspaceInstanceId !== workspaceFilter;

  if (isOtherWorkspace) {
    // Read-only other-worktree projection: scope "other", no controls, no
    // granted Actions (change-run-view/1 invariant: other-worktree views
    // cannot expose controls or granted Actions).
    return { ok: true, view: withOtherWorkspaceScope(view) };
  }

  // Current-workspace projection: the view is deeply equal to what CLI status
  // would emit via facade.inspect → projectRunView(record).
  return { ok: true, view };
}

/**
 * Type guard: narrows a `ChangeRunViewSection` to `RootDagViewSection`. The
 * section union (`RootDagViewSection | Readonly<Record<string, unknown>>`)
 * is not a proper discriminated union because the Record member has
 * `kind: unknown`, so a plain `section.kind === 'root-dag'` check does not
 * narrow. This guard uses an explicit type predicate instead.
 */
function isRootDagSection(
  section: ChangeRunView['sections'][number]
): section is RootDagViewSection {
  return section.kind === 'root-dag';
}

/**
 * Post-processes a projected view for the "other workspace" read-only case:
 * sets `workspace.scope` to `"other"`, clears `allowedControls`, and
 * downgrades any `granted` delivery states to `admitted_undelivered`. The
 * canonical change-run-view/1 invariant forbids controls or granted Actions
 * in an other-worktree view.
 */
function withOtherWorkspaceScope(view: ChangeRunView): ChangeRunView {
  const sections = view.sections.map((section) => {
    if (!isRootDagSection(section)) return section;
    return {
      ...section,
      allowedControls: [] as never[],
      actions: section.actions.map((action) =>
        action.deliveryState === 'granted'
          ? { ...action, deliveryState: 'admitted_undelivered' as const }
          : action
      ),
    };
  });
  return {
    ...view,
    workspace: { ...view.workspace, scope: 'other' as const },
    sections,
  };
}

// ---------------------------------------------------------------------------
// Legacy run-state handlers (unchanged from the original D5 implementation).
// ---------------------------------------------------------------------------

function readPortfolioDetailed(
  changeDir: string,
  workDir: string | null
): RunFileResult<PortfolioState> {
  const location = resolvePortfolioStateLocation(changeDir, workDir);
  if (!location) return { kind: 'absent' };
  try {
    return { kind: 'ok', state: parsePortfolioState(fs.readFileSync(location.path, 'utf-8')) };
  } catch (err) {
    return { kind: 'invalid', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Mirrors `resolveRunStateLocation`'s workDir-first / changeDir-legacy-
 * fallback resolution. Exported so the changes handler can fold goal-run
 * presence into `hasRunFiles` without duplicating the resolution logic.
 */
export function resolveGoalRunPath(changeDir: string, workDir: string | null): string | null {
  if (workDir) {
    const workPath = path.join(workDir, GOAL_RUN_STATE_FILENAME);
    if (fs.existsSync(workPath)) return workPath;
  }
  const legacyPath = path.join(changeDir, GOAL_RUN_STATE_FILENAME);
  return fs.existsSync(legacyPath) ? legacyPath : null;
}

function readGoalRunDetailed(changeDir: string, workDir: string | null): RunFileResult<GoalRunRaw> {
  const filePath = resolveGoalRunPath(changeDir, workDir);
  if (!filePath) return { kind: 'absent' };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return { kind: 'ok', state: { raw } };
  } catch (err) {
    return { kind: 'invalid', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Reports run state for every active change in `root`. Never throws for a
 * single change's failure — that change degrades to a `kind: 'error'` entry
 * so the rest of the listing still answers.
 *
 * Reconciler-engine Run summaries are additive (task 13.2): projected from
 * the machine-home store through the shared Change-run projector, filtered to
 * the selected workspace, and cursor-paginated.
 *
 * @param home Pre-resolved project home (design D5/m4). Pass `undefined` to
 * have this handler resolve it itself (read-only, `ensure: false`) — the
 * server-driven path always passes its cached resolution instead, so a
 * board load resolves the home once, not once per endpoint.
 * @param options Pagination options for the reconciler list.
 */
export async function handleRuns(
  root: string,
  home?: ProjectHome | null,
  options?: ReconcilerListOptions
): Promise<RunsResponse> {
  const changesDir = path.join(root, WORKSPACE_DIR_NAME, 'changes');
  const changeIds = await getActiveChangeIds(root);

  let resolvedHome: ProjectHome | null;
  if (home !== undefined) {
    resolvedHome = home;
  } else {
    // Resolved once for the whole project — `ensure: false` is documented
    // non-mutating (design D5): a project with no identity/registry entry
    // yet simply resolves to null, and every change falls back to its
    // changeDir's legacy location.
    try {
      resolvedHome = await resolveProjectHome(root, { ensure: false });
    } catch {
      resolvedHome = null;
    }
  }

  const runs: ChangeRunEntry[] = changeIds.map((name) =>
    buildChangeRunEntry(name, path.join(changesDir, name), resolvedHome ? resolvedHome.workDir(name) : null)
  );

  // Discover reconciler-engine Runs from the immutable filesystem store
  // (task 13.2). These are additive to the legacy per-change runs, projected
  // through the shared projector, filtered to the selected workspace.
  let reconcilerResult: ReconcilerListResult = { summaries: [], hasMore: false };
  try {
    reconcilerResult = await discoverReconcilerRuns(root, resolvedHome, options);
  } catch {
    // The whole store being unavailable degrades to an empty reconciler list,
    // not a whole-response failure — legacy runs still answer.
  }

  return {
    runs,
    reconcilerRuns: reconcilerResult.summaries,
    ...(reconcilerResult.nextCursor ? { nextCursor: reconcilerResult.nextCursor } : {}),
    hasMore: reconcilerResult.hasMore,
  };
}

/**
 * Builds one change's run-state entry (the same per-change read `handleRuns`
 * performs), exposed standalone so the sessions listing (session-supervision
 * design D4) can join a single targeted change's run-state without
 * re-enumerating every active change via `getActiveChangeIds`.
 */
export function buildChangeRunEntry(name: string, changeDir: string, workDir: string | null): ChangeRunEntry {
  try {
    const autoLocation = resolveRunStateLocation(changeDir, workDir);
    const autoRun: RunFileResult<RunState> = autoLocation
      ? readRunStateDetailed(autoLocation.dir)
      : { kind: 'absent' };

    const portfolio = readPortfolioDetailed(changeDir, workDir);
    const goalRun = readGoalRunDetailed(changeDir, workDir);

    return { name, kind: 'ok', autoRun, portfolio, goalRun };
  } catch (err) {
    return { name, kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
