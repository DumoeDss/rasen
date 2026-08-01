## Context

PR #121 introduced `src/core/archive.ts`, `src/core/archive-accounting.ts`, a cleaner, and `archive.json`, but the generated single, bulk, and in-ship workflows still move the change directory themselves. The CLI path also deletes ephemera before relocation, treats several Git/evidence/sidecar failures as absence, mutates quality metadata after the move, hashes evidence before the archive skill later appends to `ship-log.md`, and has an `EPERM`/`EXDEV` copy-and-recursive-remove fallback that can leave the only active copy half moved.

The review-clean migration-safety child now provides the archive boundary with a complete immutable cleaner classification: candidate fingerprints, effective preserved paths, `sourceSignals`, typed `blockers`, `complete`, and guarded apply. Archive must consume that contract without reclassification and without calling apply for an aborted or incomplete plan.

This child owns archive planning, staging, accounting, publication, and the generated single/bulk/in-ship consumers. It does not own Store root propagation, session management, work-migration command wiring, or the final documentation/schema sweep. Resolved planning and execution roots remain inputs supplied by existing root selection and the root-routing sibling.

## Goals / Non-Goals

**Goals:**

- Expose one serializable archive plan and one recoverable apply engine for every entry point.
- Make dry-run and apply use the same disposition, sidecar, cleaner, spec-sync, evidence, and target decisions.
- Preserve the active change and cleaner source until a verified archive, recovery journal, and truthful accounting are durable.
- Validate sidecar paths, outcomes, commits, and all Git/evidence reads fail closed.
- Finalize evidence and quality metadata before hashing, with no post-accounting ship-log append.
- Provide deterministic fault injection and native Windows/macOS/Linux integration coverage.

**Non-Goals:**

- Changing the planning-root/execution-root/machine-root model or Store selection.
- Editing `src/commands/work.ts`, migration root routing, session lookup, or management APIs.
- Reclassifying cleaner candidates or changing the foundation cleaner's public result contract.
- Automatic Git commits, pushes, PR creation, or Store-side commit orchestration inside the CLI.
- Rewriting the archived `file-placement-collapse-archive` artifacts or their unchecked task history.
- Performing the portfolio's final docs/spec reconciliation or claiming macOS/Linux success from path-helper tests alone.

## Decisions

### 1. `ArchivePlan` is the single immutable contract

Extract archive discovery from mutation. `planArchive` returns a JSON-serializable, stable-ordered `ArchivePlan` containing:

- version, transaction id, semantic change name, planning/execution roots, active source, staging root, and final archive path;
- source-tree fingerprint and target/source preconditions;
- validation/task/timing decisions and the fully prepared spec-sync actions;
- the validated sidecar projection or the explicit `unjudged-preserve-all` default;
- the foundation `EphemeraClassification` plus the effective delete/preserve disposition after `keepEphemera`;
- quality candidates and the evidence inventory expected after staged handoff/ship-log finalization;
- archive-level blockers and cleaner source signals/blockers separately.

`applyArchive(plan)` accepts that exact object, checks its version/completeness, and records runtime outcomes without altering any planned action. Human output and JSON output are two projections of the same plan/result types. `ArchiveCommand.execute` becomes a thin plan/confirm/apply adapter.

A complete cleaner plan with source signals is not applied: all candidates appear in the effective preserved set and archive output. This preserves the established safe behavior that a source-tree signal aborts cleaning while allowing a fully accounted archive to proceed. A cleaner plan with `complete === false` or non-empty typed blockers makes the archive plan incomplete and blocks all apply, because the engine cannot prove the complete disposition.

`--keep-ephemera` does not skip discovery. It projects every cleaner candidate and already-preserved entry into the effective preserve disposition and an empty delete list, so preview still reports all paths and inspection failures cannot be hidden by the flag.

Alternative considered: retain the current `run(options)` routine and patch each early return. Rejected because single/bulk/in-ship consumers would still have no immutable object to invoke or compare with dry-run.

### 2. Every consumer invokes the engine; generated templates never move directly

The single archive skill performs its semantic gates and writes only validated decision intent, then invokes `rasen archive`. The bulk skill resolves conflicts as today but archives each selected change through the same CLI engine, using the engine's per-change JSON plan/result for partial-success reporting. It never issues `mkdir`/`mv` bookkeeping.

Under `in-ship` timing, ship first completes the delivery facts that belong in evidence, writes the final ship-side log, and then invokes the archive engine. PR mode may require an initial push/PR creation followed by the archive commit and a normal follow-up push; push/local mode follows the analogous two-commit sequence. The engine finalizes the archive section before hashing. The workflow may guide a path-scoped archive commit whose message refers to the recorded ship commit, but it must not append to evidence afterward.

