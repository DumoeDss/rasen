# Independent Review Report: fix-workspace-claim-portability

- Mode: dispatched, report-only, non-author review
- Review date: 2026-08-09
- Round 2 re-review date: 2026-08-10
- Round 3 delta-only re-review date: 2026-08-10
- Branch: `fix/archive-transaction-recovery-follow-up`
- Pre-child HEAD / current PR head: `27b2d4c2fb6828fa9849b85cbfb458a47f2a0fac`
- Reviewed implementation delta: `src/core/store/workspace/dependencies.ts` (407 insertions, 141 deletions) and the new focused `test/core/store/workspace-atomic-write.test.ts`
- Spec source: the complete child proposal/design/spec/tasks, parent planning context, RSR-5/RSR-6, and the relevant recovery background in the original defect report
- Excluded: every concurrent registry/archive/validator/Store-finalization delta, including the stale assertion at `test/core/store/finalization-association.test.ts:572`
- Round 1 verdict: **FAIL — 4 unresolved findings (2 Blocker, 0 Major, 2 Minor, 0 Trivial)**
- Current Round 3 verdict: **CLEAN — 0 unresolved findings (0 Blocker, 0 Major, 0 Minor, 0 Trivial); R2-F3b is non-author-confirmed resolved**

## Scope check

**CLEAN.** The product delta is confined to the atomic workspace dependency adapter and one focused test file. It changes self-contained carrier recovery, exact BigInt stat capture, cleanup ownership checks, and directory durability classification as requested. It does not change Git verbs, project selection, archive recovery, Store-finalization admission, CLI surfaces, dependencies, or the coordination root. Concurrent dirty-worktree files were excluded from this review.

## Round 1 findings — historical

### F1 — [Blocker] A journal-bound retry falls back to self-contained authority when the journal has not yet recorded the retained claim

The writer decides that a retained claim is journal-bound only when `expectedBefore.authority` is already present. When a claim exists but authority is absent, the checks at `src/core/store/workspace/dependencies.ts:681-725` parse and adopt it as self-contained even if `onPrepared` proves this caller is the journaled finalization path; the callback is not invoked for the adopted claim. The exact-content no-carrier return at `src/core/store/workspace/dependencies.ts:523-541` likewise permits a journaled caller with `onPrepared` but no authority to finish without recording authority.

This state is reachable in the real caller. Archive finalization first persists `associationProgress.state = intent-durable`, then passes the possibly empty recorded carrier list plus `carrierPrepared` (`src/core/archive-engine.ts:12384-12418`; `src/core/store/finalization/association.ts:297-306,334-340`). The atomic writer durably publishes the claim at `src/core/store/workspace/dependencies.ts:643-669` before calling `onPrepared` at line 670. A crash in that window leaves a complete claim and an `intent-durable` journal with no carrier authority. The next journal-bound retry therefore takes the self-contained path and can publish/delete without first placing the carrier under the external journal authority. This directly violates “Journal-bound writes SHALL additionally require their recorded external authority and SHALL NOT fall back to unjournaled recovery.”

Recommended correction: make journal-bound mode explicit (rather than infer it only from non-null authority). When a retained exact claim has no recorded authority, either persist a reconstructed, revalidated authority through `onPrepared` before any target/backup mutation or fail closed; never continue as self-contained. Add a regression for interruption after durable claim publication but before the carrier callback is recorded, and assert that retry records authority before publication/removal.

Classification: **ASK / Blocker** — required recovery authority is missing on a plausible crash window and this changes the transaction protocol.

### F2 — [Blocker] Backup bytes are not revalidated at the immediate unlink boundary

Cleanup initially verifies the backup identity and `beforeDigest` at `src/core/store/workspace/dependencies.ts:893-906`. It then awaits directory validation, a foreign-carrier scan, claim validation, and published-target validation. The final check immediately before `unlink()` calls `requireOwnedCarrier(..., expectedContent: undefined)` at `src/core/store/workspace/dependencies.ts:912-922`, so it checks only the serialized `dev`/`ino`/`mode`/`size` identity and omits `claim.beforeDigest`.

