# Non-author review — Linux TypeScript oracles and fixture-only audit

Date: 2026-08-07\
Reviewer: non-author leaf worker, report-only. No source, test, task, ledger, or run-state file
was modified. This document is the review's only written artifact.\
Verdict summary: **all three oracle receipts hold for what they claim; 0 Blocker, 5 Major,
8 Minor, 2 Trivial findings; the fixture-only audit found seven instances beyond the three
already known.**

## Scope and basis

Reviewed under the Step 1 re-tier (`evidence/step1-task-ledger-retier.md`) as the scope truth:

- **Task 7.9 in full** (STAYS whole).
- **Task 7.8's TypeScript contribution** — the published-abort oracle — plus execution-level
  review of the six retained native rows. The published-abort row itself is MOVES-UPGRADE-PATH.
- **Task 7.10 only far enough to confirm it is genuinely upgrade-path work** and smuggles nothing
  retained. Confirmed below; it was not line-audited beyond that bar.
- The systemic audit question: which production entry points are exercised only through a fixture
  or a testing-only variant. Run to completion at the stated depth (method and
  exhaustive-vs-sampled statement in its own section).
- Current state of the surviving findings `WSL-R4-M05`, `PKG-P5`, `WSL-R4-M00`, `WSL-R4-M01`,
  and the `BRK-R2-B06` primary-path sibling (F-L2-01/02/03/16).

Deliberately NOT reviewed, with basis: Section 8/9 broker implementation and broker gate work
(MOVES-0.3.0-BROKER — broker instances met during the audit are listed, not analyzed); the
Windows provider (sibling change; one mirror instance noted); package/CI internals beyond
`PKG-P5`; macOS; closure/ECP-8 truth. Superseded lead-3 statements were reviewed only through
lead-4's corrections.

Read in full: `handoff/lead-2.md`, `lead-3.md`, `lead-4.md`; `step1-task-ledger-retier.md`;
`wsl-ts-oracles-lead2.md`; `lead2-implementation-wave-findings.md` (F-L2-01..22);
`wsl-primary-gate-round-4.md`; `wsl-primary-oracle-remediation-plan.md`;
`wsl-native-focused-suites-lead2.md`; `wsl-native-build-manifest-lead2.md`; the change's
`design.md` sections relevant to publication, `specs/linux-process-authority-provider/spec.md`,
`tasks.md`; and the code cited by anchor below.

## Independent verification performed

I recomputed every frozen coordinate the oracle receipt binds to, from the current tree,
including replicating the `name \0 bytes \0` digest convention of
`scripts/build-linux-process-authority.mjs` (the convention whose omitted trailing `\0` once
produced a false LEAD mismatch). All seven match the receipt's rebind table exactly:

```text
sourceDigest (26 files)                      087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
tests/linux_primary_contract.rs              7d56ca4e...b192b1  65505
tests/lifecycle_contract.rs                  57dbddcb...8fa4aa   8833
tests/linux_journal_contract.rs              acbc80e1...433e6a0  7916
tests/linux_identity_contract.rs             e3b92a8e...b76f09a  1988
linux-process-authority-wsl-oracles.test.ts  4c7f84c8...b88aa0  12536
linux-process-authority-wsl-controller.mjs   8d7821b9...919fbf   4693
```

So the receipts remain bound to the tree as it stands; nothing has drifted since the freeze.
I also independently recounted `linux_primary_contract`'s composition from the source: 21 parent
oracles plus 8 gated fixture entry points = 29, matching the receipt's zero-hidden-skip
accounting, and confirmed `recursive_workload_fixture` is gone. I did not execute anything on
WSL; see "Could not verify".

## Verdicts on the three TypeScript oracles

### Task 7.8 — `actual_wsl_published_inert_abort_keeps_workload_closed`: receipt HOLDS

The oracle (`test/core/session-host/linux-process-authority-wsl-oracles.test.ts:261-299`) does
what the remediation plan's M04 section prescribed: real coordinator prepare of
`/usr/bin/touch` against the manifest-verified helper, publish through the bundle's authentic
`publishAuthority`, replacement bundle over the same state root, `published-inert` from
coordinator AND provider AND — the track's own addition — direct native transport inspect
answering `inert` (`:243-246`, the publication-blindness assertion), abort to
`exact-scope-empty`, marker proven absent. Mutation A (ledger commit no-op, RED 3/3) is the
discriminating receipt that the pass depends on the authentic durable ledger; without it these
oracles would be exactly the kind of green F-L2-13 warns about. The falsifier is stated and
plausible: re-apply mutation A and the suite must go RED.

