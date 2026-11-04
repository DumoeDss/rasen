## ADDED Requirements

### Requirement: The Store aggregate paths serve Issue, project, and grouped-change reads

The management API SHALL serve the Store aggregate reads — Issues, one Issue, which Issues reference a
given Change, a resolved Execution Plan, projects, target lines, and Changes grouped by project and
target line — over paths scoped to a Store's stable identity. These paths SHALL be reads: they SHALL
NOT mutate anything and SHALL NOT take a lock. They SHALL report the same facts, including reported
problems, that the command-line form reports.

#### Scenario: Aggregate reads are available over the API

- **WHEN** a client requests the Store's Issues, projects, target lines, or grouped Changes
- **THEN** each is served from its own Store-scoped path

#### Scenario: A read path never mutates

- **WHEN** any aggregate read path is called repeatedly
- **THEN** no file in the Store is created, modified, or removed

#### Scenario: The API and the command line agree

- **WHEN** the same aggregate read is taken over the API and from the command line
- **THEN** both report the same items and the same reported problems

### Requirement: A Store-scoped project mutation carries its complete scope and never infers one

A mutation submitted against a Store-scoped surface SHALL carry its complete scope — its Store, its
project, and its target line — and the server SHALL refuse a mutation whose scope is incomplete rather
than infer the missing part from a default, the most recent selection, a single candidate, or the
server's own working directory.

#### Scenario: An incomplete scope is refused

- **WHEN** a Store-scoped project mutation arrives without its project or without its target line
- **THEN** it is refused, naming what is missing
- **AND** nothing is mutated

#### Scenario: A single candidate does not become an inference

- **WHEN** a Store has exactly one project and a mutation omits the project
- **THEN** the mutation is still refused
- **AND** the single project is not adopted as the missing scope
