# Pre-Landing Review: fix-archive-recovery-ownership

**Current verdict: CLEAN — Round 2 has 0 unresolved issues (0 Blocker, 0 Major, 0 Minor, 0 Trivial).**

**Historical Round 1 verdict:** FAIL — 4 unresolved issues (2 Blocker, 2 Major, 0 Minor, 0 Trivial). All four are retained below as review history and independently confirmed closed in Round 2.

## Round 1 — historical independent review

Mode: dispatched, report-only. No fixes or tests were run by this reviewer. Review scope was limited to `src/core/archive-engine.ts`, `test/core/archive-engine.test.ts`, `test/core/archive-fault-matrix.test.ts`, and this child change's proposal/design/specs/tasks. Concurrent registry/workspace/validator work and the pre-existing committed branch delta were excluded.

### Scope check

- **Intent:** make archive cleaner recovery lossless on Windows, close the publication-to-progress abort window, and apply one safe path-identity policy to destructive stored abort.
- **Delivered:** plan-bound cleaner authority, apply-time source/claim checks, explicit abort flavor threading, and focused recovery tests.
- **Disposition:** requirements remain partial because legacy delete replay can bypass authority, the full recorded identity is not compared, and two abort path-policy invariants are incomplete.

### Standards axis

#### F1 — [Blocker] Legacy delete plans can bypass the required fail-closed authority gate

`src/core/archive-engine.ts:11970` skips cleaner authorization outright for progress already recorded as `deleted`/`deleted-after-intent`; `src/core/archive-engine.ts:11983` and `src/core/archive-engine.ts:11988` also accept an absent candidate as `already-absent`/`deleted-after-intent`. `requireArchiveCleanerDeletionAuthority()` is reached only for a still-present candidate at `src/core/archive-engine.ts:12003`. Therefore a stored plan with non-empty `effectiveDelete` and no `deletionAuthority` can continue when the candidate disappeared or old journal progress already says it was deleted. That contradicts the requested unconditional fail-closed treatment of legacy delete plans and permits unproved deletion accounting to advance.

Recommended fix: validate complete exact cleaner authority once, before interpreting any cleaner progress or filesystem absence, whenever `effectiveDelete.length > 0`; retain no-delete legacy compatibility. Add regressions for a missing candidate and pre-existing `deleted`/`deleted-after-intent` progress on a legacy plan.

#### F2 — [Blocker] The recorded exact stat authority is not enforced exactly at source or private claim

`ArchiveCleanerDeletionAuthority.identity` records `dev`, `ino`, `mode`, `size`, `mtimeNs`, and `ctimeNs`, but `sameArchiveObject()` compares only the first four fields at `src/core/archive-engine.ts:9016`. Cleaner source and private-claim authorization both call that weaker predicate at `src/core/archive-engine.ts:10008` and `src/core/archive-engine.ts:10028`. A metadata-only identity change—or inode reuse with the same mode/size/content—can therefore pass despite no longer matching the plan's exact authority. The digest check does not restore the omitted timestamp identity contract.

Recommended fix: enforce the complete plan-time identity at the source and claimed-object boundaries, or explicitly redesign and specify a separate rename-stable identity if Windows proves that a move mutates a timestamp. Add a same-bytes, changed-`mtimeNs`/`ctimeNs` regression that must retain the candidate.

#### F3 — [Major] Resumed abort cleanup still consumes tombstone-supplied paths as destructive operands

`readArchiveAbortTombstone()` validates `stageClaim` aliases but returns the parsed carrier unchanged at `src/core/archive-engine.ts:4593`. Abort then copies that carrier into the new intent at `src/core/archive-engine.ts:5526`, uses its `root`/`claimed` paths for filesystem state and rename/remove work beginning at `src/core/archive-engine.ts:5588`, and passes the carrier-derived `claimed` path to guarded deletion at `src/core/archive-engine.ts:5727`. Lexical identity validation limits the immediate blast radius, but the design explicitly requires carrier text to be evidence only and every cleanup operand to be reconstructed from the immutable plan and transaction id.

Recommended fix: after validating a stored claim, reconstruct canonical `root`, `claimed`, and `sentinel` paths from `plan.paths.stage`, `plan.transactionId`, and the operation label; carry over only the verified nonce and identities. Add a torn-abort replay test with equivalent aliased claim fields and assert every mutating adapter call receives the reconstructed plan-derived path.

#### F4 — [Major] Windows case-insensitive path identity is not complete at the parsing/association boundary

