## MODIFIED Requirements

### Requirement: Run-state reporting reads live run files without side effects
`GET /api/v1/runs` SHALL report, per active change of the selected planning space — selected by an optional `space` query selector, defaulting to the server's launch project when omitted — the pipeline run state read from `auto-run.json`, `goal-run.json`, and `portfolio-run.json` at their resolved locations per the `file-placement` capability's sticky-legacy chain (the execution root's ephemera directory first, then the machine-home work directory, then the change directory as legacy fallbacks), the machine home being the selected space's own home when it has one. Resolution SHALL be non-mutating: a request never creates directories, registry entries, or project identity. Each run file SHALL be reported as parsed content when valid, as invalid-with-reason when present but unparseable, or as absent — and a failure while reading one change SHALL degrade to an error entry for that change rather than failing the whole response.

#### Scenario: Active run reported
- **WHEN** a change has a valid `auto-run.json` in its resolved run-state location
- **THEN** the response includes that change with its pipeline name and per-stage statuses

#### Scenario: Invalid run file surfaced
- **WHEN** a change's `auto-run.json` exists but fails parsing or schema validation
- **THEN** the response marks that change's run state as invalid and includes a human-readable reason, and the overall request still succeeds

#### Scenario: No run state
- **WHEN** a change has no run-state files in any resolved location of the chain
- **THEN** the response reports that change's runs as absent

#### Scenario: Read-only resolution for unregistered projects
- **WHEN** runs are requested for a space that has no machine-home registration
- **THEN** the server answers from the locations that need no identity — the execution root's ephemera directory and the change directory — and creates no registry entry, identity, or directory as a side effect

#### Scenario: Runs reported for an explicitly selected space
- **WHEN** a client sends `GET /api/v1/runs?space=project:<id>` for a registered project other than the launch project
- **THEN** the run-state entries are resolved against that project's changes and its machine home, not the launch project's
