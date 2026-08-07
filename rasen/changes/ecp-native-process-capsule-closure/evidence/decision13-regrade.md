# Decision 13 re-grade: open findings of ecp-native-process-capsule-closure

Change: `ecp-native-process-capsule-closure`
Date: 2026-08-07
Author role: REVIEWER acting as re-grade accountant, dispatched by the ECP-7 LEAD.

This document is an accounting act, not a closing act. It re-grades this Change's eight open
findings (`SEC-001..003`, `RC-001..005`) against locked decision 13 and its two same-day
predecessors (locked decisions 11 and 12). **No verdict below closes any finding.** Closing any
conditional verdict belongs to the `ecp-hosted-best-effort-cutover` independent review and the
closure re-review under the rewritten acceptance, never to this file.

## Method and governing sources

- Every finding was re-read in full from its originating report before grading: `SEC-001..003`
  from `evidence/cso-report.md` (canonical severities Blocker / Major / Major), `RC-001..005`
  from `evidence/review-report.md` (Blocker / Blocker / Blocker / Major / Minor). Nothing was
  graded from a recap. The known severity discrepancy is inherited unchanged:
  `evidence/architecture-replan.md:20-21` lists SEC-002/SEC-003 as Blocker, but the originating
  `cso-report.md` records canonical Major for both; this document grades canonical Major,
  agreeing with `evidence/step1-scope-reconciliation.md` (Disagreements item 3).
- Prior dispositions are taken from `evidence/fix-round-1.md` (round 1: 0/8 resolved, replan
  handoff), `evidence/architecture-replan.md` (2026-08-04 replan), and
  `evidence/step1-scope-reconciliation.md` (2026-08-07 Step 1 re-grade under decisions 11/12).
- Locked decision 13 text: `rasen/work/issue-centered-automation-platform/`
  `executable-composite-pipelines/target-state.md:297-329`. In summary: the 0.2.0 `hosted`
  backend converges on all three OSes to an explicitly declared best-effort tier
  (`exactCancel: false`, `scopeEmptyProof: false` visible before start; cancel terminal
  `cancelled / emptiness-unproven`); kernel-enforced exact recursive termination and exact
  scope-empty move whole to the upgrade path together with the two frozen authority crates
  (Linux `89f6c1d5`, Windows `fc49a7c2`/helper `367666f6`) and their evidence; Windows keeps the
  Job `KILL_ON_JOB_CLOSE` daemon-death teardown guarantee with a receipt; the Linux/macOS
  zero-orphan leg of decision 11 is revised to declared best-effort semantics (orphan risk is a
  declared known limitation); fail-closed typed uncertainty, capability honesty, actor
  separation, and evidence transactionality are explicitly not relaxed; closure's acceptance is
  rewritten to "replace the legacy capsule's disproven claims with the best-effort tier and
  finish the ProcessScope/host integration", and the PGID deletion obligation becomes deletion
  of the PGID *exact claim* (the process-group mechanism itself survives as declared
  best-effort).
- Execution shape of decision 13: `slices/session-execution-and-self-hosting/plan.md:510-588`
  (Architecture Replan 6) and the new change `rasen/changes/ecp-hosted-best-effort-cutover/`
  `proposal.md` (in propose). Two cutover facts are load-bearing for this re-grade: POSIX
  (linux + darwin) stops constructing the legacy ProcessCapsule entirely (replaced by the
  generalised best-effort scope), while win32 keeps the unmodified legacy capsule behind a thin
  scope that re-declares its terminals in the declared-unproven vocabulary
  (`proposal.md:7-10, 27-28`).
- Verdict vocabulary per the dispatch: `stays-0.2.0` / `narrows` / `leaves-with-parked-crates` /
  `superseded-by-decision-13` / `conditionally-closed-pending-cutover-verification`. One
  additional verdict is used deliberately: `prior-disposition-stands`, for findings whose
  governing supersession predates decision 13 and is not altered by it - labelling those
  `superseded-by-decision-13` would misattribute the supersession.

## Summary table

