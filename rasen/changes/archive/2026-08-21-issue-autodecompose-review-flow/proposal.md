# Proposal: issue-autodecompose-review-flow

## Why

g-002 landed the reviewable half of the dispatch: a decomposition publishes as intent-node
revisions carrying target projects, edges, suggested pipelines, and rationale (Issue
`issue-autodecompose-uplift` now sits at revision 0002, `planning` phase, on the persistent
store). The human half is missing: the operator cannot yet see what a revision CHANGED, cannot
mark proposed work required/optional before a Change exists (the decomposition document is the
sole lifecycle record — a g-002 review finding deliberately deferred here), `store issue start`
ignores the node's recorded suggestion when no `--pipeline` is given, authored node input
silently drops unrecognized fields instead of refusing them by name, and there is no confirm
step that composes the launch contracts for a reviewed plan. Roadmap Phase 4 closes only when
the loop is whole: review → revise → confirm → start.

## What Changes

Five accumulated handoffs, each decided:

1. **Required/optional moves onto the intent node** (g-002 review Minor-1): intent nodes MAY
   carry `required` or `optional` (absent reads `required`, canonical omission unchanged);
   `cancelled`/`superseded` stay Change-node-only — unwanted intent work is expressed by
   dropping the node from the next revision, because nothing exists to keep history of. The
   decomposition publication compiles the authored lifecycle onto the intent node, amending
   g-002's "the document alone" wording: the document stays a byte-identical input, but the
   REVISION becomes the durable record — the review surface, not a sidecar, carries the
   required/optional proposal. Nothing to copy at confirm.
2. **The launch contract adopts the recorded suggestion** (g-002 Finding 1): for a fresh node,
   the contract's pipeline resolves `--pipeline` over the run-state recording over the node's
   `suggestedPipeline` over none; manual selection still wins without refusal, the running-node
   disagreement refusal is unchanged, and the contract names which source supplied the pipeline.
3. **Authored input refuses unknown fields by name** (g-002 Finding 3): the authored-node
   boundary (`planNodeCandidate` and the schemas behind it) stops silently vanishing
   unrecognized fields — a misspelled key is refused naming the field and the node, on both the
   throwing publication path and the reporting problems path. Authored strictness now matches
   the stored-record strictness.
4. **The foreign-repo main-checkout keying stays as-is** (g-001 item 7): this change never
   touches the workspace containment site — the confirm flow composes contracts from the
   existing launch-context seam and adds no new path by which a foreign-repo execution root
   enters the index. Tightening remains a portfolio follow-up beside g-001's cleanup asymmetry,
   for a child that actually modifies the pair-planning surface.
5. **Merge/split needs no new vocabulary** (g-002 handoff): a merge or split IS the next
   revision — authored wholesale through the existing publication channels, with nodeId
   continuity (a merged node may keep a constituent's id; a split mints new ids and re-edges
   dependents). What is new is VISIBILITY: `store issue show` reports the node-level delta of
   the latest revision against its `supersedes` predecessor — added nodes, removed nodes,
   retargeted, re-edged, lifecycle-changed, suggestion-changed — derived on read, persisted
   nowhere, both forms.

And the confirm step itself: **`rasen store issue confirm <issue-id>`** — a read-compose-report
verb that resolves the revision (default the latest readable), verifies every Change node's
instance against committed Store evidence, composes the launch contract for every launchable
frontier node under the same binding rules `start` applies (suggestion-aware after change 2),
reports intent nodes as pending Change creation — named, with target project, line, and
suggestion — and writes NOTHING. No persisted confirmation record and no start gate: the five
declared mutations stay five, the revisions themselves plus run-state attribution carry the
plan-to-execution history, and a pinned confirmation anchor is Phase 5's design work when
deterministic replanning actually needs one. The LEAD playbook's Issue-dispatch branch gains the
post-confirmation continuation: after the human confirms, the LEAD may drive per-node execution
as the operator's agent through `store issue start` contracts, frontier-gated, manual selection
only.

Dogfood: Issue `issue-autodecompose-uplift` itself — review revision 0002, author revision 0003
exercising the revision vocabulary (binding the landed g-002 child as a Change node from its
archived instance, lifecycle marking, edge adjustment), confirm to launch-ready, capture the
launch contracts and the pending-Change report. The actual pipeline starts are STAGED as
documentation (they are this portfolio's own children); close acts only in evidence.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `store-issue-resources`: intent nodes may carry `required`/`optional` (cancelled/superseded
  remain Change-node-only; omission from the next revision is how unwanted intent work is
  expressed); authored node input rejects unrecognized fields by name rather than dropping them.
- `issue-plan-publication`: the decomposition publication compiles the authored lifecycle onto
  the intent node — the revision, not the document, is the durable record of the
  required/optional proposal.
- `issue-status-projection`: node lines name an intent node's non-required lifecycle; `show`
  reports the node-level delta of the latest revision against its predecessor, both forms,
  driving no axis.
- `issue-execution-binding`: the launch contract's pipeline resolution adopts the node's
  recorded suggestion for fresh nodes (flag > run-state > suggestion); a new confirm requirement
  composes the verified launch-contract set and pending-Change report, writing nothing.
- `opsx-auto-command`: the Issue-dispatch branch continues after human confirmation — the LEAD
  drives per-node execution through launch contracts, frontier-gated, no auto-routing.

## Impact

- Code: `src/core/store/issues/plans.ts` + `types.ts` (intent lifecycle on input + schema +
  canonical omission; unknown-field refusal in `planNodeCandidate`'s two consumers);
  `src/core/issue-publication/` (decomposition compiles lifecycle onto the node);
  `src/core/issue-execution/binding.ts` (suggestion in the fresh-chain precedence; the confirm
  composition over the same per-node resolution); `src/commands/store-issue.ts` (the `confirm`
  verb + report); `src/core/issue-status/projection.ts` (intent lifecycle on node lines; the
  revision delta report); `src/core/templates/workflows/auto.ts` + `_orchestration.ts`
  (post-confirmation continuation, with the hash-pin/dist-rebuild discipline).
- Tests: plans schema/digest suites (intent lifecycle + unknown-field refusals), publication
  (decomposition lifecycle compilation), binding (suggestion precedence + confirm), projection
  (delta report), template parity.
- Specs: five capabilities synced at archive.
- Dogfood: persistent-store Issue `issue-autodecompose-uplift` staging receipts in this change's
  `evidence/` (LEAD-coordinated writes; starts staged as documentation; close acts only in
  evidence).
- Fences honored: `src/core/pipeline-registry/` frozen again for this child (untouched); no UI;
  no version bumps; `packages/ui/**` frozen; manual selection only.
