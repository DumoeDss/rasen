# Design: issue-autodecompose-review-flow

## Context

The dispatch loop's machine half landed in g-002. Its human half has five named gaps, all
verified against the current tree and the live store:

- The authored required/optional proposal of a decomposition lives ONLY in the document (the
  g-002 archive pinned this deliberately: the intent-node schema forbids a lifecycle —
  `store-issue-resources` "an intent node SHALL carry no lifecycle at all" — and left its
  consumption to this flow). Issue `issue-autodecompose-uplift` revision 0002 shows two intent
  nodes with suggestions and rationale but no lifecycle.
- `resolveIssueLaunchBinding`'s pipeline chain (`src/core/issue-execution/binding.ts:437-442`)
  resolves `input.pipeline ?? recorded ?? null` for fresh nodes — `recorded` is the run-state
  pipeline, null for a fresh node, so the node's `suggestedPipeline` is never consulted.
- `planNodeCandidate` (`src/core/store/issues/plans.ts:587-612`) forwards only the fields the
  input declares that the candidate KNOWS; an unrecognized authored field (a misspelled
  `sugesstedPipeline`) never reaches the `.strict()` schemas and vanishes silently — the
  authored-input boundary lacks the strictness the stored-record boundary has.
- The confirm step does not exist: `start` is per-node and refuses intent nodes
  ("a Change must exist for it before it can run", binding.ts:298-303), and nothing composes
  the plan-level launch-ready picture.
- Merge/split have no expression beyond re-authoring a revision, and the read surface shows no
  what-changed view, so a structural revision is not reviewable as a diff.

Adjacent invariants that bound the design: the five declared Issue mutations; revisions
immutable, ordinal, digest-proven; "the binding and its attribution add no second mutable
truth"; intent nodes exist precisely so ownership is declared before any Change exists.

## Goals / Non-Goals

**Goals:**

- Each of the five accumulated handoffs decided and delivered (lifecycle on intent nodes;
  suggestion-aware launch contracts; authored-input strictness; keying assessment closed;
  merge/split expressible and visible).
- A confirm verb that composes the verified launch-contract set and pending-Change report for a
  reviewed revision, writing nothing.
- The playbook continues after human confirmation, frontier-gated.
- Issue #3 dogfood: review → revision 0003 exercising the vocabulary → confirm → receipts.

**Non-Goals:**

- No persisted confirmation record and no start gate (Phase 5 designs the anchor when
  deterministic replanning needs one — recorded as follow-up).
- No Change minting in confirm (minting is the workspace machinery's + propose flow's job;
  confirm reports pending work, the human binds it through existing channels).
- No pipeline-registry changes (frozen for this child); no UI; no version bumps; no
  auto-routing; no change to the five-mutation set (confirm is a read).

## Decisions

### D1. (Minor-1) Required/optional moves onto the intent node; the document stops being a record

Intent nodes admit exactly `required`|`optional` (absent reads required, canonical omission, old
revisions byte-stable — the established digest discipline). `cancelled`/`superseded` stay
Change-node-only: they explain work that EXISTED and is no longer wanted; intent work that is
rejected never existed, and omitting the node from the next revision is its cancellation — the
revision discipline already preserves the proposal in history. The decomposition publication
compiles the authored lifecycle onto the node, amending g-002's "document ALONE" wording (the
g-002 archive explicitly reserved that amendment for this flow). Alternative rejected —
copy-at-confirm: it would make confirm a writer, split the lifecycle's truth across document and
revision until confirm, and leave the review surface (pre-confirm, where marking happens)
unable to show it. Widening the node beats widening the sidecar on every axis the review flow
cares about.

### D2. (Finding 1) The suggestion joins the fresh-launch chain; the operator still owns the choice

Fresh: `--pipeline` > run-state recording > node `suggestedPipeline` > none; the contract names
the source ("suggestion", "operator", "run-state"). Already-running: unchanged, recorded leads,
disagreement refused. A flag beating a suggestion does NOT refuse — manual selection is the
fence, and the node line still shows the suggestion beside the contract's effective pipeline, so
the divergence is visible without being obstructive. This closes the seam `types.ts` words as
"the pipeline to run when one is known": a recorded suggestion is now a way it is known.

### D3. (Finding 3) Authored input refuses unknown fields by name

`planNodeCandidate` gains an extra-keys check against the known field set (per kind): any
authored key outside it is reported as a schema problem naming the node and the field — on the
throwing `parsePlanNode` path and the reporting `findPlanNodeSchemaProblems` path alike, the two
surfaces that already share the candidate and the one `NodeSchema`. The spec symmetry is the
point: stored records already refuse unrecognized fields; authored input now meets the same
rule, so a misspelled key fails loudly instead of publishing a plan silently missing a
suggestion.

### D4. (g-001 item 7) Keying stays as-is; the assessment closes with rationale

