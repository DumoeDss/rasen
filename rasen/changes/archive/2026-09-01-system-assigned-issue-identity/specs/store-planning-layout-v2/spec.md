## MODIFIED Requirements

### Requirement: Layout v2 addresses Store-level Issues and Execution Plan revisions

A Store declaring layout version 2 SHALL place cross-project Issue content at the Store level, with
each Issue's record, its narrative, its Execution Plan revisions, its acceptance-conditions
revisions, and its acceptance record below that Issue's internal storage location. A newly created
Issue SHALL use its immutable lowercase UID as that location; a compatible version-1 Issue SHALL
continue using its existing legacy location. The Issue directory, the Issue record, the
plan-revisions directory, one plan-revision file, the acceptance-conditions directory, one
acceptance-conditions revision file, and the acceptance record SHALL each be its own address, so no
caller composes a filename onto a returned directory. These addresses SHALL be Store-level:
computing one SHALL require no project id and no target-line id, and supplying either SHALL NOT
change the result. Issue content SHALL NOT be a valid project-planning address, and no project
partition SHALL be a valid Issue address.

#### Scenario: New Issue addresses use UID

- **WHEN** layout v2 resolves any address for a newly created Issue
- **THEN** it resolves below the Store Issue location whose directory segment is the Issue UID
- **AND** no title, key, slug, alias, project, or target line changes the result

#### Scenario: Issue addresses need no project

- **WHEN** layout v2 resolves an Issue directory, its record, its revisions directories, one revision of either kind, and its acceptance record
- **THEN** each address resolves below the Store's Issue location without a project or target-line input
- **AND** supplying a project or target line produces the same paths

#### Scenario: Legacy Issue addresses retain their storage key

- **WHEN** layout v2 resolves content for a compatible version-1 Issue
- **THEN** it uses the resolved legacy storage location
- **AND** it does not derive a new path from the selector used by the caller

#### Scenario: A revision file is addressed, not composed

- **WHEN** a caller needs one Execution Plan revision's file or one acceptance-conditions revision's file
- **THEN** it obtains that file's own address from the layout contract
- **AND** it does not append a filename to a revisions directory

#### Scenario: Issue content is not project-planning content

- **WHEN** an Issue address and a project partition address are computed in one Store
- **THEN** the Issue address resolves below the Store-level Issue location
- **AND** no project partition path resolves to Issue content and no Issue path resolves to project-planning content

#### Scenario: Issue addresses obey the same platform semantics

- **WHEN** Issue addresses are computed under Windows semantics and under POSIX semantics
- **THEN** each matches expectations built with the matching platform path API
- **AND** every result remains contained by the Store root

### Requirement: Issue and Execution Plan revision identifiers are portable canonical segments

A newly allocated Issue UID SHALL be an already-canonical lowercase textual UUID and SHALL be the
only business identity accepted as a new Issue directory segment. A compatible version-1 storage
key SHALL continue to satisfy its existing portable canonical path-segment contract. Empty values,
current- and parent-directory names, either path separator, control characters, a trailing dot or
space, Windows reserved device names, and non-canonical case SHALL be rejected for every physical
Issue storage segment on every platform. An Execution Plan revision identifier SHALL be a canonical
zero-padded decimal ordinal of fixed width; an unpadded value, a differently padded spelling of the
same number, and a zero ordinal SHALL be rejected. No physical identifier SHALL be derived from a
Git branch name, a date, a title, a human key, a slug, or directory listing order.

#### Scenario: A generated UID is a portable directory segment

- **WHEN** a new Issue is created on Windows, macOS, or Linux
- **THEN** its lowercase UUID is accepted as the same canonical storage segment on every platform
- **AND** the path remains contained by the Store root

#### Scenario: Traversal and device names are rejected everywhere

- **WHEN** an operator selector is a parent-directory name, contains a path separator, or is a Windows device name such as `con`
- **THEN** the selector is never used directly as a physical Issue storage segment
- **AND** no replacement path is guessed from it

#### Scenario: Case aliases cannot collide on a case-insensitive filesystem

- **WHEN** a physical Issue storage key uses a non-canonical case spelling
- **THEN** validation rejects the spelling
- **AND** it cannot alias an existing Issue location

#### Scenario: A revision ordinal must be canonical

- **WHEN** a revision identifier is unpadded, padded to another width, or a zero ordinal
- **THEN** validation rejects it without sanitizing it
- **AND** the rejected value does not address any existing revision
