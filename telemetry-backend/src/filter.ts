/**
 * Synthetic/junk telemetry exclusion — the single source of truth for what
 * counts as non-real traffic, consulted by every aggregate-producing query
 * (hot-layer stats, cold-layer stats, daily rollup, one-time backfill).
 *
 * This is unconditional and orthogonal to the `hideTest` toggle in stats.ts:
 * `hideTest` is a togglable convenience for viewing `version == '0.0.0'`
 * dev-mode traffic (a legitimate thing to want to see). Junk/synthetic
 * command values are never legitimate CLI usage under any view, so there is
 * no "include junk" escape hatch — this predicate is always spliced in.
 *
 * Forward convention: any future synthetic/dev probe MUST identify itself by
 * BOTH (a) using `SYNTHETIC_DISTINCT_ID` as its event's `distinctId`, and
 * (b) using a command name prefixed with `PROBE_COMMAND_PREFIX`. Only the
 * command prefix is checkable on the cold layer (D1 `rollups` has no
 * distinctId column by privacy contract); the hot layer checks both.
 */

// Reserved all-zero-UUID distinctId marker for synthetic/test events (precedent:
// the Phase C 4.2 infra probe already used this exact value).
export const SYNTHETIC_DISTINCT_ID = '00000000-0000-4000-8000-000000000000';

// Forward-looking convention: future synthetic/dev traffic should use a command
// name prefixed with this, so it self-identifies as excludable without a code change.
export const PROBE_COMMAND_PREFIX = 'probe:';

// Exact values only — no wildcards — so this list can never accidentally
// swallow a real rasen subcommand. Observed junk (2026-07-10 panel review):
// curl-based backend dev testing + the Phase C 4.2 infra probe (which shipped
// version '0.1.1', not '0.0.0', so the existing hideTest toggle never caught it).
export const JUNK_COMMANDS: readonly string[] = [
  'x',
  'final',
  'regress',
  'cd-smoke',
  'admintest',
  'x'.repeat(256),
  'phase-c-infra-hardening:synthetic-probe',
];

/** Double embedded single quotes for safe interpolation into a SQL string literal. */
export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

const JUNK_COMMANDS_SQL_LIST = JUNK_COMMANDS.map((c) => `'${escapeSqlLiteral(c)}'`).join(', ');

// Hot-layer (Analytics Engine) bare boolean expression — no leading "AND", splice
// with " AND " into any WHERE clause. Excludes the reserved synthetic distinctId,
// the exact junk command list, and any future `probe:`-prefixed command. Built
// once from JUNK_COMMANDS via escapeSqlLiteral — the list is a compile-time
// constant with no untrusted input, but escaping is applied on principle so the
// pattern stays correct if the list ever grows to include a value with a quote.
export const HOT_HYGIENE_PREDICATE =
  `index1 != '${escapeSqlLiteral(SYNTHETIC_DISTINCT_ID)}' AND ` +
  `blob1 NOT IN (${JUNK_COMMANDS_SQL_LIST}) AND ` +
  `blob1 NOT LIKE '${escapeSqlLiteral(PROBE_COMMAND_PREFIX)}%'`;

// Cold-layer (D1) equivalent: command-only, since `rollups` has no distinctId
// column. Returns the bare boolean expression plus its ordered bind values (one
// per JUNK_COMMANDS entry, then the probe:% LIKE pattern) — mirrors coldWhere's
// existing per-call { clause, binds } shape in stats.ts.
export function coldHygienePredicate(): { sql: string; binds: unknown[] } {
  const placeholders = JUNK_COMMANDS.map(() => '?').join(', ');
  return {
    sql: `command NOT IN (${placeholders}) AND command NOT LIKE ?`,
    binds: [...JUNK_COMMANDS, `${PROBE_COMMAND_PREFIX}%`],
  };
}