Alternative considered: export the private directory-move helper for templates to call. Rejected because it would still bypass plan validation, cleaner accounting, journaling, and evidence finality.

### 3. The sidecar is versioned, change-bound intent, not pre-applied mutation

Replace the permissive cast with a strict runtime schema, for example:

```json
{
  "schemaVersion": 1,
  "change": "semantic-change",
  "handoff": {
    "complete": true,
    "decisions": [
      { "path": "handoff/implementer-1.md", "outcome": "absorbed" }
    ]
  },
  "probes": [
    { "path": "experiments/repro", "codeCommit": "<40-hex commit>" }
  ]
}
```

Only `ENOENT` means no sidecar, which selects the safe `unjudged-preserve-all` behavior and records `handoffAbsorbed: null`. Malformed JSON, unknown/future schema versions, a wrong change name, missing/duplicate decisions, unknown outcomes, absolute or escaping paths, non-regular handoff entries, unreadable inventory, or an incomplete declared judgment are archive blockers.

Handoff decisions are checked against a deterministic inventory. `absorbed` omits the file from the staged payload; `preserved` relocates it inside the stage to `evidence/handoff/`. The skill never deletes or moves the active handoff itself. Thus a later planning, staging, or accounting failure leaves the original handoff recoverable.

Probe paths must be normalized execution-root-relative paths. Lexical containment and resolved realpath containment must both hold; symlink escape, absence, wrong type, or unreadable paths block. Commits must be full hexadecimal object ids and must resolve as commit objects in the execution repository. A commit need not equal current HEAD because a probe may truthfully record the earlier commit it tested.

Alternative considered: keep optional unversioned arrays for compatibility. Rejected because a malformed or partially written judgment is more dangerous than the explicit no-sidecar preservation default.

### 4. Staging and a durable journal make apply resumable and source-last

Apply uses a stage created exclusively beneath the final archive parent and a journal whose plan hash and transaction id bind it to one immutable plan:

1. Revalidate blockers, source fingerprint, target absence, and Git facts.
2. Create or resume the exclusive stage and atomically write the journal before copying payload.
3. Copy every source entry exclusively into the stage, excluding engine control files; verify the staged tree against the planned source fingerprint.
4. Apply handoff disposition and ship-log finalization only in the stage.
5. Capture quality metadata recursively, freeze the evidence inventory, hash it, and atomically write the draft accounting.
6. Exclusively publish the verified stage to the final date-prefixed path. A pre-existing unrelated target is a blocker; a matching incomplete journal is resumed.
7. Apply cleaner candidates from the complete foundation plan with per-candidate journal progress. An aborted plan is never passed to cleaner apply; an incomplete plan never reaches this step.
8. Atomically write final `archive.json` with actual disposal outcomes, then verify it and its evidence hashes.
9. Revalidate and remove the active change source last. Mark the transaction complete and remove only engine-owned journal/stage control entries.

Any failure before publication leaves the active source and ephemera intact plus a resumable or conservatively removable stage. Any failure after publication leaves the active source and an archive-local journal that identifies the plan, phase, partial ephemera progress, and recovery action. A rerun resumes only when the transaction id and plan hash match; otherwise it reports the target collision and changes nothing.

The current `moveDirectory` fallback is removed from archive publication. Stage and final target share a parent, so final publication is same-device; an injected `EXDEV` there is an invariant failure. Any compatibility copy fallback retained during refactoring may run only for explicit `EXDEV`, must create destinations exclusively, verify the full copy, and remove the source last. `EPERM`, `EACCES`, and `EIO` never trigger fallback.

Alternative considered: move the active directory to a stage and roll it back on error. Rejected because a crash after the first rename removes the active path before a complete archive exists.

### 5. Accounting and Git/evidence discovery distinguish absence from failure

Evidence traversal is deterministic, recursive, symlink-safe, and rooted at staged `evidence/`. Only an `ENOENT` evidence directory means an empty inventory. `EACCES`, `EPERM`, `EIO`, unexpected `lstat`/read errors, containment failures, and file drift between inventory and hash block publication or leave the journal recoverable.

Git probes become explicit results:

- a confirmed non-Git planning root records `planningBranch: null` and `planningTreeState: clean`;
- a confirmed non-Git execution root records `codeCommit: null` and cannot accept probe commit claims;
- missing Git, corrupt metadata, permission/I/O errors, or ambiguous work-tree detection block rather than becoming null/clean;
- branch/status/HEAD failures after a Git root is confirmed block.

`archive.json` is written through temp-file, fsync/close, and same-directory rename semantics, then parsed and verified before active source removal. The journal retains the complete draft and per-phase outcome until the final ledger is durable.

