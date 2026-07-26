# learned-skill-effective-materialization Specification

## Purpose

Decide what a project actually receives from its own knowledge, its eligible Stores, and machine-wide knowledge — filtering by applicability first, then applying one stated order, deduplicating byte-identical Store copies, refusing to choose between divergent ones, and never treating an unreachable Store as an empty one. Covers the ownership records for generated files, the content identity those records carry, and when the resolved set is written into a checkout.
## Requirements
### Requirement: Applicability is decided before precedence, in the checkout being worked on

Knowledge that does not apply to the project SHALL be filtered out before any precedence between project, Store, and machine-wide sources is considered. Applicability SHALL be evaluated against the checkout the session is actually working in, which is a different thing from where the project's knowledge is stored and from where generated files are written. When no session records a checkout, the current directory SHALL be used, following the same precedence the session runtime context states rather than a separate rule.

#### Scenario: Inapplicable knowledge never reaches precedence

- **WHEN** knowledge does not apply to the project being worked on
- **THEN** it is removed before precedence is considered
- **AND** it cannot win at any scope

#### Scenario: Applicability uses the session's checkout

- **WHEN** a session records an execution checkout and applicability is evaluated
- **THEN** it is decided against that checkout
- **AND** not against the project's knowledge storage location

#### Scenario: Two clones evaluate independently

- **WHEN** the same project has two checkouts whose contents differ in what makes knowledge applicable
- **THEN** each session evaluates applicability against its own checkout
- **AND** both draw on the same stored project knowledge

### Requirement: What a project receives is resolved in one stated order

For each piece of knowledge, resolution SHALL proceed: applicable candidates only; the project's own record wins if it exists; otherwise every Store the project is eligible for is considered together; and machine-wide knowledge fills the gap only when no Store produced a winner. Eligibility SHALL be the union of the Stores the project declares and the locally available Stores whose records include this project — never the Store the project happens to plan in. Resolution SHALL NOT select a winner by registry order, by which Store is the project's planning Store, or by alphabetical order of display names.

#### Scenario: The project's own record wins

- **WHEN** the project has an applicable record and Stores also offer one
- **THEN** the project's record is what the project receives

#### Scenario: Stores are considered before machine-wide knowledge

- **WHEN** the project has no record and an eligible Store offers an applicable one
- **THEN** the Store's is what the project receives, and machine-wide knowledge does not apply

#### Scenario: Machine-wide knowledge fills the remaining gap

- **WHEN** neither the project nor any eligible Store offers an applicable record
- **THEN** machine-wide knowledge is used

#### Scenario: Eligibility does not come from the planning Store

- **WHEN** a project plans in one Store while a different Store's records include the project
- **THEN** the second Store is eligible
- **AND** the planning Store receives no priority for being the planning Store

#### Scenario: No accidental tie-break

- **WHEN** several eligible Stores offer knowledge with the same identifier
- **THEN** the outcome is decided only by equivalence or conflict
- **AND** never by registry order, planning-Store priority, or alphabetical display-name order

### Requirement: Byte-identical Store copies collapse into one answer that records every source

Two Store copies SHALL be treated as the same knowledge only when all of the following match: the identifier, the knowledge key, the exact canonical content bytes, the content digest, and both being valid managed records. When they match, resolution SHALL produce one winner and SHALL record every contributing Store's permanent identity as a source. Matching the knowledge key alone SHALL NOT be sufficient to judge two copies the same.

#### Scenario: Identical copies produce one winner with several sources

- **WHEN** two eligible Stores hold byte-identical, validly managed copies of the same knowledge
- **THEN** one winner is produced
- **AND** both Stores' permanent identities are recorded as its sources

#### Scenario: The knowledge key alone does not prove sameness

- **WHEN** two Store copies share a knowledge key but differ in content
- **THEN** they are not treated as equivalent

#### Scenario: An invalid managed record is not an equivalent copy

- **WHEN** one of two otherwise identical copies is not a valid managed record
- **THEN** they are not treated as equivalent

### Requirement: Divergent Store copies are reported as a conflict and never resolved by choosing

When eligible Stores hold copies of the same knowledge that are not equivalent, resolution SHALL report a conflict naming every participant, and SHALL NOT choose a winner. The result SHALL be the same regardless of the order the Stores were considered in. When the project has its own winning record the conflict SHALL be recorded without stopping resolution; when it does not, the conflict SHALL stop learned-knowledge reconciliation entirely, writing no files and no ownership records — not even partially. Ordinary workflow generation SHALL be unaffected either way.

#### Scenario: A conflict names every participant

- **WHEN** three eligible Stores hold non-equivalent copies of the same knowledge
- **THEN** the conflict names all three with their permanent identities

#### Scenario: The conflict does not depend on order

- **WHEN** the same set of divergent Stores is resolved in a different order
- **THEN** the reported conflict is identical

#### Scenario: A project winner makes the conflict non-blocking

- **WHEN** the project has its own applicable record and the eligible Stores conflict
- **THEN** the project's record is used and the conflict is recorded without stopping resolution

#### Scenario: Without a project winner, nothing partial is written

- **WHEN** eligible Stores conflict and the project has no record of its own
- **THEN** learned-knowledge reconciliation stops
- **AND** no generated file and no ownership record is created, modified, or deleted

