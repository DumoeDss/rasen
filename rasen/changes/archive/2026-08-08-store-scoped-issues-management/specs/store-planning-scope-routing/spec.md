## ADDED Requirements

### Requirement: A Store-level Issue operation is its own scope intent

Store-level Issue and Execution Plan operations SHALL declare a Store-level Issue intent, which resolves one Store from an explicit selector, a project binding, or the current Store checkout, and which SHALL require no project and no target line. Resolution SHALL NOT invent, infer, or demand either, and SHALL NOT resolve the bound planning worktree in place of the Store. The intent SHALL expose only Store-level Issue addresses. Opening this intent SHALL NOT confer project mutation authority: a project read or mutation attempted from it SHALL still require its own unambiguous project scope and SHALL fail with the existing project-authority diagnostics otherwise.

#### Scenario: An Issue intent resolves without a project

- **WHEN** an Issue operation opens a Store-level Issue scope with only a Store selector
- **THEN** resolution SHALL succeed with the Store frozen and no project or target-line fact
- **AND** it SHALL NOT report a missing project as an error and SHALL NOT invent one

#### Scenario: The intent grants no project authority

- **WHEN** a project mutation is attempted while holding a Store-level Issue scope
- **THEN** it SHALL fail with `project_scope_required`
- **AND** no project partition SHALL be created or modified

#### Scenario: An execution worktree reaches the Store, not its planning worktree

- **WHEN** an Issue operation runs in a project execution worktree whose verified binding names Store S
- **THEN** it SHALL resolve S as a Store-level Issue scope
- **AND** it SHALL NOT resolve the bound planning worktree as the write location
