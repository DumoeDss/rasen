# Local gates — issue-ready-set-scheduling (implementer, 2026-08-22)

All runs on the `feat/issue-phase5` worktree (`.claude/worktrees/issue-layer`),
Windows, `pnpm exec vitest run` per group with the exit code captured from the
shell (never from a pipe tail). Full logs kept beside this file where noted;
every failure list below is the complete enumeration from the captured log.

## Focused suites (task 7.2)

| Group | Files | Tests | Exit |
| --- | --- | --- | --- |
| `test/core/issue-status/` (incl. new `issue-ready-set.test.ts`, `issue-status-legacy-archive-ruling.test.ts`, extended read-only guard) | 12 | 82 | 0 |
| `test/core/issue-execution/` (incl. new `issue-ready-set-equivalence.test.ts`; pins unedited through the refactor) | 4 | 66 | 0 |
| `store-aggregate-query` + `store-archive-outcome-basis` (new) + `store-aggregate-wire-mirror` + `stores-api` | 4 | 60 | 0 |
| digest/byte-identity pins: `store-issue-plan-canonicalization`, `store-issue-digest-anchors`, `store-aggregate-query`, `store-query-read-only-guard` | 4 | 55 | 0 |
| store-issue command CLI suites (`store-issue-cli`, `-status-cli`, `-start-cli`, `-confirm-cli`, `-ready-cli` (new), `-acceptance-cli`, `-lifecycle-cli`, `-target-project-cli`, `store-aggregate-cli`) | 9 | 50 | 0 |
| plan-publication CLI suites + skill-templates parity | 3 | 23 | 0 |
| locale structure + completions (`cli-locale` + `test/core/completions/`) | 13 | 326 (+13 skipped, pre-existing) | 0 |
| `test/core/issue-publication/` + `test/core/issue-acceptance/` (query consumers) | 5 | 45 | 0 |

The issue-execution row counts the three task-5.3 both-way equivalence tests
(round-1 correction: the pre-fix table read 63, a count taken before the 5.3
block landed; the tree ran 66 and the round-1 gates re-ran it — below).

The equivalence pins (task 1.1) were additionally verified GREEN against the
UNREFACTORED code before any refactor ran (4 passed / 4 skip-marked), and the
same assertions pass unedited after the refactor — the pin-first discipline's
both ends.

## Store-family binned run (≤25 files/box, task 7.2)

`test/core/store/**` — 83 files, 4 bins of 21/21/21/20, each bin one vitest
process; captured summaries in `evidence/bin-summaries.txt` (round-1 receipt
correction — the pre-fix table left bin-03 "(see receipt)"):

| Bin | Files | Tests | Exit |
| --- | --- | --- | --- |
| bin-00 | 21 | 440 | 0 |
| bin-01 | 21 | 327 passed + 1 skipped | 0 |
| bin-02 | 21 | 446 passed + 1 skipped | 0 |
| bin-03 | 20 | 293 | 0 |

Independently closed by the round-1 reviewer's own four-bin run (83 files,
1506 passed + 2 skipped, every bin exit 0) — attribution: `review-report.md`.

## Other gates

- `pnpm run build` — exit 0 (dist rebuilt before the CLI suites; native
  capsule compiled).
- `pnpm exec eslint <all changed + new files>` — exit 0.
- Fences: `git diff -- src/core/pipeline-registry/ pipelines/ packages/ui
  package.json` — 0 bytes.
- `node bin/rasen.js validate issue-ready-set-scheduling` — exit 0
  (`evidence/validate.txt`).
- Line endings of the six new files verified LF (`od -c` / `file`).

## Machine-state note

Per the known local full-suite cluster (7 files, hermes-related state
leakage; baseline-comparison discipline, CI authoritative), the binned run
above is scoped to the store family the change touches; no bin run of the
unrelated suites (agent-runtime, daemon) was repeated locally.
