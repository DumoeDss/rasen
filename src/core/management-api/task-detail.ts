/**
 * `GET /api/v1/tasks/:id` handler (ui-space-redesign-task-detail design D1).
 * Assembles a Task's full roster — every constituent change, active AND
 * archived, plus portfolio dependency hints — which no existing endpoint can
 * do: a portfolio's parent container has no `proposal.md` (absent from
 * `/changes`), archived children have left `/changes` entirely, and the
 * dependency DAG lives only in the parent's `portfolio-run.json`. Reuses the
 * same discovery/loading helpers those endpoints use, mints nothing, and
 * writes nothing (the real-source red line, decision #10).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { validateChangeName } from '../../utils/change-utils.js';
import { getActiveChangeIds, getArchivedChangeIds } from '../../utils/item-discovery.js';
import {
  getTaskProgressForChange,
  listTaskItemsForChange,
} from '../../utils/task-progress.js';
import type { ProjectHome } from '../project-home.js';
import {
  readPortfolioState,
  resolvePortfolioStateLocation,
} from '../pipeline-registry/portfolio-state.js';
import { buildChangeSummary, findPortfolioContainers, portfolioOf } from './changes.js';
import { buildChangeRunEntry } from './runs.js';
import type {
  ChangeLoadError,
  TaskChildDetail,
  TaskDetailResponse,
} from './wire-types.js';

export type TaskDetailResult =
  | { ok: true; response: TaskDetailResponse }
  | { ok: false; status: number; code: string; message: string };

/** `YYYY-MM-DD-<name>` archived-change directory name (item-discovery.ts). */
const ARCHIVED_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

interface ArchivedRef {
  /** The dated directory name as `getArchivedChangeIds` returns it. */
  dated: string;
  /** The `YYYY-MM-DD` prefix. */
  date: string;
  /** The un-dated change name. */
  name: string;
}

function parseArchivedRef(dated: string): ArchivedRef | null {
  const match = ARCHIVED_NAME_PATTERN.exec(dated);
  if (!match) return null;
  return { dated, date: match[1]!, name: match[2]! };
}

/**
 * Assembles the full roster for one Task (design D1). Read-only: resolves kind
 * from `planning-context.md` presence, enumerates active + archived children,
 * loads each active child's facts via the same path `/changes` uses, and joins
 * the parent `portfolio-run.json` dependency hints when present.
 *
 * @param home Pre-resolved project home (read-only), or null when the space
 * has no machine identity yet — archived-home probing and run-state work-dir
 * resolution both degrade cleanly to the in-repo / legacy locations.
 */
export async function handleTaskDetail(
  root: string | undefined,
  home: ProjectHome | null,
  id: string
): Promise<TaskDetailResult> {
  if (!root) {
    return {
      ok: false,
      status: 400,
      code: 'project_required',
      message: 'No Rasen project is available for this server; launch `rasen ui` inside a project.',
    };
  }

  const nameCheck = validateChangeName(id);
  if (!nameCheck.valid) {
    return { ok: false, status: 400, code: 'invalid_input', message: nameCheck.error ?? 'Invalid task id.' };
  }

  const changesDir = path.join(root, WORKSPACE_DIR_NAME, 'changes');
  const archiveDir = path.join(changesDir, 'archive');
  const containers = findPortfolioContainers(changesDir);

  const activeIds = await getActiveChangeIds(root);
  const archivedRefs: ArchivedRef[] = [];
  for (const dated of await getArchivedChangeIds(root)) {
    const ref = parseArchivedRef(dated);
    if (ref) archivedRefs.push(ref);
  }

  // Kind resolution (design D1). A `planning-context.md` makes `id` a
  // portfolio — even when it ALSO carries a `proposal.md` (the self-
  // referencing edge): portfolio wins, and the self-named change appears as
  // one of its own children (it satisfies `portfolioOf(id) === id`).
  const isPortfolio = fs.existsSync(path.join(changesDir, id, 'planning-context.md'));
  let kind: 'portfolio' | 'single';
  if (isPortfolio) {
    kind = 'portfolio';
  } else if (activeIds.includes(id) || archivedRefs.some((r) => r.name === id)) {
    kind = 'single';
  } else {
    return { ok: false, status: 404, code: 'task_not_found', message: `No Task named '${id}' in this space.` };
  }

  // Membership test: a portfolio claims children by longest-prefix container
  // match; a single Task claims only the change that IS its id.
  const belongsToTask = (changeName: string): boolean =>
    kind === 'portfolio' ? portfolioOf(changeName, containers) === id : changeName === id;

  const children: TaskChildDetail[] = [];
  const errors: ChangeLoadError[] = [];

  // Active children first, in `getActiveChangeIds` order (design D7).
  for (const name of activeIds) {
    if (!belongsToTask(name)) continue;
    const changeDir = path.join(changesDir, name);
    const workDir = home ? home.workDir(name) : null;
    const run = buildChangeRunEntry(name, changeDir, workDir);
    try {
      const summary = await buildChangeSummary(root, changesDir, name, containers, home);
      const tasks = await listTaskItemsForChange(changesDir, name, root);
      children.push({
        name,
        archived: false,
        taskProgress: summary.taskProgress,
        tasks,
        summary,
        run,
        dependsOn: [],
      });
    } catch (err) {
      // An active child whose schema/metadata cannot load is degraded, not
      // dropped — it still renders (with `loadError`) and is reported in the
      // task-level `errors` envelope, mirroring `/changes`.
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ name, message });
      children.push({
        name,
        archived: false,
        taskProgress: await getTaskProgressForChange(changesDir, name, root),
        tasks: await listTaskItemsForChange(changesDir, name, root),
        summary: null,
        run,
        dependsOn: [],
        loadError: message,
      });
    }
  }

  // Archived children next. Each is done by definition (archived ⇒ shipped);
  // the UI never runs column derivation on it. Task progress/items are
  // best-effort: probe the in-repo archive dir, then the machine-home archive
  // (`getArchivedChangeIds` unions both without saying which holds each).
  for (const ref of archivedRefs) {
    if (!belongsToTask(ref.name)) continue;
    let archiveChangesDir = archiveDir;
    if (!fs.existsSync(path.join(archiveDir, ref.dated)) && home) {
      archiveChangesDir = home.archiveDir;
    }
    children.push({
      name: ref.name,
      archived: true,
      archivedAt: ref.date,
      taskProgress: await getTaskProgressForChange(archiveChangesDir, ref.dated, root),
      tasks: await listTaskItemsForChange(archiveChangesDir, ref.dated, root),
      summary: null,
      run: null,
      dependsOn: [],
    });
  }

  // Dependency DAG + portfolio status (design D1 step 4). Only a portfolio has
  // a `portfolio-run.json`; an absent file degrades to empty deps, no error.
  if (kind === 'portfolio') {
    const containerDir = path.join(changesDir, id);
    const location = resolvePortfolioStateLocation(containerDir, home ? home.workDir(id) : null);
    const state = location ? readPortfolioState(location.dir) : null;
    if (state) {
      const byId = new Map(state.children.map((c) => [c.id, c]));
      for (const child of children) {
        const record = byId.get(child.name);
        if (record) {
          child.dependsOn = record.dependsOn;
          child.portfolioStatus = record.status;
        }
      }
    }
  }

  return { ok: true, response: { task: { id, kind, label: id }, children, errors } };
}
