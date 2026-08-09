## MODIFIED Requirements

### Requirement: Change Storage Convention

Change proposals SHALL store only the additions, modifications, and removals to specifications, not complete future states. A `MODIFIED` requirement SHALL be a complete replacement for that requirement, including every scenario that should remain after synchronization; omission therefore expresses deletion rather than "unchanged." Scenario headings SHALL remain stable when their behavior is edited, while a scenario rename SHALL be authored as an explicit deletion-plus-addition decision rather than inferred from similar prose.

#### Scenario: Creating change proposals with additions

- **WHEN** creating a change proposal that adds new requirements
- **THEN** include only the new requirements under `## ADDED Requirements`
- **AND** each requirement SHALL include its complete content
- **AND** use the standard structured format for requirements and scenarios

#### Scenario: Creating change proposals with modifications

- **WHEN** creating a change proposal that modifies existing requirements
- **THEN** include the modified requirements under `## MODIFIED Requirements`
- **AND** use the same header text as in the current spec (normalized)
- **AND** include the complete modified requirement (not a diff)
- **AND** include every current scenario that should survive, copying unchanged scenarios verbatim
- **AND** optionally annotate what changed with inline comments like `← (was X)`

#### Scenario: Editing scenario behavior keeps its identity

- **WHEN** a change alters a current scenario's behavior without intending to remove that scenario
- **THEN** the `MODIFIED` requirement SHALL retain the current `#### Scenario:` heading and update its body
- **AND** a different heading SHALL be treated as removal of the old scenario plus addition of a new scenario

#### Scenario: Creating change proposals with removals

- **WHEN** creating a change proposal that removes requirements
- **THEN** list them under `## REMOVED Requirements`
- **AND** use the normalized header text for identification
- **AND** include reason for removal
- **AND** document any migration path if applicable

The `changes/[name]/specs/` directory SHALL contain:
- Delta files showing only what changes
- Sections for ADDED, MODIFIED, REMOVED, and RENAMED requirements
- Normalized header matching for requirement identification
- Complete requirements using the structured format
- Complete surviving scenario inventories in every MODIFIED requirement
- Clear indication of change type for each requirement

#### Scenario: Using standard output symbols

- **WHEN** displaying delta operations in CLI output
- **THEN** use these standard symbols:
  - `+` for ADDED (green)
  - `~` for MODIFIED (yellow)
  - `-` for REMOVED (red)
  - `→` for RENAMED (cyan)
