# Decision 13 re-grade: open findings of ecp-durable-agent-session-host

Change: `ecp-durable-agent-session-host`
Date: 2026-08-07
Author role: REVIEWER acting as re-grade accountant, dispatched by the ECP-7 LEAD.

This document is an accounting act, not a closing act. It enumerates this Change's open
findings from the Change's own files, re-reads each in full from its originating report, and
re-grades each against locked decisions 11, 12, and 13. **No verdict below closes any
finding.** Closing any conditional verdict belongs to the `ecp-hosted-best-effort-cutover`
independent review, the closure re-review under its rewritten acceptance, and this Change's
own fresh independent review (owed per Architecture Replan 6), never to this file.

## Enumeration: what is actually open

The open set was enumerated from the files, not from the roadmap recap:

- The current authoritative code/spec verdict is the strategy attempt 1 fresh non-author
  review: "CHANGES_REQUIRED - Blocker:0 Major:4 Minor:1"
  (`evidence/review-report.md:509-630`, restated as authoritative at `:731-737`). Its five
  findings are the open set.
- The current authoritative CSO verdict records two open Majors
  (`evidence/cso-report.md:118-171`, authoritative restatement `:306-313`); they are the
  security views of the same root-exit and POSIX-replacement findings and are "not added again
  to the aggregate" (`cso-report.md:169`). Counted once below.
- The current authoritative verification verdict agrees: "BLOCKED - Blocker:0 Major:4
  Minor:1" (`evidence/verification-report.md:256-276, 332-338`).
- All earlier rounds' findings (V1-V11; R3-V5-A; V6) are recorded resolved in
  `evidence/review-cycle-report.md` and `evidence/review-report.md`; R3-V5-B's unresolved
  residue is the macOS-ABI finding below. No other open finding was found in any
  review/evidence/handoff file of this Change.
- The labels S1-S5 were assigned to these five findings by the successor Change's baseline
  (`../ecp-native-process-capsule-closure/evidence/implementation-baseline.md:22-28`) and are
  used here for continuity. The roadmap's list (macOS ABI, scope-close classification, POSIX
  replacement cleanup, PREPARED control timeout, helper reproducibility) matches the files
  exactly; no discrepancy found.

## Governing sources

- Locked decision 13: `rasen/work/issue-centered-automation-platform/`
  `executable-composite-pipelines/target-state.md:297-329` - the 0.2.0 `hosted` backend
  converges on all three OSes to a declared best-effort tier (`exactCancel: false`,
  `scopeEmptyProof: false` visible pre-start; cancel terminal `cancelled / emptiness-unproven`);
  the kernel-enforced authority crates park whole on the upgrade path; Windows keeps the Job
  `KILL_ON_JOB_CLOSE` daemon-death teardown with a receipt; decision 11's Linux/macOS
  zero-orphan leg is revised to declared best-effort (orphan risk is a declared known
  limitation); fail-closed typed uncertainty and capability honesty are not relaxed.
- Locked decision 11 (`target-state.md:237-254`): daemon death means scope death and typed
  `execution-lost`; criterion-4 replacement-identity machinery moves whole to the upgrade path.
- Locked decision 12 (`target-state.md:255-279`): threat model is our own mistakes; helper
  byte-reproducibility as a provenance claim is retired; manifest-to-adjacent-binary integrity
  stays.
- Execution shape: `slices/session-execution-and-self-hosting/plan.md:510-588` (Architecture
  Replan 6) and `rasen/changes/ecp-hosted-best-effort-cutover/proposal.md` (in propose). Two
  cutover facts are load-bearing: POSIX (linux + darwin) stops constructing the legacy
  ProcessCapsule (replaced by the generalised best-effort scope), and win32 keeps the
  unmodified legacy capsule behind a thin scope that re-declares every terminal in the
  declared-unproven vocabulary (`proposal.md:7-10, 27-28`).
