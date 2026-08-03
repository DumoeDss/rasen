## Context

PR #121 established the planning-root/execution-root model but left its two destructive seams unsafe. `ephemera-cleaner.ts` currently classifies known state by filename, catches every read error as an empty directory, and inspects only the top level before deletion. `work-migration.ts` mixes discovery, planning, and mutation behind an `execute` flag; changes a conclusion action only during execute; checks destination existence before unsafe rename/copy operations; catches all directory-read errors as empty; and reports archived run-state discarded without deleting it.

This child is the foundation for the archive-engine and root-routing children. It owns `src/core/ephemera-cleaner.ts`, the planning/move/scoping safety portions of `src/core/work-migration.ts`, and focused tests. It preserves the approved seven-class placement model and must work on Node.js 20.19+ across Windows, macOS, and Linux.

## Goals / Non-Goals

**Goals:**

- Make cleaner classification complete, schema-aware, deterministic, and fail closed before any deletion.
- Represent migration intent as one immutable plan and represent apply observations separately.
- Make every file and directory publication no-clobber even when a destination appears after planning.
- Make scoped migration exclude all state that cannot be proven to belong to the requested change.
- Make deletion, fallback, and failure reporting match actual disk state and support idempotent reruns.
- Establish cross-platform fault-injection and race regression coverage.

**Non-Goals:**

- Converging archive entry points, archive accounting, evidence hashing, or archive transaction ordering; those belong to `file-placement-hardening-archive-engine`.
- Propagating Store planning/execution roots through `src/commands/work.ts` or Sessions API; those belong to `file-placement-hardening-root-routing`.
- Changing terminal locations, the seven file classes, archive semantics, or machine identity rules.
- General-purpose garbage collection or automatic deletion of unknown/global state.

## Decisions

### 1. Cleaner returns a complete immutable plan before deletion

`classifyEphemera` will become a recursive read-only preflight that returns a deterministic plan containing:

- every top-level deletion candidate with a content/identity fingerprint;
- every preserved path and reason;
- every source-tree signal;
- any blocking filesystem/validation errors;
- `aborted` derived from source signals or blockers.

`applyEphemeraDeletion` will accept only that plan. Before unlinking each candidate it will verify that the path is still the same regular file described by the plan; drift becomes a reported failure/conflict and no substitute entry is deleted. Any source-tree signal or incomplete inspection makes the whole plan non-applicable.

Alternative considered: retain the current top-level classification and rely on non-recursive deletion. Rejected because a nested `src/main.ts` can prove probe misclassification while a top-level run-state file is still deleted.

### 2. Known state uses an explicit validator registry

Known structured filenames will map through one explicit lookup to their supported parsers and version guards:

- `auto-run.json` uses the canonical run-state parser/schema.
- `portfolio-run.json` uses the canonical portfolio-state parser/schema.
- `goal-run.json` uses an explicit validator for the generated goal-round record contract.

The wrapper checks recognized version markers before a permissive/passthrough parser, so a future marker cannot become valid merely because unknown properties are tolerated. Versionless compatibility shapes remain eligible only where the named parser deliberately accepts them. Control markers and raw-material names keep their explicit filename classifications because they are not typed run-state.

Alternative considered: JSON parse only. Rejected because syntactically valid but incompatible state is not safe to discard. Another alternative was duplicating every state schema inside the cleaner; rejected because it would drift from the authoritative readers.

### 3. Recursive source detection and read errors are conservative

The preflight walks the entire tree in stable path order without following symlinks. Source signals come from centralized explicit constant sets: manifest filenames, recognized source-directory names, and source-code extensions. A nested manifest or recognized source file aborts all deletion. Nested non-source directories and special entries remain preserved.

Filesystem helpers distinguish `ENOENT` from every other error. Absence yields an empty/no-longer-present observation. `EACCES`, `EPERM`, `EIO`, containment errors, and unexpected `lstat`/read failures become typed blockers carrying operation, path, and code. The cleaner throws or returns that blocker to the archive caller; it never turns incomplete discovery into a successful empty classification.

Alternative considered: preserve only the unreadable entry and continue deleting siblings. Rejected because the unreadable area may contain the source-tree signal that should abort the whole clean.

### 4. Migration plan and apply result are separate data models

`planWorkMigration` will perform all discovery, classification, routing, option interpretation, and visible-conflict inspection without mutation. It returns stable ordered actions (`move-file`, `move-directory`, `discard-file`, or `leave`) with source, destination, owner/scope, classification, and preconditions. `--discard-absorbed-conclusions` changes `leave` to `discard-file` during planning, never during apply.

`applyWorkMigration` consumes the plan and returns outcomes (`moved`, `discarded`, `conflict`, `already-absent`, `failed`, or `incomplete`) keyed to the unchanged actions. Existing orchestration may keep a compatibility entry point, but its preview and execute branches must be projections of this plan/apply split rather than conditional classification. Deterministic serialization tests compare the ordered action payload used for preview with the payload passed to apply.

