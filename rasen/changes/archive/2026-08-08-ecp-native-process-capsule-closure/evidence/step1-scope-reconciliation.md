# Step 1 scope reconciliation: finding re-grading and task re-tiering

Change: `ecp-native-process-capsule-closure`
Date: 2026-08-07
Role: PLANNER (scope reconciliation), dispatched by the ECP-7 LEAD

## Method and governing decisions

- Every open finding was enumerated from this Change's own evidence files
  (`review-report.md`, `cso-report.md`, `fix-round-1.md`, `architecture-replan.md`,
  `implementation-baseline.md`, `handoff/implementer-1.md`, `handoff/fixer-1.md`) and graded
  from its full text in the originating report. Nothing was graded from a one-line summary,
  from run-state, or from a handoff note; lead-3's expectations were treated as claims and
  checked against the files (see Disagreements).
- Two independent 2026-08-07 re-gradings govern this document. They are kept distinct; a
  finding may leave for one reason, both, or neither:
  - **(a) Step 1 / locked decision 11 - daemon-lifetime scope.** Daemon death => scope death
    => in-flight action typed `execution-lost`; the Run resumes only from the last committed
    frontier. No reattach, no identity revalidation. Criterion 4 (replacement-safe identity)
    and everything downstream of it - opaque reference envelopes, identity binding whose
    purpose is surviving a daemon restart, pidfd reopen-and-revalidate, the
    `prepared -> published -> activate` three-phase protocol, registry v2 - move to the
    upgrade path (retained in git, not deleted). The privileged broker moved to 0.3.0.
  - **(b) Locked decision 12 - threat model.** The threat model is "we get it wrong
    ourselves", not "someone attacks us". Defences against our own mistakes stay; defences
    against a local attacker go (that attacker could already edit the local Run Record
    directly). Specifically retired as acceptance: production Ed25519 producer signing and
    private-key custody (superseded by transactional integrity); the `producerIsolation`
    capability field; byte-reproducible helper builds as a provenance claim
    (manifest-to-adjacent-binary hash/length integrity STAYS - it catches install
    corruption, a real failure); path-resolution TOCTOU hardening as acceptance.
  - **Explicitly retained regardless:** fail-closed typed uncertainty; capability honesty
    (`authority-unavailable` never silently reroutes); programmatic actor separation;
    containment and recursive termination of our own workers; complete-set evidence
    publication with re-read verification.
- **A re-grading changes whether a finding is still 0.2.0 acceptance; it never resolves the
  finding.** No verdict in this document closes anything.
- Also binding and verified here: closure `dependsOn` is `[linux, windows]`; the macOS edge
  was cut by Architecture Replan 4 and is not re-added by anything below.

Verdicts: `SURVIVES-0.2.0` | `LEAVES-UPGRADE-PATH` | `LEAVES-0.3.0-BROKER` | `NARROWS`
(survives with shrunk acceptance) | `SUPERSEDED`. Governing reason: `(a)`, `(b)`,
`(a)+(b)`, or `none`.

## Enumeration result

