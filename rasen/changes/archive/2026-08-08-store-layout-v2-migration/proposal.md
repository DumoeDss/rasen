## Why

Scope routing now refuses to write project planning content into a legacy flat Store, but nothing can move an existing Store to layout v2 and nothing writes new content into a project partition. `store adopt` still moves specs and Changes into the flat `rasen/specs` and `rasen/changes` directories, per-project ownership is still a name list inside a v1 membership record, and a Store that already declares layout v2 has no way to acquire the project catalogs, target-line catalogs, and partitions its own routing seam requires. Every Store therefore remains stuck: read-only if it is flat, and unwritable if it is v2.

Migrating that content is not a rename. Which project owns a flat Change, a flat Archive entry, or a flat canonical spec is a fact the old layout never recorded, and a wrong guess silently reassigns one project's planning history to another. So migration has to be evidence-driven, explicit, previewable, and fail-closed rather than best-effort.

## What Changes

- Add a `StoreLayoutMigrationModule` with `inventory` / `plan` / `apply` and an immutable, content-addressed plan token that is revalidated against Store metadata, Git OIDs, and per-path digests immediately before publication.
- Inventory flat layout **per Git ref**: report every local Store ref that still carries flat planning content, and migrate only the ref checked out in the invoking Store worktree. Migration never checks out, merges, rebases, or rewrites another ref.
- Determine project ownership only from auditable evidence, in fixed priority: identity recorded in the item itself, Store adoption/membership records, Change/Session association consistent with Store membership, and a committed explicit mapping file. Change-name prefixes, branch names, directory adjacency, and "the only similar-looking member project" are never evidence.
- Build a spec provenance graph from every active and archived Change delta. A capability with one contributing project is assigned to it; a capability contributed to by several projects blocks migration until the operator declares an authoritative owner or an explicit per-project split. No anonymous shared spec survives into layout v2.
- Classify every item as resolved, unresolved, or blocked, with a stable taxonomy. `apply` refuses unless every item is resolved and nothing is blocked. There is no `--force` and no partial migration.
- Stage the complete new tree inside the Store worktree, verify it by digest and schema, publish partitions by ordered rename with the `layoutVersion: 2` flip as the single commit point, and retire the flat tree only as a separate, separately committed step. A machine-root recovery manifest makes every phase resumable or reversible while the flat sources still exist.
- Upgrade each v1 membership record to a v2 project catalog, deriving `planningBinding` only from adoption evidence, and preserve the dropped adoption name lists, legacy Archive names, and old alias to new `ChangeInstanceId` mappings in a committed migration receipt.
- Mint v2 Change identity for relocated Changes only when the operator has declared their target line, and write target-line catalogs only from the mapping file's explicit `storeRef` / `codeRef` declarations.
- Move `store adopt` and `store eject` onto project partitions: adopt writes `rasen/projects/<projectId>/`, checks collisions inside that partition only, and records the planning binding before deleting any source; eject restores from the partition and no longer needs an ownership name list.
- Guard against dual writes: every Store planning mutation asserts the Store's declared layout before writing, `archive relocate --to store` requires an explicit target line in a v2 Store, and a source guard rejects new flat Store path joins outside the frozen legacy adapter.
- Add read-only migration diagnostics to `rasen doctor` and `rasen store doctor` for flat refs, mixed flat/v2 residue, unresolved ownership, unresolved shared specs, interrupted runs, orphaned partitions, and leftover v1 membership records.
- **BREAKING (Store v2):** a Store declaring `layoutVersion: 2` no longer accepts adopt, eject, or archive relocation through flat `rasen/specs` and `rasen/changes` paths, and a legacy flat Store refuses those mutations until it is migrated.
- **BREAKING (legacy flat Store):** a Store that has not declared `layoutVersion: 2` now refuses `rasen new change`, `rasen archive`, and `rasen store adopt` with `legacy_flat_store_requires_migration`, naming `rasen store migrate-layout <store-id>` as the repair. This is a user-visible capability loss for every existing Store until it is migrated once, and it lands here rather than in `store-planning-scope-routing` because this change ships the migration that makes it survivable. Reading, listing, validating, `store eject`, and `archive relocate --to in-repo` are unaffected, and a migrated Store regains Change creation against its project partitions. Archiving a migrated Store stops reporting this refusal, but does not yet succeed: it reports `store_v2_finalization_unavailable`, because Store v2 finalization belongs to `store-finalization-outcomes-v2` and this change does not unlock it.

## Capabilities

### New Capabilities

- `store-layout-v2-migration`: per-ref flat inventory, evidence-based ownership and spec provenance, the unresolved/blocked taxonomy and its gates, the immutable plan/token and revalidation contract, staging/publication/retirement/recovery, the committed migration receipt, and the migration diagnostics.

### Modified Capabilities

- `store-adopt`: adopt writes into the project partition of a layout v2 Store, scopes its collision precheck to that partition, binds the project catalog before any source deletion, and requires an explicit target line to relocate an archive.
- `store-eject`: eject restores the project partition rather than a recorded name list, refuses to flatten colliding Archive entries, and keeps the full-copy consent path for legacy flat Stores only.
- `store-project-membership`: in layout v2 the per-project file is the v2 project catalog, dispatched by declared layout version, and the explicit membership migration also covers the v1-record to v2-catalog upgrade with adoption data preserved in the receipt.
- `store-registration`: `store doctor` additionally reports layout-migration drift states, read-only, with the repairing command.
- `archive-relocate`: `--to store` targets a project's stable target-line Archive directory in a layout v2 Store and fails closed without one.

## Impact

- Adds a migration Module beside the Store planning seam, and converts `src/core/store/migration-ops.ts` and `src/core/store/project-records.ts` from flat-layout writers into layout-dispatching consumers of the Foundation layout and catalog contracts.
- Adds `rasen store migrate-layout` with `--dry-run`/`--json`, mapping-file input, `--status`, `--resume`, `--rollback`, and `--retire-flat`, plus `--target-line` on `store adopt` and `archive relocate`.
- Adds one committed Store artifact family, `.rasen-store/migration/receipts/`, and one machine-root coordination family for plans and recovery manifests. Neither Git repository is staged, committed, fetched, or pushed by any command in this change.
- Adds inventory/provenance/gate/staging/recovery/receipt unit suites, adopt/eject partition suites, no-dual-write source and runtime guards, doctor diagnostic coverage, and Windows/POSIX path, Unicode, and long-path fixtures.
- Depends on `store-planning-scope-routing` for scope resolution and on the Foundation layout, catalog, and identity contracts. Worktree pairing and binding, finalization outcomes and Archive v2 records, Store Issue aggregation, and the portfolio-wide compatibility sweep remain later slices; this change does not unlock `store_v2_finalization_unavailable`.
