## 1. Git worktree inventory probe

- [x] 1.1 Add `gitWorktreeList(repoRoot)` to `src/core/store/git.ts`: run `git worktree list --porcelain` via the existing `gitProbe` pattern, parse entries into `{ root, head, branch (null when detached), isMain (first entry), locked, prunable }[]`, return `null` on any failure (design D2)
- [x] 1.2 Unit tests for the porcelain parser: main + linked worktrees, detached HEAD, locked/prunable flags, non-git directory → null, git missing → null (fixture-driven string parsing plus one real-repo integration case)

## 2. Registry piercing (registration + lookup)

- [x] 2.1 Add `resolveRegistrationRoot(canonicalPath)` to `src/core/project-registry.ts` reusing the private `resolveMainRepoDir`: return the canonicalized main-checkout dir when it exists on disk and differs, else the input path (design D1)
- [x] 2.2 Pierce `registerProject`: apply `resolveRegistrationRoot` after canonicalization and derive `name` from the pierced path; keep cases 1/2a/2b/2c operating on the pierced key (spec "Clones fork, worktrees unify, moves rebind")
- [x] 2.3 Prune sibling duplicates on registration write: inside the `updateProjectRegistryState` updater, after `place()`, delete other same-`projectId` entries whose path is a live linked worktree sibling (`isGitWorktreeSibling`) of the placed path (design D5)
- [x] 2.4 Pierce lookups: `findProjectRegistryEntry` (path-exact first, pierced-root fallback) and the `ensure: false` probe in `resolveProjectHome` (`src/core/project-home.ts`); `touchProjectRegistry` computes its entry key, `name`, and `mode` from the pierced root (design D1)
- [x] 2.5 Registry tests (`test/` sibling of the existing project-registry suites): worktree registration creates/refreshes only the main entry; main-checkout-gone fallback registers the worktree root; sibling-duplicate pruning on write; probe and touch from a worktree resolve the main entry; moved-repo and clone-fork behavior unchanged

## 3. Doctor / GC cleanup of legacy duplicates

- [x] 3.1 Extend `gcProjectRegistry` (`src/core/project-registry.ts`): under the existing single lock hold, collapse worktree-duplicate entries — delete when the pierced root is registered with the same `projectId`, rebind (same entry data, same home) when the pierced root exists on disk but is unregistered; keep home refcounting semantics intact (design D5)
- [x] 3.2 Extend `findDanglingProjectEntries`-style reporting with a read-only `findWorktreeDuplicateEntries` and surface it in `rasen doctor`'s registry section (human + `--json`) with the `--gc` hint (spec "Doctor reports and garbage-collects registry rot")
- [x] 3.3 Tests: doctor reports duplicates read-only; `--gc` collapses main+2-worktree registries keeping the shared home; rebind path when main root unregistered; dangling-entry and home-deletion behavior unchanged

## 4. Management API: listing collapse, worktree count, inventory endpoint, selector fallback

- [x] 4.1 `handleSpaces` (`src/core/management-api/spaces.ts`): group live `in-repo` entries by `(projectId, home)`; for multi-entry groups run `gitWorktreeList` once and present the main-checkout entry (fallback: first live); attach optional `worktreeCount` to project entries (git-derived, concurrent, omitted on failure or single worktree); extend `ProjectSpaceEntry` in `wire-types.ts` (design D3)
- [x] 4.2 New `handleSpaceWorktrees` handler + `GET /api/v1/spaces/worktrees` route in `src/core/management-api/router.ts`: resolve the space via `resolveSpaceSelector`, run `gitWorktreeList` at the space root, compute each worktree's active-change count with the same active-change definition the changes listing uses; empty inventory for non-git roots; GET-only 405 posture; add `SpaceWorktreesResponse` wire types
- [x] 4.3 `resolveProjectSelector` (`src/core/config-api/project-addressing.ts`): when the canonical path is not a registry key, pierce via `resolveRegistrationRoot`; if the pierced root is registered, resolve to that entry's identity with the requested path as `root` (spec "Worktree root path resolves to the owning project's space")
- [x] 4.4 API tests: duplicate collapse to one row with `worktreeCount`; independent clones stay separate rows; worktrees endpoint (facts, active-change counts, non-git empty, 401/405 posture); worktree-path selector resolution incl. no-side-effect assertion; existing spaces/selector tests still green

## 5. UI: badge, worktrees panel, switchable board source

- [x] 5.1 `packages/ui/src/api`: add `SpaceWorktreeEntry`/`SpaceWorktreesResponse` types, `worktreeCount` on `ProjectSpaceEntry`, and a `listSpaceWorktrees(selector)` client call
- [x] 5.2 `SpacesPage.tsx`: render the worktree-count badge on project rows when `worktreeCount ≥ 2` (spec "Worktree badge on a multi-worktree project")
- [x] 5.3 `BoardPage.tsx`: fetch the inventory for project spaces; when ≥ 2 worktrees render a worktrees panel (chip-strip pattern next to `MemberChips`) showing path tail, branch, active-change count, and client-side live-session count (session `cwd` within worktree root); selection re-fetches `listChanges`/`listRuns` with `space=project:<worktreeRoot>` and persists in a `?wt=` query param; default = main checkout; no panel for single-worktree/non-git/store spaces (design D4)
- [x] 5.4 UI tests: badge rendering; panel facts and default-main selection; switching swaps board data source without changing the route's space prefix; reload with `?wt=` restores the selection; store space unaffected

## 6. Verification

- [x] 6.1 `rasen validate worktree-aware-spaces --type change` passes and the full `pnpm test` suite is green (enumerate any failures file-by-file — no tail extrapolation). Result: validate passes; 3887 passed / 29 skipped / 1 failed. The single failure is `test/specs/source-specs-normalization.test.ts` flagging a pre-existing placeholder in `rasen/specs/archive-ui/spec.md` (present in HEAD, committed at 354ce3a4, working tree unmodified) — outside this change's scope (archive-ui is untouched here).
- [x] 6.2 Live smoke on this machine's polluted registry (the 8-entry project): `/spaces` shows one row with the badge; board panel lists worktrees and switches; `rasen doctor` reports duplicates and `--gc` collapses them
