# Planning Context: store-identity-auto-migrate

## User intent (verbatim)
"开始修复，开worktree，在origin/dev/0.1.6开修复分支，修复完提pr。我会使用修复后的版本再跑update，来验证是否成功"

Triggered by: a real `rasen update` (0.1.5 → 0.1.6-dev.local.1) left the `storeMemberships` identity warning firing on every subsequent command. The user's position: a one-time data migration that nags on every invocation should be performed automatically by `rasen update`, not left as a manual per-store `rasen store upgrade-identity <store> --apply`.

## Validation criterion (HARD acceptance gate)
After this fix ships, the user rebuilds the dev-local install from this branch and re-runs `rasen update`; the `storeMembershipsWithoutIdentity` warning MUST no longer fire on the following operations. The repro is reliable on this machine today (4 stores, 2 missing permanent identities).

## Root cause (ALREADY DIAGNOSED — do not re-derive, only verify)
1. **Warning emitter** — `src/core/project-config.ts`, function `parseStoreMembershipList`: when a `storeMemberships` hint is `identityless` (no `uid`) it calls `warnConfig({ key: 'storeMembershipsWithoutIdentity', fallback: "Some 'storeMemberships' entries name a store only by display name; run 'rasen store upgrade-identity <store> --apply' so the hint survives a rename" })` at ~line 621. It fires on **every project-config parse** → maximum noise for a one-time migration.
2. **`store upgrade-identity`** — `src/commands/store.ts` ~line 1334 (`upgradeIdentity()`) and the command registration ~line 1480. It is **single-store only**: `<id>` with opts `--uid/--dry-run/--apply/--json`. **There is NO `--all` / batch mode.** Core logic lives in `src/core/store/upgrade-identity.ts` (`writeDurablePointer`, the identity plan).
3. **The machine store-registry re-key is GATED** — a dry-run reports "Re-key the machine store registry by permanent identity. Blocked: … need upgrade-identity first: <other stores>". The re-key only proceeds once **every** registered store carries a permanent identity. So today there is NO single command that completes the migration; a user must manually loop stores in dependency order.
4. **`rasen update`** only propagates tools + version across registered projects (the project-install-manifest / update-sync-new-workflows features). It runs **no** store-identity migration. ⚠️ The update command module is **NOT** `src/commands/update.ts` (that glob is empty) — **LOCATE the actual module first** (try `src/commands/bootstrap.ts`, and grep the command registry / `program.command('update')`) before designing the hook.

## Empirical repro on this machine (`rasen store list --json`)
11 entries, `status: []`. The four `type: store` entries:
- `elftia-store` — UID `a9da9342…` ✅ already has identity
- `scene-bridge-store` — UID `0025c1ef…` ✅ already has identity
- `rasen-store` — **missing UID** ❌ (preview would assign `2c292b3f…`)
- `session-context-dogfood-0725` — **missing UID** ❌ — and this one is a **dogfood TEST FIXTURE** under `~/.rasen/projects/autonomy-ladder-1e42477e/.../dogfood-fixture/store`

The re-key is blocked by the two missing-UID stores. **The fix must handle (or skip-and-report) unresolvable/fixture/locked stores without deadlocking the batch or the re-key** — a stale dogfood entry is exactly the case that would hang a naïve "upgrade all" loop.

## The design tension (the reason it is not auto today)
The migration writes **Git-tracked files**: a store's own `.rasen-store/store.yaml` (records the UID), and possibly project `rasen/config.yaml` `storeMemberships` hints. rasen's discipline is "NEVER touch the git index; always `renderSuggestedCommit` and let the user commit" — visible throughout `src/core/store/migration-ops.ts` (`adopt`/`eject`/`relocate` all return `suggestedCommits`, never auto-commit). Auto-applying inside `rasen update` would silently dirty many repos' working trees. The resolution must respect this — mirror `store adopt`'s `suggestedCommits` pattern: apply + emit a per-repo "these files changed, commit them" summary.

## Key design questions the proposal MUST answer
1. **Minimal writes to clear the warning** — trace `parseStoreMembershipList` and how a membership hint gains a `uid`. Is it the store's `.rasen-store/store.yaml` UID alone, the project-side hint, or both? Determine the exact set so the fix is minimal and the test asserts the warning goes silent.
2. **Hook point in `rasen update`** — locate the update module; identify the cleanest place to run a "migrate all store identities" pass after tool/version propagation.
3. **Batch primitive** — add a reusable `migrateAllStoreIdentities` (and/or `store upgrade-identity --all`) that handles the "re-key blocked until all stores have UIDs" ordering **internally**, then have `update` call it. Recommended over an update-only inline loop (reusable + independently testable).
4. **Unresolvable stores** — a store whose path is gone, is a fixture, or is locked must be reported and skipped, not deadlock the batch/re-key.
5. **(Secondary) warning noise** — dedup the parse-path warning per run, or surface it only under `doctor`. Primary fix = update performs the migration; noise reduction is secondary but cheap and valuable.

## Constraints
- **Branch target: `dev/0.1.6`** (0.1.x-line store-system fix, NOT 0.2.0). PR to `dev/0.1.6`.
- **Delivery**: user rebuilds dev-local from this branch and re-runs `rasen update` to validate. Branch must build; the fix must take effect on `update`.
- Respect rasen's git discipline: no auto-commit; suggest commits for any Git-tracked write.
- Do not break existing single-store `upgrade-identity`, `store list`, or `doctor`.
- Author != verifier for the review stage.

## Files to read first
- `src/core/project-config.ts` — emitter, `STORE_MEMBERSHIPS_FIELD`, `parseStoreMembershipList`
- `src/commands/store.ts` — `upgrade-identity` command + `upgradeIdentity()`
- `src/core/store/upgrade-identity.ts` — core logic, `writeDurablePointer`
- `src/core/store/migration-ops.ts` — batch + `renderSuggestedCommit` patterns to mirror
- `src/core/store/registry.ts` + `foundation.ts` — machine store-registry read/write + the re-key
- The `rasen update` command module — **LOCATE** (grep `program.command('update')` / `.command('update')`; check `src/commands/bootstrap.ts`)
- Tests: `test/commands/store-identity-cli.test.ts`, `test/core/store/identity*.test.ts`, `test/core/store/bootstrap.test.ts`, `test/core/project-config-store-memberships.test.ts`

## Out of scope
- The legacy adoption-manifest → per-project-record migration (`store migrate-membership`, `migrateStoreMembership` in migration-ops.ts) is a DIFFERENT migration — do not conflate.
- Anything 0.2.0-only; this targets `dev/0.1.6`.
