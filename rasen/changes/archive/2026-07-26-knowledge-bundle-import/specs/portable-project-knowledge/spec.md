## Purpose

Let a user move a project's own learned knowledge to another machine deliberately, as a single file they create and carry, rather than by synchronizing anything. Covers what such a bundle may and may not contain, how it is validated before anything is read from it, why a conflict with what is already on the receiving machine stops the import instead of overwriting, why passing a bundle through a Store changes nothing about who owns the knowledge, and the one place preparing a machine may import one.

## ADDED Requirements

### Requirement: A bundle is validated in full before anything is imported

Import SHALL verify that the bundle's schema version is one it understands, that its structure is valid, that the project identity it carries is the project being imported into, and that every record's content matches its recorded digest and is a valid managed record. Every one of those checks SHALL complete before anything is written. Any failure SHALL refuse the import, SHALL name what failed and which record it belongs to, and SHALL write nothing. A bundle written by a newer version SHALL be refused by version rather than partially read.

#### Scenario: A bundle for a different project is refused

- **WHEN** a bundle's project identity is not the identity of the project being imported into
- **THEN** the import is refused naming both identities
- **AND** nothing is written

#### Scenario: A record that does not match its digest is refused

- **WHEN** a record's content does not match the content digest recorded for it
- **THEN** the import is refused naming that record
- **AND** nothing is written

#### Scenario: A newer bundle version is refused by version

- **WHEN** a bundle declares a schema version later than the one this version understands
- **THEN** the import is refused naming the version it found and the version it supports
- **AND** no part of the bundle is read as knowledge

#### Scenario: A malformed bundle writes nothing

- **WHEN** a bundle file is not valid at all
- **THEN** the failure names what could not be parsed
- **AND** no file under the project's stored knowledge is created or modified

#### Scenario: Validation precedes every write

- **WHEN** a bundle's last record is invalid and its earlier records are valid
- **THEN** none of the earlier records is imported

### Requirement: Import never overwrites or removes local knowledge, and a conflict stops the whole import

When the project's stored knowledge already holds a record with the same identifier whose content is not identical to the bundle's, the import SHALL stop, SHALL name the identifier and describe both sides, and SHALL write nothing at all — neither the conflicting record nor the records that would have imported cleanly. A record that is already present and identical SHALL be reported as such and SHALL NOT be rewritten. Import SHALL only add records: it SHALL NOT remove, retire, or modify any record the bundle does not carry. A record that is retired on one side and active on the other SHALL be treated as a conflict, never as an overwrite.

#### Scenario: New records are added

- **WHEN** a bundle carries records the project does not have
- **THEN** they are added to the project's stored knowledge

#### Scenario: An identical record is left exactly as it is

- **WHEN** a bundle carries a record identical to one already stored
- **THEN** it is reported as already present
- **AND** the stored files are left byte-identical

#### Scenario: A differing record stops the import

- **WHEN** a bundle carries a record whose identifier matches a stored record with different content
- **THEN** the import stops, naming the identifier and describing both sides
- **AND** neither side is overwritten

#### Scenario: One conflict prevents every other record from importing

- **WHEN** a bundle carries five records of which one conflicts
- **THEN** none of the five is written
- **AND** the report names the conflict and states that nothing was imported

#### Scenario: Local knowledge the bundle does not carry is untouched

- **WHEN** the project holds records the bundle does not contain
- **THEN** they are neither removed, retired, nor modified

#### Scenario: Retired against active is a conflict

- **WHEN** a bundle carries a retired record whose identifier matches an active stored record
- **THEN** it is reported as a conflict
- **AND** the stored record is not retired

#### Scenario: Re-running after the conflict is resolved completes

- **WHEN** the conflicting record is resolved and the same bundle is imported again
- **THEN** the remaining records are imported

#### Scenario: Importing the same bundle twice changes nothing the second time

- **WHEN** a bundle that imported cleanly is imported again with nothing changed in between
- **THEN** every record is reported as already present and nothing is written

### Requirement: Imported knowledge stays the project's own, whatever route it travelled

Records that arrive by import SHALL become the project's own knowledge, owned by the project's identity. The route a bundle travelled — a file the user copied, or a Store repository it passed through — SHALL NOT affect ownership, SHALL NOT record any Store as a source of an imported record, and SHALL NOT grant a record a wider scope than the project. Importing SHALL NOT publish anything into a Store, and SHALL NOT satisfy any part of what publishing into a Store or promoting beyond one requires.

#### Scenario: What lands on disk records the project as owner

- **WHEN** a record is imported
- **THEN** the stored record names the project's identity as its owner

#### Scenario: A bundle carried through a Store is still project knowledge

- **WHEN** a bundle is retrieved from a Store repository and imported
- **THEN** its records become the project's own knowledge
- **AND** no record is stored as belonging to that Store

#### Scenario: Transport records no Store as a source

- **WHEN** a bundle that passed through a Store is imported
- **THEN** no Store appears as a source of any imported record

#### Scenario: Import is not publication

- **WHEN** knowledge is imported into a project that is a member of a Store
- **THEN** nothing is added to that Store's catalog
- **AND** the knowledge is not shared into the Store by the import

#### Scenario: Import creates no new evidence

- **WHEN** an imported record carries evidence recorded on the machine it came from
- **THEN** that evidence counts exactly as it did before
- **AND** the receiving machine is not added as a further independent source

#### Scenario: A wider scope still has to be earned

- **WHEN** an imported record is proposed for a Store or for machine-wide use
- **THEN** the evidence and approval that scope requires are still required
- **AND** having arrived by import satisfies none of it

### Requirement: Import previews completely and changes nothing

Import SHALL offer a preview that performs every validation and every comparison the real import performs, and reports the whole outcome — what would be added, what is already present, and every conflict rather than only the first — while creating no file, modifying no record, and leaving no trace. The preview and the real import SHALL reach the same decisions for the same inputs.

#### Scenario: The preview reports every conflict, not just the first

- **WHEN** a bundle conflicts with the project's stored knowledge on three records
- **THEN** the preview names all three

#### Scenario: The preview writes nothing

- **WHEN** a bundle is previewed
- **THEN** no file under the project's stored knowledge, the checkout, or the machine data directory is created, modified, or removed

#### Scenario: Preview and import agree

- **WHEN** a bundle is previewed and then imported with nothing changed in between
- **THEN** the import adds exactly what the preview said it would add
- **AND** reports the same records as already present

#### Scenario: A preview of an invalid bundle reports the same refusal

- **WHEN** a bundle that would be refused is previewed
- **THEN** the preview reports the same refusal and the same reason
