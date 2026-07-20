/**
 * `GET /api/v1/runs` handler (design.md D5 of `rasen-ui-slice1-readonly-api`).
 * Per active change, resolves the machine home read-only (`ensure: false` —
 * never mints identity or creates directories) and reads `auto-run.json`,
 * `portfolio-run.json`, and `goal-run.json` from their resolved locations
 * (work directory first, change directory as legacy fallback). Every file is
 * reported as `ok` / `invalid` / `absent`; a failure while handling one
 * change degrades to an `error` entry for that change, never a whole-response
 * failure.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

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
import type { ChangeRunEntry, GoalRunRaw, RunFileResult, RunsResponse } from './wire-types.js';

/** No typed reader module exists for this file (design D5); read as opaque raw JSON. */
const GOAL_RUN_STATE_FILENAME = 'goal-run.json';

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
 */
export async function handleRuns(root: string): Promise<RunsResponse> {
  const changesDir = path.join(root, WORKSPACE_DIR_NAME, 'changes');
  const changeIds = await getActiveChangeIds(root);

  // Resolved once for the whole project — `ensure: false` is documented
  // non-mutating (design D5): a project with no identity/registry entry
  // yet simply resolves to null, and every change falls back to its
  // changeDir's legacy location.
  let home: ProjectHome | null = null;
  try {
    home = await resolveProjectHome(root, { ensure: false });
  } catch {
    home = null;
  }

  const runs: ChangeRunEntry[] = changeIds.map((name) => {
    try {
      const changeDir = path.join(changesDir, name);
      const workDir = home ? home.workDir(name) : null;

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
  });

  return { runs };
}