| Finding | Original severity | Original claim (quoted core) | Prior disposition | Decision-13 verdict | Verification owed and by whom |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | Blocker | "Thus a typed uncertain native result becomes an authoritative clean detach at the next layer." | Step 1: SURVIVES-0.2.0; fix seam moved to the provider-integrated ProcessScope (task 12.2) | conditionally-closed-pending-cutover-verification | Cutover independent review + closure re-review: transport/controller-loss discriminator on the shipped win32 delegation and POSIX best-effort scope (exact check in detail section) |
| SEC-002 | Major | "replaces the whole `dist/native/process-capsule` directory with a junction to an attacker-controlled directory" | Step 1: SUPERSEDED under decision 12 (local-attacker path hardening retired) | prior-disposition-stands (decision 13 has no effect) | None for 0.2.0; manifest-adjacent hash/length integrity on the surviving win32 helper stays acceptance, receipted by the cutover pin-list integrity task |
| SEC-003 | Major | "A concurrent actor watching the registry renames P and replaces that name with a symlink/junction ... before ACTIVATE." | Step 1: SUPERSEDED under decisions 11+12 | prior-disposition-stands on the decision-12 leg; the decision-11 leg is weakened (see detail) | None for 0.2.0; re-enters acceptance only if the threat model changes |
| RC-001 | Blocker | "the controller can observe the reserved group as empty and emit `SCOPE_EMPTY` while a worker descendant still runs outside it" | Superseded 2026-08-04 by the replan; containment acceptance moved to the provider Changes; PGID deletion = task 12.1 | leaves-with-parked-crates (containment acceptance); honesty residual owed to the cutover | Cutover review: no POSIX production path can mint an exact scope-empty / clean-cancel claim; closure: PGID exact-claim deletion under the rewritten 12.1 |
| RC-002 | Blocker | "The controller's `ROOT_EXIT` loop consequently cannot reach `SCOPE_EMPTY` for a naturally empty group." | Step 1: NARROWS; exact natural empty still owed on real Linux/Windows (12.5); macOS leg left | superseded-by-decision-13 (three-OS `scopeEmptyProof: false`; exact scope-empty to upgrade path) | Cutover review: natural backend exit in the POSIX best-effort scope reaches a bounded declared-unproven terminal, never an unbounded wait |
| RC-003 | Blocker | "Both POSIX branches return observation `2` (`closed`) when the reserved group is absent even if the controller birth still exactly matches" | Step 1: LEAVES-UPGRADE-PATH under decision 11 | leaves-with-parked-crates (re-affirmed; POSIX one-shot path additionally stops being constructed) | Upgrade-path resumption only; the retained no-overclaiming invariant is checked under SEC-001/RC-004 |
| RC-004 | Major | "An oversized frame throws from an EventEmitter callback and can escape as an uncaught exception during startup reconciliation." | Step 1: LEAVES-UPGRADE-PATH under decision 11, with an explicit resurface caveat | leaves-with-parked-crates, conditional on the named cutover check | Cutover review: prove the one-shot probe (`native-process-scope.ts:329`) is unreachable in the shipped win32 delegation, else RC-004 resurfaces as 0.2.0 acceptance |
| RC-005 | Minor | "no path deletes an entry after exact `SCOPE_EMPTY` ... accumulates these objects without a bound" | Step 1: SURVIVES-0.2.0 (task 12.8) | stays-0.2.0 | Closure fix (12.8 under rewritten acceptance) + closure re-review; cutover review confirms whether the POSIX best-effort scope has an analogous retention path |

Verdict counts: conditionally-closed-pending-cutover-verification 1; prior-disposition-stands 2;
leaves-with-parked-crates 3; superseded-by-decision-13 1; stays-0.2.0 1.

## Per-finding detail

### SEC-001 - Blocker - control loss is converted into clean host detachment

- **Original text:** `evidence/cso-report.md:49-94`. Core claim: "`CapsuleClient` correctly
  rejects `live.closed` when the controller/control pipe closes before `SCOPE_EMPTY`.
  `ClaudeResidentTransport` then handles that rejection by calling `close(error)`, but `close()`
  always fulfills its public `closed` promise via `resolveClosed()`. ... Thus a typed uncertain
  native result becomes an authoritative clean detach at the next layer." Exploit tail: "A later
  restart/new admission can acquire a new writer while the old descendant continues running."
