## 1. Lock the complete archive plan with failing tests

- [x] 1.1 Add `ArchivePlan` serialization tests covering resolved planning/execution roots, active/stage/final paths, target/source preconditions, prepared spec actions, validation/task/timing decisions, transaction identity, and stable action ordering.
- [x] 1.2 Add human/JSON dry-run tests proving both projections contain identical archive blockers, sidecar status, handoff/probe decisions, cleaner `sourceSignals`/`blockers`/`complete`, effective delete/preserve paths, quality inputs, final target, and recovery identity.
- [x] 1.3 Add dry-run/apply equivalence tests proving apply consumes the exact serialized plan and that source drift or a target created after preview changes only runtime outcomes.
- [x] 1.4 Add byte/tree-hash tests proving `--dry-run` creates no spec write, stage, journal, archive, sidecar mutation, handoff mutation, ephemera deletion, quality metadata, or accounting file.
- [x] 1.5 Add `--keep-ephemera` tests proving discovery still runs, every candidate and preserved entry appears in the effective preserve set, the delete set is empty, and non-`ENOENT` inspection failure remains blocking.

## 2. Extract one archive plan/apply engine

- [x] 2.1 Introduce versioned `ArchivePlan`, archive blocker, sidecar projection, effective disposition, action, journal phase, and `ArchiveApplyResult` types plus narrow injectable filesystem/Git/hash/time/cleaner adapters.
- [x] 2.2 Extract a mutation-free planner from `src/core/archive.ts` that prepares validation, spec sync, task/timing gates, target selection, source fingerprint, sidecar validation, cleaner classification, quality/evidence inputs, and all blockers before apply.
- [x] 2.3 Make `ArchiveCommand.execute` a thin plan/confirm/apply compatibility adapter whose human and JSON output are derived from the shared types, including non-zero blocked outcomes.
- [x] 2.4 Preserve the foundation cleaner interface by carrying its candidate fingerprints, `sourceSignals`, typed `blockers`, `complete`, and effective preserved paths unchanged into the archive plan; never reclassify cleaner actions during apply.
- [x] 2.5 Refuse archive apply when the archive plan is incomplete or the cleaner has typed inspection blockers; for a complete source-signal-aborted cleaner plan, skip cleaner apply and record the complete effective preserve disposition.

## 3. Validate sidecar, Git facts, and evidence fail closed

- [x] 3.1 Replace permissive `.rasen-archive-input.json` parsing with a versioned runtime schema that validates change binding, complete/unique handoff decisions, exact outcome enums, and rejects unknown/future schema versions.
- [x] 3.2 Validate every handoff path as a current regular-file inventory member contained under `handoff/`; make absent sidecar (`ENOENT` only) select `unjudged-preserve-all`, while malformed, unreadable, incomplete, absolute, duplicate, or escaping entries block.
- [x] 3.3 Validate probe paths lexically and by resolved identity under the execution root without following an escaping symlink; require directory existence plus a full hexadecimal commit that resolves as a commit object in the execution repository.
- [x] 3.4 Replace catch-all accounting Git probes with confirmed-Git/confirmed-non-Git/error results so only confirmed non-Git roots produce the defined null/clean values and missing/corrupt/permission/I/O failures block.
- [x] 3.5 Make recursive evidence inventory and hashing treat only `ENOENT` directory absence as empty; report `EACCES`, `EPERM`, `EIO`, containment, symlink, read, and drift errors with exact operations and paths.
- [x] 3.6 Write `archive.json` with same-directory atomic replacement, verify its parsed schema and evidence hashes, and retain recoverable journal state on write or verification failure.

## 4. Implement verified staging, journaling, and source-last cleanup

- [x] 4.1 Create an exclusive stage under the final archive parent and an atomic journal bound to the plan hash and transaction id; implement discovery/resume for only matching stages or published incomplete transactions.
- [x] 4.2 Copy active change payload entries exclusively into the stage, excluding engine control files, and verify the staged tree against the planned fingerprint without removing or mutating the active source.
- [x] 4.3 Apply handoff `absorbed`/`preserved` intent only inside the stage, moving preserved documents to staged `evidence/handoff/` and verifying the active handoff remains byte-identical until completion.
- [x] 4.4 Publish the verified stage exclusively to the final date-prefixed target; remove the archive `EPERM` fallback, treat final-parent `EXDEV` as an invariant failure, and ensure any retained compatibility fallback accepts only explicit `EXDEV`, verifies fully, and removes source last.
- [x] 4.5 Apply applicable cleaner candidates with per-candidate journal progress derived from the complete foundation plan, persist actual disposed paths, and make partial cleaner failure resumable without falsely recording untouched candidates.
- [x] 4.6 Atomically finalize actual `archive.json` outcomes after cleaner progress, then revalidate and remove the active change source last; mark complete only after source removal and retain a recovery journal if that removal fails.
- [x] 4.7 Add collision/resume rules proving an unrelated final target is never overwritten and a matching interrupted transaction resumes idempotently while mismatched journals report both paths for manual recovery.

## 5. Finalize evidence and recursive quality before hashing

