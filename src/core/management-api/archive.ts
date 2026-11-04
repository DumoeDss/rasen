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
import {
  getArchivedChangeIds,
  parseArchivedRef,
  resolveArchivedChangeDir,
} from '../../utils/item-discovery.js';
import { getTaskProgressForChange } from '../../utils/task-progress.js';
import type { ProjectHome } from '../project-home.js';
import { findPortfolioContainers, portfolioOf } from './changes.js';
import type { ArchivedChangeSummary, ArchiveResponse } from './wire-types.js';
import {
  resolveExecutionHome,
  resolveProjectContentSpace,
  type ProjectSpaceInput,
} from './project-space.js';

export type ArchiveResult =
  | { ok: true; response: ArchiveResponse; narrowing?: ArchiveNarrowing }
  | { ok: false; status: number; code: string; message: string };

/**
 * When the scope could not supply a dimension the archive listing is organized
 * by (today: target line), the result carries this alongside the response so the
 * caller can present the narrowing rather than rendering a partial list as the
 * complete one. An empty list plus "no target line addressed" is a true answer;
 * an empty list alone is a false one.
 */
export interface ArchiveNarrowing {
  /** Which scope dimension was not addressed. */
  dimension: 'target-line';
  /** Human-readable reason the dimension was absent. */
  reason: string;
}

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
  input: ProjectSpaceInput,
  home?: ProjectHome | null
): Promise<ArchiveResult> {
  const resolved = resolveProjectContentSpace(input);
  if (!resolved.ok) return resolved;
  const space = resolved.space;
  const resolvedHome = await resolveExecutionHome(space, home);
  const archiveDir = space.archiveDir ?? null;
  const containers = findPortfolioContainers(space.changesDir);

  // A Store v2 project scope with no resolved target line supplies no
  // `archive-line` path, so `archiveDir` is absent. Rather than degrade to an
  // empty listing indistinguishable from "this project has no archived changes",
  // the result states the dimension that was not addressed. Standalone and
  // legacy-flat spaces always supply `archiveDir`, so the narrowing never fires
  // for them and their output is byte-identical to the pre-change behavior.
  const narrowedByTargetLine =
    typeof input !== 'string' &&
    input !== undefined &&
    input.type === 'project' &&
    input.archiveDir === undefined;

  const changes: ArchivedChangeSummary[] = [];
  for (const dated of await getArchivedChangeIds(space.planningCheckoutRoot, {
    archiveDir,
    home: resolvedHome,
  })) {
    const ref = parseArchivedRef(dated);
    if (!ref) continue;
    const archiveChangesDir = resolveArchivedChangeDir(archiveDir, resolvedHome, ref.dated);
    if (archiveChangesDir === null) continue;
    const taskProgress = await getTaskProgressForChange(
      archiveChangesDir,
      ref.dated,
      space.planningCheckoutRoot,
      space.schemasDir
    );
    const portfolio = portfolioOf(ref.name, containers);
    changes.push({
      name: ref.name,
      archivedAt: ref.date,
      taskProgress,
      ...(portfolio !== undefined ? { portfolio } : {}),
    });
  }

  return {
    ok: true,
    response: { changes },
    ...(narrowedByTargetLine
      ? {
          narrowing: {
            dimension: 'target-line' as const,
            reason:
              'No target line was addressed; archived changes for this project are organized per target line. Resolve a target line to see them.',
          },
        }
      : {}),
  };
}
