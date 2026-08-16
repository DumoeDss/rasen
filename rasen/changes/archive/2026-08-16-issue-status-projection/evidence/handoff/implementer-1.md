# Handoff — implementer-1, issue-status-projection (stage-complete retirement)

Date: 2026-08-17. Branch `feat/issue-layer`, worktree `.claude\worktrees\issue-layer`.
Final state: **19/19 tasks complete** (6.3 closed during verify — receipt 3 captured, dogfood store
removed, worktree config restored). This is a retirement handoff: nothing is pending for this role;
the content below exists to transfer knowledge to the C2/C3 planners and any successor session.

## Status

- Apply: complete. Verify-tail receipt 3 (`evidence/dogfood-receipt-3-verify.md`) captured the real
  LEAD-recorded stage transition (child g-001 `apply: in_progress` → `apply: done, verify:
  in_progress`); the Issue axes were correctly invariant (still one child mid-pipeline) with the
  node's `runStatePath` naming the very file whose bytes moved — receipt explains why that is the
  honest projection, and which boundary crossings DO move the axes.
- Dogfood fully torn down: `store remove issue-layer-dogfood --yes` (folder + registry entry gone,
  `store list --json` shows 0 occurrences), `rasen/config.yaml` restored to committed state
  (`git diff` empty), stray `.rasen-store/` probe residue deleted, temp dir
  `%LOCALAPPDATA%\Temp\rasen-issue-layer-dogfood\` deleted. Receipts 1–3 preserved under `evidence/`.
- Final worktree footprint: modified `src/commands/store-issue.ts` + 3 `architecture-index` skill
  files; new `src/core/issue-status/`, `test/core/issue-status/`,
  `test/commands/store-issue-status-cli.test.ts`, and the change's own directories. Nothing else.

## Verification (real numbers, real exit codes)

- `node bin/rasen.js validate issue-status-projection` → "Change 'issue-status-projection' is
  valid" (positional form — `--change` is NOT a validate flag; LEAD re-ran `validate
  issue-status-projection --json`: 1/1 passed; correction recorded in receipt 3).
- Full affected set, one invocation, exit code 0: **6 files / 75 tests, 75 passed, 0 failed** —
  `test/core/issue-status/issue-status-projection.test.ts` 17, `issue-status-read-only-guard.test.ts`
  5, `test/commands/store-issue-cli.test.ts` 9, `store-issue-status-cli.test.ts` 3,
  `test/core/store/store-aggregate-query.test.ts` 33, `store-query-read-only-guard.test.ts` 8.
- Fences at retirement: `git diff -- src/core/pipeline-registry/` = 0 bytes (byte-identical);
  `git diff -- package.json packages/ui/` = 0 bytes (no version bumps). All suites ran on win32;
  `runStatePath` expectations are `path.join`-built Windows paths; CI Windows leg pending push.

## Distilled decisions (what C2/C3 inherit)

1. **The projection seam is `src/core/issue-status/`** — `projectIssueStatus(ProjectIssueStatusInput)`
   with explicit path inputs (`detail`, optional `executionRoot`/`changesDir`, injectable
   `workDirFor`). Children 2–3 import/extend it; do not open a third status seam. Tests inject
   `workDirFor: async () => null` so they never touch a machine registry.
2. **Within-node observation precedence deviates deliberately from D4's visual row order**:
   escalation signals win over activity (portfolio child/delivery `escalated` → `failed` even while
   siblings run; stage `escalated` → `waiting-human` even beside an `in_progress` stage), because
   the spec's health scenarios require escalation signals to surface and D5's precedence governs
   composition. Documented in `projection.ts`.
3. **Run-state location uses `stateFileSearchChain` + `runStatePath`/`portfolioStatePath` + the
   detailed readers** — not `resolveRunStateLocation`/`resolvePortfolioStateLocation` directly,
   because those hard-require a `changeDir` tail while `changesDir` is an optional input and a
   relative tail would be an ambient read. Same frozen ordering authority, zero ambient reads.
4. **The query prefers COMMITTED record copies over the working tree** — an Issue record state
   change reflects in reads only after a store commit. Burned a unit test and matters for any
   future dogfood step.
5. **A within-child stage move does not move the Issue axes** (receipt 3): axes move on node-level
   boundaries — child terminal → progress; child/delivery escalated → health; all children
   terminal + open record → review; operator `resolved` → done (g-003 will replace that rule).
   `blocked`/`stale` remain reserved values awaiting real recorded signals (g-002+).

## Dead ends / eliminated hypotheses

1. **Dogfood store inside `<worktree>/.rasen/dogfood/`** — `store setup` refuses a path inside
   another Git repository (a store is its own repo). Moved under the OS temp dir; recorded in
   receipts; removed at teardown. Zero branch impact.
2. **`store migrate-layout` declares layout v2 on a fresh store** — no inventory ⇒ nothing applied,
   no declaration written. Fallback: append `layoutVersion: 2` to `.rasen-store/store.yaml` (the
   same line the fixtures write) + commit.
3. **Fresh store's empty flat `rasen/` tree** blocked `add-project` ("flat planning content with no
   migration receipt"). It held nothing; retired with `git rm -r` + commit.
4. **Store-scoped `new change --store`** for the three children — refused: member project is
   membership-only (`planning=no`; `adopt` deliberately not run mid-portfolio). Fallback: explicit
   -list copy of child 1's artifacts + `seedChange`-shaped v2 identity blocks (ALL scalars quoted —
   unquoted numeric instanceSeed/targetLineId parses as number/float and the Change goes invisible)
   for children 2–3 whose worktree dirs were empty stubs.
5. **`validate --change <name>`** — invalid syntax; positional `validate <name>` is the working
   form (correction recorded in receipt 3 at LEAD request).
6. **Backing up `rasen/config.yaml` AFTER add-project had already written to it** — the "pre-dogfood
   backup" contained the `storeMemberships` block; restoring from it left residue. Correct teardown:
   `git restore rasen/config.yaml` (the file had no other edits). Backup-after-write is not a backup.
7. **`add-project` also writes worktree-side state** — a `storeMemberships:` block in
   `rasen/config.yaml` AND a stray `.rasen-store/store.yaml` (v1 probe residue) appear in the
   project repo. Both were present during all validated reads; both removed at teardown. Future
   dogfoods should expect and clean both.

## Remaining

None for this role. (Verify/review of the diff is owned by the reviewer + LEAD; ship/archive by the
LEAD per the portfolio plan.)
