/**
 * `GET /api/v1/archive` handler (ui-space-redesign-archive-page design D1/D2).
 * Lists a space's archived changes — the sticky-union of the in-repo archive
 * directory and the project's machine-home archive that `getArchivedChangeIds`
 * reports — each with its un-dated name, archive date, portfolio-container
 * membership (the same longest-prefix rule the changes listing uses), and
 * task-checkbox progress. Complementary to `/api/v1/tasks/:id`: that reports
 * one Task's archived children; this reports the space's whole archived roster.
 * Reuses the same discovery/progress helpers, mints nothing, and writes nothing
 * (the real-source red line, decision #10).
 */
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../config.js';
import {
  getArchivedChangeIds,
  parseArchivedRef,
  resolveArchivedChangeDir,
} from '../../utils/item-discovery.js';
import { getTaskProgressForChange } from '../../utils/task-progress.js';
import type { ProjectHome } from '../project-home.js';
import { findPortfolioContainers, portfolioOf } from './changes.js';
import type { ArchivedChangeSummary, ArchiveResponse } from './wire-types.js';

export type ArchiveResult =
  | { ok: true; response: ArchiveResponse }
  | { ok: false; status: number; code: string; message: string };

/**
 * Lists the space's archived changes (design D1). Read-only: enumerates via
 * `getArchivedChangeIds`, resolves each archived change's on-disk location with
 * the shared `resolveArchivedChangeDir` probe, and counts its task checkboxes
 * with `getTaskProgressForChange` (which never throws — a stale archived schema
 * degrades to a best-effort count). Grouping and sort order stay UI-side (child
 * 3 precedent); the endpoint returns the enumeration order, flat.
 *
 * @param home Pre-resolved project home (read-only), or null when the space has
 * no machine identity yet — the archive-home probe degrades to the in-repo dir.
 */
export async function handleArchive(
  root: string | undefined,
  home: ProjectHome | null
): Promise<ArchiveResult> {
  if (!root) {
    return {
      ok: false,
      status: 400,
      code: 'project_required',
      message: 'No Rasen project is available for this server; launch `rasen ui` inside a project.',
    };
  }

  const changesDir = path.join(root, WORKSPACE_DIR_NAME, 'changes');
  const archiveDir = path.join(changesDir, 'archive');
  const containers = findPortfolioContainers(changesDir);

  const changes: ArchivedChangeSummary[] = [];
  for (const dated of await getArchivedChangeIds(root)) {
    const ref = parseArchivedRef(dated);
    if (!ref) continue;
    const archiveChangesDir = resolveArchivedChangeDir(archiveDir, home, ref.dated);
    const taskProgress = await getTaskProgressForChange(archiveChangesDir, ref.dated, root);
    const portfolio = portfolioOf(ref.name, containers);
    changes.push({
      name: ref.name,
      archivedAt: ref.date,
      taskProgress,
      ...(portfolio !== undefined ? { portfolio } : {}),
    });
  }

  return { ok: true, response: { changes } };
}
