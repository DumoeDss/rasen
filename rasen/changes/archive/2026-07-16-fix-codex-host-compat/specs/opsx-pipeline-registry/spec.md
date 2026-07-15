# opsx-pipeline-registry Delta

## ADDED Requirements

### Requirement: Host-tolerant run-state parsing
Run-state parsing SHALL be host-runtime-neutral: before schema validation, `parseRunState` SHALL normalize worker records (per-stage workers and the portfolio planner record, which share the worker shape) so legitimate variance from a non-Claude LEAD does not reject the file. Normalization SHALL: (1) treat a JSON `null` on an optional string field of the worker record (e.g. `transcript`, `agentId`, `threadId`) as the field being absent, removing the key; (2) when `runtime` carries a string outside `claude|codex`, preserve the original value under the passthrough key `runtimeRaw` and remove `runtime`, rather than rejecting the record or coercing the value to a runtime the worker did not use. The canonical write contract SHALL remain strict: `writeRunState` continues to validate against the unwidened schema.

#### Scenario: Codex-LEAD-written worker record parses
- **WHEN** `parseRunState` reads a run-state whose stage worker carries `"transcript": null` and `"runtime": "codex-host-fallback"`
- **THEN** parsing SHALL succeed
- **AND** the parsed worker SHALL have no `transcript` and no `runtime` field
- **AND** the parsed worker SHALL carry `runtimeRaw: "codex-host-fallback"`

#### Scenario: Canonical records are untouched
- **WHEN** `parseRunState` reads a run-state whose workers carry only canonical values (`runtime` in `claude|codex`, string `transcript`)
- **THEN** the parsed state SHALL be identical to today's parse (no `runtimeRaw`, no removed fields)

#### Scenario: Write contract stays strict
- **WHEN** `writeRunState` is given a state whose worker carries `transcript: null` or a non-enum `runtime`
- **THEN** it SHALL reject the state (validation error) — tolerance is a read-boundary property, not a license to write non-canonical values

### Requirement: Resume distinguishes invalid run-state from absent run-state
`rasen pipeline resume` SHALL report a located-but-unparseable `auto-run.json` (malformed JSON, or schema validation failure after normalization) distinctly from the no-file case, so the failure is diagnosable instead of masquerading as "no run-state found". The JSON output SHALL keep `hasRunState: false` for both cases (additive compatibility) and, for the invalid case, SHALL additionally carry `invalidRunState: true`, the file path, and a note naming the validation reason.

#### Scenario: Invalid run-state file is reported with its reason
- **WHEN** `rasen pipeline resume <change> --json` locates an `auto-run.json` (workDir-first, change-dir fallback) that fails to parse even after host-tolerance normalization
- **THEN** the output SHALL report `hasRunState: false` and `invalidRunState: true`
- **AND** SHALL name the file path and the parse/validation reason in the note

#### Scenario: Absent run-state is unchanged
- **WHEN** `rasen pipeline resume <change> --json` finds no `auto-run.json` in either location
- **THEN** the output SHALL report `hasRunState: false` without `invalidRunState`, with the existing "no run-state" note
