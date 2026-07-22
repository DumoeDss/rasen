# management-http-api Specification

## Purpose
Provide a loopback-bound, bearer-secured HTTP API exposing project status, active changes, and run state for the management UI, always computed fresh from disk — read-mostly, with exactly one CLI-backed write endpoint (`POST /api/v1/changes`) for change submission.
## Requirements
### Requirement: Loopback and bearer security with a single CLI-backed write endpoint
The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, and `POST /api/v1/changes`, bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. `POST /api/v1/changes` SHALL be the only mutating endpoint, and it SHALL mutate exclusively by spawning the existing CLI as a subprocess (per the change-submission capability) — the server itself never writes workspace files. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file. Every read response SHALL be computed from a fresh filesystem read at request time. Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; deeper suffixes are not management paths and fall through to the rest of the server's routing.

#### Scenario: Authorized status request
- **WHEN** a client sends `GET /api/v1/status` with the session bearer token
- **THEN** the server responds 200 with JSON containing the CLI version, the server process id, and the launch project reference (or null outside a project)

#### Scenario: Missing or invalid token
- **WHEN** a client sends any `/api/v1/*` request without a valid bearer token
- **THEN** the server responds 401 with the error envelope `{ error: { code: "unauthorized" } }`

#### Scenario: Unadmitted write methods rejected
- **WHEN** a client sends PUT or DELETE to any management endpoint, or POST to `/api/v1/status` or `/api/v1/runs`
- **THEN** the server responds 405 with error code `method_not_allowed` and does not modify any file

#### Scenario: Admitted write endpoint routes to the submission bridge
- **WHEN** a client sends an authorized `POST /api/v1/changes`
- **THEN** the request is handled by the CLI-backed submission bridge rather than rejected with 405

#### Scenario: Fresh read on every request
- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

#### Scenario: Trailing slash tolerated on management paths
- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group

### Requirement: Daemon identity headers on every management-server response
Every response from the management server SHALL carry the headers `x-rasen-daemon: <version>` and `x-rasen-pid: <pid>`, including error responses, static asset responses, and responses delegated to the config API route group, so a consumer can classify what is listening on a port by probing any path.

#### Scenario: Identity headers on a management endpoint
- **WHEN** a client requests `GET /api/v1/status`
- **THEN** the response includes `x-rasen-daemon` set to the CLI version and `x-rasen-pid` set to the server's process id

#### Scenario: Identity headers on delegated and unauthorized responses
- **WHEN** a client requests a config-API path or sends an unauthenticated request to the management server
- **THEN** the response still carries both `x-rasen-daemon` and `x-rasen-pid` headers

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

### Requirement: The spaces listing is a management endpoint under the same security posture
`GET /api/v1/spaces` SHALL be served by the management server as a GET-only management endpoint with the same loopback bind, bearer-token requirement, trailing-slash tolerance, and fresh-read posture as the other management paths; its content contract is defined by the planning-space-addressing capability.

#### Scenario: Spaces requires the session token
- **WHEN** a client sends `GET /api/v1/spaces` without a valid bearer token
- **THEN** the response is 401 with the `unauthorized` error envelope

#### Scenario: Non-GET rejected
- **WHEN** a client sends POST, PUT, or DELETE to `/api/v1/spaces`
- **THEN** the response is 405 `method_not_allowed` and no file is modified

### Requirement: Changes listing reports portfolio-container membership

`GET /api/v1/changes` SHALL report, per change, its portfolio-container membership as an optional additive fact so a client can group changes into Tasks without re-scanning the workspace. A change SHALL be reported as belonging to portfolio container `P` when `P` is the longest sibling change directory such that `P` contains a `planning-context.md` file and the change's name equals `P` or begins with `P` followed by a hyphen; a change with no such container SHALL carry no membership. This fact SHALL be derived read-only from the workspace filesystem — enumerating change directories and checking for `planning-context.md` — and SHALL create, mint, or modify no registry entry, identity, or directory. It SHALL be an additive field: a client that ignores it sees the same flat listing as before, and its absence on a change means the change is not part of any portfolio.

This requirement adds the membership fact only; it does not change which changes are enumerated (still `getActiveChangeIds`, requiring a `proposal.md`), so a portfolio container that holds only `planning-context.md` and no `proposal.md` is itself absent from the listing while its child changes each report it as their container.

#### Scenario: Child change reports its portfolio container

- **WHEN** the changes directory holds active changes `redesign-api` and `redesign-shell` alongside a directory `redesign/` containing a `planning-context.md` and no `proposal.md`
- **THEN** the listing includes `redesign-api` and `redesign-shell`, each reporting portfolio membership `redesign`, and does not include `redesign` itself as a change

