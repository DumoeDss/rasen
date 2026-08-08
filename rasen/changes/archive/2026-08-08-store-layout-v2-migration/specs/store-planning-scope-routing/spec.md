## REMOVED Requirements

### Requirement: Layout and planning binding states fail closed

**Reason**: This requirement guaranteed that "a legacy flat Store SHALL keep its existing read and write behavior", and its scenario "Legacy flat Store keeps writing its own flat layout" made that a contract. `store-planning-scope-routing` wrote that guarantee down deliberately, and deferred the withdrawal to this slice, because withdrawing it before the migration existed would have left every Store write-dead. This slice ships the migration, so the guarantee is withdrawn and the scenario is retired rather than reinterpreted.

**Migration**: Replaced by "Layout and planning binding states fail closed with a read-only legacy layout" below, which keeps every other scenario byte-identical and states the refusal in place of the retired write guarantee. A Store that still needs to write runs `rasen store migrate-layout <store-id>` once; nothing else about scope resolution changes.

## ADDED Requirements

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
- **AND** archiving SHALL no longer report `legacy_flat_store_requires_migration`, and SHALL report `store_v2_finalization_unavailable` until the Store v2 finalization owner activates it
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