Alternative considered: make accounting best-effort because archive content still exists. Rejected because the purpose of accounting is to explain destructive disposition and evidence identity; silence is not a valid outcome.

### 6. Evidence is frozen before hashing; the archive commit is not appended into it

The engine finalizes, in the stage and in this order:

1. handoff preservation under `evidence/handoff/`;
2. the archive section of `evidence/ship-log.md` (or a minimal archive-only ship log);
3. recursive quality capture and `.openspec.yaml`;
4. the stable evidence inventory and SHA-256 hashes;
5. `archive.json`.

No workflow may append an archive commit SHA to the ship log after step 4. A content file cannot stably contain the hash of the commit that contains that content; the prior append-after-commit flow merely invalidated the evidence hash and left a dirty tree. The durable reverse link is the archive commit message's recorded ship short SHA and Git history. The finalized ship log records timestamp, archive outcome/path, transaction id, and the ship commit copied from its existing facts, but not a self-referential archive commit.

Alternative considered: recompute `archive.json` after the follow-up ship-log append. Rejected because it creates another commit/self-reference loop and makes archive success depend on an external commit action the CLI does not own.

### 7. Quality capture uses the finalized canonical evidence tree

Quality discovery walks `evidence/` recursively in stable relative-path order and matches only the existing explicit quality filename set/pattern contract. Nested reports such as `evidence/security/cso-report.md` and `evidence/handoff/review-report.md` are recorded by relative path in `.openspec.yaml` quality metadata and are already present in the same evidence inventory hashed into `archive.json`.

Unreadable quality candidates are blockers, not skipped files. Legacy top-level quality files may retain an explicit compatibility lookup if existing specs require it, but canonical discovery and new tests use `evidence/`.

### 8. Filesystem and time seams make recovery tests deterministic

Archive planning/apply receives narrow injectable adapters for filesystem operations, Git reads, hashing, time/transaction ids, and cleaner apply. Tests inject source drift, target races, `EXDEV`, `EPERM`, `EACCES`, `EIO`, copy failure, hash drift, journal-write failure, ledger-write failure, publish failure, cleaner partial failure, and active-source removal failure at named phases.

Pure path tests exercise `path.win32` and `path.posix` semantics, while real temporary-directory integration suites must run natively on Windows, macOS, and Linux. The closure child owns the final CI-matrix execution gate; this child adds the tests and records only the hosts actually run.

## Risks / Trade-offs

- [Verified copy staging costs more I/O than rename] → Archive safety and resumability take priority; evidence/change trees are bounded, and no active source is removed until completion.
- [A crash can leave both an active change and a published archive] → The archive-local journal binds the duplicate to one transaction and makes resume/triage explicit; never guess from directory presence alone.
- [Per-candidate cleaner journaling can expose a partial clean] → Persist progress before/after each guarded candidate and keep the active change plus archive journal until final accounting is durable.
- [Strict legacy sidecars begin failing] → Absence remains a safe compatibility path; malformed or unversioned presence blocks with a concrete migration message instead of being silently accepted.
- [Removing the archive-commit append changes an established chain shape] → Preserve traceability through the ship commit recorded in evidence and the archive commit message/Git history, which is stable and non-self-referential.
- [Ship under `in-ship` may need an additional push/commit] → The workflow reports this explicitly; it is the cost of ensuring PR URL/delivery facts are final before archive evidence is hashed.

## Migration Plan

1. Add failing plan/dry-run tests for complete cleaner and sidecar projections, effective keep semantics, archive blockers, and byte-identical preview/apply actions.
2. Add strict sidecar and fail-closed accounting tests before replacing permissive readers.
3. Extract `ArchivePlan`, `ArchiveApplyResult`, adapters, staging, journal, and resume logic while keeping `ArchiveCommand.execute` as the compatibility entry.
4. Finalize handoff/ship-log/quality in the stage, then hash evidence and write atomic accounting.
5. Replace single, bulk, and in-ship template bookkeeping with engine invocations and remove every direct archive `mv`.
6. Add phase-by-phase fault injection, recovery, source-last, target-race, and cross-platform path tests.
7. Run focused archive/accounting/template suites, lint, build, and change validation locally. Leave full-suite hang diagnosis and native matrix completion as explicit closure gates.

Rollback before source removal is direct: delete only a stage proven by its matching transaction journal, leaving active inputs authoritative. After publication, do not recursively delete either copy; resume the matching transaction or report both paths for manual recovery. Reverting code does not erase published archives or journals.

## Open Questions

None. Store root propagation and the final repository-wide documentation/schema reconciliation remain intentionally delegated to their sibling children.