- **Prior dispositions:** round 1 fixer: no code change, still open (`fix-round-1.md:77`).
  2026-08-04 replan: preserved open (`architecture-replan.md:19`). Step 1: SURVIVES-0.2.0,
  reason none - trigger is loss inside a live daemon, retained twice by decision 12; fix seam
  moved to the provider-integrated ProcessScope, task 12.2
  (`step1-scope-reconciliation.md:65, 86`).
- **Decision-13 re-grade:** the provider-integrated seam named by Step 1 no longer exists in
  0.2.0. Decision 13's execution shape routes the fix instead through the cutover's honest
  terminals: Replan 6 assigns the cutover "structural closure of SEC-001's transport-loss-
  becomes-clean-detach shape" (`plan.md:560-562`), and the cutover proposal commits: "Transport
  or controller loss on win32 maps to retained uncertainty, never to any terminal that
  authorises release; only actual capsule protocol outcomes mint a declared-unproven terminal.
  This is expected to structurally close the shape of closure finding SEC-001 ... to be
  verified at the closure re-grade, not claimed done here" (`proposal.md:9`). That is a
  prediction, not evidence. The host-side translation layers the finding indicts
  (`claude-backend.ts` close(error) -> resolveClosed; `host.ts` observeTransportClose ->
  detachLive) are explicitly NOT modified by the cutover (`proposal.md:27`), so the seam where
  the lie happened survives and only the scope-side vocabulary changes.
- **Verdict:** `conditionally-closed-pending-cutover-verification`.
- **Exact check owed (cutover independent review, confirmed at closure re-review):** on the
  shipped tree, a discriminator in which the control channel is lost / `live.closed` rejects
  before any terminal observation, run against both the win32 thin-scope delegation and the
  POSIX best-effort scope, proving all of: (1) no terminal that authorises release is minted
  from the loss itself - the outcome is retained typed uncertainty; (2) registry process facts,
  writer claim, capacity, and restart refusal persist until a genuine protocol outcome; (3) the
  eventual terminal uses the declared-unproven vocabulary and never a clean-close / proven-empty
  classification. Until that discriminator exists and passes under non-author review, SEC-001
  remains an open Blocker of this Change.

### SEC-002 - Major - ancestor junction moves the helper trust root outside the package

- **Original text:** `evidence/cso-report.md:96-134`. Core claim: "the resolver canonicalizes
  `packageRoot`, but constructs `nativeRoot` lexically and never proves the real native root
  remains below the real package root ... those checks still pass when `native/process-capsule`
  or `dist/native/process-capsule` itself is a junction to an external directory." Exploit
  precondition: "A compromised extraction/staging step or local package-tree attacker replaces
  the whole `dist/native/process-capsule` directory with a junction to an attacker-controlled
  directory."
- **Prior dispositions:** round 1: no change (`fix-round-1.md:78`). Step 1: SUPERSEDED under
  decision 12 - the required actor is exactly the local attacker decision 12 rules out, and
  decision 12 names "symlink/junction redirection" verbatim among the retired items; the
  retained manifest-to-adjacent-binary integrity is not this finding
  (`step1-scope-reconciliation.md:66, 87`).
- **Decision-13 re-grade:** decision 13 changes nothing here. It explicitly does not relax or
  revisit the decision-12 threat model (`target-state.md:324-326`), and the resolver code the
  finding faults remains production only on the surviving win32 helper path. The finding stays
  on the record with its Step 1 re-entry condition (multi-user or hosted deployment).
- **Verdict:** `prior-disposition-stands` (superseded by decision 12; decision 13 no effect).
- **Verification owed:** none as 0.2.0 acceptance for this finding. The adjacent-integrity half
  that decision 12 retains continues to bind the shipped win32 helper; the cutover's explicit
  pin-list integrity task (`ecp-hosted-best-effort-cutover/proposal.md:12`) receipts that the
  legacy capsule bytes are unchanged, which is the surviving obligation's current form.

### SEC-003 - Major - backend cwd re-resolved after durable publication

- **Original text:** `evidence/cso-report.md:136-177`. Core claim: "After the ProcessRef is
  durably published, the supervisor launches the backend with `Command::current_dir(&spec.cwd)`,
  re-resolving the pathname ... A rename-plus-symlink/junction swap between publication and
  activation therefore retargets the actual backend while the registry and writer claim still
  name the original canonical directory." Exploit step: "A concurrent actor watching the
  registry renames `P` and replaces that name with a symlink/junction to attacker-controlled
  directory `Q` before ACTIVATE."
