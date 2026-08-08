# Handoff — `store-layout-v2-migration`, implementer 2

## Position

The 22 stale adopt/eject tests are resolved: `test/core/store/` is **601 passed
/ 1 skipped / 0 failed**. Tasks 10b.4 and 11.1 are ticked. `tsc`, `lint`, and
the focused suites for everything touched are green. Nothing is committed.

Read `evidence/implementation-report.md` from the `# Implementer 2` heading
down before anything else — it carries the per-test disposition for all 22, the
four production defects, and two coverage relocations you must not undo.

## The single most useful thing I can hand you

`test/commands/store-v2-migration-journey.test.ts` (new, passing) drives the
**real CLI** through `migrate-layout` preview -> apply -> retire -> retire again
-> `store adopt` -> `store eject`, against a fixture Store with two member
projects, a single-owner spec, a two-contributor spec resolved by mapping,
active Changes, a legacy Archive entry, a retained design doc, and a second flat
ref.

It is the working template for **task 10b.3**. Before it existed, `apply` had
never been executed by anything — task 6.9 is still unticked — and it turned out
`migrate-layout --apply` could not migrate a realistic Store at all (defect 3 in
the report). Copy its `beforeEach` rather than re-deriving the fixture. In
particular:

- the mapping file's `targetLines.<id>.projects.<projectId>` is an OBJECT with
  `codeRef`, not a bare ref string;
- the Store needs a permanent uid (`version: 2` metadata) or identity minting
  blocks;
- everything must be committed, or `blocked:dirty-source` fires;
- `store adopt --json` puts the id at `adopt.project_id`.

## Exactly what is red

Sweep of `test/commands/` + `test/cli-e2e/` + `test/core/{store,store-planning,templates}/`
+ `test/core/archive` — 115 files, **10 failed / 1944 passed / 3 skipped**:

- 5 environmental (`config.test.ts` x1, `config-editor.test.ts` x4) — the known
  host baseline. Never "fix" them.
- 5 task-10b.3 journeys, and nothing else:
  - `cli-e2e/store-lifecycle.test.ts` — "machine A: works a change through
    archive from the project repo", "machine B: a clone registers without
    ceremony and reads promoted specs", "machine B: completes its own change
    through archive in the clone", "end state is just normal Rasen files in
    both checkouts". Only the first genuinely refuses (`new change --store`
    against the flat Store `store setup` produced); the other three fail on the
    state it did not create, so fixing the first may cascade.
  - `cli-e2e/capstone-journeys.test.ts` — "journey 3 — externalized planning:
    pointer repo runs the lifecycle without --store".

`tsc`, `lint`, `build`, `rasen validate --strict`, `git diff --check` and the
byte-level encoding audit all pass; see the report's gate table.

## Remaining tasks

Unticked and genuinely outstanding, in the order I would do them:

- **10b.3** — the five end-to-end journeys, rewritten into "migrate, then run
  the lifecycle", explicitly NOT into refusal assertions:
  `test/cli-e2e/store-lifecycle.test.ts` (4 cases) and
  `test/cli-e2e/capstone-journeys.test.ts` journey 3. **Read defect 4 first**
  (below) — it changes the shape of this task.
- **1.1** the written caller inventory; **1.2**
  `migration-ops-flat-baseline.test.ts` (retrospective: capture what the LEGACY
  paths still do — eject, `archive relocate --to in-repo`, membership migration,
  doctor — all of which this change deliberately keeps working, and all of which
  now have live examples in `migration-ops.test.ts`).
- **3.5** the excluded-heuristics assertions.
- **2.7, 3.9, 4.6, 5.9, 6.9, 7.6, 8.9, 9.6, 10.5, 11.2, 11.3** — the named test
  files. `layout-migration-module.test.ts` already covers inventory totality and
  zero writes, the multi-ref survey, never-distribute, E1 supersession,
  shared-spec blocking, missing target line, plan determinism, design-doc
  retention, the apply-gate refusal, and `blocked:dirty-source`. **6.9 is the
  gap that matters**: `apply` has no injected-failure coverage at all, and it
  shipped two real bugs.
