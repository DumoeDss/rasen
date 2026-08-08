## MODIFIED Requirements

### Requirement: A store pointer without local planning keeps pointer-repo semantics

A `store: <store-id>` declaration in a project checkout with no local planning shape SHALL continue to locate Store-owned planning. For a legacy flat Store, commands SHALL resolve that Store's existing flat planning scope for reads; that scope is read-only, and a planning mutation against it SHALL fail with `legacy_flat_store_requires_migration` naming the layout migration command. For a Store declaring layout v2, the checkout's canonical `projectId` SHALL be verified against that Store's version 2 project catalog and `planningBinding.state: bound`; planning SHALL resolve to that project's partition rather than to the Store root. Mere Store membership or a pointer without a bound catalog record SHALL NOT transfer planning ownership. Configuration SHALL come from the resolved planning scope rather than adding a second inherited layer.

#### Scenario: Pointer repo is unchanged

- **WHEN** a project checkout has no local planning shape and declares a legacy flat Store
- **THEN** commands SHALL resolve that Store's legacy planning scope as before for reads, and a planning mutation SHALL fail naming the layout migration command
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
