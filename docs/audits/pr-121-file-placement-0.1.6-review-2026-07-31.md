# PR #121 file-placement / planning-roots review

- Date: 2026-07-31
- Status: `DONE_WITH_CONCERNS`
- Verdict: `CHANGES_REQUESTED`
- PR: https://github.com/DumoeDss/rasen/pull/121
- Title: `feat(file-placement)!: collapse landing+archive to planning/execution roots; retire placement config`
- Base: `dev/0.1.6` at `ace53693331998ff67050967b63fb710a0f11245`
- Head: `feat/file-placement-collapse-0.1.6` at `04cea87ae5bea9af2d90f526455b6ea513cd57e8`
- Authoritative design: `docs/zh/file-placement-and-planning-roots.md`
- Review worktree: `OpenSpec-code-wt-pr121-review` (detached at the exact PR head)

## Executive summary

PR #121 implements much of the intended planning-root / execution-root split, but it is not safe to merge in its reviewed state. The standard archive workflows bypass the newly implemented archive engine, destructive migration previews do not match execution, the cleaner can delete malformed state that the design requires preserving, and the migration's never-overwrite guarantee is not atomic.

The review found:

- 5 Blockers
- 6 Majors
- 1 Minor

The failures are primarily integration and safety-boundary failures, not a rejection of the root model itself. The recommended course is to keep the design, freeze the merge, and repair the branch in dependency order: shared planning/apply primitives first, one archive execution path second, Store execution-root routing third, then accounting/docs/full verification.

## Scope check

**Scope Check: REQUIREMENTS MISSING**

- Intent: collapse artifact placement into planning, execution, and machine ownership roots; retire placement configuration; add deterministic archive cleanup, accounting, and reverse migration.
- Delivered: most core types and commands exist, but normal workflow entry points do not consistently use them, and several destructive-path invariants are incomplete.
- Scope creep: none identified as a primary concern.
- Missing required behavior: single archive path, conservative malformed/source-tree handling, preview/apply equivalence, atomic no-clobber migration, correctly scoped migration, complete Store execution-root propagation, and complete archive dry-run/accounting.

### Artifact workflow note

The landing child was archived with its task list checked, but
`rasen/changes/archive/2026-07-30-file-placement-collapse-archive/tasks.md`
still has every task unchecked. Do not rewrite that archived history merely to
make it appear complete. Create a new active remediation Change on the PR branch
and make its tasks correspond to the findings and regression gates in this
report.

## Findings

### Blocker 1 — Standard archive workflows bypass the archive engine

**Evidence**

- `src/core/templates/workflows/archive-change.ts:139-153` instructs a direct `mv`.
- `src/core/templates/workflows/bulk-archive-change.ts:124-146` repeats the direct move.
- `src/core/templates/workflows/ship.ts:82-88` performs in-ship archive bookkeeping directly.
- The cleaner, sidecar consumption, accounting, and `archive.json` writer only run in `src/core/archive.ts:689-766`.

**Impact**

The common `/rasen-archive-change`, bulk archive, and in-ship paths can report a successful archive without cleaning ephemera, recording handoff/probe disposition, or producing `archive.json`. A sidecar written before the manual move travels into the archive, and invoking `rasen archive` after the move cannot recover because the active Change no longer exists.

**Required action**

Make one archive engine authoritative. Every workflow entry point must call that engine; templates must not perform their own `mkdir`/`mv` bookkeeping or read machine-root internals directly. Add integration tests that invoke each generated workflow path and assert identical cleaner/accounting outcomes.

### Blocker 2 — Cleaner deletes malformed state and does not abort for source trees

**Evidence**

- `src/core/ephemera-cleaner.ts:72-78,123-171` classifies known state solely by filename.
- Known JSON files are not parsed or schema-checked before deletion.
- Directories are preserved individually, but a source tree without a top-level manifest does not abort the entire cleanup.
- `test/core/ephemera-cleaner.test.ts:30-72` writes invalid placeholder content and expects it to be discarded.

**Reproduced**

- Malformed `auto-run.json`: classified as discarded and deleted.
- `src/main.ts` plus `auto-run.json`: `aborted` remained false and `auto-run.json` was deleted.

**Impact**

This violates the design's fail-safe rule that malformed, future, unknown, nested, and source-tree entries are preserved exactly, and that source-tree misclassification blocks all cleaning.

**Required action**

Validate every known run-state schema before it enters the discard list. Preserve malformed/future variants with a reason. Perform the complete recursive source-tree/manifest classification before applying any deletion; any source-tree signal must abort the whole operation.

### Blocker 3 — Migration preview hides a recursive deletion

**Evidence**

- `src/core/work-migration.ts:697-715` changes `leave` to `discard` only when `options.execute` is true.
- `src/commands/work.ts:218-249` presents the non-execute result for confirmation and then reruns with execute enabled.

**Reproduced**

