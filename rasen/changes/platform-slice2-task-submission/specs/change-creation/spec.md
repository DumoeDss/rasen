# change-creation Specification (delta)

## ADDED Requirements

### Requirement: Proposal seeding flag on new change
`rasen new change` SHALL accept a `--proposal <text>` option that writes a minimal `proposal.md` into the created change directory, containing the change name as title and the provided text under a Why section, marked as a submission seed to be developed. A change created with `--proposal` SHALL therefore satisfy the workflow's active-change definition (`getActiveChangeIds`, which requires `proposal.md`) immediately after creation. The flag SHALL be independent of `--description` (which continues to seed `README.md` unchanged) and SHALL appear in the completions command registry and in both the `en` and `ja` locale catalogs.

#### Scenario: Proposal seed makes the change active
- **WHEN** `rasen new change my-feature --proposal "Add feature X"` succeeds
- **THEN** `rasen/changes/my-feature/proposal.md` exists containing the provided text, and the change is listed by commands that enumerate via `getActiveChangeIds`

#### Scenario: Without the flag behavior is unchanged
- **WHEN** `rasen new change my-feature` is run without `--proposal`
- **THEN** no `proposal.md` is created, matching existing behavior

#### Scenario: Empty proposal text rejected
- **WHEN** `rasen new change my-feature --proposal ""` (or whitespace-only) is run
- **THEN** the command fails with an explicit error and no change is left in a silently-inactive state

#### Scenario: Flag is discoverable and localized
- **WHEN** the completions command registry and locale catalogs are checked
- **THEN** the `--proposal` flag has a registry entry under `new change` and description strings in both `en` and `ja` catalogs
