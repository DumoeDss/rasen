## Context

The telemetry backend (`telemetry-backend/`, a standalone Cloudflare Worker) has two read layers over one write path:

- **Hot layer**: raw events in an Analytics Engine (AE) dataset (`openspec_telemetry`), queried via the Cloudflare SQL API. AE is append-only — there is no delete/update API, only a ~90-day rolling retention window. Column map: `blob1`=command, `blob2`=version, `blob3`=os, `blob4`=node_version, `index1`=distinctId.
- **Cold layer**: a D1 table `rollups` (binding `ROLLUPS`), holding permanent day-grained aggregates `(date, command, version, os, node_version, events, users)`. Fed by a daily cron (`runDailyRollup`) and a one-time `runBackfill`, both in `telemetry-backend/src/rollups.ts`. By privacy contract this table has **no distinctId column** — rollup queries only ever select dimensions + aggregate functions.

All hot-layer stats queries (`overviewHot`, `dauHot`, `breakdownHot` in `telemetry-backend/src/stats.ts`) route through one function, `hotWhere(opts)` (`stats.ts:176-183`), which already appends an optional `hideTest` predicate (`blob2 != '0.0.0'`) and dimension-equality filters. All cold-layer stats reads (`overviewCold`, `dauCold`, `breakdownCold`) route through the equivalent `coldWhere(opts, base?)` (`stats.ts:251-269`), which uses D1 bound parameters (`?`) for filter values — the AE SQL API has no bind-parameter support, so hot-layer filter values are interpolated as escaped/validated string literals instead (`parseFilters` rejects quotes/semicolons/control chars, capped at 256 chars).

Critically, `runDailyRollup` and `runBackfill` (`rollups.ts`) build their own AE SQL strings directly — they do **not** go through `hotWhere`. Anything excluded only in `hotWhere` still flows into the cold rollup store via these two functions.

The panel currently shows junk from two sources: ad-hoc curl-based backend dev testing (commands `x`, `final`, `regress`, `cd-smoke`, `admintest`, and a 256-character `x` string) and a Phase C 4.2 infra probe (command `phase-c-infra-hardening:synthetic-probe`, `distinctId` `00000000-0000-4000-8000-000000000000`, `version` `0.1.1` — notably *not* `0.0.0`, so the existing `hideTest` toggle never caught it). These rows are already aggregated into the D1 `rollups` table and need a one-time cleanup in addition to a code fix.

`telemetry-backend` has a working vitest suite (`telemetry-backend/test/worker.test.ts`, 29 tests, `npm test` → all green) that already asserts on the literal SQL text sent to the AE SQL API mock and the D1 mock's recorded SQL strings/binds (e.g. the existing `hideTest` predicate is asserted this way). This is the natural home for regression coverage of the new exclusion logic — there is no missing test framework to introduce.

## Goals / Non-Goals

**Goals:**
- One module defines what is synthetic/junk; every aggregate-producing query (hot stats, cold stats, rollup, backfill) consults it — no second place can silently omit the filter.
- The exclusion is unconditional (not a togglable param) and orthogonal to the existing `hideTest` toggle, which remains unchanged.
- A documented, explicit forward convention lets future synthetic/dev traffic self-identify and be excluded without a code change.
- The already-polluted D1 rollup rows are removed, with before/after evidence.
- The fix is deployed and the deploy is verified to the extent verifiable without a Cloudflare Access session.

**Non-Goals:**
- Deleting or mutating raw Analytics Engine (hot-layer) data — it is append-only by design; this change only changes what its queries select.
- Retroactively re-deriving which historical hot-layer AE rows were junk (AE has no delete API; its ~90-day window will age them out naturally).
- Changing the `hideTest` toggle's behavior or its `version == '0.0.0'` semantics.
- A general-purpose rules engine for classifying junk — the list is a fixed, named enumeration (see Decisions).

## Decisions

### 1. New module `telemetry-backend/src/filter.ts`

A standalone module (not folded into `stats.ts`) so `rollups.ts` can import the same constants/builders without route-specific coupling, and so the exclusion logic is independently unit-testable. Exports:

```ts
export const SYNTHETIC_DISTINCT_ID = '00000000-0000-4000-8000-000000000000';
export const PROBE_COMMAND_PREFIX = 'probe:';

// Exact values only — no wildcards — so this list can never accidentally
// swallow a real rasen subcommand. Observed junk (2026-07-10 panel review):
// curl-based backend dev testing + the Phase C 4.2 infra probe.
export const JUNK_COMMANDS: readonly string[] = [
  'x',
  'final',
  'regress',
  'cd-smoke',
  'admintest',
  'x'.repeat(256),
  'phase-c-infra-hardening:synthetic-probe',
];

export function escapeSqlLiteral(value: string): string; // doubles single quotes

// Hot-layer (AE) bare boolean expression — no leading "AND", splice with
// " AND " into any WHERE clause. Excludes the reserved synthetic distinctId,
// the exact junk command list, and any future `probe:`-prefixed command.
export const HOT_HYGIENE_PREDICATE: string;

// Cold-layer (D1) equivalent: command-only (no distinctId column exists in
// `rollups`). Returns the bare boolean expression plus its ordered bind values.
export function coldHygienePredicate(): { sql: string; binds: unknown[] };
```

