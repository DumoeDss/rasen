# Proposal: issue-workspace-containment-fix

## Why

A workspace-pair plan offered the project repository's main checkout as the execution side
(`--execution-worktree <main checkout>`) is refused by one precondition while the SAME plan's
sibling precondition explicitly blesses that exact input. `planSide` reports
`execution-is-linked-worktree` satisfied — "the project repository's main checkout, which a pair
may legitimately use for execution" — and the later unconditional containment check
`execution-root-outside-repository` vetoes it, because `isContainedIn` counts path equality as
"inside". Two designed preconditions contradict for one input; `applicable` stays false and the
designed main-checkout shape is unreachable through the command family (verbatim receipts:
`rasen/changes/archive/2026-08-20-issue-cross-project-execution/evidence/close-workspace-pair-refusal.json`,
`close-workspace-pair-note.txt`). The nested-worktree pollution rationale the containment check
exists for — a worktree strictly inside its repository's checkout shows up there as untracked
content — does not apply to equality: the main checkout IS the checkout, nothing is nested in it.

## What Changes

- The `execution-root-outside-repository` plan precondition no longer vetoes the exact case the
  side-planner blessed: an execution root that IS the project repository's main checkout. Equality
  is not nesting. A plan naming the main checkout as `--execution-worktree` becomes
  `applicable: true` and carries a satisfied containment precondition whose detail states the
  blessing.
- The refusal surface the check exists for stays fully intact: an execution (or planning) root
  STRICTLY inside its repository's checkout — a genuinely nested worktree — is still refused with
  the same code and rationale.
- The planning side is untouched: the Store integration checkout remains categorically refused as
  a planning worktree (its own `planning-is-linked-worktree` refusal; equality still vetoes there).
- The binding spec's apply-side write-scope scenario ("Nothing outside the planned roots is
  written") is sharpened: the "checkouts untouched" clause is scoped to checkouts that are not
  themselves a planned root of the pair, and the plan-level containment semantics — main-checkout
  execution applicable, strictly-nested destination refused — are pinned as scenarios.
- The existing test that asserted only the blessing precondition ("permits the project main
  checkout as the execution side") is strengthened to assert whole-plan applicability, closing the
  blind spot that let the contradiction ship.

No new flags, no CLI surface change, no changes to apply, cleanup, identity derivation, or the
shared containment helper's semantics.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `store-planning-worktree-bindings`: the immutable-plan requirement gains the containment
  discrimination — a main-checkout execution root is applicable, a strictly-inside destination is
  refused; the apply requirement's "Nothing outside the planned roots is written" scenario scopes
  its untouched-checkout clause to checkouts that are not themselves a planned root.

## Impact

- Code: `src/core/store/workspace/plan.ts` — the `${side}-root-outside-repository` precondition
  loop (one branch: exempt the blessed execution main-checkout equality case; new satisfied
  detail). `src/core/store/workspace/identity.ts` (`isContainedIn`) is deliberately NOT changed:
  every other caller (workspace discovery from a start path, pair-roots-disjoint, marker checks)
  needs equality to count as inside.
- Tests: `test/core/store/workspace-plan.test.ts` (strengthened main-checkout test; the
  nested-execution refusal test must keep passing unchanged as the no-regression guard).
- Spec: `rasen/specs/store-planning-worktree-bindings/spec.md` synced at archive from the delta.
- Evidence: dogfood receipts on a TEMP store/project pair reproducing both directions
  (previously-refused main-checkout plan now applicable; strictly-nested execution root still
  refused). The persistent `issue-registry` store stays read-only for this change.
- Known consequence carried into design, not widened here: `workspace cleanup` is all-or-nothing
  and never removes a main checkout, so a pair bound this way is torn down outside the cleanup
  verb (the association file is this Module's own run state). No cleanup behavior changes in this
  child.
- Fences honored: no UI (`packages/ui/**` frozen), no version bumps,
  `src/core/pipeline-registry/` untouched (the thaw is g-002's business).
