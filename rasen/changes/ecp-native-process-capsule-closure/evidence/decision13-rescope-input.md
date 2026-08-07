# Closure re-review input package (post cutover review round 1)

Change: `ecp-native-process-capsule-closure`
Date: 2026-08-08
Author role: evidence-prep only (author of `decision13-regrade.md` and of the cutover's
`review-round-1.md`). **This file is scoping input for the closure re-review, not a closing
act. Closing authority for every item below is the closure re-reviewer, who must not be the
author of this file** (author/verifier separation: whoever authored this scope cannot grade
against it).

Sources reconciled: `decision13-regrade.md` (this directory, 2026-08-07),
`../ecp-hosted-best-effort-cutover/evidence/review-round-1.md` (commit `9db76d31`,
2026-08-08), this change's `tasks.md` and `evidence/step1-scope-reconciliation.md`, and the
executor planning-context's `[STALE-UNVERIFIED]` pointers (refresh commit `50c15be0`).
State of the world at authoring: the cutover fix round for review finding F1 is IN FLIGHT
and has not landed (HEAD `9db76d31` at write time); statements below say what the fix round
is closing, not that it has closed.

## 1. RC-004 - park voided, resurfaced, being fixed in the CUTOVER; closure residual stated

Ledger movement: `decision13-regrade.md` parked RC-004 conditional on the one-shot probe
being unreachable from the shipped win32 path. The cutover review performed that check and
the condition FAILED - the probe is reachable by design (cutover D4) and was exercised on a
real host. RC-004 is therefore **resurfaced as 0.2.0 acceptance** and is being fixed in the
cutover fix round as review finding **F1 [Major]** (`review-round-1.md`, checklist 1 and
finding F1): contain the `oneShotProbe` data callback (`native-process-scope.ts:346-351`,
mirroring the guarded resident path `:176-182`), add oversized/truncated/duplicate/
unknown-frame discriminators through the fake-capsule probe seam, and a LEAD-authorized
lineage-recorded rebaseline of that one TypeScript adapter pin in both
`LEGACY_PROCESS_CAPSULE_INPUTS` lists (the Rust crate untouched). A dated resolution note
was added to `decision13-regrade.md`'s RC-004 entry; its original conditional text is
otherwise preserved as history.

What RC-004 still owes AT CLOSURE - precisely three things, none of them the parser fix:

1. **Independent confirmation on the integrated tree.** The closure re-review must open the
   cutover fix round's receipts (not their summaries): the containment fix, its RED
   discriminators, and the pin-rebaseline lineage for `native-process-scope.ts` (hash from
   COMMITTED bytes, `0f7eda09`-style lineage comment). If the fix round has not landed
   clean by re-review time, RC-004 is still open acceptance - fail the gate, do not
   re-park.
2. **A ruling on the strict-ordering half of RC-004's original required fix** ("require
   exactly one bounded `OBSERVATION`, and reject every other frame/order"). F1's concrete
   task covers the crash-containment half plus malformed-frame discriminators; whether the
   fixer also enforces exactly-one-ordered-observation is an implementation choice. Today,
   unknown/out-of-order frames resolve to a typed rejection on close/timeout (bounded, per
   `review-round-1.md` checklist 1). The re-reviewer either accepts that as satisfying the
   typed-uncertainty core or records the ordering half as an accepted-known Minor - a
   recorded ruling either way, not silence.
3. **Nothing on the POSIX side.** The POSIX production path no longer constructs the legacy
   capsule at all (cutover selection, guarded by mutation (c)), so the probe is unreachable
   from POSIX hosted sessions; the capsule's Rust one-shot implementation is frozen history
   with no 0.2.0 acceptance. Non-cutover platforms (e.g. freebsd) still construct the
   legacy capsule with the probe, but they carry no support claim and are outside
   acceptance (cutover D7).

## 2. SEC-001 - evidence package for formal close (the re-reviewer's act, not this file's)

`decision13-regrade.md` made SEC-001 `conditionally-closed-pending-cutover-verification`
with a named check. The cutover review PERFORMED the check and confirmed it on that tree
(`review-round-1.md` checklist 4). The package a closure re-reviewer needs to formally
close SEC-001 without re-deriving:

