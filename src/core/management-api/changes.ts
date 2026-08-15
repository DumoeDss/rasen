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

import { getActiveChangeIds } from '../../utils/item-discovery.js';
import { getTaskProgressForChange } from '../../utils/task-progress.js';
import { loadChangeContext, formatChangeStatus } from '../artifact-graph/index.js';
import type { ProjectHome } from '../project-home.js';
import { resolveRunStateLocation } from '../pipeline-registry/run-state.js';
import { resolvePortfolioStateLocation } from '../pipeline-registry/portfolio-state.js';
import { resolveGoalRunPath } from './runs.js';
import type { ChangeLoadError, ChangeSummary, ChangesResponse } from './wire-types.js';
import {
  changeStateLocations,
  resolveActiveChangeDir,
  resolveExecutionHome,
  resolveProjectContentSpace,
  type ProjectContentSpace,
  type ProjectSpaceInput,
} from './project-space.js';

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
  space: ProjectContentSpace,
  name: string,
  portfolioContainers: string[],
  home: ProjectHome | null
): Promise<ChangeSummary> {
  const changeDir = await resolveActiveChangeDir(space, name);
  const context = loadChangeContext(space.planningCheckoutRoot, name, undefined, {
    changeDir,
    projectSchemasDir: space.schemasDir,
  });
  // `nextWorkflows` is never read by `ChangeSummary` below (review round 1
  // m1) — skip its two uncached fs reads (`getGlobalConfig`,
  // `loadWorkflowCatalog`) per change in this per-request board loop.
  const status = formatChangeStatus(context, { computeNextWorkflows: false });

  const taskProgress = await getTaskProgressForChange(
    space.changesDir,
    name,
    space.planningCheckoutRoot,
    space.schemasDir
  );
  // Sticky-legacy chain (`file-placement`): the execution root's ephemera
  // directory first — `root` IS the execution root for a server-driven read —
  // then the legacy machine-home work directory, then the change directory.
  const locations = changeStateLocations(space, home, name);
  const hasRunFiles =
    resolveRunStateLocation(changeDir, locations) !== null ||
    resolvePortfolioStateLocation(changeDir, locations) !== null ||
    resolveGoalRunPath(changeDir, locations) !== null;

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
  input: ProjectSpaceInput,
  home?: ProjectHome | null
): Promise<ChangesResult> {
  const resolved = resolveProjectContentSpace(input);
  if (!resolved.ok) return resolved;
  const space = resolved.space;
  const changeIds = await getActiveChangeIds(space.planningCheckoutRoot, space.changesDir);
  const portfolioContainers = findPortfolioContainers(space.changesDir);
  const resolvedHome = await resolveExecutionHome(space, home);

  const changes: ChangeSummary[] = [];
  const errors: ChangeLoadError[] = [];

  for (const name of changeIds) {
    try {
      changes.push(await buildChangeSummary(space, name, portfolioContainers, resolvedHome));
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
