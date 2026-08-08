## MODIFIED Requirements

### Requirement: Loopback and bearer security across the CLI-backed mutation surface

The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, `POST /api/v1/changes`, the sessions route group (`POST /api/v1/sessions`, `GET /api/v1/sessions`, `GET /api/v1/sessions/:id`, `DELETE /api/v1/sessions/:id`), the Store change-finalization path (`POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize`), and the Store aggregate route family (`GET /api/v1/stores/:storeUid/issues`, `GET /api/v1/stores/:storeUid/issues/:issueId`, `GET /api/v1/stores/:storeUid/issues/:issueId/plans/:revisionId`, `GET /api/v1/stores/:storeUid/projects`, `GET /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes`, `POST /api/v1/stores/:storeUid/issues`, `POST /api/v1/stores/:storeUid/issues/:issueId/plans`, and `POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes`), bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. The server SHALL never write workspace files itself: every endpoint that mutates a workspace, creates planning state, or modifies a user-wide library — `POST /api/v1/changes` (change submission), `POST /api/v1/sessions` (session launch), `POST /api/v1/spaces` (space creation), `POST /api/v1/workflows` (workflow library mutation), `POST /api/v1/pipelines` (pipeline library mutation), the Store change-finalization path (change finalization), the Store Issue paths (Issue creation and Execution Plan revision publication), and the Store scoped change-creation path — SHALL mutate exclusively by spawning the existing CLI as a subprocess under its capability's admission whitelist. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file; DELETE SHALL be admitted only on `/api/v1/sessions/:id`. Every read response SHALL be computed from a fresh filesystem read at request time, except session listings, whose process facts come from the live in-memory registry (their joined run-state is still read fresh from disk). Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; `/api/v1/sessions/:id` SHALL match exactly one additional path segment, and deeper suffixes are not management paths and fall through to the rest of the server's routing.

#### Scenario: Authorized status request

- **WHEN** a client sends `GET /api/v1/status` with the session bearer token
- **THEN** the server responds 200 with JSON containing the CLI version, the server process id, and the launch project reference (or null outside a project)

#### Scenario: Missing or invalid token

- **WHEN** a client sends any `/api/v1/*` request without a valid bearer token
- **THEN** the server responds 401 with the error envelope `{ error: { code: "unauthorized" } }`

#### Scenario: Unadmitted write methods rejected
- **WHEN** a client sends PUT to any management endpoint, DELETE to a non-sessions management endpoint, or POST to `/api/v1/status` or `/api/v1/runs`
- **THEN** the server responds 405 with error code `method_not_allowed` and does not modify any file

#### Scenario: Every mutating endpoint routes through a CLI subprocess

- **WHEN** any admitted mutating request (`POST /api/v1/changes`, `POST /api/v1/sessions`, `POST /api/v1/spaces`, `POST /api/v1/workflows`, `POST /api/v1/pipelines`, the Store change-finalization path, a Store Issue path, or the Store scoped change-creation path) is fulfilled
- **THEN** the mutation is performed by a spawned CLI subprocess and the server process itself writes no workspace or library file

#### Scenario: Sessions endpoints share the write security posture
- **WHEN** a client sends an unauthenticated request to any sessions endpoint, or inspects any sessions response for CORS headers
- **THEN** the unauthenticated request is rejected 401 spawning and signalling nothing, and no sessions response carries an `Access-Control-Allow-Origin` header

#### Scenario: Fresh read on every request
- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

#### Scenario: Trailing slash tolerated on management paths
- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group

#### Scenario: Session id paths route to the sessions group only one segment deep
- **WHEN** a client addresses `/api/v1/sessions/<id>` versus `/api/v1/sessions/<id>/extra`
- **THEN** the single-segment form is handled by the sessions route group and the deeper form falls through to the rest of the server's routing

## ADDED Requirements

### Requirement: The Store aggregate paths serve Issue, project, and grouped-change reads

The Store aggregate read family SHALL report a Store's Issues, one Issue with its latest Execution Plan revision, one addressed revision, the Store's project and target-line rollup, and one project-and-line group of Changes. `:storeUid` SHALL be resolved as the Store's stable identity and SHALL NOT be interpreted as the local Store id carried by a `store:<id>` space selector; a UID resolving to no registered Store SHALL be rejected. Every response SHALL carry the query module's per-node states, its unsearched-ref list, and its completeness flag unchanged, so a partial answer is visible to the client. Absolute paths in a response SHALL be inert local locators. These paths SHALL be reads: no admitted read SHALL create, modify, or delete any file, and their content SHALL equal the corresponding CLI `--json` output for the same inputs.

#### Scenario: A partial aggregate is reported as partial

- **WHEN** one of the Store's target-line refs cannot be read while an aggregate read is served
- **THEN** the response SHALL list that ref as unsearched and report completeness as false
- **AND** no reference SHALL be reported as unresolved on the strength of that ref being unreadable

#### Scenario: The Store is addressed by stable identity

- **WHEN** a client sends a Store aggregate request whose `:storeUid` is a local Store id rather than the Store's stable identity, or a UID no registered Store carries
- **THEN** the server SHALL reject the request
- **AND** it SHALL NOT fall back to the launch project, a recent space, or the only registered Store

#### Scenario: API and CLI report the same aggregate

- **WHEN** the same Store, filters, and Issue are addressed through the aggregate API and through the CLI's JSON output
- **THEN** the two SHALL carry identical grouping, entry facts, node states, unsearched refs, and completeness

### Requirement: A Store-scoped project mutation requires its complete scope and never infers one

A project mutation reached through the Store route family SHALL carry its complete scope — Store, project, and stable target line — in the path, and SHALL carry the rest of its intent in the body. The server SHALL NOT complete a missing or ambiguous scope segment from a query filter, a session, the launch project, a recently viewed selection, or the Store's only project, and SHALL reject the request instead. It SHALL reject a project or target line the Store's own catalogs do not declare, before spawning any subprocess and before touching any file. A Store-level Issue mutation SHALL require the Store and SHALL NOT require a project or a target line, so the rule is that the scope an operation needs is complete rather than that a project is always named. A refused mutation SHALL surface the CLI's diagnostic code unchanged.

#### Scenario: A missing scope segment is rejected, not filled in

- **WHEN** a project mutation request omits the project or the target line while the client has both as an active board filter
- **THEN** the server SHALL reject the request
- **AND** no scope segment SHALL be taken from the filter, the session, the launch project, or a previous selection

#### Scenario: An undeclared project or line is refused before any spawn

- **WHEN** a scoped mutation names a project or target line for which the Store has no catalog
- **THEN** the server SHALL refuse naming the undeclared value
- **AND** no CLI subprocess SHALL be spawned and no file SHALL be modified

#### Scenario: A Store Issue mutation needs no project

- **WHEN** a client creates an Issue or publishes an Execution Plan revision with only the Store in the path
- **THEN** the request SHALL be admitted
- **AND** the server SHALL NOT require, infer, or invent a project or target line for it
