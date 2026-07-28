## MODIFIED Requirements

### Requirement: Status JSON action context
The status command SHALL expose action context that lets agents act without hardcoded filesystem assumptions. The action context SHALL state separately the roots where planning artifacts may be written, the roots where code may be written, and the roots that may only be read, together with the constraints the agent is expected to respect, and SHALL carry a version identifying which contract it is reporting. Planning write access SHALL name the planning directories rather than a whole repository root, and no user home directory SHALL appear in any of the three lists. When the change is being worked on inside a session that records a planning space and an execution project separately, the reported roots SHALL reflect that split rather than collapsing to a single editable root. A consumer reading the earlier single-list form SHALL keep working through a compatibility view that never grants a root the earlier form would not have granted for that same context.

#### Scenario: Repo-local action context
- **GIVEN** the change is repo-local
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** status JSON SHALL preserve existing artifact status behavior
- **AND** it SHALL report a repo-local planning home for agents that use action context
- **AND** the action context SHALL report the project's planning directories as its planning write roots and that same checkout as its code write root

#### Scenario: Store planning with project execution reports both roots
- **GIVEN** the change is planned in a Store while a project checkout is being worked on
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** the action context SHALL report the Store's planning directories as planning write roots and the selected checkout as the code write root
- **AND** no other member checkout of that Store SHALL appear in any write list

#### Scenario: Planning-only reports no code write root
- **GIVEN** the session plans in a Store and works on no project
- **WHEN** a user runs `rasen status --change <id> --json`
- **THEN** the action context SHALL report an empty set of code write roots
- **AND** it SHALL still report the Store's planning directories as planning write roots

#### Scenario: The compatibility view never widens access
- **WHEN** a consumer reads the earlier single-list form of the action context for any context shape
- **THEN** every root it receives SHALL be one the earlier form would also have granted
- **AND** a context that cannot be expressed in the earlier form without widening it SHALL report a version identifying the newer contract instead
