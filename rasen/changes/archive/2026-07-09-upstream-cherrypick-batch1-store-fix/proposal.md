## Why

Upstream `93e27a7` (fix empty store registration, #1328) fixes two related store bugs:

1. **A fresh/empty store cannot be registered.** A store root that has `openspec/config.yaml` but no `specs/`, `changes/`, or `changes/archive/` directories (the normal state right after `git init` + config, and after cloning a store whose empty dirs Git could not track) was reported *unhealthy*, so `store add` / `registerExistingStore` refused it. Empty planning directories are legitimate and should be treated as optional; only a path that *exists but is not a directory* is an error.
2. **A config-only pointer repo is wrongly registrable as a store.** A repo whose `openspec/config.yaml` declares `store: <other>` (its planning is externalized) is *not itself* a store root, but registration accepted it. It must be rejected with a clear message (and a malformed `store:` pointer must also be rejected).

The fix also makes `archive` and `list` tolerate a missing `openspec/changes/` directory (return empty instead of throwing "No … changes directory found"), which is the command-level symptom of the same empty-store issue.

## What Changes

- **`src/core/openspec-root.ts`.** Refactor the specs/changes/archive inspection into `inspectOptionalPlanningDirectory`: a missing planning dir is `{ present: false }` but not a diagnostic; only "exists but not a directory" pushes an `*_not_directory` diagnostic; archive is only inspected when `changes/` is a directory. Health becomes `present && config.present && diagnostics.length === 0` (no longer requires specs/changes/archive to be present).
- **`src/core/store/operations.ts`.** Add `assertNotConfigOnlyPointerRoot(storeRoot)` (using `classifyOpenSpecDir` + `storePointerProblem` from `project-config.ts`); call it in `prepareSetupPlan` (directory branch) and in `registerExistingStore` before the health check. Rejects a declared pointer (`store_root_pointer_declared`) or a malformed pointer (`invalid_store_pointer`).
- **`src/core/archive.ts`.** Add `isMissingPathError`; make `listActiveChangeNames` rethrow non-ENOENT and return `[]` on ENOENT; remove the `fs.access(changesDir)` "No … changes directory found" throw in `run()`; use `listActiveChangeNames` in `selectChange`.
- **`src/core/list.ts`.** Add `isMissingPathError` + `readChangeDirectoryEntries` (ENOENT → `[]`); remove the `fs.access` throw; add trailing newline (EOF fix).
- **Tests.** Port the upstream regressions into `test/commands/{store,store-git,store-root-selection}.test.ts`, `test/core/{archive,list,openspec-root}.test.ts`.

## Fork adaptations vs upstream

- **Drop all `docs/**` hunks** (`docs/agent-contract.md`, `docs/cli.md`, `docs/stores-beta/user-guide.md`) — docs are being deprecated in the fork; this batch does not touch docs.
- **Two source-file conflicts on rebranded error strings:** the removed `fs.access` throw reads `"No Rasen changes directory found. Run 'rasen init' first."` on the fork (upstream: `"No OpenSpec …"`). Since the block is being *deleted*, resolve by deleting the fork's rasen-worded block (`archive.ts` ~L195-202, `list.ts` ~L85-90).
- **Workspace conventions are retained** (`openspec/`, `.openspec-store/`, `config.yaml`), so the ported tests need no path/brand adaptation and pass as-is. `classifyOpenSpecDir`/`storePointerProblem` already exist in the fork's `project-config.ts` with the shape the fix expects.

## Capabilities

### New Capabilities
- `store-registration`: registering an existing OpenSpec store treats empty planning directories as optional (a config-only store is healthy and registrable), rejects a config-only pointer repo (and malformed pointers), and lets `archive`/`list` tolerate a missing `changes/` directory.

### Modified Capabilities
- `cli-list`: a missing `openspec/changes/` directory is treated as an empty change set (`No active changes found.`) instead of throwing an init error.

## Impact

- **Source:** `src/core/openspec-root.ts`, `src/core/store/operations.ts`, `src/core/archive.ts`, `src/core/list.ts`.
- **Tests:** `test/commands/{store,store-git,store-root-selection}.test.ts`, `test/core/{archive,list,openspec-root}.test.ts`.
- **Serial edges:** depends on child A (archive-fixes) — shares `archive.ts`/`archive.test.ts`; D's `archive.ts` diff is cut against the post-`5956a8e` blob. Depends on child C (win-flake) — shares `store-git.test.ts`/`store-root-selection.test.ts`; D's diffs are cut against the post-`296ecbc` blobs that add the `cleanupTempPath` import.
- **Verification:** `pnpm build`; targeted vitest on the store + openspec-root + archive + list test files.
- **Delivery:** local ship (commit only, pathspec-scoped); no push, no tag.

## Simple vs Complex

**Complex** — multi-file change to store health + registration semantics across four source files; needs the store suite plus `openspec-root`/`archive`/`list` unit tests, not a single-file check.
