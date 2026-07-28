# profiles Delta

## ADDED Requirements

### Requirement: A project-scope selection override takes precedence over the profile

When a project's configuration carries a workflow selection override, the desired workflow set for that project SHALL resolve from the override list verbatim plus dependency closure, taking precedence over the user-wide profile (`full`, `core`, `custom`, or a named profile) and independent of the expert-selection migration marker. When no override is present, resolution SHALL be unchanged from today. `rasen profile` SHALL continue to edit only the user-wide selection — an override is created and removed through project-scope configuration, not through the profile editor — and the profile editor's project-drift warning SHALL name an active override rather than presenting the intentional difference as unapplied global config.

#### Scenario: Override wins over the user-wide profile

- **WHEN** the user-wide profile is `full` and a project's config carries a workflow selection override listing a subset
- **THEN** the desired set for that project resolves from the subset plus its dependency closure

#### Scenario: Profile editor leaves overrides alone

- **WHEN** the user edits the selection through `rasen profile`
- **THEN** only the user-wide selection changes, and every project override remains as it was

#### Scenario: Drift evaluates the per-project effective selection

- **WHEN** drift detection runs for a project carrying an override whose installed set matches the override's resolved closure
- **THEN** no drift is reported, even though the installed set differs from the user-wide profile's resolved set
