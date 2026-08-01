# Review report — file-placement-hardening-migration-safety

- Mode: dispatched, report-only
- Branch: `fix/pr121-file-placement-hardening`
- Authoritative baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`
- Reviewed delta:
  - `src/core/ephemera-cleaner.ts`
  - `src/core/work-migration.ts`
  - `test/core/archive-ephemera.test.ts`
  - `test/core/ephemera-cleaner.test.ts`
  - `test/core/work-migration.test.ts`
- Verdict: **CLEAN (after Round 3)**

## Round 1 - initial review

### Scope check

**REQUIREMENTS MISSING**

- Intent: make cleaner and migration behavior preview-first, fail-closed, scoped, idempotent, and no-clobber while preserving the approved planning/execution/machine-root design.
- Delivered: the delta stays within the child's owned cleaner/migration/test surfaces and introduces the intended plan/apply and exclusive-publication primitives.
- Scope drift: none found.
- Missing or partial requirements: destructive discard actions do not revalidate source identity; Windows manifest recognition is not case-aware; `specs/` can still be scanned as migration input; scoped discovery can be blocked by unrelated changes; aborted cleaner candidates are omitted from the preserved-path projection.

## Findings

### Standards

#### 1. Blocker — destructive migration actions delete the current path occupant without validating the planned identity

- Evidence: `src/core/work-migration.ts:564-565` creates archived run-state discard actions, and `src/core/work-migration.ts:620-623` creates recursive conclusion-directory discard actions. Their preconditions at `src/core/work-migration.ts:593-599` and `src/core/work-migration.ts:651-657` record only source existence/type, not content or filesystem identity. `discardAction` then directly calls `rm(..., { recursive: true })` or `unlink()` at `src/core/work-migration.ts:1027-1033`.
- Failure: after preview/confirmation, another process can replace an archived run-state file or add source/valuable files to a planned conclusion directory. Apply deletes the replacement/new bytes while still reporting the original immutable action as discarded. This is a read-check-delete TOCTOU and can cause silent data loss.
- Test gap: `test/core/work-migration.test.ts:595-621` covers unlink success/failure but not replacement after planning; `test/core/work-migration.test.ts:502-545` checks action serialization/leave behavior but not source drift before a discard.
- Spec/task: `specs/work-migration/spec.md:5-7` requires a complete confirmed plan whose actions and preconditions are consumed unchanged; `tasks.md:17`, `tasks.md:24-28` require immutable planning and truthful outcomes.
- Recommended action: fingerprint planned discard files and directory trees, revalidate type/identity/content immediately before deletion, and return a non-discard conflict/incomplete outcome on drift. Add disk-byte regression tests for same-byte file replacement, changed-byte replacement, and a new directory child appearing after planning.

**Standards count:** 1 finding — 1 Blocker, 0 Major, 0 Minor, 0 Trivial.

### Spec

#### 2. Blocker — Windows case-insensitive manifest identities can evade source-tree abort

- Evidence: `src/core/ephemera-cleaner.ts:287-291` compares manifest names with `SOURCE_MANIFEST_NAMES.has(name)` exactly, while source-directory and extension checks explicitly normalize case. On Windows, `PACKAGE.JSON`, `cargo.toml`, or another casing identifies the same filesystem name class but does not match this set.
- Failure: a Windows ephemera tree containing a differently cased source manifest plus valid `auto-run.json` is classified without a source signal, so the run-state remains deletable instead of aborting the whole clean.
- Test gap: `test/core/ephemera-cleaner.test.ts:180-202` exercises only exact-cased manifest names; no Windows case-identity cleaner case exists.
- Spec/task: `specs/file-placement/spec.md:22` requires every listed source manifest at any depth to abort cleaning and preserve every entry; `specs/file-placement/spec.md:68-72` requires native Windows identity semantics; `tasks.md:4` requires recursive manifest coverage.
- Recommended action: compare manifest names using platform-native case semantics (case-insensitive on Windows, case-sensitive on POSIX), and add explicit win32/POSIX classification tests that assert disk bytes and the abort result.

#### 3. Major — the work scanner descends into `specs/` and can migrate forbidden review material

- Evidence: `src/core/work-migration.ts:272-285` recursively walks every directory without pruning `specs/`. `classifyWorkDirFile` at `src/core/work-migration.ts:246-260` excludes only specific basenames, so a path such as `specs/example/review-report.md` matches `REPORT_PATTERN` and becomes a move action.
- Failure: content under the spec-owned `specs/` subtree can be removed from its legacy location and republished as evidence even though the requirement says the entire subtree is never a candidate.
- Test gap: `test/core/work-migration.test.ts:99-117` checks only a top-level `proposal.md`; it does not place report-shaped content below `specs/` or assert subtree bytes.
- Spec/task: `specs/work-migration/spec.md:56` and the scenario at `specs/work-migration/spec.md:95-98` require `specs/` and other review material never to move; `tasks.md:25` requires complete deterministic routing.
- Recommended action: prune known review-material directories (at minimum `specs/`) before recursion, then add a real-filesystem test that hashes the subtree before/after plan and apply.

#### 4. Major — scoped discovery inspects unrelated changes before applying the ownership filter

- Evidence: `src/core/work-migration.ts:351-366` calls `lstat` for every active and archived change directory and records non-`ENOENT` failures as plan blockers. Only afterward does `src/core/work-migration.ts:369-376` filter to the requested active/archive owner.
- Failure: `--change foo` can become incomplete and refuse all apply actions because unrelated `bar` cannot be statted, even though scoped mode is required to inspect only proven `foo` work and exclude unrelated state.
- Test gap: `test/core/work-migration.test.ts:548-587` proves unrelated bytes remain in the happy path, but it does not inject `EACCES`, `EPERM`, or `EIO` on an unrelated change. The scan-error cases at `test/core/work-migration.test.ts:654-728` are unscoped/relevant scans.
- Spec/task: `specs/work-migration/spec.md:58` and `specs/work-migration/spec.md:100-104` require the whole scoped plan to contain only proven ownership; `design.md:69-75` says only matching active/archive work directories are scanned; `tasks.md:18` and `tasks.md:27` require exact scoped ownership.
- Recommended action: in scoped mode, filter active names and date-prefixed archive names before any per-entry `lstat` or work scan. Add fault-injection tests showing an unreadable unrelated active/archive directory neither enters blockers nor prevents `foo` from applying.

#### 5. Minor — aborted cleaner candidates are not projected as preserved paths

- Evidence: valid whitelist entries are stored only in `candidates` at `src/core/ephemera-cleaner.ts:405-409`. On abort, `discarded` becomes empty, but `preserved` is still derived solely from `preservedEntries` at `src/core/ephemera-cleaner.ts:458-475`, so an otherwise deletable `auto-run.json` is absent from both public disposition arrays.
- Impact: the disk is safely unchanged, but human/JSON archive projections cannot enumerate every path preserved by the abort. The existing test confirms the candidate remains on disk at `test/core/ephemera-cleaner.test.ts:194-201` without checking that it is reported as preserved.
- Spec/task: `design.md:27-33` requires every preserved path and reason in the complete plan; `specs/file-placement/spec.md:22-24` requires abort to preserve every entry and archive output to report preserved files; `tasks.md:4` and `tasks.md:11` require preserved-path reporting.
- Recommended action: expose an effective preserved projection for aborted plans (including all candidates with an explicit abort reason), and assert that both disk bytes and the preserved-path result contain the otherwise deletable state.

**Spec count:** 4 findings — 1 Blocker, 2 Major, 1 Minor, 0 Trivial.

## Coverage diagram

```text
CODE PATH COVERAGE
==================
[+] ephemera cleaner
    ├─ [TESTED] valid/malformed/schema-invalid/future known state
    ├─ [TESTED] exact-case nested manifests, src/main.ts, symlink preservation
    ├─ [GAP]    Windows case-insensitive manifest identity
    ├─ [TESTED] read/lstat EACCES, EPERM, EIO block apply
    ├─ [TESTED] changed/replaced candidate identity refuses unlink
    └─ [GAP]    aborted valid candidates appear in preserved reporting