This change never touches the workspace containment site: confirm composes contracts through the
EXISTING launch-context seam (`resolveLaunchRoute` → workspace index entry or member-project
checkout), which adds no new path by which a foreign-repo execution root enters the index —
such a root can only get there through an explicit operator-planned pair, the same
operator-chosen risk class the pre-existing blessing already accepted. Tightening would require
the pair planner to verify the execution worktree's repository against the node's target
project — a cross-module check on a surface this child does not modify. Recorded as a portfolio
follow-up beside g-001's cleanup asymmetry, for a child that actually edits the pair-planning
surface.

### D5. (Handoff 5) Merge/split ride the revision discipline; visibility is the delta report

No new node kind, no supersede-on-merge vocabulary: a merge/split IS the next revision, authored
wholesale through the existing channels, with a nodeId-continuity convention (a merged node may
keep one constituent's nodeId so external references survive; a split mints new nodeIds and
re-edges dependents — the author writes the new edges, the DAG checker enforces them). What was
missing is reviewability: `store issue show` derives, on read, the node-level delta of the
latest revision against its `supersedes` predecessor — added / removed / retargeted / re-edged /
lifecycle-changed / suggestion-changed — persisted nowhere, driving no axis, in both forms. A
first revision reports no delta. This makes "what did the human change vs the decomposer's
proposal" a fact of the read surface, which is exactly what the review verb (accept/modify) and
the dogfood receipt need.

### D6. Confirm is a read that composes, not a gate that persists

`rasen store issue confirm <issue-id> [--revision <id>]`: resolve the revision (default latest
readable; unreadable → the same toward-planning refusal start gives); verify every Change node's
instance against committed evidence (the reference-verification seam publication already uses);
compose per-node launch contracts for the launchable frontier (same resolution as start,
suggestion-aware per D2); report intent nodes as pending Change creation with target, line, and
suggestion; write nothing. Alternatives rejected: (a) a persisted `confirmed.yaml` + start gate
— a sixth mutation, a new persisted truth beside "attribution adds no second mutable truth", a
backward-compat gate over plans that never needed confirmation, and a re-confirmation chore;
the plan-to-execution history the roadmap wants tracked is already carried by immutable
revisions + run-state attribution. (b) confirm-mints-Changes — duplicates the propose machinery
and makes a read a multi-repo writer. Phase 5's deterministic scheduler can pin its anchor when
it exists.

### D7. The playbook continues after confirmation; the dogfood stops at launch-ready

The opsx-auto-command Issue-dispatch branch gains the continuation: post-confirm, the LEAD drives
each launchable node through its `store issue start` contract, frontier-gated, never outside the
confirmed revision's wanted work. Dogfood on Issue `issue-autodecompose-uplift` (LEAD-coordinated
store writes): review 0002 → author 0003 through existing channels exercising the vocabulary
(bind the landed g-002 child as a Change node from its archived committed instance — it exists;
lifecycle-mark the remaining intent node; adjust edges; the delta report shows exactly what
changed) → confirm → capture the contract set + pending-Change report → stage (document, do not
execute) the actual starts. Close acts only in evidence.

## Risks / Trade-offs

- [Relaxing intent-lifecycle reopens a closed vocabulary] → The vocabulary stays closed: two
  values for intent nodes, four for Change nodes, refusal naming the kind; the cancelled-intent
  refusal directs to omission, and old revisions are byte-stable (pinned scenario).
- [Suggestion adoption surprises an operator who pinned a different pipeline mentally] → The
  contract names the source; the node line keeps the suggestion visible; the flag overrides
  without refusal (manual selection preserved).
- [Unknown-field strictness breaks existing authored files] → Only fields outside the schema
  change behavior; everything the docs define parses as before; the from-file examples in docs
  are re-checked in tests.
- [Confirm without persistence reads as ceremony] → It is the batch verification + contract set
  the roadmap's "确认后启动" needs today; the persisted anchor is explicitly deferred with
  rationale (D6), not silently missing.
- [Delta report misreads a re-authored revision as wholesale change] → The delta is computed
  node-by-node on stable nodeIds; the nodeId-continuity convention is stated in the playbook and
  docs so merges preserve references.
- [Dogfood touches the persistent store] → Writes are LEAD-coordinated, receipts into evidence,
  starts staged as documentation only, close acts only in evidence.

## Migration Plan

None. No stored format changes (intent lifecycle is an optional omitted-when-absent field;
unknown-field strictness affects only refused inputs); the confirm verb is additive; the
playbook text regenerates with the hash-pin/dist-rebuild discipline. Rollback = revert.

## Open Questions

None blocking. Follow-ups recorded: the Phase-5 pinned-confirmation anchor (D6); the
foreign-repo keying tightening (D4) — both in the portfolio ledger for whoever touches those
surfaces next.
