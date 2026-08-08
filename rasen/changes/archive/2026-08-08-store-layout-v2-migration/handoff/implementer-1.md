# Handoff — `store-layout-v2-migration`, implementer 1

## Position

Production code is complete and green on `tsc`, `lint`, `build`, and strict
`validate`. 62 of 78 tasks are ticked. What remains is **test work**, plus two
end-of-run audits. Read `evidence/implementation-report.md` first — it lists
every judgment call, and you should not re-litigate them without cause.

Nothing is committed. Nothing is pushed.

## The one thing that must be handled first

`pnpm exec vitest run --maxWorkers=1 test/core/store/` is
**22 failed / 578 passed / 1 skipped**, in exactly two files:

- `test/core/store/migration-ops.test.ts` — 17
- `test/core/store/membership-operations.test.ts` — 5

All 22 have the same cause: the fixture Store never declares
`layoutVersion: 2`, and `adoptProject` now refuses that with
`legacy_flat_store_requires_migration`. That refusal is the change's contract
(`specs/store-adopt/spec.md` scenario "Adopt into a legacy flat store is
refused", plus both `proposal.md` BREAKING bullets), so **the code is right and
the tests are stale**.

**Do not rewrite them to match the code.** For each one, decide:

- *Most of them* — the test is about adopt/eject mechanics, not about the flat
  layout. Give the fixture Store `layoutVersion: 2` (see
  `test/core/store/layout-migration-module.test.ts` `beforeEach`, which calls
  `writeStoreMetadataState` with `version: 2, uid, id`), give it a target-line
  catalog when the case uses `--archive move`, and re-point the destination
  assertions at `rasen/projects/<projectId>/{specs,changes}`. The assertion
  must still say what it always said, in the new address.
- *A few of them* — the test is genuinely about the legacy flat Store. Convert
  it to assert the deliberate refusal, rename it to say the refusal is
  deliberate, and cite `specs/store-adopt/spec.md` in a comment.

Two named cases need care:

- "resumes an interrupted adopt without a collision error and preserves the
  full manifest" — the resume marker is no longer an adoption name list; it is
  the project catalog's `planningBinding.state: bound`
  (`migration-ops-v2.ts:bindProjectCatalog`). The test must assert the bound
  catalog, not a name list. The *property* (an interrupted adopt resumes rather
  than failing the collision precheck) must survive unchanged.
- "keeps a knowledge role that eject did not end" — v2 eject now preserves
  roles verbatim and only sets `planningBinding: unbound`
  (`specs/store-eject/spec.md`). The flat path still clears the planning role.
  Assert the right one for the layout the fixture declares.

## Remaining tasks, verbatim from `tasks.md`

Unticked and genuinely outstanding:

- **1.1** caller inventory of flat Store readers/writers, classified. Partly
  done in the source guard's two allow-maps; the written inventory does not exist.
- **1.2** `test/core/store/migration-ops-flat-baseline.test.ts` — capture
  pre-move flat behavior. Note this is now partly retrospective: the writers
  already moved. Capture what the *legacy* paths still do (eject, relocate
  `--to in-repo`, membership migration, doctor).
- **2.7, 3.9, 4.6, 5.9, 6.9, 7.6, 8.9, 9.6, 10.5, 11.1, 11.2, 11.3** — the
  named test files. `test/core/store/layout-migration-module.test.ts` already
  covers inventory totality + zero writes, multi-ref survey, the
  never-distribute rule, E1 supersession, shared-spec blocking, missing target
  line, plan determinism, design-doc retention, the apply-gate refusal, and
  `blocked:dirty-source`. What it does NOT cover, and what the remaining files
  must: the mapping file end to end, staging/publish/retire/rollback with
  injected failures, the receipt round trip, adopt/eject partition behavior,
  the CLI surface, the doctor codes, Windows/`path.win32` fixtures, and the
  full journey.
- **3.5** — assert the excluded heuristics (change-name prefix, branch name,
  directory adjacency, sibling ordering, single-similar-member) rather than
  only documenting them. `evidence.ts` never reads any of them; the assertions
  should build a fixture where each heuristic *would* produce an owner and
  prove the item stays `unresolved:unknown-owner`.
- **10b.3** — rewrite the five end-to-end journeys into "migrate, then run the
  lifecycle": `test/cli-e2e/store-lifecycle.test.ts` (4 cases) and
  `test/cli-e2e/capstone-journeys.test.ts` journey 3. **10b.3 explicitly
  forbids converting these into refusal assertions** — the point is to keep a
  live end-to-end gate over the externalized-planning product.
- **10b.4** — the six unit-level cases in
  `test/commands/{declared-store-fallback,store-references,store-add-project,legacy-groups-removed}.test.ts`.
  These were not run in this session; expect them to fail on the same cause as
  the 22 above.
- **10b.5** — the BREAKING bullet is written; the "prove a migrated Store
  regains both" half needs a test.
- **11.4** — run the affected suites and attribute every baseline failure.
  Baseline on this host is five environmental failures (`config.test.ts` ×1,
  `config-editor.test.ts` ×4, `%LOCALAPPDATA%\rasen` above `os.tmpdir()`).
- **11.5** — re-run the caller inventory and the source guard after the test
  work settles.
- **11.6** — `tsc`, `lint`, `build`, strict `validate`, `git diff --check`, and
  the byte-level encoding audit have all been run and pass (see the report).
  Re-run all of them after the test work, and add the focused-suite runs the
  task also asks for.

## Key decisions, so you do not re-derive them

- **Adopt is v2-only.** It calls `assertStoreLayoutForWrite({writes:'partition'})`
  unconditionally. Eject and `archive relocate --to in-repo` still work on a
  legacy flat Store — refusing them would trap content.
- **Plans and recovery manifests live in the machine root**, under
  `<globalDataDir>/store-layout-migration/<storeUid>/<refSlug>/`. `apply(token)`
  takes only a token, so the machine root is a **constructor** option on
  `StoreLayoutMigration`, not a per-call argument. Tests pass
  `{ globalDataDir }` as the second constructor argument.
- **Determinism** comes from `withDeterministicIdentity(deps, { now })`, which
  fixes the clock and seeds instance-seed minting. Without it, `createdAt`
  participates in `planId` and two plans differ.
- **Publication order** is project catalogs → target-line catalogs → partitions
  → receipt → `layoutVersion: 2`. The flip is last and is the single
  linearization point. Project catalogs are an in-place schema flip, so their
  previous bytes go into the recovery manifest's `replacedFiles` before the
  write; everything else is a same-volume rename from
  `<StoreRoot>/.rasen/migration/staging/<planId>/tree/<destRelative>`.
- **The source guard now has three assertions.** The third bounds
  `specsDir(storeRoot)` / `changesDir(storeRoot)` / `inRepoArchiveDir(storeRoot)`
  to `migration-ops.ts` (4) and `layout-migration/flat-source.ts` (3). If you
  add or remove one of those calls, update the count — and `flat-source.ts`
  deliberately names its local `storeRoot` so the census can see it.

## Dead ends

- **`git stash` and `git checkout --`** are forbidden in this worktree. Revert
  by editing.
- **Bash heredocs containing backticks** broke the shell in this session. Write
  patch scripts to the scratchpad and run them by path instead.
- **Dropping a scenario inside a MODIFIED delta** is refused by
  `src/core/specs-apply.ts:308`. Use REMOVED + ADDED at the requirement level
  (see the routing-scope delta for the pattern).

## Working set

Production:
`src/core/store/layout-migration/*` (12 files, all new),
`src/core/store/layout-write-guard.ts`, `src/core/store/membership-layout.ts`,
`src/core/store/migration-ops-v2.ts` (all new),
`src/core/store/migration-ops.ts`, `src/core/store/operations.ts`,
`src/core/archive.ts`, `src/core/store-planning/internal/resolver.ts`,
`src/core/templates/workflows/{archive-change,bulk-archive-change,ship,sync-specs}.ts`,
`src/commands/store-migrate-layout.ts` (new), `src/commands/store.ts`,
`src/commands/store-migration.ts`, `src/core/completions/command-registry.ts`,
`src/locales/{en,ja,zh-cn}.json`.

Tests:
`test/core/store/layout-migration-module.test.ts` (new),
`test/core/templates/legacy-store-gate-guard.test.ts` (new),
`test/core/store-planning/planning-path-source-guard.test.ts`,
`test/core/templates/skill-templates-parity.test.ts` (8 pinned hashes re-baselined),
`test/core/completions/command-registry.test.ts`.

Change artifacts:
`rasen/changes/store-layout-v2-migration/{proposal.md,tasks.md}`,
`.../specs/store-planning-scope-routing/spec.md` (new),
`.../specs/store-config-inheritance/spec.md` (new),
`.../evidence/implementation-report.md` (new).
