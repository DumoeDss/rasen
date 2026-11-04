# Handoff: ECP-7 — LEAD #4 (Step 1 re-tiering wave)

Date: 2026-08-07

## Read this first

`lead-2.md` and `lead-3.md` both remain authoritative for everything they cover. This document
supersedes only the specific items listed under "Corrections to lead-3" below. Read lead-3 first,
then lead-2, then this.

This session was an **auto-pipeline LEAD session**. It executed lead-3's next-action item 1 and
item 2 (the mandatory task-ledger re-tiering) and started item 4 (the Windows crate re-freeze).
No product code was written by the LEAD. Three role-isolated workers were dispatched.

## Position

Portfolio `ecp-session-execution-and-self-hosting`, gate policy `off` (global), Tier A.

| Child | State |
| --- | --- |
| `ecp-linux-process-authority-provider` | 75/93, implementation-frozen, NON-TERMINAL. **Ledger now re-tiered.** |
| `ecp-windows-process-authority-provider` | 47/104. Crate re-freeze **in flight at handoff time** |
| `ecp-macos-process-authority-provider` | `pending`, narrowed best-effort. **Not proposed. `planning-context.md` is seeded and ready.** |
| `ecp-native-process-capsule-closure` | `escalated`. **Findings now re-graded.** |
| `ecp-durable-agent-session-host` | `escalated`, untouched |
| executor / policy-parity / self-hosting | empty directories, untouched |

## What this session did

### 1. Re-tiered the Linux ledger (lead-3 next-action item 1)

`evidence/step1-task-ledger-retier.md` — all 93 tasks and all 11 findings, one row each, graded
against the task's or finding's own text. `tasks.md` carries a scope legend and inline markers.
No checkbox changed; no task text deleted.

```text
STAYS-0.2.0 45   NARROWS 23   MOVES-0.3.0-BROKER 20   MOVES-UPGRADE-PATH 5   SUPERSEDED 0
broker moves:       2.4, all of Sections 8 AND 9, 10.6, 11.4
upgrade-path moves: 2.7, 6.9, 6.10, 6.11, 7.10
```

Note **Section 8 leaves too**, not only Section 9 — lead-3 named only Section 9, but Section 8 is
"Explicit Installed Broker and Cgroup-v2 Authority" and goes with the broker by its own text.

### 2. Re-graded the closure findings (lead-3 next-action item 2)

`rasen/changes/ecp-native-process-capsule-closure/evidence/step1-scope-reconciliation.md` —
96 tasks (51 stay / 20 narrow / 16 leave / 9 superseded) and **eight** open findings plus five
inherited. Every verdict is explicitly recorded as re-grading scope and **not** closing the finding.

### 3. Started the Windows crate re-freeze (lead-2 next-action item 2)

In flight at handoff time. Ordering enforced: `.gitattributes` LF pin -> normalise -> re-measure
-> re-take receipts bound to the old digest -> marker **last**. Check
`.rasen/changes/ecp-windows-process-authority-provider/ephemera/auto-run.json` key `crateRefreeze`
and `evidence/win-crate-lf-refreeze.md` for where it got to.

## Corrections to lead-3 (each one file-anchored, not argued from summaries)

1. **The closure finding list was short by one.** lead-3's next-action item 2 names
   `SEC-001..003` + `RC-002..005`. **`RC-001` (Blocker) is also open** — it appears in
   `review-report.md:27`, `fix-round-1.md:5/16/80` and `architecture-replan.md:14`. It grades
   `SUPERSEDED`, but by the **2026-08-04 architecture replan**, which predates both of the
   2026-08-07 re-gradings — so it is a third, independent reason, not (a) or (b). Keep it distinct.

