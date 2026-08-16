# Proposal: issue-status-projection

## Why

A Store Issue carries intent, an operator-declared state (`open|resolved|dropped`), and immutable
Execution Plan revisions — but nothing answers "where is this Issue right now?" while its Changes
run. The facts that answer it already exist (committed Store evidence, each Change's real run-state,
the Issue's latest plan revision), yet no surface derives them, so an operator watching an executing
Issue sees `open` whether nothing has started, one child is mid-pipeline, or everything is waiting on
a human. This is the first slice of the Issue layer's golden path: execution binding (g-002) and
acceptance/close (g-003) both need an honest status projection to build on.

## What Changes

- Introduce the Issue **tri-axis status projection**: `phase` (`planning|ready|active|review|done`)
  × `health` (`healthy|blocked|failed|waiting-human|stale`) × `progress`
  (completed required nodes / total required nodes), derived fresh on every read from the Issue's
  latest immutable Execution Plan revision, committed Store evidence, and the real run-state of the
  referenced Changes on the machine the command runs from. It is never persisted — no second
  mutable truth beside the Issue record, the plan revisions, and the run-state files.
- Failure, blockage, and waiting-for-a-human are health values, never phases: a Change failing
  mid-run leaves the Issue `active/failed`, not "in a failed phase".
- Surface the projection on the existing Issue read surface: `rasen store issue list` gains a
  status column (`active/healthy 1/3`) and `rasen store issue show` gains a status section with
  per-node observations; both forms' `--json` output carries the same facts.
- Add a core projection module (`src/core/issue-status/`) that composes the store aggregate query
  with the existing run-state readers (`auto-run.json`, `portfolio-run.json` where present,
  resolved through the same sticky-legacy state-file chain `pipeline resume` uses).
- Dogfood the projection for real: register this portfolio itself as a Store Issue whose Execution
  Plan nodes are the three child Changes, and drive the projection through a real state transition
  (no plan → published plan with a live in-flight child), capturing command receipts as evidence.

## Capabilities

### New Capabilities

- `issue-status-projection`: Deriving and surfacing an Issue's tri-axis status (phase, health,
  progress) from its latest Execution Plan revision, committed Store evidence, and real Change
  run-state — read-only, derived on demand, never persisted.

### Modified Capabilities

<!-- None. `store-issue-resources` and `store-aggregate-query` requirements are unchanged: the
projection adds a new read composition rather than changing Issue mutation or the store-pure
aggregate query surface (run-state is machine-local, not Store content). -->

## Impact

- New core module `src/core/issue-status/` (projection + types); imports — does not modify —
  `src/core/pipeline-registry/{run-state,portfolio-state}.ts` (frozen for this session; read-only
  reuse), `src/core/file-placement.ts`, and `src/core/store/query/`.
- `src/commands/store-issue.ts`: enriched `list`/`show` renderers and JSON payloads; best-effort
  execution-root resolution for run-state visibility (degrades to an explicit "no local run-state"
  answer when the working directory resolves no project).
- Tests: derivation-table units over a real-Git store fixture with real run-state files, a
  read-only guard test in the `store-query-read-only-guard` family, CLI human/JSON parity tests.
- `architecture-index` skill: new core submodule entry.
- No web UI, no management-api routes, no version bumps, no changes to `packages/ui/src/canvas/*`
  or `src/core/pipeline-registry/` content.
