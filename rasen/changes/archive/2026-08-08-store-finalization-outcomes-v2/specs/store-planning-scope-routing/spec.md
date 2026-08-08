## MODIFIED Requirements

### Requirement: Layout and planning binding states fail closed with a read-only legacy layout

Scope resolution SHALL distinguish standalone planning, legacy flat Store planning, Store v2 aggregate planning, and Store v2 project planning from explicit metadata and verified catalogs rather than directory inference. A legacy flat Store SHALL remain fully readable through one frozen legacy adapter, and its planning tree SHALL be read-only: Change creation, archiving, and adoption into it SHALL fail with `legacy_flat_store_requires_migration`, naming the layout migration command. No Store v2 destination SHALL ever be written through the legacy adapter. A project recorded as Store-bound SHALL use only its Store project partition; a remaining local planning tree SHALL be reported as `split_planning_truth`, SHALL NOT be merged into Store reads, and SHALL block mutation.

#### Scenario: Legacy flat Store remains inspectable

- **WHEN** a Store has no v2 layout declaration and contains legacy flat planning content
- **THEN** supported list, show, validate, status, instructions, export, doctor, and migration inspection SHALL read that legacy content from one frozen legacy scope
- **AND** no read SHALL upgrade or copy the Store

#### Scenario: Legacy flat Store refuses planning writes until it is migrated

- **WHEN** Change creation, archiving, or adoption targets a legacy flat Store
- **THEN** it SHALL fail with `legacy_flat_store_requires_migration` before writing, moving, or deleting anything
- **AND** the diagnostic SHALL name the layout migration command as the repair
- **AND** no Store v2 project destination SHALL be written, and no Store v2 Change identity SHALL be minted

#### Scenario: A migrated Store regains planning writes

- **WHEN** the same Store has been migrated to layout version 2 and a project scope is selected
- **THEN** Change creation SHALL proceed against that project's partition
- **AND** archiving SHALL proceed as a change finalization with an explicitly declared outcome, reporting neither `legacy_flat_store_requires_migration` nor any finalization-unavailable deferral
- **AND** no root-level Store `rasen/changes` or `rasen/specs` path SHALL be written

#### Scenario: A Store v2 destination is never written through the legacy adapter

- **WHEN** a Store declares `layoutVersion: 2` and any planning mutation would resolve a flat root-level `rasen/changes` or `rasen/specs` destination inside it
- **THEN** the mutation SHALL fail rather than write that flat destination
- **AND** no project partition SHALL be written without the required project, target-line, and planning-worktree authority

#### Scenario: Legacy flat Store refuses work migration

- **WHEN** `rasen work migrate` resolves a legacy flat Store as its planning root
- **THEN** it SHALL fail with `legacy_flat_store_requires_migration` before moving any file
- **AND** neither the Store nor the member checkout SHALL be modified

#### Scenario: Bound project has residual local planning

- **WHEN** project P is verified as bound to Store S but P's checkout still has a local planning tree
- **THEN** ordinary Store-backed reads SHALL use only S as planning truth and report `split_planning_truth`
- **AND** every project planning mutation SHALL fail until migration or repair removes the conflict

## ADDED Requirements

### Requirement: Finalizing a Store v2 Change is its own scope intent

Scope resolution SHALL expose a finalization intent distinct from project read and Change creation. A finalization scope SHALL require an existing Change whose committed v2 identity verifies, a resolved stable target line matching the one frozen in that identity, and verified planning-worktree authority, failing with `project_scope_required`, `target_line_required`, `planning_worktree_required`, or a target-line mismatch as applicable, and never falling back to the Store integration checkout. It SHALL expose the project's canonical specs, the applicable Archive line, and the addressed Archive entry for the Change's verified instance as scope-owned typed locations, with the entry address always contained by the Archive line it belongs to on both Windows and POSIX path semantics. A standalone project and a legacy flat Store SHALL resolve their existing flat archive location through the same intent, minting no Store v2 identity and computing no v2 address.

#### Scenario: Finalization requires more authority than a project read

- **WHEN** a finalization scope is requested where a project read would succeed but no target line or planning-worktree authority is available
- **THEN** it SHALL fail with `target_line_required` or `planning_worktree_required`
- **AND** no Archive entry address SHALL be returned

#### Scenario: The Archive entry address is scope-owned and contained

- **WHEN** a finalization scope resolves the Archive entry address for a Change's verified instance
- **THEN** the address SHALL be contained by that project's stable target-line Archive line location
- **AND** the same semantic address SHALL be computed with Windows and POSIX path semantics without a separator assumption

#### Scenario: A malformed instance cannot address an entry

- **WHEN** an Archive entry address is requested with a malformed or unverified Change instance identity
- **THEN** resolution SHALL reject it before returning a path
- **AND** no filesystem access SHALL occur at the candidate location