A concurrent in-place, equal-size write to the backup after the earlier digest check preserves every serialized identity field. The final read observes the changed bytes but accepts them because no expected content/digest is supplied, and line 922 deletes the now-unproven backup. Intent and claim cleanup do include exact content at their final checks; backup cleanup is the lone destructive boundary that does not. This violates the proposal’s no-delete guarantee for unproven state and the design requirement to re-read owned state immediately before unlinking.

Recommended correction: perform the `beforeDigest` check as part of the final pre-unlink backup validation (for example, through the digest-validating backup helper), after all other awaited checks and before `unlink()`. Add a boundary regression that mutates the backup in place to different equal-length bytes between the first observation and cleanup; the write must return `workspace_atomic_write_conflict` and retain that backup.

Classification: **ASK / Blocker** — the current race can delete changed, unproven bytes.

### F3 — [Minor] The checked task claims a directory-sync fault matrix that the focused test does not execute

`test/core/store/workspace-atomic-write.test.ts:495-521` verifies the tuple classifier as a pure function. The integration cases execute a tolerated Windows **open** error (`:523-536`), a genuine directory-open error, file-sync failure, and close failure, and the ancestry replacement case is also only on the tolerated **open** branch (`:606-632`). No injected tolerated directory-**sync** error drives `syncDirectory()` through `unsupportedSync` and its post-close canonical-directory revalidation at `src/core/store/workspace/dependencies.ts:431-446`; no sync-stage ancestry replacement is exercised. `failDirectorySyncOnce()` injects `EIO`, which covers genuine failure, not a tolerated tuple.

This leaves task 3.1 (“inject directory-open, directory-sync, file-sync, and handle-close failures independently across the explicit Windows and POSIX policy tuples, including ancestry replacement during an otherwise tolerated fault”) only partially satisfied even though it is checked complete. Native Windows execution plausibly traverses `sync/EPERM`, but the test neither injects nor asserts that boundary, and POSIX runtime evidence remains task 4.3.

Recommended correction: add deterministic writer-level cases for at least Windows `sync/EPERM` and the POSIX allowed sync codes, including directory replacement after a tolerated sync result; assert completion/cleanup for unchanged ancestry and `workspace_atomic_write_conflict` for replacement. Keep task 4.3 open until real Windows and POSIX CI evidence is recorded.

Classification: **AUTO-FIX candidate / Minor** — coverage/completeness gap; no incorrect tuple implementation was established.

### F4 — [Minor] The path-identity change has no atomic-writer alias-path regression required by `test/AGENTS.md`

This child makes canonical directory identity part of every recovery and durability decision (`src/core/store/workspace/dependencies.ts:393-416`) and compares journal carrier paths and targets exactly (`:500-506`). The new tests route mock calls with lexical `path.resolve()` comparisons and simulate ancestry drift by returning a made-up realpath, but never retry through a real symlink/junction/short-name/case/separator alias. The existing alias coverage in `workspace-windows-paths.test.ts` exercises worktree identity, not atomic carrier recovery.

The local test guidance requires canonicalizing both ends of existing-path identity checks and adding an alias-path regression whenever path identity changes. The absence matters here because the intended distinction between exact target spelling and canonical-directory identity is otherwise not locked: a future change could silently accept a foreign target spelling or reject a legitimate same-directory retry without a focused failure.

Recommended correction: add a real alias-path case for the atomic writer (junction/symlink where supported, plus native Windows case/separator spelling) and explicitly assert the intended contract: canonical-directory equivalence plus exact target/authority behavior, with byte-for-byte carrier retention on refusal. Use `fs.realpathSync.native()` on both existing-path expectations as required by `test/AGENTS.md`.

Classification: **AUTO-FIX candidate / Minor** — repository-standard coverage gap.

## Round 1 Standards axis

| Finding | Severity | Result |
|---|---:|---|
| F1 journal-bound mode loses its authority boundary in the pre-callback crash window | Blocker | Fail — concurrency/recovery protocol violation |
| F2 final backup unlink omits immediate digest proof | Blocker | Fail — destructive race can remove changed evidence |
| F4 no atomic-writer alias-path regression | Minor | Fail — local test guidance is incomplete |