- Prior dispositions cited from the Step 1 reconciliation Table A.2
  (`../ecp-native-process-capsule-closure/evidence/step1-scope-reconciliation.md:74-82, 94-98`)
  and the closure Change's implemented repairs
  (`../ecp-native-process-capsule-closure/evidence/implementation-report.md:24-32`). Those
  repairs are author implementation evidence only; their independent confirmation is still
  open.

## Summary table

| Finding | Original severity | Original claim (quoted core) | Prior disposition | Decision-13 verdict | Verification owed and by whom |
| --- | --- | --- | --- | --- | --- |
| S1 (macOS ABI) | Major | "`mac_birth` defines a 40-byte `UniqueInfo` ... Apple's XNU declaration ... statically asserts a size of 56 bytes" | Residue of R3-V5-B; repair (56-byte binding) implemented by closure; Step 1: LEAVES-UPGRADE-PATH | leaves-with-parked-crates | None for 0.2.0; the real-macOS ABI/collision oracle travels with the upgrade path |
| S2 (scope-close classification) | Major | "The Node client nevertheless sets the scope to `closed` and resolves `closed` immediately" on backend-root `EXIT` | Repair (protocol v2 ROOT_EXIT vs SCOPE_EMPTY) implemented by closure; Step 1: SURVIVES-0.2.0, residual defect = SEC-001 | conditionally-closed-pending-cutover-verification | Cutover review + closure re-review + this Change's fresh review: root-exit terminal honesty and teardown checks (detail section) |
| S3 (POSIX replacement cleanup) | Major | "a replacement daemon cannot reliably reap a positively identified supervisor / process group after controller loss" | Repair (opaque ref v2 group cleanup) implemented by closure; Step 1: LEAVES-UPGRADE-PATH | leaves-with-parked-crates; residual harm re-classified as a declared known limitation by decision 13 | None for 0.2.0; upgrade-path resumption owes the real Linux/macOS replacement oracles |
| S4 (PREPARED control timeout) | Major | "`activate()` awaits `client.activated.promise` without a timer and `abort()` awaits termination / close without a timer" | Repair (`awaitControl` bounds all phases) implemented by closure; Step 1: NARROWS - bounded control on surviving phases stays acceptance | narrows (residual: every control phase reachable in the shipped win32 delegation and POSIX best-effort scope is bounded with typed phase-specific uncertainty) | Cutover review enumerates and bounds-checks the shipped phases; independent confirmation at closure re-review / this Change's fresh review |
| S5 (helper reproducibility) | Minor | "Repeated source-identical Windows builds produced distinct helper SHA-256 values ... the claimed source/compiler/binary provenance is not reproducible" | Repair (narrowed provenance contract) implemented by closure (`provenance-audit.md`); Step 1: NARROWS - reproducibility branch permanently retired under decision 12 | narrows (unchanged by decision 13) | Manifest-adjacent hash/length integrity on the shipped win32 helper stays acceptance; receipted by the cutover pin-list task; independent confirmation at closure re-review |

Verdict counts: leaves-with-parked-crates 2; conditionally-closed-pending-cutover-verification 1;
narrows 2.

## Per-finding detail

### S1 - Major - the macOS unique-birth structure is 40 bytes but the Apple ABI is 56 bytes

- **Original text:** `evidence/review-report.md:570-582`. Core claim: "`mac_birth` defines a
  40-byte `UniqueInfo` at `native/process-capsule/src/main.rs:910-950` and requires
  `proc_pidinfo` to return exactly that size. Apple's XNU declaration includes two further
  `uint64_t` reserve fields and statically asserts a size of 56 bytes ... On macOS the call is
  therefore expected to fail closed instead of furnishing the required kernel unique-birth
  capability." Lineage: this is the surviving residue of R3-V5-B ("R3-V5-B is not resolved.
  Linux no longer relies on second-resolution `ps lstart`, but the implemented macOS
  exact-birth source has an incorrect ABI", `review-report.md:524-528`).