- **Prior dispositions:** round 1: no change (`fix-round-1.md:79`). Step 1: SUPERSEDED under
  (a)+(b) - decision 12 names "cwd redirection between validation and spawn" verbatim among the
  retired TOCTOU items, and under decision 11 the wide pre-activation publication window leaves
  with the `prepared -> published -> activate` protocol
  (`step1-scope-reconciliation.md:67, 88`).
- **Decision-13 re-grade:** the decision-12 leg is untouched and alone sustains the retirement.
  One precision must be recorded against the Step 1 reasoning: the decision-11 leg claimed the
  raced window "disappears" with the three-phase protocol, but under the cutover the win32 path
  keeps the unmodified legacy capsule - including its durable publication before ACTIVATE -
  behind the thin scope (`proposal.md:8, 27-28`). The window therefore still exists in shipped
  code on win32; it is out of acceptance solely because decision 12 retired the attacker class,
  not because the code shape left.
- **Verdict:** `prior-disposition-stands` on the decision-12 leg; the decision-11 leg of the
  Step 1 justification is weakened and should not be cited alone in future accounting.
- **Verification owed:** none as 0.2.0 acceptance; same re-entry condition as SEC-002.

### RC-001 - Blocker - POSIX descendants can leave the only containment boundary

- **Original text:** `evidence/review-report.md:27-51`. Core claim: "The backend root is not the
  group leader and can call `setsid()`/`setpgid()` (for example, Node
  `spawn(..., { detached: true })`), after which the controller can observe the reserved group
  as empty and emit `SCOPE_EMPTY` while a worker descendant still runs outside it. That process
  is also unreachable by later exact termination."
- **Prior dispositions:** round 1 fixer: architecture Blocker, no patch; a process group cannot
  close this finding (`fix-round-1.md:80` and its whole Outcome section). 2026-08-04 replan:
  superseded the PGID authority itself; containment acceptance moved to the Linux (namespace)
  and Windows (Job) provider Changes; PGID deletion became closure task 12.1
  (`architecture-replan.md`, Step 1 Table A.1 row RC-001, `step1-scope-reconciliation.md:68, 89`).
- **Decision-13 re-grade:** decision 13 re-routes the successor acceptance a second time. The
  kernel-enforced containment that the 08-04 supersession sent to the provider Changes now
  leaves 0.2.0 whole with the parked crates (`target-state.md:315-319`). What RC-001 proved -
  that a POSIX process group is escapable and its exact-empty claim was false - is accepted as
  permanent fact and becomes the stated ground for the best-effort tier's own declaration:
  `scopeEmptyProof: false` and terminal `cancelled / emptiness-unproven` exist precisely because
  this finding's escape is real and undetectable by the retained mechanism. The closure
  obligation transforms accordingly: task 12.1's deletion duty becomes deletion of the PGID
  *exact claim* while the process-group mechanism survives as declared best-effort
  (`target-state.md:326-329`).
- **Verdict:** `leaves-with-parked-crates` for the exact-containment acceptance; the honesty
  residual is owed to the cutover.
- **Verification owed:** cutover independent review must prove no POSIX production path can mint
  an exact scope-empty or clean-cancel claim (the deleted vocabulary must be structurally
  unmintable from the best-effort scope, not merely unused); closure re-review confirms the
  rewritten 12.1. The real-OS escape oracles named by Step 1 travel to the upgrade path with the
  parked crates. Not closed: the finding's disproof is load-bearing for the declared tier and
  must be preserved, not archived away.

### RC-002 - Blocker - natural POSIX scope-empty waits forever on an unreaped supervisor zombie

- **Original text:** `evidence/review-report.md:53-74`. Core claim: "`is_empty(&self)` only
  calls `kill(-pgid, 0)` and never calls `try_wait`/`wait` ... On POSIX, the exited group leader
  remains a zombie and keeps the process group observable until its parent reaps it. The
  controller's `ROOT_EXIT` loop consequently cannot reach `SCOPE_EMPTY` for a naturally empty
  group." Confirmed on WSL: "`zombie_process_group_visible_before_wait=True`".
