## MODIFIED Requirements

### Requirement: Run-state reporting reads live run files without side effects

`GET /api/v1/runs` SHALL report, per active Change of the selected planning
space — selected by an optional `space` query selector, defaulting to the
server's launch project when omitted — both legacy pipeline state and
reconciler Run summaries. Legacy `auto-run.json`, `goal-run.json`, and
`portfolio-run.json` SHALL retain their existing work-directory-first,
Change-directory-fallback resolution and valid/invalid/absent wire shapes.
Reconciler summaries SHALL be derived from each Change's canonical machine-home
Run store through the shared Change-run projector and SHALL include exact Run
identity, frozen engine, status, Record version, and current waits or terminal
summary.
Discovery SHALL be the read-only union of active Change IDs and already
registered machine-home Change work directories that physically contain
change-runs. Archived/missing-source Runs SHALL remain discoverable without a
second writable index.
Default summaries SHALL be filtered to the WorkspaceInstanceId of the selected
project root, stable-sorted, and cursor-paginated within fixed
candidate/byte/work budgets.

Resolution SHALL be non-mutating: a GET request never creates directories,
registry entries, project identity, plans, or Record revisions. The machine
home SHALL be the selected space's own home when one already exists. A failure
while reading one legacy file, canonical Run, or Change SHALL degrade to an
invalid/error entry for that item rather than failing the whole response.
The server launch root, `planning:<full-PlanningSpaceId>`, or a server-issued
opaque token SHALL select one exact entry/root. `project:<projectId>` SHALL be
accepted for reconciler data only when it maps to one registry home; duplicate
clone homes SHALL return `project_selector_ambiguous` and never select by
registry order.

#### Scenario: Active legacy run reported

- **WHEN** a Change has a valid `auto-run.json` in its work directory
- **THEN** the response includes that Change with its Pipeline name and per-stage statuses

#### Scenario: Active reconciler Run reported

- **WHEN** a Change has a valid canonical reconciler Run in its work directory
- **THEN** the response includes an engine-tagged summary from the canonical
  projector with its exact Run ID, status, Record version, and waits or terminal summary

#### Scenario: Invalid legacy run file surfaced

- **WHEN** a Change's `auto-run.json` exists but fails parsing or schema validation
- **THEN** the response marks that Change's legacy run state as invalid and
  includes a human-readable reason, and the overall request still succeeds

#### Scenario: Invalid canonical Run surfaced

- **WHEN** one canonical Run has an invalid plan or a corrupt, gapped,
  duplicate/variant, over-width, or abnormally named final Record ledger while
  another Run is valid
- **THEN** the response marks the entire invalid Run with its typed reason and
  still reports the valid summary
- **AND** it does not project an earlier Record revision as that invalid Run's
  current frontier

#### Scenario: Unsafe or oversized canonical Run is isolated

- **WHEN** one Run contains an oversized file/structure or a linked/reparse
  canonical component
- **THEN** the response reports that Run's typed corruption/path error without
  treating it as valid or hiding unrelated Runs

#### Scenario: Many Runs paginate deterministically

- **WHEN** candidates exceed one list page or physical-read budget
- **THEN** the response returns a stable opaque next cursor and bounded ordered
  summaries
- **AND** later healthy Runs remain reachable after an invalid item

#### Scenario: Linked worktree list is branch-local

- **WHEN** two linked worktrees share PlanningSpace storage but have distinct
  WorkspaceInstanceIds
- **THEN** each selected-space list includes only its current workspace Runs

#### Scenario: Archived in-flight Run remains listed

- **WHEN** archive moved/deleted the active Change while its canonical Action
  is incomplete or uncertain
- **THEN** the response includes the machine-home Run with archived/missing
  source state and creates no index/identity

#### Scenario: No run state

- **WHEN** a Change has no legacy run-state files and no canonical Runs in
  either resolved location
- **THEN** the response reports that Change's legacy files as absent and its
  reconciler Run list as empty

#### Scenario: Read-only resolution for unregistered projects

- **WHEN** Runs are requested for a space that has no machine-home registration
- **THEN** the server answers using only existing legacy Change-directory
  locations, reports no canonical Runs, and creates no registry entry, identity,
  or directory as a side effect

#### Scenario: Runs reported for an explicitly selected space

- **WHEN** a client sends `GET /api/v1/runs?space=project:<id>` for a registered
  project other than the launch project
- **THEN** both legacy and reconciler entries are resolved against that
  project's Changes and machine home, not the launch project's

#### Scenario: Duplicate project selector never chooses a clone

- **WHEN** two registered independent clones share projectId and a list,
  detail, or control request uses only `space=project:<id>`
