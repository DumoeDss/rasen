# Step 1 obligation tasks - ecp-linux-process-authority-provider

Date: 2026-08-07
Author: planner (task authoring for Step 1's orphaned obligations), leaf worker. This record
adds tasks and records routing. It changes no tick state, edits no existing task's text, closes
no finding, touches no file under `native/`, and writes no run-state. Files touched: `tasks.md`
(Section 12 appended) and this record.

## Why these tasks exist

Locked decision 11 (Direction Step 1) created obligations that had no task anywhere in this
Change's 93-task ledger, while frozen task 7.7 receipts the opposite lifetime property (a
replacement controller resumes live authority). The gap was surfaced by
`evidence/step1-task-ledger-retier.md` ("What this record does NOT decide", final bullet) and
routed by `handoff/lead-4.md` ("The gap this wave surfaced" and its routing table). The LEAD
dispatched this record's author to write the tasks - explicitly not to implement them.

## What was added: Section 12, tasks 12.1-12.3

- **12.1 - guardian-held inherited-pipe daemon-death teardown (implementation).** Anchored to
  decision 11's exact requirement: EOF on the guardian's inherited pipe tears down the PID
  namespace; explicitly the pipe, not `PR_SET_PDEATHSIG` (fires on thread death; cleared across
  setuid/exec). Same native fault domain as the Section 4-5 construction, per the re-tier
  record's placement recommendation.
- **12.2 - actual-kernel oracle plus the task 7.7 reconciliation.** Per the LEAD's instruction
  the reconciliation lives in the new task's text, not in an edit to 7.7 (already correctly
  marked NARROWS after the earlier report/ledger reconciliation). 12.2 states explicitly that
  it establishes the daemon-death => scope-death property that 7.7's controller-replacement
  half no longer claims, and that 7.7's retained halves (forced-death kernel teardown,
  unrelated-process survival, drift refusal) stand unchanged as taken. The discriminating
  mutation receipt (teardown-disabled mutant leaves a live orphan, oracle RED) follows this
  ledger's own run-and-record mutation convention (Section 7) and the portfolio rule that an
  unmutated guard is assumed non-discriminating.
- **12.3 - re-freeze and re-bind.** lead-4's cost warning ("BREAKS the `087d87a5` freeze and
  costs a re-freeze plus a re-bind of every receipt bound to it") made a schedulable task, so
  the freeze-break cannot be paid invisibly. The task requires full enumeration of receipts
  bound to the superseded digest rather than a guessed list.

Every task in the section carries the freeze cost in its own text, and the section prose frames
all three as one wave, per the dispatch constraint that nobody may schedule the work without
seeing the cost.

## Placement decisions

- **New Section 12 rather than insertions into Sections 4/5:** those sections are ticked,
  evidence-bound rows; a post-freeze wave is a distinct scheduling unit, and the freeze-cost
  framing belongs on the wave as a whole.
- **Task 11.9 interaction, stated rather than hidden:** 11.9 gates local ship on "every ...
  task above"; Section 12 sits below it, so 11.9 does not silently include this wave. That is
  deliberate: the re-tier record routed the teardown work to "THIS Change or its direct
  successor", so whether the wave gates 0.2.0 local ship or lands as the direct successor is a
  LEAD/Direction scheduling decision this record does not make. Under the ledger's legend the
  new tasks are unmarked, i.e. STAYS-0.2.0 obligations, unless Direction re-tiers them.

## Recorded, deliberately NOT added here (executor-owned)

Whoever proposes `ecp-frozen-action-session-executor` (empty at recording time) must not miss
these two obligations. Precise statements:

1. **Typed `execution-lost` plus committed-frontier resume.** On daemon death the scope dies
   with the daemon; the in-flight action MUST be typed `execution-lost` - a distinct typed
   outcome, not generic uncertainty and not a workload failure; the Run resumes only from the
   last committed frontier; there is no reattach and no identity revalidation. Session-host
   cooperation is expected (re-tier record, Disagreements item 5: Run/Record outcome typing
   belongs to the executor with session-host cooperation, not to a provider ledger). ECP-8's
   Linux/Windows receipts include zero-orphan daemon-death teardown AND `execution-lost`
   typing (roadmap OS x backend matrix; closure re-grade rows 9.10/11.17).
2. **The `durable: daemon-lifetime` capability declaration.** Every provider's scope lifetime
   equals the owning daemon's lifetime; no provider may advertise a durable or reattachable
   scope in 0.2.0. Routed to the provider capability declaration surfaced through the
   executor's OS-by-backend capability matrix (Architecture Replans 4/5; lead-4 routing
   table). It is a declaration-surface change, not a native change; it does not break the
   crate freeze.

Adjacent and Windows-owned, recorded so it is not lost (this record touches no Windows file):
lead-4 requires CONFIRMING, not assuming, that the Windows crate already establishes the
daemon-death sibling property - last-handle-close `KILL_ON_JOB_CLOSE`. That confirmation
belongs to `ecp-windows-process-authority-provider`.

Recommendation to the LEAD (not acted on, outside this record's file budget): when the
executor Change directory is created, seed its planning context with item 1 and item 2 above
verbatim, so the obligation does not depend on its proposer finding this evidence file in a
sibling Change.

## Routing agreement

The LEAD's routing was checked against the re-tier record's placement recommendations and the
lead-4 routing table; no disagreement. One wrinkle documented rather than argued: the re-tier
record allowed "THIS Change or its direct successor" for the teardown work; the tasks now live
in this ledger per the LEAD's routing, and the successor option remains available to Direction
via re-tier - which is one more reason the freeze cost sits visibly on every task.

## Update - 2026-08-07, later the same day: Section 12 gates local ship

The scheduling decision the Placement section above deliberately left open has now been made by
the LEAD, dated 2026-08-07: **Section 12 gates local ship.** Reasoning as given: without
12.1/12.2 the provider does not establish locked decision 11's daemon-death => scope-death
property (task 7.7's replacement half receipts the opposite), so a ship gate that excluded the
section would let the ledger claim semantics the code does not have - the Record lying at
ledger level.

Applied as follows, same author, same constraints (no ticks changed, no substantive task text
changed beyond the gating correction):

- Task 11.9's base wording was generalized from "every ... task above" to "every ... task in
  this ledger ... including Section 12 and any section appended after this task, with no
  positional exclusion". This fixes the wording defect itself, not only this instance: a future
  Section 13 is covered automatically, and exclusion happens only through explicit moved
  markers, never through position. The NARROWS marker's quoted phrase was updated to match
  ("every ... task in this ledger"); its meaning (moved tasks excluded; Section 9/broker rows
  do not gate) is unchanged.
- Section 12's prose no longer says the gating is undecided; it records the LEAD decision and
  its date so Direction can revisit it as a decision rather than discover it as a fact.
