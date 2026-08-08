## MODIFIED Requirements

### Requirement: Sessions are observable while they run and after they end
The server SHALL maintain a Session registry holding, per Session: the server-minted Session id, kind, task, process id, lifecycle state (starting, running, exiting, exited), start time, last-output time, and — once ended — exit code or signal and a termination reason distinguishing normal exit, kill, overall timeout, no-output timeout, spawn error, and server shutdown. Existing one-shot Management Sessions MAY remain process-local, while hosted Sessions SHALL additionally persist their host state, backend Session id, process generation, current request state, and recovery/retirement diagnostics in the durable machine-local host registry. The agent CLI's own Session id SHALL be captured from its stream output when available as observability data, never as the Rasen registry key. `GET /api/v1/sessions` SHALL list compatible records from both lifecycles; for a Session launched with a `changeName`, the listing SHALL additionally join that change's on-disk run-state read-only, so process/host facts and pipeline facts are reported together without the server persisting pipeline state. `GET /api/v1/sessions/:id` SHALL return the record plus a bounded tail of recent output. Ended/retired hosted Sessions SHALL remain inspectable under bounded retention so a consumer observes terminal state without racing exit or daemon restart.

#### Scenario: Live session appears in the listing
- **WHEN** a one-shot or hosted Session is running and a client sends `GET /api/v1/sessions`
- **THEN** the response includes that Session with its id, kind, compatible state, process id when live, start time, and last-output time

#### Scenario: Hosted lifecycle facts are additive
- **WHEN** the listing contains a hosted Session
- **THEN** the existing Session fields retain their prior meanings and the response additionally reports host state, backend identity, generation, and recovery facts without requiring an existing client to send new request fields

#### Scenario: Run-state joined for a targeted change
- **WHEN** a Session was launched with a `changeName` whose change has an `auto-run.json` on disk
- **THEN** the sessions listing reports that Session together with the change's run-state, read fresh from disk without any write side effects

#### Scenario: Ended session remains observable
- **WHEN** a Session ends or retires and a client lists Sessions afterwards
- **THEN** the Session appears with compatible state `exited`, its exit/retirement facts, and its termination or retirement reason

#### Scenario: Hosted session survives registry reconstruction
- **WHEN** the Management server restarts after a hosted Session was recorded
- **THEN** list/detail reconstruct its durable host lifecycle and do not invent canonical Run state from it

#### Scenario: Unknown session id
- **WHEN** a client requests `GET /api/v1/sessions/:id` or `DELETE /api/v1/sessions/:id` with an id absent from both compatible registry lifecycles
- **THEN** the server responds 404

### Requirement: The server remains a reader and launcher — never a second source of truth
All durable pipeline and workspace state produced by a supervised Session SHALL be written by the spawned agent side only (run-state files, change artifacts, workspace files). The server MAY persist owner-restricted hosted Session lifecycle facts needed for single-flight, restart, recovery, and retirement, but those records SHALL contain no prompt/result body, executable Action, completion claim, canonical Run/Record state, EvidenceStore claim, credential, or signing private key. The server SHALL NOT write workspace files or run-state files. Restarting the server SHALL preserve hosted lifecycle projections and pipeline truth independently: on-disk run-state remains authoritative through existing run-state endpoints, and the Session registry never upgrades its own lifecycle facts into execution truth.

#### Scenario: Session activity writes no server-side persistent state
- **WHEN** a Session is created, runs, is cancelled, restarted, or retired
- **THEN** the server persists only owner-restricted hosted-Session lifecycle bookkeeping (live identity, owner, lifecycle state, process generation, request-state metadata, and recovery/retirement diagnostics) in the machine-local host registry, and writes no server-side persistent copy of session-activity content or completion truth — prompt/result bodies, canonical Run/Record state, and EvidenceStore claims remain agent-side only

#### Scenario: Hosted lifecycle bookkeeping is owner-restricted and activity-free
- **WHEN** a hosted Session is prepared, owned, retired, or reconciled on daemon restart
- **THEN** the machine-local host registry accepts only owner-restricted lifecycle keys and refuses prompt/result bodies, executable Actions, completion claims, credentials, or signing material, so the server stays a reader and launcher rather than a second source of execution truth

#### Scenario: Pipeline truth survives the registry
- **WHEN** the server restarts after a Session wrote run-state to disk
- **THEN** `GET /api/v1/runs` reports that run-state from its canonical storage independently of whether the hosted lifecycle is idle, interrupted, failed, or retired

#### Scenario: Host lifecycle cannot complete a run
- **WHEN** the host records a successful backend turn
- **THEN** no Run action, Record phase, gate, review verdict, or trusted completion changes until an authoritative execution path separately validates and commits it
