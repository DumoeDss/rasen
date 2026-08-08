## MODIFIED Requirements

### Requirement: Machine-readable context describes scope without granting authority

Root and planning-context JSON SHALL identify whether the result is standalone, legacy Store, Store aggregate, or Store project scope and SHALL expose the resolved Store UID/alias, project id, target-line id, planning-scope id, layout version, intent, notices, and applicable planning locations. Absent facts SHALL be absent rather than guessed. Absolute paths in the description are local locators for agents and diagnostics; serializing or replaying the description SHALL NOT confer mutation authority. Existing root and planning-home fields MAY remain as compatibility projections, but their paths SHALL be derived from the same scope and SHALL never widen access.

The action context handed to an agent SHALL derive its planning write grant from the resolved planning scope's own typed locations. It SHALL NOT be composed by joining planning directory names onto a planning checkout root, because a Store v2 planning checkout root's `rasen/specs` and `rasen/changes` are exactly the two paths layout v2 forbids: the grant would then name two locations the scope refuses to write and omit the project partition the scope actually writes.

#### Scenario: Store project context is auditable

- **WHEN** `rasen context --json` or change status resolves a Store v2 project scope
- **THEN** the payload SHALL name the Store, project, target line, layout, scope identity, and applicable project planning locations
- **AND** it SHALL distinguish the Store planning worktree from any execution checkout when those facts are available

#### Scenario: Aggregate context has no fabricated project home

- **WHEN** context resolves only a Store aggregate scope
- **THEN** project, target-line, Change, specs, and project-archive locations SHALL be absent
- **AND** the payload SHALL state that project authority is required for project content

#### Scenario: Compatibility output is derived from the selected scope

- **WHEN** a legacy consumer reads root or planning-home compatibility fields
- **THEN** every field SHALL be a projection of the selected scope's resolved locations
- **AND** no compatibility field SHALL identify a broader writable root than the current action context permits

#### Scenario: The action context's planning grant is the resolved scope's own locations

- **WHEN** an action context is built for a session whose planning scope is a Store v2 project
- **THEN** its planning write grant SHALL be that project partition's own planning locations
- **AND** no root-level Store `rasen/specs` or `rasen/changes` path SHALL appear in the grant

### Requirement: Every planning consumer crosses the same scope seam

All supported planning-path consumers—including CLI workflow commands, list/show/validate/archive entry points, pipeline Change lookup, item discovery, context, generated workflow guidance, and existing management read models—SHALL receive their locations from the resolved planning scope or its read-only compatibility projection. Commands that address the same scope SHALL agree even when invoked from different directories or with equivalent selectors. Adding a new planning consumer SHALL require choosing a declared scope intent and typed planning address rather than accepting an arbitrary Store-relative path.

A read-only consumer SHALL cross the seam on the same terms as a mutating one. Where a consumer's answer is narrower because the scope could not supply a location — an absent target line, an unreadable ref — it SHALL report the narrowing rather than present the narrowed answer as the complete one.

#### Scenario: Equivalent entry points resolve identically

- **WHEN** equivalent selector and binding facts reach CLI, pipeline, and management read entry points for the same project scope
- **THEN** they SHALL select the same planning owner and locations
- **AND** changing the current directory after scope resolution SHALL not redirect any downstream access

#### Scenario: No caller recreates the flat Store algorithm

- **WHEN** Store v2 project content is accessed through any supported consumer
- **THEN** the consumer SHALL use the project partition returned by scope resolution
- **AND** no root-level Store `rasen/changes` or `rasen/specs` path SHALL be treated as that project's planning location

#### Scenario: A narrowed read says so

- **WHEN** a read consumer can address only part of a Store v2 project's content because the scope supplied no target line
- **THEN** the result SHALL state which dimension was not addressed
- **AND** an empty result for an unaddressed dimension SHALL NOT be reported as an absence of content
