## ADDED Requirements

### Requirement: Layout v2 addresses Store-level Issues and Execution Plan revisions

A Store that declares layout version 2 SHALL place cross-project Issue content under `rasen/issues/<issueId>/`, with the Issue's record, its optional narrative, and its Execution Plan revisions under that directory's `plans/` subdirectory. Each of the Issue directory, the Issue record file, the revisions directory, and one revision file SHALL be its own layout address, so no caller joins a filename onto a returned directory. These addresses SHALL be Store-level: computing one SHALL require no project id and no target-line id, and supplying either SHALL NOT change the result. Issue content SHALL NOT be a valid project-planning address, and no project partition SHALL be a valid Issue address.

#### Scenario: Issue addresses need no project

- **WHEN** layout v2 resolves an Issue directory, its record, its revisions directory, and one revision
- **THEN** each address SHALL resolve below the Store's Issue directory without a project or target-line input
- **AND** supplying a project or target line SHALL produce the same paths

#### Scenario: A revision file is addressed, not composed

- **WHEN** a caller needs one Execution Plan revision's file
- **THEN** it SHALL obtain that file's own address from the layout contract
- **AND** it SHALL NOT append a filename to the revisions directory itself

#### Scenario: Issue content is not project-planning content

- **WHEN** an Issue address and a project partition address are computed in one Store
- **THEN** the Issue address SHALL resolve below the Store-level Issue directory
- **AND** no project partition path SHALL resolve to Issue content and no Issue path SHALL resolve to project-planning content

### Requirement: Issue and Execution Plan revision identifiers are portable canonical segments

An Issue identifier SHALL satisfy the same portable canonical path-segment contract a v2 project id satisfies: it SHALL reject empty values, `.`, `..`, path separators, control characters, trailing dot or space, Windows reserved device names, and non-canonical case on every platform, and validation SHALL never sanitize an invalid value into a different identifier. An Execution Plan revision identifier SHALL be a canonical zero-padded decimal ordinal of fixed width; an unpadded value, a non-canonical spelling of the same number, and a zero ordinal SHALL be rejected. Neither identifier SHALL be derived from a Git branch name, a date, a title, or directory listing order.

#### Scenario: Traversal and device names are rejected everywhere

- **WHEN** an Issue identifier is `..`, contains `/` or `\`, or is a Windows device name such as `con`
- **THEN** validation SHALL reject it on Windows, macOS, and Linux
- **AND** no replacement segment SHALL be returned

#### Scenario: Case aliases cannot collide on a case-insensitive filesystem

- **WHEN** an Issue identifier uses uppercase or mixed-case spelling of an otherwise valid value
- **THEN** validation SHALL reject the non-canonical spelling
- **AND** it SHALL NOT alias a lowercase Issue directory

#### Scenario: A revision ordinal must be canonical

- **WHEN** a revision identifier is unpadded, differently padded than the fixed width, or a zero ordinal
- **THEN** validation SHALL reject it without sanitizing it
- **AND** the rejected value SHALL NOT address an existing revision
