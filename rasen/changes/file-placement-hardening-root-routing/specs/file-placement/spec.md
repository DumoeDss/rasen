## ADDED Requirements

### Requirement: Placement consumers freeze one explicit root context

Placement consumers SHALL resolve one context at their authority boundary when
a command or read model can operate with different planning and execution
roots, and SHALL carry that
context unchanged to every placement consumer. The context SHALL identify the
planning root, execution root when one exists, legacy machine-home owner, and
explicit `win32` or `posix` path-identity flavor. Planning-owned paths SHALL
derive only from the planning root; terminal execution paths and legacy-home
lookup SHALL derive only from the execution context. A downstream consumer
SHALL treat unavailable execution authority as unavailable rather than infer a
replacement from the current working directory, planning root, Store
membership, or server launch root.

#### Scenario: Store migration carries both roots

- **WHEN** a migration plans in a Store and executes in a member worktree
- **THEN** every planning-owned destination SHALL derive from the frozen Store
  root
- **AND** every execution-owned destination and legacy-home lookup SHALL derive
  from the frozen member worktree root

#### Scenario: Consumer observes a frozen context

- **WHEN** current working directory, registration, or Store membership changes
  after a migration preview or session launch
- **THEN** downstream apply and read consumers SHALL continue using the context
  frozen at that authority boundary

#### Scenario: Missing execution authority is not guessed

- **WHEN** a terminal-state consumer receives planning context without a usable
  execution root
- **THEN** it SHALL report terminal state as unavailable or absent
- **AND** SHALL NOT inspect or write a guessed execution location

#### Scenario: Path flavor is deterministic on every host

- **WHEN** equivalent routing tests supply `win32` or `posix` identity flavor
  independent of the host operating system
- **THEN** path comparison SHALL follow the supplied flavor
- **AND** path construction SHALL use the corresponding platform path API or
  the native path module rather than string concatenation
