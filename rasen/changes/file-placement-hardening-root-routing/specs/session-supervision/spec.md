## MODIFIED Requirements

### Requirement: Session listing is filterable by space and joins run state per session's own space

`GET /api/v1/sessions` SHALL accept an optional `space` selector; when present,
only sessions whose recorded space is that space are returned (unattributed
sessions appear only in the unfiltered listing). Each listed session's
run-state join SHALL keep planning metadata under the session's frozen recorded
space while reading terminal state only through its frozen recorded execution
context: the execution root's ephemera directory first, then the machine-home
work directory owned by that execution root, then the planning change
directory as the oldest sticky-legacy location. The listing SHALL NOT resolve
terminal state against the server launch project, substitute the planning root
for a missing execution root, or re-resolve a recorded execution selector from
current Store membership. A session without a usable recorded project
execution context SHALL report `runState: { kind: "absent" }` without write
side effects.

#### Scenario: Filtered listing returns only the space's sessions

- **WHEN** sessions exist in spaces A and B and a client sends
  `GET /api/v1/sessions?space=<selector for A>`
- **THEN** only the sessions recorded in space A are returned

#### Scenario: Unfiltered listing keeps today's behavior

- **WHEN** a client sends `GET /api/v1/sessions` with no space selector
- **THEN** every session the supervisor knows is returned, including
  unattributed ones

#### Scenario: Store session joins member ephemera

- **WHEN** a session plans change `feature` in a Store and its frozen execution
  context names member worktree B
- **THEN** its run-state join SHALL read
  `<worktree-b>/.rasen/changes/feature/ephemera/` before legacy locations
- **AND** SHALL NOT read the Store's ephemera directory or another member
  worktree's ephemera directory

#### Scenario: Legacy machine home follows the execution owner

- **WHEN** Store planning and member execution have different roots and
  run-state exists only in the member execution root's legacy machine-home work
  directory
- **THEN** the session listing SHALL report that run-state
- **AND** SHALL NOT resolve machine-home ownership from the Store planning root

#### Scenario: Frozen execution survives later Store changes

- **WHEN** a running session's member registration, Store pointer, or current
  Store membership changes after launch while its recorded execution checkout
  remains available
- **THEN** the run-state join SHALL continue using the frozen execution root
- **AND** SHALL NOT retarget to a newly resolvable member

#### Scenario: Missing execution context fails closed

- **WHEN** a legacy or unattributed session record has a change and planning
  space but no recorded execution context
- **THEN** the listing SHALL report `runState: { kind: "absent" }`
- **AND** SHALL NOT inspect the planning root as an invented terminal root

#### Scenario: Planning-only execution has no terminal join

- **WHEN** a Store session records explicit planning-only execution
- **THEN** the listing SHALL report `runState: { kind: "absent" }`
- **AND** SHALL leave the Store planning root unchanged

#### Scenario: Removed execution checkout does not retarget

- **WHEN** a session's frozen execution checkout is no longer available
- **THEN** the listing SHALL report `runState: { kind: "absent" }`
- **AND** SHALL NOT fall back to the Store, server launch project, or another
  worktree as the terminal root
