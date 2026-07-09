## Why

The telemetry admin panel shows synthetic and junk command values mixed in with real CLI usage — backend-development curl tests (`x`, `final`, `regress`, `cd-smoke`, `admintest`, a 256-character `x` string) and an infra probe (`phase-c-infra-hardening:synthetic-probe`) that predates any exclusion convention. These rows are noise in every aggregate: they inflate command breakdowns and DAU counts on both the live (Analytics Engine) and permanent (D1 rollup) layers, and the junk rows have already been aggregated into the permanent store, so they will never age out on their own.

## What Changes

- A single exclusion module defines what counts as synthetic/junk telemetry: the known junk command list, a reserved all-zero-UUID `distinctId` marker (precedent: the Phase C 4.2 infra probe already used it), and a forward-looking `probe:` command-prefix convention for future synthetic traffic.
- Every aggregate query — hot-layer stats (overview/DAU/breakdowns), cold-layer stats (same, from the D1 rollup store), and the queries that feed the rollup store (daily cron + one-time backfill) — applies this exclusion unconditionally. It is independent of the existing `hideTest` toggle (which hides `version == '0.0.0'` dev traffic and stays a togglable, opt-out filter); junk/synthetic rows have no "include them" escape hatch.
- A one-time cleanup deletes the junk rows already aggregated into the D1 rollup store, with a before/after row count captured as evidence.
- The updated Worker is deployed (`wrangler deploy`) so the exclusion is live on both the hot and cold read paths and stops feeding new junk into future rollups.

Analytics Engine (the hot layer) is append-only — this change filters it at query time on every read path; it never deletes or modifies raw hot-layer data. Only the D1 rollup store (a derived, mutable aggregate) receives an actual `DELETE`, and only for the enumerated junk command values.

## Capabilities

### New Capabilities

(none — this refines existing telemetry-backend query behavior, not a new capability)

### Modified Capabilities

- `telemetry-backend`: aggregate reads (`Two-Layer Aggregate Query` requirement) and the rollup/backfill source queries now exclude a defined set of synthetic/junk events, in addition to the existing `hideTest`-controlled dev-traffic filter.

## Impact

- Affected code: `telemetry-backend/src/stats.ts` (hot- and cold-layer WHERE-clause construction), `telemetry-backend/src/rollups.ts` (daily rollup + backfill source queries), a new `telemetry-backend/src/filter.ts` (shared exclusion constants + predicate builders), `telemetry-backend/test/worker.test.ts` (regression coverage via the existing vitest suite).
- Affected data: the `rasen-telemetry-rollups` D1 database — one-time `DELETE` of rows matching the enumerated junk `command` values (exact-match only, no wildcards), with SELECT-before/SELECT-after evidence captured.
- Deployment: `npx wrangler deploy` from `telemetry-backend/`, activating the exclusion on the live Worker.
- No change to the ingest contract, the privacy contract, or any main-repo (CLI/template/spec) code — surface is `telemetry-backend/**` only.