- **Prior dispositions:** round 1: no change, likely superseded by kernel-empty observation
  (`fix-round-1.md:81`). Step 1: NARROWS under (a) - the defective code is the PGID
  implementation 12.1 deletes; surviving acceptance was "exact natural empty on real Linux
  (namespace authority) and Windows (Job)" via task 12.5, with only the macOS proof leg leaving
  (`step1-scope-reconciliation.md:69, 90`).
- **Decision-13 re-grade:** the Step 1 narrowed residual is exactly what decision 13 removes.
  Exact scope-empty is no longer 0.2.0 acceptance on any OS: the hosted tier declares
  `scopeEmptyProof: false` on all three (`target-state.md:302-305`, acceptance rewrite at
  `target-state.md:140-145`), and the Linux namespace mechanism that was to furnish exact
  natural empty is parked (`target-state.md:315-319`). The defective code itself stops being
  constructed on POSIX (cutover routes POSIX to the best-effort scope, `proposal.md:7, 28`),
  and the legacy capsule's win32 side observes through Job queries, not `kill(-pgid, 0)`.
- **Verdict:** `superseded-by-decision-13`. Exact clause: the three-OS best-effort convergence
  with `scopeEmptyProof: false` plus the movement of kernel-enforced exact scope-empty to the
  upgrade path (`target-state.md:302-309`).
- **Verification owed (cutover independent review):** the finding's mechanism must not resurface
  as a liveness bug in the replacement: natural backend exit under the POSIX best-effort scope
  must reach a bounded, typed, declared-unproven terminal - never an unbounded wait keyed on an
  observation a zombie can pin. The proposal's "bounded grace keyed on whole-group emptiness ...
  bounded final observation" (`proposal.md:7`) is the claim to verify with a real natural-exit
  receipt on Linux (WSL) and a mutation proving the bound fires. Not closed: superseded findings
  stay on the record; the upgrade path inherits the WSL zombie-visibility probe as evidence.

### RC-003 - Blocker - replacement inspection reports closed while the exact controller lives

- **Original text:** `evidence/review-report.md:76-95`. Core claim: "Both POSIX branches return
  observation `2` (`closed`) when the reserved group is absent even if the controller birth
  still exactly matches ... An inspect/reconcile race can therefore clear the durable ref and
  writer claim while the source-owned controller still lives."
- **Prior dispositions:** round 1: no change, likely superseded by broker authority
  (`fix-round-1.md:82`). Step 1: LEAVES-UPGRADE-PATH under (a) - the defective branches are the
  one-shot replacement observation path, which is reattach/revalidation machinery decision 11
  moves wholesale to the upgrade path; the retained invariant "only positively observed
  emptiness may report closed" continues to bind the surviving live path
  (`step1-scope-reconciliation.md:70, 91`).
- **Decision-13 re-grade:** re-affirmed and made stronger. Decision 13 parks the crates that
  would have replaced this machinery, and the cutover stops constructing the legacy capsule's
  POSIX one-shot path at all (the defective branches are POSIX-specific:
  `native/process-capsule/src/main.rs:1151-1165, 1251-1265`). The Step 1 retained invariant
  transforms under the declared tier into "no receipt claims more than observed", which is
  checked under SEC-001 (live path) and RC-004 (one-shot reachability), not here.
- **Verdict:** `leaves-with-parked-crates` (upgrade-path machinery, per decision 11, unchanged
  by decision 13; its code anchor additionally leaves production construction on POSIX).
- **Verification owed:** none for 0.2.0; must be fixed with the retained criterion-4
  implementation before any future resumption of replacement recovery.

### RC-004 - Major - one-shot protocol parsing can crash the daemon

- **Original text:** `evidence/review-report.md:97-112`. Core claim: "the replacement
  `oneShotProbe` data callback does not [catch push failures] ... An oversized frame throws from
  an EventEmitter callback and can escape as an uncaught exception during startup
  reconciliation. Unknown or out-of-order frames are silently ignored until close/timeout rather
  than being rejected as a typed protocol failure."
