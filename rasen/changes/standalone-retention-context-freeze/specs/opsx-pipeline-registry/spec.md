## MODIFIED Requirements

### Requirement: Resume distinguishes invalid run-state from absent run-state

`rasen pipeline resume` SHALL report a located-but-unparseable `auto-run.json` (malformed JSON, or schema validation failure after normalization) distinctly from the no-file case, so the failure is diagnosable instead of masquerading as "no run-state found". The JSON output SHALL keep `hasRunState: false` for both cases (additive compatibility) and, for the invalid case, SHALL additionally carry `invalidRunState: true`, the file path, and a note naming the validation reason.

For the no-file case, the output SHALL additionally report the deterministic directory where run-state for that change would live, so a caller can see the location without deriving it, matching the existing invalid case which already reports a location alongside `hasRunState: false`.

#### Scenario: Invalid run-state file is reported with its reason
- **WHEN** `rasen pipeline resume <change> --json` locates an `auto-run.json` (via the ephemera-first sticky-legacy chain) that fails to parse even after host-tolerance normalization
- **THEN** the output SHALL report `hasRunState: false` and `invalidRunState: true`
- **AND** SHALL name the file path and the parse/validation reason in the note

#### Scenario: Absent run-state keeps its existing shape and reports where state would live
- **WHEN** `rasen pipeline resume <change> --json` finds no `auto-run.json` in any location of the chain
- **THEN** the output SHALL report `hasRunState: false` without `invalidRunState`, with the existing "no run-state" note
- **AND** SHALL additionally report the deterministic directory where run-state for that change would be created
- **AND** the reported directory SHALL be the same location a later run would write to

### Requirement: Host-tolerant run-state parsing
Run-state parsing SHALL be host-runtime-neutral: before schema validation, `parseRunState` SHALL normalize worker records (per-stage workers and the portfolio planner record, which share the worker shape) so legitimate variance from a non-Claude LEAD does not reject the file. Normalization SHALL: (1) treat a JSON `null` on an optional string field of the worker record (e.g. `transcript`, `agentId`, `threadId`) as the field being absent, removing the key; (2) when `runtime` carries a string outside `claude|codex`, preserve the original value under the passthrough key `runtimeRaw` and remove `runtime`, rather than rejecting the record or coercing the value to a runtime the worker did not use. The canonical write contract SHALL remain strict: `writeRunState` continues to validate against the unwidened schema. Writing run-state SHALL additionally be crash-safe, so an interrupted write leaves either the previous complete content or the complete new content and never a partially written file.

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

#### Scenario: An interrupted write leaves no torn file
- **WHEN** a run-state write is interrupted before it completes
- **THEN** the stored run-state SHALL be either the previous complete content or the new complete content
- **AND** SHALL NOT be a partially written file that a later read reports as invalid

## ADDED Requirements

### Requirement: A run may hold frozen knowledge identity without a pipeline

Run-state SHALL be able to carry a frozen knowledge identity for a change that is not assigned to a pipeline, so a completed change that never ran through a classified pipeline can hold durable retention identity without claiming a pipeline it never ran. `rasen pipeline resume` SHALL report such a change as having run-state while reporting no pipeline and no next stage, distinctly from both the no-file case and the invalid-file case. Rasen SHALL NOT invent, load, or validate a pipeline for a change whose run-state names none.

Every run-state file that is valid before this capability SHALL remain valid and SHALL be reported unchanged.

#### Scenario: Run-state without a pipeline is reported as present

- **WHEN** `rasen pipeline resume <change> --json` reads a run-state that carries a frozen knowledge identity and names no pipeline
- **THEN** the output SHALL report run-state as present
- **AND** SHALL report no pipeline and no next stage
- **AND** SHALL report the frozen knowledge identity and the directory it was read from
- **AND** SHALL NOT report the change as having no run-state

#### Scenario: No pipeline is resolved for a pipeline-less run-state

- **WHEN** a run-state names no pipeline
- **THEN** Rasen SHALL NOT attempt to load a pipeline definition for it
- **AND** SHALL NOT fail because no pipeline definition matches

#### Scenario: Existing run-state files are unaffected

- **WHEN** a run-state file that was valid before this capability is read
- **THEN** it SHALL parse and be reported exactly as it was before
- **AND** its recorded pipeline, stages, and any recorded knowledge context SHALL be unchanged
