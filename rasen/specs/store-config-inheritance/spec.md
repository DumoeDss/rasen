# store-config-inheritance Specification

## Purpose

Defines how a project with its own local planning shape can declare a `store:` pointer that inherits configuration (not planning) from a registered store, inserting a store layer into configuration resolution between the project and global layers. Derives from the `ui-config-redesign-store-scope` change proposal.
## Requirements
### Requirement: A store pointer beside local planning declares configuration inheritance

A project whose `rasen/config.yaml` declares `store: <store-id>` while the project keeps its own local planning shape (a `rasen/specs/` or `rasen/changes/` directory) SHALL mean: planning stays local, and configuration inherits from the named store. The named store's own `rasen/config.yaml` SHALL contribute a store layer to the project's configuration resolution, sitting between the project layer and the global layer (see `config-resolution`). The planning root selection itself SHALL be unaffected — the local root still wins exactly as before.

#### Scenario: Inherited value resolves for a member project

- **WHEN** a project with local planning shape declares `store: team-store`, `team-store` is a registered store whose config sets `handoff.threshold: 0.7`, and the project config does not set `handoff.threshold`
- **THEN** the project's effective `handoff.threshold` is 0.7 with a source identifying the store layer

#### Scenario: Project value wins over the inherited store value

- **WHEN** the same project's own config sets `handoff.threshold: 0.4` while the store's config sets 0.7
- **THEN** the effective value is 0.4 with source `project`, and the store's 0.7 remains visible as the raw store-layer value

#### Scenario: Planning stays local

- **WHEN** a project with local planning shape declares `store: team-store`
- **THEN** changes, specs, and every planning command keep resolving to the project's own local root (only configuration inherits)

### Requirement: A store pointer without local planning keeps pointer-repo semantics

A `store: <store-id>` declaration in a repo with NO local planning shape SHALL keep its existing meaning unchanged: the planning root resolves entirely to the store's root (a pointer repo), the repo is listed as a store member rather than a top-level space, and no separate store configuration layer applies — the repo's effective configuration is the store's own by root identity.

#### Scenario: Pointer repo is unchanged

- **WHEN** a repo's `rasen/` holds only a config declaring `store: team-store` and no `specs/` or `changes/` directory
- **THEN** commands run in that repo resolve to `team-store`'s root exactly as before this change, with no additional inheritance layer or new notice

### Requirement: Configuration inheritance is single-hop

Store configuration inheritance SHALL NOT be transitive. When resolving a project's store layer, the named store's own `store:` field, if any, SHALL be ignored — at most one store layer ever applies. A root that is itself a registered store SHALL never receive an inherited store layer from its own `store:` declaration.

#### Scenario: A store's own pointer contributes nothing

- **WHEN** project P declares `store: A`, and store A's own config declares `store: B`
- **THEN** P's resolution uses exactly one store layer (A's values); B's values contribute nothing at any layer

#### Scenario: A store root never inherits

- **WHEN** a registered store's own config declares a `store:` field
- **THEN** resolving configuration for that store's root applies no inherited store layer

### Requirement: Root selection reports inheritance instead of ignoring the pointer

When root selection encounters a planning-shaped root that declares a well-formed `store:` pointer, it SHALL no longer warn that the declaration is ignored. If the declared Store resolves, the notice SHALL state that planning stays local, that configuration inherits from that Store, and whether the Store was resolved by its permanent identity or by its display alias. If the declared Store cannot be resolved, the command SHALL report that the declaration cannot be used on this machine, name the reason, and print the repair command, rather than proceeding with the declaration silently inactive. Every notice SHALL be localized in every supported CLI locale.

#### Scenario: Inheriting notice for a registered store

- **WHEN** a command resolves a planning-shaped root whose config declares a Store and that Store is registered
- **THEN** the emitted notice names the Store and states that configuration inherits from it (not that the declaration is ignored)
- **AND** the notice states whether the permanent identity or the display alias was what resolved

#### Scenario: Inactive-pointer warning for an unregistered store

- **WHEN** the declared Store is not registered on the machine
- **THEN** the command reports that the declared Store cannot be used on this machine, names the reason, and prints the repair command
- **AND** it does not continue as though the project had declared no Store

#### Scenario: Behavior change is called out in the changelog

- **WHEN** a user reads the release notes for the version introducing this capability
- **THEN** the changelog states that a project declaring `store:` alongside local planning now inherits configuration from that Store where it previously did not
- **AND** the changelog states that a declared Store which cannot be resolved now stops the command instead of resolving as though no Store were declared

### Requirement: An unavailable planning Store stops the command instead of degrading

When a project declares a Store for configuration inheritance and that Store cannot be resolved on this machine, the command SHALL stop and report the expected Store, the reason it cannot be used, and a copy-pasteable repair command. It SHALL NOT resolve configuration as though the project had declared no Store. The reasons SHALL be distinguished: not registered on this machine, missing Store metadata, a checkout carrying a different Store identity, an unhealthy Store root, an ambiguous alias, and an unreadable declaration. A project that declares no Store at all SHALL be unaffected and SHALL resolve exactly as before. Root and path comparisons SHALL be canonical, so a Windows root differing only by drive-letter case or separator form still matches and is not mistaken for a different Store.

#### Scenario: Unregistered Store stops the command

- **WHEN** a project with local planning declares `store: nowhere` and no Store `nowhere` is registered
- **THEN** the command fails, naming the declared Store, stating it is not available on this machine, and printing the command that would make it available
- **AND** it does not report configuration resolved from project, global, and default layers only

#### Scenario: Unreadable declaration stops the command

- **WHEN** a project's Store declaration cannot be read as a Store reference
- **THEN** the command fails naming the config file and the problem, with the repair command for fixing the declaration

#### Scenario: No declaration resolves as before

- **WHEN** a project declares no Store at all
- **THEN** configuration resolves from project, global, and default layers with no Store layer, no diagnostic, and no failure

#### Scenario: Registered root matches canonically on Windows

- **WHEN** the Store registry records the Store root with a different drive-letter case or separator form than the resolved declaration path
- **THEN** the Store is still recognized, its layer applies, and no identity mismatch is reported on that basis

#### Scenario: Diagnosis remains available while resolution fails

- **WHEN** a project's declared Store is unavailable for any of the reasons above
- **THEN** `rasen doctor` and `rasen store doctor` still run and report the full diagnosis with its repair command
- **AND** neither command writes, clones, registers, or repairs anything

#### Scenario: Machine scope and Store listing remain available while resolution fails

- **WHEN** a project's declared Store is unavailable and the user reads configuration at machine scope, or lists the Stores registered on this machine
- **THEN** both commands succeed, because neither resolves a project layer and so no Store layer applies
- **AND** the same configuration read at project scope still stops with the reason and the repair command
