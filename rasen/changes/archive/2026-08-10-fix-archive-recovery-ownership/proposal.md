## Why

Archive recovery currently has two ownership gaps: a stored abort can be attempted after canonical publication but before phase progress is recorded, and Windows retries can reject unchanged cleaner candidates because plan-time file identity was serialized through lossy numbers. These gaps mask the intended source-removal recovery path and make safe abort behavior depend on host path semantics.

## What Changes

- Make canonical publication an abort-unsafe boundary even when a crash occurs before spec progress or the overall phase advances; the exact stored token remains retryable.
- Apply one explicit cross-platform path-identity policy to every destructive stored-abort ownership check, accepting equivalent owned Windows spellings while refusing traversal, sibling, or otherwise outside targets.
- Persist lossless, handle-bound cleaner deletion authority in new archive plans so Windows apply and retry can revalidate unchanged candidates exactly and reach the intended accounting and source-removal recovery phases.
- Keep legacy plans without trustworthy exact cleaner authority fail-closed instead of weakening deletion checks.
- Add focused archive-engine, fault-matrix, and planning-recovery regressions for the canonical-publication crash window, Windows path aliases, cleaner recovery, and source-removal fault reachability.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-archive`: Clarify the durable abort boundary and the cross-platform ownership rules for aborting or retrying a stored archive plan.
- `change-finalization-transaction`: Require lossless cleaner ownership authority so recovery can safely resume on Windows and still fail closed when exact authority is unavailable.

## Impact

Implementation is owned by `src/core/archive-engine.ts`, with focused coverage in archive-engine, archive fault-matrix, and archive planning-recovery tests/helpers. The stored archive-plan shape gains exact cleaner authority for newly planned operations; no Store/management finalization, registry, or workspace-coordination behavior is included.