The open finding set of this Change is **eight findings**: `SEC-001..003` (origin:
`cso-report.md`, canonical severities Blocker / Major / Major) and `RC-001..005` (origin:
`review-report.md`, Blocker / Blocker / Blocker / Major / Minor). Cross-checked against
`fix-round-1.md` (finding-by-finding table, 0/8 resolved), `handoff/fixer-1.md` ("Findings
remaining: SEC-001, SEC-002, SEC-003, RC-001, RC-002, RC-003, RC-004, RC-005"), and
`architecture-replan.md` ("The following findings remain open").

**This set is one larger than the `SEC-001..003` + `RC-002..005` hint in lead-3 next-action
item 2: `RC-001` is an open finding of this Change and is graded below.** The five inherited
findings `S1..S5` (from `implementation-baseline.md`, originating in the escalated
`ecp-durable-agent-session-host` review) are graded in Table A.2: their repairs are this
Change's tasks 1-8 and their independent confirmation (tasks 9.3-9.5) is still open, so the
re-gradings materially affect what that confirmation must cover.

## Table A.1 - open findings

| Finding | Severity | Verdict | Reason | Anchored justification |
| --- | --- | --- | --- | --- |
| SEC-001 | Blocker | SURVIVES-0.2.0 | none | Its own text: "a typed uncertain native result becomes an authoritative clean detach at the next layer" and "A later restart/new admission can acquire a new writer while the old descendant continues running." The trigger is controller/control-pipe loss inside a live daemon, not daemon death, so (a) does not reach it; it is a defect in our own close translation, not an attacker defence, so (b) retains it twice over ("fail-closed typed uncertainty"; "containment ... of our own workers"). Fix seam moves to the provider-integrated ProcessScope (task 12.2). |
| SEC-002 | Major | SUPERSEDED | (b) | Its own exploit needs "A compromised extraction/staging step or local package-tree attacker [who] replaces the whole dist/native/process-capsule directory with a junction to an attacker-controlled directory" - an actor who can already write arbitrary content inside the installed package, i.e. exactly the local attacker decision 12 rules out. Decision 12 names "symlink/junction redirection" verbatim among the retired path-hardening items. The retained manifest-to-adjacent-binary hash/length integrity is NOT this finding: the attack supplies a self-consistent manifest+helper pair, so it defeats an attacker, not install corruption. |
| SEC-003 | Major | SUPERSEDED | (a)+(b) | Its own exploit: "A concurrent actor watching the registry renames P and replaces that name with a symlink/junction to attacker-controlled directory Q before ACTIVATE." (b): "cwd redirection between validation and spawn" is named verbatim among decision 12's retired TOCTOU items. (a): the exploited window exists only because the ProcessRef is "durably published" before ACTIVATE - the `prepared -> published -> activate` protocol and the watchable registry both move to the upgrade path, so the wide barrier window the finding races disappears with them. |
| RC-001 | Blocker | SUPERSEDED | none | Its own text: "The backend root ... can call setsid()/setpgid() ... after which the controller can observe the reserved group as empty and emit SCOPE_EMPTY while a worker descendant still runs outside it." Superseded on 2026-08-04 by the architecture replan, before and independent of both re-gradings: the PGID authority it disproves is abandoned (deletion is closure task 12.1, unrevised) and the containment acceptance moved to the provider Changes (Linux user+PID namespace 11.3/11.4; Windows Job 11.14/11.15). Both re-gradings re-affirm it: Step 1 keeps "Windows must use the Job Object" and "Linux must keep the PID namespace, no PGID regression", and under (b) the escapee is our own worker detaching - the janitor case itself. |
| RC-002 | Blocker | NARROWS | (a) | Its own text: "is_empty(&self) only calls kill(-pgid, 0) and never calls try_wait/wait ... The controller's ROOT_EXIT loop consequently cannot reach SCOPE_EMPTY for a naturally empty group." The defective code is the PGID implementation task 12.1 deletes; task 12.5 already re-scopes acceptance to "exact natural empty under the selected authority". Under (a) the selected Linux mechanism is the guardian as namespace init with emptiness by blocking waitpid - the kernel reaps namespace init last, which directly answers the zombie-visibility premise this finding proved on WSL. Surviving acceptance: exact natural empty on real Linux (namespace authority) and Windows (Job). The macOS half of its required fix ("Run the natural-empty oracle on real Linux and macOS") leaves: macOS hosted is declared best-effort with `scopeEmptyProof: false` and terminal `cancelled / emptiness-unproven` (decision 10 had already moved macOS durable proof to 0.3.0). |
| RC-003 | Blocker | LEAVES-UPGRADE-PATH | (a) | Its own text: "Both POSIX branches return observation 2 (closed) when the reserved group is absent even if the controller birth still exactly matches ... An inspect/reconcile race can therefore clear the durable ref and writer claim while the source-owned controller still lives." The defective branches are the one-shot replacement observation path - reattach/revalidation machinery decision 11 moves wholesale to the upgrade path ("No reattach, no identity revalidation"). Under Step 1 a later daemon never inspects a stored ref: daemon death already tore the scope down by kernel guarantee. The retained invariant that only positively observed emptiness may report closed continues to bind the surviving live path (SEC-001 / tasks 12.2, 12.5). |
| RC-004 | Major | LEAVES-UPGRADE-PATH | (a) | Its own text: "the replacement oneShotProbe data callback does not [catch push failures] ... An oversized frame throws from an EventEmitter callback and can escape as an uncaught exception during startup reconciliation." The one-shot probe exists only to inspect/terminate a stored ref with no live client (`native-process-scope.ts:481`, `:513`) - startup reconciliation of old refs is criterion-4 machinery. Caveat recorded: the finding's class (uncontained parser callback crashing the daemon instead of typed uncertainty) is an our-own-bug defence, so if any one-shot-style probe survives in the provider-integrated ProcessScope this obligation resurfaces immediately as 0.2.0 acceptance. |
| RC-005 | Minor | SURVIVES-0.2.0 | none | Its own text: "no path deletes an entry after exact SCOPE_EMPTY ... A long-lived daemon that creates/retires many Sessions accumulates these objects without a bound." A resident-client lifecycle leak inside one daemon lifetime - precisely the machinery Step 1 keeps; irrelevant to (b). Task 12.8. |

## Table A.2 - inherited S1-S5 findings (repairs implemented; independent confirmation open)

| Finding | Severity | Verdict | Reason | Anchored justification |
| --- | --- | --- | --- | --- |
| S1 | Major | LEAVES-UPGRADE-PATH | (a) | "The macOS proc_uniqidentifierinfo declaration is 40 bytes instead of the required 56-byte XNU ABI." Repair implemented (56-byte binding, compile-time assertions). Its consumer left 0.2.0 twice: macOS durable authority to 0.3.0 (locked decision 10 / Replan 4, prior to these re-gradings; the spec requirement was already annotated decision-gated on 2026-08-04) and identity revalidation to the upgrade path under (a). The best-effort macOS tier consumes no kernel birth identity. |
| S2 | Major | SURVIVES-0.2.0 | none | "Backend-root EXIT is treated as whole-scope closure, so authority can be cleared while descendants remain." Root-exit vs scope-empty is the janitor core, retained by both decisions; its residual defect is SEC-001. |
| S3 | Major | LEAVES-UPGRADE-PATH | (a) | "POSIX replacement termination controls only the controller and cannot exactly reap a surviving reserved supervisor group." Replacement cleanup is criterion-4 machinery; the PGID mechanism beneath it was additionally superseded on 2026-08-04. |
| S4 | Major | NARROWS | (a) | "ACTIVATE and prepared abort acknowledgements have no bounded control deadline." Bounded control with typed uncertainty is retained fail-closed acceptance, but the two named phases belong to the `prepared -> published -> activate` protocol that leaves under (a). Surviving acceptance: every control phase present in the Step 1 design (spawn/start, inspect, terminate, scope-empty observation) is bounded with typed phase-specific uncertainty. |
| S5 | Minor | NARROWS | (b) | "Adjacent artifact integrity is proven, but source-identical Windows builds did not prove byte reproducibility." Under (b) the byte-reproducibility branch of its "either prove byte-identical or narrow the claim" disjunct is permanently retired as a provenance claim; the implemented narrowing (`provenance-audit.md`) is the surviving half. Manifest-to-adjacent-binary hash/length integrity stays 0.2.0 acceptance. |

## Not closed - restated per finding

- SEC-001 is NOT closed: it remains open 0.2.0 acceptance, to be fixed at the provider-integrated seam (12.2) and confirmed by fresh non-author review.
- SEC-002 is NOT closed: it is re-graded out of 0.2.0 acceptance by locked decision 12; it stays on the record and re-enters acceptance if the deployment/threat model ever changes (e.g. multi-user or hosted deployment).
- SEC-003 is NOT closed: it is re-graded out of 0.2.0 acceptance by decisions 11 and 12; same re-entry condition as SEC-002, plus any revival of pre-activation durable publication.
- RC-001 is NOT closed: its acceptance lives on in the provider Changes' real-OS escape oracles and in closure's unrevised PGID-deletion obligation (12.1).
- RC-002 is NOT closed: exact natural empty on real Linux and Windows is still owed under the selected authority (12.5); only the macOS proof leg left.
- RC-003 is NOT closed: it travels with the retained criterion-4 implementation and must be fixed there before any future resumption of replacement recovery.
- RC-004 is NOT closed: it travels with the one-shot probe to the upgrade path and resurfaces as 0.2.0 acceptance if any one-shot-style probe survives integration.
- RC-005 is NOT closed: the client-map lifecycle leak remains open 0.2.0 acceptance (12.8).
- S1 is NOT closed: the implemented repair is retained in git; its independent confirmation travels with the upgrade path.
- S2 is NOT closed: its confirmation is still owed by the open fresh non-author reviews (9.3-9.5).
- S3 is NOT closed: same as S1 - retained implementation, confirmation travels with the upgrade path.
- S4 is NOT closed: bounded-control acceptance for the surviving phases still requires confirmation on the integrated tree.
- S5 is NOT closed: the manifest-adjacent integrity half still requires independent confirmation (9.3-9.5).

## Table B - task re-tiering (96 tasks; checkboxes untouched; verdicts grade the forward obligation, completed history stays valid provenance)

| Task | Status | Verdict | Reason | Note |
| --- | --- | --- | --- | --- |
| 1.1 | done | SURVIVES-0.2.0 | none | Baseline provenance; unaffected. |
| 1.2 | done | NARROWS | (a) | Compile-assertion and deterministic tests remain retained code; the "runnable unchanged by ECP-8" macOS identity oracle is no longer an ECP-8 obligation (macOS durable -> 0.3.0; identity binding -> upgrade path). |
| 1.3 | done | SURVIVES-0.2.0 | none | Root-exit/detached-descendant RED is janitor-core evidence. |
| 1.4 | done | LEAVES-UPGRADE-PATH | (a) | Replacement suite tracks criterion-4 machinery; its ECP-8 clause is void. |
| 1.5 | done | NARROWS | (a) | Activate/abort hung-controller modes travel with the three-phase protocol; the bounded-control mutation pattern survives for retained phases. |
| 1.6 | done | NARROWS | (b) | Survives as the no-byte-reproducibility-claim guard plus adjacent-integrity assertion; the prove-bytes-identical branch is permanently retired. |
| 1.7 | done | SURVIVES-0.2.0 | none | RED baseline capture; provenance. |
| 1.8 | done | SURVIVES-0.2.0 | none | Residue hygiene; provenance. |
| 2.1 | done | SURVIVES-0.2.0 | none | Distinct close/control outcome types are retained acceptance. |
| 2.2 | done | SURVIVES-0.2.0 | none | Exact protocol/manifest capability matching is capability honesty; 12.1 revs it again atomically. |
| 2.3 | done | NARROWS | none | ROOT_EXIT vs terminal SCOPE_EMPTY semantics survive; the "whole-group" (PGID) empty observer beneath them was superseded 2026-08-04 and is replaced by provider authority. |
| 2.4 | done | SURVIVES-0.2.0 | none | Typed uncertainty on controller/pipe loss before scope-empty is retained fail-closed acceptance. |
| 2.5 | done | SURVIVES-0.2.0 | none | Transport root-exit handling is where the SEC-001 fix lands (12.2). |
| 2.6 | done | SURVIVES-0.2.0 | none | Host clears authority only on exact scope-empty; retained. |
| 2.7 | done | SURVIVES-0.2.0 | none | Deterministic adapter transitions; retained. |
| 2.8 | done | SURVIVES-0.2.0 | none | Gate receipt; provenance. |
| 3.1 | done | LEAVES-UPGRADE-PATH | (a) | 56-byte binding retained in git; no 0.2.0 consumer (macOS durable -> 0.3.0 per decision 10; identity binding -> upgrade path). |
| 3.2 | done | LEAVES-UPGRADE-PATH | (a) | Travels with 3.1. |
| 3.3 | done | LEAVES-UPGRADE-PATH | (a) | Travels with 3.1. |
| 3.4 | done | LEAVES-UPGRADE-PATH | (a) | Deterministic branches and the actual-macOS collision oracle travel with 3.1. |
| 3.5 | done | LEAVES-UPGRADE-PATH | (a) | The recorded "mandatory ECP-8 actual-macOS acceptance command" is void; ECP-8's macOS receipts are now the in-tool receipt plus best-effort honesty receipt (roadmap ECP-8, OS x backend matrix). |
| 4.1 | done | LEAVES-UPGRADE-PATH | (a) | Opaque ref binding controller/supervisor births plus reserved PGID is the identity envelope of criterion 4; PGID content additionally superseded 2026-08-04. |
| 4.2 | done | LEAVES-UPGRADE-PATH | (a) | "pidfd reopen-and-revalidate" is named verbatim in decision 11 as upgrade-path machinery. |
| 4.3 | done | LEAVES-UPGRADE-PATH | (a) | macOS replacement inspection; also macOS durable -> 0.3.0. |
| 4.4 | done | LEAVES-UPGRADE-PATH | (a) | Post-controller-loss group termination is replacement machinery over the superseded PGID model. |
| 4.5 | done | LEAVES-UPGRADE-PATH | (a) | PID-reuse/replacement race discriminators are criterion-4 evidence. |
| 4.6 | done | LEAVES-UPGRADE-PATH | (a) | The recorded actual-Linux ECP-8 command proves replacement semantics that left 0.2.0; superseded by the new Linux receipts (zero-orphan daemon-death teardown, `execution-lost`, exact empty under namespace authority). |
| 4.7 | done | LEAVES-UPGRADE-PATH | (a) | Same as 4.6 for macOS, plus decision 10. |
| 5.1 | done | SURVIVES-0.2.0 | none | One bounded-control helper with typed phase outcomes is retained acceptance. |
| 5.2 | done | NARROWS | (a) | activate() belongs to the three-phase protocol; the bounded typed-timeout pattern survives for the surviving start path. |
| 5.3 | done | NARROWS | (a) | Same for prepared abort(). |
| 5.4 | done | SURVIVES-0.2.0 | none | Bounded live terminate and scope-empty observation are janitor core. |
| 5.5 | done | NARROWS | (a) | Withheld-ACTIVATE/abort modes travel with their phases; withheld-terminate mode survives. |
| 5.6 | done | SURVIVES-0.2.0 | none | Gate receipt; provenance. |
| 6.1 | done | SURVIVES-0.2.0 | none | Claim audit; provenance. |
| 6.2 | done | SURVIVES-0.2.0 | none | Per-artifact integrity plus build-input provenance is exactly the half decision 12 retains; (b) makes the narrowing permanent rather than optional. |
| 6.3 | done | SURVIVES-0.2.0 | none | Isolated-build seam supports the retained integrity contract. |
| 6.4 | done | NARROWS | (b) | Remains only as the no-claim guard; two-build equality can never again be promoted toward a reproducibility acceptance. |
| 6.5 | done | SURVIVES-0.2.0 | none | Manifest-to-binary length/SHA verification is explicitly retained by decision 12. |
| 7.1 | done | SURVIVES-0.2.0 | none | Windows unnamed kill-on-close Job with one non-inherited handle is Step 1 non-negotiable 1. |
| 7.2 | done | SURVIVES-0.2.0 | none | Real Windows controller-death/duplicate-handle/early-activation oracles; retained. |
| 7.3 | done | NARROWS | (a) | Fail-closed migration and v1 byte preservation survive as data-safety discipline; registry v2's publish-for-replacement role moves to the upgrade path per decision 11. |
| 7.4 | done | SURVIVES-0.2.0 | none | Version-mismatch fail-closed tests protect against our own mixed-binary mistakes; 12.1's re-rev needs them. |
| 7.5 | done | SURVIVES-0.2.0 | none | Resolver negatives and the no-weak-fallback assertions are capability honesty; note the SEC-002 ancestor-junction EXTENSION is retired under (b), the existing negatives stay. |
| 7.6 | done | SURVIVES-0.2.0 | none | Gate receipt; provenance. |
| 8.1 | done | SURVIVES-0.2.0 | none | Gate receipt; rerun on the integrated tree via 12.9. |
| 8.2 | done | SURVIVES-0.2.0 | none | Same. |
| 8.3 | done | SURVIVES-0.2.0 | none | Same. |
| 8.4 | done | SURVIVES-0.2.0 | none | Same. |
| 8.5 | done | SURVIVES-0.2.0 | none | Cross-target checks stay compile-only evidence. |
| 8.6 | done | SURVIVES-0.2.0 | none | Package/manifest gate; retained integrity contract. |
| 8.7 | done | SURVIVES-0.2.0 | none | Full-root/UI receipts; provenance. |
| 8.8 | done | SURVIVES-0.2.0 | none | Residue audit; provenance. |
| 9.1 | done | SURVIVES-0.2.0 | none | Implementation report; provenance. |
| 9.2 | done | NARROWS | (a) | Completion stands as history, but `platform-obligations.md` is now substantially void as ECP-8 input: its actual-Linux/macOS commands prove replacement/identity machinery that left 0.2.0. ECP-8 must consume the roadmap's OS x backend matrix plus zero-orphan/`execution-lost` receipts instead. |
| 9.3 | open | NARROWS | (b) | Fresh non-author security review still required; its listed scope loses "cwd retargeting" (SEC-003 class) and TOCTOU path-hardening items; root-exit authority retention, Windows last-handle, timeout uncertainty, helper integrity, command injection, and secret leakage stay. |
| 9.4 | open | NARROWS | (a) | Fresh code/spec review still required; its "S1-S5" scope must follow Table A.2 (S1/S3 content now upgrade-path provenance, not acceptance). |
| 9.5 | open | SURVIVES-0.2.0 | none | Post-fix gate rerun and final verdicts; mechanics unchanged. |
| 9.6 | done | SURVIVES-0.2.0 | none | Diff-ownership audit; provenance, repeated implicitly at 12.9/12.10. |
| 9.7 | open | SURVIVES-0.2.0 | none | Local ship; unchanged. |
| 9.8 | open | SURVIVES-0.2.0 | none | Archive; unchanged. |
| 9.9 | open | SURVIVES-0.2.0 | none | Parent return without marking host delivered; unchanged. |
| 9.10 | open | NARROWS | (a) | The "mandatory real three-OS acceptance" it preserves is re-shaped: OS x backend matrix; macOS = real in-tool receipt plus best-effort honesty receipt; Linux/Windows add zero-orphan daemon-death and `execution-lost` receipts. The blocking rule itself stands. |
| 10.1 | done | SURVIVES-0.2.0 | none | Immutable review/replan history; provenance. |
| 10.2 | done | SURVIVES-0.2.0 | none | Replan research record; provenance and 0.3.0 input. |
| 10.3 | done | SURVIVES-0.2.0 | none | Records the then-current defer decision; superseded facts are annotated by later replans, the record itself stands. |
| 10.4 | done | SURVIVES-0.2.0 | none | The four prerequisite Changes were created; provenance. |
| 10.5 | done | SUPERSEDED | none | The three-provider DAG it records was re-projected by Replan 4 (decision 10): closure `dependsOn` is `[linux, windows]`; the macOS edge is cut and must not be re-added. History intact. |
| 10.6 | done | SUPERSEDED | none | Its "only all three terminal providers" re-entry rule is likewise re-projected to two providers by Replan 4. History intact. |
| 11.1 | open | SURVIVES-0.2.0 | none | Delivered by `ecp-platform-process-authority-foundation` (done/shipped/archived); this row is projection bookkeeping, not closure-owned work. |
| 11.2 | open | SURVIVES-0.2.0 | none | Same as 11.1. |
| 11.3 | open | SURVIVES-0.2.0 | none | Owned by the Linux provider; the setsid escape oracle is the retained containment core and still owes real WSL receipts. |
| 11.4 | open | SURVIVES-0.2.0 | none | Owned by the Linux provider; user+PID namespace guardian is Step 1 non-negotiable 2. |
| 11.5 | open | NARROWS | (a) | The disabled-namespace/typed-unavailable probe mutations survive (unavailability matrix stays); the forged/stale broker-token mutations leave with the broker to 0.3.0. |
| 11.6 | open | NARROWS | (a) | The PREPARE availability probe returning typed `authority-unavailable` survives (capability honesty); the authenticated installed-broker fallback leaves to 0.3.0 with the broker. |
| 11.7 | open | NARROWS | (a) | Daemon-death legs collapse to scope death with zero-orphan teardown and `execution-lost`; "surviving authority" after daemon death and broker legs leave; guardian-death kernel-teardown receipts stay. |
| 11.8 | open | LEAVES-UPGRADE-PATH | (a) | "Exact Linux replacement recovery using boot/start identity, pidns inode, pidfd and broker/cgroup token" is criterion 4 verbatim. |
| 11.9 | open | SUPERSEDED | none | macOS durable authority moved wholesale to 0.3.0 (decision 10); the reopened macOS child is a NEW narrow best-effort provider (POSIX process groups, declared `exactCancel: false`/`scopeEmptyProof: false`, terminal `cancelled / emptiness-unproven`) to be proposed separately - these placeholder rows do not become its ledger. Not closed: 0.3.0 owns the durable research. |
| 11.10 | open | SUPERSEDED | none | Same as 11.9. |
| 11.11 | open | SUPERSEDED | none | Same as 11.9. |
| 11.12 | open | SUPERSEDED | none | Same as 11.9; its "never false scope-empty" principle reappears as the best-effort provider's honesty acceptance. |
| 11.13 | open | SUPERSEDED | none | Same as 11.9; no entitlement/signing/VM packaging exists in 0.2.0. |
| 11.14 | open | SURVIVES-0.2.0 | none | Owned by the Windows provider; breakaway/last-handle mutations retained. |
| 11.15 | open | SURVIVES-0.2.0 | none | Owned by the Windows provider; Job non-negotiable. |
| 11.16 | open | NARROWS | (a) | Survives for Linux/Windows exact-empty/recursive-terminate/unavailable/unrelated-survival/bounded-settlement on real OS ("one provider cannot satisfy another's gate" stays); the "one-authority death/recovery" recovery leg leaves (death now proves teardown, not recovery); the macOS leg is replaced by best-effort honesty evidence. |
| 11.17 | open | NARROWS | (a) | Runner/command obligations re-shape to the OS x backend matrix plus zero-orphan/`execution-lost` receipts; cross-target stays labelled non-runtime. |
| 12.1 | open | NARROWS | none | The "explicitly selected macOS providers are all terminal" precondition is void: closure `dependsOn` is `[linux, windows]` (Replan 4 / decision 10, prior to these re-gradings) and the macOS edge must not be re-added. The core work - integrate provider contracts, rev protocol/manifest atomically, delete or hard-disable PGID authority/fallback, RED-to-GREEN mismatch/rollback coverage - stands unrevised. PGID deletion does not touch the in-tool path (verification note below). |
| 12.2 | open | SURVIVES-0.2.0 | none | SEC-001 fix; retained acceptance. |
| 12.3 | open | SUPERSEDED | (b) | SEC-002's hardening is no longer 0.2.0 acceptance; the finding is not closed (see restatement). |
| 12.4 | open | SUPERSEDED | (a)+(b) | SEC-003's hardening is no longer 0.2.0 acceptance; the finding is not closed. |
| 12.5 | open | NARROWS | (a) | RC-002: exact natural empty still owed on real Linux/Windows under the selected authority; the macOS proof leg left. |
| 12.6 | open | LEAVES-UPGRADE-PATH | (a) | RC-003 travels with replacement observation to the upgrade path. |
| 12.7 | open | LEAVES-UPGRADE-PATH | (a) | RC-004 travels with the one-shot probe; resurfaces if any one-shot-style probe survives integration. |
| 12.8 | open | SURVIVES-0.2.0 | none | RC-005 client-map lifecycle fix; retained. |
| 12.9 | open | SURVIVES-0.2.0 | none | Gate rerun plus fresh independent reviews; scope follows the re-tiered acceptance set. |
| 12.10 | open | SURVIVES-0.2.0 | none | Local ship/archive/parent-return sequencing; unchanged. |

Task verdict counts: SURVIVES-0.2.0 51; NARROWS 20; LEAVES-UPGRADE-PATH 16; SUPERSEDED 9;
LEAVES-0.3.0-BROKER 0 (no whole task leaves purely with the broker; the broker halves of
11.5/11.6 are annotated inside their NARROWS rows).

## Disagreements and evidence discrepancies

1. **lead-3's finding list for this Change omits `RC-001`.** lead-3 next-action item 2 says
   "determine which of `SEC-001..003` and `RC-002..005` survive". The Change's own evidence
   enumerates eight open findings including RC-001: `architecture-replan.md` ("The following
   findings remain open ... RC-001 Blocker"), `handoff/fixer-1.md` ("Findings remaining:
   SEC-001, SEC-002, SEC-003, RC-001, RC-002, RC-003, RC-004, RC-005"), and the roadmap's
   current-position row ("RC-001..005, SEC-001..003"). The likely cause is Replan 4's
   ownership sentence, which lists closure's residuals as SEC-001..003 + RC-002..005 because
   RC-001's remedy is owned by the providers - but as an open finding of this Change it
   still had to be enumerated and graded (done above: SUPERSEDED, not closed).
2. **lead-3's claim that SEC-002/SEC-003 are "specifically the TOCTOU path-hardening
   findings" is confirmed, with one wording precision.** SEC-003 is a literal
   validation-to-spawn TOCTOU race. SEC-002's own text is not a race: the junction is in
   place before resolution begins ("replaces the whole dist/native/process-capsule directory
   with a junction" prior to resolution). It still falls squarely inside decision 12's
   retired item, which names "symlink/junction redirection" as its own clause, not only as a
   race - so the outcome is identical; only the "TOCTOU" label is imprecise for SEC-002.
3. **Internal evidence severity discrepancy.** `architecture-replan.md` lists SEC-002 and
   SEC-003 as "Blocker"; the originating `cso-report.md` records canonical severity Major
   for both (its summary table and per-finding "Canonical severity" lines), and
   `fix-round-1.md`'s table agrees (Major). This document grades from the originating
   report: Major.
4. **The PGID/in-tool construction claim is true in substance but not literally.** See the
   verification note below: `createNativeProcessScope` has two construction sites beyond
   `router.ts`, both internal default fallbacks reachable only through factories whose sole
   `src/` caller is `router.ts`.

No other file-level reading contradicted lead-3.

## Verification note - PGID deletion does not touch the in-tool execution path

Checked in code on 2026-08-07, this worktree:

- `createSessionHost` is defined at `src/core/session-host/host.ts:293` and invoked in
  `src/` only at `src/core/management-api/router.ts:642`.
- `createNativeProcessScope` is defined at
  `src/core/session-host/process-capsule/native-process-scope.ts:378` and constructed at
  three sites: directly at `src/core/management-api/router.ts:639`, and as internal default
  fallbacks at `src/core/session-host/host.ts:299` (inside `createSessionHost`) and
  `src/core/session-host/claude-backend.ts:395` (inside `createClaudeSessionBackend`).
  `createClaudeSessionBackend` is invoked in `src/` only at
  `src/core/management-api/router.ts:649`. So every construction path in `src/` roots in
  `src/core/management-api/router.ts` - the literal "nowhere except router.ts" claim is
  false for the two fallback call sites, true for the reachable entry points.
- `src/core/templates/` (including `_orchestration.ts`) contains zero references to
  `session-host`, `ProcessScope`, or `process-capsule`. The only other `session-host`
  import under `src/core/management-api/` is type-only
  (`hosted-sessions.ts:6`, from `contracts.js`).

Conclusion verified: the LEAD's in-tool (Tier A) dispatch path never enters ProcessScope,
so deleting PGID process authority (task 12.1) does not touch the in-tool execution path.
Closure's PGID-deletion obligation stands unrevised, and closure `dependsOn` remains
`[linux, windows]` with no macOS edge re-added.

## Durable planning notes

- `evidence/platform-obligations.md` must not be consumed as-is by ECP-8: its recorded
  actual-Linux/macOS commands validate replacement/identity machinery that left 0.2.0.
  ECP-8's obligations are the roadmap's OS x backend matrix plus zero-orphan daemon-death
  and `execution-lost` receipts.
- The one-shot probe (`native-process-scope.ts:329`) is the single code anchor for both
  RC-003 and RC-004; whether it survives provider integration is the cheapest early test of
  whether those two findings actually left 0.2.0.