2. **"Opaque reference envelopes and pidfd reopen-and-revalidate move to the upgrade path" does
   not hold wholesale.** On the Linux change every control verb is a fresh helper process that
   consumes the private reference and revalidates before acting (`F-L2-04`, `F-L2-13` item 2, task
   6.3's ordering). The same machinery is **simultaneously** the retained intra-lifetime
   destructive-target-safety path and the criterion-4 reattach path. Tasks 2.3 / 6.2 / 6.3 / 6.4
   therefore **narrow**; only the pure publication/replacement tasks move whole.
   **This is the most load-bearing correction in this document:** any future scope cut phrased as
   "remove reattach" that is applied mechanically will take destructive-target safety with it.

3. **The NATIVE-SEAM findings move for a different reason than lead-3 gives.** lead-3 grounds them
   in "same-boot process-recovery state"; that ground is in neither finding's text. The
   file-anchored ground is that the seam's only production non-no-op consumer is the broker closure
   (the primary CLI uses the no-op hook). Same verdict, corrected ground.

4. **`PKG-P5` is not closed.** lead-2 and the replan input say the 7.2 re-emit closed it; the
   findings file's own boundary says the implementation wave does not close findings. Recorded
   open-with-supersession-evidence. Closing it is the review wave's act.

5. **"7 findings leave" is imprecise.** Actual: 6 move whole, 1 splits (`BRK-R2-B06`, whose
   carve-out lead-3 correctly demanded), 2 narrow, 2 stay.

6. **`SEC-002` is not literally a TOCTOU race** (the junction is pre-placed before resolution, not
   raced). It still falls under decision 12's junction-redirection clause, so the verdict is
   unchanged — only lead-3's label was imprecise. `SEC-003` *is* a literal race.

7. **Severity drift exists in the closure evidence chain.** `architecture-replan.md` recaps
   `SEC-002`/`SEC-003` as Blocker; the originating `cso-report.md` and `fix-round-1.md` both say
   Major. **Grade from originating reports — recap lists in this repository drift upward.**

## The gap this wave surfaced — and it is the important one

**Step 1 created new obligations and nobody wrote tasks for them.** The Linux ledger has **no
task** for any of:

- inherited-pipe-EOF teardown (the guardian holds an inherited pipe; EOF tears down the PID
  namespace) — explicitly **not** `PR_SET_PDEATHSIG`, which fires on *thread* death and is cleared
  across setuid/exec;
- typed `execution-lost` for the in-flight action;
- the `durable: daemon-lifetime` capability declaration.

Worse, **the frozen tree deliberately proves the opposite lifetime property** (task 7.7 asserts
controller replacement and guardian-forced-death survival).

LEAD routing decision, recorded but **not implemented**:

| Obligation | Belongs to |
| --- | --- |
| inherited-pipe-EOF teardown | Linux provider. **It is a native fault-domain change, so it BREAKS the `087d87a5` freeze and costs a re-freeze plus a re-bind of every receipt bound to it — budget that cycle before scheduling it.** ECP-8 owes the receipt. Windows sibling is last-handle-close `KILL_ON_JOB_CLOSE` — **confirm the Windows crate already establishes it, do not assume** |
| typed `execution-lost` + committed-frontier resume | `ecp-frozen-action-session-executor` (not started) |
| `durable: daemon-lifetime` declaration | provider capability declaration, surfaced through the executor's OS-by-backend capability matrix |

**Task 7.7 — reconciled, closed.** Its ledger row and the evidence record originally disagreed:
the report called it the task that proves the opposite lifetime property, while the ledger left it
unmarked (i.e. staying). Sent back to the re-tier worker, it now reads **`NARROWS` (a)** in both
files, split on the task's own words — *"guardian forced-death ... kernel teardown, and
unrelated-process survival"* stays (that is the zero-orphan core Step 1 depends on), while
*"controller replacement ... including pidfd reopen/revalidation"* is the receipt that a
**replacement controller resumes live authority**, which is criterion-4 acceptance and moves. The
drift-refusal half stays. A sweep for the same report/ledger split shape found no other instance;
7.9 is correctly unmarked because its text claims refusal and unavailability only, with no resume
claim.

## Key decisions (and why)

- **Serialized macOS and the `workload-non-escape` wording narrow behind the re-tier.** Not
  skipped — deliberately ordered. `RECURSIVE_PROCESS_SCOPE_SEMANTICS`
  (`src/core/session-host/process-authority/types.ts`) contains **both** `workload-non-escape`
  **and** `replacement-recovery`, and `replacement-recovery` *is* criterion 4. So lead-3's
  next-action items 3 and 5 both land on the same frozen constant, and proposing macOS first would
  have declared capabilities against a contract that was mid-flight. Same failure shape as opening
  a kernel gate against a moving crate.
- **Ran the three independent items concurrently, and only those three.** Linux ledger, closure
  findings, and the Windows crate have provably disjoint touch-sets. Everything else has a real
  edge into the re-tier output.
- **Relayed what to check, never the expected answers.** Every dispatch framed lead-3's stated
  outcomes ("Section 9 leaves", "7 findings leave", "five CRLF files") as claims to verify and
  required disagreements to be reported. That is why this document has seven corrections; a
  dispatch that had pasted the answers would have produced seven confirmations instead.
- **Spot-verified the contested claims myself rather than accepting them.** Confirmed
  independently: three `createNativeProcessScope` construction sites (`router.ts:639`,
  `claude-backend.ts:395`, `host.ts:299` — not one), and `RC-001` genuinely open.
  **`retier-linux`'s claims are NOT yet spot-checked** — the successor should verify at least the
  2.3/6.2/6.3/6.4 narrowing argument against the task text before relying on it.

## Gotchas earned this session

- **`git diff --check` does not cover the `rasen/changes/ecp-*` tree, because it is untracked.**
  Whitespace-gate compliance there must be measured directly on bytes. A scan found the three
  trailing-space hard breaks in `closure/evidence/review-report.md` that the worker warned about
  **plus a trailing blank line in `red-baseline.md` that it missed**. Both fixed; that dir now
  scans clean. **The Linux and Windows change dirs have not been swept.**
- Markdown hard breaks written as two trailing spaces are a whitespace-gate landmine in imported
  evidence. Converting them to a trailing backslash preserves rendering and passes the gate.
- The Bash tool refuses heredoc-style multi-command scripts in a worktree-isolated session. Write
  the script to the scratchpad and run it by path.
- `tasks.md` tolerates prose under section headings and inline suffixes after task text —
  `rasen validate --strict` stays green — so scope markers can live in the ledger itself.
- Reading `.rasen/**/auto-run.json` with Python needs an explicit `encoding='utf-8'`; the default
  GBK codec on this host fails on the existing content.

## Operator decision taken this session

**The operator approved committing the `rasen/changes/ecp-*` artifacts** (previously declined).
If the commit did not happen before this handoff, it is the **first thing the successor should
do** — those 101+ files include both handoff chains, `f-l2-17-linux-escape-demonstration.md` and
`lead2-implementation-wave-findings.md`, and they remain one `git clean` from gone. Sweep
whitespace on every dir first, then commit with a narrow pathspec (`git commit -- <paths>`); this
worktree shares its index with other sessions.

## Next action

1. **Collect the Windows re-freeze result** and record it. If it did not finish, its handoff is at
   `rasen/changes/ecp-windows-process-authority-provider/handoff/implementer-win-refreeze-1.md`.
2. **Commit the remaining change artifacts** (approved — see above), whitespace-swept. The closure
   child and the macOS planning context were committed this session; the **Linux and Windows change
   dirs were not** and remain untracked.
3. **Then macOS propose.** `planning-context.md` is seeded with the full scope, the honesty
   conditions (`exactCancel: false`, `scopeEmptyProof: false`, terminal state
   `cancelled / emptiness-unproven`), the do-not-re-add-the-closure-edge rule, and the contract
   dependency. Use it; do not re-derive.
4. **Then the `workload-non-escape` wording narrow**, now informed by the re-tier — and treat
   `replacement-recovery` in the same frozen array as part of the same contract change rather than
   a separate one.
5. **Then decide where Step 1's own obligations land** (the table above is a routing proposal, not
   a decision that has been executed).
6. Then the unified review wave, then executor -> policy-parity -> self-hosting. All three of those
   are still empty directories and are still ECP-7's actual user result.

## Honest state

Unchanged from lead-3: no, we cannot release soon. This wave removed a class of wasted effort —
20 Linux tasks and 16 closure tasks that were still being treated as 0.2.0 acceptance are now
correctly out of scope, and seven statements in the governing handoff turned out to need
correction. That is real progress on *knowing what is true*. It moved zero tasks to done.
