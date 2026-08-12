## 1. Lock the recovery contract with focused tests

- [x] 1.1 Extend the atomic workspace writer tests under `test/core/store/` with fault checkpoints after intent preparation, claim durability, backup publication, target publication, and each cleanup step; prove that the same unjournaled target and bytes resume without duplicate carriers.
- [x] 1.2 Add conflict cases for different bytes, changed target state, corrupt claims, replaced claim/intent/backup identities, and journal authority mismatch; assert the target and every unproven carrier remain untouched.
- [x] 1.3 Add an exact-identity fixture using BigInt `dev` and `ino` values above `Number.MAX_SAFE_INTEGER`, including distinct Windows NTFS values that would collide after numeric rounding.

## 2. Make retained claims safely adoptable

- [x] 2.1 Update `src/core/store/workspace/dependencies.ts` to capture atomic file and directory identities from BigInt stat data while preserving the existing serialized version-2 identity shape.
- [x] 2.2 Implement self-contained recovery for an exact stable pre-claim intent and a complete retained claim, binding each retry to the requested target, bytes, canonical directory, stable before-state, and exact carrier identities.
- [x] 2.3 Preserve strict journal-bound authority when supplied and the existing exclusive backup/hard-link no-clobber boundaries; never fall back to self-contained authority after a journal mismatch.
- [x] 2.4 Revalidate the proven identity of every owned path immediately before unlinking it, including the claim, and retain any corrupt, disagreeing, additional, or replaced carrier with `workspace_atomic_write_conflict`.

## 3. Isolate portable directory synchronization

- [x] 3.1 Add focused fault tests that inject directory-open, directory-sync, file-sync, and handle-close failures independently across the explicit Windows and POSIX policy tuples, including ancestry replacement during an otherwise tolerated fault.
- [x] 3.2 Split directory open and directory sync into separate error boundaries in `src/core/store/workspace/dependencies.ts`, classify only named platform/stage/code unsupported outcomes, remove `EACCES` from tolerated outcomes, and revalidate the canonical directory before continuing.
- [x] 3.3 Keep file synchronization, directory-handle close, `EACCES`, `EIO`, `ENOSPC`, `EBADF`, unknown codes, and every unlisted platform/stage combination fail-closed with recoverable evidence retained.

## 4. Verify the bounded change

- [x] 4.1 Run the focused atomic coordination and workspace binding/apply/lock/cleanup tests plus `test/core/store/workspace-git-verb-guard.test.ts`; confirm no new Git verb or mutation surface appears.
- [x] 4.2 Run TypeScript and lint checks for the owned workspace dependency and focused test files, then run the relevant workspace test group once after integration.
- [x] 4.3 Verify the focused matrix on Windows CI and a POSIX CI job, recording the exact directory-open/sync outcomes and exact large identity evidence without weakening the lookup table to accommodate unrelated failures.
  - Evidence: GitHub Actions run [31355525652](https://github.com/DumoeDss/rasen/actions/runs/31355525652), exact head `21e9c0a75a36f0845dcf4771f53759e9fceb519d`, passed the committed directory-open/sync and large-identity regressions without changing the platform/code allowlist. Windows [shard 1](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366692), [shard 2](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366688), and [shard 3](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366683) covered 427 files with 7,473 passed/47 skipped/0 failed; [Linux Node 20](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366687) and [Linux Node 24](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366664) each recorded 427 files with 7,480 passed/40 skipped/0 failed; [macOS](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366783) recorded 427 files with 7,479 passed/41 skipped/0 failed. Native recovery jobs also passed: [Windows](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366597) 186 passed/9 skipped, [Linux](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366624) 182/13, and [macOS](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366673) 182/13.
- [x] 4.4 Run strict change validation and confirm the implementation diff is limited to `src/core/store/workspace/dependencies.ts` and focused workspace coordination/Git-verb tests and helpers.