- **THEN** the API returns `project_selector_ambiguous` with candidate
  PlanningSpaceIds, no mutation, and no CLI spawn for detail/control
- **AND** `space=planning:<full-id>` or an opaque exact selected-space token
  addresses only the chosen clone/root

## ADDED Requirements

### Requirement: Management API serves exact Change-run detail and control

The management API SHALL serve authenticated, space-scoped
`GET /api/v1/runs/<changeId>/<runId>` detail and
`POST /api/v1/runs/<changeId>/<runId>` control routes using exact
percent-decoded path segments. GET SHALL return the same canonical
`change-run-view/1` and `root-dag/1` section as CLI status without mutation.
POST SHALL accept only one typed control with an expected Record version and
exact WaitId when wait-scoped and SHALL perform the mutation
through the established CLI-backed bridge rather than writing workspace or
machine-home files inside the HTTP handler.
The bridge SHALL seal delivery mode to defer. Browser input SHALL NOT override
it, HTTP SHALL never return executable Action payloads, and downstream Actions
SHALL remain admitted_undelivered until trusted CLI resume first-claims them.

#### Scenario: Detail equals CLI status

- **WHEN** an authorized client and CLI status inspect the same exact Run
  without an intervening commit
- **THEN** the detail response's canonical view fields are deeply equal to CLI status JSON

#### Scenario: Archived exact detail remains reachable

- **WHEN** the source Change was moved/deleted after archive effect
- **THEN** exact detail resolves the registered machine-home Run and reports
  archived/missing source state without minting identity

#### Scenario: Other-worktree exact detail is read only

- **WHEN** an exact Run belongs to another WorkspaceInstanceId in the same
  PlanningSpace
- **THEN** GET marks `workspace.scope: other`, exposes no controls, and POST
  fails `workspace_scope_mismatch` without spawning

#### Scenario: Detail is read only

- **WHEN** a client GETs exact Run detail in an unregistered or read-only space
- **THEN** the handler creates no project identity, directory, plan, Record, or lock file

#### Scenario: Control reaches the CLI-backed bridge

- **WHEN** an authorized client POSTs a valid allowed control and current
  expected Record version to exact Run detail
- **THEN** the server invokes the local CLI with structured exact identifiers
  and returns its JSON receipt
- **AND** the HTTP process does not patch the Record directly

#### Scenario: Gate control defers downstream delivery

- **WHEN** browser control advances a Gate and settles a downstream Action
- **THEN** POST returns only the committed view with empty action grants and
  ActionView delivery state admitted_undelivered
- **AND** trusted CLI resume later atomically grants the Action

#### Scenario: Browser response loss does not imply execution

- **WHEN** the deferred POST response is lost after commit and the client
  refetches or retries
- **THEN** no executable payload is returned and the Action remains safely
  first-claimable rather than being classified as already delivered

#### Scenario: Engine-owner conflict advances neither owner

- **WHEN** an active legacy artifact appears beside the canonical Run before a
  valid POST control reaches the CLI bridge
- **THEN** the bridge returns `engine_owner_conflict`
- **AND** no canonical or legacy progression is written

#### Scenario: Invalid control spawns nothing

- **WHEN** a control body is oversized, malformed, lacks an expected version,
  contains an unknown command, or names unsafe path data
- **THEN** the server rejects it before spawning and no Run state changes

#### Scenario: Wrong WaitId advances nothing

- **WHEN** a valid-version POST names a closed or different active WaitId
- **THEN** the bridge returns the typed wait identity conflict and no branch
  advances

#### Scenario: Auth and methods remain closed

- **WHEN** an unauthenticated client accesses a Change-run route, or an
  authenticated client sends PUT or DELETE
- **THEN** the request receives the established unauthorized or
  `method_not_allowed` envelope and no handler mutation runs

#### Scenario: Deeper suffix is not a Run route

- **WHEN** a request appends another segment after `<changeId>/<runId>`
- **THEN** it falls through as an unknown management path rather than matching
  a broader Run identity

### Requirement: Management Pipeline detail reports analyzed engine support

Every management Pipeline detail consumed by Canvas SHALL include
`availableEngines` and
`reconcilerSupport { supported, reason, profileDigest }` from the same prepared
support analyzer used by CLI start/show. Legacy executionMode and
LEGACY_NORMALIZED remain additive compatibility fields and SHALL NOT imply
reconciler support.

#### Scenario: CLI and Canvas support agree

- **WHEN** one Pipeline is inspected through CLI show, management detail, and
  Canvas without intervening source/config changes
- **THEN** all three report deeply equal availableEngines/reconcilerSupport
- **AND** an unsupported Pipeline cannot be started through any surface
