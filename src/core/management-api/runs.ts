/**
 * `GET /api/v1/runs` handler (design.md D5 of `rasen-ui-slice1-readonly-api`).
 * Per active change, resolves the machine home read-only (`ensure: false` —
 * never mints identity or creates directories) and reads `auto-run.json`,
 * `portfolio-run.json`, and `goal-run.json` from their resolved locations
 * along the `file-placement` sticky-legacy chain (the execution root's
 * ephemera directory first, then the machine-home work directory, then the
 * change directory as the oldest legacy fallback). Every file is
 * reported as `ok` / `invalid` / `absent`; a failure while handling one
 * change degrades to an `error` entry for that change, never a whole-response
 * failure.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ProjectHome } from '../project-home.js';
import { getActiveChangeIds } from '../../utils/item-discovery.js';
import {
  readRunStateDetailed,
  resolveRunStateLocation,
  stateFileSearchChain,
  type StateFileLocationOptions,
} from '../pipeline-registry/run-state.js';
import {
  readPortfolioStateDetailed,
  resolvePortfolioStateLocation,
} from '../pipeline-registry/portfolio-state.js';
import type { RunState } from '../pipeline-registry/run-state.js';
import type { PortfolioState } from '../pipeline-registry/portfolio-state.js';
import type { ChangeRunEntry, GoalRunRaw, RunFileResult, RunsResponse } from './wire-types.js';
import {
  changeStateLocations,
  resolveActiveChangeDir,
  resolveExecutionHome,
  resolveProjectContentSpace,
  type ProjectSpaceInput,
} from './project-space.js';

export type RunsResult =
  | { ok: true; response: RunsResponse }
  | { ok: false; status: number; code: string; message: string };

/** No typed reader module exists for this file (design D5); read as opaque raw JSON. */
const GOAL_RUN_STATE_FILENAME = 'goal-run.json';

/**
 * Locate the portfolio record, then read it through the shared detailed
 * reader. The `ok | invalid | absent` read used to be duplicated here; it now
 * lives once in `portfolio-state.ts` so every surface that needs to tell
 * "unreadable" from "never split" gets the same answer.
 */
function readPortfolioDetailed(
  changeDir: string,
  locations: StateFileLocationOptions
): RunFileResult<PortfolioState> {
  const location = resolvePortfolioStateLocation(changeDir, locations);
  if (!location) return { kind: 'absent' };
  return readPortfolioStateDetailed(location.dir);
}

/**
 * Walks the same sticky-legacy chain as `resolveRunStateLocation` (stated
 * once in `stateFileSearchChain`). Exported so the changes handler can fold
 * goal-run presence into `hasRunFiles` without duplicating the resolution.
 */
export function resolveGoalRunPath(
  changeDir: string,
  locations: StateFileLocationOptions
): string | null {
  for (const dir of stateFileSearchChain(changeDir, locations)) {
    const candidate = path.join(dir, GOAL_RUN_STATE_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readGoalRunDetailed(
  changeDir: string,
  locations: StateFileLocationOptions
): RunFileResult<GoalRunRaw> {
  const filePath = resolveGoalRunPath(changeDir, locations);
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
 * @param home Pre-resolved project home (design D5/m4). Pass `undefined` to
 * have this handler resolve it itself (read-only, `ensure: false`) — the
 * server-driven path always passes its cached resolution instead, so a
 * board load resolves the home once, not once per endpoint.
 */
export function handleRuns(root: string, home?: ProjectHome | null): Promise<RunsResponse>;
export function handleRuns(input: Exclude<ProjectSpaceInput, string>, home?: ProjectHome | null): Promise<RunsResult>;
export async function handleRuns(
  input: ProjectSpaceInput,
  home?: ProjectHome | null
): Promise<RunsResponse | RunsResult> {
  const resolved = resolveProjectContentSpace(input);
  if (!resolved.ok) return resolved;
  const space = resolved.space;
  const changeIds = await getActiveChangeIds(space.planningCheckoutRoot, space.changesDir);
  const resolvedHome = await resolveExecutionHome(space, home);

  const runs: ChangeRunEntry[] = [];
  for (const name of changeIds) {
    try {
      runs.push(buildChangeRunEntry(
        name,
        await resolveActiveChangeDir(space, name),
        changeStateLocations(space, resolvedHome, name)
      ));
    } catch (error) {
      runs.push({
        name,
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const response = { runs };
  return typeof input === 'string' ? response : { ok: true, response };
}

/**
 * Builds one change's run-state entry (the same per-change read `handleRuns`
 * performs), exposed standalone so the sessions listing (session-supervision
 * design D4) can join a single targeted change's run-state without
 * re-enumerating every active change via `getActiveChangeIds`.
 */
export function buildChangeRunEntry(
  name: string,
  changeDir: string,
  locations: StateFileLocationOptions
): ChangeRunEntry {
  try {
    const autoLocation = resolveRunStateLocation(changeDir, locations);
    const autoRun: RunFileResult<RunState> = autoLocation
      ? readRunStateDetailed(autoLocation.dir)
      : { kind: 'absent' };

    const portfolio = readPortfolioDetailed(changeDir, locations);
    const goalRun = readGoalRunDetailed(changeDir, locations);

    return { name, kind: 'ok', autoRun, portfolio, goalRun };
  } catch (err) {
    return { name, kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
