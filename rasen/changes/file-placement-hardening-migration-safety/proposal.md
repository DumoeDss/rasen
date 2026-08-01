## Why

PR #121's cleaner and legacy-state migrator can currently delete unvalidated or undisclosed data, overwrite destinations under races, and report successful disposal without changing the filesystem. These safety gaps must be closed before archive convergence or Store root routing can rely on the shared mutation layer.

## What Changes

- Make ephemera classification fail closed: validate known run-state before deletion, preserve malformed/future/unknown/nested entries, recursively detect source-tree signals before any deletion, and surface non-absence filesystem errors.
- Derive one immutable migration plan whose actions are identical in preview and apply, including explicitly confirmed conclusion deletion.
- Make `--change` constrain the whole migration to state provably owned by the named change, excluding unrelated global probes and design documents.
- Publish file and directory moves without clobbering a destination created before or during apply; use only a narrowly identified cross-device fallback and report every conflict or failure.
- Delete archived run-state only during apply, report it discarded only after deletion succeeds, and make a successful rerun a no-op.
- Add deterministic Windows, macOS, and Linux regression coverage for path handling, race conflicts, partial filesystem failures, and permission/I/O errors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-placement`: Strengthen the ephemera-cleaning contract with schema validation, recursive source-tree preflight, and fail-closed filesystem error handling.
- `work-migration`: Strengthen planning/apply equivalence, whole-command scoping, no-clobber publication, truthful archived-state disposal, fallback limits, and failure reporting.

## Impact

- Core implementation: `src/core/ephemera-cleaner.ts` and the safety, planning, move, and scoping portions of `src/core/work-migration.ts`.
- Tests: cleaner and migration unit/integration suites, including injected race/error cases and platform-specific path semantics.
- Downstream dependencies: the archive-engine and root-routing remediation children may build on these shared safety primitives after this change is review-clean.