Standards axis: **3 findings; worst Blocker.** No SQL/LLM/frontend/dependency/bundle concern applies. No new enum consumer, dead code, unrelated refactor, or Git mutation surface was found. Focused ESLint and TypeScript compilation pass.

## Round 1 Spec axis

| Requirement / task | Disposition | Evidence |
|---|---|---|
| Same unjournaled write resumes exact target/bytes/state | Pass for reviewed states | Exact pre-claim intent and retained phase retries are implemented at `dependencies.ts:547-930` and covered by the interruption table at `workspace-atomic-write.test.ts:172-209`. |
| Changed/corrupt/replaced state is retained | Partial / **F2** | Target, intent, claim, and pre-resume backup replacement are covered, but an in-place backup byte change at the final cleanup boundary can be deleted. |
| Journal authority remains mandatory and never falls back | Fail / **F1** | Mismatching supplied authority is refused, but missing authority on a journal-bound retained claim falls through to self-contained recovery. |
| Windows filesystem identities remain exact | Pass at capture/comparison level | BigInt `dev`/`ino` are serialized exactly; the focused test proves values that collide after Number conversion remain distinct (`workspace-atomic-write.test.ts:449-492`). |
| Unsupported directory durability uses exact platform/stage/code tuples | Pass in implementation; coverage partial / **F3** | The table is explicit and excludes `EACCES`; the tolerated sync execution/revalidation branch lacks deterministic writer-level coverage. |
| Genuine I/O, file-sync, and close failures remain visible | Pass | `EACCES`, file `sync/EPERM`, directory `EIO`, and close `EBADF` are exercised and retain resumable evidence. |
| Unsupported result cannot hide directory replacement | Pass for open; partial for sync / **F3** | Open-stage replacement is covered; sync-stage replacement is not. |

Spec axis: **3 affected requirements/tasks represented by F1-F3; worst Blocker.** F1 is a direct mandatory-authority failure; F2 makes the owned-state cleanup guarantee incomplete; F3 is a checked-task coverage gap.

## Round 1 compact coverage diagram

```text
CODE PATH COVERAGE
==================
[+] fresh / retained unjournaled write
    ├─ [★★★ TESTED] exact pre-claim intent adoption; partial intent refusal
    ├─ [★★★ TESTED] claim/backup/target/cleanup interruption replay
    ├─ [★★★ TESTED] different bytes, changed target, corrupt/replaced carriers
    └─ [GAP/BLOCKER] final backup bytes change after first digest check — F2

[+] journal-bound write
    ├─ [★★★ TESTED] supplied authority field/identity mismatches refuse
    └─ [GAP/BLOCKER] durable claim exists before callback authority is recorded — F1

[+] directory durability
    ├─ [★★ TESTED] exact classifier allow/deny table
    ├─ [★★★ TESTED] tolerated open, EACCES, file-sync, close, genuine sync EIO
    ├─ [GAP/MINOR] injected tolerated sync + post-sync ancestry replacement — F3
    └─ [GAP/MINOR] real alias spelling through atomic recovery — F4

[+] exact identity
    └─ [★★★ TESTED] BigInt NTFS values stay distinct past Number.MAX_SAFE_INTEGER

USER FLOW COVERAGE
==================
[+] plan/index/lock coordination crash → same unjournaled retry completes
[!] archive association claim crash → journal lacks carrier → silent fallback (F1)
[+] Windows unsupported directory durability → coordination remains writable
[!] cross-platform sync-stage and alias-path evidence remains incomplete (F3/F4)
```

## Round 1 independent verification

