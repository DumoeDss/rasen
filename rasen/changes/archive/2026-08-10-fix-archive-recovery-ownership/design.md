## Context

The archive engine already treats deletion as an ownership-sensitive operation, persists a journal, and exposes stored-plan abort and exact-token retry. Two recovery edges remain insufficiently proved.

First, CCR-2 requires the canonical spec target itself to be treated as evidence that the transaction crossed the abort boundary. The existing regression reaches `specs-applied` before abort, so it does not exercise a crash after canonical target publication but before spec progress or the aggregate phase is advanced.

Second, CCR-3 has an explicit `win32` comparison mode in `archiveAbortPathBindingEquals`, but destructive abort checks currently rely on the helper's native default at each call site. Journal paths, tombstone paths, progress targets, association carriers, and source quarantine bindings therefore do not visibly share one policy.

The live Windows failure adds a related ownership problem. In GitHub run `31313940403`, Windows file-placement job `93246075856`, 37 of 55 archive fault-matrix cases stopped at `archive_cleaner_ownership_unverified` instead of reaching their intended late-phase fault. `EphemeraCandidateFingerprint` serializes `dev`, `ino`, `mode`, and `size` as JavaScript numbers, while `claimAndDeleteCleanerCandidate` compares exact bigint stat strings against those serialized numbers. Large NTFS file IDs can be rounded before persistence, so an unchanged candidate is later rejected and the source-removal recovery path is masked.

Implementation ownership is limited to `src/core/archive-engine.ts` and focused archive-engine, archive fault-matrix, and archive planning-recovery tests/helpers.

## Goals / Non-Goals

**Goals:**

- Prove that a crash after canonical spec publication but before progress advancement cannot make stored abort destructive, while exact-token retry remains possible.
- Use one explicit path-identity flavor for every path equality that authorizes stored-abort cleanup.
- Persist exact cleaner deletion authority without converting security-relevant bigint stat fields to numbers.
- Restore Windows recovery tests to the intended cleaner, accounting, and source-removal phases while preserving fail-closed behavior.

**Non-Goals:**

- Redesigning ephemera classification or changing which files the cleaner selects.
- Owning Store/management finalization, registry updates, or workspace coordination.
- Broad archive transaction refactoring unrelated to CCR-2, CCR-3, or the live Windows recovery failures.
- Relaxing ownership checks for legacy plans or replaced files.

Store-finalization FAR-3 must preserve the complete typed reconciliation issue array without source-wide deduplication or generic replacement.

## Decisions

### 1. Add engine-owned lossless cleaner deletion authority to the immutable plan

For each `effectiveDelete` entry, planning will use the engine's stable, no-follow, handle-bound read to capture an authority record keyed by the normalized relative path. The record will contain the exact decimal-string deletion identity already represented by `ArchiveStatIdentity` (including device, inode, mode, size, and available nanosecond timestamps/type) plus the content digest. The complete ordered authority collection is part of the plan hash.

Planning will accept an authority record only when its path and digest agree with the cleaner classification. A classification/authority race therefore blocks plan creation instead of freezing ambiguous authority.

Apply and resume will validate the complete authority collection before interpreting any cleaner progress or filesystem absence, then look up each exact authority by relative path. The source is re-read through the stable handle path and must match all six plan-time identity fields plus digest immediately before the engine-owned rename. This unconditional collection gate applies even when legacy journal progress says `deleted`/`deleted-after-intent` or the source path is already absent.

Windows rename advances `ctimeNs` for an otherwise unchanged file, so claimed-object authority is an explicit verified transition rather than a weakened comparison to the plan. After the exact source check, the engine verifies that the rename preserved `dev`, `ino`, `mode`, `size`, and `mtimeNs`, then captures the complete six-field post-rename identity as the private claim's authority. Every later stable claim read must match that derived identity exactly plus digest. If a failed cleaner adapter requires the engine to restore the claim through a no-replace hard-link transition, the resulting complete source identity is journaled before recovery returns; exact retry uses that identity, and later absence cannot be mistaken for the original delete intent. A same-byte metadata replacement before rename, or any identity change after the verified transition, is retained. The numeric `EphemeraCandidateFingerprint` remains a compatibility projection for the existing cleaner adapter; it is not deletion authority.

New plans with deletes must contain one exact authority record per `effectiveDelete` path and no extras. A stored legacy plan that has deletes but lacks this exact authority returns `archive_cleaner_ownership_unverified` with recovery evidence retained. A legacy plan with no effective cleaner deletes needs no migration.

