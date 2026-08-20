## Why

Phase 3 made one Issue span member projects: plan nodes carry authoritative
target projects (g-001), dependency waits name their project and state on the
one work-complete rule (g-002) — and the operator still reads the plan as one
flat node list, computing "how is the site side doing" by eye. The roadmap's
Phase 3 read-surface promise (project lanes, per-project progress, project
grouping — chips deferred to the UI era) is the missing half, and the phase's
completion evidence demands a REAL two-project Issue driven end to end on the
persistent Store, which the two shipped children have now made possible.

## What Changes

- **The projection derives per-project lanes.** For a readable revision, the
  status gains one lane per distinct target project among its nodes — the
  project identity, a display alias supplied as input (the Store's own
  catalog alias, never a guess; the raw project id when no alias resolves),
  the lane's node identifiers, and the lane's progress pair computed by the
  SAME rule and scoping as the Issue's progress (required change nodes of
  that project; work-complete basis; zero-over-zero when a lane demands no
  work). Lanes drive no axis: phase, health, and progress derive exactly as
  before, and an unreadable revision reports no lanes at all.
- **`show` renders lanes; `list` summarizes per project.** `store issue show`
  groups the existing per-node lines under one lane header per project, each
  header carrying the project, its alias, and its progress pair; `store issue
  list` carries a compact per-project progress summary beside the Issue-level
  pair. Human and `--json` forms carry the same lane facts; the flat node
  list stays (the lanes reference it — no duplicated node truth).
- **Issue #2 — the real multi-project dogfood on the persistent
  `issue-registry` Store.** Second member project: **`rasen-site`** (real,
  small, active; own git repo and `rasen/` workspace; site+core is the
  natural cross-project Issue shape — decided in g-001's findings,
  `rasen-telemetry-backend` declined). Store prerequisites executed as real,
  durable mutations: widen the rasen member to a planning member (the
  OR-widening re-run g-001's refusal names), add `rasen-site` as a member,
  extend `line-0.2`'s project map with the site's code ref. Issue #2
  (`issue-cross-project-execution`) publishes a plan spanning BOTH projects:
  the portfolio's shipped children as rasen-project nodes, this change as an
  INTENT node at first publication (promoted to a change node by a second
  revision once committed — the ordinal-revision discipline demonstrated on
  real data), and a REAL site node — a docs page in `rasen-site` documenting
  multi-project Issue execution — depending on this change's node across the
  project boundary. The loop is driven for real: cross-project projection
  receipts, the cross-project gating refusal while the upstream is
  un-terminal, and the close STAGED per the Phase-2 precedent (gate-holds
  receipt + documented accept step; no acceptance unless every node is
  genuinely terminal at hand).

Non-goals: project chips / filtering (UI era), automatic routing (manual
selection only), changing any gate or publication rule (g-001/g-002 own
those), activating reserved health values (dependency waits stay `healthy`),
and any `packages/ui/**` / `src/core/pipeline-registry/` / template change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `issue-status-projection`: a new requirement — per-project lanes derived on
  the work-complete rule; the read-surface requirement extended — `show`
  renders per-project lanes over the existing node lines, `list` carries the
  per-project summary, both forms agree on the same lane facts.

## Impact

- `src/core/issue-status/types.ts` + `projection.ts` — `IssueStatus` gains
  the lane list (one projection seam, extended in place; the `projectId`
  field's "later capability" comment resolves here); the lane derivation
  reuses the projection's existing completion predicate, shared not
  rewritten (g-002's `issueBlockerState` discipline).
- `src/commands/store-issue.ts` — `resolveStoreWideningContext` composition
  extended to read the Store's project catalogs for display aliases (input
  fact; identity stays the project id); `renderIssueDetail` renders lanes;
  `renderIssueList` renders the summary. No new command, option, locale key,
  or completion entry — three-way sync N/A.
- Tests: lane derivation (multi-project, single-project, optional/cancelled
  scoping, zero-over-zero, unreadable revision), show/list rendering (dist
  built first), human/JSON parity, degradation (Issue #1's single-project
  revision reads with identical axes and exactly one lane).
- Dogfood on the persistent `issue-registry` Store — real, durable mutations
  only: membership widen + member add + line map extension; the site change
  authored in the Store's site partition (`--project`, the sanctioned
  store-scoped planning root) and committed; Issue #2 created and published;
  receipts under `evidence/`; the release-and-accept legs staged as
  documented close steps (LEAD-sequenced), never as task checkboxes.