- Preview: `action=leave`, `status=planned`.
- Execute with the same inputs: `action=discard`, `status=discarded`, source directory removed recursively.

**Impact**

`--discard-absorbed-conclusions` can delete a directory after the confirmation screen explicitly said it would be left alone. This breaks the preview-first safety contract.

**Required action**

Split migration into a pure planning phase and an apply phase. The complete plan, including all deletes, must be independent of `execute`; apply may only enact the already displayed plan. Add a test asserting byte-equivalent preview/execute actions.

### Blocker 4 — Never-overwrite migration is vulnerable to TOCTOU

**Evidence**

- `src/core/work-migration.ts:648-662` checks destination existence and moves later.
- `src/core/work-migration.ts:138-155` uses `rename`, then a `copyFile` fallback without exclusive creation.
- `src/core/work-migration.ts:727-750,820-830` applies the same check-then-move pattern to directories.

**Impact**

Another process or worktree can create the destination after the check. On supported platforms `rename` may replace it, while the fallback copy path can overwrite it directly. This contradicts the design's guarantee that conflicts retain both copies.

**Required action**

Introduce one tested no-clobber move primitive. It must publish exclusively, restrict fallback to expected cross-device errors, verify the destination identity before source removal, and report a conflict rather than replacing any concurrently created target.

### Blocker 5 — `--change` does not scope global migration phases

**Evidence**

- `src/core/work-migration.ts:561-568` applies `changeName` only to Change discovery.
- Probe migration at `src/core/work-migration.ts:683-762` always scans the entire machine home.
- Design-doc migration at `src/core/work-migration.ts:764-803` also runs unconditionally.

**Impact**

`rasen work migrate --change foo --discard-absorbed-conclusions --yes` can move or recursively delete global directories unrelated to `foo`, despite the specification requiring that only the named Change's legacy state be considered.

**Required action**

In scoped mode, skip any global artifact whose ownership cannot be proven to be the named Change. Prefer a separate, explicitly confirmed global migration phase/command for unowned probes and design-docs.

### Major 1 — Archive failure can leave an inconsistent half-archive

**Evidence**

- `src/core/archive.ts:689-718` deletes ephemera before moving the Change.
- The Change moves at `src/core/archive.ts:742-743`.
- Quality capture, accounting, evidence hashes, and `archive.json` are produced only afterward.
- `src/core/templates/workflows/archive-change.ts:164-183` later appends to `ship-log.md`, after evidence was hashed.

**Impact**

A move or accounting failure can leave deleted execution state without a completed archive, or an already moved Change without its required ledger. If the CLI path is adopted, the workflow's later ship-log append immediately invalidates the recorded evidence hash.

**Required action**

Define recoverable transaction boundaries: classify and validate first; stage the archive and finalized evidence; atomically write the ledger; publish the archive; only then finalize ephemera disposal. Ensure no evidence covered by `archive.json` is mutated after hashing.

### Major 2 — Archived run-state is reported discarded but is not deleted

**Evidence**

- `src/core/work-migration.ts:614-619` sets `status = 'discarded'`, increments the counter, and continues without calling `rm`.
- `test/core/work-migration.test.ts:194-210` checks only the report, not the filesystem.

**Reproduced**

The source file remained after execute, and a second scan discovered it again.

**Impact**

The report disagrees with disk state, repeat execution is not idempotent, and legacy readers can continue to see state that the migration claims was removed.

**Required action**

Delete only in apply mode and mark `discarded` only after successful deletion. On failure, report `failed`. Test source disappearance and second-run no-op behavior.

### Major 3 — Store execution-root routing is not propagated end to end

**Evidence**

- `src/core/work-migration.ts:478-493,579-583` supports `storeSelected`.
- `src/commands/work.ts:194-205,218-245` never supplies it.
- `src/core/management-api/sessions.ts:196-205` resolves ephemera from `record.space.root` instead of the recorded `record.execution.root`.

**Impact**

In Store mode, active run-state and probes can be migrated into the planning Store, and the Sessions API can report execution state as absent or read it from the wrong space.

**Required action**

Pass an explicit resolved planning root and execution root through command, migrator, session registry, and management API boundaries. Add Store plus member-worktree integration tests; do not infer execution ownership again downstream.

### Major 4 — Archive dry-run is incomplete

**Evidence**

- `src/core/archive.ts:464-535` calculates `blockingConditions`, but the JSON response omits them.
- Dry-run returns before reading the archive-input sidecar, so no handoff judgment is shown.
- The dry-run classification does not reflect `--keep-ephemera`.

**Impact**

Human and automated callers cannot determine from the preview whether the archive is blocked or what will happen to handoff and ephemera.

**Required action**

Use the same pure archive plan for dry-run and apply. Include blockers, handoff/sidecar status, probe disposition, exact preserved/deleted ephemera paths, `keepEphemera`, and the final target in both human and JSON output.