- **10b.5** — the BREAKING bullet is written; "prove a migrated Store regains
  both" is now partly proved (the journey proves adopt/eject work after
  migration) but `new change` and `archive` in a migrated Store are not.
- **11.4-11.6** — the closing audits. Baseline on this host is five
  environmental failures (`config.test.ts` x1, `config-editor.test.ts` x4,
  `%LOCALAPPDATA%\rasen` above `os.tmpdir()`). Never "fix" them.

## Defect 4 — read before starting 10b.3

`storeFinalizationDiagnostic()` in `src/core/archive.ts` keys the legacy-flat
archive refusal on `root.planningScope?.kind === 'legacy-store'`, but only the
AUTHORING resolution attaches a planning scope. So `rasen archive` against a
legacy flat Store **still succeeds today** — task 10b.1's archive half is
unreachable, while its `new change` half works.

That is why the five journeys did not all go red and why 10b.3 is bigger than it
looks. Two halves, and they belong together:

1. Make the refusal reachable (resolve the Store's declared layout for a
   store-selected root when no scope is attached), which turns every flat-Store
   archive journey red;
2. Rewrite those journeys onto a migrated Store, so the product keeps a live
   end-to-end gate — which is the whole reason 10b.3 forbids converting them
   into refusal assertions.

Doing (1) without (2) leaves the tree worse than either. I left both.

One structural obstacle you will hit: creating a Change in a layout v2 Store
needs a **verified planning worktree** (child 2's integration-checkout guard),
plus `--project` and `--target-line`. `test/commands/store-v2-planning-scope-journey.test.ts`
has the only working fixture for that — git worktree plus
`.rasen/planning-line.json`. `store-lifecycle.test.ts` currently works from a
plain `store setup` checkout, so its rewrite needs that worktree too.

## Key decisions, so you do not re-derive them

- **`declareLayoutV2()` is opt-in per test, never in `beforeEach`.** Eject,
  `archive relocate --to in-repo`, membership migration and the drift
  diagnostics all still run against a legacy flat Store and their cases must
  keep meeting one.
- **A v1-metadata Store may declare `layoutVersion: 2`.** It is optional on both
  metadata schema versions and `apply.ts` flips it by spreading whatever it
  found, so it is a state the migration really produces — and it preserves the
  "this Store predates permanent identities" property the adopt-pointer case
  asserts.
- **Destination assertions are spelled out literally**
  (`path.join(storeRoot, 'rasen', 'projects', id, ...)`), never computed through
  `projectPartition()`. Asking the code under test where it put something proves
  nothing.
- **`seedFlatStoreChange()`** in `test/helpers/rasen-fixtures.ts` is the shared
  way to give a legacy flat Store an active Change for a suite whose subject is
  not creation. It carries the citation.
- **Membership writes now dispatch on the declared layout** (defect 2). If you
  see a v2 catalog where you expected a v1 record, that is the fix, not a bug.

## Dead ends

- **`git stash` and `git checkout --`** are forbidden in this worktree. Revert
  by editing.
- **Bash heredocs**: writing patch scripts inline sometimes mangles `\n` inside
  Python string literals into real newlines, which produced two unterminated
  TypeScript string literals. Write the script to the scratchpad with the Write
  tool and run it by path.
- `list --json` and `status --json` carry no `root.scope`; only the authoring
  path does. Do not chase it onto another surface.

## Working set (implementer 2)

Production:
`src/core/store/migration-ops.ts` (target-line check hoisted),
`src/core/store/membership.ts` (layout-dispatching membership write),
`src/core/store/layout-migration/apply.ts` (identity metadata authored when
absent; the authored file excluded from the staged-vs-source comparison),
`src/core/store/layout-migration/module.ts` (idempotent `--retire-flat`).

Tests:
`test/core/store/migration-ops.test.ts`,
`test/core/store/membership-operations.test.ts`,
`test/commands/store-v2-migration-journey.test.ts` (new),
`test/commands/{declared-store-fallback,store-references,store-add-project,legacy-groups-removed,store-root-selection,store-identity-cli,store}.test.ts`,
`test/helpers/rasen-fixtures.ts`.

Change artifacts:
`tasks.md` (10b.4, 11.1), `evidence/implementation-report.md`.
