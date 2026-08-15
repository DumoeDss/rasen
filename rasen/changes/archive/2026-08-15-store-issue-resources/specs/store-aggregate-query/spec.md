## ADDED Requirements

### Requirement: One read surface answers every Store-wide question

Rasen SHALL provide one aggregate read surface over a Store that lists and shows Issues, reports which
Issues reference a given Change, resolves an Issue's current Execution Plan, and lists the Store's
projects, target lines, and Changes. A caller SHALL NOT have to assemble these answers from several
surfaces or from the filesystem, and every answer SHALL come from the Store's own durable content.

#### Scenario: Every Store-wide question has one answer surface

- **WHEN** a caller needs the Store's Issues, its projects, its target lines, and its Changes
- **THEN** all four are available from the one aggregate read surface

#### Scenario: Answers come from Store content

- **WHEN** an aggregate read runs from an unrelated working directory
- **THEN** the answers describe the selected Store
- **AND** nothing is derived from the current working directory

### Requirement: A query reports and never mutates

The aggregate read surface SHALL NOT create, modify, or delete anything, SHALL NOT take any lock, and
SHALL NOT wait on one. A read SHALL succeed while a mutation holds the Issue lock. This is the
counterpart of the mutation rule: a mutation refuses, a query reports.

#### Scenario: A read succeeds while a mutation holds the lock

- **WHEN** an aggregate read runs while an Issue mutation holds the Issue lock
- **THEN** the read completes without waiting

#### Scenario: A read leaves the Store byte-identical

- **WHEN** every aggregate read operation runs against a Store
- **THEN** no file in the Store is created, modified, or removed

### Requirement: A partially unreadable Store is reported, not refused

An aggregate read SHALL report what it found together with what it could not read, naming each
unreadable or inconsistent item and why. It SHALL NOT fail the whole answer because one Issue, one
project catalog, or one Change is malformed, and it SHALL NOT silently omit the item either.

#### Scenario: One malformed record does not lose the rest

- **WHEN** one Issue record in the Store is malformed
- **THEN** the read reports every readable Issue
- **AND** it names the malformed one and why it could not be read

#### Scenario: An unreadable item is never silently omitted

- **WHEN** an item cannot be read
- **THEN** it appears in the reported problems
- **AND** the result does not present itself as complete

### Requirement: Issue reads report the canonical bytes and the verified digest

Showing an Issue and resolving its Execution Plan SHALL report the record's canonical content and the
revision's verified digest, so a caller can prove what it read. A revision whose digest does not match
its content SHALL be reported as unverifiable rather than returned as valid.

#### Scenario: A resolved plan carries its verified digest

- **WHEN** an Issue's current Execution Plan is resolved
- **THEN** the result carries the revision's ordinal and its verified digest

#### Scenario: An unverifiable revision is reported as such

- **WHEN** a revision's stored digest does not match its content
- **THEN** the read reports it as unverifiable
- **AND** does not present its content as a valid plan

### Requirement: Reverse reference lookup answers what references a Change

Given a Change, the read surface SHALL report every Issue whose current Execution Plan references it.
A Change referenced by no Issue SHALL produce an explicit empty answer rather than an error, and a
reference from a superseded revision SHALL NOT be reported as current.

#### Scenario: A referenced Change names its Issues

- **WHEN** a Change is referenced by two Issues' current plans
- **THEN** both Issues are reported

#### Scenario: An unreferenced Change gets an explicit empty answer

- **WHEN** a Change is referenced by no Issue
- **THEN** the answer is explicitly empty
- **AND** it is not an error

#### Scenario: A superseded revision is not a current reference

- **WHEN** an earlier revision referenced a Change and the current revision does not
- **THEN** that Change is not reported as currently referenced

### Requirement: Changes are listed grouped by project and by target line

Listing a Store's Changes SHALL group them by project and by target line, so the same Change alias
used in two projects is two entries rather than one ambiguous entry. A project with no Changes and a
target line with no Changes SHALL each be reported as present and empty rather than omitted.

#### Scenario: The same alias in two projects is two entries

- **WHEN** two projects each hold a Change named `refresh-cache`
- **THEN** both are listed, each under its own project

#### Scenario: An empty project or line is present and empty

- **WHEN** a project or target line holds no Changes
- **THEN** it is reported as present with an empty list
- **AND** it is not omitted from the result

### Requirement: The machine-readable form carries the same facts as the human form

Every aggregate read SHALL offer a machine-readable form whose content matches its human form. A fact
shown to a person SHALL be available to a program, and a fact reported to a program SHALL NOT be
silently dropped from the human rendering.

#### Scenario: Both forms agree

- **WHEN** the same aggregate read is taken in human and machine-readable form
- **THEN** every Issue, project, target line, Change, digest, and reported problem present in one is present in the other
