## ADDED Requirements

### Requirement: Sessions carry a planning-space attribution derived from their working directory
Each supervised session SHALL record, at launch, the planning space its working directory belongs to, derived by the shared cwd→space rule of the planning-space-addressing capability: a repo with its own planning shape attributes to that project's space; a pointer repo attributes to the store its config names; a working directory with no derivable space leaves the session unattributed rather than failing the launch. The attribution SHALL be frozen on the record at launch time and reported on every session read (`{ type, id, root }`), so a session's space does not mutate retroactively if registries or pointers later change.

#### Scenario: Session launched in a pointer repo attributes to the store
- **WHEN** a session is launched with its working directory inside a repo whose config externalizes planning to registered store `team-store`
- **THEN** the session record reports space `store:team-store`

#### Scenario: Attribution survives later pointer changes
- **WHEN** a running session's repo changes its store pointer after the session started
- **THEN** the session's recorded space is unchanged

#### Scenario: Unattributable cwd does not block launch
- **WHEN** a session's working directory yields no derivable space
- **THEN** the session launches normally and its record carries no space attribution

### Requirement: Session launch accepts a space selector that sets the working directory
`POST /api/v1/sessions` SHALL accept an optional `space` selector (per the planning-space-addressing capability); the launched agent subprocess's working directory SHALL be the resolved space's planning root, and the session's space attribution SHALL equal the selected space. When no selector is given the launch project remains the working directory (compat); when neither a selector nor a launch project exists the launch SHALL be rejected with 409 `no_project` before any subprocess is spawned. An unresolvable selector SHALL reject the launch with the space resolution error and spawn nothing.

#### Scenario: Launch into an explicitly selected space
- **WHEN** a client launches a session with `space=project:<id>` for a registered project other than the daemon's launch project
- **THEN** the agent subprocess starts in that project's root and the session record reports that project as its space

#### Scenario: Unresolvable space spawns nothing
- **WHEN** a session launch carries a selector that does not resolve
- **THEN** the response is the space resolution error and no agent process is started

### Requirement: Session listing is filterable by space and joins run state per session's own space
`GET /api/v1/sessions` SHALL accept an optional `space` selector; when present, only sessions whose recorded space is that space are returned (unattributed sessions appear only in the unfiltered listing). Each listed session's run-state join SHALL resolve against the session's own recorded space — its root and that space's machine home — not against the server's launch project, so a session launched in one space never reports another space's run files.

#### Scenario: Filtered listing returns only the space's sessions
- **WHEN** sessions exist in spaces A and B and a client sends `GET /api/v1/sessions?space=<selector for A>`
- **THEN** only the sessions recorded in space A are returned

#### Scenario: Unfiltered listing keeps today's behavior
- **WHEN** a client sends `GET /api/v1/sessions` with no space selector
- **THEN** every session the supervisor knows is returned, including unattributed ones

#### Scenario: Run-state join follows the session's space
- **WHEN** a session with a `changeName` was launched in a space other than the launch project
- **THEN** its `runState` is read from that space's change directory and machine-home work directory, not the launch project's
