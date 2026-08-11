# Shipper handoff — migrate-cross-project-coordinators-to-store-issues

## Status

HANDOFF on 2026-08-11: shipping is blocked at staging because every `git add` invocation required shell approval and approval was not granted. No commit, push, PR, merge, stash operation, or archive operation occurred.

- Mode: `pr`
- Branch: `feat/store-owned-coordinator-migration-0.1.7`
- Base: `dev/0.1.7`
- Commit: not created
- Push: not performed
- PR: not created
- Merge: not authorized and not performed
- Archive timing: `on-merge`
- Archive: not run; remains pending a future PR merge
- Blocker: shell permission denied for explicit path-scoped staging

## Scope audit

The intended delivery consists of the explicitly enumerated modified `.github`, docs, `src`, and `test` paths from the pre-ship status plus the Change artifacts, four new production modules, three new tests, and `test/fixtures/layout-migration/**`. The final cached/committed path audit is pending.

Hard exclusions:

- `.rasen/**` is machine-local state and must remain untracked.
- `rasen/specs/**` is unchanged.
- Ignored `atelierai-rasen-0.1.7.tgz` and machine workDir artifacts are not deliverables.
- `stash@{0}` is the retained pre-sync safety backup and remains untouched.

## Verification summary

- Independent original reviewer final verdict: CLEAN; Blocker 0, Major 0, Minor 0, Trivial 0.
- Review cycle: 3/3 bounded rounds; post-cap test-only strategy correction independently confirmed, not a fourth review round.
- Final recovery suite: 62/62.
- Targeted legacy matrix: 9/9.
- Full suite on `C:/tmp`, `maxForks=4`: 429/430 files, 7,565 passed, 47 skipped. Only two unchanged OMP English-text assertions failed because Windows global setup deletes `RASEN_LANG` and locale resolution ignores `LC_*`, yielding correct Chinese. Isolated full `test/core/init.test.ts` with worker-level `RASEN_LANG=en`: 61/61.
- Earlier `E:/tmp` full run invalidated by ENOSPC cascade; not a product regression.
- Typecheck, build, lint, and diff-check passed.
- `check:pack-version` passed; packed CLI reports 0.1.7; generated tgz ignored.
- `check:release` / `check:paired-pack` are not applicable blockers due to pre-existing CLI 0.1.7 / UI 0.1.6 skew on `dev/0.1.7`; package metadata is unchanged.
- Strict Change validation: 1/1.
- Strict byte/scope audit: 59 deliverable files / 1,089,253 bytes; valid UTF-8, no BOM/U+FFFD; 31 existing modified files remain CRLF, added deliverables LF; no `rasen/specs/**` changes.

## Remaining action

A future shipper with permission to run Git writes must stage only the explicit deliverables, audit `git diff --cached --name-status` and `git diff --cached --check`, create the scoped commit(s), push explicitly, create and verify the PR, then replace pending identifiers here and in `evidence/ship-log.md` using narrow follow-up commits. Do not merge or archive.

The new `evidence/ship-log.md` and this handoff are currently untracked deliverables because staging was blocked. They must be included in the eventual commits; no deliverable was intentionally omitted.
