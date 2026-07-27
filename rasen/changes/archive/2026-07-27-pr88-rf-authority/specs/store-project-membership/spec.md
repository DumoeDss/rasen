## MODIFIED Requirements

### Requirement: A Store records each member project in its own file, keyed by project identity

A Store SHALL record membership as one file per member project, named by that project's permanent identity, under the Store's metadata directory. The record SHALL be the single authority for whether a project belongs to the Store, and no other source — including the project's own durable Store declaration — SHALL confer membership or grant Store-scoped Session eligibility. A project whose declaration names a Store but for which no Store record exists SHALL be rejected from Store-scoped sessions with a diagnostic that names the missing record and the copy-pasteable repair command (`rasen store add-project <projectId> --store <storeId>`); the declaration MAY shape that diagnostic but SHALL NOT itself decide eligibility. The project identity inside the record SHALL be the authority for which project it describes, and the file's name SHALL agree with it — a disagreement SHALL be reported as an error rather than resolved by preferring either one. The display id in the record SHALL be for reading only, and a recorded remote SHALL be credential-free. Two people adding two different projects to the same Store SHALL write two different files.

#### Scenario: Membership is recorded per project

- **WHEN** a project is added to a Store
- **THEN** the Store gains one membership record file for that project alone
- **AND** the record names the project by its permanent identity, not by its display name

#### Scenario: Two projects added on two machines do not collide

- **WHEN** two people each add a different project to the same Store and both commit
- **THEN** each addition wrote a separate file, and merging the two requires no conflict resolution

#### Scenario: A record whose name disagrees with its contents is rejected

- **WHEN** a membership record file is named for one project identity but declares a different one inside
- **THEN** reading the Store's membership reports an error naming the file and both identities
- **AND** neither identity is silently treated as authoritative

#### Scenario: A project identity that cannot safely name a file is refused

- **WHEN** a project's identity is not a well-formed identifier, or is a name a filesystem reserves
- **THEN** writing a membership record for it fails, naming the project and the reason
- **AND** the identity is never altered to make it fit a filename

#### Scenario: Record filenames are legal on Windows

- **WHEN** membership records are written and read back on Windows
- **THEN** every record file resolves under the Store's metadata directory using platform path resolution
- **AND** no accepted project identity can produce a filename Windows rejects

#### Scenario: A declaration alone does not establish Session eligibility

- **WHEN** a project's own durable Store declaration resolves to this Store but the Store has no membership record for that project
- **THEN** Store-scoped session eligibility for that project is denied
- **AND** the rejection diagnostic names the missing record and prints the `rasen store add-project` command that establishes it
- **AND** the project's declaration is not used to grant eligibility, only to shape the diagnostic
