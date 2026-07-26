## Purpose

Let a user move a project's own learned knowledge to another machine deliberately, as a single file they create and carry, rather than by synchronizing anything. Covers what such a bundle may and may not contain, how it is validated before anything is read from it, why a conflict with what is already on the receiving machine stops the import instead of overwriting, why passing a bundle through a Store changes nothing about who owns the knowledge, and the one place preparing a machine may import one.

## ADDED Requirements

### Requirement: A Store used as transport receives a file and nothing it owns changes

When a bundle is placed into a Store, it SHALL be written as a file at a location reserved for transported bundles, and the Store's own knowledge catalog, its project records, and its metadata SHALL be unchanged. The command SHALL NOT stage, commit, or push anything in the Store's repository; it SHALL print the files the user needs to commit. A Store that cannot be reached SHALL cause the placement to fail with the reason and a copy-pasteable repair, and SHALL NOT be treated as a Store with nothing in it. The location SHALL be composed with platform path resolution, and placing a bundle SHALL NOT replace a bundle placed earlier.

#### Scenario: The bundle is placed at the Store's transport location

- **WHEN** a bundle is exported with a Store named as transport
- **THEN** the bundle file exists at the Store's reserved transport location

#### Scenario: The Store's own catalog is unchanged

- **WHEN** a bundle is placed into a Store that holds its own knowledge catalog
- **THEN** every record in that catalog is byte-identical to what it was

#### Scenario: The Store's project records are unchanged

- **WHEN** a bundle for a project is placed into a Store
- **THEN** the Store's records of which projects belong to it are unchanged
- **AND** the project does not become a member by virtue of the placement

#### Scenario: Nothing is staged, committed, or pushed

- **WHEN** a bundle is placed into a Store
- **THEN** the command prints the files the user needs to commit
- **AND** it has staged, committed, and pushed nothing

#### Scenario: An unreachable Store fails without writing

- **WHEN** the Store named as transport cannot be reached
- **THEN** the placement fails with the reason and a copy-pasteable repair
- **AND** the Store is not treated as one containing nothing

#### Scenario: An earlier transported bundle is never replaced

- **WHEN** a second bundle is placed into the same Store for the same project
- **THEN** the earlier bundle file is still present and unchanged

#### Scenario: The transport location resolves on Windows

- **WHEN** a bundle is placed into a Store on Windows
- **THEN** the location is composed with platform path resolution
- **AND** a Store root differing only by drive-letter case or separator form resolves to the same location
