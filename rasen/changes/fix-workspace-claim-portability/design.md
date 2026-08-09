## Context

Workspace plans, indexes, locks, binding markers, and cleanup progress share `atomicWorkspaceWriteText()` in `src/core/store/workspace/dependencies.ts`. The writer publishes content with exclusive files and hard links so a concurrent target is never overwritten, and journaled archive-association writes can persist an `AtomicWorkspaceCarrierAuthority`. Machine coordination writes from `createNodeWorkspaceCoordination().writeJson()` are intentionally unjournaled and cannot supply that external authority.

The current carrier sequence can retain an exact intent before its claim is written, or a complete claim after interruption. A retry must distinguish a state that proves the same requested write from a corrupt, disagreeing, or replaced carrier without treating process-local memory as authority. The same proof depends on exact filesystem identities; converting an already rounded JavaScript `number` to a string does not preserve large NTFS device or inode values.

Directory durability is a separate portability boundary. Some Node/platform/filesystem combinations cannot open or synchronize a directory and report a small set of unsupported-operation errors. Today directory open and `FileHandle.sync()` share one catch and include `EACCES`, so the writer cannot distinguish a portability limitation from a real permission or I/O failure.

## Goals / Non-Goals

**Goals:**

- Make every complete, valid carrier phase produced by an unjournaled coordination write safe for the same requested write to resume.
- Preserve journal-bound authority as the stronger mode whenever the caller supplies it.
- Preserve no-clobber publication and require exact ownership immediately before every carrier cleanup.
- Preserve filesystem identity without numeric precision loss, including large Windows NTFS `dev` and `ino` values.
- Isolate directory-open and directory-sync portability handling and continue surfacing genuine I/O, file-sync, and close failures.
- Cover the carrier state machine and directory fault policy with focused, deterministic tests.

**Non-Goals:**

- Changing workspace carrier names, public errors, command surfaces, Git verbs, or the coordination root.
- Weakening or redesigning journaled archive-association authority.
- Changing project registry selection, canonical alias ownership, project-home lookup, planning identity selection, the archive engine, spec reconciliation, or Store finalization.
- Adding general filesystem recovery, automatic deletion of corrupt evidence, or a new dependency.

## Decisions

### 1. Treat a matching carrier as authority for only the independently requested write

The writer will keep the content-addressed `.intent`, `.backup`, and `.claim` carrier set and its exclusive-create/hard-link publication model. Recovery will use two explicit authority modes:

- **Journal-bound mode:** when `expectedBefore.authority` is present, the claim, intent, target, content digest, canonical directory, and filesystem identities must match that authority exactly. Failure never falls back to self-contained recovery.
- **Self-contained mode:** when no external authority is available, a stable carrier may authorize only the target and exact content independently requested by the current call. Its claim must parse as the supported version and bind the exact target, content digest, canonical directory path and identity, prior target digest and identity, and intent identity.

The self-contained state machine is:

1. With no claim, an absent intent starts a fresh write. An exact stable intent left before claim publication may be incorporated into a new exclusive claim only when no backup exists and the current target has been observed as a stable before-state. A partial or disagreeing intent remains untouched and conflicts.
2. With a claim, recovery validates the stable claim identity and every bound field. The target must still be either the exact prior target or the already-published hard link to the exact intent; any backup must be the exact prior target identity.
3. Publication retains the existing exclusive backup and hard-link checks. `EEXIST`, target drift, ancestry drift, and identity drift remain conflicts.
4. Cleanup re-reads every owned path immediately before unlinking it, including the claim itself, and removes it only if its identity is the one proven by this transaction. Replaced or additional paths remain and block completion.

A same-content carrier does not grant ambient authority: the current caller already requested those exact bytes, and the carrier cannot authorize a different target, content, directory, or prior target. This permits useful retry without allowing retained metadata to clobber changed state.

Alternative considered: replace the carrier protocol with `rename()`. Rejected because cross-platform rename replacement semantics do not preserve the existing no-clobber contract for an occupied target. Requiring every coordination caller to add an external journal was also rejected because locks, indexes, and plans are themselves the coordination journal and would need a second recursive authority store.