Alternative considered: keep one `runWorkMigration(..., { execute })` routine and remove only the known conditional. Rejected because future conditionals could reintroduce undisclosed actions and because mutation outcomes are currently overloaded as plan status.

### 5. Scoped mode has an ownership allowlist

Planning first resolves the active change and matching date-prefixed archived directories. With `changeName` set, only their legacy work directories are scanned. The global probe and design-doc phases are omitted because those locations carry no reliable per-change owner. No filename, directory-name, or content heuristic may pull an unowned global into scoped mode.

Unscoped migration retains the current global phases. A future explicit global command may improve ownership, but that is not required here.

Alternative considered: classify globals and filter those whose names contain the change name. Rejected because scheduling/history names are not durable ownership and false attribution could delete unrelated conclusions.

### 6. No-clobber publication never uses check-then-replace

File publication uses an exclusive primitive:

1. Attempt an atomic hard-link publication to the final destination, which fails if the destination exists.
2. If and only if the error is the explicit cross-device condition, copy to the final path with exclusive-create semantics.
3. Verify source and published content/identity before removing the source.
4. Mark `moved` only after source removal succeeds.

`EACCES`, `EPERM`, `EIO`, and arbitrary rename/link errors do not enter fallback. If copy succeeds but source removal fails, the outcome is `incomplete`, both paths are reported, and rerun sees a conflict rather than pretending completion.

Directories use exclusive destination reservation followed by recursive exclusive creation/copy. Every child publish is no-clobber. Source removal occurs only after the complete destination tree verifies. A collision leaves the source intact and reports any partial destination. Cleanup may remove only entries recorded as created by the current action and only when their identity still matches; it never recursively removes an unverified destination.

Alternative considered: preflight `access()` followed by `rename()`. Rejected because POSIX rename may replace a concurrently created file or empty directory. Another alternative was rename followed by copy on `EPERM`; rejected because `EPERM` is a permission failure, not evidence of a safe cross-device fallback.

### 7. Planning errors block; apply errors remain per-action and truthful

Planning must be complete before any mutation. Any non-`ENOENT` read/stat error adds a blocker and `applyWorkMigration` refuses the plan. Apply-time failures are recorded per action so unrelated already-planned actions can continue when doing so cannot violate plan completeness.

Archived run-state is represented as `discard-file`. Apply calls a non-recursive unlink and increments the discarded count only after success. `ENOENT` during apply is `already-absent`, while permission/I/O errors are `failed`. After a successful deletion, the next plan has no candidate and is a no-op.

### 8. Tests model platforms, races, and injected failures explicitly

Focused tests will use dependency-injected filesystem operations to deterministically create a destination between plan and publication and to inject `EXDEV`, `EACCES`, `EPERM`, `EIO`, copy failure, verification mismatch, and source-removal failure. Real temporary-directory tests assert bytes on disk, not only report fields.

Path expectations use `path.join`, `path.relative`, and containment helpers. Pure routing tests exercise both `path.win32` and `path.posix`; filesystem suites run in the project's Windows/macOS/Linux CI matrix so the exclusive primitives are verified on each host.

## Risks / Trade-offs

- [Directory moves become copy-and-verify rather than a same-filesystem rename] → Accept the extra I/O for legacy migration; safety and recoverability take priority, and progress reporting remains per directory.
- [A crash can leave a verified destination plus the original source] → Never claim success until source removal; report/recover as an incomplete duplicate and let rerun surface a conflict.
- [Recursive cleaner inspection costs more than a top-level scan] → Ephemera trees are bounded per change; stable traversal is necessary to prove deletion safety.
- [Canonical state parsers may be permissive for backward compatibility] → Add explicit version guards before parser invocation and keep the filename-to-validator registry narrow.
- [Exclusive directory population exposes a partial migration-owned directory] → Tag/track only current-action creations, keep the source intact until verification, and report the partial target rather than deleting uncertain content.

## Migration Plan

1. Add failing cleaner tests for malformed/future state, nested source signals, plan drift, and non-`ENOENT` read failures.
2. Implement the validator registry, recursive preflight, typed blockers, and guarded delete apply.
3. Add failing migration tests for action equivalence, scoped globals, archived-state deletion, no-clobber races, narrow fallback, and partial failure.
4. Extract the migration plan/result models, then implement exclusive file and directory publication behind dependency-injected filesystem operations.
5. Run focused suites on the local host, then the Windows/macOS/Linux CI matrix. Downstream children may start only after this child is review-clean.

Rollback is source-safe: before source removal, failures retain the legacy source; after a completed move, the destination is authoritative. Reverting the code does not automatically reverse completed migrations, so test fixtures must exercise migration on disposable trees and production failures must report both paths for manual recovery.

## Open Questions

None. Archive-engine transaction ordering and Store execution-root propagation remain intentionally delegated to their named children.
