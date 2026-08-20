## Context

The dependency gate already exists and is already cross-project-safe. Verified
in `src/core/issue-execution/binding.ts`: a fresh launch refuses while any
`dependsOn`'s OBSERVED work is non-terminal — `workComplete` accepts exactly
`finalized` and `run-terminal`, `undefined`/`unknown` fail closed — the
derived frontier offers only nodes whose every dependency passes the same
test, and the observation a cross-project dependency contributes is already
located machine-independently (the projection's workspace-index locator
widening, Phase 1). The edge rule is edge-wise and project-blind: a dependency
in another member project has gated its downstream identically since Phase 2.

What the multi-project era actually breaks is the explanation, on both
surfaces:

- `start` refusals name bare node ids (`Node 'x' is not runnable: the work of
  y, z is not complete`; the frontier explanation's `x awaits y, z`) — no
  project, no state, and no way to tell "never started" from "running in
  another member project's execution root this machine cannot see" from
  "reference/run-state unreadable".
- The projection's `IssueNodeStatus.blockedBy` is the plan-read's ARCHIVE-based
  list (store query `module.ts`: dependencies whose `readiness !== 'finalized'`,
  i.e. not archived-with-outcome), while `start` gates on completed WORK.
  binding.ts's D3 header documents the split deliberately — but on the read
  surface the word "blockedBy" therefore names dependencies whose work is
  already terminal, and in a two-project plan the operator cannot see which
  member project a wait is on.

g-001 just landed per-node `projectId`/`targetLineId` on `IssueNodeStatus`
(ship `1049453b`) — the project fact the enrichments below compose from.

Constraints: manual selection only, no auto-routing; `packages/ui/**` and
`src/core/pipeline-registry/` frozen; one projection seam; no version bumps;
CLI three-way sync only where a CLI surface changes.

## Goals / Non-Goals

**Goals:**

- Start refusals name every non-terminal dependency with node id, target
  project, and observed state — distinguishing no-local-run-state, unknown
  (with diagnostic), and genuinely-not-started — in both the `--node` refusal
  and the frontier explanation.
- The read surface's per-node dependency facts follow the one work-complete
  rule start enforces, each blocker carrying target project and observed
  state, human and `--json`.
- Cross-project gate behavior pinned by tests: gated while the upstream is
  non-terminal in the other project; released when its WORK is terminal
  (archive not required); fail-closed on unknown.
- Honest degradation: no schema, revision-byte, or digest change; a
  Phase-2-era revision reads with identical axes.
- Temp-store dogfood receipts for the whole story; persistent store
  untouched.

**Non-Goals:**

- Rebuilding the gate (it exists; this change names what it refuses on).
- Cross-project parallelism, re-planning, dependency re-shaping at runtime —
  roadmap Phase 5; the plan's edges stay as published (revising them is a new
  revision, existing discipline).
- Activating the reserved `blocked`/`stale` health values — dependency
  ordering among not-yet-started nodes is spec-pinned `healthy`; an edge wait
  is ordinary ordering, not a recorded blockage signal.