#### Scenario: Ordinary generation still works

- **WHEN** learned-knowledge reconciliation is blocked by a conflict
- **THEN** ordinary workflow generation completes normally

### Requirement: A Store that cannot be reached is never treated as one with nothing in it

A Store is relevant to a project when the project declares it, when a previous ownership record names it as a source, when a frozen planning or membership fact names it, when it is the project's current planning Store, or when it is locally found to include the project. When a relevant Store cannot be reached, resolution SHALL report it as unavailable and SHALL NOT treat it as offering nothing. Removal or replacement of what that Store previously provided SHALL be deferred rather than performed. A higher-precedence record unrelated to the unavailable Store MAY still take effect. The situation SHALL be reported as degraded, with the reason and a copy-pasteable repair.

#### Scenario: An unreachable Store does not delete what it provided

- **WHEN** a relevant Store is unavailable and previously provided knowledge that is materialized in the project
- **THEN** those generated files are left in place
- **AND** the removal is deferred rather than performed

#### Scenario: The degraded state is reported

- **WHEN** resolution runs with a relevant Store unavailable
- **THEN** the result reports the degraded state, names the Store, and carries a repair command

#### Scenario: An unrelated project winner still applies

- **WHEN** a relevant Store is unavailable and the project has its own applicable record for different knowledge
- **THEN** that record still takes effect

#### Scenario: Every route to relevance counts

- **WHEN** a Store is named only by a previous ownership record, and not by the project's declarations
- **THEN** it is still treated as relevant and its unavailability is still reported rather than read as empty

### Requirement: Generated files are tracked by exact ownership, keyed on permanent identity

Ownership records for generated files SHALL name their sources by permanent identity, and SHALL record the content digest of what was written. A generated file SHALL be modified or removed only when the record claims that exact path, the file on disk is still an ordinary file, its content still matches what was recorded, and the source is still verifiable. A file that fails any of those checks SHALL be left alone and reported. Ownership records SHALL be versioned; records written by an earlier version SHALL be detected and upgraded only by an explicit, previewable migration, which SHALL upgrade when the mapping from an old display name to a permanent identity is unambiguous and SHALL stop when it is not, never discarding a recorded source.

#### Scenario: Only exactly owned files are touched

- **WHEN** reconciliation would replace a generated file whose content no longer matches its ownership record
- **THEN** the file is left as it is and reported

#### Scenario: A user-authored file is never taken over

- **WHEN** a file at a generated path was authored by the user and is not claimed by an ownership record
- **THEN** it is not modified or deleted

#### Scenario: An earlier ownership record is upgraded only on purpose

- **WHEN** ownership records written by an earlier version are found
- **THEN** they are reported, and are upgraded only when the user runs the migration
- **AND** the migration offers a preview that changes nothing

#### Scenario: An ambiguous source mapping blocks the upgrade

- **WHEN** an earlier ownership record names a display name that maps to more than one Store
- **THEN** the migration stops, naming the ambiguity
- **AND** no recorded source is dropped or guessed

### Requirement: Content identity excludes the display name and its change is recorded as a migration

The identity computed for a resolved piece of knowledge SHALL be derived from the schema version, the identifier, the knowledge key, the effective scope, the sorted permanent identities of its sources, the content digests, and the rendered managed body. No Store display name SHALL contribute to it. When the identity scheme itself changes, the difference SHALL be reported as a migration and SHALL NOT be presented as the content having been edited.

#### Scenario: A rename does not change content identity

- **WHEN** a contributing Store's display name is renamed and nothing else changes
- **THEN** the computed identity is unchanged

#### Scenario: A scheme change is reported as a migration

- **WHEN** the identity scheme changes between versions
- **THEN** the difference is reported as a migration
- **AND** the affected knowledge is not reported as having been edited

#### Scenario: Source order does not affect identity

- **WHEN** the same sources are supplied in a different order
- **THEN** the computed identity is the same, because sources are sorted by permanent identity

### Requirement: The resolved set is materialized into the checkout being worked on

The knowledge a project receives SHALL be written into the checkout being worked on, at the location the relevant tool uses, and SHALL be reconciled there when the project is set up or updated. A tool whose knowledge location is machine-wide rather than per-project SHALL receive only machine-wide knowledge, never a project's or a Store's. The result SHALL report what was written, what was left alone, and anything deferred or blocked.

#### Scenario: Files land in the checkout being worked on

- **WHEN** the resolved set is materialized during setup or update
- **THEN** the files are written into the checkout the session is working in
- **AND** not into the project's knowledge storage location

#### Scenario: A machine-wide tool receives only machine-wide knowledge

- **WHEN** a tool's knowledge location is machine-wide
- **THEN** it receives only machine-wide knowledge
- **AND** no project or Store knowledge is written there

#### Scenario: The result is complete and repeatable

- **WHEN** materialization runs twice with nothing changed in between
- **THEN** the second run writes nothing and reports the same resolved set

#### Scenario: Materialized paths are cross-platform

- **WHEN** materialization runs on Windows
- **THEN** every written path is composed with platform path resolution
- **AND** a checkout differing only by drive-letter case or separator form is recognized as the same checkout

