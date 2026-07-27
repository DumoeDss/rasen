## Why

Default `rasen agent audit` reports currently use only the first eight characters of the session id in their filename. Distinct Codex UUIDv7 sessions created close together can share that prefix, causing a later audit to silently overwrite an earlier session's report.

## What Changes

- Derive default audit report filenames from the report's canonical runtime and complete session identity so different sessions and runtimes receive different paths.
- Keep the default filename deterministic so rerunning an audit for the same canonical session updates that session's own report.
- Make generated filenames safe and bounded across Windows, macOS, and Linux, including unusual or long session identifiers.
- Preserve the existing explicit `--out <path>` override and leave existing saved reports untouched.
- Add focused regression coverage for colliding Codex UUIDv7 prefixes, repeat-audit stability, runtime separation, and explicit output paths.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent-audit`: Strengthen the default report-output contract so its filename deterministically identifies the canonical runtime and full session without collisions from shared id prefixes.

## Impact

- Affected implementation: `src/core/token-audit/audit.ts` default report path generation and report writing.
- Affected tests: focused token-audit path and runtime coverage under `test/core/token-audit/`.
- Affected user-visible behavior: newly generated default filenames in the machine-data `analytics` directory.
- No report schema, CLI option, dependency, or explicit `--out` behavior changes; existing analytics files remain readable and are not migrated or deleted.
