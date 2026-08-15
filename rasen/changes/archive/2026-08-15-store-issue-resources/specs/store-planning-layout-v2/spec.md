## ADDED Requirements

### Requirement: Layout v2 addresses Store-level Issues and Execution Plan revisions

A Store declaring layout version 2 SHALL place cross-project Issue content at the Store level, with
each Issue's record, its narrative, and its Execution Plan revisions below that Issue's own location.
The Issue directory, the Issue record, the revisions directory, and one revision file SHALL each be
its own address, so no caller composes a filename onto a returned directory. These addresses SHALL be
Store-level: computing one SHALL require no project id and no target-line id, and supplying either
SHALL NOT change the result. Issue content SHALL NOT be a valid project-planning address, and no
project partition SHALL be a valid Issue address.

#### Scenario: Issue addresses need no project

- **WHEN** layout v2 resolves an Issue directory, its record, its revisions directory, and one revision
- **THEN** each address resolves below the Store's Issue location without a project or target-line input
- **AND** supplying a project or target line produces the same paths

#### Scenario: A revision file is addressed, not composed

- **WHEN** a caller needs one Execution Plan revision's file
- **THEN** it obtains that file's own address from the layout contract
- **AND** it does not append a filename to the revisions directory

#### Scenario: Issue content is not project-planning content

- **WHEN** an Issue address and a project partition address are computed in one Store
- **THEN** the Issue address resolves below the Store-level Issue location
- **AND** no project partition path resolves to Issue content and no Issue path resolves to project-planning content

#### Scenario: Issue addresses obey the same platform semantics

- **WHEN** Issue addresses are computed under Windows semantics and under POSIX semantics
- **THEN** each matches expectations built with the matching platform path API
- **AND** every result remains contained by the Store root

### Requirement: Issue and Execution Plan revision identifiers are portable canonical segments

An Issue identifier SHALL satisfy the same portable canonical path-segment contract a v2 project
identifier satisfies: empty values, current- and parent-directory names, either path separator,
control characters, a trailing dot or space, Windows reserved device names, and non-canonical case
SHALL be rejected on every platform, and an invalid value SHALL never be sanitized into a different
identifier. An Execution Plan revision identifier SHALL be a canonical zero-padded decimal ordinal of
fixed width; an unpadded value, a differently padded spelling of the same number, and a zero ordinal
SHALL be rejected. Neither identifier SHALL be derived from a Git branch name, a date, a title, or
directory listing order.

#### Scenario: Traversal and device names are rejected everywhere

- **WHEN** an Issue identifier is a parent-directory name, contains a path separator, or is a Windows device name such as `con`
- **THEN** validation rejects it on Windows, macOS, and Linux alike
- **AND** no replacement segment is returned

#### Scenario: Case aliases cannot collide on a case-insensitive filesystem

- **WHEN** an Issue identifier uses an uppercase or mixed-case spelling of an otherwise valid value
- **THEN** validation rejects the non-canonical spelling
- **AND** it cannot alias a lowercase Issue's location

#### Scenario: A revision ordinal must be canonical

- **WHEN** a revision identifier is unpadded, padded to another width, or a zero ordinal
- **THEN** validation rejects it without sanitizing it
- **AND** the rejected value does not address any existing revision