The new dispatch threads `win32`, but journal parsing still rejects an equivalent case-only stage spelling with a strict basename comparison at `src/core/archive-engine.ts:3940`, abort-tombstone parsing repeats the strict comparison at `src/core/archive-engine.ts:4583`, and association carrier validation uses strict `path.basename()` equality at `src/core/archive-engine.ts:6470`. The native Windows tests alter drive case, one separator, and a dot segment only in top-level journal fields (`test/core/archive-engine.test.ts:3278`); they do not exercise case-only stage/tombstone/carrier aliases. As a result, one policy is not actually applied to every abort ownership binding, and a valid recovery can fail with an ownership blocker instead of the required phase-safe disposition.

Recommended fix: thread the selected flavor through journal parsing and use flavor-aware basename/path comparisons for stage and association carriers. Add actual-dispatch Windows cases for case-only stage/tombstone bindings and association/source-progress carriers, plus their sibling/traversal negatives.

**Standards count:** 4 issues; worst severity Blocker.

### Spec axis

| Requirement | Disposition | Evidence |
|---|---|---|
| Lossless handle-bound bigint `dev`/`ino` decimal strings | Partial | Capture uses stable opened-file reads and decimal strings (`src/core/archive-engine.ts:2695`, `src/core/archive-engine.ts:992`), and hashing includes the new cleaner field, but the full identity is not enforced (F2). |
| Cleaner authority is in plan hashing and validation | Pass with downstream blocker | `hashArchivePlan()` hashes the complete plan (`src/core/archive-engine.ts:1068`); stored-plan validation calls `isArchiveCleanerDeletionAuthorityValid()` (`src/core/archive-engine.ts:3396`). All plan loading flows centralize on `loadStoredArchivePlan`; Store finalization also hashes the archive decision into `finalizationPlanId`. |
| Capture races and replacement refusal | Partial | Classification/content disagreement blocks planning and changed bytes are retained, but metadata-only exact-identity changes remain accepted (F2). Stable reads are handle-bound and reject symlink/final-path swaps. |
| Legacy delete fails closed; legacy no-delete replays | Fail | Present-candidate and no-delete tests pass, but absence/prior-progress paths bypass the authority requirement (F1). |
| Canonical publication before progress flush refuses abort; exact token retries | Pass | The create/update crash test throws immediately after hard-link publication, preserves canonical/source/stage/journal/token bytes, refuses abort with `archive_abort_phase_unsafe`, and completes using the exact stored token (`test/core/archive-engine.test.ts:2020`). |
| One explicit path flavor through actual abort dispatch | Partial | Main comparisons receive `abortPathIdentityFlavor`, but strict parser/carrier basename checks remain (F4). |
| Equivalent Windows aliases accepted; sibling/traversal refused | Partial | Actual native dispatch covers drive-letter case, mixed separators, dot segments, sibling and traversal (`test/core/archive-engine.test.ts:3254`), but not case-only stage/tombstone/carrier aliases (F4). |
| Destructive operands are immutable-plan-derived | Fail | Resumed `stageClaim` cleanup operates on validated but carrier-supplied path text (F3). |
| Windows late fault family reaches accounting/source removal | Pass for recorded cases | Fault-matrix assertions require cleaner progress/disappearance and the source-removal test proves `EACCES` is reported at `source-remove`, then exact-token retry completes (`test/core/archive-fault-matrix.test.ts:2079`). |

**Spec count:** 4 requirements partial/failing due F1–F4; worst severity Blocker.

### Coverage diagram

```text
CODE PATH COVERAGE
==================
[+] cleaner authority capture
    ├── [★★★ TESTED] bigint dev/ino beyond Number.MAX_SAFE_INTEGER
    └── [★★★ TESTED] classification-to-capture content race blocks planning
[+] cleaner apply/replay
    ├── [★★★ TESTED] unchanged present candidate deletes and late phases remain reachable
    ├── [★★★ TESTED] changed bytes/replacement refuses and retains
    ├── [★★★ TESTED] legacy present delete refuses; legacy no-delete completes
    ├── [GAP]         legacy delete with absent/prior-completed progress — F1
    └── [GAP]         same bytes with changed exact timestamps — F2
[+] stored abort
    ├── [★★★ TESTED] canonical publication before progress flush refuses; exact-token retry completes
    ├── [★★★ TESTED] native Windows journal aliases and sibling/traversal negatives
    ├── [GAP]         torn-abort claim aliases use only reconstructed operands — F3
    └── [GAP]         case-only tombstone/stage/association/source carrier dispatch — F4

USER FLOW COVERAGE
==================
[+] new-plan apply → cleaner → accounting/source removal → retry     [★★★ TESTED]
[+] publication crash → refused abort → exact-token replay           [★★★ TESTED]
[+] legacy no-delete replay                                          [★★★ TESTED]
[!] legacy delete replay with absent/already-recorded candidate       [GAP] F1
[!] native Windows torn-abort replay from aliased tombstone claim     [GAP] F3/F4

Coverage: 11/15 enumerated paths/flows tested; 4 security/recovery gaps.
Quality: ★★★ 11, GAP 4. E2E/eval: no eval applies; native filesystem integration is the correct level.
```

