# store-config-inheritance Delta Specification

## ADDED Requirements

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

### Requirement: Inactive inheritance degrades without failing

When the `store:` pointer beside local planning names a store that is not registered on the machine, or the pointer is malformed, configuration inheritance SHALL be inactive: resolution proceeds with no store layer and commands do not fail because of the pointer. Cross-platform: pointer and registry root comparisons SHALL be canonical-path based, so a Windows root differing only by case or separator form still matches.

#### Scenario: Unregistered store yields no layer

- **WHEN** a project with local planning declares `store: nowhere` and no store `nowhere` is registered
- **THEN** effective configuration resolves from project, global, and default layers only, and the command succeeds

#### Scenario: Registered root matches canonically on Windows

- **WHEN** the store registry records the store root with a different drive-letter case or separator form than the resolved pointer path
- **THEN** the store is still recognized and its layer applies

### Requirement: Root selection reports inheritance instead of ignoring the pointer

When root selection encounters a planning-shaped root that declares a well-formed `store:` pointer, it SHALL no longer warn that the declaration is ignored. If the named store is registered, the notice SHALL state that planning stays local and configuration inherits from that store. If the named store is not registered, the notice SHALL warn that the declaration currently has no effect and how to register the store. The notice SHALL be localized in every supported CLI locale.

#### Scenario: Inheriting notice for a registered store

- **WHEN** a command resolves a planning-shaped root whose config declares `store: team-store` and `team-store` is registered
- **THEN** the emitted notice names `team-store` and states that configuration inherits from it (not that the declaration is ignored)

#### Scenario: Inactive-pointer warning for an unregistered store

- **WHEN** the declared store is not registered on the machine
- **THEN** the emitted notice warns the declaration has no effect and points at registering the store

#### Scenario: Behavior change is called out in the changelog

- **WHEN** a user reads the release notes for the version introducing this capability
- **THEN** the changelog states that a project declaring `store:` alongside local planning now inherits configuration from that store where it previously did not
