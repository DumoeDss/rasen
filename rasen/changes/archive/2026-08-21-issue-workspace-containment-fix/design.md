# Design: issue-workspace-containment-fix

## Context

The workspace-pair planner contains two preconditions that contradict for one input. `planSide`
(`src/core/store/workspace/plan.ts:262-279`) reports `execution-is-linked-worktree` SATISFIED when
the requested execution root is the project repository's main checkout ("a pair may legitimately
use for execution"). The later containment loop (`plan.ts:582-603`) computes
`isContainedIn(repositoryRoot, root, flavor)` for `${side}-root-outside-repository`, and
`isContainedIn` (`identity.ts:60-69`) counts path equality as inside (`relative.length === 0`).
For `--execution-worktree <main checkout>` the two conditions are the same path, so the plan
reports the input blessed and vetoed simultaneously; `applicable` stays false and `workspace
apply` refuses. Verbatim receipts:
`rasen/changes/archive/2026-08-20-issue-cross-project-execution/evidence/close-workspace-pair-refusal.json`
and `close-workspace-pair-note.txt`.

The rationale behind the containment veto — a worktree nested inside its repository's checkout
shows up there as untracked content, breaking the leave-the-checkout-alone promise, and cleanup
would have to reach inside it — is about STRICT nesting. Equality is not nesting: the main
checkout is the checkout; the pair reuses it (disposition `reuse`), creates no worktree inside it,
and the only write apply makes there is the execution association document (this Module's own run
state, never committed).

How the contradiction shipped: `test/core/store/workspace-plan.test.ts:425-434` asserts the
blessing precondition (`execution-is-linked-worktree.satisfied === true`) but never asserts
whole-plan applicability — the sibling veto was invisible to the suite (the partial-surface blind
spot).

Survey of adjacent machinery (no changes needed there, recorded to bound the blast radius):

- `apply.ts` has no independent outside-repository veto. Its write guard
  (`writeBindingDocument`, `apply.ts:446-472`) checks the destination is strictly inside its
  planned root — the association path (`<root>/.rasen/planning-binding.json`) always is. Reuse
  sides are never `addWorktree`-ed (`apply.ts:345-369`).
- `cleanup.ts` has its own main-checkout guard (`${side}-2-linked-worktree`, `cleanup.ts:310-320`)
  and cleanup is all-or-nothing (`cleanup.ts:230-233`): a pair bound with a main-checkout
  execution root cannot be torn down through `workspace cleanup`. Accepted consequence, see
  Trade-offs.
- Other `isContainedIn` callers NEED equality-as-inside: workspace discovery from a start path
  (`module.ts:113`, `scope.ts:135` — standing in the root must find the workspace) and
  `pair-roots-disjoint` (`plan.ts:605-607` — two sides sharing one root must be refused).
- `codeRepositoryRoot` for an explicit `--execution-worktree` is derived from that worktree's own
  repository (`executionRepositoryFor`, `plan.ts:436-446`), so for the main checkout the loop's
  `repositoryRoot` and `root` are the same physical directory, possibly differently spelled.

## Goals / Non-Goals

**Goals:**

- The previously-refused plan shape — main checkout as `--execution-worktree` — reports
  `applicable: true` with every precondition satisfied.
- The strictly-nested refusal (either side) is bit-for-bit unchanged: same blocker id, code, and
  detail.
- The planning side's equality veto stays (the Store integration checkout remains doubly guarded:
  `planning-is-linked-worktree` + `planning-root-outside-repository`).
- The binding spec's apply-side "untouched checkout" clause stops contradicting the blessed shape.
- The test blind spot is closed: the main-checkout test asserts whole-plan applicability.
- Dogfood receipts on a temp store/project pair for both directions.

**Non-Goals:**

- No change to `isContainedIn`'s semantics or to `identity.ts` exports.
- No change to apply, cleanup, locking, registry, resolver, or CLI flags/surface.
- No change to the default destination shape (main-checkout reuse remains an explicit opt-in via
  `--execution-worktree`).
- No pair-teardown path for main-checkout pairs (recorded as a portfolio follow-up candidate, not
  widened into this child).