- [x] 5.1 Move archive ship-log finalization into the staged engine flow: preserve the ship-side bytes, add timestamp/outcome/path/transaction id and recorded ship commit, and create a minimal archive-only log without invented ship facts when absent.
- [x] 5.2 Remove the post-accounting `Archive commit` append contract; keep archive-to-ship traceability in path-scoped commit-message guidance using the recorded ship short SHA and verify no successful consumer mutates evidence afterward.
- [x] 5.3 Refactor quality capture to recursively scan the staged canonical `evidence/` tree in deterministic relative-path order, distinguish duplicate basenames by path, and treat unreadable candidates as blockers.
- [x] 5.4 Write `.openspec.yaml` quality metadata before evidence inventory, then recursively hash the finalized evidence tree and prove re-hashing after successful completion reproduces every `archive.json` digest.
- [x] 5.5 Move quality fixtures to canonical `evidence/` locations, add nested review/QA/CSO/benchmark/verification reports, and retain only explicitly required legacy top-level compatibility cases.

## 6. Route every generated archive consumer through the engine

- [x] 6.1 Update `src/core/templates/workflows/archive-change.ts` so the skill writes validated handoff/probe intent, inspects the engine plan, invokes `rasen archive`, and contains no direct archive `mkdir`/`mv`, active handoff deletion/move, `archive.json` write, or later ship-log append.
- [x] 6.2 Update `bulk-archive-change.ts` to call the same engine once per confirmed change in resolved spec-conflict order, use per-change JSON plan/results for partial success, and contain no direct-move fallback.
- [x] 6.3 Reorder `ship.ts` under `in-ship` timing so code delivery, PR URL, optional deployment decision, and ship-side evidence are final while the change is active, then invoke the archive engine and guide the archive commit/non-force follow-up push where required.
- [x] 6.4 Preserve `on-merge` ship behavior and merge-confirmation gates while changing only the bookkeeping consumer; ensure `push`/`local` guidance invokes the same authoritative archive flow.
- [x] 6.5 Add generated-template golden assertions using explicit required/forbidden command constants: every single/bulk/in-ship path invokes the engine, and no generated archive path carries a direct `mv`, recursive source deletion, manual ledger write, or post-hash evidence append.
- [x] 6.6 Add integration tests invoking direct CLI, generated single, generated bulk, and in-ship paths against equivalent fixtures and asserting identical cleaner, handoff, probe, quality, evidence-hash, journal, and accounting outcomes.

## 7. Fault injection and cross-platform verification

- [x] 7.1 Inject source drift, target races, `EXDEV`, `EPERM`, `EACCES`, `EIO`, copy failure, staged-tree mismatch, sidecar read/schema failure, Git failure, evidence hash drift, journal failure, publish failure, accounting failure, cleaner partial failure, and active-source removal failure at named phases.
- [x] 7.2 For every injected failure, assert exact disk bytes and report fields: no clobber, active state retained until safe completion, archive either absent or journaled, actual cleaner progress truthful, and rerun behavior deterministic.
- [x] 7.3 Add `path.win32` and `path.posix` cases for drive letters, case identity, separators, relative sidecar/probe containment, symlink escape, stage/final identity, and date-prefixed collision matching using `path.join`/`path.resolve`.
- [x] 7.4 Run focused archive/accounting/ephemera/template suites locally, including the foundation cleaner regression suite, and record exact commands and passed test counts without treating path-semantic tests as native-host evidence.
- [x] 7.5 Run affected command/integration suites plus `pnpm lint` and `pnpm build`; attempt the bounded repository suite only under the parent closure strategy and record the known no-summary hang honestly if it recurs.
- [ ] 7.6 Add/verify native Windows, macOS, and Linux CI jobs for the focused archive fault/recovery integration suite; leave actual three-host matrix completion checked only by `file-placement-hardening-closure`.
- [x] 7.7 Run `rasen validate file-placement-hardening-archive-engine --json` and confirm no implementation edit touches Store root routing, sessions, CLI work migration, final docs reconciliation, or archived historical artifacts.

## Round 1 review remediation mapping

The canonical round 1 review reported 14 findings. All 14 are implemented and
mapped to regressions in `handoff/fixer-1.md`; this table records remediation
without changing closure-owned native-matrix task 7.6.

| Finding | Implemented remediation | Regression evidence |
| --- | --- | --- |
| 1 | Stable source reads, root/entry deletion authority, source claim quarantine, guarded bottom-up removal | same-byte file/root replacement and post-claim child-swap cases |
| 2 | Exclusive final-directory reservation plus atomic no-replace publication marker | reservation-boundary race and marker fault/retry matrix |
| 3 | Exclusive spec create, claimed/verified update, full-tree claimed delete | create/update/delete boundary race cases |
| 4 | Durable cleaner `delete-intent` before deletion and `deleted-after-intent` recovery | post-unlink crash case |
| 5 | Journal v2 per-spec progress and totals derived only from completed actions | partial prepared-spec result/retry case |
| 6 | Durable before/expected/observed fingerprints and resume rehash | transformed stage and published corruption cases |
| 7 | Portable directory payload identity excludes directory mode/allocation size; files bind executable semantics | POSIX `0711` directory/executable-file case plus path suite |
| 8 | Planning `treeState` revalidated | clean-to-dirty and dirty-to-clean cases |
| 9 | Ship-log prefix bytes preserved exactly | CRLF/trailing-space prefix case |
| 10 | Saved canonical plan envelopes, opaque tokens, exact-token apply/resume | separate saved-preview/apply CLI case and tamper case |
| 11 | Engine is sole spec mutation owner; generated external sync removed | generated source guards and consumer integration |
| 12 | Plan blockers exit nonzero and apply JSON preserves structured recovery | blocked preview and recoverable JSON cases |
| 13 | Intent-template/external-intent/save-token/apply-token flow shared by single, bulk, and ship | executable consumer integration and template guards |
| 14 | Bulk summary uses pre-hash ship/path/transaction/accounting facts | generated bulk golden assertion |