#### Scenario: Bare change reports no membership

- **WHEN** an active change has no sibling container directory whose name is a prefix of its name and that holds a `planning-context.md`
- **THEN** the change is listed with no portfolio membership

#### Scenario: Longest matching container wins

- **WHEN** an active change's name would match more than one candidate container prefix each holding a `planning-context.md`
- **THEN** the change reports membership in the container with the longest matching name

#### Scenario: Membership derivation has no side effects

- **WHEN** the listing computes portfolio membership for a space
- **THEN** no registry file, project identity, or directory is created or modified as a side effect of answering the request

### Requirement: Task roster endpoint reports a Task's full active-and-archived membership

The management server SHALL expose a read-only endpoint that, given a Task id and a planning space, reports that Task's complete roster: its kind (portfolio or single-item), each constituent change with its lifecycle facts and task progress, whether each change is active or archived, and any declared per-child dependency hints. The endpoint SHALL be authenticated and space-addressed exactly like the changes listing — an explicit space selector resolves through the machine registries and an omitted selector falls back to the launch project — and SHALL be strictly read-only: it creates no directory, mints no identity, and writes no file. It SHALL report a portfolio Task even when every one of its children has been archived (and so none appear in the active changes listing), and SHALL report a Task-not-found result for an id that names no active, archived, or portfolio Task in the space.

#### Scenario: Portfolio roster includes active and archived children

- **WHEN** the endpoint is queried for a portfolio Task whose children are partly active and partly archived, within a resolvable space
- **THEN** it returns the Task as a portfolio kind with every child listed, each flagged active or archived, and each active child carrying its lifecycle facts and task progress

#### Scenario: Single-item Task returns its one change

- **WHEN** the endpoint is queried for a bare change that belongs to no portfolio
- **THEN** it returns the Task as a single-item kind whose sole child is that change, with its task progress and task items

#### Scenario: Dependency hints come from the recorded portfolio run

- **WHEN** a portfolio Task's recorded run state declares that a child depends on sibling children
- **THEN** the endpoint reports those dependency hints on that child; and when no run state is recorded it reports no dependencies without erroring

#### Scenario: Portfolio with only archived children is still reported

- **WHEN** the endpoint is queried for a portfolio container whose children have all been archived
- **THEN** it still returns the Task with its archived children rather than a not-found result

#### Scenario: Unknown Task id is a not-found result

- **WHEN** the endpoint is queried for an id that matches no active change, archived change, or portfolio container in the space
- **THEN** it responds with a not-found error and creates nothing

#### Scenario: The endpoint never writes

- **WHEN** the endpoint serves any request
- **THEN** it performs only reads — no change directory, run-state file, or identity is created or modified as a side effect

### Requirement: Archive listing endpoint reports a space's archived changes

The management server SHALL expose a read-only endpoint that, given a planning space, lists that space's archived changes — the same sticky-union of the in-repo archive directory and the project's machine-home archive that the workflow's archived-change enumeration reports. For each archived change it SHALL report the un-dated change name, the archive date, the portfolio container it belongs to (by the same longest-prefix container rule the changes listing uses), and its task-checkbox progress. The endpoint SHALL be authenticated and space-addressed exactly like the changes listing — an explicit space selector resolves through the machine registries and an omitted selector falls back to the launch project, with no resolvable project rejected the same way the changes listing rejects it — and SHALL be strictly read-only: it creates no directory, mints no identity, and writes no file. A space with no archived changes SHALL yield an empty listing, not an error.

#### Scenario: Archived changes listed with date and portfolio membership

- **WHEN** a client requests the archive listing for a space that has archived changes, some of which belong to a portfolio container
- **THEN** the response lists each archived change with its un-dated name, its archive date, its task-checkbox progress, and — for changes under a container — the container name, matching the workflow's archived-change enumeration

#### Scenario: Both archive locations are unioned

- **WHEN** a space has changes archived both in its in-repo archive directory and in its machine-home archive
- **THEN** the listing reports the union of both, de-duplicated by name, regardless of which destination the current config selects

#### Scenario: Empty archive yields an empty listing

- **WHEN** a client requests the archive listing for a space that has no archived changes
- **THEN** the response is an empty listing rather than an error

#### Scenario: Space addressing matches the changes listing

- **WHEN** the archive listing is requested with an explicit space selector, and separately with none
- **THEN** an explicit selector resolves the space through the machine registries and an omitted selector falls back to the launch project, identically to the changes listing, and an unresolvable space is rejected the same way

#### Scenario: The endpoint never writes

- **WHEN** the archive listing serves any request
- **THEN** it performs only reads — no change directory, archive entry, run-state file, or identity is created or modified as a side effect