`HOT_HYGIENE_PREDICATE` is a module-level constant (built once from `JUNK_COMMANDS` via `escapeSqlLiteral`, even though the list is a compile-time constant with no untrusted input — escaping is applied on principle, per the LEAD's instruction, so the pattern is correct if the list ever grows to include a value with a quote). `coldHygienePredicate()` is a function (not a constant) purely to mirror `coldWhere`'s existing per-call `{ clause, binds }` shape in `stats.ts`.

**Alternative considered**: fold the constants into `stats.ts` as a private helper. Rejected — `rollups.ts` needs the same hot-layer predicate, and `stats.ts` already type-imports from `rollups.ts` (`RollupsEnv`), so adding a reverse value-import would risk the runtime import cycle the existing type-only import comment explicitly calls out avoiding.

### 2. Unconditional, not gated by `hideTest`

The hygiene predicate is spliced into `hotWhere`/`coldWhere` unconditionally (always present, both when `hideTest` is true and when a caller passes `hideTest=false`). Rationale: `hideTest` is a togglable convenience for viewing `version == '0.0.0'` dev-mode traffic (a legitimate use case — a maintainer may want to see it). Junk/synthetic command values are never legitimate CLI usage under any view, so there is no corresponding "include junk" toggle. This also matches the observed Phase C 4.2 probe, which shipped `version: '0.1.1'` specifically so it would NOT be caught by `hideTest` — it needs its own, always-on exclusion.

### 3. Injection points — three call sites, one predicate/builder pair

- `stats.ts` `hotWhere(opts)`: prepend `HOT_HYGIENE_PREDICATE` to `parts` before the existing `hideTest`/filter predicates. Covers `overviewHot`, `dauHot`, `breakdownHot` — confirmed the single chokepoint for all hot-layer stats reads (no other function builds a hot-layer WHERE clause).
- `stats.ts` `coldWhere(opts, base?)`: merge `coldHygienePredicate()`'s `sql` into `parts` and its `binds` into `binds`, unconditionally. Covers `overviewCold`, `dauCold`, `breakdownCold` — confirmed the single chokepoint for all cold-layer stats reads.
- `rollups.ts` `runDailyRollup`: append `AND ${HOT_HYGIENE_PREDICATE}` after the existing `timestamp >= ... AND timestamp < ...` bounds, so junk is never aggregated into a future day's rollup.
- `rollups.ts` `runBackfill`: add `WHERE ${HOT_HYGIENE_PREDICATE}` (the query currently has no WHERE clause at all), so a re-run of the backfill does not re-introduce junk that the one-time D1 cleanup (Decision 4) just removed.

This is 3 call sites total (not 4 — `hotWhere` and the two `rollups.ts` queries share the same `HOT_HYGIENE_PREDICATE` string; `coldWhere` uses the D1-flavored builder), all driven from the one module.

### 4. One-time D1 cleanup — exact enumeration, SELECT-first evidence

Per the destructive-operation constraint, the cleanup:
1. Runs a `SELECT` enumerating the exact `JUNK_COMMANDS` values via `command IN (...)` (no `LIKE`), captures the full row set (date/command/version/os/node_version/events/users) as before-evidence.
2. Runs a `DELETE FROM rollups WHERE command IN (...)` with the identical exact-value list.
3. Re-runs the same `SELECT` to confirm zero matching rows, captured as after-evidence.

The 256-character `x` string is unwieldy as an inline `wrangler d1 execute --command` argument, so both statements are written to a one-time SQL file and run via `wrangler d1 execute rasen-telemetry-rollups --remote --file <path>`. This file is NOT added to `telemetry-backend/migrations/` (that directory is schema migrations; this is a one-time data cleanup, not a repeatable schema change) — it lives under the change's work directory and its output is captured as evidence there, per the `research/` convention already used by this repo's other changes (e.g. `phase-c-infra-hardening/work/research/4.2-synthetic-payload.json`).

### 5. Deployment and verification

`npx wrangler deploy` from `telemetry-backend/` activates the exclusion Worker-side. Verification without an Access session:
- **Fully verifiable by the implementer**: the vitest suite (pre-deploy, asserts the exact SQL text/binds sent for hot and cold queries and the two rollup/backfill queries) and the D1 cleanup's own before/after `SELECT`s (via `wrangler d1 execute`, which uses the locally authenticated `wrangler` CLI, not an Access JWT) and a plain ingest smoke test (`POST /` → `202`, which exercises the deploy succeeded but not the hygiene logic itself, since ingest doesn't query).
- **Not verifiable without a browser Cloudflare Access session**: `/api/admin/*` stats endpoints are Access-gated (`Cf-Access-Jwt-Assertion` from a signed-in session); there is no CLI-obtainable JWT for this. Per the LEAD's explicit instruction, this is **not** faked — it is recorded as a known limitation, and confirming the live panel now shows clean breakdowns is left as the user's own follow-up check (as prior sessions have already handled analogous panel-facing verification steps).

