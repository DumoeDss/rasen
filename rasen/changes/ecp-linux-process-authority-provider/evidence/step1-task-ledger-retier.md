# Step 1 task-ledger re-tier - ecp-linux-process-authority-provider

Date: 2026-08-07
Author: planner (task-ledger re-tiering), leaf worker; report-only plus the tasks.md scope markers
described at the end. No checkbox was ticked or unticked, no task text was rewritten, no finding
is closed, no run-state was touched.

## Method

Every verdict below was graded from the ACTUAL task text (`tasks.md`, all 125 lines / 93 tasks
read line by line: 75 `[x]`, 18 `[ ]`) and the ACTUAL finding text in the named evidence files.
Grading from finding summaries, run-state summaries, or handoff notes was not used; the Direction
documents record that prohibition as mandatory. Statements of expected outcome in
`handoff/lead-3.md` were treated as claims to verify against the files; the places where the
file-level reading differs are in the Disagreements section.

Read in full for this record:

- `handoff/lead-3.md`, `handoff/lead-2.md`
- Direction: `target-state.md` (locked decisions 11 and 12), `roadmap.md`, and the
  `session-execution-and-self-hosting` slice `spec.md` / `plan.md` (Architecture Replans 4 and 5,
  threat-model correction) / `result.md`
- `tasks.md` (all 93 tasks)
- `evidence/lead2-implementation-wave-findings.md` (F-L2-01 .. F-L2-22, each in full)
- `evidence/review-report-native-primary-seam-round-1.md` (NATIVE-SEAM-R1-M01/M02 as filed)
- `evidence/wsl-primary-gate-round-4.md` (WSL-R4-M00 .. M06 as filed) and
  `evidence/review-report-wsl-topology-round-4.md` (M02/M03 closure, confirming the open five)
- `evidence/review-report-native-broker-round-2.md` (BRK-R2-B01..B07 as filed),
  `evidence/review-report-native-broker-round-3.md` (current BRK-R2-B02 / BRK-R2-B06 / BRK-R2-B01
  residual), `evidence/review-report-native-broker-delivery-round-4.md` (current BRK-R2-B02-M03)
- `evidence/review-report-package-ci-round-1.md` (P5 as filed) and `-round-2.md` (P5 HOLD),
  `evidence/wsl-native-build-manifest-lead2.md` (task 7.2 re-emit)
- `evidence/direction-replan-input-broker-to-0-3-0.md`

## Governing decisions

**(a) Step 1 / locked decision 11 - scope lifetime = daemon lifetime.** Daemon death => scope
death => in-flight action typed `execution-lost` => the Run resumes only from the last committed
frontier; no reattach, no identity revalidation. Criterion 4 (replacement-safe identity) and what
exists only for it - the durable reattach purpose of the opaque reference envelope, identity
binding for the purpose of surviving a daemon restart, pidfd reopen-and-revalidate as a
resume-after-daemon-death mechanism, the prepared -> published -> activate three-phase protocol,
registry v2 - moves to the upgrade path: retained in git, not deleted, no history rewritten.
This record also groups under (a) the broker-to-0.3.0 handover (the authenticated installed
broker / non-migratable cgroup-v2 path leaves 0.2.0; Section 9's environment gate leaves the
0.2.0 critical path). Strictly that handover is a distinct scope decision, staged in
`evidence/direction-replan-input-broker-to-0-3-0.md` and recorded alongside Step 1 in the slice
plan's Architecture Replan 5 and locked decision 11's upgrade-path clause; it is grouped under
(a) here per the re-tier contract, and rows state which of the two applies.

**(b) Locked decision 12 - the threat model is "we get it wrong ourselves", not "someone attacks
us".** Defences against our own mistakes stay; defences against a local attacker go (that
attacker could already edit the local Run Record directly). Retired as acceptance: production
Ed25519 producer signing and private-key custody (transactional integrity replaces it);
`producerIsolation`; byte-reproducible helper builds as a provenance claim (the F-L2-15 fix is
NOT rolled back; manifest-to-adjacent-binary hash/length integrity STAYS - it catches install
corruption, a real failure); path-resolution TOCTOU race hardening.

**Explicitly retained regardless of either decision:** fail-closed typed uncertainty; capability
honesty (`authority-unavailable` never silently reroutes); programmatic actor separation;
containment and recursive termination of our OWN workers; complete-set evidence publication with
re-read verification; the exact-scope-empty measurement.

**Carve-out honoured:** `BRK-R2-B06` does not move whole; its primary-path analogue stays in
0.2.0 (split given in Table B).

