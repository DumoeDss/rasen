# Ship Log: runtime-adapter-interface-extraction

**Date:** 2026-08-06T10:39:14Z
**Mode:** pr
**Branch:** `feature/runtime-adapter-interface-extraction`
**Commit:** `03248cea88896d71e593eacffd3688a6c43d6539`
**Tree:** `32b6957dd89435dbc5c07a2aff9de2455314ac35`
**Base:** `dev/0.1.7` (`DumoeDss/rasen`)
**PR:** https://github.com/DumoeDss/rasen/pull/141
**Status:** PR Created

Head pushed to `origin` (`pashifika/rasen`); base repository is `upstream`
(`DumoeDss/rasen`). Same fork-to-upstream shape as PR #136 and #137. The
branch's own git tracking is left pointing at the `local` gitea remote,
unchanged by this ship — so `git push origin <branch>` was used without `-u`.

## Pre-Flight Results

- Verification: pass — `verification-report.md` (CLEAN, Blocker 0 / Major 0 /
  Minor 3 / Trivial 2) and `review-report.md` (DONE, F1–F4 fixed and verified,
  F5/F13 recorded, F6–F12 deferred)
- Tasks: 52/52 complete. Task 9.8 was the last unchecked box — a record-keeping
  task whose deliverable ("F6–F12 recorded in `evidence/review-report.md`") was
  confirmed present at `review-report.md:222-293` and `:426`, so the checkbox was
  closed in `03248cea` rather than the work being re-done.
- Working tree: two unrelated deltas left uncommitted and out of this delivery —
  `rasen/config.yaml` carries the same CLI-generated reformat (line rewrapping
  plus `tools: []`) the previous ship also excluded, and `bin/rasen.js` carries a
  mode-only change (`100644 → 100755`, zero content lines). Neither belongs to
  this change.
- Base divergence: 0 behind / 15 ahead of `upstream/dev/0.1.7`, so no
  pre-validation merge was required.
- Diff scan: no debug output, secrets, or leftover TODO markers in the added
  lines under `src/`, `packages/`, or `scripts/`. 70 files, +9253 / -598.

## Test Gate

- Required scope: full repository suite, plus `pnpm lint` and `npx tsc --noEmit`
- Rationale: the change re-shapes four core registries (`RUNTIME_ADAPTERS`,
  `SESSION_STORES`, `DISPATCH_ADAPTERS`, `AUDIT_READERS`) consumed by pipeline
  dispatch, `agent context`, token-audit, model presets, and management-API
  paths, and edits skill/workflow templates whose parity tests hash generated
  content. Blast radius is repository-wide, not package-local.
- Tests: `pnpm build && pnpm lint && npx tsc --noEmit && pnpm test` — pass,
  exit 0. **346/346 files, 6070 passed, 27 skipped (6097)** (165.16s).
- Tree: `32b6957dd89435dbc5c07a2aff9de2455314ac35`

Green evidence was **not** reused. `verification-report.md:246` records tree
`89c0b641a9117c55e87c75e53c9f4a3388a1cbe1`, which predates the review-round
commits, and `review-report.md` records no tree fingerprint at all. The gate was
re-run in full.

The gate ran against the delivered tree plus the two uncommitted deltas noted
above. Neither is a test input: `bin/rasen.js` changed no content, and
`rasen/config.yaml` is this repo's own planning config, which the suite does not
read (tests build their own fixtures). The result is therefore valid for the
delivered tree, but it is recorded as "tree plus two non-source deltas" rather
than as a pristine match.

### The previous ship's stale-`dist/` diagnosis is confirmed

`test/cli-e2e/basic.test.ts`, which `review-report.md:430-432` recorded as a
standing environmental failure on this machine, **passed** here — 346/346 files
with no failure at all, where the review round measured 1 failed. The only
difference is that this gate ran `pnpm build` first. That is the same
`ensureCliBuilt()` freshness gap the previous ship log diagnosed
(`archive/2026-08-06-detect-omp-host-runtime/evidence/ship-log.md:54-63`): the
helper returns early when `dist/cli/index.js` merely exists, so cli-e2e
assertions run against whatever build happens to be on disk. Building first is
what cleared it, and the follow-up that log proposed — a freshness check in the
helper — is now supported by a second independent observation.

## Open follow-ups travel with the change

The verdict is CLEAN, which means no Blocker and no Major is open — not that
nothing is left. Eight deferred items are recorded in
`evidence/deferred-followups-report.md`, each with a named owner. Two are called
out in the PR body because they bear on approval:

- **FU-1** — the bridged-worker identity guarantee is enforced on declaration
  (a `rasen-owned` adapter without `childEnv` is `TS2322`) but not on
  application; a future bridge calling `spawnAgentCli` directly compiles clean.
- **FU-2** — `cli-agent-audit`'s "a report is never attributed to a foreign
  runtime" scenario is not satisfied as written; both violating paths were
  reproduced on the built CLI. The repair is a decision, not a patch.

## Deployment

Status: Pending (run `rasen-ship --deploy` to continue)

## Archive Timing

Timing: `on-merge`. The change stays ACTIVE during PR review — `status`,
`resume`, and fix-forward keep working. Archive follows merge confirmation of
PR #141.