- Changing the store query's archive-based `readiness`/`readyToResolve`
  (archive truth for acceptance stays archive-based), or any publication
  behavior (g-001's planning-member gate already governs targets).
- Structured refusal payloads in the CLI's `--json` error shape — every
  `start` refusal surfaces as message + code + fix today; the enriched facts
  live in the message both forms carry. Re-shaping the failure envelope is a
  separate concern with fleet-wide blast radius.

## Decisions

### D1 — Extend the naming, not the rule

`workComplete`, `isRunnable`, and the frontier stay byte-identical in
behavior. g-002's `start`-side change is composition: the blocker refusal and
the frontier "awaits" reasons render each dependency from the projection facts
the resolver already holds (`input.status.nodes` now carries `projectId` and
`observation` per node, g-001). Per blocker: `<nodeId>@<project> (<state>)`
where state is the observation, with two honest refinements — a `not-started`
node whose `locatedBy` is null reads `not-started, no local run-state`, and an
`unknown` node reads `unknown (<diagnostic>)`. The refusal taxonomy
(`issue_start_node_not_runnable` etc.) is unchanged: same conditions, richer
naming — the discipline the taxonomy already states ("every refusal names
what it refused on").

### D2 — The projection's displayed dependency facts switch to the work-complete basis, structured

`IssueNodeStatus.blockedBy` widens from `readonly string[]` to a structured
entry — `{ nodeId, projectId, observation }` — and its membership switches
from the plan-read's not-finalized list to the SAME work-complete rule `start`
enforces: a post-pass over the statuses the projection already built filters
each node's `dependsOn` by the blocker's observation (not workComplete ⇒
listed). The store query's own `blockedBy`/`readiness` stays archive-based and
untouched — it still feeds `readyToResolve`, where archive truth is the right
truth.

Why switch the displayed basis rather than annotate the archive-based list:
annotating would keep the word "blockedBy" naming dependencies whose work is
done — a label that lies about gating precisely when the operator most needs
the truth (work finished, archive pending, downstream startable). One rule,
stated once, on both surfaces the operator reads. The dependency's own line
still reports its archive state via its observation (`finalized` vs
`run-terminal`), so the archive view loses nothing.

Render: `(blockedBy y@elftia: in-flight, z@site: not-started, no local
run-state)` — same segment position as today's `(blockedBy y, z)`, entries
enriched. `--json` carries the structured array. Alternatives rejected:
changing the query's basis (wrong truth for `readyToResolve`, wider blast
radius into the store family); a second parallel `blockers` field beside
`blockedBy` (two lists, near-same meaning — the second-truth disease).

### D3 — The gate's cross-project release and fail-close are pinned, not changed

Two behaviors get first-class tests because they are the cross-project
promises, previously only implied: (i) a dependency in another member project
with terminal run-state and NO archive releases the downstream (the gate
waits for work, not archiving); (ii) a dependency whose reference does not
resolve or whose run-state cannot be parsed gates its downstream (fail-closed)
and is NAMED with its project and diagnostic rather than guessed. Intent-node
dependencies keep their existing semantics: no Change exists, the observation
reads not-started, the gate holds — now named with the intent node's target
project.

### D4 — Health stays untouched, by spec

`issue-status-projection` pins "ordinary dependency ordering among
not-yet-started nodes SHALL be reported as `healthy`" and reserves
`blocked`/`stale` for a capability that records a real blockage signal. A
cross-project edge wait is ordinary ordering (the multi-project form of the
existing "Serial ordering is healthy" scenario); inventing a blockage signal
here would fabricate health. The projection delta restates the fact for the
cross-project shape as a scenario, not a rule change.

### D5 — Degradation

No revision bytes change, no digest changes, no publication rule changes; the
projection's axes (phase/health/progress) never read dependency facts. What
changes is the shape of the node line's dependency segment — the same display
evolution g-001 made when node lines gained the project segment — and the
membership of the displayed blocker list, which changes ONLY for dependencies
whose work is terminal but not archived (they stop being listed as blockers).
Suites asserting the bare-id `(blockedBy x)` line shape update with the
render; a Phase-2-era revision receipt pins axes identity across the change.

## Risks / Trade-offs

- [Displayed basis diverges from the query's readiness basis] → Intentional
  and now stated in two places: the query answers "is everything ARCHIVED"
  (`readyToResolve`, acceptance-oriented), the node line answers "what will a
  launch wait for" (work-complete, gating-oriented). The design names both so
  a future reader does not "fix" one into the other.
- [`blockedBy` type widening breaks a consumer] → Enumerated consumers:
  `renderStatusNode`, the binding resolver (does not read `blockedBy` — it
  re-derives from `dependsOn` + observations, D3 of Phase 2), tests. The
  store query keeps its own `string[]` field; `packages/ui` renders no Issue
  nodes today (frozen and unaffected).
- [No-local-run-state wording misread as an error] → It is stated as a fact
  with the visibility vocabulary the projection already uses; absence is not
  presented as failure and does not change health.
- [Fixture shows a same-project plan only, enrichment reads as noise] →
  Dogfood and tests include the two-project shape; the single-project display
  shows the same project on every entry, consistent with g-001's node lines.
- [Windows path/locale pitfalls in new render text] → Entries carry ids and
  observation vocabulary only; no new locale keys exist to miss.

## Migration Plan

Additive behavior with one display-shape change: no data migration, no schema
movement, rollback is reverting the commit. Render-asserting suites update in
the same commit (self-contained). The persistent store needs nothing — reads
of its Issue #1 revision derive identical axes; its node lines gain the
enriched dependency segment only where a blocker stands.

## Open Questions

- None blocking. g-003 decides how grouped views summarize dependency waits
  per project (the structured blocker facts here are its input); whether the
  CLI's `--json` failure envelope should ever carry structured refusal
  payloads is a fleet-wide question this change deliberately does not open.
