## ADDED Requirements

### Requirement: Init materializes the effective learned-skill set

The init command SHALL materialize learned skills from one preflight effective
plan. After resolving one authoritative project owner and configured tools,
`rasen init` SHALL preflight the project's active applicable learned skills across the
project, every eligible member store, and global scope. Project-local tool homes
SHALL receive the deterministic `project > store > global` effective set
through typed ownership reconciliation. A known effective store conflict or
post-resolution context-budget failure SHALL prevent every learned-skill file
and learned-ledger write for that init run and SHALL be reported as incomplete
learned materialization; ordinary workflow installation remains a separate
operation.

#### Scenario: Init installs project store and global winners

- **WHEN** a registered project has applicable non-conflicting winners across project, member-store, and global scopes
- **THEN** init materializes the effective winner for each ID into every configured project-local tool home
- **AND** records typed effective sources

#### Scenario: Store conflict blocks learned initialization

- **WHEN** member stores contain divergent applicable records for one effective ID
- **THEN** init writes no learned-skill file or learned ledger for any configured tool
- **AND** reports the sorted conflict while keeping ordinary workflow installation results distinct

#### Scenario: Direct store owner does not select a project home

- **WHEN** init runs with a store owner and no authoritative project owner
- **THEN** it does not choose a member project for project-local learned materialization
- **AND** reports that a resolved project is required

#### Scenario: Hermes receives global scope only

- **WHEN** Hermes and project-local tools are configured together
- **THEN** project-local tools receive their effective project/store/global sets
- **AND** Hermes receives only active approved global records through the machine-global ledger

#### Scenario: Init reports degraded store availability

- **WHEN** an unavailable store may have contributed to the project
- **THEN** init reports unavailable/deferred learned outcomes
- **AND** preserves any exact prior copy whose safe replacement or removal depends on that store
