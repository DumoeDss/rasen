## Purpose

Let a user move a project's own learned knowledge to another machine deliberately, as a single file they create and carry, rather than by synchronizing anything. Covers what such a bundle may and may not contain, how it is validated before anything is read from it, why a conflict with what is already on the receiving machine stops the import instead of overwriting, why passing a bundle through a Store changes nothing about who owns the knowledge, and the one place preparing a machine may import one.

## ADDED Requirements

### Requirement: Preparing a machine imports a declared bundle only as a separate, confirmed step

Preparing a machine for a project SHALL NOT import a bundle on its own. When the project's own configuration, or a Store's record for the project, names a portable bundle, preparation SHALL list that import as its own action, distinct from everything else it reports, and SHALL carry it out only on explicit confirmation. A blanket confirmation SHALL cover only a bundle named by the project's own committed configuration; a bundle named only by a Store's record SHALL be listed and SHALL NOT be imported without an explicit choice. A declared bundle that is missing or unreadable SHALL be reported as degraded with its repair and SHALL NOT stop preparation. An import performed during preparation SHALL obey every import rule, including refusing on conflict.

#### Scenario: With no declaration, nothing is imported or offered

- **WHEN** preparation runs for a project that declares no bundle
- **THEN** no bundle is imported
- **AND** no bundle import is listed

#### Scenario: A declared bundle is listed as its own action

- **WHEN** the project's configuration names a portable bundle
- **THEN** preparation lists importing it as a separate action, distinct from obtaining and registering

#### Scenario: Confirmation is required

- **WHEN** preparation runs with a declared bundle and the user does not confirm
- **THEN** nothing is imported

#### Scenario: A blanket confirmation covers the project's own declaration

- **WHEN** preparation runs with the blanket confirmation option and the project's own configuration names the bundle
- **THEN** the bundle is imported without stopping to ask

#### Scenario: A blanket confirmation does not cover a Store-named bundle

- **WHEN** preparation runs with the blanket confirmation option and only a Store's record for the project names a bundle
- **THEN** the bundle is listed with the choice that would import it
- **AND** it is not imported

#### Scenario: A missing declared bundle degrades rather than blocking

- **WHEN** a declared bundle cannot be found or read
- **THEN** preparation reports the degraded state with the repair
- **AND** the rest of preparation still completes

#### Scenario: Conflict rules still apply during preparation

- **WHEN** a bundle imported during preparation conflicts with the project's stored knowledge
- **THEN** nothing is imported
- **AND** the conflict is reported as part of the preparation result
