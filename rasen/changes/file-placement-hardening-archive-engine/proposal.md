## Why

PR #121 has archive logic in the CLI, single-change skill, bulk skill, and in-ship workflow, but only the CLI path invokes cleaning and accounting, and that path can still lose active state or publish an archive whose evidence and ledger disagree. The archive boundary must converge on one recoverable, fail-closed engine before Store routing and final closure can safely build on it.

## What Changes

- Make one archive plan/apply engine authoritative for direct CLI, single-change, bulk, and in-ship archive entry points; generated workflows no longer move change directories or perform archive bookkeeping themselves.
- Make human and JSON dry-runs expose the same complete plan consumed by apply: archive blockers, sidecar/handoff and probe decisions, cleaner source signals and blockers, effective `--keep-ephemera` behavior, every delete/preserve disposition, spec updates, quality inputs, and final target.
- Consume the foundation cleaner's immutable classification and refuse to apply any aborted or incomplete cleaner plan; source-signal aborts preserve and report every effective path, while incomplete inspection blocks the archive.
- Validate the archive-input sidecar at runtime, including schema version, change binding, complete handoff outcomes, contained relative paths, probe commit syntax/existence, and execution-root containment; treat only `ENOENT` as absence and fail closed on Git, evidence, and sidecar I/O.
- Stage, journal, verify, and exclusively publish archives with the active change and ephemera retained until a recoverable ledger exists; restrict cross-device fallback to its explicit condition and remove each source only after its destination is verified.
- Finalize handoff disposition, archive ship-log content, recursive quality capture, and the entire evidence tree before hashing and writing `archive.json`; remove all post-accounting evidence mutation.
- Discover quality reports recursively under `<changeRoot>/evidence/`, record their relative paths deterministically, and add injected fault and native Windows/macOS/Linux integration coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-placement`: Strengthen archive disposition accounting, handoff/probe sidecar validation, evidence finality, and recoverable publication semantics.
- `cli-archive`: Define one complete archive plan and recoverable apply engine used by every archive entry point, with truthful dry-run and `--keep-ephemera` projections.
- `opsx-archive-skill`: Replace single and bulk direct moves and handoff mutations with validated intent passed to the authoritative archive engine.
- `opsx-ship-command`: Route in-ship bookkeeping through the archive engine after delivery evidence is complete and prevent later evidence mutation.
- `archive-quality-capture`: Discover and record quality reports recursively from the canonical `evidence/` tree with fail-closed reads.
- `sha-cross-stamping`: Finalize the archive section before evidence hashing and use Git history/commit guidance for the archive-side link instead of appending a self-referential commit SHA afterward.

## Impact

- Core implementation: `src/core/archive.ts`, `src/core/archive-accounting.ts`, and narrow reusable archive staging/journal helpers.
- Generated consumers: `src/core/templates/workflows/archive-change.ts`, `bulk-archive-change.ts`, and `ship.ts`.
- Tests: archive plan/apply, accounting, sidecar, quality capture, generated-template, fault-injection, recovery, and cross-platform integration suites.
- Downstream contract: Store root routing may supply resolved planning/execution roots, but archive retains ownership of disposition, staging, accounting, and publication. Final documentation/schema reconciliation and the real CI matrix gate remain in `file-placement-hardening-closure`.
