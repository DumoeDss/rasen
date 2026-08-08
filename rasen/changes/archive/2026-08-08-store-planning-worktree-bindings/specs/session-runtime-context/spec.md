## ADDED Requirements

### Requirement: A Store session freezes its complete planning and execution worktree pair

A session that plans in a Store and executes in a project checkout SHALL freeze the complete pair, not just the two roots: each side's worktree root, its worktree instance identity, its checked-out ref, and its HEAD commit OID, together with the Change instance and workspace pair identities when the workspace is bound. Facts that do not exist SHALL be absent rather than null or guessed, and a planning-only session SHALL record no pair. A command inside the session SHALL use the frozen pair and SHALL NOT re-derive it from the working directory. When a recorded worktree has been removed, moved, or switched to another ref, the command SHALL fail naming the frozen and live values rather than continuing in whatever the working directory resolves to. A mutation that requires the pair SHALL fail when the session records none. The frozen pair SHALL remain machine-local, SHALL NOT be written into any Git-tracked file, and SHALL be removed when the session ends. The context file version SHALL be raised so that a file written by an earlier version is reported as an unsupported version rather than read partially.

#### Scenario: The pair is frozen once and reused

- **WHEN** a session starts against a bound workspace and several commands run inside it
- **THEN** each command SHALL use the frozen planning and execution worktrees, their instance identities, and the pair identity
- **AND** none of them SHALL re-derive the pair from the working directory

#### Scenario: A planning-only session records no pair

- **WHEN** a session plans in a Store and works on no project
- **THEN** the context SHALL record no workspace pair as an explicit state
- **AND** a mutation requiring the pair SHALL fail rather than resolving one from the working directory

#### Scenario: A worktree that moved fails the command

- **WHEN** a recorded worktree is removed, relocated, or switched to another ref while the session is live
- **THEN** the next command SHALL fail, naming the frozen values and the live ones
- **AND** it SHALL NOT continue in another checkout of the same project or in the Store integration checkout

#### Scenario: An older context file is reported, not partially read

- **WHEN** a session context file written by an earlier version is read by a build that freezes the pair
- **THEN** the reader SHALL report an unsupported context version and what to do about it
- **AND** it SHALL NOT parse a subset of the file or fall back to deriving the context from the working directory

#### Scenario: Nothing about the pair reaches Git

- **WHEN** a session freezes its worktree pair
- **THEN** no file tracked by the project's or the Store's repository SHALL be created or modified
- **AND** the frozen pair SHALL exist only in machine-local state and SHALL be removed when the session ends
