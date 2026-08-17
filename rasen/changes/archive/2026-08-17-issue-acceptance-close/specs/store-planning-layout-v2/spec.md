# store-planning-layout-v2 Specification (Delta)

## MODIFIED Requirements

### Requirement: Layout v2 addresses Store-level Issues and Execution Plan revisions

A Store declaring layout version 2 SHALL place cross-project Issue content at the Store level, with
each Issue's record, its narrative, its Execution Plan revisions, its acceptance-conditions
revisions, and its acceptance record below that Issue's own location. The Issue directory, the
Issue record, the plan-revisions directory, one plan-revision file, the acceptance-conditions
directory, one acceptance-conditions revision file, and the acceptance record SHALL each be
its own address, so no caller composes a filename onto a returned directory. These addresses SHALL be
Store-level: computing one SHALL require no project id and no target-line id, and supplying either
SHALL NOT change the result. Issue content SHALL NOT be a valid project-planning address, and no
project partition SHALL be a valid Issue address.

#### Scenario: Issue addresses need no project

- **WHEN** layout v2 resolves an Issue directory, its record, its revisions directories, one revision of either kind, and its acceptance record
- **THEN** each address resolves below the Store's Issue location without a project or target-line input
- **AND** supplying a project or target line produces the same paths

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
