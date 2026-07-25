## ADDED Requirements

### Requirement: Planning identity and knowledge ownership remain distinct

Every learned-skill operation SHALL resolve and report a typed knowledge owner
independently from the planning root used by the active change. A project,
store, or global owner SHALL retain its namespace identity even when the
planning root has another type, and neither identity SHALL be inferred from the
other merely because their roots or IDs are related.

#### Scenario: Store-backed planning retains project ownership

- **WHEN** a registered project launches a retain/codify or knowledge operation while its change planning root is `store:team`
- **THEN** the operation resolves the planning root as `store:team`
- **AND** resolves the knowledge owner as that registered project
- **AND** project-private knowledge is addressed under the project owner rather than the planning store

#### Scenario: Direct store planning does not fabricate a project owner

- **WHEN** an operation is launched directly from a registered store with several eligible member projects and no explicit project selector
- **THEN** the operation reports that project ownership is ambiguous
- **AND** no member project is selected by ordering, current directory name, or candidate content

#### Scenario: Same bare ID in two namespaces remains typed

- **WHEN** the store namespace and project namespace both contain the ID `platform`
- **THEN** a resolved owner includes whether it is `store:platform` or `project:platform`
- **AND** the two owners address distinct knowledge identities

### Requirement: Knowledge ownership resolves from authoritative identity

The CLI SHALL resolve a knowledge owner from an applicable frozen run identity,
an explicit typed selector, or verified project/store registry and identity
metadata. Candidate-declared IDs, evidence text, model output, directory
basenames, and current working directory without verified identity SHALL NOT
select an owner. Unknown, unhealthy, stale, contradictory, or ambiguous
identity SHALL produce a deterministic diagnostic before canonical
learned-skill state is read for mutation or changed.

#### Scenario: Registered pointer project is unambiguous without a new flag

- **WHEN** a user runs a project-scoped knowledge operation from a registered pointer project whose planning content is hosted by a store
- **THEN** the CLI resolves the pointer project as the owner from verified project identity
- **AND** preserves the existing zero-selector project workflow

#### Scenario: Candidate project ID cannot redirect ownership

- **WHEN** a candidate claims a project ID different from the authoritative project owner resolved for the invocation
- **THEN** the operation rejects the ownership mismatch
- **AND** neither claimed project's canonical state is changed

#### Scenario: Stale frozen owner is refused

- **WHEN** a retained run names a typed project or store owner that no longer resolves to valid registry and identity facts
- **THEN** resume reports a stale-owner diagnostic with repair guidance
- **AND** does not fall back to the resume process's current directory

#### Scenario: Windows path aliases preserve one verified owner

- **WHEN** a Windows launch path reaches the same registered project through different drive-letter case, separators, or a canonical filesystem alias
- **THEN** owner resolution uses platform-native canonical path handling
- **AND** returns the same typed project identity

### Requirement: Every knowledge operation uses the same resolved owner

`rasen knowledge apply`, `list`, `show`, and `retire` SHALL use one shared
knowledge-owner resolution contract. A project-scoped v1 operation SHALL
require a matching project owner, a global v1 operation SHALL use the global
owner, and a store owner SHALL remain typed for the store-scope capability
rather than being treated as a project. Human and JSON output SHALL identify
owner-resolution failures consistently.

#### Scenario: Apply and show agree on project ownership

- **WHEN** a user applies a project-scoped candidate and then shows its ID under the same resolved project
- **THEN** both commands address the same project owner and canonical project record

#### Scenario: Global operation does not borrow selected project ownership

- **WHEN** a global candidate is submitted together with an unrelated project or store owner selector
- **THEN** the CLI rejects the owner/scope mismatch before seeking global approval
- **AND** global and selected-owner state remain unchanged

#### Scenario: Store owner is not coerced into project v1 storage

- **WHEN** a store owner is resolved before store-scoped persistence is available
- **THEN** the command reports a stable store-scope-unavailable diagnostic
- **AND** does not write the store record into a project machine home

#### Scenario: JSON ambiguity is actionable

- **WHEN** a non-interactive knowledge command cannot determine one authoritative owner
- **THEN** its JSON error includes a stable diagnostic code and typed selector guidance
- **AND** it does not prompt or choose an owner

### Requirement: Retain freezes knowledge identity for resume

On first entry to retain/codify, the run SHALL persist a versioned typed
knowledge context containing the planning-root identity and knowledge-owner
identity. Resume SHALL prefer that frozen identity over later launch-directory
or selector changes, revalidate its current registry facts, and reject a
conflicting new selector. Absolute machine paths SHALL be re-resolved rather
than treated as portable persisted identity.

#### Scenario: Resume from another directory keeps the original owner

- **WHEN** a codify run freezes `planningRoot=store:team` and `owner=project:web` and is later resumed from another directory
- **THEN** resume continues with `project:web` as the knowledge owner
- **AND** the new current working directory does not redirect the mutation

#### Scenario: Conflicting resume selector is rejected

- **WHEN** a run has frozen `owner=project:web` and resume supplies `--project api`
- **THEN** resume reports the conflict
- **AND** retains the frozen owner without changing either project's knowledge

#### Scenario: Existing run-state gains context conservatively

- **WHEN** readable pre-change run-state has no frozen knowledge context and its launch facts resolve one authoritative owner
- **THEN** the first knowledge operation freezes that typed context and proceeds

#### Scenario: Ambiguous existing run-state pauses before candidate creation

- **WHEN** readable pre-change run-state has no knowledge context and is resumed from facts that admit several owners
- **THEN** retain/codify requests an explicit typed owner
- **AND** no candidate or canonical learned-skill mutation is produced

### Requirement: Existing strict learned-skill data remains readable

Candidate version 1 and learned-skill manifest version 1 SHALL remain readable
under the knowledge-context change. Resolving typed invocation identity SHALL
not reinterpret a valid v1 project record as store-owned or require rewriting
canonical data merely to list, show, or continue an unambiguous project
operation.

#### Scenario: Existing project manifest is listed unchanged

- **WHEN** an unambiguous registered project contains a valid managed manifest version 1
- **THEN** `rasen knowledge list` and `show` read the record under that project owner
- **AND** the read does not rewrite its manifest

#### Scenario: Existing strict candidate still applies

- **WHEN** a valid candidate version 1 requests a project mutation and the invocation resolves the matching project owner
- **THEN** the candidate passes the existing strict shape validation
- **AND** the resolved context supplies authority without adding unknown fields to the candidate file
