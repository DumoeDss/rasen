## MODIFIED Requirements

### Requirement: A Store records each member project in its own file, keyed by project identity

A Store SHALL record membership as one file per member project, named by that project's permanent identity, under the Store's metadata directory. The record SHALL be the single authority for whether a project belongs to the Store, and no other source — including the project's own durable Store declaration — SHALL confer membership or grant Store-scoped Session eligibility. A project whose declaration names a Store but for which no Store record exists SHALL be rejected from Store-scoped sessions with a diagnostic that names the missing record and the copy-pasteable repair command (`rasen store add-project <projectId> --store <storeId>`); the declaration MAY shape that diagnostic but SHALL NOT itself decide eligibility. The project identity inside the record SHALL be the authority for which project it describes, and the file's name SHALL agree with it — a disagreement SHALL be reported as an error rather than resolved by preferring either one. The display id in the record SHALL be for reading only, and a recorded remote SHALL be credential-free. Two people adding two different projects to the same Store SHALL write two different files.

The record's schema SHALL follow the Store's declared planning layout: a Store that has not declared layout version 2 uses the legacy membership record, and a Store declaring layout version 2 uses the v2 project catalog, which carries the project's roles and its planning binding and carries no adopted spec or change name list. Readers SHALL choose the schema from the Store's declared layout version and SHALL NOT infer it from the file's contents, so a partially written file can never be read as the other schema. Only the explicit layout migration SHALL convert a record from one schema to the other.

The project's permanent identity SHALL be the only identifier either schema validates as one. The recorded display name SHALL be treated as a human label in both schemas, SHALL NOT be constrained to an identifier form, and SHALL be accepted by the v2 project catalog wherever the legacy record accepts it — a migration SHALL NOT block on a value the schema it migrates from accepted.

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

#### Scenario: The record schema follows the declared layout

- **WHEN** membership is read from a Store declaring layout version 2 and from a Store that has not
- **THEN** the first is read as a v2 project catalog and the second as the legacy membership record
- **AND** neither is chosen by inspecting the file's own version field

#### Scenario: A recorded display name never blocks the migration

- **WHEN** a membership record carries a display name that is not an identifier, such as `Elftia` or `my app`
- **THEN** the layout migration plans and applies, carrying the name forward unchanged
- **AND** the v2 project catalog accepts it, because the permanent identity is the only identifier either schema validates

#### Scenario: A legacy record inside a partitioned Store is a finding

- **WHEN** a Store declares layout version 2 and one member file is still the legacy record
- **THEN** it is reported as a diagnostic naming the file and the migration command
- **AND** it is not silently accepted as a second valid membership schema

### Requirement: Legacy membership data is converted only by an explicit, previewable migration

Converting a Store's legacy membership data into per-project records, and converting those records into v2 project catalogs as part of the Store's planning layout migration, SHALL happen only when the user explicitly runs the migration. The migration SHALL offer a preview that changes nothing, SHALL be safe to run more than once, and SHALL keep the legacy data until every record it produced has been written and read back successfully. A project it cannot resolve SHALL be reported and left untouched rather than guessed at. Once the records are verified, the legacy data SHALL be removed and the removal SHALL be reported for the user to commit.

When a record is converted into a v2 project catalog, its roles SHALL be carried over unchanged, its planning binding SHALL be derived only from adoption evidence or a proven pointer-without-local-planning binding and never from membership alone, and its adopted spec and change name lists SHALL be dropped from the catalog and preserved verbatim in the committed migration receipt. A recorded value that cannot satisfy the stricter v2 catalog contract SHALL block the conversion, naming the record and the field, and SHALL NOT be rewritten to make it fit; the reported repair SHALL state what the operator must change the value to, not which validator rejected it.

Once a Store declares planning layout version 2 its legacy membership data is already converted, so the legacy membership migration SHALL report that and do nothing. It SHALL NOT read that Store's project catalogs through the legacy record schema, and SHALL NOT report a valid project catalog as an invalid membership record or advise removing it.

#### Scenario: Preview reports the plan and writes nothing

- **WHEN** the membership migration runs in preview mode against a Store with legacy data
- **THEN** it lists every record it would create and every legacy file it would remove, and changes nothing

#### Scenario: Legacy data survives until the records are verified

- **WHEN** the migration applies and a record cannot be written or read back
- **THEN** the legacy data is still present and unmodified
- **AND** the failure names the project and the file

#### Scenario: The legacy membership migration leaves a migrated Store alone

- **WHEN** the legacy membership migration runs against a Store that already declares planning layout version 2
- **THEN** it converts nothing, writes nothing, and reports that the Store's membership is already recorded as project catalogs
- **AND** it reports no error against those catalogs and never advises removing one

#### Scenario: Re-running the migration is safe

- **WHEN** the migration is applied a second time against an already-migrated Store
- **THEN** it reports that there is nothing left to convert and writes nothing

#### Scenario: An unresolvable project is left alone

- **WHEN** legacy data references a project whose identity cannot be determined on this machine
- **THEN** the migration reports it, converts the projects it can, and leaves the unresolved entry untouched

#### Scenario: Adoption data becomes a binding and a receipt entry

- **WHEN** a record carrying adoption data is converted into a v2 project catalog
- **THEN** the catalog declares a bound planning binding with a canonical timestamp and carries no name list
- **AND** the dropped spec and change names are preserved in the committed migration receipt

#### Scenario: Membership without adoption stays unbound

- **WHEN** a record declaring only a knowledge role is converted
- **THEN** its catalog declares the planning binding unbound