- **Prior dispositions:** strategy attempt 1 left it open (Major). The closure Change
  implemented the repair - complete 56-byte declaration with compile-time size/alignment
  assertions (`implementation-report.md:28`) - with runtime confirmation explicitly deferred.
  Step 1 Table A.2: LEAVES-UPGRADE-PATH under decision 11 - its consumer left 0.2.0 twice
  (macOS durable authority to 0.3.0 under decision 10; identity revalidation to the upgrade
  path), and "the best-effort macOS tier consumes no kernel birth identity"
  (`step1-scope-reconciliation.md:78, 94`).
- **Decision-13 re-grade:** the LEAD's hypothesis is confirmed and extended. Under decision 13
  the best-effort tier is not only the macOS hosted shape but the hosted shape on all three
  OSes, and it consumes no kernel birth identity anywhere - the POSIX best-effort scope is
  process-group mechanics only (`proposal.md:7`). S1's defective-then-repaired code has no
  0.2.0 production consumer on any platform; the repaired 56-byte binding is retained in git as
  upgrade-path provenance.
- **Verdict:** `leaves-with-parked-crates`.
- **Verification owed:** none as 0.2.0 acceptance. On upgrade-path resumption, the real-macOS
  collision / foreign-identity / unavailable-source oracles named by the original finding are
  still owed before any identity claim. Not closed: the repair has never been independently
  confirmed on a real macOS host.

### S2 - Major - a backend-root EXIT is misreported as closure of the whole scope

