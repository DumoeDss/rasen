# Fix round 1 — issue-status-projection (FIXER, successor of implementer-1)

Date: 2026-08-17. Branch `feat/issue-layer`, worktree `.claude\worktrees\issue-layer`.
Fixes the round-1 review findings (`evidence/review-report.md`). Scope held to the findings'
fix directions; TRIVIAL-8 untouched (accepted-known); no behavior changed outside the findings.

## Per-finding disposition

### MAJOR-1 — ambiguous (scope-conflicted) reference with archived evidence no longer reports `finalized`

- `src/core/issue-status/projection.ts:169-200` — the resolution-status check now runs FIRST and
  gates the committed-evidence branch (`:202-216`): a scope-conflicted reference carrying
  `archived: true` + outcome falls into the existing `unknown` + `ambiguous-reference` problem
  path instead of being answered `finalized` (and counting toward progress / closing the Issue).
- `src/core/issue-status/projection.ts:67-85` — `aliasFor` no longer presents `claimants[0]`
  for a non-resolved reference; it reports the node's own recorded `changeAlias` (the same
  fallback the unresolved path takes), so no claimant is chosen on the node's behalf.
  `src/core/issue-status/types.ts` `IssueNodeStatus.alias` contract doc updated to match;
  design D3 sentence reconciled.
- Pinned by `test/core/issue-status/issue-status-projection.test.ts:865-917`
  ("reports a scope-conflicted archived reference as unknown, never finalized"): observation
  `unknown`, `ambiguous-reference` problem, alias is the node alias and NOT the archive entry
  name `claimants[0]` carries, progress 0/1, phase `active`, `complete: true` (reported-but-honest).
- Fixture note (why the test builds the state the way it does): the state cannot be produced by
  publishing-then-editing the committed identity — `ChangeMetadataIdentityV2Schema`
  re-verifies `instanceId` against the identity's own scope, so a line edit alone makes the
  metadata unreadable and the reference comes back `unresolved`. And `publishPlan` REFUSES the
  mismatch outright (`issue_reference_scope_conflict`). The read-side state therefore requires a
  hand-committed revision: the test forges one with the module's own `executionPlanDigest` +
  `serializeExecutionPlanRevision` (digest correct, revision readable, only the reference
  conflicts) against a Change archived `landed` via the `seedAndArchive` helper (`:93-166`).
  Pre-fix this test fails on `observation` (old code: `finalized`, no problem).

### MAJOR-2 — `unknown` observation now has a phase row: `active`

- `src/core/issue-status/projection.ts:371-397` — `derivePhase`'s `ACTIVE_SIGNALS` now includes
  `'unknown'` (`:388`). Rationale documented in the `derivePhase` docblock (`:356-370`) where
  D5's precedence is implemented: a located-but-unreadable run-state or a reference that broke
  after publication is activity-adjacent trouble; `planning` keeps meaning "no readable plan"
  (derived independently via the unreadable-plan path); the phase derives from the OBSERVATION,
  never from the unreadable bytes. Design D5's `active` bullet extended to match.
- Pinned with phase assertions in all three tests the report named:
  - `issue-status-projection.test.ts:833` (corrupt auto-run case; also health `healthy` at
    `:834`),
  - `issue-status-projection.test.ts:861` (unresolved-reference case),
  - `test/commands/store-issue-status-cli.test.ts:216-222` (corrupt CLI case: human
    `phase: active` segment + `json.status.phase`).
- Pre-fix these assertions fail (old code fell through to `planning`).

### MINOR-3 — non-absolute `changesDir` treated as absent (no relative-tail probing)

- `src/core/issue-status/projection.ts:241-251` — the run-state search chain's planning tail is
  built only when `changesDir` is absolute; `''` from a store-aggregate root (and any other
  relative value) is treated as absent, so `path.join('', alias)` can no longer produce a bare
  relative tail probed against `process.cwd()`. Comment states the ambient-read reasoning.
