# Ship Log: fix-existing-change-workspace-binding

**Date:** 2026-08-10T05:25:44+08:00
**Mode:** pr
**Branch:** fix/existing-change-workspace-binding
**Commit:** 95f26f4c0268654aefe876d312e93c5098c7daf0
**Tree:** 45dbe3587b06c67a1d247dbd50bd651e0f96aaef
**Base:** dev/0.1.7
**PR:** https://github.com/DumoeDss/rasen/pull/149
**Status:** PR Created

## Pre-Flight Results

- Verification: passed — review cycle CLEAN; Blocker 0, Major 0, Minor 1 accepted-known (`AK-1`).
- Tasks: 13/14 complete; task 4.3 remains honestly unchecked under accepted-known `AK-1`.
- Gate policy: off (flag); ship gate auto-approved by the explicit no-gate delivery decision.
- Scope: exact four implementation/test files plus the complete repo-local Change directory; `.rasen/` excluded.
- Integrity: strict UTF-8, no BOM or mojibake, LF-normalized index, clean `git diff --check`, and no debug/TODO/high-confidence secret leakage.
- Base integration: fetched `origin/dev/0.1.7` at `d2cafbf28cfd62b3eddd8145f89ee9aea78847bb`; merge was already up to date, the merge base equals that commit, and the base is an ancestor of delivered HEAD.

## Test Gate

- Required scope: the focused workspace apply and Store v2 CLI journey regressions, plus repository build and lint.
- Rationale: the delivered change is bounded to existing-Change workspace apply/binding orchestration and its directly affected unit/CLI journey coverage; build and lint cover TypeScript and repository static integration. The repository-wide suite was not retried because its incomplete Windows runs are accepted-known `AK-1` under the explicit no-gate decision.
- `pnpm exec vitest run test/core/store/workspace-apply.test.ts test/commands/store-v2-workspace-journey.test.ts` — passed, 2/2 files and 21/21 tests (Vitest duration 150.75s).
- `pnpm run build` — passed.
- `pnpm run lint` — passed.
- Accepted-known `AK-1`: full repository `pnpm test` remains incomplete after one 30-minute timeout and two Windows IPC/orphaned-runner failures; no attempt reported an assertion failure. Task 4.3 remains unchecked and the full suite was not run or retried during shipping.
- Tree: `b853f8eefcaeb08765b8f84c7f92d5a218f87f69`.

## Deployment

Status: Pending; deployment was not requested and the PR was not merged.

## Lifecycle

- Retention: pending.
- On-merge finalization: pending PR merge confirmation; the Change remains active.

## CI Fix Follow-up

**Date:** 2026-08-10T06:35:20+08:00
**Root cause:** Migration evidence incorrectly used the display-only `id` as the membership and mapping key. The permanent `projectId` is the canonical identity for both UUID and portable kebab identities; display names never key membership.
**Commit:** 95f26f4c0268654aefe876d312e93c5098c7daf0
**Tree:** 45dbe3587b06c67a1d247dbd50bd651e0f96aaef
**Required scope:** The migration canonical-identity contract, its catalog/receipt and provenance consumers, repository build, and lint.

- `pnpm exec vitest run test/core/store/layout-migration-catalog-receipt.test.ts test/core/store/layout-migration-provenance.test.ts` — passed, 2/2 files and 18/18 tests (Vitest duration 94.75s).
- `pnpm run build` — passed.
- `pnpm run lint` — passed.
- Reused evidence: the prior workspace apply/CLI gate remains green at 21/21 because this follow-up did not touch workspace modules.
- Accepted-known `AK-1`: the Windows-unstable repository-wide suite was not rerun locally; the newly triggered GitHub CI run is the cross-platform full-matrix gate.
- Delivery: non-force pushed `fix/existing-change-workspace-binding`; remote HEAD equals follow-up commit `95f26f4c0268654aefe876d312e93c5098c7daf0`; PR #149 remains open against `dev/0.1.7`.
- CI: run `31339752042` — **success**, 16/16 jobs completed with 0 failures — https://github.com/DumoeDss/rasen/actions/runs/31339752042
- Cross-platform result: Linux, Linux Node 24, macOS, all three Windows test shards, lint/type-check, UI build, and file-placement recovery all passed; the prior Windows runtime timeout did not recur.
- `AK-1` resolution: the post-fix full CI matrix closes the earlier repository-wide completion uncertainty for this delivered tree.
- Lifecycle: deployment, retention, merge confirmation, and on-merge finalization remain pending; the Change stays active.

## Archive
**Date:** 2026-08-09T23:01:08.818Z
**Ship commit:** 95f26f4c0268654aefe876d312e93c5098c7daf0
**Outcome:** archived at E:\wt\rasen-pair\rasen\changes\archive\2026-08-09-fix-existing-change-workspace-binding
**Transaction:** f5901d1a-6aac-47b2-80d6-6ec9bae38f06