### Recorded verification evidence

The dispatch supplied the following green evidence; this reviewer did not rerun it:

- Focused archive suites: **148 passed, 9 skipped**.
- Native Windows placement: **170 passed, 9 skipped**.
- Targeted checks: **2 passed + 4 passed**.
- Build, ESLint, and strict change validation: **green**.

These gates support the tested paths above but do not exercise F1–F4.

### Explicit disposition

- **Do not ship.** Route F1–F4 to a non-author fixer; no auto-fix was applied in this report-only review.
- Re-review the child delta after adding the four missing regressions and preserving the recorded Windows/source-removal evidence.

---

## Round 2 — fresh non-author delta re-review (2026-08-10)

Mode: dispatched, report-only. This reviewer did not author the original implementation or the design-level fixes, did not modify product code/tests/tasks, and did not commit or push. Review scope remained limited to `src/core/archive-engine.ts`, `test/core/archive-engine.test.ts`, `test/core/archive-fault-matrix.test.ts`, and this child change's artifacts; registry, spec-reconciliation, workspace, and Store-finalization deltas were excluded.

### Verdict and canonical counts

**CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial.**

Pre-Landing Review: No issues found.

### Scope check

- **Intent:** close CCR-2/CCR-3, make cleaner deletion authority lossless and replay-safe on Windows, and retain legacy/unproved state fail-closed.
- **Delivered:** complete pre-progress cleaner-authority admission, six-field exact source/private-claim enforcement with a bounded rename transition, canonical plan-derived abort operands, native-flavor parsing/comparison across abort carriers, and focused Windows/retry regressions.
- **Disposition:** CLEAN; no scope drift or missing archive-child requirement found.

### Round 1 finding closure

| Finding | Round 2 disposition | Independent evidence |
|---|---|---|
| F1 — legacy delete authority bypass | **Closed** | `requireCompleteArchiveCleanerDeletionAuthority()` is invoked at `src/core/archive-engine.ts:12216` before the cleaner loop interprets completed progress or filesystem absence. Missing candidates and prior `deleted`/`deleted-after-intent` legacy progress remain retained by `test/core/archive-engine.test.ts:1430,1471`; no-delete legacy replay remains covered. |
| F2 — incomplete six-field identity enforcement | **Closed** | Exact source checks use all six fields through `sameExactArchiveObject()` (`src/core/archive-engine.ts:9139,10205`); the verified rename transition preserves `dev/ino/mode/size/mtimeNs`, then freezes and exactly revalidates the complete post-rename claim identity (`src/core/archive-engine.ts:9156,10249`). Same-byte timestamp drift and post-rename claim drift are refused by `test/core/archive-engine.test.ts:1249,1326`. |
| F3 — tombstone-supplied destructive operands | **Closed** | Stored claim text is validated as evidence, then `reconstructArchiveAbortClaimFromPlan()` rebuilds `root`/`claimed`/`sentinel` from the immutable plan (`src/core/archive-engine.ts:4547,4999`). The torn-abort regression records every `rename`/`unlink`/`rmdir` operand and requires canonical plan-derived text (`test/core/archive-engine.test.ts:4116`). |
| F4 — incomplete Win32 flavor coverage | **Closed** | One native flavor is selected at abort dispatch (`src/core/archive-engine.ts:4846`) and reaches journal parsing, tombstone parsing, journal correspondence, association basename/dirname interpretation, progress targets, and source quarantine (`src/core/archive-engine.ts:3937,6502`). Native Windows actual-dispatch coverage includes stage case, drive/separator/dot aliases, source progress, association carriers, and sibling/traversal refusal (`test/core/archive-engine.test.ts:3588,3839,3911`). |

### Fixer follow-up checks

