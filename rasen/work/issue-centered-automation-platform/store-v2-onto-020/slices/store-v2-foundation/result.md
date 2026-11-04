# Result: store-v2-foundation

**Status:** passed
**Outcome:** The 0.1.7 store-base v2 model and the Store Issues module now run on 0.2.0. Delivered as
a 3-child portfolio, merged to `dev/0.2.0` in PR #157 (5e94c3a6, 80 commits / 172 files /
+45,190/-73): `store-planning-contract-v2` (typed planning contract: identity, layout, finalization
record), `store-worktree-bindings-v2` (workspace bindings, atomic writes, locks, git-verb guards),
and `store-issue-resources` (StoreIssues mutations + StoreAggregateQuery reads + Issue/workspace
CLI). All three children archived in order on 2026-08-15 (`rasen/changes/archive/2026-08-15-*`).

## Evidence

The four items this section promised at draft time:

- **Ported store-base + Issues suite results (green) on 0.2.0.** Final full-suite gate: 191 test
  files / 2668 passed / 9 skipped / 0 failed, at `VITEST_MAX_WORKERS=1` in three
  `VITEST_FILE_PARTITION`s, re-taken green after the fix round (+0 files / +5 tests, delta
  reconciled exactly). Full record and environment methodology (why 2-worker runs were abandoned:
  19 distinct failing files across three runs, zero repeating):
  `rasen/changes/archive/2026-08-15-store-issue-resources/evidence/task-8-3-gate-run-and-environment.md`.
- **The Issue lifecycle artifact + read-back proof.** No real planning Issue was open at slice
  time, so the dogfood path ran the fixture-shaped lifecycle through the real CLI, which the slice
  plan explicitly allows: `test/commands/store-issue-cli.test.ts` creates an Issue with only
  `--store`/`--title`, refuses out-of-vocabulary `--state`, transitions state (resolved/dropped
  with reason), publishes an Execution Plan revision against committed Change instances, and
  list/show reads back in both human and JSON forms; `test/commands/store-aggregate-cli.test.ts`
  covers the aggregate-query reads. Canonical bytes/digest round-trips are pinned by golden
  vectors in `planning-identity-v2.test.ts` (fix-round-3 mutation proofs), not relational
  assertions.
- **Regression proof.** Post-S2 portfolio baseline vs post-S1 reference: 122 files / 1744 passed /
  6 skipped / 0 failed against 110 / 1511 / 1 skipped (+12 files, +233 tests, no previously-passing
  test failing), at reduced parallelism as the stricter reading (child-2 task 6.10 record). `tsc
  --noEmit` and ESLint clean per the children's ship logs.
- **0.1.7 to 0.2.0 structural adaptation.** Store internals were a greenfield drop, not an
  adaptation: `git diff e62b101f origin/dev/0.2.0 -- src/core/store` is empty. The only intended
  divergence from the 0.1.7 tip inside `issues/` and `query/` is the deliberate `f4a48a36`
  exclusion, attributed hunk-by-hunk in
  `rasen/changes/archive/2026-08-15-store-issue-resources/evidence/intended-divergence-from-017-tip.md`.
  Adaptation happened at the 0.2.0 seams (command registry, locales, wire mirrors), recorded in
  each child's evidence.

**CI.** PR #157's matrix ran with exactly one red check: windows-pwsh-shard-3, the session-cache
admission-fence environment flake. Root-caused from the failing run's two result.json documents
(not inferred): the admitted launch's `reasonCode: cli_timeout` came from the hardcoded 15s
powershell CIM budget inside the acceptance driver's `processCreationIdentity`, killed under CI
load and recorded as a second observation result, which broke the exactly-one-result expectation.
Fixed by PR #158 (6d998cc5): identity spawns 15s to 60s and the admission-fence budget chain
widened. The fully-green post-merge matrix on `dev/0.2.0` (af259a81,
https://github.com/DumoeDss/rasen/actions/runs/31873496727) is the Windows-leg run reference
recorded in the three children's CI-verification tasks.

## Attempts / history

- 2026-08-10 - Slice drafted as the first vertical foundation of the `store-v2-onto-020`
  sub-direction. Awaiting workstream activation and projection.
- 2026-08-13..14 - Three children implemented, reviewed (fix rounds with mutation proofs), and
  shipped `local` (commit-only) under the port-first directive; the CI-gated task ticks were held
  open until a real matrix run existed.
- 2026-08-15 - Parent PR #157 merged; the admission-fence flake was root-caused and fixed
  (PR #158); the post-merge matrix ran green (31873496727); the children were archived 1 -> 2 -> 3
  and this record reconciled.