### 6. Spec wording discipline

The `telemetry-backend` capability spec's `Two-Layer Aggregate Query` requirement is modified to add the exclusion as an additional, always-on filtering behavior on both layers — worded as query-side filtering, never as "deletion" of hot-layer data, consistent with the AE append-only fact and the project's prior external communication that AE data cannot be deleted.

### 7. Testing — extend the existing vitest suite, no new framework

`telemetry-backend/test/worker.test.ts` already asserts on `sqlBodies` (AE SQL API request bodies) and the D1 mock's recorded SQL/binds for the existing `hideTest` predicate — the identical technique applies directly to the new hygiene predicate. New tests (same file, new `describe` block or appended to the existing `stats v2` block):
- A hot-layer request's SQL body contains `HOT_HYGIENE_PREDICATE`'s components (the synthetic distinctId exclusion, a `NOT IN (...)` with the junk commands, and a `NOT LIKE 'probe:%'`).
- A cold-layer request's D1 SQL contains the equivalent `command NOT IN (...)` / `command NOT LIKE ?` shape (extending the D1 mock to also record binds, mirroring how `sqlBodies` already records the hot-layer request text).
- `runDailyRollup` and `runBackfill`'s AE query bodies also contain the hygiene predicate (proves the rollup/backfill injection points, not just the stats reads).
- Unit tests directly against `filter.ts`'s exports: `escapeSqlLiteral` doubles quotes, `coldHygienePredicate()` returns one bind per `JUNK_COMMANDS` entry plus the `probe:%` LIKE bind.

No new test framework, no lightweight ad-hoc script — the existing `npm test` (vitest) is the single source of regression evidence, captured as a green run in the ship log.

## Risks / Trade-offs

- **[Risk]** A real future rasen subcommand happens to be named one of the exact junk strings (e.g. `x`) → **Mitigation**: the list is small, exact-match (no substring/prefix matching except the deliberate `probe:` convention), and reviewed before merge; a subcommand collision would be caught by this change's own review and by `commands` breakdown inspection.
- **[Risk]** A future synthetic probe forgets the `probe:` prefix or the zero-UUID marker and pollutes the cold store again → **Mitigation**: the forward convention is now documented in `filter.ts`'s doc comment (single source read by anyone adding a probe) and in this design doc; a future occurrence would need the same one-time-cleanup pattern this change establishes, not a design change.
- **[Risk]** The D1 `DELETE` is irreversible (D1 doesn't retain a change history) → **Mitigation**: exact enumeration (no wildcards) plus before/after `SELECT` evidence captured before running it; the daily cron and future `runBackfill` reruns will no longer reintroduce these rows (Decision 3), so the cleanup does not need to be repeated.
- **[Trade-off]** Verification of the deployed hygiene behavior on the live authenticated stats endpoints is left to the user (no CLI-obtainable Access JWT) → accepted per explicit design direction; the vitest suite and the D1 before/after evidence are the implementer-side proof, and this limitation is stated plainly rather than worked around with a fabricated check.

## Migration Plan

1. Add `src/filter.ts`; wire `HOT_HYGIENE_PREDICATE` into `hotWhere` (stats.ts), the two `rollups.ts` AE queries, and `coldHygienePredicate()` into `coldWhere` (stats.ts).
2. Extend `test/worker.test.ts` with the coverage in Decision 7; run `npm test` (telemetry-backend) to green.
3. `npx wrangler deploy` from `telemetry-backend/`.
4. Run the one-time D1 cleanup (SELECT → capture → DELETE → SELECT → capture), evidence under the change work directory.
5. Record deploy + cleanup evidence in the ship log; note the Access-gated panel recheck as the user's follow-up.

Rollback: the code change is a pure query-filter addition with no schema change and no data mutation of its own (the D1 `DELETE` is a separate, explicit step) — reverting is a plain `wrangler deploy` of the prior Worker version. The D1 cleanup itself has no automated rollback (the deleted rows are gone); this is accepted because they are enumerated junk, not user data.

## Open Questions

- None blocking. The Access-gated panel recheck (Decision 5) is a known, explicitly-accepted limitation rather than an open question.