- `pnpm exec vitest run test/core/store/workspace-atomic-write.test.ts` — **41/41 passed**.
- `pnpm exec vitest run test/core/store/workspace-git-verb-guard.test.ts test/core/store/workspace-windows-paths.test.ts test/core/store/workspace-identity.test.ts` — **41/41 passed** across 3 files.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm exec eslint src/core/store/workspace/dependencies.ts test/core/store/workspace-atomic-write.test.ts` — passed.
- `rasen validate fix-workspace-claim-portability --strict --json` — passed, 1/1 change valid.
- A broader 10-file workspace command exceeded the 240-second local command limit without producing a final Vitest result; it is recorded as **inconclusive**, not as a test failure and not as evidence for the reported 116/116 implementer run.
- `git diff --check` on the tracked implementation delta passed. Both scoped source/test files strictly decode as UTF-8; no BOM/mojibake issue was observed.
- PR #148 is draft and still points to pre-child OID `27b2d4c2`; it has no eligible Greptile comments for this uncommitted child delta.
- Task 4.3 remains correctly open: real Windows and POSIX CI evidence is not yet available.

## Round 1 explicit disposition

**Do not land or locally ship this child yet.** Route F1 and F2 to a non-author fixer, add their regressions, close the deterministic coverage gaps F3/F4, then perform a non-author delta re-review. Preserve the existing 82 independently green focused tests, exact tuple policy, and BigInt identity behavior.

## Round 1 durable findings

1. A caller with a journal callback but no recorded carrier is still journal-bound; retained claims must be journaled before any resumed mutation, never silently reclassified as self-contained.
2. Destructive cleanup proof must be the last check and must include the backup digest, not only stable inode-shaped fields.
3. Keep `test/core/store/finalization-association.test.ts:572` assigned to `fix-store-finalization-admission`; task 4.3 remains an external Windows/POSIX CI hold.

## Round 2 delta-only re-review — 2026-08-10

Pre-Landing Review: **1 open issue (1 Blocker, 0 Major, 0 Minor, 0 Trivial).** The non-author fixer closed all four Round 1 findings at their original code/coverage boundaries. One deterministic POSIX gate failure was found while re-reviewing the F3 test delta, so the child is not CLEAN yet.

### Round 2 scope check

**CLEAN.** The remediation delta remains confined to `src/core/store/workspace/dependencies.ts` and `test/core/store/workspace-atomic-write.test.ts`. It adds explicit journal-bound recovery, final backup digest proof, deterministic sync-tuple coverage, and real alias-path coverage. No archive delta, Store-finalization assertion, task state, dependency, CLI surface, Git verb, or run-state was modified by this reviewer.

### F1 — [RESOLVED Blocker] Missing journal authority is reconstructed before every mutation

- `journalBound` now includes either supplied authority or `onPrepared` (`src/core/store/workspace/dependencies.ts:450-453`). A same-content/no-carrier journaled call without authority fails closed at `:540-564`.
- A retained claim with missing authority enters `prepareRecoveredJournalAuthority` at `:700-748`. Reconstruction requires the claim's exact prior digest/identity to match the caller snapshot, the target to remain that exact before-state, and the backup to remain absent (`:802-826`). The implementation then revalidates directory, foreign carriers, claim, intent, target, and backup at `:827-840`.
- `await onPrepared(reconstructed)` is at line 846. The first target/backup mutation is later at line 893; a rejected callback exits before every `link`/`unlink`. A callback that succeeds makes the reconstructed value the active `journalAuthority` before mutation at line 847.
- `records reconstructed journal authority before resuming a retained claim` proves the callback is the first recorded mutation event and the authority equals the original exact carrier (`test/core/store/workspace-atomic-write.test.ts:376-417`). `fails closed when a journal-bound exact-content write has no carrier authority` covers the carrier-free case (`:419-440`).

Disposition: **NON-AUTHOR-CONFIRMED RESOLVED.** Missing-authority recovery cannot authorize a target already removed/published/replaced or any state with a backup already present, and callback persistence failure blocks mutation.

### F2 — [RESOLVED Blocker] Final backup proof includes `beforeDigest` immediately before unlink

- Backup cleanup now calls the digest-checking `requireBackup()` at `src/core/store/workspace/dependencies.ts:980-985`; `fs.unlink(ownedPath)` follows immediately at line 994 with no intervening awaited operation.
- `requireBackup()` binds the exact backup identity and hashes the freshly read content against `claim.beforeDigest` (`:772-792`).
- `revalidates equal-size backup bytes immediately before unlink` mutates the same backup inode to different equal-length bytes after the earlier observation, then proves `workspace_atomic_write_conflict` and preservation of the mutated backup plus claim (`test/core/store/workspace-atomic-write.test.ts:574-610`).

Disposition: **NON-AUTHOR-CONFIRMED RESOLVED.** The destructive boundary now uses the last available read to prove both identity and content.

### F3 — [ORIGINAL Minor RESOLVED; NEW Blocker OPEN] Sync coverage is complete, but a Windows-only open test is unconditional on POSIX

The original coverage finding is resolved:

- Writer-level tolerated sync tests execute Windows `EPERM`, Linux `EINVAL`/`ENOTSUP`, and Darwin `EINVAL`/`ENOTSUP` through the real `syncDirectory()` boundary (`test/core/store/workspace-atomic-write.test.ts:733-752`).
- The tolerated-sync ancestry-replacement path reaches `unsupportedSync` and proves `workspace_atomic_write_conflict` (`:850-881`).
- The allowlist remains exact (`src/core/store/workspace/dependencies.ts:219-246`): `EACCES`, `EIO`, `ENOSPC`, `EBADF`, Linux `EPERM`, and unlisted platform/stage/code combinations are not swallowed. File-sync and close failures still have separate visible-error tests (`test/core/store/workspace-atomic-write.test.ts:754-820`).

#### R2-F3b — [Blocker] `open/EISDIR` Windows policy test will fail the required POSIX job

`tolerates a named directory-open fault on Windows and completes cleanup` injects `EISDIR` at `test/core/store/workspace-atomic-write.test.ts:718-731`, but it neither mocks `process.platform` to `win32` nor uses a Windows-only `runIf/skipIf`. On Linux/Darwin the implementation correctly has no `open/EISDIR` allowlist tuple, so `syncDirectory()` rethrows at `src/core/store/workspace/dependencies.ts:420-429` while the test unconditionally expects success.

Independent deterministic evidence: a read-only inline probe against the current matching `dist` set `process.platform` to `linux`, injected the same directory-open `EISDIR`, and returned `RESULT_CODE=EISDIR`. Therefore the required POSIX CI job will fail this focused file before task 4.3 can be completed.

Recommended correction: make the policy test platform-explicit. Prefer mocking `process.platform` to `win32`, as the new sync table does, so the Windows tuple remains deterministically exercised on every host; alternatively use an honest Windows-only test that is reported as skipped on POSIX. Then rerun this file on real Windows and POSIX.

Classification: **AUTO-FIX candidate / Blocker** — the fix is mechanical, but a deterministic required test-gate failure is canonical Blocker severity.

### F4 — [RESOLVED Minor] Atomic carrier identity now has a real alias-path regression

- `sameExistingPath()` canonicalizes both existing operands with `fs.realpathSync.native()` (`test/core/store/workspace-atomic-write.test.ts:82-94`), satisfying `test/AGENTS.md` for identity assertions.
- The alias regression creates a real Windows junction or POSIX directory symlink, proves the physical and alias paths resolve to the same existing directory/target, records authority through the alias spelling, refuses the physical spelling without changing target/carrier bytes, and completes through the exact recorded alias (`:442-517`).
- The local Windows rerun reported **51 passed, 0 skipped**, so the junction case executed rather than being counted as a pass after a platform skip. On non-Windows the test uses a real directory symlink; if the host explicitly rejects alias creation, `context.skip()` records a skip rather than a pass (`:448-463`).

Disposition: **NON-AUTHOR-CONFIRMED RESOLVED.** Canonical-directory equivalence no longer implies target/authority spelling equivalence.

### Round 2 Standards axis

| Finding | Severity | Result |
|---|---:|---|
| F1 journal-bound reconstruction | Blocker | Resolved |
| F2 backup final digest proof | Blocker | Resolved |
| F4 alias-path coverage | Minor | Resolved |
| R2-F3b unconditional Windows tuple test | Blocker | **Open — deterministic POSIX gate failure** |

Standards axis: **1 open finding; worst Blocker.** No new concurrency, destructive cleanup, tuple-classification, alias-identity, dead-code, dependency, Git-verb, or Fowler-smell defect was found in the remediation delta beyond the test portability gate.

### Round 2 Spec axis

The product requirements behind F1-F4 are implemented: journal-bound recovery never silently becomes self-contained, missing authority is reconstructed only from the intact before-state and persisted before mutation, backup cleanup proves its final digest, exact tuple policy remains fail-closed, and canonical aliases do not weaken exact target authority.

Spec axis: **0 open implementation findings; worst none.** Task 3.1's deterministic sync coverage is now satisfied. Task 4.3 remains correctly unchecked, but R2-F3b must be fixed before the required real POSIX verification can pass.

### Round 2 compact coverage diagram

```text
journal-bound retained claim
├─ target exact before-state + backup absent ── callback persisted first [★★★ TESTED]
├─ target/backup already mutated ────────────── fail closed [CODE + TEST MATRIX]
├─ callback rejects ─────────────────────────── no link/unlink [CODE VERIFIED]
└─ exact target, no carrier/authority ───────── fail closed [★★★ TESTED]

