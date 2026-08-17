# Fix round 1 — issue-execution-binding

Fixer: the implementer (C2). Date: 2026-08-17. Input: round-1 review report
(`review-report.md`): 0 Blocker / 0 Major / 3 Minor / 1 Trivial. Source files
were touched ONLY where a finding required it; `src/core/issue-execution/binding.ts`
was mutated and then byte-restored for the MINOR-2 proof (see below).

## MINOR-1 — tasks.md 6.2 test count corrected

**What changed.** `rasen/changes/issue-execution-binding/tasks.md` (6.2 bracket):
the canonical affected set is now recorded as **10 files / 103 tests, exit 0**
(measured this round, post-fix), with the per-file breakdown and the two
store-query suites (41/41, exit 0) noted separately.

**Cause of the 124-vs-101 discrepancy (measured, not assumed).** The reviewer's
hypothesis — a double count of the binding suite's 23 — does not reconcile.
Both runs are real and reconcile exactly against per-file counts over
DIFFERENT 10-file sets: my original run included `store-aggregate-query` (33)
and `store-query-read-only-guard` (8) in place of the reviewer's
`cli-presentation` (11) and `command-registry` (7): 101 + 41 − 18 = 124. The
bracket's mistake was naming neither file set, leaving "10 files / 124" to
read as the same set the reviewer measured. The corrected bracket names the
canonical set; the reconciliation is stated so the earlier 124 is auditable
rather than mysterious.

**Pinning test.** N/A (evidence accuracy). The number is re-measured every
gate run below.

## MINOR-2 — D3 observation-rule pin (fixture coincidence closed)

**What changed.**
`test/core/issue-execution/issue-execution-binding.test.ts`:
- `resolvedNode`/`detailFor` gained a `blockedByFor` planting seam (the plan
  read's ARCHIVE-based dependency view on the resolved rows) and `nodeStatus`
  gained a `blockedBy` override — every pre-existing fixture keeps
  `blockedBy: []`, so no existing row changes meaning.
- New unit: "runs a dependent whose dependency is terminal-but-unarchived
  OVER a non-empty archive-based blockedBy (D3 pin)" — g-001 observation
  `run-terminal` (work complete) with NO committed archive, so both the
  resolved row and the status row for g-002 carry `blockedBy: ['g-001']`;
  the frontier must still be g-002 (`mode: fresh`).

**Proof the pin discriminates (mutation run, performed and reverted).**
`isRunnable`'s dependency predicate was mutated to the archive-based view
(`return (view.status?.blockedBy.length ?? 0) === 0;`) and the suite run with
`-t "terminal-but-unarchived OVER"`: **exactly that test failed**
(1 failed | 23 skipped, `expected false to be true` — the mutated predicate
returns the no-runnable-nodes refusal). The mutation was then reverted;
`isRunnable` is byte-restored to the observation rule (verified by re-read;
no MUTATION marker remains) and the full suite is green.

**Pinning test.** `issue-execution-binding.test.ts` →
"runs a dependent whose dependency is terminal-but-unarchived OVER a
non-empty archive-based blockedBy (D3 pin)".

## MINOR-3 — CLI-level behavioral write-guard for `start`

**What changed.** `test/commands/store-issue-start-cli.test.ts`: new test
"writes nothing across a start invocation — the command seam,
byte-identical". Over a real fixture store with a real machine workspace
index document and `writeRunState` bytes, it sha256-digests three trees —
the store's `rasen/` (Issue records + plan revisions), the execution root's
`.rasen/` (run-state + `planning-binding.json`), and the fixture's
`planning-workspaces/` (the machine index) — around TWO real `runCLI`
invocations of the built CLI: a successful already-running report through
the pair route (output asserted non-vacuous: mode line + `cwd:` + exec root)
and an `issue_start_node_not_runnable` refusal. All three digests are
asserted identical before/after. This pins the command path —
`resolveQueryStore`, `listAllWorkspaceIndexEntries` over production
coordination, projection + binding, rendering — the same way
`store-query-read-only-guard` pins the query.

**Pinning test.** `store-issue-start-cli.test.ts` → "writes nothing across a
start invocation — the command seam, byte-identical".

## TRIVIAL-1 — sibling-guard test name no longer overstates

**What changed.** One line in
`test/core/issue-execution/issue-execution-read-only-guard.test.ts`: the test
is renamed from "keeps the widened issue-status Module equally write-free" to
"keeps the widened issue-status Module write-free on its new imports (C1's
guard carries the full verb list over the same directory)" — the re-check
covers the widening's own import surface; C1's untouched guard carries the
15-verb list over the same directory in the same run. (Fix direction was a
one-liner, so applied per the LEAD's instruction.)

## Gates (this round, real exit codes)

- `pnpm run build` after the (test-only) edits → exit 0 (defensive; dist
  current either way — no production source changed this round).
- Canonical affected set (the review's command):
  **10 files / 103 tests passed, 0 failed, exit 0** — binding 24, exec-guard
  6, projection 21, C1 status-guard 5, locator-widening 7, store-issue-cli 9,
  store-issue-start-cli 10, store-issue-status-cli 3, cli-presentation 11,
  command-registry 7.
- Wider set: `store-aggregate-query` + `store-query-read-only-guard` →
  **2 files / 41 tests, exit 0**.
- `node bin/rasen.js validate issue-execution-binding` → valid, exit 0.
- Fences byte-empty: `git diff -- src/core/pipeline-registry/`, `packages/ui/`,
  `package.json`, `packages/ui/package.json` → 0 bytes each; `git diff --check`
  clean.
- C1 suites untouched: `git diff -- test/core/issue-status/
  test/commands/store-issue-cli.test.ts test/commands/store-issue-status-cli.test.ts`
  → 0 bytes.

## Delta file list for re-review (this round)

Modified:
- `rasen/changes/issue-execution-binding/tasks.md` (MINOR-1 bracket)
- `test/commands/store-issue-start-cli.test.ts` (+1 test, +crypto import)
- `test/core/issue-execution/issue-execution-binding.test.ts` (helper seams +
  1 test)
- `test/core/issue-execution/issue-execution-read-only-guard.test.ts` (rename)

Unchanged-but-verified: `src/core/issue-execution/binding.ts` (mutation
round-tripped byte-identically), all production sources, locales, index skill.
