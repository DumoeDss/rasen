## MODIFIED Requirements

### Requirement: Changes listing matches the workflow's active-change definition
`GET /api/v1/changes` SHALL list the active changes of the selected planning space — selected by an optional `space` query selector (per the planning-space-addressing capability), defaulting to the server's launch project when omitted — with, per change: name, schema name, per-artifact status (done / ready / blocked), whether all apply-required artifacts are complete, and task progress (total and completed counts). Change enumeration SHALL use `getActiveChangeIds` — the same source of truth as `rasen status`, `validate`, `archive`, and the instruction loader — which requires a `proposal.md` in the change directory. Per-change status SHALL be derived from the same core status logic those commands use, so the listing agrees with `rasen status` for the same root, whether that root is a project or a store.

This definition is intentionally narrower than `rasen list`, whose bare directory scan also reports change directories that hold only planning documents and that no workflow command can act on. The endpoint SHALL NOT be widened to reproduce that scan; converging `rasen list` onto `getActiveChangeIds` is a recorded follow-up outside this change.

#### Scenario: Active changes listed with status
- **WHEN** a project has active changes with differing artifact and task completion
- **THEN** the response lists each active change with its schema name, artifact statuses, apply-readiness, and task counts matching what `rasen status` reports

#### Scenario: Archived changes excluded
- **WHEN** a project has archived changes alongside active ones
- **THEN** only active changes appear in the listing

#### Scenario: Directory without a proposal excluded
- **WHEN** a directory under `rasen/changes/` contains planning documents but no `proposal.md`
- **THEN** it is absent from the listing, matching `rasen status` rather than `rasen list`

#### Scenario: No project resolvable
- **WHEN** the server was launched outside any Rasen project and no space selector is provided
- **THEN** the endpoint responds with an error envelope indicating no project is available, not an empty success

#### Scenario: Changes listed for an explicitly selected space
- **WHEN** a client sends `GET /api/v1/changes?space=store:<id>` for a healthy registered store while the daemon was launched in an unrelated project
- **THEN** the listing reports the store's active changes, matching what `rasen status --store <id>` reports

### Requirement: Run-state reporting reads live run files without side effects
`GET /api/v1/runs` SHALL report, per active change of the selected planning space — selected by an optional `space` query selector, defaulting to the server's launch project when omitted — the pipeline run state read from `auto-run.json`, `goal-run.json`, and `portfolio-run.json` at their resolved locations (machine-home work directory first, change directory as legacy fallback), the machine home being the selected space's own home when it has one. Resolution SHALL be non-mutating: a request never creates directories, registry entries, or project identity. Each run file SHALL be reported as parsed content when valid, as invalid-with-reason when present but unparseable, or as absent — and a failure while reading one change SHALL degrade to an error entry for that change rather than failing the whole response.

#### Scenario: Active run reported
- **WHEN** a change has a valid `auto-run.json` in its work directory
- **THEN** the response includes that change with its pipeline name and per-stage statuses

#### Scenario: Invalid run file surfaced
- **WHEN** a change's `auto-run.json` exists but fails parsing or schema validation
- **THEN** the response marks that change's run state as invalid and includes a human-readable reason, and the overall request still succeeds

#### Scenario: No run state
- **WHEN** a change has no run-state files in either resolved location
- **THEN** the response reports that change's runs as absent

#### Scenario: Read-only resolution for unregistered projects
- **WHEN** runs are requested for a space that has no machine-home registration
- **THEN** the server answers using only legacy change-directory locations and creates no registry entry, identity, or directory as a side effect

#### Scenario: Runs reported for an explicitly selected space
- **WHEN** a client sends `GET /api/v1/runs?space=project:<id>` for a registered project other than the launch project
- **THEN** the run-state entries are resolved against that project's changes and its machine home, not the launch project's

## ADDED Requirements

### Requirement: The spaces listing is a management endpoint under the same security posture
`GET /api/v1/spaces` SHALL be served by the management server as a GET-only management endpoint with the same loopback bind, bearer-token requirement, trailing-slash tolerance, and fresh-read posture as the other management paths; its content contract is defined by the planning-space-addressing capability.

#### Scenario: Spaces requires the session token
- **WHEN** a client sends `GET /api/v1/spaces` without a valid bearer token
- **THEN** the response is 401 with the `unauthorized` error envelope

#### Scenario: Non-GET rejected
- **WHEN** a client sends POST, PUT, or DELETE to `/api/v1/spaces`
- **THEN** the response is 405 `method_not_allowed` and no file is modified