- **Prior dispositions:** round 1: no change (`fix-round-1.md:83`). Step 1: LEAVES-UPGRADE-PATH
  under (a), with an explicit caveat: the finding's class (uncontained parser callback crashing
  the daemon instead of typed uncertainty) is an our-own-bug defence, so "if any one-shot-style
  probe survives in the provider-integrated ProcessScope this obligation resurfaces immediately
  as 0.2.0 acceptance" (`step1-scope-reconciliation.md:71, 92`); the one-shot probe
  (`native-process-scope.ts:329`) was named the cheapest early test of whether RC-003/RC-004
  actually left (`step1-scope-reconciliation.md:266-268`).
- **Decision-13 re-grade:** Step 1's caveat is now concrete and live. There is no
  provider-integrated ProcessScope, but the cutover keeps the unmodified legacy capsule client
  behind the win32 thin scope while leaving `host.ts` untouched (`proposal.md:8, 27`) - so
  whether startup reconciliation of a stored win32 ref can still reach `oneShotProbe` is an open
  code question that decides this finding's residence. On Windows, decision 11 plus
  `KILL_ON_JOB_CLOSE` should make stored-ref probing unnecessary (daemon death already tore the
  tree down), but "should" is not a receipt.
- **Verdict:** `leaves-with-parked-crates`, conditional on the named check.
- **Verification owed (cutover independent review):** prove the one-shot probe is unreachable
  from every shipped win32 code path (construction and startup reconciliation), or, if it
  remains reachable, RC-004 resurfaces immediately as open 0.2.0 acceptance of this Change and
  must be fixed (contained parser callback, typed phase-specific rejection, exactly one bounded
  observation) before closure can complete. This is the single highest-value grep of the
  cutover review.
- **Resolution note (2026-08-08):** the check was performed by the cutover independent review
  round 1 (`../ecp-hosted-best-effort-cutover/evidence/review-round-1.md`, finding F1). The
  probe IS reachable by design (cutover D4) and was exercised on a real host, so the
  conditional above resolved AGAINST the park: RC-004 is resurfaced 0.2.0 acceptance, with the
  parser-containment fix assigned to the cutover fix round. The closure residual is stated in
  `decision13-rescope-input.md` section 1. The conditional text above is preserved as the
  2026-08-07 record.

### RC-005 - Minor - exact-closed local clients remain retained forever

- **Original text:** `evidence/review-report.md:114-126`. Core claim: "`createNativeProcessScope`
  inserts every local client into `clients` at
  `src/core/session-host/process-capsule/native-process-scope.ts:424`, but no path deletes an
  entry after exact `SCOPE_EMPTY` ... A long-lived daemon that creates/retires many Sessions
  accumulates these objects without a bound."
- **Prior dispositions:** round 1: no change (`fix-round-1.md:84`). Step 1: SURVIVES-0.2.0 -
  a resident-client lifecycle leak inside one daemon lifetime, precisely the machinery Step 1
  keeps; task 12.8 (`step1-scope-reconciliation.md:72, 93`).
- **Decision-13 re-grade:** unchanged in substance, re-anchored in place. The resident client
  machinery survives on the win32 delegation path (the cutover delegates to the legacy capsule
  client unmodified), so the leak remains shipped 0.2.0 code; the terminal branch it keys on is
  renamed by the declared-unproven vocabulary but the lifecycle-release obligation is identical.
  Decision 13's rewritten closure acceptance ("finish the ProcessScope/host integration") still
  owns the fix.
- **Verdict:** `stays-0.2.0`.
- **Verification owed:** closure fix under rewritten task 12.8 plus closure re-review with a
  lifecycle test proving terminal entries are released while uncertain entries remain
  reconcilable; the cutover review should additionally confirm whether the POSIX best-effort
  scope holds an analogous per-scope retention that needs the same release rule.

## Accounting statement

Re-grades change which ledger a finding is carried on; they resolve nothing. SEC-001 remains an
open Blocker of this Change until the named discriminator exists, passes, and is independently
confirmed. RC-005 remains open 0.2.0 acceptance. RC-004's departure is conditional on a check
that has not yet been performed (2026-08-08: performed; the park failed - see the RC-004
resolution note above). SEC-002, SEC-003, RC-001, RC-002, and RC-003 stay on the
record with their re-entry conditions. The authority to close any of the above belongs to the
`ecp-hosted-best-effort-cutover` independent review and the closure re-review under the
rewritten acceptance, not to this document.
