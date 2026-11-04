# Proposal — issue-read-surface

## Why

Phases 1–6 built the whole Issue truth surface as pure CLI-side derivations: status axes
(phase/health/progress), per-node observations and blockers, per-project lanes, the ready set,
needs-attention, delivery evidence, and the unified review — all derived on one read from
committed Store evidence plus honest run-state probing. That truth is reachable only through
`rasen store issue …` in a terminal. Roadmap §9 (Phase 7 界面收敛) asks for the interface that
presents it: an Issue Board (one card per Issue, five lanes, separated axes, chips as filter)
and an Issue Detail (background/acceptance, plan, grouped Changes, dependencies, evidence,
review). The completion-evidence line is explicit: every displayed state must trace to a Git
artifact or real run evidence, and deleting/rebuilding any UI cache must restore a consistent
view — which rules out a second state layer from the start.

The daemon already half-bridges the gap: `/api/v1/stores/issues` and `/api/v1/stores/issue`
serve the RAW aggregate reads (summary page, detail) — but no status projection, no attention,
no review rides over HTTP. And the two Issue-aware UI components that exist
(`StoreIssuesView`, `StoreAggregateBoard`) are orphaned — no route reaches them, and they
predate the projection layer entirely. There is currently no way to see an Issue's derived
truth outside the terminal.

g-001 closes exactly the read half: daemon endpoints that pass through the same core
composition the CLI prints, and a read-only Issue Board + Issue Detail skeleton in
`packages/ui` presenting those payloads verbatim. Writes (attach/create/resume — g-002) and
old-board disposal plus interaction completion (g-003) are out of scope here.

## What Changes

- **One composition, two callers.** Extract the CLI's issue read composition (today inline in
  `store-issue.ts` show/list and `store.ts` attention) into a new core module
  `src/core/issue-read/`: three compose functions with named payload types — list-with-status,
  detail-with-delivery-and-review, store attention scan. The CLI rewires onto them (`--json`
  bytes and human rendering unchanged); the daemon calls the same functions. Parity becomes a
  property of construction, not of two parallel assemblies.
- **Three new GET paths** in the management API's flat Store-aggregate family, each a
  passthrough of one compose function: `/api/v1/stores/issue-projections` (list),
  `/api/v1/stores/issue-projection?issueId=` (detail — status, delivery, and review together,
  exactly the CLI `show --json` body), `/api/v1/stores/issue-attention[?issueId=]` (fleet
  scan, `--issue` narrowing included). Space-addressed (`?space=store:<uid>`), read-only,
  lock-free, zero cache — every request re-derives from evidence.
- **Error semantics carried whole.** Refusals map the store's own codes to HTTP statuses in
  the shared `ApiErrorBody` envelope (`issue_not_found` → 404, unknown attention narrowing →
  404, scope faults → 400). Unreadable evidence is NOT a refusal: it stays a 200 payload
  carrying `problems` / `complete: false` / `unsearchedRefs` and per-node status problems —
  the same two disjoint channels the CLI reports.
- **Read-only Issue Board** (`/s/:storeId/issues`, §9.1): one card per Issue placed in the
  five phase lanes (Planning/Ready/Active/Review/Done — the projection's closed vocabulary,
  verbatim); phase, health, and progress presented as three separate facts; member-project
  chips as a filter only; each card shows the Issue title and its single most important
  attention item; divergence, unreadable items, and live-run visibility are surfaced, never
  hidden.
- **Read-only Issue Detail** (`/s/:storeId/issues/:issueId`, §9.2): background and
  acceptance; Execution Plan nodes (lifecycle, observation, target project, suggestion and
  rationale); Changes grouped by member project with per-project progress; cross-project
  dependencies (blocker facts with project and state labels); Run/Session attribution and
  delivery evidence (per node and rolled-up counts); review determination and threads; needs
  attention.
- **Dogfood:** read-only receipts against the real `issue-registry` store (five Issues, all
  done) — HTTP payloads deep-equal the CLI `--json` on the same store; the Board renders five
  Done-lane cards with empty attention.

## Capabilities

### New Capabilities

- `issue-board-ui`: the read-only Issue Board and Issue Detail — a five-lane phase board with
  separated axes, filter-only member-project chips, and honest incompleteness reporting; a
  detail surface presenting the projection's full read (plan, grouped Changes, dependencies,
  evidence, review, attention); zero second state — data is fetched from the projection
  endpoints on navigation and refresh, no status fact is persisted client-side, and every
  displayed state field traces to a field of a projection payload.

### Modified Capabilities

- `management-http-api`: additive only — a new requirement pair for the Store aggregate
  projection paths (issue-projections / issue-projection / issue-attention) serving status,
  attention, and review reads with CLI parity, fresh derivation on every request, and the
  refusal-vs-unreadable channel split preserved. No existing requirement or scenario text
  changes; the existing raw aggregate paths are untouched.

## Impact

- `src/core/issue-read/` (new) — composition module: payload types + `composeIssueProjectionList`
  / `composeIssueProjectionDetail` / `composeStoreAttention` + run-state context resolution;
  seams moved down from `src/commands/store-issue.ts` (`statusInputFor`,
  `resolveStoreWideningContext`, `resolvePredecessorPlan`, the list-detail assembly).
- `src/commands/store-issue.ts`, `src/commands/store.ts` — list/show/attention rewired onto
  the composition; output byte-identical.
- `src/core/management-api/stores.ts` — three new handlers on the `run()`/`statusForIssueCode`
  spine; `mapThrown` extended for the attention narrowing refusal.
- `src/core/management-api/router.ts` — three `MANAGEMENT_PATHS` entries + GET dispatch
  branches; `src/core/management-api/wire-types.ts` — three alias response types in the Store
  aggregate section.
- `packages/ui` (unfrozen this slice) — mirrored wire types, three client methods, new
  `IssueBoardPage` / `IssueCard` / `IssueDetailPage` components, route pair, store-space nav
  entry, `issues.*` i18n keys in all three locales.
- Tests — `test/core/management-api/issue-projection.test.ts` (handler-level + over-the-wire
  CLI↔API parity, both channels, freshness); existing CLI suites as refactor guard; wire-mirror
  floor list update; `packages/ui/test/components/issue-board-page.test.tsx` +
  `issue-detail-page.test.tsx` + route/i18n coverage under packages/ui's own vitest config.
- Untouched: `src/core/pipeline-registry/` (frozen), the old Board/Task surface and the
  orphaned `StoreIssuesView`/`StoreAggregateBoard` (g-003 disposal), all issue-family core
  derivations, versions (no bumps).