### 2. Capture filesystem identity from BigInt stat data

All identities used by the atomic writer will originate from `lstat` results requested with BigInt fields. `dev`, `ino`, and `size` will be serialized directly as canonical decimal strings; `mode` will be converted only after its bounded value is checked. Directory identity continues to normalize only the mutable directory-entry size while preserving the exact device, inode, and mode.

The serialized identity shape remains unchanged, so valid retained version-2 claims and journal authority remain readable. Tests will inject values above `Number.MAX_SAFE_INTEGER` to prove that distinct NTFS identities do not collapse during capture or comparison.

Alternative considered: keep ordinary numeric stat results and stringify them. Rejected because precision may already have been lost before string conversion.

### 3. Classify directory durability failures by stage, platform, and exact code

`syncDirectory()` will have distinct directory-open and directory-sync error boundaries. A named lookup table will classify only established unsupported outcomes for the current platform and stage, using the existing `EISDIR`, `EINVAL`, `EPERM`, and `ENOTSUP` evidence. `EACCES` will be removed from the unsupported set. No regex, message inspection, retry count, or broad permission classification will be used.

Before an allowed unsupported result is accepted, the writer will re-run canonical-path and exact-directory-identity validation. If that validation fails, the ancestry conflict wins. A successfully opened handle is always closed in `finally`; close failures remain visible even when directory sync itself is unsupported. File-handle sync for intent and claim content is never covered by the directory policy.

`EACCES`, `EIO`, `ENOSPC`, `EBADF`, unknown codes, errors at any other operation, and platform/stage combinations absent from the lookup continue to fail the write. Recoverable evidence remains in place when such a failure occurs.

Alternative considered: keep one global error-code allowlist. Rejected because the same code can represent different conditions at open and sync boundaries, and `EACCES` is not evidence that directory synchronization is unsupported.

### 4. Test recovery as a state and fault matrix

Focused tests under `test/core/store/` will cover interruption after intent preparation, after claim durability, after backup publication, after target publication, and during owned cleanup. Each phase will retry with the same bytes, different bytes, changed target identity, replaced claim/intent/backup identity, and corrupt claim content as applicable.

Directory tests will inject faults independently at directory open, directory sync, file sync, and handle close. They will assert the explicit supported/unsupported matrix, same-directory revalidation, carrier retention after genuine failure, and successful retry after the fault is removed. Path assertions will use `path.join()` and Windows cases will use exact large identity values rather than path spelling as a proxy.

The existing Git-verb source guard remains in the focused verification set because all implementation stays inside the workspace dependency adapter.

## Risks / Trade-offs

- [A valid exact intent from another interrupted writer is incorporated into the same requested write] → It can authorize only the target and bytes independently requested now; all before-state, identity, no-clobber, and cleanup checks still apply.
- [A corrupt or disagreeing carrier remains a manual recovery blocker] → Preserve it as evidence and return `workspace_atomic_write_conflict`; never guess ownership or delete it automatically.
- [A platform returns a new unsupported directory-sync code] → Fail safely until evidence supports adding that exact platform/stage/code tuple and its regression test.
- [Directory sync is unavailable, reducing crash durability on that filesystem] → Continue only for an explicit unsupported tuple after directory identity revalidation; content files themselves remain synchronized and the limitation is narrower than accepting arbitrary I/O failure.
- [BigInt stat typing touches identity helpers used by several writer phases] → Keep the serialized type stable and exercise fresh writes, retained claims, journal-bound authority, and large identities in one focused matrix.

## Migration Plan

No persistent migration or public API transition is required. The implementation continues to read the existing version-2 claim and authority shape, and successful writes retire their transient carriers as before. Rollback requires no data conversion; valid retained carriers remain conservative blockers for the older implementation, while corrupt or disagreeing evidence is never rewritten.

## Open Questions

None. Any newly observed directory-sync code requires platform evidence and a separate explicit policy update rather than inference during implementation.