Limits that stand with the verdict: the "replacement" in this oracle is a new JS object in the
same process (process-level replacement is correctly reserved to 7.10's oracles); the plan's
"guardian absence/reconciled terminal state" is asserted only through exact-empty outcome
semantics, never via a direct pidfd/ESRCH probe (ORA-NA-11); and under the re-tier this row is
no longer 0.2.0 acceptance — the receipt's evidentiary quality is unchanged by that.

The six retained native 7.8 rows were executed, not authored, by the receipt's author
(author != verifier holds for them), serially, against digests I re-derived. Their greens remain
serial-conditional per F-L2-16; the receipt ran `--test-threads=1`, consistent with that
condition.

### Task 7.9 — receipt HOLDS, with one named residual on `WSL-R4-M05`

Every 7.9 row is a native-authored oracle the TS track executed. The identity-drift rows rest on
`linux_identity_contract` (hash `e3b92a8e`, unchanged all session, re-derived by me) and
`nondumpable_namespace_drift_with_broken_endpoint_never_signals_replacement`. The
unavailable-configuration matrix (`linux_primary_contract.rs:1475-1512`, fixture at
`:1767-1813`) is real: per-row disposable process, `PR_SET_NO_NEW_PRIVS` plus a bounded BPF
filter (`:1514-1610`), asserting typed `NativeFailureCode::Unavailable`, empty runtime root,
absent workload marker, `ECHILD`, and unrelated-process survival. It discriminates: a prepare
that succeeded under denial fails the fixture at `:1798`, and a wrong failure code fails at
`:1799-1803`.

Residual (ORA-NA-06, Minor): the matrix covers namespace-clone `EPERM`, mapping-write `EACCES`,
mount `EPERM`, `pidfd_open` `ENOSYS`. `WSL-R4-M05` as filed names "denied/missing
namespace/proc/pidfd/mapping cases". The mapping filter deliberately matches only write-open
flags (`:1776-1780`), so a denied read of proc identity fields is exercised nowhere on the
prepare path; the "proc" category is covered only in its mount aspect. The review wave should
either require a proc-read-denial row or record the narrowing explicitly when adjudicating M05.
The tick on 7.9 itself is sound.

### Task 7.10 — receipt HOLDS, and the work is genuinely upgrade-path

Reviewed to the confirmation bar only. Both window oracles
(`linux-process-authority-wsl-oracles.test.ts:301-323` with the controller fixture
`test/fixtures/linux-process-authority-wsl-controller.mjs:109-125`) exist to prove that a
replacement controller recovers `published-inert` from the durable ledger across a real
controller-process SIGKILL — publication/replacement machinery on the task's own words
("proving the durable ledger reports published-inert"). Checks passed: barriers are fsynced
(file and parent directory, `controller.mjs:11-26`) before notification; the controller process
is killed and its `SIGKILL` exit asserted (`:182-195`); recovery goes through the authentic
ledger (no test writes ledger files directly); no provider-side recovery-activation capability
exists in the bundle (`provider.ts` exposes prepare/inspect/terminate/abort/openRuntime and
`publishAuthority` only); the native machine stays publication-blind (primary-mode
`recordPublication` throws — `native-assembly.ts:946-953`). Nothing retained is smuggled: the
retained-surface operations these oracles also cross (prepare, inspect, abort) are additive
evidence, not acceptance the move would hide. `MOVES-UPGRADE-PATH` is the correct grading.

## Findings

### Major

- **ORA-NA-01 — After the re-tier, zero 0.2.0 acceptance rows cross the TypeScript layer
  against a real helper.** The three WSL oracles were the entire real-helper coverage of the TS
  primary path (F-L2-11 said so explicitly). All three are now upgrade-path acceptance: 7.8's
  published-abort row and both 7.10 windows. Task 11.3's narrowed fresh re-run
  (`tasks.md:140`) therefore contains only native suites; the retained TS surface — prepare
  mapping to `prepared-inert`, inspect, prepared abort through
  coordinator/provider/`native-assembly` against a real helper — will never be re-proven by any
  row still in scope. Falsifier: name one retained-scope row in the re-tier that requires a real
  TS-to-helper crossing; I found none in Table A. Recommendation: the wave should add a
  retained-scope TS oracle (the first half of the published-abort oracle, stopping before
  publish) or explicitly record the gap in the 11.8 closure handoff.
- **ORA-NA-02 — The production control verbs `activate` (success path), `terminate`, and
  `open-runtime` are crossed end-to-end by zero tests.** TS side: `transport.activate`,
  `transport.terminate` (`native-assembly.ts:1007-1027`) and `runtimeFor` (`:733-746`) are never
  invoked against a real helper by any test — runtime-bridge tests inject `FakeRuntimeChild`
  through `openLinuxAuthorityRuntimeBridgeForTesting` (`:749-755`), and the WSL oracles never
  activate by design. Native side: zero `CARGO_BIN_EXE` references exist in the whole crate's
  tests; exactly two tests spawn the helper CLI (`linux_primary_contract.rs:926` inspect,
  `:996` activate-rejection). So the CLI `open-runtime` and `terminate` arms
  (`main.rs:110-129`, `:177-187`) and the CLI activate success arm (`:137-140`) execute under
  no test anywhere, in either language. These are exactly the verbs carrying the deadline-discard
  sibling. Falsifier: a test that drives TS `terminate` against a real helper; none exists
  (grep-verified). This is the largest new instance for the fixture-only audit.
- **ORA-NA-03 — The artifact-resolver test shadows production names with wrappers that call the
  `ForTesting` twins, defeating name-based audits.**
  `test/core/session-host/linux-process-authority-artifact-resolver.test.ts:27-40` defines local
  functions named `inspectLinuxProcessAuthorityArtifact` / `resolveLinuxProcessAuthorityArtifact`
  that delegate to `inspectLinuxProcessAuthorityArtifactForTesting` /
  `resolveLinuxProcessAuthorityArtifactForTesting`. Every apparent production-name call in that
  file is the testing seam. The true production twins (`artifact-resolver.ts:284-288`,
  `:350-354`) have zero test references; their delta — resolution against the compiled-in
  `LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES` — is the same by-design F-L2-11 gap, but the
  shadowing made my grep sweep report false coverage until the call sites were opened. A future
  reviewer running the same audit will be misled the same way. Mutation that proves the point:
  break the production constant lookup (`inspectWithBuildAuthority`'s `authorities` argument at
  the production call site) — the resolver suite stays green.
- **ORA-NA-04 — `createLinuxPrimaryProcessAuthorityProviderBundle` is tested only in its
  degraded branch.** In-repo the build-identity constant is frozen empty, so
  `createLinuxPrimaryNativeAssembly` always throws and `productionBundle` swallows it into
  `unavailableNativeAssembly()` (`provider.ts:1038-1045`). The production-factory test
  (`linux-process-authority-provider.test.ts:267-306`) therefore exercises state-root guards,
  ledger directory creation, injection refusal, and `authority-unavailable` prepare — never a
  functioning production assembly. That combination first exists inside a packaged install, in
  the field. Compounding detail: the bare `catch {}` at `provider.ts:1043` erases the resolution
  failure reason — a corrupted install, a wrong-platform run, and a missing identity all
  collapse into the same fixed `artifact-unavailable`, which will make field diagnosis
  needlessly blind. Falsifier for the coverage claim: a test constructing the production bundle
  with a populated build authority; none exists (the ForTesting bundle takes injection instead).
- **ORA-NA-05 — `BRK-R2-B06` primary-path sibling: confirmed live in the frozen tree; graded
  Major, not Blocker.** Verified on current bytes: `open-runtime` validates and discards
  `--deadline-ms` (`main.rs:117`), `inspect` discards (`:149`), `terminate` discards the
  deadline and uses only grace (`:184-185`); `activate` routes into
  `AbsoluteMonotonicDeadline::after_ms` (`:137-139`) — a re-anchored delta, exactly as F-L2-02
  says, not an absolute deadline. `CONTROL_TIMEOUT` = 2s (`primary.rs:30`) is applied to every
  control-socket read/write (`:1040-1041`) and hardcoded into the library conveniences
  (`:112-116`, `:157`, `:233`, `:255`) — the F-L2-16 flake mechanism. New mechanics this review
  adds to the record: (a) the TS coordinator does enforce an outer bound — it aborts the
  operation signal at `deadline` (`coordinator.ts:834-842`, `:940-957`) and `invoke` SIGKILLs
  the helper on abort (`native-assembly.ts:526-527`) — so runaway work on the primary path is
  bounded by external process kill plus per-operation revalidation, unlike the broker instance
  where mutating daemon work continued ownerless in detached threads; (b) killing the control
  helper mid-verb leaves the guardian alive and the outcome to control-loss recovery, which is a
  recoverable state, not silent corruption; (c) there are now three uncoordinated deadline
  constants on one path: native 2s, the TS 300s clamp (`native-assembly.ts:214`), and a
  hardcoded `300_000` in `runtimeFor` (`:740`). Sibling severity as filed by this review:
  **Major** — dishonored caller budgets and serial-conditional greens, but no unbounded
  ownerless mutation. Resolve as one piece with B06 as F-L2-03 already argues.

### Minor

- **ORA-NA-06** — `WSL-R4-M05` residual: no prepare-path proc-read-denial row; see the 7.9
  verdict for anchors and the falsifier.
- **ORA-NA-07** — Scope-record count drift on 7.8, the recap-drift shape this repo documents:
  the task text names seven oracles; one (published abort) moves; six stay. The re-tier row
  says "Seven of the eight named oracles stay" while its own parenthetical lists six
  (`step1-task-ledger-retier.md:141`), and the review dispatch said "the other seven stay". No
  verdict changes, but this exact language will propagate into a wrong denominator if left.
- **ORA-NA-08** — The 7.2 re-emit receipt's own Boundary line claims to close `PKG-P5`
  (`wsl-native-build-manifest-lead2.md:11` — "Closes Task 7.2 and the Minor PKG-P5"), which
  contradicts the findings file's rule that the implementation wave closes no findings. The
  retier and lead-4 already flagged lead-2's version of this claim; the receipt itself carries
  the same overclaim and should be read with the same correction.
- **ORA-NA-09** — `wsl-ts-oracles-lead2.md:412` calls the author-run mutation matrix the
  oracles' "independent check". A self-run mutation matrix is a self-check — necessary, good,
  and not independent. The receipt elsewhere says the non-author review is still owed (correct);
  this document is that review.
- **ORA-NA-10** — Confirmation with anchors of the known contract-scope disagreement: the
  shipped 0.2.0 primary descriptor still declares the full frozen semantics array including
  `replacement-recovery` and `publish-before-activate`
  (`src/core/session-host/process-authority/linux/contracts.ts:26`,
  `src/core/session-host/process-authority/types.ts:25-36`), while Step 1 moved that acceptance
  to the upgrade path. lead-4 already serialized the contract change behind the re-tier; until
  it lands, code and scope disagree in a frozen constant that macOS must not be proposed
  against.
- **ORA-NA-11** — M04 oracle plan delta: the remediation plan's step 5 asks for "guardian
  absence/reconciled terminal state"; the oracle asserts exact-empty outcomes and marker
  absence but never directly probes guardian absence (no pidfd/`ESRCH` assertion). Indirectly
  carried by native abort semantics (`primary.rs:182-205`); record the delta so M04's closure
  is made knowingly.
- **ORA-NA-12** — The delta spec carries upgrade-path and broker requirements with no scope
  marking (`specs/linux-process-authority-provider/spec.md:49-75` durable publication,
  `:141-167` durable reopen, `:169-203` broker authority). The re-tier deliberately changed no
  spec text, so `rasen archive` / sync-specs will project these into main specs as delivered
  0.2.0 surface; the narrowed 11.8 closure handoff is the only guard, and validate does not
  check this. One flag now is cheaper than an archive-time surprise. (The escape requirement at
  `:77-93` is, notably, already scoped to workload-created mechanisms — it does not repeat the
  `workload-non-escape` overclaim; that overclaim lives only in the frozen constant.)
- **ORA-NA-15** — `acknowledgePublishedProcessAuthority`
  (`process-authority/process-scope-adapter.ts:293`) is exported production surface with zero
  test references and zero production callers other than its index re-export. Either
  closure-owned future surface (then say so where it is defined) or dead code.

### Trivial

- **ORA-NA-13** — The oracle receipt's corrections table anchors the M05 fixture at
  `linux_primary_contract.rs:1417`/`:1709`; in the frozen file it is `:1475`/`:1767`. Stale
  anchors in a receipt that binds the very digest they disagree with.
- **ORA-NA-14** — The oracle harness pins `deadline: Number.MAX_SAFE_INTEGER`
  (`linux-process-authority-wsl-oracles.test.ts:126-133`), so `remainingBudgetMs` always emits
  its 300s clamp; no TS real-helper test varies a deadline. The oracles are structurally blind
  to deadline-discard defects — not their job, but nobody should cite them against F-L2-01/03.

## Fixture-only / testing-variant audit — the dedicated section

**Method.** TypeScript: enumerated every `export function|class|const` under
`src/core/session-host/process-authority/` and `process-authority/linux/` (65 symbols); each
was grepped across `test/` with a word-boundary regex that cannot conflate a production name
with its `ForTesting` extension; every zero-hit and suspicious hit was then opened at the call
site (which is what caught the ORA-NA-03 shadowing that pure grep misses). Native crate:
repo-wide `CARGO_BIN_EXE` sweep (zero hits), `Command::new` sweep of all test files, fixture
entry-point enumeration, and `FsCgroupKernel`/`FixtureKernel` reference checks.
**This sweep is exhaustive at the export level for the common+linux TypeScript tree and for
native CLI-spawn sites; it is sampled for the Windows TypeScript subtree and for native
library-internal functions** (library fns were assessed only via the suites that import them).

**The three known instances, re-confirmed current:** `FsCgroupKernel` — still zero references
under `native/linux-process-authority/tests/`; `createLinuxPrimaryNativeAssembly`
(`native-assembly.ts:1061`) — still zero test references while only its `ForTesting` twin is
exercised; `linux_broker_cgroup_contract` — the only test file referencing a kernel, and it is
`FixtureKernel`.

**New instances found by this review, in severity order:**

1. TS `transport.activate`/`transport.terminate`/`runtimeFor` plus the CLI `open-runtime`,
   `terminate`, and activate-success arms — zero end-to-end crossings in any language
   (ORA-NA-02).
2. `inspectLinuxProcessAuthorityArtifact` / `resolveLinuxProcessAuthorityArtifact` — zero true
   test references, disguised by test-local shadow wrappers (ORA-NA-03).
3. `createLinuxPrimaryProcessAuthorityProviderBundle` — exercised only in its
   degraded/unavailable branch (ORA-NA-04).
4. Both production broker binaries (`src/bin/rasen-linux-process-authority-broker.rs`,
   `...-broker-client.rs`) are executed by zero tests; `linux_broker_service_contract` drives a
   fixture daemon that re-executes the test binary (`linux_broker_service_contract.rs:1613`,
   `:1769`). The shipped daemon binary is also the sole production consumer of `FsCgroupKernel`,
   so the two known instances compound here. [0.3.0-broker surface — listed, not analyzed]
5. `createLinuxBrokerNativeAssembly` — zero test references. [0.3.0-broker]
6. `assertLinuxBrokerPreparationDeliveryLedger` — zero test references. [0.3.0-broker]
7. `acknowledgePublishedProcessAuthority` — zero tests and zero production callers (ORA-NA-15).

**Mirror instance outside this change's scope:** the Windows resolver tests likewise exercise
only `inspect/resolveWindowsProcessAuthorityArtifactForTesting`
(`windows-process-authority-artifact-resolver.test.ts:11-13`); the Windows change owes its own
sweep.

**Checked and cleared (indirect coverage through tested production callers — not instances):**
`selectProcessAuthorityProviderFromRegistry`, `manifestEntryMatchesDescriptor`,
`mapProcessAuthorityControlOutcome`, `createLinuxAuthorityPublicationAccess` (crossed via
`createBundle` in every publish test), `PROCESS_AUTHORITY_RECEIPT_CACHE_LIMIT`,
`LINUX_PROCESS_AUTHORITY_ARTIFACT_SCHEMA`. All other exported symbols have direct test
references.

## Current state of the other surviving findings

- **`WSL-R4-M00`** — closure candidate exists and is narrowed as the retier says: the 18-row
  checkpoint matrix (`primary.rs:2492-2511` per the Track A receipt, `CONSTRUCTION_CHECKPOINTS`
  with the wildcard-free position match per F-L2-08) covers construction through final
  revalidation; the ready-hook rows leave with NATIVE-SEAM-R1-M01/M02. I verified the receipt's
  claims at the file level, not the E0004 forcing mutation. Adjudication belongs to the wave;
  nothing I found blocks it.
- **`WSL-R4-M01`** — closure candidate exists: root-status corruption matrix
  (`lifecycle_contract`), `final_child_exit_orders_root_status_before_exact_empty`
  (`linux_primary_contract.rs:638`), terminal crash matrix (`linux_journal_contract`). The
  owner-death rows re-grade to the upgrade path per Table B. Same verification depth as M00.
- **`WSL-R4-M05`** — real closure candidate with the ORA-NA-06 residual.
- **`PKG-P5`** — the staleness ground is gone: the lead-2 re-emit binds task 7.2 to
  `087d87a5`, which I re-derived from the current tree (26 files, byte-exact). Closable by the
  wave, with one coherence item to record at closure: the reproducible artifact after the
  F-L2-15 fix is `4835b1bb…`@578312 while the freeze-era receipts and the recorded
  `build-authority.js` pin `94002604…`@578440; the next packaging pass must re-emit these
  coherently or the pinned identity will refer to a binary that no longer reproduces.
- **`BRK-R2-B06` primary sibling** — ORA-NA-05 above; carried by F-L2-01/02/03/16, all four
  confirmed live on current bytes.

## Disagreements with prior claims

1. **With the oracle receipt (`wsl-ts-oracles-lead2.md:412`):** "their independent check is the
   mutation matrix" — contradicted by the word's meaning; author-run matrices are self-checks
   (ORA-NA-09). The receipt's other self-assessments held up under verification.
2. **With the 7.2 re-emit receipt (`wsl-native-build-manifest-lead2.md:11`):** "Closes ... the
   Minor PKG-P5" — contradicted by `lead2-implementation-wave-findings.md`'s Boundary ("The
   implementation wave does not close findings"). Same disagreement the retier filed against
   lead-2; the receipt carries it too (ORA-NA-08).
3. **With the re-tier record (`step1-task-ledger-retier.md:141`):** "Seven of the eight named
   oracles stay" — contradicted by the task's own text (seven named; six stay) and by the row's
   own six-item parenthetical (ORA-NA-07).
4. **With the receipt's corrections table (`wsl-ts-oracles-lead2.md` C6):** stale line anchors
   `:1417`/`:1709` vs the frozen file's `:1475`/`:1767` (ORA-NA-13).
5. **Lead-4's open spot-check discharged, in agreement:** the retier's 2.3/6.2/6.3/6.4
   narrowing argument holds in code. Every TS control verb spawns a fresh helper
   (`native-assembly.ts` `invoke` per call), and every native control reopens and revalidates
   identity per operation (`AuthorityClient::new` at `primary.rs:88-102`;
   `reopen_or_prove_absent` in `inspect_evidence` `:146-180` and `abort` `:182-186`). The
   private-reference open/revalidate path is live control machinery and cannot move wholesale.

## What I could NOT verify, and why

- **Any WSL execution claim** — greens, timings, skip counts, the twelve historical oracle
  executions, the F-L2-16 flake rates. No WSL run was performed this session. My verification
  is code-level, digest-level (re-derived, matching), and internal-consistency-level.
- **The mutation matrix REDs (A-D)** — the mutations were applied to a run tree and reverted;
  they are unverifiable post-hoc by construction. Re-establishing them means re-applying
  mutation A against the run tree and watching the three oracles fail.
- **The E0004 non-exhaustiveness forcing** behind F-L2-08 — claim taken at receipt level.
- **`build-authority.js` and the packaged artifacts** — they live in WSL-side package roots
  outside this repository.
- **The broker instances' details** (audit items 4-6) — deliberately, per scope.

## Durable findings

1. Test-local wrappers that reuse a production symbol's exact name while delegating to its
   `ForTesting` twin make name-based coverage audits report false positives — audit by opening
   call sites, never by grep alone.
2. After the re-tier, no 0.2.0 acceptance row crosses the TypeScript layer against a real
   helper, and the control verbs `activate`(success)/`terminate`/`open-runtime` are crossed by
   zero tests end-to-end in either language — the cancel path this design exists for is the
   least-tested path in it.
3. On this change, execution re-verification is cheap and high-yield: independently re-deriving
   the seven frozen digests took minutes and converted an entire receipt chain from "claimed"
   to "bound"; the two receipts that overclaimed did so in prose, not in their numbers.