### Major 5 — Quality capture misses reports in the new `evidence/` location

**Evidence**

- `src/core/archive.ts:801-809` scans only files at the archive root.
- The authoritative placement design puts review, QA, CSO, benchmark, and verification reports under `<changeRoot>/evidence/`.
- Existing tests place quality reports at the old top-level location.

**Impact**

Correctly placed quality reports are hashed in `archive.json` but do not update `.openspec.yaml` quality metadata.

**Required action**

Make quality capture consume the finalized evidence inventory or recursively scan `evidence/` with explicit allowed filenames. Move tests to the canonical location and retain a compatibility test for legacy top-level files only if compatibility is intended.

### Major 6 — Archive sidecar and filesystem errors fail open

**Evidence**

- `src/core/archive-accounting.ts:199-207` catches all read/JSON errors and returns `null`.
- Sidecar contents are cast without runtime schema, containment, or commit validation.
- `src/core/ephemera-cleaner.ts:105-110` and `src/core/work-migration.ts:113-118` treat all directory-read failures as empty directories.

**Impact**

Malformed sidecars can enter an archive while accounting silently says no judgment was made; ACL, I/O, and permission errors can produce a false-success cleanup or migration report.

**Required action**

Ignore only `ENOENT`. Treat malformed JSON, schema mismatch, containment failure, `EACCES`, `EPERM`, and `EIO` as explicit blockers or `unknown` states. Validate probe paths within the resolved execution root and verify commit syntax/existence before recording it.

### Minor 1 — The authoritative design document is stale

**Evidence**

- `docs/zh/file-placement-and-planning-roots.md:21-25` still says child B, the cleaner, and migrator are not implemented.
- The documented `handoffAbsorbed` shape and ephemera path examples differ from the implemented/spec schema.
- The dry-run example omits `--dry-run`.

**Impact**

Future reviewers and implementers can follow contradictory authority.

**Required action**

Update the design only after the implementation contract is settled. Keep one schema example and link the detailed capability specs instead of duplicating drifting shapes.

## Coverage gaps that must become regression tests

```text
ARCHIVE ENTRY POINTS
  [GAP] archive-change skill -> cleaner + archive.json
  [GAP] bulk archive -> same engine and per-change ledger
  [GAP] in-ship archive -> same engine and finalized hash

EPHEMERA CLEANER
  [GAP] malformed known JSON is preserved
  [GAP] future-version known JSON is preserved
  [GAP] nested source tree aborts the entire cleanup
  [GAP] EACCES/EPERM/EIO is not treated as empty

WORK MIGRATION
  [GAP] preview and apply have identical actions
  [GAP] destination created between plan and apply is never overwritten
  [GAP] copy succeeds but source removal fails
  [GAP] archived run-state disappears and the second run is a no-op
  [GAP] --change excludes unrelated global probes/design-docs

ROOT ROUTING
  [GAP] Store planning root + code execution worktree migration
  [GAP] Sessions API reads record.execution.root

ARCHIVE ACCOUNTING
  [GAP] malformed sidecar blocks or reports unknown
  [GAP] evidence/ quality reports are captured
  [GAP] dry-run returns blockers, handoff, probes, and keep-ephemera effects
  [GAP] injected move/hash/write failure leaves a recoverable state
```

## Verification performed

- `pnpm install --frozen-lockfile`: completed; prepare/build passed.
- `pnpm lint`: passed.
- Targeted Vitest suite: 10 files, 247 tests passed.
- Focused filesystem reproductions confirmed malformed deletion, source-tree non-abort, preview/apply divergence, archived run-state non-deletion, missing dry-run fields, and missed `evidence/` quality capture.
- Full `pnpm test`: did not complete within the review window and left Vitest/CLI child processes running; it is not counted as a pass. Processes and the generated untracked test artifact were cleaned up.
- Two external Codex CLI review attempts timed out at five minutes and contributed no findings.
- Three independent review axes cross-confirmed the primary safety and integration findings.
- No implementation files were edited during the review.

## Recommended remediation sequence

1. Freeze merge and create a new active remediation Change on the PR branch; preserve the two archived children as historical inputs.
2. Convert Blockers 2–5 into failing regression tests.
3. Introduce pure archive/migration plan objects and separate apply functions.
4. Implement one no-clobber filesystem move/copy primitive with failure injection tests.
5. Route single, bulk, and in-ship archive through one archive engine.
6. Close archive transaction/accounting ordering, including final evidence hashing.
7. Thread planning/execution roots explicitly through Store migration and Sessions API.
8. Fix archived-state deletion, quality capture, sidecar validation, and fail-open I/O.
9. Update the design/spec examples after behavior and schemas are locked.
10. Run targeted tests, then isolate and fix the full-suite hang.
11. Re-run the complete review cycle against the new PR head; merge only with zero Blockers and no unaccepted Majors.
