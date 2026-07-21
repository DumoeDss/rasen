/**
 * `GET /api/v1/changes` handler (design.md D4 of `rasen-ui-slice1-readonly-
 * api`). Enumerates via `getActiveChangeIds` and loads per-change status via
 * the same `loadChangeContext` + `formatChangeStatus` seam `rasen status`
 * uses, so the listing agrees with the CLI by construction. Task counts come
 * from `getTaskProgressForChange`, the same helper `rasen change list` calls.
 * Reports facts only — column derivation is UI-side (design D4/D8).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { getActiveChangeIds } from '../../utils/item-discovery.js';
import { getTaskProgressForChange } from '../../utils/task-progress.js';
import { loadChangeContext, formatChangeStatus } from '../artifact-graph/index.js';
import { resolveProjectHome, type ProjectHome } from '../project-home.js';
import { resolveRunStateLocation } from '../pipeline-registry/run-state.js';
import { resolvePortfolioStateLocation } from '../pipeline-registry/portfolio-state.js';
import { resolveGoalRunPath } from './runs.js';
import type { ChangeLoadError, ChangeSummary, ChangesResponse } from './wire-types.js';

export type ChangesResult =
  | { ok: true; response: ChangesResponse }
  | { ok: false; status: number; code: string; message: string };

/**
 * Whether every artifact the schema's `apply.requires` names is done —
 * the same "apply-ready" fact `rasen status`'s `isComplete`/`applyRequires`
 * pair encodes, folded into a single boolean for the board.
 */
function isApplyReady(applyRequires: string[], artifacts: { id: string; status: string }[]): boolean {
  return applyRequires.every((id) => artifacts.find((a) => a.id === id)?.status === 'done');
}

/**
 * The portfolio *containers* under `changesDir`: sibling change directories
 * that carry a `planning-context.md` (ui-space-redesign-task-board spec /
 * design D1). Read-only enumeration — no directory or identity is created.
 * Computed once per request and shared across every change, not re-scanned
 * per change. A container holding only `planning-context.md` (no `proposal.md`)
 * is itself absent from the active-change listing but names its children.
 */
export function findPortfolioContainers(changesDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(changesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const containers: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(changesDir, entry.name, 'planning-context.md'))) {
      containers.push(entry.name);
    }
  }
  return containers;
}

/**
 * The longest container `P` in `containers` such that `changeName === P` or
 * `changeName` starts with `P-` (design D1). Longest-prefix wins, so a nested
 * portfolio resolves deterministically and `ui-space-redesign-task-board`
 * groups under `ui-space-redesign`, not a shorter coincidental prefix.
 * Returns `undefined` when no container matches.
 */
export function portfolioOf(changeName: string, containers: string[]): string | undefined {
  let best: string | undefined;
  for (const container of containers) {
    if (changeName === container || changeName.startsWith(`${container}-`)) {
      if (best === undefined || container.length > best.length) best = container;
    }
  }
  return best;
}

/**
 * Builds one active change's `ChangeSummary` — the same facts `/changes`
 * reports (`loadChangeContext` + `formatChangeStatus` + `getTaskProgressForChange`
 * + the `hasRunFiles`/`portfolio` fields). Throws when the change's
 * schema/metadata cannot be loaded, exactly like the inline path once did, so
 * the caller degrades it to an error entry. Shared with the task-detail
 * handler so a Task's active children carry byte-identical facts to the board.
 */
export async function buildChangeSummary(
  root: string,
  changesDir: string,
  name: string,
  portfolioContainers: string[],
  home: ProjectHome | null
): Promise<ChangeSummary> {
  const changeDir = path.join(changesDir, name);
  const context = loadChangeContext(root, name);
  const status = formatChangeStatus(context);

  const taskProgress = await getTaskProgressForChange(changesDir, name, root);
  const workDir = home ? home.workDir(name) : null;
  const hasRunFiles =
    resolveRunStateLocation(changeDir, workDir) !== null ||
    resolvePortfolioStateLocation(changeDir, workDir) !== null ||
    resolveGoalRunPath(changeDir, workDir) !== null;

  const portfolio = portfolioOf(name, portfolioContainers);
  return {
    name,
    schemaName: status.schemaName,
    artifacts: status.artifacts.map((a) => ({ id: a.id, status: a.status })),
    applyReady: isApplyReady(status.applyRequires, status.artifacts),
    isComplete: status.isComplete,
    taskProgress,
    hasRunFiles,
    ...(portfolio !== undefined ? { portfolio } : {}),
  };
}

/**
 * @param home Pre-resolved project home (design D5/m4). Pass `undefined` to
 * have this handler resolve it itself (read-only, `ensure: false`) — the
 * server-driven path always passes its cached resolution instead, so a
 * board load resolves the home once, not once per endpoint.
 */
export async function handleChanges(
  root: string | undefined,
  home?: ProjectHome | null
): Promise<ChangesResult> {
  if (!root) {
    return {
      ok: false,
      status: 400,
      code: 'project_required',
      message: 'No Rasen project is available for this server; launch `rasen ui` inside a project.',
    };
  }

  const changesDir = path.join(root, WORKSPACE_DIR_NAME, 'changes');
  const changeIds = await getActiveChangeIds(root);
  const portfolioContainers = findPortfolioContainers(changesDir);

  let resolvedHome: ProjectHome | null;
  if (home !== undefined) {
    resolvedHome = home;
  } else {
    // Read-only probe (design D5's `ensure: false` contract, reused here for
    // `hasRunFiles`): never mints identity or creates directories.
    try {
      resolvedHome = await resolveProjectHome(root, { ensure: false });
    } catch {
      resolvedHome = null;
    }
  }

  const changes: ChangeSummary[] = [];
  const errors: ChangeLoadError[] = [];

  for (const name of changeIds) {
    try {
      changes.push(await buildChangeSummary(root, changesDir, name, portfolioContainers, resolvedHome));
    } catch (err) {
      // A change with a valid `proposal.md` (so `getActiveChangeIds` counts
      // it active) but an unresolvable schema or corrupt metadata must not
      // fail the whole listing — but silently dropping the row is worse
      // than degrading it: the user cannot tell "does not exist" from
      // "could not be read" (review round 1 M2). Mirrors `runs.ts`'s
      // per-change `{ kind: 'error' }` degradation.
      errors.push({ name, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { ok: true, response: { changes, errors } };
}
