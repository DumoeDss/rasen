# Proposal — issue-unified-review-gate

## Why

Phase 6's review moment — "the Changes are done; review the Issue" — still makes the operator
assemble the picture by hand. `store issue show` now prints the facts (status nodes and lanes,
the acceptance gate, the delivery evidence g-001 rolled up), but the Issue-level CONCLUSION is
nowhere: is this Issue review-ready? What still stands between it and a sound accept? What is
merely still moving (an unarchived terminal node, an in-flight optional node, a recorded
missing evidence name) as opposed to actually blocking? The roadmap's §10 exit criterion names
this directly: 统一 Review 视图——跨项目 Changes 的验证状态并置 + Issue 级结论. Every input the
conclusion needs is already derived on the one show read — the gate evaluation, the projection's
observations and problems, the delivery counts, the attention vocabulary — so this is a
composition over derived facts, not a new truth: no re-derived rule, no second blocking basis,
no verdict the store cannot honestly stand behind.

## What Changes

- A review-readiness derivation per Issue, pure over the same status the show read derived
  (the delivery-rollup signature precedent — plain strings beside status):
  `deriveIssueReview(issueId, revisionId, status)` composes, from that one status, the delivery
  rollup and the attention items it already subsume, and produces the Issue-level review view.
- A machine-checkable determination in a closed vocabulary, mapped from the acceptance gate's
  own evaluation — the ONE blocking basis, never re-derived: `review-ready` (the gate holds;
  names the conditions revision it would accept), `accepted` (a verified record stands; the
  review concluded), `not-ready` (the gate's named blockers stand), `conditions-missing`,
  `no-plan`, `dropped`, and `acceptance-unknown` when the read supplied no acceptance facts.
  No delivery-evidence state, lifecycle, or open thread changes the determination the gate's
  evaluation maps to.
- An open-threads inventory of the facts the gate deliberately excludes but a reviewer must
  see, each a named kind carrying its node where it names one: `optional-open` (a wanted
  optional node not terminal), `archive-pending` (a terminal node whose Change is not yet
  archived — expected progress, never damage), `record-absent` (an archived entry with no
  record), `evidence-missing` (the missing-evidence names records froze), and the
  attention-derived `failure` / `blocked-behind` / `waiting-human` threads. Threads never
  block: an Issue can be review-ready with threads standing.
- A verification summary that juxtaposes the cross-project picture by reference:
  the required-work pair (`status.progress`) and the five-state delivery counts — no
  re-listing, no re-derivation.
- `rasen store issue show` renders a `review:` section as the concluding section (after the
  delivery evidence), with the determination, the threads, the summary, and the closing
  statement that review derives and accepting remains the operator's act; `--json` carries the
  same facts under a `review` key beside `status` and `delivery`. `list` stays compact.
  Nothing writes.
- Dogfood: the four closed Issues of `issue-registry` (read-only receipts) all read
  `accepted` with their threads standing (per-record `evidence-missing`, the three
  run-terminal `archive-pending` rows) — the retrospective review view. The determination
  matrix (ready-with-threads, not-ready, conditions-missing, no-plan, dropped,
  acceptance-unknown) is covered on temp stores and unit fixtures.

## Capabilities

### New Capabilities

- `issue-unified-review`: the Issue-level review view — a review-readiness determination
  (closed vocabulary mapped from the acceptance gate's evaluation, machine-checkable), an
  open-threads inventory of the gate's deliberate exclusions, and a verification summary over
  the delivery counts, composed from the status projection's own facts on the show read, in
  human and `--json` parity.

### Modified Capabilities

(none — the attention precedent again: the gate is consumed, not changed; g-001's delivery
surface is untouched; the projection spec states minimums and gains nothing. The review
section is additive on a show surface whose requirements mandate content, not order.)

## Impact

- `src/core/issue-status/review.ts` (new) — `deriveIssueReview`, consuming
  `deriveIssueDeliveryEvidence` and `deriveIssueAttention` over the one status input.
- `src/core/issue-status/types.ts` — `IssueReviewDetermination`, `IssueReviewThread`,
  `IssueReview` shapes; module index export.
- `src/commands/store-issue.ts` — the `review:` section renderer, the `--json` `review`
  payload key, the closing statement.
- Tests: `test/core/issue-status/issue-unified-review.test.ts` (determination matrix,
  gate-aligned no-second-basis, threads-never-block, attention mapping, purity) and CLI
  parity/write-nothing coverage extending the delivery suites' fixture recipes.
- Frozen untouched: `src/core/pipeline-registry/`, `packages/ui/**`, the registry; no new CLI
  command, option, or flag (no completions/locale churn); no version changes.