cleanup
└─ backup changed in place, equal size ──────── final digest conflict; retained [★★★ TESTED]

directory durability
├─ sync: win32/linux/darwin allowlist ───────── [★★★ TESTED]
├─ sync: ancestry replaced after tolerated ──── [★★★ TESTED]
├─ EACCES/file-sync/close/EIO ───────────────── visible [★★★ TESTED]
└─ open/EISDIR Windows case on POSIX ────────── [BLOCKER: test expects wrong host policy]

alias identity
└─ junction/symlink canonical dir + exact path ─ [★★★ TESTED; Windows 0 skips]
```

### Round 2 independent verification

- Reviewer rerun: `pnpm exec vitest run test/core/store/workspace-atomic-write.test.ts` — **51/51 passed, 0 skipped** on Windows.
- Reviewer rerun: `pnpm exec tsc --noEmit` — passed.
- Reviewer rerun: focused ESLint for the implementation/test files — passed.
- Reviewer rerun: `rasen validate fix-workspace-claim-portability --strict --json` — passed, 1/1 valid.
- Reviewer rerun: tracked implementation `git diff --check` — passed.
- Reviewer diagnostic: simulated Linux directory-open `EISDIR` against the current matching build — `RESULT_CODE=EISDIR`, confirming R2-F3b.
- Recorded fixer evidence, not re-run by this reviewer: atomic 51/51; Git-verb/Windows-path/identity 41/41; plan 22/22; binding/apply 28/28; locks 11/11; representative cleanup 1/1; TypeScript, ESLint, and strict validation green.
- Recorded cleanup full-file run: approximately 296 seconds, runner exit 1, and no failing test-case output. It remains **inconclusive**, not a test failure and not passing evidence.
- PR #148 still points to pre-child OID `27b2d4c2` and has zero eligible Greptile comments for this uncommitted delta.

### Round 2 explicit disposition

**Do not ship this child yet.** F1, F2, F4, and the original F3 coverage finding are non-author-confirmed resolved. Fix R2-F3b, rerun the atomic file on Windows and POSIX, then perform a narrow non-author delta re-review. No source or test fix was applied by this reviewer.

### Round 2 durable findings

1. The authority reconstruction and destructive backup proof are now sound at the reviewed boundaries.
2. Platform-policy tests must either mock their named platform or honestly skip outside it; a Windows-titled test cannot assert Windows allowlist behavior under Linux.
3. The real alias test is honest: Windows executed the junction path with zero skips; POSIX exercises a symlink and records unsupported hosts as skipped, not passed.

## Round 3 delta-only non-author re-review — 2026-08-10

Pre-Landing Review: **No issues found. CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial.** The review was restricted to the test-only remediation for R2-F3b; no prior implementation boundary was reopened.

### Round 3 scope check

**CLEAN.** The remediation is confined to `test/core/store/workspace-atomic-write.test.ts`: the Windows `open/EISDIR` success case now binds the Windows policy explicitly, and Linux/Darwin writer-level propagation cases cover the denied tuple. No production source, task checkbox, run-state, dependency, CLI surface, skip policy, or unrelated test behavior is part of this delta. Task 4.3 remains correctly unchecked pending real Windows and POSIX CI evidence.

### R2-F3b — [RESOLVED Blocker] Every `open/EISDIR` expectation now binds its intended platform

- The Windows success case creates a getter spy for `process.platform` and returns `win32` before invoking the writer (`test/core/store/workspace-atomic-write.test.ts:718-724`). The injected directory-open `EISDIR` therefore reaches the production lookup with the named Windows tuple even when the test process itself is POSIX; it no longer inherits the host platform accidentally.
- The case is not hidden behind `skipIf`/`runIf`: every host executes the Windows policy assertion. It still proves publication and complete carrier cleanup (`:725-738`).
- The parameterized Linux and Darwin cases also mock `process.platform`, inject `EISDIR` only when the writer opens the canonical directory, and call `atomicWorkspaceWriteText()` rather than the exported classifier (`:741-760`). Their retained-claim and absent-target assertions prove the real writer reached the fail-closed directory-open boundary (`:761-762`).
- Each new local spy is restored in `finally` (`:730-738`, `:757-766`), and the file-level `afterEach` retains `vi.restoreAllMocks()` as a second cleanup boundary (`:147-151`). The full-file rerun passed every later test, providing behavioral evidence that the mocked platform and open implementation do not leak.
- Production reads `process.platform` at the actual directory-open catch (`src/core/store/workspace/dependencies.ts:417-429`), so the getter spy controls the policy branch under test; Linux/Darwin remain absent from the `open` allowlist (`:219-246`) and therefore propagate `EISDIR`.

Disposition: **NON-AUTHOR-CONFIRMED RESOLVED.** R2-F3b's deterministic POSIX gate failure is removed without weakening the product lookup table or disguising a platform case as skipped.

### Round 3 Standards axis

Standards axis: **0 open findings; worst none.** The test names, platform bindings, writer entry point, negative-path state assertions, and mock cleanup agree with the scoped portability contract and `test/AGENTS.md`. This test-only delta introduces no application path, enum consumer, concurrency boundary, dependency, frontend surface, or Fowler smell.

### Round 3 Spec axis

Spec axis: **0 open findings; worst none.** Task 3.1's explicit Windows/POSIX fault matrix is now deterministic on every host. Task 4.3 is still intentionally unchecked because mocked policy coverage and a local Windows run do not replace native POSIX CI verification.

### Round 3 compact coverage diagram

```text
directory-open EISDIR policy
├─ mocked win32  -> writer tolerates -> target published -> carriers empty [★★★ TESTED]
├─ mocked linux  -> writer rejects   -> claim retained  -> target absent   [★★★ TESTED]
└─ mocked darwin -> writer rejects   -> claim retained  -> target absent   [★★★ TESTED]