**Boundary:** shipped and archived ECP-6 work is not rolled back. What changed is which NEW
evidence ECP-7 and later must establish. "Sections 1-8 and 10-11 stand as written" (broker replan
input) is honoured: no gate inside them is relaxed and no text is altered; the verdicts below
record which release line owes their remaining verification, nothing else.

## Verdict vocabulary

- `STAYS-0.2.0` - unchanged 0.2.0 scope.
- `NARROWS` - stays, but its 0.2.0 acceptance shrinks; the row says how.
- `MOVES-UPGRADE-PATH` - criterion-4 machinery; retained in git, no longer 0.2.0 acceptance.
- `MOVES-0.3.0-BROKER` - broker/cgroup-v2 path; retained in git, delivered by the 0.3.0 item.
- `SUPERSEDED` - overtaken entirely by a later decision (no whole task earned this token; the
  stale clauses inside 11.11 are noted in its row).

Counts: STAYS-0.2.0 45, NARROWS 23, MOVES-0.3.0-BROKER 20, MOVES-UPGRADE-PATH 5, SUPERSEDED 0.

## Table A - all 93 tasks

| Task | Tick | Verdict | Reason | Anchored justification |
| --- | --- | --- | --- | --- |
| 1.1 | [x] | STAYS-0.2.0 | none | Baseline recording ("implementation start HEAD ... architecture-replan digest") is historical fact; no acceptance changes. |
| 1.2 | [x] | STAYS-0.2.0 | none | The guard that this Change "consumes both unchanged" (accepted common spec + conformance helper) still governs the retained primary surface. |
| 1.3 | [x] | NARROWS | (a) | The file map "assigns ... broker service/install assets"; those assignments are now 0.3.0-owned surface. TS adapter, native helper, manifests, tests, evidence assignments unchanged. |
| 1.4 | [x] | STAYS-0.2.0 | none | The guard that provider work "does not silently reinterpret `pidfd + process-group` as exact authority" is the no-PGID-retreat red line, kept by Step 1's non-negotiables. |
| 1.5 | [x] | STAYS-0.2.0 | none | Recorded environment facts (including "the hybrid cgroup layout whose v2 mount lacks required controllers") are the evidentiary ground of the broker handover; recording tasks do not move. |
| 1.6 | [x] | NARROWS | (a) | Of the named gates, "real cgroup-v2 broker runtime" moves to 0.3.0 with the broker; the "no narrower receipt can close a broader gate" discipline and the other five gate records stay. |
| 2.1 | [x] | NARROWS | (a) | Covers both descriptors; `rasen.linux.broker-pidns-cgroupv2` coverage accompanies the 0.3.0 broker; `rasen.linux.user-pidns` coverage stays. |
| 2.2 | [x] | STAYS-0.2.0 | none | "primary unavailability never selects or contacts the broker" is capability honesty (never silently reroute), explicitly retained; with the broker in 0.3.0, an exact broker tuple must still fail typed rather than probe the primary. |
| 2.3 | [x] | NARROWS | (a) | The private-reference codec stays: every control verb is a fresh helper process consuming this reference (F-L2-04; F-L2-13 item 2), so the binding is the live destructive-target-safety path. The envelope's daemon-restart reattach purpose moves to the upgrade path. |
| 2.4 | [x] | MOVES-0.3.0-BROKER | (a) | "broker reference extension binding authenticated install/key identity, broker lease token, and cgroup leaf device/inode" is broker-only. |
| 2.5 | [x] | NARROWS | (a) | In "prepared/published inert", the published phase belongs to the three-phase protocol and moves to the upgrade path; live / exact root exit / exact empty / unavailable / uncertain / drift / gap / timeout / control-loss mapping stays. |
| 2.6 | [x] | STAYS-0.2.0 | none | Imports the provider-neutral conformance suite unchanged; stays. (F-L2-21/F-L2-22 bound what the suite proves - findings, not scope.) |
| 2.7 | [x] | MOVES-UPGRADE-PATH | (a) | Entirely durable-publication machinery: "commit-before-ack, crash after commit/before acknowledgement ... exact recovered published state ... activation without a matching record". |
| 3.1 | [x] | NARROWS | (a) | Crate and helper binary target stay; the "separate ... broker binary targets" and the broker's Ed25519 dependency accompany the 0.3.0 broker. |
| 3.2 | [x] | STAYS-0.2.0 | none | Helper protocol constants, closed frames, monotonic sequence, "exact code-or-signal status encoding" are the retained primary control path. |
| 3.3 | [x] | STAYS-0.2.0 | none | "no PATH resolution, no shell, no caller-supplied authority PID/path" is fail-closed own-mistake defence; retained. |
| 3.4 | [x] | NARROWS | (b) | The "exact uid, mode, regular/socket type, realpath, symlink, and parent ownership checks" stay as implemented (install/misconfiguration defence). What shrinks: closing check-to-use races against a concurrent local adversary is no longer acceptance per decision 12 item 4. |
| 3.5 | [x] | STAYS-0.2.0 | none | "exact ... protocol/length/hash ... rejecting escape, symlink, PATH, download, runtime compiler, shell, and legacy-helper fallback": manifest-to-adjacent-binary integrity is explicitly retained by decision 12; legacy-fallback refusal is the no-PGID red line. |
| 3.6 | [x] | STAYS-0.2.0 | none | Protocol/resolver mutation tests guard the retained integrity surface (truncation, oversize, wrong artifact identity, socket escape, insecure modes, late results). |
| 3.7 | [x] | NARROWS | (a) | Helper build/export seam and the unchanged legacy-manifest guarantee stay; the broker artifact seam accompanies the 0.3.0 broker. |
| 4.1 | [x] | STAYS-0.2.0 | none | Native probes (namespaces, uid/gid mapping, pidfd support, proc identity fields) are prepare-time capability honesty for the retained primary provider. |
| 4.2 | [x] | STAYS-0.2.0 | none | "kills/reaps every partial process on failure" is containment of our own workers - retained janitor function. |
| 4.3 | [x] | STAYS-0.2.0 | none | Private mount propagation and namespace-correct proc are the minimal containment Step 1 keeps. |
| 4.4 | [x] | STAYS-0.2.0 | none | Minimum-descriptor transfer and "the endpoint remains inaccessible to the workload" are containment construction; retained. |
| 4.5 | [x] | STAYS-0.2.0 | none | The prepare attestation feeds 4.6's same-transaction revalidation; the "still-closed activation gate" is retained two-phase prepare -> activate behaviour. |
| 4.6 | [x] | STAYS-0.2.0 | none | "maps denied/unsupported prerequisites to typed unavailable" is capability honesty, retained verbatim. |
| 4.7 | [x] | STAYS-0.2.0 | none | "no workload marker and no live guardian remain" for every injected failure is fail-closed cleanup of our own processes. WSL-R4-M00 (narrowed, Table B) still owes rows here. |
| 4.8 | [x] | STAYS-0.2.0 | none | "never executes workload code, never publishes an incomplete reference, and never falls back to PGID, session, PID-tree traversal, or sampled descendants" - inert prepare plus the no-PGID red line. |
| 5.1 | [x] | STAYS-0.2.0 | none | Exactly-once activation with the root confirmed inside the guardian PID namespace is retained lifecycle mechanics. |
| 5.2 | [x] | STAYS-0.2.0 | none | The runtime bridge (stdio and root/empty event streams before activation) is the live execution path. |
| 5.3 | [x] | STAYS-0.2.0 | none | "namespace PID 1 reaping ... with an exact nonblocking child-set oracle" is the exact-membership janitor core. |
| 5.4 | [x] | STAYS-0.2.0 | none | Durably ordered records with fsynced terminal state let a later same-daemon inspect read exact terminal truth after guardian exit; retained. |
| 5.5 | [x] | STAYS-0.2.0 | none | "exact empty only after root exit plus `ECHILD`" is the explicitly retained exact-scope-empty measurement. (The `workload-non-escape` wording narrowing per F-L2-17 is a contract-text change, no behaviour change.) |
| 5.6 | [x] | STAYS-0.2.0 | none | Reopening natural-empty "from the durable terminal record plus exact same-boot guardian state" is how post-guardian-exit inspect works within one daemon lifetime; "rejecting missing, corrupt, conflicting, duplicated, or gap-containing records" is fail-closed typed uncertainty. |
| 5.7 | [x] | STAYS-0.2.0 | none | Guardian death classification via "Linux PID-namespace-init teardown semantics" is the same kernel guarantee Step 1's zero-orphan claim rests on; "retained uncertainty otherwise" is typed uncertainty. |
| 5.8 | [x] | STAYS-0.2.0 | none | State-machine tests over retained mechanics (replay, corruption, descendant survival, races, guardian owner death, gaps, crash points). WSL-R4-M01 (narrowed, Table B) still owes rows here. |
| 6.1 | [x] | STAYS-0.2.0 | none | Primary factory/descriptor/outcome mapping "without registering it as the production ProcessScope default" stays; default switching remains closure-owned. |
| 6.2 | [x] | NARROWS | (a) | Native-owned one-use capabilities and "TypeScript MUST NOT generate or backfill" stay as live control-path integrity; the reference's durable-reattach purpose moves to the upgrade path. |
| 6.3 | [x] | NARROWS | (a) | The required order ("verify envelope/version and boot ... open namespace handle and pidfd ... reread and compare the complete tuple") stays as the per-operation open path; its criterion-4 purpose - resume after daemon death - moves to the upgrade path. |
| 6.4 | [x] | NARROWS | (a) | "without signalling on ambiguous or drifted identity" is retained destructive-target safety; the classification's replacement-recovery purpose moves to the upgrade path. |
| 6.5 | [x] | STAYS-0.2.0 | none | Inspect from "guardian journal/control results rather than PID/PGID/descendant sampling" is retained no-sampling discipline. |
| 6.6 | [x] | NARROWS | (a) | Prepared abort ("keeping activation closed, signalling only the revalidated guardian pidfd") stays; published abort accompanies the publication machinery to the upgrade path. |
| 6.7 | [x] | STAYS-0.2.0 | none | "bounded graceful root delivery followed by `pidfd_send_signal` of the exact guardian ... no individual descendant signals" is recursive termination of our own workers; retained. |
| 6.8 | [x] | STAYS-0.2.0 | none | Conformance-suite closure for the primary adapter stays. (Its two vacuous rows and the activate-ledger blind spot are F-L2-21/F-L2-22 - findings, not scope.) |
| 6.9 | [x] | MOVES-UPGRADE-PATH | (a) | The "concrete trusted Linux publication ledger ... acknowledgement only after commit" is the durable half of prepared -> published -> activate. |
| 6.10 | [x] | MOVES-UPGRADE-PATH | (a) | Mapping inert to "prepared/published only through the exact ledger" and requiring "the same ledger proof inside `ProviderPreparedAuthority.activate()`" is the three-phase gate. (Exactly-once activation itself stays via 5.1.) |
| 6.11 | [x] | MOVES-UPGRADE-PATH | (a) | "publication commit survives lost acknowledgement and pre-activate process death ... recovered published authority is reconciled" is replacement-recovery machinery. |
| 7.1 | [x] | STAYS-0.2.0 | none | Toolchain provisioning receipt; historical, unaffected. |
| 7.2 | [x] | STAYS-0.2.0 | none | "verify manifest length/hash/source/compiler and execute the built ELF" is the retained manifest-to-binary integrity check (decision 12 keeps it: install corruption is a real failure). |
| 7.3 | [x] | STAYS-0.2.0 | none | Real-kernel namespace/proc/pidfd/prepare-before-activate oracle; retained containment evidence. |
| 7.4 | [x] | STAYS-0.2.0 | none | "actual `setsid()` plus detached double-fork survival/recursive-kill" proves containment of our own leaked workers - the exact case Step 1 exists to keep catching. |
| 7.5 | [x] | STAYS-0.2.0 | none | "actual `setpgid()` mutations ... proving inspection, natural empty, and kill use namespace authority" - membership must not depend on process groups; retained. |
| 7.6 | [x] | STAYS-0.2.0 | none | Nested PID namespace held live after root exit until "eventual exact empty"; retained exact-membership evidence. |
| 7.7 | [x] | NARROWS | (a) | Two halves in the task's own words. "guardian forced-death mutations, including ... kernel teardown, and unrelated-process survival" is the zero-orphan/exact-target core - stays. "controller replacement ... including pidfd reopen/revalidation" is the receipt that a replacement controller resumes live authority - criterion-4 acceptance, moves to the upgrade path; its refusal half (reject boot/PID/start/namespace replacements, no destructive control on drift) stays. Receipts stand as taken. |
| 7.8 | [x] | NARROWS | (a) | Seven of the eight named oracles stay (natural empty, exact code exit, exact signal exit, root-exit-with-live-descendant, recursive force, prepared abort); the "published abort" row accompanies the publication machinery (WSL-R4-M04). |
| 7.9 | [x] | STAYS-0.2.0 | none | "proving no destructive control targets a replacement or unrelated process" is the retained property verbatim; the unavailable-configuration half is capability honesty and still owes WSL-R4-M05. |
| 7.10 | [x] | MOVES-UPGRADE-PATH | (a) | "commit-before-ack and acknowledgement-before-activate windows ... the durable ledger reports published-inert" - publication-window machinery, moves whole (WSL-R4-M06). |
| 7.11 | [x] | STAYS-0.2.0 | none | The gate summary is historical; its "leave broker/cgroup-v2 ... gates explicitly open" clause is now discharged by the 0.3.0 handover rather than by running Section 9. |
| 8.1 | [x] | MOVES-0.3.0-BROKER | (a) | "separate broker provider/client protocol ... broker Ed25519 challenge signatures, pinned root-owned public-key manifest validation" - broker-only. Ticked; implementation and evidence retained in git. |
| 8.2 | [x] | MOVES-0.3.0-BROKER | (a) | "explicit administrative broker installation layout and idempotent installer/uninstaller" - broker-only. |
| 8.3 | [x] | MOVES-0.3.0-BROKER | (a) | "broker startup probes for unified cgroup v2, required controllers/files ..." - broker-only. |
| 8.4 | [x] | MOVES-0.3.0-BROKER | (a) | "root-owned lease store keyed by random broker token" binding caller/boot/guardian/namespace/cgroup identity - broker-only. |
| 8.5 | [x] | MOVES-0.3.0-BROKER | (a) | Broker preparation ("creates a unique root-owned leaf ... revalidates leaf/guardian identity before prepared-inert") - broker-only. |
| 8.6 | [x] | MOVES-0.3.0-BROKER | (a) | "broker activation and runtime bridging with the same ... semantics as the primary path" - broker-only; the primary semantics it mirrors stay via Sections 5-6. |
| 8.7 | [x] | MOVES-0.3.0-BROKER | (a) | "broker reopen that reauthenticates the installation" and distinguishes restart from token/key/path/inode drift - broker-only. |
| 8.8 | [x] | MOVES-0.3.0-BROKER | (a) | "the exact leaf's recursive kill and stable `cgroup.events populated=0` oracle" - broker-only. |
| 8.9 | [x] | MOVES-0.3.0-BROKER | (a) | "broker-death behavior that leaves the root-owned leaf and durable lease intact" - broker-only. |
| 8.10 | [x] | MOVES-0.3.0-BROKER | (a) | Broker unit/privileged-fixture mutations (missing install/key/socket/controller, spoofed peer/signature, leaf migration, drift, crash-store recovery, uninstall refusal) - broker-only. |
| 9.1 | [ ] | MOVES-0.3.0-BROKER | (a) | "dedicated reconfigured WSL, Linux VM, or runner with writable unified cgroup v2" - the broker gate environment; unreachable here by construction (broker_default() hard-requires the `pids` controller) and no longer on the 0.2.0 critical path. |
| 9.2 | [ ] | MOVES-0.3.0-BROKER | (a) | "Build and install the exact source-owned broker/helper on that runner" - broker gate. |
| 9.3 | [ ] | MOVES-0.3.0-BROKER | (a) | Escape/migration "mutations inside the exact broker leaf" - broker gate. |
| 9.4 | [ ] | MOVES-0.3.0-BROKER | (a) | "actual broker kill/restart and client/controller replacement while populated" - broker gate. |
| 9.5 | [ ] | MOVES-0.3.0-BROKER | (a) | "token/key/guardian/PID-namespace/cgroup-inode drift mutations" against the broker - broker gate. |
| 9.6 | [ ] | MOVES-0.3.0-BROKER | (a) | "`cgroup.kill`, populated-to-empty convergence, repeated termination, and unavailable-configuration mutations" on the broker leaf - broker gate. |
| 9.7 | [ ] | MOVES-0.3.0-BROKER | (a) | "the broker gate summary ... and independent security review" - broker gate. All seven remain unticked and unaltered for 0.3.0 pickup. |
| 10.1 | [x] | STAYS-0.2.0 | none | Build script with "source digest, compiler provenance ... deterministic manifest ordering" stays as integrity infrastructure. Per decision 12, byte-reproducibility is a kept fix (F-L2-15), no longer a provenance acceptance claim - that reframes findings, not this task. |
| 10.2 | [x] | NARROWS | (a) | Helper manifest packaging stays; broker-client manifest entries are 0.3.0 surface. "keeping the separately installed privileged broker binary/private key/state out of an implicit npm install path" stays load-bearing while broker code remains in-tree. |
| 10.3 | [x] | STAYS-0.2.0 | none | Resolver mutations ("wrong-length/hash/source, symlink, path escape, insecure permission ... legacy helper fallback") guard retained integrity and the no-legacy-fallback red line. |
| 10.4 | [x] | STAYS-0.2.0 | none | "labelling all such results non-runtime" is honest-evidence discipline; retained. |
| 10.5 | [x] | STAYS-0.2.0 | none | "reports namespace-policy skips as open gates rather than passes" is capability honesty in CI; retained. |
| 10.6 | [x] | MOVES-0.3.0-BROKER | (a) | "broker privileged CI/runner wiring only when the runner explicitly supplies writable cgroup v2 and installed-broker authority" - the 0.3.0 provisioning programme. |
| 10.7 | [x] | STAYS-0.2.0 | none | Legacy ProcessCapsule tests "remain unchanged in meaning until closure owns atomic migration"; closure's ownership is unchanged by either decision. |
| 11.1 | [ ] | NARROWS | (a) | The focused-suite list includes "broker client/service"; those leave the 0.2.0 gate with the broker. Descriptors, codecs, resolver, lifecycle mapping, adapter, conformance, primary native helper, package, and failure-mutation suites stay. |
| 11.2 | [ ] | NARROWS | (a) | "for helper and broker targets": 0.2.0 acceptance is the helper target; broker-target gates accompany 0.3.0. |
| 11.3 | [ ] | NARROWS | (a) | "the complete WSL primary matrix from Section 7 fresh" now means the retained Section 7 subset; 7.10's window oracles and 7.8's published-abort row have moved to the upgrade path. |
| 11.4 | [ ] | MOVES-0.3.0-BROKER | (a) | "the complete real cgroup-v2 broker matrix from Section 9" moves with Section 9; its "report the Change non-terminal" clause no longer binds 0.2.0 terminal status - this is the exact cut named in the broker replan input. |
| 11.5 | [ ] | NARROWS | (a)+(b) | Broker clauses ("broker key/install ownership, lease durability, cgroup migration"; the spec's forged/stale broker token) move with the broker (a). The remaining foci - namespace construction, inherited descriptors, "TOCTOU before signals", destructive target identity, reference/token handling - stay and are reviewed under the decision-12 threat model: own mistakes, not a local attacker (b). |
| 11.6 | [ ] | NARROWS | (a) | "recovered inert phase comes only from the authentic publication ledger, activate contains no publish side effect" re-grades to the upgrade path with the ledger; "no PGID/PID-tree/sample claim remains" and the common spec/suite hash checks stay. |
| 11.7 | [ ] | STAYS-0.2.0 | none | Strict validation plus proportional root gates; unchanged - the proportion shrinks only because the surface did. |
| 11.8 | [ ] | NARROWS | (a)+(b) | The closure handoff must now state the primary tuple as the 0.2.0 surface, the broker tuple as moved, Step 1 daemon-lifetime semantics, the upgrade-path inventory, and the decision-12 re-grades among its "retained limitations". |
| 11.9 | [ ] | NARROWS | (a) | "only after every implementation, actual-kernel, verification, and review task above is complete" now reads over tasks not marked moved; Section 9 / broker rows no longer gate local ship. |
| 11.10 | [ ] | STAYS-0.2.0 | none | Immediate archive "through the authoritative archive engine ... rather than deferring child archive to ECP-8"; process unchanged. |
| 11.11 | [ ] | NARROWS | (a) | Core obligation (terminal evidence to the parent only after real local ship/archive; no release-support claim) stays. Stale clauses: "keep Windows scheduler-pending until Direction selects it" is overtaken (the Windows apply wave is in flight) and "keep macOS decision-deferred" is superseded by Step 1's explicit best-effort reopen. |

## Table B - the 11 open findings

Pre-existing set as inherited: 1 Blocker, 9 Major, 1 Minor. Each was read in full from the file
named in the row before grading. A re-grade is not a resolution; every finding below remains
OPEN against whichever line now owns it.

| Finding | Severity as filed | Verdict | Reason | Anchored justification |
| --- | --- | --- | --- | --- |
| NATIVE-SEAM-R1-M01 | Major | MOVES-0.3.0-BROKER | (a) | "The ordinary primary CLI remains unaffected because it supplies the immediate no-op hook, but the seam's intended production broker consumer is not time-bounded"; "The only production non-no-op caller is the statically compiled broker closure" (`review-report-native-primary-seam-round-1.md`). The general control-path deadline question survives in 0.2.0 through the B06 primary sibling; this move does not absorb it. |
| NATIVE-SEAM-R1-M02 | Major | MOVES-0.3.0-BROKER | (a) | The missing oracle must prove hook-before-final-readiness ordering; the hook exists to persist the broker's client reference ("The broker persists a bounded encoded clone"). With the broker in 0.3.0 there is no production hook consumer in 0.2.0. |
| WSL-R4-M00 | Major | NARROWS | (a) | "Task 4.7 lacks the full partial-construction failure matrix ... deterministic mutations spanning every construction stage through final revalidation" (`wsl-primary-gate-round-4.md`). The named primary stages (mapping, child `N` readiness, proc/namespace/pidfd revalidation, identity transfer, final `R` readiness) are retained containment work and stay; only rows existing solely for the broker ready-hook seam leave with it. Wave evidence (`wsl-native-focused-suites-lead2.md`) awaits review-wave adjudication. |
| WSL-R4-M01 | Major | NARROWS | (a) | "Task 5.8 lacks required final-child race and terminal crash-point state-machine coverage." Final-child races and terminal-record crash points guard exact-scope-empty and the durable terminal journal - retained. Rows whose point is authority surviving its owner's death re-grade to the upgrade path under decision 11. |
| WSL-R4-M04 | Major | MOVES-UPGRADE-PATH | (a) | "Task 7.8 lacks actual-WSL published-abort evidence. Native inert state alone cannot prove publisher/ledger behavior." The published-inert publisher/ledger is three-phase (criterion 4) machinery. Its LEAD-2 wave evidence travels with it; not closed here. |
| WSL-R4-M05 | Major | STAYS-0.2.0 | none | "denied/missing namespace/proc/pidfd/mapping cases are absent" - the typed unavailable-configuration matrix is capability honesty plus fail-closed typed uncertainty, retained under both decisions. Still owed for 0.2.0. |
| WSL-R4-M06 | Major | MOVES-UPGRADE-PATH | (a) | "Task 7.10 has no actual publisher-window controller-replacement oracle. Neither publication window is exercised against the real helper and trusted ledger." Publication windows plus controller replacement are criterion-4 machinery. |
| BRK-R2-B01 | Major residual | MOVES-0.3.0-BROKER | (a) | Round-3 residual is filed on the broker's recoverable construction: "deadline supervision and the defining ordering oracle remain absent"; the hook fsyncs "the exact encoded client reference" (`review-report-native-broker-round-3.md`). Broker-owned; its ordering-oracle residual is the same gap as NATIVE-SEAM-R1-M02 and moves with it. |
| BRK-R2-B02-M03 | Major | MOVES-0.3.0-BROKER | (a) | "after controller loss, a fresh production owner may discover an old broker operation but cannot resolve it through the exposed capability" (`review-report-native-broker-delivery-round-4.md`). Broker delivery-recovery; additionally criterion-4-shaped (controller-replacement recovery). Leaves on both grounds, recorded under (a). |
| BRK-R2-B06 | Blocker | SPLIT (see below) | (a) / none | Split per the mandatory carve-out; detail below the table. |
| PKG-P5 | Minor | STAYS-0.2.0 | none | "implementation evidence source digest is stale after concurrent native integration" (`review-report-package-ci-round-1.md`) - receipt currency, untouched by (a)/(b). The task 7.2 re-emit against frozen `087d87a5` (`wsl-native-build-manifest-lead2.md`) stages its closure; closing it is the review wave's act, not this record's. |

### BRK-R2-B06 split (carve-out enforced)

**Moves to 0.3.0 with the broker - the finding as filed.** Its current round-3 text is
broker-specific: "mutating daemon work is not governed by the absolute deadline" - daemon
dispatch checks the deadline only on entry, the daemon handles requests in detached threads,
activate/prepare commit without a remaining-deadline recheck, client death does not cancel the
daemon transaction (`review-report-native-broker-round-3.md`).

**Stays in 0.2.0 - the primary-path sibling**, carried by this wave's findings, none of which
move:

- F-L2-01: the primary user-pidns helper CLI "had the identical defect on exactly those three
  verbs: `activate`, `inspect` and `open-runtime`", each validating `--deadline-ms` and
  discarding it; "The finding as written does not cover the primary path at all."
- F-L2-02: the activate fix routes the deadline into `after_ms(...)`, "a remaining-time delta
  that is re-anchored later, not an absolute monotonic deadline threaded end to end".
- F-L2-03: `inspect`, `open-runtime` and `terminate` "still parse `--deadline-ms` and discard
  it. They are known-defective and deliberately left, not signed off as correct."
- F-L2-16: the fixed 2-second `CONTROL_TIMEOUT` makes `linux_primary_contract` roughly 29-43%
  flaky under parallel execution; every green on this Change is serial-conditional.

A bounded cancel that actually observes its deadline is janitor function - it stays regardless
of both re-gradings, which is why the sibling's governing reason is `none`. Severity of the
sibling is for the review wave; this record does not rank it.

## Disagreements with lead-3 (file-level reading vs stated expectations)

1. **"Opaque reference envelopes ... pidfd reopen-and-revalidate move to the upgrade path"
   cannot be applied wholesale to this ledger's tasks.** On this Change every control verb is a
   separate helper process that consumes the private reference and reopens/revalidates before
   acting: task 6.3's required order is the per-operation open path; F-L2-04 records that
   activation receipts were "taken against a helper that silently substituted the internal
   2-second `CONTROL_TIMEOUT` for the caller's value" (a fresh process per verb); F-L2-13 item 2
   records that "a cross-process `activate` always fails on the one-use capability". The same
   machinery is simultaneously the intra-lifetime destructive-target-safety mechanism (retained)
   and the criterion-4 reattach mechanism (moves). Verdict here: tasks 2.3 / 6.2 / 6.3 / 6.4
   NARROW rather than move whole. Only the tasks that are purely publication/replacement
   machinery (2.7, 6.9, 6.10, 6.11, 7.10) move whole.
2. **Grounds for NATIVE-SEAM-R1-M01/M02 leaving.** lead-3 says the seam "depends on both the
   broker hook and same-boot process-recovery state, neither of which exists in Step 1". Neither
   finding's text mentions same-boot process-recovery state. The file-anchored ground is
   narrower and sufficient: the seam's only production non-no-op consumer is the statically
   compiled broker closure. Same verdict, corrected ground.
3. **PKG-P5 "being closed by the 7.2 re-emit".** lead-2 says the re-emit is "closing Minor
   `PKG-P5`"; the broker replan input repeats it. The findings file's own Boundary section says
   "The implementation wave does not close findings; the unified review wave does." This record
   therefore carries PKG-P5 as STAYS-0.2.0, open with supersession evidence - not closed.
4. **"7 findings leave" arithmetic.** At file level: 6 findings move whole (BRK-R2-B01,
   BRK-R2-B02-M03, NATIVE-SEAM-R1-M01, NATIVE-SEAM-R1-M02, WSL-R4-M04, WSL-R4-M06), 1 splits
   (BRK-R2-B06), 2 narrow (WSL-R4-M00, WSL-R4-M01 - lead-3's "partially survive", consistent),
   2 stay whole (WSL-R4-M05, PKG-P5). "7 leave" holds only if the split B06 counts as leaving;
   this record enforces the split explicitly rather than counting it out.
5. **Surfaced omission (not a contradiction): Step 1's own new obligations have no task in this
   93-task ledger.** Locked decision 11 requires, for Linux: guardian-held inherited-pipe EOF =>
   namespace teardown (explicitly "use the pipe, not `PR_SET_PDEATHSIG`"), typed
   `execution-lost` for in-flight actions, and the narrowed `durable: daemon-lifetime`
   capability declaration. The frozen tree deliberately proves the opposite lifetime property
   (7.7: the guardian survives controller death and durable authority remains inspectable).
   Whether these become new tasks on this Change or land in the executor/host Changes is a
   LEAD/planner decision this record does not make.
6. **Clarification, not contradiction:** the broker replan input's "Sections 1-8 and 10-11 stand
   as written" coexists with Section 8 rows graded MOVES-0.3.0-BROKER. "Stand as written" means
   no gate relaxation and no text change - honoured; the verdict records only which release line
   owes their remaining verification. Ticks and evidence are untouched.

## What this record does NOT decide

- **No finding is closed by this document.** A scope change re-grades a finding; it does not
  resolve it. Findings that move remain OPEN against the upgrade path or the 0.3.0 broker item
  and travel with their existing evidence.
- **No severity is re-ranked.** In particular the BRK-R2-B06 primary sibling's severity and the
  possible escalation of F-L2-17 are review-wave/Direction calls.
- **No checkbox changed; no denominator restated.** 75/93 remains the ledger fact; whether
  run-state presents a scoped denominator is the LEAD's single-writer accounting.
- **No new task was added for Step 1's own Linux obligations - an OPEN GAP in this ledger**
  (Disagreements item 5). No task here implements or takes evidence for them; the frozen tree
  proves the opposite lifetime property (7.7's controller-replacement rows). Recommendation
  only - the placement decision is the LEAD's:
  - **Inherited-pipe-EOF namespace teardown on daemon death** (explicitly the pipe, not
    `PR_SET_PDEATHSIG`): belongs on THIS Change or its direct successor - it is guardian
    construction work in the same native fault domain as Sections 4-5, and it changes frozen
    crate source, so it needs a post-freeze wave with an explicit re-freeze/re-bind; ECP-8 owes
    the zero-orphan receipt.
  - **Typed `execution-lost` for in-flight actions on daemon death**: Run/Record outcome typing;
    belongs to `ecp-frozen-action-session-executor` (with session-host cooperation), not to a
    provider ledger.
  - **The narrowed `durable: daemon-lifetime` capability declaration**: belongs to the
    executor's OS-by-backend capability matrix per Architecture Replans 4/5.
- **No run-state file was read as authority or written.**
