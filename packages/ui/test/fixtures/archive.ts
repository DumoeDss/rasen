import type { ArchiveResponse } from '../../src/api/types.js';

/**
 * A space's archive roster (ui-space-redesign-archive-page design D1/D6): two
 * changes sharing a portfolio container, one bare change, and a second bare
 * change with a later date — so grouping, portfolio collapse, and the
 * time-reverse sort all have something to bite on. `satisfies ArchiveResponse`
 * is the `tsc` drift tripwire over the mirrored wire types — no `as` anywhere.
 */
export const archiveFixture = {
  changes: [
    {
      name: 'ui-redesign-api',
      archivedAt: '2026-01-01',
      portfolio: 'ui-redesign',
      taskProgress: { total: 4, completed: 4 },
    },
    {
      name: 'ui-redesign-shell',
      archivedAt: '2026-02-15',
      portfolio: 'ui-redesign',
      taskProgress: { total: 3, completed: 3 },
    },
    {
      name: 'fix-login',
      archivedAt: '2026-01-20',
      taskProgress: { total: 2, completed: 2 },
    },
    {
      name: 'tidy-logs',
      archivedAt: '2026-03-10',
      taskProgress: { total: 0, completed: 0 },
    },
  ],
} satisfies ArchiveResponse;
