## ADDED Requirements

### Requirement: An Oh My Pi session's context occupancy is measurable

Rasen SHALL report context-window occupancy for an Oh My Pi session, so a session running in that harness receives the same occupancy answer, in the same reported fields, that a Claude Code or Codex session receives. The measurement SHALL be taken from the figures the session itself recorded for its most recent assistant turn, so the number describes this conversation rather than an estimate.

#### Scenario: Occupancy is reported for an Oh My Pi session

- **WHEN** context occupancy is requested for an Oh My Pi session that has at least one completed assistant turn
- **THEN** Rasen SHALL report the runtime as `omp`, the model the turn ran on, the occupied tokens, the context-window limit, the occupied fraction, and the remaining tokens
- **AND** SHALL identify the session file the reading came from

#### Scenario: Occupied tokens exclude what the turn produced

- **WHEN** occupancy is computed for an Oh My Pi session
- **THEN** the occupied token count SHALL comprise only the figures describing what was sent to the model for that turn, including cached input
- **AND** SHALL NOT include the tokens the model produced in that turn, so the figure is directly comparable with the count reported for other harnesses

#### Scenario: A session with no completed assistant turn is refused, not zeroed

- **WHEN** occupancy is requested for an Oh My Pi session file that records no completed assistant turn
- **THEN** Rasen SHALL refuse with an actionable message naming the file
- **AND** SHALL NOT report a zero occupancy

### Requirement: The live Oh My Pi session is located across every session layout the harness has written

Oh My Pi groups a project's sessions into a per-directory bucket, and has written more than one bucket naming layout over time; a machine can hold sessions for one working directory under several of them at once, with the newest session in any of them. Rasen SHALL locate the newest Oh My Pi session for a working directory by considering every bucket present and confirming each candidate against the working directory the session itself recorded, so the reading always describes the newest session for that directory rather than the newest one in a single assumed location.

#### Scenario: The newest session wins across bucket layouts

- **GIVEN** a working directory has Oh My Pi sessions under more than one bucket naming layout
- **AND** the newest session sits in a layout other than the one a current-layout name would produce
- **WHEN** the live session is located for that working directory
- **THEN** Rasen SHALL select that newest session
- **AND** SHALL NOT select an older session from another layout

#### Scenario: Another directory's session is never selected

- **GIVEN** sessions exist for working directories other than the requested one
- **WHEN** the live session is located
- **THEN** only sessions recording the requested working directory SHALL be eligible
- **AND** a session recording a different working directory SHALL NOT be selected

#### Scenario: Absence is reported as absence

- **WHEN** no Oh My Pi session exists for the requested working directory
- **THEN** Rasen SHALL report the same environmental-absence result it reports for a harness with no session yet
- **AND** SHALL NOT fail with an unexpected error

#### Scenario: A relocated agent directory and a named profile are honored

- **WHEN** the user has relocated Oh My Pi's agent directory, or is running a named Oh My Pi profile
- **THEN** session location SHALL search that agent directory's sessions
- **AND** SHALL NOT search the default location instead

### Requirement: An unknown context window is reported as unknown

A percentage computed against a substituted window size is indistinguishable from a correct one. When an Oh My Pi session's model has no context-window size Rasen knows, Rasen SHALL report the window as unknown rather than substituting a default, so a consumer can tell that no fraction is available.

#### Scenario: Unknown model reports no fabricated window

- **WHEN** occupancy is reported for an Oh My Pi session whose model has no known context-window size
- **THEN** the reported limit SHALL indicate that no window is known
- **AND** the occupied fraction SHALL NOT be computed against a substituted size
- **AND** the occupied token count SHALL still be reported

#### Scenario: A known model reports its own window

- **WHEN** occupancy is reported for an Oh My Pi session whose model has a known context-window size
- **THEN** that size SHALL be the reported limit
- **AND** the occupied fraction SHALL be computed against it

#### Scenario: An explicit limit always wins

- **WHEN** the caller supplies an explicit context-window limit
- **THEN** that limit SHALL be used regardless of whether the model's window is known