mock isolation
├─ case-local finally restores open + platform spies                    [CODE VERIFIED]
└─ full atomic file, including following tests                          [53/53 PASSED]
```

### Round 3 independent verification

- Reviewer rerun on native Windows: `pnpm exec vitest run test/core/store/workspace-atomic-write.test.ts -t "tolerates a named directory-open fault on Windows and completes cleanup|propagates directory-open EISDIR"` — **3/3 selected cases passed; 50 unrelated cases skipped by the name filter**.
- Reviewer rerun on native Windows: `pnpm exec vitest run test/core/store/workspace-atomic-write.test.ts` — **53/53 passed, 0 skipped**.
- Fixer-recorded, not re-run by this reviewer: the pre-fix host-platform-dependence regression was red; after the remediation, the same 3/3 selection and atomic 53/53 were green, and TypeScript, focused ESLint, and strict change validation passed.
- The reviewer inspected the production lookup and writer catch, the test's local `finally` blocks, the suite-level `afterEach`, and the unchanged task 4.3 checkbox. No source/test/task/run-state edit was made by this reviewer.

### Round 3 explicit disposition

**CLEAN.** The only Round 2 blocker is resolved and the canonical open count is **0 Blocker, 0 Major, 0 Minor, 0 Trivial**. This closes the code-review loop for the child. It does not mark task 4.3 complete: final delivery still needs the separately required native Windows and POSIX CI evidence.

### Round 3 durable findings

1. Platform-policy tests stay portable when each expected tuple binds `process.platform` explicitly and still executes on every host; skipping is unnecessary here.
2. A classifier assertion alone is weaker than a writer-level fault test: the Linux/Darwin cases prove error propagation plus retained recovery evidence at the actual mutation boundary.
3. Mocked cross-platform policy coverage is deterministic regression evidence, but it is not native-filesystem evidence; task 4.3 must remain open until real Windows and POSIX jobs are recorded.
