# Issue #4 close — STAGED, not executed (design D5 / task 4.5)

Date: 2026-08-22. Author: the issue-needs-attention implementer leg.

## State at staging time

Issue `issue-cross-project-replanning` on the persistent store `issue-registry`
(uid f76edc31-229a-42bc-a5c7-848021eeb2da):

- Record `open`; revisions 0001 (decomposition, three intent nodes) and 0002
  (the binding revision: both shipped children as Change nodes on their seeded
  archived instances, the finale on its active seeded instance).
- Acceptance conditions revision 0001 published (four conditions, the file
  `issue-4-acceptance-conditions.yaml` in this evidence directory, committed
  store-side as 2b3afab).
- Status at this staging read: `active/healthy 2/3` — the finale node
  (`issue-needs-attention`) honestly in flight in the worktree executing this
  change (apply stage; run-state located by execution-root), both children
  `finalized` on their seeded archive evidence.

## Why the accept step does not execute here

The finale node is this very change. Its work is not terminal at the
implementer's hands — the change is unshipped and unarchived at the moment
this staging is written, so the acceptance gate does not hold (2/3 required
complete) and an accept now would be the self-reference trap P2's planning
context recorded: closing the work from inside the work. The LEAD close
precedent governs: the closer must stand OUTSIDE the finished work.

## The documented accept step (for the closer, from a genuinely terminal state)

1. Verify the terminal state: `rasen store issue show
   issue-cross-project-replanning --store issue-registry` reads phase
   `review` with progress 3/3 — the finale archived (repo archive entry
   seeded into the store's archive line, the same Issue #3 pattern this
   change used for its own children, or the equivalent committed terminal
   evidence).
2. Verify the gate: the show's acceptance section names the gate eligible
   over conditions revision 0001 (all four conditions evidenced — the
   receipts below plus green suites).
3. Execute: `rasen store issue accept issue-cross-project-replanning
   --store issue-registry --note "Phase 5 portfolio close: aggregation entry
   shipped (repo archive of issue-needs-attention), exit criteria evidenced
   from one place"`.
4. Commit store-side (the accept record write) with the store's own
   discipline: `git -C <store> add rasen/issues/issue-cross-project-replanning
   && git commit -m "chore(store): accept issue issue-cross-project-replanning"`.
5. Post-close receipt: `rasen store attention --store issue-registry` — the
   Issue reads `done/healthy`, zero items, the scan summary still naming it.

## Receipts in this directory

- `issue-4-decomposition.yaml` — the authored decomposition (0001's input).
- `issue-4-revision-0002-nodes.yaml` — the binding revision's input.
- `issue-4-receipt-1-authoring.txt` — attention scan at authoring: Issue #4
  scanned `planning/healthy`, zero items, honestly empty.
- `issue-4-receipt-2-confirm.txt` — confirm over 0002: finale "already
  running (resume-oriented)" (run-state located by execution-root), both
  children "already complete".
- `issue-4-receipt-3-inflight.txt` / `.json` — attention scan at
  children-terminal + finale-in-flight: `active/healthy`, zero items — the
  honest-absence receipt (scanned, visible, unlisted; no real signal stands:
  no failure, no trouble-blocked node, no parked stage, not review-phase,
  no problems).
- `issue-4-receipt-4-show.txt` — the per-Issue read of the same state
  (progress 2/3, lanes, revision delta 0002 over 0001 visible).
- `issue-4-receipt-5-staged-close.txt` — attention scan after the conditions
  landed: still `active/healthy`, zero items (publishing conditions is not
  the close; the gate reads not eligible, and `acceptance-awaiting` correctly
  does not fire — the phase is active, not review).
- `issue-4-receipt-6-temp-store-failure.txt` — the staged failure shape on a
  TEMP-store fixture twin (task 4.4): failed-among-running surfaced unmasked
  through the new verb, captured from the CLI test suite's fixture.

## Store-side commits (this dogfood's entire write surface)

- `2065262` seed children (g-001, g-002 archived; g-003 active finale stub)
- `7ef1bc8` open Issue + plan 0001 (decomposition)
- `a671b54` plan 0002 (bind)
- `2b3afab` acceptance conditions 0001 (staged close)

The repo's planning roots are untouched by every act above.