[+] migration planning/scoping
    ├─ [TESTED] stable action array consumed without mutation
    ├─ [TESTED] scoped happy path excludes bar/global probes/design-docs
    ├─ [GAP]    unrelated active/archive lstat error in scoped mode
    ├─ [TESTED] relevant work/probe/design-doc scan blockers
    └─ [GAP]    report-shaped files nested under specs/ remain untouched

[+] migration apply
    ├─ [TESTED] archived unlink success, failure, and second-plan no-op
    ├─ [GAP]    discard file/directory source drift after planning
    ├─ [TESTED] file EEXIST race, EXDEV-only fallback, copy/verify/unlink failures
    ├─ [TESTED] directory destination/child races and source-removal failure
    └─ [TESTED] conflict/failure outcomes preserve asserted disk bytes

[+] compatibility
    ├─ [TESTED] existing runWorkMigration report projection remains callable
    └─ [OPEN]   interactive caller still must carry the displayed plan into apply
```

## Test evidence assessment

- Focused cleaner/migration evidence: **74/74 passed**. This is strong evidence for the covered schema, race, fallback, blocker, path-helper, and disk-byte cases, but it does not cover the gaps above.
- Affected archive/work integration evidence: **20/20 passed**.
- `pnpm lint`, `pnpm build`, and change validation were recorded as passing.
- Repository-wide `pnpm test`: **not a pass**. It hung for about 430 seconds and produced no Vitest summary. The hang remains an open verification concern; full regression confidence is unavailable.
- Cross-platform execution: only the local Windows run is evidenced. `path.win32`/`path.posix` helper tests do not substitute for actual macOS/Linux filesystem execution; the parent closure gate must run the matrix.
- Reviewer validation: `git diff --check 04cea87ae5bea9af2d90f526455b6ea513cd57e8 -- <five reviewed files>` completed with no whitespace errors; Git emitted only line-ending conversion warnings.
- No tests were added, changed, or run by this report-only reviewer. No external Codex pass was invoked.

## Durable findings for downstream owners

1. `src/commands/work.ts:218-245` still previews through one `runWorkMigration` call and applies through a second call, which replans. The root-routing/closure owner must carry the exact displayed `WorkMigrationPlan` into `applyWorkMigration`; otherwise filesystem changes between confirmation and apply can introduce undisclosed actions.
2. Archive-engine work must surface cleaner `sourceSignals`, `blockers`, completeness, and the effective preserved-path set, and must never apply an aborted/incomplete cleaner plan.
3. The full-suite hang and real macOS/Linux filesystem matrix remain mandatory open verification gates, not passes.

## Round 2 - delta re-review

- Reviewer: `/root/migration_safety_reviewer`
- Fixer: `/root/migration_safety_fixer_r1`
- Independence: confirmed; the Round 2 reviewer is not the fixer and made no implementation or test changes.
- Delta scope: only the five Round 1 findings and their narrow regression surfaces.
- Round 2 verdict: **FINDINGS**

### Confirmed resolutions

1. **Round 1 finding 1 (Blocker) - resolved.** Destructive file and directory actions now include a JSON-serializable `sourceFingerprint`. Apply fails closed when the fingerprint is absent, recomputes it before deletion, returns `already-absent` on `ENOENT`, returns `failed` on inspection errors, and returns `conflict`/`ESTALE` on identity, byte, type, symlink-target, special-entry, or directory-tree drift. Directory traversal uses `lstat` and does not follow symlinks. The action array is not mutated during apply. The remaining gap between successful revalidation and the final unlink/rm syscall is the irreducible filesystem race and is not represented as fully eliminated.
2. **Round 1 finding 3 (Major) - resolved.** `scanWorkDirForPlan` now prunes the platform-equivalent `specs` directory before child `lstat` and recursion. The supplied regression hashes and re-reads report-shaped files below `specs/`.
3. **Round 1 finding 5 (Minor) - resolved.** When cleaning aborts, every otherwise deletable candidate is added to `preservedEntries` with reason `cleaning-aborted` and appears in the deduplicated `preserved` projection while `discarded` remains empty.
4. **Round 1 finding 4 (Major) - partially resolved.** Active/archive ownership names are now filtered before per-entry `lstat`, and the supplied `EACCES`/`EPERM`/`EIO` regressions cover unrelated active and archived directories. The default Windows identity defect below still prevents correct case-insensitive scoped ownership selection.

### Remaining findings

#### 1. Blocker - the production Windows cleaner still uses POSIX-style case-sensitive manifest identity

- Evidence: `src/core/ephemera-cleaner.ts:287-293` decides whether to case-fold with `pathApi === path.win32`. Default classification receives the ESM namespace object through `pathApi = path` at `src/core/ephemera-cleaner.ts:315-319`, and `cleanEphemera` also passes that namespace at `src/core/ephemera-cleaner.ts:595-600`. In this Windows runtime, `import * as path from 'node:path'` is neither identical to `path.win32` nor `path.posix`; only `path.default` is identical to `path.win32`. Therefore the default production path does not fold case.
- Failure: ordinary Windows cleanup still misses `PACKAGE.JSON` and other differently cased listed manifests. A valid `auto-run.json` in the same ephemera tree remains eligible for deletion instead of the source signal aborting the entire clean.
- Test evidence: `test/core/ephemera-cleaner.test.ts:210-226` passes `path.win32` and `path.posix` explicitly, so it proves the injected seam but not the default production call. No regression invokes default `cleanEphemera`/`classifyEphemera` on Windows with an uppercase manifest.
- Recommended action: derive path flavor from an explicit semantic value (for example `process.platform`, a `'win32' | 'posix'` parameter, or a helper that does not compare the ESM namespace by identity), and add a default-call Windows regression.

#### 2. Major - default Windows scoped ownership matching has the same namespace-identity defect

- Evidence: `src/core/work-migration.ts:582-603` uses `pathApi === path.win32` in both `archiveNameMatches` and `pathsEqualForPlatform`. Production discovery passes the ESM namespace `path` at `src/core/work-migration.ts:626-650`. Consequently Windows active and archive names are compared case-sensitively in real scoped discovery.
- Failure: a valid scoped request such as `--change foo` can return no owner for an on-disk `Foo` active change or `2026-07-31-Foo` archive, even though those names identify the same Windows filesystem object. The new filter-before-`lstat` ordering is safe, but it filters out the requested owner.
- Test evidence: `test/core/work-migration.test.ts:1195-1223` tests helpers only with explicit `path.win32`/`path.posix`; the scoped discovery regressions use exact-case names and therefore do not exercise the default Windows call.
- Recommended action: use the same explicit path-flavor correction as the cleaner, then exercise `discoverChangeDirs`/`planWorkMigration` through their default Windows path with casing that differs from the request.

### Narrow regression assessment

- Fingerprint serialization/backward compatibility: the new fingerprint is ordinary JSON data. A legacy/deserialized destructive action with no fingerprint is rejected without deletion.
- Plan immutability: apply reads the planned fingerprint/actions and the supplied serialization assertion checks that it does not rewrite them.
- Symlinks and special files: fingerprint traversal uses `lstat`, hashes symlink identity and target without following it, and includes special-entry identity. Drift produces a non-discard outcome.
- Performance/recursion: directory fingerprinting is intentionally proportional to the full explicitly discarded tree and is repeated at apply. It is sequential and symlink-bounded; no additional release-blocking issue was established in this narrow delta review.
- Failure sequencing: a destructive action whose fingerprint is absent or cannot be inspected cannot delete that action's source. Per-action processing continues to later independently valid actions, consistent with the existing truthful outcome model.

### Test evidence supplied by the fixer

- Focused cleaner/migration tests: **86/86 passed**.
- Affected integration tests: **20/20 passed**.
- `pnpm lint`, `pnpm build`, and change validation: reported passing.
- Repository-wide suite: not rerun; the prior no-summary hang remains open.
- Native macOS/Linux filesystem execution: not supplied.
- The Round 2 reviewer did not run tests.

## Round 2 verdict

**FINDINGS** - 2 remaining: 1 Blocker, 1 Major. Round 1 findings 1, 3, and 5 are confirmed resolved; finding 4's filter-before-inspection requirement is resolved but its default Windows identity behavior remains incorrect; finding 2 remains unresolved in the production default.

## Round 1 verdict record

**FINDINGS** — 5 total: 2 Blocker, 2 Major, 1 Minor.

## Round 3 - final delta re-review

- Reviewer: `/root/migration_safety_reviewer`
- Fixer: `/root/migration_safety_fixer_r2`
- Independence: confirmed; the Round 3 reviewer is not the fixer and made no implementation or test changes.
- Delta scope: only the two Round 2 findings and the narrow shared path-identity helper surface.
- Round 3 verdict: **CLEAN**

### Confirmed resolutions

1. **Round 2 Blocker - resolved.** `src/core/path-identity.ts:7-23` represents path identity with the explicit semantic flavor `'win32' | 'posix'`; the native default derives directly from `process.platform`. `src/core/ephemera-cleaner.ts:292-323` uses that flavor for manifest equality, and `cleanEphemera` carries the production native default at `src/core/ephemera-cleaner.ts:592-605`. Default Windows cleanup therefore case-folds differently cased listed manifests and aborts before deletion.
2. **Round 2 Major - resolved.** `src/core/work-migration.ts:588-610` uses the same explicit flavor for active/archive identity. Discovery resolves the native flavor before iterating and applies owner matching before per-entry `lstat` at `src/core/work-migration.ts:627-660`. `planWorkMigration` and `runWorkMigration` carry the optional semantic override without replacing the native production default.

### Narrow helper regression review

- **Explicit POSIX behavior:** retained. The `'posix'` flavor performs exact case-sensitive identity comparisons. The scoped regression proves differently cased owners are filtered before owner `lstat`.
- **Production Windows default:** covered through the actual default entry points, not only helper injection. The cleaner regression calls `cleanEphemera(ephemeraDir)` with `PACKAGE.JSON`; the migration regression calls default `planWorkMigration` with on-disk `Foo` and `2026-07-31-Foo` for requested `foo`.
- **Inference boundary:** no `node:path` namespace identity, separator, or delimiter is used to select case semantics. `path.win32`/`path.posix` is selected only after the explicit semantic flavor is known, for normalization in `pathsEqualForPlatform`.
- **Consumers/scope:** repository references show the new helper is consumed only by the cleaner and work-migration identity surfaces. Cleaner archive callers use the corrected native default; work-command callers reach it through `runWorkMigration`. No unhandled old path-object call sites or unrelated feature changes were found.

### Test evidence supplied by the fixer

- Focused cleaner/migration tests: **88/88 passed**.
- Affected archive/work integration tests: **20/20 passed**.
- `pnpm lint`: reported passing.
- `pnpm build`: reported passing.
- Change validation: reported passing.
- `git diff --check`: reported passing with line-ending warnings only.
- Repository-wide suite: not rerun; the known no-summary hang remains a downstream closure concern.
- The Round 3 reviewer did not run tests.

## Final verdict

**CLEAN** - no open Blocker, Major, Minor, or Trivial findings remain in the five-finding review cycle or the Round 3 helper regression surface.