| Check | Disposition | Independent evidence |
|---|---|---|
| Deterministic mixed-case planning order | **Pass** | Candidate projection and `effectiveDelete` share the same code-unit comparator (`src/core/archive-engine.ts:1267,1303,1308`); `Z.log`/`a.log` persists successfully in planner order (`test/core/archive-engine.test.ts:150`). |
| failure → restore → retry unlink → error → third retry | **Pass** | A restored identity is exact retry authority; after the next verified claim, the stale restored identity is durably cleared before deletion (`src/core/archive-engine.ts:10300`), restored again only if the claim survives, and absence without stale restored authority promotes the durable delete intent. The three-attempt regression is `test/core/archive-fault-matrix.test.ts:1934`. |
| Canonical decimal identity fields | **Pass** | `dev/ino/mode/size` accept only canonical unsigned decimal while `mtimeNs/ctimeNs` accept canonical signed decimal (`src/core/archive-engine.ts:3678`); the validator is applied to plan authority and restored journal identity (`src/core/archive-engine.ts:3750,4234`). Negative timestamp acceptance and negative non-time rejection are covered at `test/core/archive-engine.test.ts:1132`. |

### Standards axis

No correctness, data-safety, race, conditional-side-effect, consistency, type-boundary, or material completeness finding remained after reading the complete archive delta and the related plan/journal/claim callers. The destructive transitions remain no-replace or identity-bound, and every accepted carrier alias is evidence only.

**Standards count:** 0 Blocker, 0 Major, 0 Minor, 0 Trivial.

### Spec axis

All child proposal/design/spec requirements are implemented: publication-before-progress makes abort unsafe but exact replayable; native Windows identity is applied through actual abort dispatch; new cleaner deletes carry complete handle-bound authority; legacy deletes without it fail closed; same-byte metadata drift is retained; failed-claim restoration persists complete retry identity; unchanged large NTFS identifiers reach late phases/source removal.

**Spec count:** 0 missing, partial, or incorrect requirements.

### Coverage diagram

```text
CODE PATH / RECOVERY FLOW COVERAGE
==================================
[★★★ TESTED] canonical publication → crash before progress → refused abort → exact-token replay
[★★★ TESTED] legacy delete absent/prior-progress → authority refusal before progress interpretation
[★★★ TESTED] exact source identity → verified rename transition → exact private-claim identity
[★★★ TESTED] metadata-only source/claim replacement → retained manual recovery
[★★★ TESTED] failure → restored identity → second claim/delete/error → third retry completion
[★★★ TESTED] native Win32 journal/tombstone/source/association aliases and outside-path refusal
[★★★ TESTED] mixed Z.log/a.log planner order and canonical signed/unsigned decimal parsing

Coverage: 7/7 reviewed recovery boundaries exercised; no uncovered destructive branch found.
```

### Reviewer-rerun evidence

- `pnpm exec vitest run test/core/archive-engine.test.ts -t "mixed-case cleaner authority|unchanged cleaner candidate with exact stat identity|signed exact timestamps|cleaner content changes before exact authority|changed cleaner candidate|same-byte cleaner candidate|inode-reuse-style|same-byte private claim|legacy delete plan|legacy no-delete|crash between hard-link publication|native Windows stored-abort path identity|torn guarded abort" --reporter=dot` → **28 passed, 65 skipped** on native Windows.
- `pnpm exec vitest run test/core/archive-fault-matrix.test.ts -t "promotes a restored cleaner retry|active-source removal failure|cleaner partial failure|recovers a cleaner deletion" --reporter=dot` → **4 passed, 52 skipped**.
- Focused ESLint over the archive implementation and two test files → **pass**.
- `pnpm run build` → **pass** (TypeScript 5.9.3).
- `rasen validate fix-archive-recovery-ownership --strict` → **valid**.
- `git diff --check` over the archive child plus strict UTF-8 decoding of implementation/tests/artifacts → **pass**.

### Recorded evidence not rerun by this reviewer

- Original implementation record: focused archive suites **148 passed, 9 skipped**; Windows placement **170 passed, 9 skipped**.
- Design-level fixer record: original/new boundary selection **27 passed, 66 skipped**; cleaner recovery **3 passed, 53 skipped**; combined crash selection **1 passed, 55 skipped**; build, ESLint, UTF-8, and diff checks green.

These recorded results supplement but do not substitute for the reviewer-rerun evidence above.

### Final disposition

**CLEAN.** Round 1 F1–F4 and the fixer's three follow-up invariants are independently closed. No Blocker, Major, Minor, or Trivial finding remains in this child scope. Post-commit portfolio CI remains a delivery gate, not an unresolved code-review finding.
