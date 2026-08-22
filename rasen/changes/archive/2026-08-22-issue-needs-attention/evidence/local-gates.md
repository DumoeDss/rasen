# Local gates — issue-needs-attention (implementer, 2026-08-22)

All runs on the `feat/issue-phase5` worktree (`.claude/worktrees/issue-layer`),
Windows, `pnpm exec vitest run` per group with the exit code captured from the
shell (never from a pipe tail). Full logs under the worktree's `.rasen/`
(g3-*.log, g003-nd-*.log); every failure list below is the complete
enumeration from the captured log.

## Focused suites (task 5.2)

| Group | Files | Tests | Exit |
| --- | --- | --- | --- |
| `test/core/issue-status/` (incl. new `issue-attention.test.ts` 13 tests, extended read-only guard 7 tests) + `test/core/issue-acceptance/` | 17 | 113 | 0 |
| new CLI suite `test/commands/store-attention-cli.test.ts` (unmasking receipt + parity + counts + write-nothing + narrowing/refusal + empty state + visibility + determinism + review-phase acceptance-awaiting end-to-end) | 1 | 6 | 0 |
| `test/locales/catalog.test.ts` + `test/core/completions/` + `test/core/cli-presentation.test.ts` (locale structure + completions sync) | 13 | 338 passed (+13 skipped, pre-existing) | 0 |
| `pnpm exec tsc --noEmit` | — | — | 0 |
| `pnpm build` (dist rebuilt before every CLI run; native capsule compiled) | — | — | 0 |
| `pnpm exec eslint <changed files>` (attention.ts/types.ts/index.ts, store.ts, store-issue.ts, command-registry.ts, 4 test files) | — | — | 0 |
| `rasen validate issue-needs-attention` (+ `--type change`) | — | — | 0 |

## Binned full-suite run (≤25 files/box, node-spawn bins)

`node .rasen/run-bins-g003.mjs` — 678 files -> 28 bins, one vitest process per
bin, spawn argv direct (Git-Bash path-eating workaround), per-bin log +
`EXIT=<code>` appended, summary written incrementally to
`.rasen/g003-nd-summary.txt`. Results: see `binned-suite-adjudication.md`
(the complete failure enumeration from the captured logs, adjudicated against
the 2026-08-17 machine-state-cluster baseline; CI stays the authority gate).

## Dogfood gates (persistent store `issue-registry`)

- Attention verb exercised live on the persistent store at every dogfood
  stage (receipts 1/3/5 in this directory), every invocation exit 0.
- The store's tree is clean after every store-side commit (`git status
  --porcelain` empty after each of the four commits 2065262/7ef1bc8/a671b54/
  2b3afab); the repo worktree's planning roots untouched by every dogfood
  act.
- The read-only receipt on the persistent store: the verb itself prints
  "wrote nothing" and the store stayed clean across the receipt captures.
