## Why

Phase 3's multi-project plans make a dependency edge the first fact that
crosses member projects — and the gate that honors it already does so
project-blind: `store issue start` has refused a fresh launch while any
`dependsOn`'s observed work is non-terminal since Phase 2, edge-wise and
fail-closed on `unknown`. What the cross-project era breaks is the
EXPLANATION: a start refusal names bare node ids ("the work of X, Y is not
complete") without the project each blocker runs in or the state it is in, and
the read surface's `blockedBy` names dependencies that are not yet ARCHIVED —
a different rule than the one start enforces — so `show` can call a node
blocked by a dependency whose work is already terminal, and nothing tells the
operator which member project's work is pending or whether "not-started"
means never-started or no-run-state-visible-from-this-machine.

## What Changes

- **The start refusal becomes project-aware and state-aware.** Both the
  `--node` fresh-launch refusal and the derived-frontier "no node is runnable"
  explanation name every non-terminal dependency with its node id, its target
  project, and its current observed state — and distinguish a dependency no
  local run-state explains (`not-started, no local run-state`) from one
  observed not-started, and a dependency whose reference or run-state read
  failed (`unknown`, with its diagnostic). The GATE itself is not rebuilt: it
  stays edge-wise, project-blind, and fail-closed — a cross-project dependency
  gates exactly as a same-project one does, and releases on completed WORK
  (terminal run-state or finalized evidence), not on archiving.
- **The read surface's dependency facts follow the one rule start enforces.**
  A node line's blocker list switches from the archive-based "not finalized"
  basis to the work-complete basis the frontier computes on, and each entry
  carries the dependency's target project and observed state — so `show`
  explains exactly what `start` will refuse, a dependency whose work is
  terminal no longer reads as a blocker before its Change is archived, and a
  cross-project blocker names which member project the wait is on. The
  `--json` form carries the same structured dependency facts per node.
- **Honest degradation.** No schema field, no revision-byte or digest change,
  no new publication rule: a Phase-2-era revision reads with its digest
  verifying and its phase, health, and progress identical — a dependency
  listed as a blocker before now carries its project and state beside it, and
  one whose work was already terminal stops reading as a blocker. Dependency
  ordering among not-yet-started nodes stays `healthy` health — the `blocked`
  and `stale` health values remain reserved, because an edge wait is ordinary
  ordering, not a recorded blockage signal.

Non-goals: automatic routing (manual selection only, roadmap §5), any UI,
cross-project PARALLELISM and re-planning (roadmap Phase 5), activating the
reserved health values, changing the store query's archive-based readiness
(it still feeds `readyToResolve`), and any change to publication (g-001's
planning-member gate already keeps knowledge-only targets out of new plans).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `issue-execution-binding`: the start requirement names the cross-project
  shape of dependency gating — the gate is edge-wise and identical across
  projects; refusals name each blocker's node, target project, and observed
  state, distinguishing no-local-run-state and unknown; work-complete
  releases the gate cross-project.
- `issue-status-projection`: the read-surface requirement's node lines carry
  dependency facts on the work-complete basis, each blocker with its target
  project and observed state, in human and `--json` forms.

## Impact

- `src/core/issue-execution/binding.ts` — blocker naming in the fresh-launch
  refusal and the frontier explanation composes project + observation from
  the projection facts the resolver already holds; the runnable/work-complete
  rules themselves unchanged.
- `src/core/issue-status/types.ts` + `projection.ts` — `IssueNodeStatus`
  gains a structured blocker fact (`nodeId`, `projectId`, `observation`),
  derived in the projection post-pass from the statuses it already built (the
  one projection seam; the store query's own `blockedBy`/readiness stays
  archive-based and untouched); `src/commands/store-issue.ts` — the node
  line's `(blockedBy …)` segment renders the structured facts.
- Tests: binding (cross-project refusal naming, release on work-complete,
  unknown fail-closed with diagnostic), projection (structured blockers,
  work basis, run-terminal-but-unarchived drops off), CLI show/start
  rendering (dist built first), degradation over a Phase-2-era revision.
  Existing suites asserting the bare-id `(blockedBy X)` line shape update
  with the render (same discipline as g-001's node-line format change).
- Dogfood on temp stores only (persistent `issue-registry` untouched —
  Issue #2 stays g-003's): a two-planning-member plan with a cross-project
  edge — refusal while the upstream is in-flight, release when its work is
  terminal, show naming the cross-project blocker, and the no-local-run-state
  labeling.
- No new command, option, locale key, or completion entry — the
  commander/locale/completions three-way sync does not apply. No UI, no
  version bump; `src/core/pipeline-registry/` and `packages/ui/**` frozen.
