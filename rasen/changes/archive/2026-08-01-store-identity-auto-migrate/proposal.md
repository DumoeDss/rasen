## Why

A real `rasen update` (0.1.5 → 0.1.6-dev.local.1) left the `storeMembershipsWithoutIdentity` warning firing on every subsequent command. The root cause: stores created before permanent identities carry no `uid`, and the project-side `storeMemberships` hints that name them carry no `uid` either. The warning emitter (`parseStoreMembershipList` in `src/core/project-config.ts`) fires on **every project-config parse** — maximum noise for what is a one-time data migration.

Today the only remediation is the single-store `rasen store upgrade-identity <store> --apply` command, which the user must run manually for each affected store **in dependency order**: the machine store-registry re-key to the identity-keyed v2 form is gated on **every** registered store carrying a permanent identity, so a single identityless store blocks the re-key for the whole fleet. There is no batch command and `rasen update` performs no store-identity work at all. A stale dogfood fixture entry blocking the re-key is exactly the case that would hang a naïve "upgrade all" loop.

This change makes `rasen update` complete the migration automatically: it runs a batch identity-migration pass after tool/version propagation, minting permanent identities for eligible stores, backfilling the uid into every affected project's `storeMemberships` hints, and re-keying the machine registry — all while respecting rasen's "never auto-commit" discipline and reporting stores it cannot reach.

## What Changes

- **`rasen update` runs a store-identity migration pass.** After updating tools and offering the multi-project upgrade, `update` calls a new `migrateAllStoreIdentities` core function that mints permanent identities for eligible identityless stores and backfills the uid into project configs. The pass is machine-wide and runs once per top-level invocation (not in recursive `--only-this` sub-updates).
- **A reusable batch primitive: `migrateAllStoreIdentities`.** New core function in `src/core/store/identity-migration.ts` that lists identityless registered stores, mints and writes the store-metadata uid, backfills the uid into every registered project's `storeMemberships` hints, and then re-keys the machine registry — handling the "re-key blocked until all stores have UIDs" ordering internally so callers never manage dependency order.
- **`rasen store upgrade-identity --all`.** The existing single-store command gains an `--all` flag that invokes the same batch primitive, giving users a direct entry point independent of `update`. Supports `--dry-run` (default) and `--apply`, plus `--json`.
- **Report-and-skip for unresolvable stores.** A store whose path is gone, whose metadata is unreadable, or that is locked is recorded as skipped with a reason and the batch continues. The registry re-key attempt naturally reports any stores that still block it. The batch never throws on a per-store failure.
- **Git discipline preserved.** Store metadata (`<store>/.rasen-store/store.yaml`) and project config (`<project>/rasen/config.yaml`) are Git-tracked; the migration applies the writes but never commits, emitting a `suggestedCommits` summary per repository — mirroring `store adopt`/`eject`/`relocate` in `migration-ops.ts`. The machine registry is machine-local and never committed.
- **Warning message updated + deduplicated.** The `storeMembershipsWithoutIdentity` warning message is updated to point at `rasen update` (now the primary remediation path), and a process-scoped dedup ensures it fires at most once per command invocation rather than once per config parse.
- **The `storeMemberships` hint backfill.** A new `backfillStoreMembershipUid` function in `src/core/project-config.ts` finds `storeMemberships` entries that name a store by alias without a uid and adds the now-known uid, handling the fact that the hint dedup key changes when a uid is added (the existing `appendStoreMembershipHint` would append a duplicate rather than merge).

Out of scope: the legacy adoption-manifest → per-project-record migration (`store migrate-membership`) is a different migration and is not touched. Anything 0.2.0-only. Changing the permanent-identity minting or verification logic itself.

## Capabilities

### Modified Capabilities
- `store-identity`: the upgrade path gains a batch mode (`--all`) and an automatic trigger inside `rasen update`. The "explicit and previewable" requirement is broadened: `update` is now an explicit trigger alongside `upgrade-identity`, and the batch is previewable via `--dry-run` (the default for the CLI surface). The "reading never upgrades" invariant is preserved — the migration is a write-path action, never a read-path side effect.
- `cli-update`: `update` gains a post-propagation store-identity migration step, mirroring how it already refreshes the version cache and offers multi-project updates. The step is best-effort and never aborts the update on a per-store failure.

## Impact

- **Store metadata** (`<store>/.rasen-store/store.yaml`): identityless stores gain a version-2 shape with a minted uid. Already-identified stores are untouched.
- **Project configuration** (`<project>/rasen/config.yaml`): `storeMemberships` entries naming an upgraded store by alias gain the `uid` field. The `store:` declaration of the current project (where `update` runs) is upgraded from alias form to durable form when applicable.
- **Machine Store registry** (`~/.rasen/stores/registry.yaml`): re-keyed from v1 (alias-keyed) to v2 (identity-keyed) once every resolvable store carries a permanent identity. Stores that cannot be resolved are reported as blocking the re-key.
- **Code**: new `src/core/store/identity-migration.ts` (the batch primitive); `src/core/store/upgrade-identity.ts` (shared helpers); `src/core/project-config.ts` (the `backfillStoreMembershipUid` writer + warning message/dedup); `src/core/update.ts` (the hook point); `src/commands/store.ts` (the `--all` flag); `src/core/config-diagnostics.ts` or `config-diagnostic-locale.ts` (per-run dedup); locale bundles (`en` / `zh-cn` / `ja`).
- **Commands**: `rasen update` (new migration step), `rasen store upgrade-identity` (new `--all` flag). No change to `rasen store list`, `rasen store doctor`, `rasen doctor`, or the single-store upgrade-identity flow.
- **Compatibility**: no data written by an earlier version becomes unreadable. The single-store `upgrade-identity <id>` interface is unchanged. The batch primitive is additive.