- **Original text:** `evidence/review-report.md:530-551`. Core claim:
  "`native/process-capsule/src/main.rs:285-294` waits only for the backend root and emits
  `EXIT`; the supervisor continues serving control frames. The Node client nevertheless sets
  the scope to `closed` and resolves `closed` immediately at
  `src/core/session-host/process-capsule/native-process-scope.ts:224-229`.
  `observeTransportClose` then clears the durable process authority." Real-Windows probe:
  `closed` resolved while `inspect(ref)` returned live/controllable and a detached descendant
  survived. CSO twin at `evidence/cso-report.md:120-141` ("Backend-root exit releases
  authority while a detached agent descendant is still live", HIGH 10/10).
- **Prior dispositions:** strategy attempt 1 left it open (Major). The closure Change
  implemented the repair: protocol v2 separates `ROOT_EXIT` from terminal `SCOPE_EMPTY` and
  retains authority until scope-empty (`implementation-report.md:29`); independent confirmation
  open. Step 1 Table A.2: SURVIVES-0.2.0 - "Root-exit vs scope-empty is the janitor core,
  retained by both decisions; its residual defect is SEC-001"
  (`step1-scope-reconciliation.md:79, 95`).
- **Decision-13 re-grade:** the finding's essence - authority must not be released on a claim
  stronger than what was observed - survives as the "Record must not lie" invariant, but its
  acceptance shape changes. Under the declared tier there is no proven scope-empty terminal to
  wait for: the honest terminal is a declared-unproven receipt, and descendant survival after
  best-effort teardown is a declared known limitation on POSIX (`target-state.md:320-323`). On
  win32, the Job object provides the one stronger retained property: teardown when the handle
  chain closes, receipted (`proposal.md:10`). The closure repair (ROOT_EXIT vs SCOPE_EMPTY
  separation) remains in the shipped win32 capsule; the cutover re-declares its terminals. This
  lands on the same seam as closure finding SEC-001 and shares its conditionality: structural
  closure is a prediction until discriminated.
- **Verdict:** `conditionally-closed-pending-cutover-verification`.
- **Exact checks owed (cutover independent review, confirmed at closure re-review and this
  Change's fresh independent review):** (1) on the POSIX best-effort scope, backend-root exit
  with a surviving detached descendant must trigger the best-effort group teardown and mint
  only a declared-unproven terminal - never a proven-empty or clean-close classification -
  before any authority/writer release; (2) on win32, the root-exit path must mint the
  declared-unproven vocabulary (never the capsule's proven scope-empty claim,
  `proposal.md:8`), and the Job handle lifecycle must guarantee descendant teardown at
  release, receipted by a real run; (3) no shipped path may translate root `EXIT` into a
  whole-scope closure claim. The original real-Windows detached-descendant probe shape is the
  discriminator to preserve.

### S3 - Major - POSIX replacement cleanup kills only the controller and can orphan the group

- **Original text:** `evidence/review-report.md:553-568`. Core claim: "Linux/macOS one-shot
  termination validates and signals `pid`, the controller ... then merely waits for the
  supervisor to disappear. Unlike the Windows Job, POSIX controller death has no kernel
  kill-on-close effect ... Consequently a replacement daemon cannot reliably reap a positively
  identified supervisor / process group after controller loss and returns uncertainty while
  the worker tree remains live." CSO twin at `evidence/cso-report.md:143-162` (HIGH 9/10).
- **Prior dispositions:** strategy attempt 1 left it open (Major). The closure Change
  implemented the repair: opaque ref v2 binds controller and supervisor births plus reserved
  PGID; replacement revalidates exact identity and performs bounded TERM/KILL group cleanup
  (`implementation-report.md:30`); actual Linux/macOS runtime never executed. Step 1 Table
  A.2: LEAVES-UPGRADE-PATH under decision 11 - "Replacement cleanup is criterion-4 machinery;
  the PGID mechanism beneath it was additionally superseded on 2026-08-04"
  (`step1-scope-reconciliation.md:80, 96`).
- **Decision-13 re-grade:** the LEAD's hypothesis is confirmed: this is criterion-4 machinery
  and it left under decision 11 (a replacement daemon never inspects a stored ref; daemon
  death means scope death). Decision 13 adds two things. First, the parked crates take the
  kernel-enforced answer with them, so no 0.2.0 mechanism will ever exactly reap a surviving
  group. Second, the harm the finding describes - a live worker tree surviving controller/
  daemon loss on POSIX - is re-classified from an acceptance failure into a declared known
  limitation of the best-effort tier (decision 13 revising decision 11's zero-orphan leg,
  `target-state.md:320-323`), with the `execution-lost` path still owed downstream. The
  finding's disproof value is retained: it documents why `scopeEmptyProof: false` is the only
  honest declaration.
- **Verdict:** `leaves-with-parked-crates`; residual harm re-classified as declared known
  limitation by decision 13.
- **Verification owed:** none as 0.2.0 acceptance for exact replacement reap. The real Linux
  and macOS controller-death / resistant-descendant / PID-reuse oracles named by the original
  finding travel to the upgrade path. The declared-limitation wording itself must be visible
  pre-start - that visibility check belongs to the cutover review's capability-declaration
  verification, not to this finding.

### S4 - Major - post-PREPARED activation and abort have no control deadline

- **Original text:** `evidence/review-report.md:584-594`. Core claim: "Preparation and
  one-shot probes use `controlTimeoutMs`, but `activate()` awaits `client.activated.promise`
  without a timer and `abort()` awaits termination / close without a timer at
  `src/core/session-host/process-capsule/native-process-scope.ts:361-382`. A live but wedged
  controller or pipe can therefore block publication recovery or shutdown indefinitely."
- **Prior dispositions:** strategy attempt 1 left it open (Major). The closure Change
  implemented the repair: one `awaitControl` helper bounds prepare, activate, abort,
  inspect/terminate, and scope-empty phases with typed phase-specific timeout/control-loss
  outcomes (`implementation-report.md:31`); independent confirmation open. Step 1 Table A.2:
  NARROWS under decision 11 - the two named phases belong to the
  `prepared -> published -> activate` protocol that leaves, but "Bounded control with typed
  uncertainty is retained fail-closed acceptance ... every control phase present in the Step 1
  design ... is bounded with typed phase-specific uncertainty"
  (`step1-scope-reconciliation.md:81, 97`).
- **Decision-13 re-grade:** the LEAD's hypothesis ("may live in the parked crates' scope") is
  checked and rejected as stated: the defective code is the legacy capsule's TypeScript client,
  not the parked crates, and that client remains shipped production code on win32 under the
  cutover's delegation (`proposal.md:8, 27-28`). The parked Linux crate carries the same defect
  class as its recorded known defect D4 (dropped deadline, 2 s dead control bridge,
  `plan.md:578-581`) - recorded with the parked asset, not 0.2.0 work. The surviving 0.2.0
  acceptance is unchanged in kind and re-anchored in place: every control phase reachable in
  the shipped scope implementations (win32 thin-scope delegation into the legacy capsule
  client, including whatever prepare/activate/abort surface the delegation exposes, and the
  POSIX best-effort scope's spawn/signal/observe phases) must be bounded with a typed
  phase-specific uncertainty outcome that retains authority. Decision 13 explicitly does not
  relax fail-closed typed uncertainty.
- **Verdict:** `narrows` (residual as stated above).
- **Verification owed:** the cutover independent review must enumerate the control phases
  actually reachable in the shipped tree and verify each is bounded (hung-controller/wedged-
  pipe mutation per phase, authority retained, one typed outcome); independent confirmation of
  the closure-implemented `awaitControl` repair belongs to the closure re-review and this
  Change's fresh independent review. Until then S4 remains open.

### S5 - Minor - source-identical helper builds are not byte reproducible

- **Original text:** `evidence/review-report.md:596-605`. Core claim:
  "`scripts/build-process-capsule.mjs:18,68-71` builds under a fresh random Cargo target
  directory. Repeated source-identical Windows builds produced distinct helper SHA-256 values
  ... Each generated manifest correctly matches its adjacent binary, so runtime integrity
  verification works, but the claimed source/compiler/binary provenance is not reproducible
  from the same tree/toolchain. Use a reproducible linker/build configuration and add a
  two-clean-build equality gate, or explicitly narrow the provenance claim."
- **Prior dispositions:** strategy attempt 1 left it open (Minor). The closure Change took the
  finding's own second branch: the provenance claim was explicitly narrowed
  (`implementation-report.md:32`; audit trail in
  `../ecp-native-process-capsule-closure/evidence/provenance-audit.md` - "compiler/source
  digest are build-input provenance and do not promise identical rebuild bytes"). Step 1
  Table A.2: NARROWS under decision 12 - "the byte-reproducibility branch of its 'either prove
  byte-identical or narrow the claim' disjunct is permanently retired as a provenance claim;
  the implemented narrowing ... is the surviving half. Manifest-to-adjacent-binary hash/length
  integrity stays 0.2.0 acceptance" (`step1-scope-reconciliation.md:82, 98`).
- **Decision-13 re-grade:** the LEAD's hypothesis is confirmed: byte reproducibility as
  provenance was retired by decision 12, and decision 13 does not revisit it. Decision 13 adds
  one anchor: the legacy capsule helper remains shipped production on win32, so the retained
  integrity half continues to bind a live binary, and the cutover's explicit pinned-bytes
  integrity task (`proposal.md:12` - both byte-hash pin lists expected green without
  rebaseline, any deviation stops for a LEAD decision) is the current receipt vehicle for it.
- **Verdict:** `narrows` (unchanged by decision 13; the retained half is
  manifest-to-adjacent-binary hash/length integrity on the shipped win32 helper).
- **Verification owed:** the cutover review receipts the pin-list integrity task; independent
  confirmation of the narrowed provenance wording and the retained integrity contract belongs
  to the closure re-review. The finding is not closed until that confirmation lands.

## Accounting statement

Re-grades change which ledger a finding is carried on; they resolve nothing. S2 remains an
open Major of this Change until the named root-exit discriminators exist, pass, and are
independently confirmed on the cutover-shipped tree. S4 remains open with its narrowed
bounded-control residual. S5 remains open pending independent confirmation of the narrowed
contract. S1 and S3 leave 0.2.0 with the parked upgrade-path assets, unconfirmed on real OS,
and stay on the record. This Change still owes a fresh independent review of the cumulative
tree (Architecture Replan 6 DAG); that review, together with the cutover review and the
closure re-review, owns every closure decision - this file owns none.
