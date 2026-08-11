# Shipper handoff — migrate-cross-project-coordinators-to-store-issues

## Status

DONE on 2026-08-11. The Opus shipper prepared the evidence but hit a shell staging permission boundary; the LEAD then completed the same explicit path-scoped ship protocol without widening scope.

- Mode: `pr`
- Branch: `feat/store-owned-coordinator-migration-0.1.7`
- Base: `dev/0.1.7`
- Implementation commit: `f4a48a36` — `feat(store): migrate coordinators to Store Issues`
- Push: `origin/feat/store-owned-coordinator-migration-0.1.7`
- PR: [#154](https://github.com/DumoeDss/rasen/pull/154)
- PR state: OPEN
- Merge: not authorized and not performed
- Archive timing: `on-merge`
- Archive: not run; remains pending a future PR merge

## Scope audit

The implementation commit contains 61 explicitly staged deliverable files: the intended modified `.github`, docs, `src`, and `test` paths; the Change artifacts and evidence; four new production modules; three new tests; and `test/fixtures/layout-migration/**`.

Audited exclusions:

- `.rasen/**`: absent from the commit and remains untracked machine-local state.
- `rasen/specs/**`: unchanged and absent from the commit.
- Ignored `atelierai-rasen-0.1.7.tgz` and machine workDir artifacts: absent.
- `stash@{0}`: retained pre-sync safety backup, untouched.
- `git diff --cached --check`: passed after stripping Markdown-only trailing whitespace from the two new review evidence files without changing their text.
- After the implementation commit the working tree contained only untracked `.rasen/` before this narrow evidence update.

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

- Do not merge from this session; the user did not authorize merge.
- Do not archive before merge. After PR #154 merges into `dev/0.1.7`, resume the pipeline's `archive` stage and archive from the merged line.
- Monitor CI and address any verified PR finding through a new reviewed fix; do not rewrite published history.