This keeps the change inside the archive engine. Changing the shared cleaner fingerprint to strings was considered, but it would broaden the contract and still require a migration story for every cleaner consumer. Comparing exact stats after coercing them back to numbers was rejected because it would preserve the Windows symptom by weakening identity. Requiring plan-time `ctimeNs` to survive rename was also rejected after native Windows verification showed the rename itself advances it; accepting that transition without freezing a new complete claimed identity was rejected as an unbounded weak predicate.

### 2. Treat any durable spec mutation carrier as abort-unsafe, independent of the aggregate phase

Stored abort remains permitted only before any durable mutation. Its decision will combine aggregate phase with per-action progress and durable carriers/identities. Canonical publication cannot become abortable merely because the crash happened before the next progress flush.

The focused regression will persist a real plan, inject a crash immediately after canonical target publication and before the corresponding progress/phase advancement, then invoke stored abort before retry. Abort must return `archive_abort_phase_unsafe` and must not rewrite or remove the canonical target, active source, stage, journal, or stored token. An apply using that exact token must then resume and complete.

Deriving safety only from `journal.phase` was considered and rejected: phase is deliberately written after the mutation it records, so a crash window always exists. Inferring ownership from the current canonical tree alone was also rejected because an unrelated tree must never grant deletion authority; the engine uses only plan/journal-owned mutation evidence.

### 3. Thread one abort path-identity policy through all destructive ownership checks

Abort dispatch will select `NATIVE_PATH_IDENTITY_FLAVOR` once and pass it explicitly through the helpers that validate tombstones, journals, spec progress, association carriers, source quarantine, stage/final paths, and any retained cleanup binding. On Windows this means `path.win32` resolution plus case-insensitive identity; on POSIX it preserves case-sensitive POSIX identity.

Path text found in a journal or tombstone is evidence only. Even when an equivalent spelling is accepted, cleanup operates on the canonical path derived from the plan and transaction identifiers. A spelling that resolves to a sibling, escapes through traversal, changes drive/root, or otherwise differs under the selected flavor refuses abort, and no outside path is touched.

Selecting the helper default independently at every call site was rejected because it permits a future mixed-policy regression. Replacing equality with prefix checks was rejected because sibling names and traversal aliases are not ownership.

### 4. Test the actual recovery dispatch, not only comparison helpers

Focused abort tests on Windows will exercise drive-letter case, mixed separators, and dot-segment aliases through `abortArchivePlan`; equivalent owned aliases must allow only plan-derived early cleanup. Sibling and traversal spellings must return an ownership/mismatch blocker, with outside sentinels unchanged. Helper-level cases can remain for diagnostic precision but do not substitute for dispatch coverage.

The fault matrix will assert that unchanged cleaner candidates with exact authority pass on Windows, late injected failures are reported at their requested operation, and an exact-token retry completes. At least one source-removal case will prove the injected `EACCES`/equivalent is reached rather than being masked by cleaner ownership refusal. Negative coverage will replace or mutate a candidate and confirm fail-closed retention.

## Risks / Trade-offs

- [Plan shape changes for newly created tokens] → Keep the schema backward-readable, validate exact cleaner authority only when deletes are present, and make authority absence fail closed rather than guessing.
- [A classification-to-authority race creates inconsistent plan data] → Capture through stable handles and require path/digest agreement before the plan is declared complete.
- [Equivalent Windows text could be mistaken for permission to delete the supplied text] → Treat carrier text only as a binding proof and always remove plan-derived targets.
- [Fault injection lands at the wrong boundary and gives false confidence] → Assert pre-retry bytes for every protected carrier and prove the aggregate phase/progress has not advanced past the intended window.
- [Windows-only dispatch coverage is invisible on non-Windows development hosts] → Keep portable helper cases and retain the actual-dispatch matrix in Windows CI.

## Migration Plan

1. Extend new archive plans with deterministic exact cleaner authority and include it in plan hashing/validation.
2. Switch cleaner apply/resume authorization to the exact records while retaining existing classification output for presentation and adapter compatibility.
3. Thread the explicit abort path flavor through all ownership comparisons and add the crash-window/path-alias regressions.
4. Run the focused tests on Windows and the existing cross-platform archive suites. No stored plan is rewritten in place; legacy plans with pending deletes remain retained for manual recovery or replanning.

Rollback removes creation and consumption of the new authority only together. Plans already carrying the additive field remain readable by older code as data, but must not be applied by a rollback that cannot enforce their exact authority contract.

## Open Questions

None. The implementation may choose the field name and internal record layout, provided it preserves exact decimal stat identity, digest binding, deterministic ordering, and fail-closed legacy behavior described above.
