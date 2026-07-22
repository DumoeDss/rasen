/**
 * The admission whitelist, as data (design D7). Two tiers: `bounded-cli`
 * (deterministic, bounded, resident-process-free — change submission via
 * `POST /api/v1/changes` and the four workflow-library mutations via
 * `POST /api/v1/workflows`) and `supervised-long-runner` (admissible only
 * because session-supervision replaces the bounded-termination guarantee with
 * registry tracking, dual timeouts, and reliable tree-kill — the sessions
 * endpoints). Each endpoint's handler admits only entries of its own
 * operation set; adding a future operation is a table row, not new plumbing
 * (proposal.md, "Capabilities").
 */

export const OVERALL_TIMEOUT_DEFAULT_MS = 4 * 60 * 60 * 1000; // 4h (design D3)
export const OVERALL_TIMEOUT_CAP_MS = 12 * 60 * 60 * 1000; // 12h cap
export const NO_OUTPUT_TIMEOUT_DEFAULT_MS = 10 * 60 * 1000; // 10min (design D3)
export const NO_OUTPUT_TIMEOUT_CAP_MS = 30 * 60 * 1000; // 30min cap

export interface BoundedCliEntry {
  tier: 'bounded-cli';
  op: string;
}

export interface SupervisedLongRunnerEntry {
  tier: 'supervised-long-runner';
  op: string;
  /** The skill invocation prefixed onto the task text to form the single prompt token (design D1). */
  skill: string;
  defaultTimeoutMs: number;
  defaultNoOutputTimeoutMs: number;
}

export type WhitelistEntry = BoundedCliEntry | SupervisedLongRunnerEntry;

/**
 * The whitelist table, enumerated by tier (change-submission spec's
 * requirement-level exactness rules — described by tier here rather than a
 * hardcoded count that drifts as endpoints are added):
 *
 * - `bounded-cli`: change submission (`create-change`) and the four
 *   workflow-library mutations (`import-workflow`, `init-workflow`,
 *   `export-workflow`, `delete-workflow`). Each is deterministic, bounded,
 *   and leaves no resident process. Space-creation adds three more bounded
 *   ops (`create-project-space`, `register-store-space`, `setup-store-space`)
 *   in its own sibling change — reconciled into this table at merge.
 * - `supervised-long-runner`: exactly `auto` and `goal`.
 *
 * Each mutation endpoint admits only entries of its own operation set (the
 * workflow bridge serves only the four workflow ops, the change bridge only
 * `create-change`).
 */
export const WHITELIST: Readonly<Record<string, WhitelistEntry>> = Object.freeze({
  'create-change': { tier: 'bounded-cli', op: 'create-change' },
  'import-workflow': { tier: 'bounded-cli', op: 'import-workflow' },
  'init-workflow': { tier: 'bounded-cli', op: 'init-workflow' },
  'export-workflow': { tier: 'bounded-cli', op: 'export-workflow' },
  'delete-workflow': { tier: 'bounded-cli', op: 'delete-workflow' },
  auto: {
    tier: 'supervised-long-runner',
    op: 'auto',
    skill: '/rasen:auto',
    defaultTimeoutMs: OVERALL_TIMEOUT_DEFAULT_MS,
    defaultNoOutputTimeoutMs: NO_OUTPUT_TIMEOUT_DEFAULT_MS,
  },
  goal: {
    tier: 'supervised-long-runner',
    op: 'goal',
    skill: '/rasen:goal',
    defaultTimeoutMs: OVERALL_TIMEOUT_DEFAULT_MS,
    defaultNoOutputTimeoutMs: NO_OUTPUT_TIMEOUT_DEFAULT_MS,
  },
});

/** Looks up `kind` and returns it only if it belongs to the supervised long-runner tier — never a bounded-cli entry. */
export function getSupervisedEntry(kind: unknown): SupervisedLongRunnerEntry | undefined {
  if (typeof kind !== 'string') return undefined;
  const entry = WHITELIST[kind];
  return entry && entry.tier === 'supervised-long-runner' ? entry : undefined;
}

/** Looks up `op` and returns it only if it belongs to the bounded CLI tier. */
export function getBoundedCliEntry(op: unknown): BoundedCliEntry | undefined {
  if (typeof op !== 'string') return undefined;
  const entry = WHITELIST[op];
  return entry && entry.tier === 'bounded-cli' ? entry : undefined;
}
