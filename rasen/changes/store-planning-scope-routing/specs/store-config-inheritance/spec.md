## MODIFIED Requirements

### Requirement: A store pointer beside local planning declares configuration inheritance

An unbound project whose `rasen/config.yaml` declares `store: <store-id>` while the project keeps its own local planning shape (a `rasen/specs/` or `rasen/changes/` directory) SHALL mean: planning stays local, and configuration inherits from the named Store. The named Store's own `rasen/config.yaml` SHALL contribute a Store layer to the project's configuration resolution, sitting between the project layer and the global layer (see `config-resolution`). This interpretation applies only while the Store's project catalog does not record the project as planning-bound. If the verified catalog records the project as bound, the Store project partition is the planning truth; a remaining local planning shape SHALL be reported as `split_planning_truth`, SHALL NOT become an inheritance-only local planning root, and SHALL block planning mutations.

#### Scenario: Inherited value resolves for an unbound project

- **WHEN** an unbound project with local planning shape declares `store: team-store`, `team-store` is registered with `handoff.threshold: 0.7`, and the project config does not set `handoff.threshold`
- **THEN** the project's effective `handoff.threshold` SHALL be 0.7 with a source identifying the Store layer

#### Scenario: Project value wins over the inherited Store value

- **WHEN** the same unbound project's own config sets `handoff.threshold: 0.4` while the Store sets 0.7
- **THEN** the effective value SHALL be 0.4 with source `project`
- **AND** the Store's 0.7 SHALL remain visible as the raw Store-layer value

#### Scenario: Unbound planning stays local

- **WHEN** an unbound project with local planning shape declares `store: team-store`
- **THEN** changes, specs, and every planning command SHALL keep resolving to the project's local planning scope
- **AND** the Store declaration SHALL affect configuration only

#### Scenario: Bound project with local planning fails as split truth

- **WHEN** Store `team-store` records the project as planning-bound and the project's checkout still contains a local planning shape
- **THEN** planning resolution SHALL report `split_planning_truth`
- **AND** no project planning mutation SHALL write either tree

### Requirement: A store pointer without local planning keeps pointer-repo semantics

A `store: <store-id>` declaration in a project checkout with no local planning shape SHALL continue to locate Store-owned planning. For a legacy flat Store, commands SHALL resolve that Store's existing flat planning scope with its established read and write behavior. For a Store declaring layout v2, the checkout's canonical `projectId` SHALL be verified against that Store's version 2 project catalog and `planningBinding.state: bound`; planning SHALL resolve to that project's partition rather than to the Store root. Mere Store membership or a pointer without a bound catalog record SHALL NOT transfer planning ownership. Configuration SHALL come from the resolved planning scope rather than adding a second inherited layer.

#### Scenario: Legacy pointer checkout keeps its established behavior

- **WHEN** a project checkout has no local planning shape and declares a legacy flat Store
- **THEN** commands SHALL resolve that Store's legacy planning scope as before, for both reads and writes
- **AND** no additional Store inheritance layer SHALL apply

#### Scenario: Bound Store v2 checkout resolves its project partition

- **WHEN** checkout P has no local planning shape, declares Store S, and S's v2 project catalog records P as planning-bound
- **THEN** project planning commands SHALL resolve `rasen/projects/<projectId>/` in S's selected planning checkout
- **AND** root-level Store Changes or specs SHALL NOT be treated as P's content

#### Scenario: Membership without planning binding stays unbound

- **WHEN** Store S records project P as a member but its project catalog does not record a bound planning state
- **THEN** P's pointer SHALL NOT grant Store project planning authority
- **AND** a command requiring planning SHALL report the missing or unbound planning relationship without writing either location

#### Scenario: Pointer and catalog name different Stores

- **WHEN** P's declaration locates Store A but P's verified planning binding names Store B
- **THEN** planning resolution SHALL fail with a scope-conflict diagnostic
- **AND** it SHALL NOT choose either Store from precedence alone
