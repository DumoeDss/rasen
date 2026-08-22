# Local gates — issue-revision-history-preservation (implementer, 2026-08-22)

All runs on the `feat/issue-phase5` worktree (`.claude/worktrees/issue-layer`),
Windows, `pnpm exec vitest run` per group with the exit code captured from the
shell (never from a pipe tail). Focused-suite summaries in
`focused-summaries.txt` beside this file; every failure list below is the
complete enumeration from the captured log.

## Focused suites (task 5.1)

| Group | Files | Tests | Exit |
| --- | --- | --- | --- |
| `test/core/issue-status/` + `test/core/issue-acceptance/` (incl. new `issue-revision-continuity.test.ts` 5, `issue-retarget-lineage.test.ts` 4, `issue-superseded-totality.test.ts` 1) | 17 | 99 | 0 |
| store-issue CLI suites (`store-issue-status-cli`, `-acceptance-cli`, `-lifecycle-cli`, `-ready-cli`, `-confirm-cli`, `store-issue-cli`, new `-acceptance-exclusions-cli` 1) | 7 | 34 | 0 |
| record-schema store suites (`store-issue-acceptance-content` [RECORD_DIGEST anchor untouched], `-mutations`, new `-exclusions` 6, `-digest-anchors`, `planning-layout-v2`, `-node-lifecycle`, `-intent-lifecycle`) + plan/start/target CLI | 11 | 144 | 0 |

35 files / 277 tests, all green. The five new suites also ran green standalone
during authoring (numbers above include them).

## Prior touches, strength-argued (the suites that pin the pre-change shape)

- `store-issue-acceptance-content.test.ts` — the hand-copied `RECORD_DIGEST`
  literal (`3487ff00…`) and the exact no-exclusion YAML literal predate this
  change; still green, unedited ⇒ the digest body and serialized bytes of the
  absent form are byte-identical to pre-field (the non-symmetric anchor; my
  own byte-identity test is symmetric by comparison and exists to cover the
  MUTATION path).
- `store-issue-acceptance-mutations.test.ts` — the accept-mutation write and
  refusal matrix, no exclusions passed; green ⇒ the mutation path is
  unchanged for the absent form.
- `store-issue-acceptance-cli.test.ts` — human/JSON accept output including
  the gate line and note line; green ⇒ the renderer's no-exclusion output is
  unchanged (the new exclusion loop is a no-op over `?? []`).
- `issue-acceptance-gate.test.ts` / `-lifecycle.test.ts` — the evaluation's
  exclusion shape (untouched code); green.
- `issue-status-projection.test.ts` / `issue-status-legacy-archive-ruling.test.ts`
  — acceptance-block consumers of the record type (additively widened); green.
- `planning-layout-v2.test.ts` — the accepted-record PATH only, not the
  shape; green.

## Binned full-suite run (task 5.2)

671 tracked test files, 27 boxes of ≤25, one vitest process per box,
sequential. The five new suites are untracked (shipper's commit) and are
covered by the focused rows above plus their standalone runs.

The binned gate's record of authority is `binned-suite-adjudication.md` beside
this file — the LEAD-executed run and adjudication (13 failing files, fully
itemized: 6 known machine-state cluster + 7 ambient/spawn-family, each
adjudicated solo; zero failures attributable to this delta). The implementer's
own binned process was stopped when the LEAD took the adjudication over; its
first two boxes exited 0 before the stop (box-01: 25 files / 383 tests, box-02:
25 files / 381 passed + 1 skipped).

## Other gates

- `pnpm exec tsc --noEmit` — exit 0.
- `pnpm run lint` — exit 0.
- `pnpm run build` — exit 0 (run manually before the CLI suites; see the
  machine note in `implementer-findings.md`).
- `node bin/rasen.js validate issue-revision-history-preservation` — exit 0
  (`evidence/validate.txt`).
- Fences byte-empty: `git diff -- src/core/pipeline-registry pipelines
  packages/ui package.json` prints nothing; no version bumps; the persistent
  store untouched (temp-store fixtures only).
