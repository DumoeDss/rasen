# Ship Log: detect-omp-host-runtime

**Date:** 2026-08-06
**Mode:** pr
**Branch:** `feature/detect-omp-host-runtime`
**Commit:** `9d95ab9ac8b0f5cb26a81d9a5af31bb691e8419f`
**Tree:** `0503bb2b78e4298814d8bfb5494dbbe9882d3caa`
**Base:** `dev/0.1.7` (`DumoeDss/rasen`)
**PR:** https://github.com/DumoeDss/rasen/pull/137
**Status:** PR Created

Head pushed to `origin` (`pashifika/rasen`); base repository is `upstream`
(`DumoeDss/rasen`). This fork-to-upstream shape follows the convention the
branch history already establishes — PR #136 merged
`pashifika/feature/standalone-retention-context-freeze` into `dev/0.1.7` the
same way. The branch's own git tracking is left pointing at the `local` gitea
remote, unchanged by this ship.

## Pre-Flight Results

- Verification: pass — `verification-report.md` (CLEAN, Blocker 0 / Major 0 /
  Minor 1 documented out-of-scope) and `review-report.md` (DONE, no open
  findings)
- Tasks: 40/40 complete
- Working tree: `rasen/config.yaml` carried an unrelated CLI-generated reformat
  (line rewrapping plus `tools: []`). Deliberately left uncommitted and out of
  this delivery — it is not part of this change.
- Base divergence: 0 behind / 9 ahead of `upstream/dev/0.1.7`, so no
  pre-validation merge was required.

## Test Gate

- Required scope: full repository suite, plus `pnpm lint` and
  `npx tsc --noEmit`
- Rationale: the change widens a core type (`HostRuntime`) consumed by pipeline
  dispatch, keepalive, and management-API paths, and modifies shared test-harness
  environment setup (`vitest.setup.ts`), so blast radius is repository-wide
  rather than package-local.
- Tests: `pnpm lint && npx tsc --noEmit && pnpm test` — pass, exit 0.
  **345/345 files, 6034 passed, 27 skipped** (166.73s), bare invocation with no
  environment overrides.
- Tree: `0503bb2b78e4298814d8bfb5494dbbe9882d3caa`

Green evidence in `review-report.md` was not reused: that report records no tree
fingerprint, and `verification-report.md`'s recorded subtree hashes predate the
review-round commits. The gate was therefore re-run in full rather than
inherited.

### Two false failures diagnosed and cleared before the green run

Neither was a defect in this change; both are recorded because each cost a full
suite run and will recur for the next person.

1. **Stale build made this change's own e2e test fail.**
   `test/cli-e2e/agent-context.test.ts` reported `reason:'no-transcript'` where
   it asserts `reason:'unsupported-host'`. Cause: `ensureCliBuilt()` in
   `test/helpers/run-cli.ts` returns early when `dist/cli/index.js` merely
   *exists* and never checks whether it is current. The `dist/` on disk was
   built at 01:44, before this branch's first commit (09:31), and contained
   neither `OMPCODE` nor `unsupported-host` — so the e2e test was asserting new
   behavior against the pre-change CLI. `pnpm build` fixed it. Any cli-e2e
   assertion of new behavior is silently vacuous against a stale `dist/`; worth
   a follow-up freshness check in the helper.

2. **An orphaned global npm broke `test/scripts/local-version-runtime.test.ts`
   (2 tests).** `scripts/local-version/local-runtime.mjs:413` joins the pack
   destination with the `filename` field that `npm pack --json` reports. Under
   npm **8.3.0** that field keeps the scoped form
   (`@atelierai/rasen-ui-0.2.0-fixture.1.tgz`) while the file written is
   flattened (`atelierai-rasen-ui-…tgz`), so the subsequent `npm install`
   failed with `ENOENT`. Reproduced outside vitest and outside this repo with a
   two-line `package.json`, confirming no branch involvement — `scripts/` is not
   in this change's diff. The npm 8.3.0 was an orphan at
   `/opt/homebrew/lib/node_modules/npm` shadowing the nvm Node v24.18.0 npm, with
   no Homebrew `node`/`npm` formula installed. Resolved by the maintainer with
   `npm install -g npm@11.16.0`; npm 11.16.0 reports the same name it writes.

   Note for whoever hits this on another machine: the sibling
   `scripts/pack-version-check.mjs:41` already normalizes this exact npm quirk,
   but `local-runtime.mjs` does not. That asymmetry is a pre-existing robustness
   gap, independent of this change.

## Deployment

Status: Pending (run `rasen-ship --deploy` to continue)

## Archive

Timing: `on-merge`. The change stays ACTIVE during PR review — `status`,
`resume`, and fix-forward keep working. Archive follows merge confirmation of
PR #137.