- Pinned by `issue-status-projection.test.ts:734-766` ("treats a non-absolute changesDir as
  absent"): plants `child-a/auto-run.json` in a real directory, chdir's into it (per-file fork
  isolation; cwd restored before fixture cleanup), passes `changesDir: ''`, asserts
  `not-started` + `runStatePath: null`. Pre-fix the relative probe finds the file and the test
  fails.

### MINOR-4 — design D7 `complete`-flag rule reconciled to the code (docs only)

- `rasen/changes/issue-status-projection/design.md` D7 rewritten: `complete` (carried from
  `IssueDetail`) is lowered further only by projection-local failures to read what was reached
  (invalid run-state, unreadable plan); unresolved/ambiguous references are reported-but-honest
  and do not lower it; unsearched refs lower the carried flag at the query layer already.
  Code rule unchanged (matches `types.ts` and `projection.ts` as reviewed). The ambiguous test
  additionally pins `complete: true` beside an `ambiguous-reference` problem.

### MINOR-5 — missing tests added

- Portfolio `delivery.status: 'escalated'` → observation `failed`, health `failed`
  (`projection.ts` observePortfolio delivery branch): `issue-status-projection.test.ts:454-485`.
- Combined finalized + run-terminal siblings ⇒ progress `2/3` (spec scenario previously covered
  only disjointly): `issue-status-projection.test.ts:675-711` (observations
  `['run-terminal', 'not-started', 'finalized']`, progress `{completed: 2, total: 3}`).
- The `ambiguous-reference` gap is covered by the MAJOR-1 test above.

### TRIVIAL-6 — design D4 table row aligned to `isPortfolioComplete`

- `design.md` D4 row now reads delivery `done`|`skipped`, with a note that the row reuses the
  portfolio module's own `isPortfolioComplete` contract (one terminality authority, not two).

### TRIVIAL-7 — guard's forbidden-write list extended

- `test/core/issue-status/issue-status-read-only-guard.test.ts` source-scan list now includes
  `rmSync` and `truncate`. Suite green (sources contain neither).

### TRIVIAL-9 — tasks.md command corrected

- `tasks.md` 7.2 now records the positional `node bin/rasen.js validate issue-status-projection`.

### TRIVIAL-8 — untouched, per instruction (accepted-known).

## Gates (real exit codes, no pipes on the code-bearing runs)

- `pnpm exec vitest run test/core/issue-status/ test/commands/store-issue-status-cli.test.ts
  test/commands/store-issue-cli.test.ts` → **4 files / 38 tests, 38 passed, 0 failed, exit 0**
  (~146 s on win32; projection file 21 tests, guard 5, status-cli 3, store-issue-cli 9).
- `node bin/rasen.js validate issue-status-projection` → "Change 'issue-status-projection' is
  valid", exit 0.
- `pnpm exec tsc --noEmit -p tsconfig.json` → exit 0 (run after all source edits; re-confirmed
  at the end).
- `git diff -- src/core/pipeline-registry/` → empty. `git diff -- package.json
  packages/ui/package.json` → empty (no version bumps). Working tree footprint is the change's
  own delta plus this round's edits — nothing else.
- Operational note for re-review: `bin/rasen.js` loads `dist/`, so the CLI suites require
  `pnpm run build` (exit 0 here) after any `src/` change — one intermediate red run was exactly
  a stale-dist artifact, not a code failure.

## Iteration honesty

Two fixture iterations were needed and are recorded so the re-reviewer does not rediscover them:
the first ambiguous-reference recipe (edit the committed identity's target line after
publication) produces `unresolved`, not `ambiguous`, because the identity schema re-verifies
`instanceId` against its own scope; the first combined-progress test forgot to seed the archived
child before archiving it (ENOENT at rename). Both were fixed; the committed fixture is the
hand-committed-revision recipe described under MAJOR-1.
