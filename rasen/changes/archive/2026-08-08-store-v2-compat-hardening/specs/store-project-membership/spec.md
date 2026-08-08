## MODIFIED Requirements

### Requirement: Membership is answered by one provider that understands legacy data

Every surface that asks which projects belong to a Store, or which Stores a project belongs to, SHALL get its answer from one membership provider. The provider SHALL normalize current records and legacy data — a Store's referenced-project entries, its legacy adoption data, and the machine's project namespace — into a single shape that reports, for each member, the Store, the project identity, the roles, and which source the answer came from. A current record SHALL take precedence over any legacy source for the same project. New membership SHALL be written only as per-project records.

The provider SHALL choose the record schema from the Store's declared layout version, and every surface that reads a member's record SHALL go through it. A surface that reads a member's record with a single-version parser is reading the other layout's record as broken data: against a partitioned Store it reports a healthy project catalog as unreadable, and it drops whatever that catalog declares. Such a read SHALL be treated as a defect in the reader, not as a property of the record.

#### Scenario: Records and legacy data answer through one shape

- **WHEN** a Store carries both current membership records and legacy adoption data
- **THEN** membership is reported once per project, in one shape, each entry stating which source it came from

#### Scenario: A current record wins over legacy data

- **WHEN** a project appears both as a current record and in legacy adoption data
- **THEN** the current record's roles and details are what membership reports
- **AND** the legacy entry does not produce a second member

#### Scenario: An unmappable legacy reference is reported, not dropped

- **WHEN** a Store references a project by display name that cannot be mapped to a project identity on this machine
- **THEN** membership reports it as an unresolved legacy reference with its repair command
- **AND** it is neither silently discarded nor guessed into a project identity

#### Scenario: Reading membership never writes

- **WHEN** any read-only command reads a Store's membership, including one carrying only legacy data
- **THEN** the Store's files, the project's files, and the machine registries are all left byte-identical

#### Scenario: A partitioned Store's member record reads as itself everywhere

- **WHEN** any surface reads a member's record in a Store declaring the partitioned layout, including one reading it only to find that project's declared knowledge bundle, and one reading it only to decide whether the record is unreadable
- **THEN** the record SHALL be parsed as that layout's project catalog
- **AND** a healthy catalog SHALL NOT be reported as an unreadable record, and its declarations SHALL NOT be dropped
