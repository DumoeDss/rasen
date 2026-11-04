# Tasks — issue-deferral-record

## 1. Vocabulary and store shapes

- [x] 1.1 Widen `ExecutionPlanNodeLifecycle` to include `'deferred'` in
  `src/core/store/issues/types.ts`; update the vocabulary, `reason`, and intent-node doc
  comments (Change-node-only family is now cancelled/superseded/deferred; meaning:
  postponed, not abandoned); widen `AcceptanceRecordExclusion.lifecycle` to the three-value
  union.
- [x] 1.2 In `src/core/store/issues/plans.ts`: add `'deferred'` to `NODE_LIFECYCLES`; extend
  the reason conditional so `deferred` requires a recorded reason (portable-checked exactly
  as cancelled/superseded); reword the dangling-reason refusal to "work the plan does not
  demand toward Done" (the no-longer-wants phrasing is false for deferred); extend the
  intent-node refusal so `deferred` on an intent node is refused naming that intent work is
  postponed by keeping it `optional` or omitting the node.
- [x] 1.3 Unit-pin the schema edges: deferred publishes and reads back with its reason
  verbatim; deferred without reason refused; deferred on intent node refused; reason on
  wanted work still refused; a four-value revision published before `deferred` existed
  re-derives its digest byte-for-byte; canonical form stores `deferred` (only `required`
  is omitted).
- [x] 1.4 In `src/core/store/issues/acceptance.ts`: add `'deferred'` to
  `RecordExclusionSchema`'s lifecycle enum; unit-pin a record carrying a deferred exclusion
  round-trips (serialize → digest → read-back verbatim), the absent-when-none form and a
  pre-field record's bytes/digest are untouched, and the duplicate-node refusal covers the
  widened union.

## 2. The acceptance gate and its record

- [x] 2.1 In `src/core/issue-acceptance/gate.ts`: route `deferred` into
  `lifecycleAccounting`'s exclusions (with its recorded reason); add `deferred` to the
  failing-node skip so a deferred node's recorded failure is never a `failing-node` blocker;
  widen `IssueAcceptanceGateExclusion.lifecycle` in `src/core/issue-acceptance/types.ts`.
  Do NOT add a refusal code: the refusal ORDER (dropped → already_accepted → requires_plan →
  conditions_required → blocked) must stay byte-identical (g-002 finding: order shadows).
- [x] 2.2 Unit-pin the gate: an incomplete deferred node holds nothing (gate eligible over
  required alone, exclusion named with `deferred` + reason on the eligible branch); the same
  exclusion rides a blocked evaluation; a deferred node's failure produces no blocker while
  a wanted node's still does; a plan whose Change nodes are all optional/cancelled/
  superseded/deferred reports eligible at 0/0 with exclusions and optional nodes named;
  refusal-code order unchanged.
- [x] 2.3 Accept-path pin (store mutation seam): accepting over a plan with a standing
  deferral freezes the exclusion (node, `deferred`, reason) into `accepted.yaml` inside the
  digest-covered canonical form; accepting with no exclusions still writes the absent form.

## 3. Named exits where fall-through would lie

- [x] 3.1 In `src/core/issue-status/types.ts` + `ready-set.ts`: add the
  `{ kind: 'deferred', reason }` exit to `IssueReadyExit`; check it in `exitReasonFor`
  beside cancelled/superseded (before the observation switch); update the `isWanted` doc
  comments here and in `projection.ts` / `attention.ts` / `issue-execution/confirm.ts`
  (comment-only — the positive checks themselves do not change).
- [x] 3.2 In `src/core/issue-execution/types.ts` + `binding.ts`: add
  `issue_start_node_deferred`; refuse an addressed deferred node before any launch
  machinery, naming the node, lifecycle, and recorded reason; add the code to the
  lifecycle-refusal fix text (re-publish a revision whose lifecycle wants it); include
  deferred in the not-runnable reasons enumeration beside cancelled/superseded.
- [x] 3.3 In `src/commands/store-issue.ts`: add the `deferred` case to `renderReadyExit`
  (`deferred (<reason>)`); verify by test that `renderStatusNode` and `renderGateLine`
  render deferred nodes/exclusions with zero edits (generic paths).
- [x] 3.4 Unit-pin: a not-started unblocked deferred node is no member and exits `deferred`
  with its reason (never `blocked` with zero blockers); a dependent of a deferred node
  exits `blocked` naming the deferred dependency; `--node` on a deferred node refuses with
  the new code and emits no contract; the frontier and a several-candidates refusal never
  name a deferred node; confirm's launchable scope excludes it.

## 4. Family discipline pins (surfaces with zero logic change)

- [x] 4.1 Projection pins: a deferred in-flight node drives no phase (required-terminal
  Issue still reads `review`); a deferred node's failure escalation drives no health while
  a wanted node's still does; deferred completion counts in no progress pair and no lane;
  the node line carries `(deferred: <reason>)`; the revision delta reports
  `required → deferred` / `optional → deferred` lifecycle changes; publishing the deferring
  revision leaves every observation identical (history preservation).
- [x] 4.2 Attention pin: a deferred node observing failed/waiting-human raises no attention
  item; a wanted node blocked behind a deferred dependency still raises `blocked-behind`
  naming it.
- [x] 4.3 Review-seam pins (g-002 findings, no `review.ts` edit): deferring a previously
  optional non-terminal node dissolves its `optional-open` thread; no thread kind presents
  the deferral; the determination is byte-identical before/after a deferral stands
  (review-ready stays review-ready — no second blocking basis); the accepted-with-null-facts
  pin still passes untouched.

## 5. CLI byte coverage (temp store, real CLI)

- [x] 5.1 Rebuild first (`pnpm run build`; confirm dist freshness — stale dist has produced
  phantom CLI reds), then on a hermetic temp v2 store (redirected HOME/XDG + git identity,
  fixtures under `.rasen/`, deleted when done; seed node identities via
  `deriveChangeInstanceId` — one alias, one instance): publish revision 1 with one required
  and one optional node; publish revision 2 deferring the optional node with a reason;
  assert `show` renders the node line, the delta's lifecycle change, and the gate exclusion;
  `ready` exits the node as deferred; `start --node` refuses with the new code; complete the
  required work, `accept`, and assert `accepted.yaml` freezes the deferral; assert `--json`
  parity for every surface touched.
- [x] 5.2 Write-nothing + refusal bytes: a `show`/`ready` read over the deferral changes no
  store byte; publishing deferred-without-reason and deferred-on-intent refuses with nothing
  written.

## 6. Dogfood receipts (persistent store, READ-ONLY)

- [x] 6.1 On `issue-registry` (READ-ONLY — no write, no state transition; the Issue #5
  close choreography belongs to the portfolio close, not to this change): capture `store
  issue show` + `--json` for Issue #5 and one earlier done Issue on the new build — every
  pre-deferral byte must read back unchanged (records parse, no invented exclusions,
  determinations and threads identical to the g-002 receipts). Any surprise is a finding,
  not a fixture to adjust. Receipts into `evidence/`.
  (Executed as a superset: `issue-registry` holds exactly four Issues, all `done` — "Issue
  #5" is this portfolio's own Issue and does not exist yet, its creation and close being the
  LEAD's portfolio-close action. All four existing Issues were captured read-only instead.
  See `evidence/dogfood-receipts-summary.md`.)
- [x] 6.2 Run the full unit + CLI suites for the touched areas and
  `node bin/rasen.js validate issue-deferral-record` — green before ship.