- No UI, no version bumps, `src/core/pipeline-registry/` untouched (frozen for this child; the
  thaw is g-002's business).

## Decisions

### D1. Fix at the precondition call site, not in the shared helper

The exemption lives in the `${side}-root-outside-repository` loop in `plan.ts`, expressed as:
veto iff `isContainedIn(repositoryRoot, root)` AND NOT (execution side AND the side-planner
blessed main-checkout reuse AND `samePath(root, repositoryRoot)`).

Alternatives considered:

- **Make `isContainedIn` strict (equality ≠ inside) and adjust callers** — wrong direction:
  discovery (`module.ts:113`, `scope.ts:135`) and `pair-roots-disjoint` need equality-as-inside;
  this would widen the diff to four call sites and invert two guards. Violates the one-case fence.
- **Export a new `isStrictlyContainedIn` from `identity.ts`** — grows the shared module surface
  for exactly one caller; the inline `samePath` exemption plus a comment is the narrower honest
  expression. Revisit if a second strict-containment site ever appears.

### D2. Key the exemption to the side-planner's blessing, not to bare equality

The exemption condition is `side === 'execution' && executionSide.facts.linked === false &&
samePath(root, repositoryRoot, flavor)`. `facts.linked === false` is the surveyed fact "this root
is its repository's main checkout" — the same fact `planSide`'s blessing is keyed on
(`plan.ts:262-279` pushes the satisfied `execution-is-linked-worktree` exactly there). In every
reachable state the three conditions co-occur (a root equal to its repository root that reaches
the reuse path IS the main checkout), so keying to the blessing is not behaviorally narrower — it
keeps the two preconditions reading as one design and fails closed (back to the veto) if the
blessing logic ever changes. `samePath` (not literal equality) so Windows case aliases,
trailing separators, and short-name spellings of the main checkout hit the exemption.

### D3. Planning side keeps the equality veto

For `--planning-worktree <store checkout>` the plan is already refused by
`planning-is-linked-worktree` (satisfied: `input.side === 'execution'` is false there). Leaving
the containment veto in place for the planning side keeps the integration-checkout refusal
doubly guarded and the satisfied-detail text truthful (the planning loop never has to say
"outside" about a path equal to the checkout). One case means one case: only the execution side
changes.

### D4. Satisfied-detail mirrors the blessing sentence

The blessed case's satisfied precondition reads: "`<root>` is the execution repository's main
checkout, which a pair may legitimately use for execution." — the same sentence `planSide` emits
for `execution-is-linked-worktree`. The vetoed (strictly-inside) and plain-outside details are
unchanged byte-for-byte.

### D5. Plan bytes for every existing green path are unchanged

Preconditions are part of the plan-body digest (`plan.ts:794`), and the spec pins token values for
exact inputs ("Equal inputs produce an identical plan"). The loop's output for the outside and
strictly-inside cases must stay byte-identical (same ids, details, field layout); only the
previously-blocked equality case changes shape (blocker → satisfied). The pinned-digest tests
enforce this; do not reformat the loop's strings while in there.

## Risks / Trade-offs

- [An operator relied on the refusal to keep the main checkout pristine] → The only write apply
  makes into a blessed main checkout is the execution association document — this Module's own
  run state under `.rasen/`, never committed; the sibling precondition has promised exactly this
  shape since the capability shipped. The receipts document that the refusal was the defect.
- [The exemption accidentally covers a strictly-inside path] → `samePath` equality is exact on
  canonicalized, flavor-case-folded paths; a strictly-inside path fails it and keeps the veto. The
  existing `nested-execution` refusal test must keep passing UNCHANGED as the no-regression guard.
- [An aliased spelling of the main checkout misses the exemption] → `samePath` canonicalizes
  (drive-letter case, junctions, separators — `identity.ts:39-53`); the delta spec pins the
  Windows alias scenario.
- [A main-checkout pair cannot be cleaned up (`workspace cleanup` refuses, all-or-nothing)] →
  Accepted, by design: cleanup never removes a main checkout. Recorded as a portfolio follow-up
  candidate (ledger item for g-002/g-003 planning context); this child does not touch cleanup.
- [Spec wording drift at archive] → The delta copies both requirement blocks in full; existing
  scenario titles are unchanged (titles are identity labels); the archive-time sync applies the
  scoped clause and the two new scenarios.

## Migration Plan

None. The change is plan-time precondition semantics; no stored state, on-disk format, or CLI
surface changes. Previously-saved inapplicable plans for the main-checkout shape simply re-plan
to applicable ones.

## Open Questions

None blocking. Follow-up candidates recorded for the portfolio ledger (NOT this child): the
teardown path for main-checkout-bound pairs; whether `describe`/show aggregation over such a pair
needs any read-side accommodation (Phase 3 receipts suggest it works as designed).
