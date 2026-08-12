## ADDED Requirements

### Requirement: Project selection verifies registry and config identity
After a project-only selector matches a registered project by normalized identity, display name, or canonical absolute root, planning resolution SHALL verify that every selected registry identity agrees with any `projectId` declared by the selected root's config. A genuine normalized mismatch SHALL return `planning_selection_conflict` before planning content is accessed and SHALL NOT adopt either identity by precedence.

#### Scenario: Equivalent normalized identity remains selectable
- **WHEN** a project selector, registry entry, and selected root config use equivalent normalized forms of the same project identity
- **THEN** planning resolution accepts that identity and continues with the selected project's verified planning binding

#### Scenario: Normalized id match exposes config drift
- **WHEN** a selector matches a machine registry entry by normalized project identity but the selected root config declares a different normalized `projectId`
- **THEN** planning resolution returns `planning_selection_conflict` naming the registry and config identities
- **AND** it does not replace the requested identity with the config value

#### Scenario: Name or root selection also exposes drift
- **WHEN** a selector matches a registry entry by display name or canonical absolute root and that root's config declares a different project identity
- **THEN** planning resolution returns the same identity-conflict diagnostic before following a Store binding or locating planning content

#### Scenario: Drift refusal has no side effects
- **WHEN** project selection is refused for registry/config identity drift
- **THEN** no registry, config, project home, planning binding, or planning directory is created or modified
