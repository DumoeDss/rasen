# Ship Log: migrate-cross-project-coordinators-to-store-issues

**Date:** 2026-08-11
**Mode:** pr
**Branch:** feat/store-owned-coordinator-migration-0.1.7
**Implementation commit:** `f4a48a36` (`feat(store): migrate coordinators to Store Issues`)
**Implementation tree:** `git show f4a48a36^{tree}`
**Base:** `dev/0.1.7`
**Push:** `origin/feat/store-owned-coordinator-migration-0.1.7`
**PR:** [#154](https://github.com/DumoeDss/rasen/pull/154)
**PR base/head:** `dev/0.1.7` ← `feat/store-owned-coordinator-migration-0.1.7`
**Status:** OPEN; not merged
**Archive timing:** on-merge
**Archived in ship:** no
**Archive pending:** PR not merged

## Pre-Flight Results

- Verification: passed — independent original reviewer final verdict CLEAN; Blocker 0, Major 0, Minor 0, Trivial 0.
- Review cycle: 3/3 bounded rounds completed; the post-cap test-only strategy correction was independently confirmed and was not a fourth review round.
- Tasks: 60/60 complete.
- Scope: strict pre-ship byte/scope audit passed for 59 deliverable files / 1,089,253 bytes; valid UTF-8, no BOM or U+FFFD; 31 existing modified files remain CRLF and added deliverables remain LF; no `rasen/specs/**` changes.

## Test Gate

- Required scope: complete migration/recovery, archive compatibility, Store Issue, cross-platform, release-contract, and repository integration checks because this change spans persistence, migration, concurrency, recovery, CLI, CI, and cross-platform behavior.
- Final recovery suite: 62/62 passed.
- Targeted legacy matrix: 9/9 passed.
- Full suite on spacious `C:/tmp` with `maxForks=4`: 429/430 files; 7,565 passed; 47 skipped. The only two failures were unchanged OMP English-text assertions: Windows global setup deletes `RASEN_LANG`, and the locale resolver ignores `LC_*`, so the observed Chinese output is correct for that environment. Full `test/core/init.test.ts` isolated with worker-level `RASEN_LANG=en` passed 61/61.
- Earlier `E:/tmp` full run: invalidated by an ENOSPC cascade and not treated as product-regression evidence.
- Typecheck: passed.
- Build: passed.
- Lint: passed.
- Diff check: passed.
- `check:pack-version`: passed; packed CLI reports 0.1.7. Generated tgz is ignored and not committed.
- `check:release` / `check:paired-pack`: not applicable blockers because `dev/0.1.7` has pre-existing CLI 0.1.7 / UI 0.1.6 skew and this change does not alter package metadata.
- Strict Change validation: 1/1 passed.
- Implementation delivered in `f4a48a36`; a narrow evidence-only follow-up records PR #154 and final delivery facts.

## Safety Invariants

- No `rasen/specs/**` changes.
- No member repository writes.
- No `.rasen/**` committed.
- Legacy coordinator sources remain intact through publication; retirement remains separate and recoverable.
- Generated Store Issues use existing canonical Issue and optional Execution Plan contracts without a public legacy-import mutation API.

## Deployment

Status: Delivered to PR [#154](https://github.com/DumoeDss/rasen/pull/154). The PR is OPEN. Merge was not authorized and was not performed. Archive remains pending until a future merge.
