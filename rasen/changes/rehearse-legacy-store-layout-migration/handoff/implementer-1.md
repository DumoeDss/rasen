# Handoff — implementer, rehearse-legacy-store-layout-migration

Written at beat-cap stand-down. **All 26 tasks are complete**; this is a
distillate for whoever reviews, ships, or reopens the change, not a mid-task
rescue.

## Decisions that are load-bearing

1. **The apply gate was fixed as ONE seam, not two patches** (LEAD required
   this). Every apply-token precondition — Store identity, a checked-out ref, a
   commit — is enumerated in one block in `plan.ts` and reported as a blocked
   item on a new `store-metadata` `MigrationItemKind`. `applicable =
   blockers.length === 0`, so *applicable* and *a token can be minted* are the
   same statement. `migration_plan_gate_desync` throws if they ever diverge, so a
   precondition added to the token later cannot silently reintroduce the defect.
   An earlier two-mechanism version (a `planTokenObstruction` helper beside the
   blocker) was written and then REMOVED — it is the shape the LEAD ruled out.
2. **The CLI was pinned to a `git archive HEAD` build** for every rehearsal
   stage. The repo working tree is shared with two in-flight siblings and
   `build.js:17-20` deletes `dist/` before compiling, so a shared build would
   have put a sibling's uncommitted `store/identity.ts` inside the behavior the
   evidence describes. Treat the pin as a correctness property of the evidence;
   do not "simplify" it away.
3. **Stage-2 content is authored and says so.** The claim those rows make is real
   CLI + real machine registry + real Windows host + real store lineage, never
   real content.
4. **Per-stage `RASEN_HOME`.** Disposable copies share the real store's uid, so
   one registry could not hold two of them; separate homes make an `unregister`
   against a real registry structurally impossible rather than merely avoided.

## Dead ends and refuted hypotheses (do not re-walk)

- **`migration_plan_stale` is unreachable through the shipped CLI.** `--apply`
  re-plans in the same process, so an edit "between plan and apply" surfaces as
  `dirty-source` on a fresh plan or is absorbed. The recovery path that would
  raise it is gated earlier by `migration_recovery_ambiguous` (after a rollback)
  or `migration_run_missing` (no run). Stated as NOT-COVERED in the SS15 table.
- **`store adopt` was NOT the cause of the archive-consumer regression**, and
  neither was sibling A's change. `test/core/archive-consumer-integration.test.ts`
  fails 6/7 on the pinned committed tree with nobody's uncommitted work present.
  One of those six is a 30s TIMEOUT and the file has no
  `KNOWN_SLOW_TEST_WEIGHTS_MS` entry; the first failure is `abort-required` vs
  `complete`, which plausibly starves the five downstream cases. Machine state
  and timeout budget, not a diff.
- **The two parallel-run failures were not load flake.** They were a fixture
  defect in this change's own test (member-less shapes writing a mapping that
  names a non-member target line). Both sides were re-measured after fixing it.

## Working set

- Fix: `src/core/store/layout-migration/{plan,types,index}.ts`,
  `src/commands/{store-migrate-layout,store-migration}.ts`, `vitest.config.ts`.
  Six tracked files, nothing else. Sibling-owned files show as modified in the
  shared tree; none of it is this change's.
- Guard: `test/core/store/layout-migration-empty-store.test.ts`, 19 tests.
- Evidence: `evidence/rehearsal/` (88 step files across five stages, each with a
  `00-provenance.txt` naming its CLI build) and `evidence/guards/` (red/green
  runs, the measurement correction, verification scope, build+scope audit).
- **Re-creating the harness after teardown** — the temp root is deleted, and
  nothing depends on it surviving:
  ```sh
  source evidence/rehearsal/harness.sh
  h_build_pinned     # git archive HEAD -> <temp>/pinned, junction node_modules, build
  h_bootstrap        # robocopy the real store -> copy-pristine; git clone -> copy-clone
  h_preflight        # MUST print PREFLIGHT-OK before any stage runs
  ```
  `seed-enriched.py` rebuilds the stage-2 content byte-for-byte;
  `preflight.js` is the pre-flight guard. For a post-fix tree, copy this change's
  five src files over the archive before building (`RASEN_CLI_TREE=pinned-fixed`).

## Open obligations, deferred by LEAD decision

- The full 693-file suite and a repo-level `pnpm run build`, both at ship time on
  a quiet tree. Reasons measured in `evidence/guards/07-what-was-run-and-what-was-not.md`.
- O14 and O18, deferred with reasons in `evidence/rehearsal/triage.md`.
- O26 handed to sibling A's stream — `to-sibling-a-upgrade-identity-uuid-mismatch.md`.

## Next action

None required by this change. If the reviewer routes a fix back, the guard suite
runs in ~92s solo against a pinned tree and is the fastest signal available.