- **Original finding text** (must be re-read in full before closing): `evidence/
  cso-report.md:49-94` (Blocker; "a typed uncertain native result becomes an authoritative
  clean detach at the next layer").
- **Structure that closes the shape**: cutover D3 invariant - a declared-unproven terminal
  is mintable only from an actual capsule protocol outcome - enforced by the
  `transportLost` latch plus the latch-independent inspect backstop
  (`win32-best-effort-scope.ts:327`, `:339-344`, `:363`), with `receiptAuthorizesRelease`
  refusing `uncertain` regardless of declaration.
- **Deciding evidence**:
  1. Real-host transport-loss receipt: `../ecp-hosted-best-effort-cutover/evidence/
     win32-real-host-receipts.md` Task 7.3 - capsule controller killed mid-session on the
     real Windows host; `recovered === 0`, `record.process` still defined, no terminal
     written, valid pre-start declaration present. Note its FIRST run failed - a real
     clean-detach existed in shipped code until commit `0346ba29` - which is both the
     defect's reality and the receipt's discrimination proof.
  2. Reviewer-run latch mutation: `review-round-1.md` checklist 2 - with the latch
     disabled, exactly the post-loss regression guard went RED (1 failed | 18 passed),
     byte-exact restore verified (module hash `76bf15cb...` before and after), 19/19 green
     after. This closed the discrimination gap left because the implementer's mutation
     wave (`af21ba8d`) predated the latch fix (`0346ba29`).
  3. Deterministic loss guards and mutation (b), plus per-path release discrimination
     (d1)/(d2): `../ecp-hosted-best-effort-cutover/evidence/mutation-receipts.md`.
  4. POSIX tier: no external control transport exists in-process; terminals are minted
     only by the cancel protocol or the observed-empty completion watcher
     (`posix-best-effort-scope.ts`); daemon death is decision 11's `execution-lost`,
     owed by the executor change.
  5. The host translation layers SEC-001 originally indicted (`claude-backend.ts`
     close(error) path, `host.ts` observeTransportClose) are byte-unchanged
     (`legacy-freeze-integrity.md`); the honesty now lives below them at the scope seam.
- **Bounds on the confirmation**: cutover findings F1 (RC-004 crash path - separate
  defect on the same probe plumbing; it cannot mint a terminal or release authority) and
  F2 (Minor: the terminate-leg guarantee rests on the host's single controllable-gated
  call site; hardening suggested). Neither reopens SEC-001's shape.
- **Close condition**: cutover fix round lands and its delta re-review is clean; then the
  closure re-reviewer closes SEC-001 under rewritten task 12.2 by citing this package.

## 3. RC-002 / S2 / RC-005 - cutover rulings carried forward

- **RC-002** (Blocker; natural POSIX scope-empty unreachable): the decision-13 residual my
  regrade named (bounded declared-unproven terminal on natural exit, never a zombie-pinned
  wait) is **satisfied on the shipped tiers** - `review-round-1.md` checklist 5: terminate
  bounded by `withPhaseDeadline`, ESRCH-keyed zombie-tolerant emptiness poll, real-kernel
  6.4 receipts on both natural-exit legs (exit 23; SIGTERM). Closure re-review records the
  confirmation under rewritten 12.5; the exact-empty acceptance remains superseded
  (upgrade path).
- **S2** (Major; root-exit misreported as whole-scope closure): **satisfied** -
  `review-round-1.md` checklist 6: POSIX keeps `root-exited` distinct from any terminal
  and completes only on observed group emptiness; win32 never mints the capsule's proven
  claim (mutations (e)/(f), source scans); Job teardown receipted at 7.1/7.2. S2's formal
  ledger lives with the host change's fresh review; closure consumes this as predecessor
  evidence.
- **RC-005** (Minor; client-map retention): the shape now exists in **three** maps, not
  one - cutover finding F4. **Task 12.8's scope grew accordingly**: legacy `clients`
  (`native-process-scope.ts:382`, insert `:424`), POSIX `scopes`
  (`posix-best-effort-scope.ts:177`, insert `:447`), win32 `scopes`
  (`win32-best-effort-scope.ts:198`, insert `:271`). None deletes entries after a
  terminal. One lifecycle rule for all three - release the exact entry once its settled
  terminal has been consumed, retain control-lost/uncertain entries for reconciliation -
  plus the lifecycle test RC-005's original text demands: terminal entries released,
  uncertain entries remain reconcilable.

## 4. The three [STALE-UNVERIFIED] rows - re-read in full, tags cleared

The executor planning-context (commit `50c15be0`) tagged `step1-scope-reconciliation.md`
rows 9.10, 11.16, 11.17 as `[STALE-UNVERIFIED]` receipt expectations. Each row was re-read
in full against decision 13 and cutover review round 1:

- **9.10** (Step 1 verdict: NARROWS - OS x backend matrix; macOS in-tool + best-effort
  honesty receipts; Linux/Windows zero-orphan daemon-death + `execution-lost` receipts;
  blocking rule stands). **Now: NARROWS AGAIN.** The blocking rule and the OS x backend
  matrix stand. The receipt set is revised by decision 13: the WINDOWS zero-orphan
  daemon-death receipt stands and is already DELIVERED (cutover 7.2, real
  KILL_ON_JOB_CLOSE chain); the LINUX zero-orphan receipt is SUPERSEDED (decision 13
  revises decision 11's Linux leg to declared best-effort - orphan risk is a declared
  known limitation) and is replaced by the best-effort honesty receipts, delivered on a
  real kernel (cutover 6.2-6.4, including the setsid escape-honesty receipt);
  `execution-lost` receipts still stand and belong to the executor change; macOS receipts
  (in-tool + best-effort honesty) still stand, owed to ECP-8.
- **11.16** (Step 1 verdict: NARROWS - Linux/Windows exact-empty/recursive-terminate/
  unavailable/unrelated-survival/bounded-settlement on real OS; "one provider cannot
  satisfy another's gate" stays; macOS leg replaced by best-effort honesty). **Now:
  SUPERSEDED-BY-DECISION-13 in its exact-authority legs.** Kernel-enforced exact-empty and
  recursive termination are explicitly not 0.2.0 acceptance (cutover spec: kernel-enforced
  proofs SHALL NOT be acceptance criteria) and the provider crates carrying those gates
  are parked. Surviving residue: typed `authority-unavailable` capability honesty
  (retained by decision 13; its surface is now the non-cutover legacy path and the
  capability matrix, since hosted best-effort constructs on all three OSes);
  "one provider cannot satisfy another's gate" travels to the upgrade path with the parked
  crates as a resumption principle; the best-effort honesty-evidence leg is delivered for
  Linux/Windows (cutover 6.x/7.x) and owed for macOS (ECP-8).
- **11.17** (Step 1 verdict: NARROWS - runner/command obligations re-shape to the OS x
  backend matrix plus zero-orphan/`execution-lost` receipts; cross-target stays
  non-runtime). **Now: NARROWS AGAIN**, same revision as 9.10: matrix stands (ECP-8);
  Windows zero-orphan receipt delivered; Linux zero-orphan superseded into declared
  best-effort honesty receipts (delivered); `execution-lost` to the executor change;
  cross-target compilation remains labelled non-runtime evidence (unchanged).

The `[STALE-UNVERIFIED]` tag on these three rows is hereby cleared for planning purposes;
the executor planning-context can cite this section instead of the raw Step 1 rows.

## 5. Residual closure worklist as it now stands

| Item | Current verdict | What it still owes, and by whom |
| --- | --- | --- |
| 12.1 PGID-exact-claim deletion + integration close-out | rewritten by decision 13 | Re-author this change's delta spec (`specs/durable-process-scope-authority/spec.md` is still written around exact whole-scope semantics) to the best-effort acceptance per Replan 6; confirm no production path mints an exact claim (cutover review verified darwin/linux/win32 via mutations (e)/(f) and source scans - cite, do not re-derive); record that the legacy capsule's internal exact vocabulary below the seam is permitted by design (cutover D3 rationale). Owner: closure implementer + re-reviewer. |
| 12.2 SEC-001 | conditionally closed; evidence packaged (section 2) | Formal close by the closure re-reviewer once the cutover F1 fix round's delta re-review is clean. |
| 12.3 / SEC-002, 12.4 / SEC-003 | superseded by decision 12 (unchanged by 13) | Nothing for 0.2.0; re-entry conditions stay on record (`decision13-regrade.md`). |
| 12.5 / RC-002 | superseded (exact leg) + residual satisfied (section 3) | Record the confirmation; no new work. |
| 12.6 / RC-003 | leaves with the upgrade path | Nothing for 0.2.0. |
| 12.7 / RC-004 | resurfaced; fix in the cutover fix round | The three closure residuals in section 1. |
| 12.8 / RC-005 | stays 0.2.0; scope widened one map -> three | Implement the shared lifecycle rule across all three maps + the release/retain lifecycle test; confirm at re-review. |
| 12.9 / 12.10 + 9.3-9.5 | unchanged mechanics | Fresh non-author security and code/spec reviews scoped by THIS package plus the Step 1 re-tiered scopes (9.3/9.4 NARROWS rows); then local ship/archive sequencing. The re-reviewer must not be this file's author. |
| S1 / S3 (inherited) | leave with the parked crates | Ledger only; no closure work. |
| S2 (inherited) | satisfied on the cutover tree (section 3) | Closure consumes as predecessor evidence; formal ledger belongs to the host change's fresh review. |
| S4 (inherited) | narrowed residual satisfied on the cutover tree (`review-round-1.md` checklist 7: 7 phases, all bounded) | Closure re-review records it; the host change's fresh review confirms for its own ledger. |
| S5 (inherited) | narrowed per decision 12 | Adjacent-integrity half receipted by the cutover pin suites + `provenance-audit.md`; independent confirmation at re-review. |

Also inherited into the re-review's read list: cutover findings F2 (Minor, terminate-leg
hardening) and F3 (Minor, four guards without mutation counterparts) if the fix round takes
them; they are cutover-owned, not closure-owned, but the re-reviewer should know their
disposition before grading the integrated tree.

## Authority statement

This file assembles evidence and scope; it closes nothing. Every "satisfied" above is the
cutover reviewer's tree-level ruling, and every formal close of a closure-ledger finding
belongs to the closure re-reviewer - a different worker from this file's author, per
author/verifier separation.
