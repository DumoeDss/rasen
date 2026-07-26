# portable-project-knowledge Specification

## Purpose

Let a user move a project's own learned knowledge to another machine deliberately, as a single file they create and carry, rather than by synchronizing anything. Covers what such a bundle may and may not contain, how it is validated before anything is read from it, why a conflict with what is already on the receiving machine stops the import instead of overwriting, why passing a bundle through a Store changes nothing about who owns the knowledge, and the one place preparing a machine may import one.

## Requirements
### Requirement: A bundle carries an explicitly listed set of portable fields and nothing that belongs to a machine

A bundle SHALL contain a schema version, its own identity, the identity of the project it came from, when it was created, the project commit it was captured against, and for each record the identifier, the knowledge key, the content digest, the managed record, and the record's canonical content. What a bundle contains SHALL be selected by an explicit list of permitted fields; anything not on that list SHALL be omitted rather than filtered out by pattern. A bundle SHALL NOT contain any absolute machine path, any ownership record for generated files, any generated tool file, or any token, session handle, or other transient run state. Only knowledge the project itself owns SHALL be exported — knowledge owned by a Store, or held machine-wide, SHALL NOT be. A record that cannot be represented without an excluded value SHALL fail the export, naming the record and the field, rather than being written into a bundle.

#### Scenario: No machine path appears in a bundle

- **WHEN** a bundle is produced for a project whose knowledge was recorded on this machine
- **THEN** no absolute path from this machine appears anywhere in it

#### Scenario: Absolute paths from either platform are recognized

- **WHEN** a value would be written into a bundle that is an absolute path in Windows drive-letter form, in Windows network-share form, or in POSIX form
- **THEN** it is recognized as a machine path on whichever platform the export runs
- **AND** the export fails naming the record and the field rather than writing it

#### Scenario: Ownership records for generated files stay behind

- **WHEN** a project has ownership records describing generated files on this machine
- **THEN** none of them is included in the bundle

#### Scenario: Generated tool files stay behind

- **WHEN** a project has knowledge materialized into its checkout for a tool
- **THEN** the bundle carries the stored records, not the generated files

#### Scenario: No token, session, or transient state

- **WHEN** a bundle is produced while a session is running
- **THEN** it contains no token, no session handle, and no run state

#### Scenario: Store and machine-wide knowledge stay out of a project bundle

- **WHEN** a project draws on knowledge owned by a Store and on machine-wide knowledge
- **THEN** the bundle carries only the records the project itself owns
- **AND** neither the Store's nor the machine-wide records are included

#### Scenario: A retired record travels with its status

- **WHEN** a project's knowledge includes a record that was retired
- **THEN** the bundle carries it with its retired status preserved

#### Scenario: A record that cannot be made portable fails the export

- **WHEN** one record would require an excluded value to be represented
- **THEN** the export fails naming that record and that field
- **AND** no bundle file is produced

#### Scenario: The captured project commit is recorded honestly

- **WHEN** a bundle is produced
- **THEN** it records the project commit the knowledge was captured against
- **AND** when no commit can be determined, that is recorded as unavailable rather than invented
