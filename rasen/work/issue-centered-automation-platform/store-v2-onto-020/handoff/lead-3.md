# Handoff: store-v2-onto-020 — LEAD session 3

Written in English deliberately: the Write tool corrupts multibyte text in this repo.

Successor to `lead-2.md`. That handoff's "Next action" was to finish child 3 (`store-issue-resources`)
and deliver the portfolio. Both are done. **This handoff exists mainly to record a directive change
that makes the next six slices work differently from this one.**

## THE DIRECTIVE CHANGE — read this before anything else

The operator ruled, explicitly, at the end of this session:

> Port everything first, then check. 0.1.7 already did all of this — stop verifying it over and over.

Slice 1 was run at a verification density 0.1.7 was never held to: two review rounds plus a verify
round per child, every guard mutation-proved, spec-vs-code consistency audited. That found four real
defects — and **all four are present in the released, tagged 0.1.7** (verified by reading
`origin/dev/0.1.7` directly, not inferred):

| Defect | Where it also lives on 0.1.7 |
|---|---|
| an uncommitted Change accepted into a published plan | `query/references.ts:162-167`, same `evidence: null` |
| node ordering never canonicalized | `issues/plans.ts:434`, same pure `.map()` |
| an unreadable committed Change silently omitted | `query/refs.ts`, same four `return null` paths |
| a declared-but-empty project/line can never appear | `query/module.ts:297,307`, same lazy `bucketFor` |

So the slowness was not the port. **The port itself was nearly free**:
`git diff e62b101f origin/dev/0.2.0 -- src/core/store` is EMPTY — 0.2.0 never touched the store
directory, so store internals are a greenfield drop, and the only real collision is a handful of
append-shaped rim files.

### What the next six slices should do instead

```
port the module + port its tests as-is
  -> tsc / lint / build clean
  -> run ONLY the ported module's own suites locally (small, fast)
  -> push; let CI be the gate
  -> fix only what CI actually reports red
```

**Do not** run verify rounds, audit spec-vs-code consistency, hunt latent 0.1.7 defects, or
mutation-prove ported guards. If a ported behaviour is wrong, it is wrong on the released product
too, and fixing it is a separate decision the operator makes — not a precondition for landing the
port.

**Do not re-run the full gate locally.** This is where slice 1 burned the most wall-clock: over four
hours, three of the runs wasted. CI runs the whole suite across three OSes with sharding, in
parallel, on hardware that is not this machine. See "The machine" below for why local full runs are
actively untrustworthy here.

## Position

- **Slice 1 `store-v2-foundation` is complete.** Three children, all shipped `local`:
  `store-planning-contract-v2` (35/36), `store-worktree-bindings-v2` (32/33),
  `store-issue-resources` (39/39).
- **PR #157** is open: `feat/store-v2-foundation` -> `dev/0.2.0`, 80 commits, 172 files,
  +45,190/-73. https://github.com/DumoeDss/rasen/pull/157
- **CI is red on 6 Test jobs** and the session-3 LEAD is fixing them. Everything else passes
  (Lint & Type Check, UI Build, all provider/policy jobs, macOS shard-2, Windows shards 2 and 3).
  The failures are all frozen-list tests that this work legitimately grew — see "CI state" below.
- **Nothing is archived yet**, and archive is blocked until this PR's CI is green. Three tasks
  (child 1's 6.5, child 2's 6.9, child 3's 8.6) are deliberately unticked pending a CI run
  reference that is structurally unobtainable from a local worktree.

## Archive order is required, not stylistic

Archive **child 1 -> child 2 -> child 3**. Child 3's archive projection lists
`store-planning-layout-v2` as a CREATE, which means child 1 has not yet archived the capability both
of them touch. Archiving out of order collides.

Per-child `archive --dry-run --json` at the time of writing: child 3 `blockers: []`, children 1 and 2
each `1 task(s) are incomplete` — those are the CI-gated ticks, and they are the machine telling the
truth. Do not clear them by hand, and never use `[~]` (it matches neither `[ ]` nor `[x]`, so the
task vanishes from numerator AND denominator and no gate can see it).

`rasen archive` does not commit. Commit with a narrow pathspec afterwards. Archive evidence is
content-addressed (`archive.json` + journal both record per-file sha256), so appending anything after
the fact desyncs both records and cannot be cleanly repaired.

## Next slice: `layout-migration` — survey already done, use it

Read-only survey completed in session 3. Do not redo it.

**Port target is `95f26f4c`, NOT the 0.1.7 tip.** The per-commit attribution method
(`git log e62b101f..origin/dev/0.1.7 -- <files>`, then diff from the base it names) has now given a
different correct answer four times. Chronological order on that path:
`0ede6cfb` (squash base) -> `d2cafbf2` -> `95f26f4c` -> `f4a48a36`.

`f4a48a36` is the coordinator-bridge slice (L8, a *later* roadmap item) and it dumped **2,661 lines
across 13 of the module's 15 files**. Porting the tip would drag a later slice's work in.

| | 0.1.7 tip | **target `95f26f4c`** |
|---|---|---|
| source | 15 files / 271 KB | **13 files / 180 KB** |
| tests | 13 files / 282 KB | **12 files / 167 KB** |

The two identity fixups `d2cafbf2` ("use record.id kebab-case not record.projectId UUID for v2
project identity") and `95f26f4c` ("keep display names out of project identity") touch only
`evidence.ts` and are tiny, but they are correctness fixes — include them, i.e. port at `95f26f4c`.

`layout-migration-apply-recovery.test.ts` is 18 KB at the target and 70 KB at the tip;
`layout-migration-scene-bridge-e2e.test.ts` (24 KB) does not exist at the target at all. Both
differences are `f4a48a36`.

### Inbound requirement: exactly two files

`layout-migration` imports 22 external modules. Twenty are already satisfied — six landed by slice 1
(`planning-catalogs`, `planning-foundation`, `planning-identity`, `planning-layout-v2`,
`planning-validation`, `canonical-json`), thirteen pre-exist on 0.2.0. **Two are missing and must
come with this slice:**

- `src/core/store/layout-write-guard.ts`
- `src/core/store/membership-layout.ts`

Both were deliberately carved out of child 2 and handed forward (`membership-layout.ts` reaches
`layout-migration/receipt.js` via `layout-write-guard.ts`, and no consumer inside slice 1 imports it).
Neither exists on 0.2.0 or on this branch.

### Zero re-implementation on the shared dependencies

Of the thirteen pre-existing shared deps, seven are byte-identical between the two lines. The other
six diverge, and every divergence was checked against `layout-migration`'s actual call surface:
it imports exactly **11 symbols** from them, **10 have byte-identical signatures**, and the 11th
(`ChangeMetadataSchema`) differs only by a *widening* on this line (0.1.7's schema plus an optional
`quality` field, both `.strict()`), so anything 0.1.7 accepts this line accepts too.

**None of the 79 diverging lines is in its call surface.** On a line repeatedly characterised as
"every seam is a re-implementation", this slice is the exception: it is a genuine port.

One inbound item found while surveying, not blocking this slice: **`readProjectConfigAtPath` is
missing on this line.** Its docstring says it exists so consumers do not "recreate a second
root-routing algorithm" for Store v2 configs at `<projectHome>/config.yaml`. `layout-migration` does
not import it, but `store-session-execution-context` (L6) very likely will.

## The remaining roadmap after that

From `roadmap.md`, in order: `layout-migration` -> `coordinator-bridge` (L8, the dogfood capstone,
now unblocked since 0.1.7 is released and frozen) -> `store-session-execution-context` (L6) ->
`finalization + stored-plan` (L3+L5) -> `dispatch-adapter` (L4) -> `router/runs/management-api seams`
(L7, the bidirectionally-divergent zone, may split per endpoint).

Only `slices/store-v2-foundation/` exists as a drafted slice directory. The other six are named in
the roadmap but have no plan/spec yet.

## Bookkeeping debt you inherit

**`slices/store-v2-foundation/result.md` still says `Status: not started`** while all three children
have shipped. It needs reconciling after archive with the four evidence items its own text promises:
ported-suite results, the Issue-lifecycle artifact, the regression proof, and the 0.1.7->0.2.0
structural adaptation notes. This is exactly the disease this whole slice kept finding — a record
saying A while the fact is B, with nothing to catch it.

## The machine — this cost more time than the code

**Local full-suite runs are not trustworthy here.** Three runs at `VITEST_MAX_WORKERS=2` produced
**19 distinct failing files across 21 occurrences, only 2 repeating, and ZERO appearing in all
three.** Failures migrate between runs. One run was cut off at 118/189 files with no summary block
at all while still exiting 0 — so `exit 0` is not proof a run finished; check for the `Test Files`
summary block.

Two causes, both measured:

1. **Contention.** `MAX_WORKERS=1` fixes it. Every suite that failed repeatedly at 2 workers passed
   first time at 1.
2. **`%TEMP%` fixture residue.** It reached **3,983 leftover `rasen-*` directories** (many full Git
   repos); `statSync` over them alone took >120s. `node bin/rasen.js --version` startup measured
   **2223-29470ms on the same binary**. After deleting the 3,430 older than an hour, the startup
   *spread* collapsed from 13x to 1.1x (2319-2558ms). It is self-reinforcing: residue slows the FS,
   tests time out, cleanup is skipped or EPERMs, residue grows. **Re-check it before trusting any
   local measurement**, and note it re-accumulates.

If you must take a local gate: `VITEST_MAX_WORKERS=1` plus `VITEST_FILE_PARTITION` in thirds (the
same mechanism CI shards with) keeps each run to 10-25 minutes and completes. But under the new
directive you mostly should not need to.

## Traps that are still live

- **`test/helpers/run-cli.ts:166` — `ensureCliBuilt()` builds ONLY when `dist/cli/index.js` is
  ABSENT.** It never rebuilds on source change, so any local CLI suite reports on whatever binary is
  on disk. **`pnpm run build` before any CLI suite.** CI is safe (`ci.yml` builds first).
- **`node bin/rasen.js …`, never bare `rasen`** — the bare command is a globally installed **0.1.7**
  build while this repo is 0.2.0.
- **`packages/ui` is excluded from the root vitest config** — `pnpm exec vitest run packages/ui/test/`
  runs ZERO tests and prints "passed". Use `pnpm -C packages/ui exec …`.
- **Never `git checkout --` to revert a mutation** — `core.autocrlf` rewrites the tree to CRLF and
  produces a spurious whole-file diff. Snapshot out-of-repo, restore, verify by sha256.
- **`commander-presentation.ts` hard-crashes CLI startup** on a structural mismatch with
  `command-registry.ts`, or on missing English locale copy for any registered command or flag. The
  failure mode is a dead binary, not a red test — `node bin/rasen.js --help` is a real check.
- **Do not pre-write an `## Archive` heading in a ship log** — `rasen archive` treats it as belonging
  to another transaction and refuses with `archive_recovery_required`.
- **Backticks inside `node -e "…"` are executed by bash as command substitution.** This silently ate
  a phrase out of a record in session 3 and left a plausible-looking sentence with a hole in it.
  Caught only by scanning the written bytes for multi-space gaps. Use single quotes, a heredoc, or
  the Write tool.
- **Locale catalogs must keep identical key sets across en/ja/zh-cn** (1606 each at present).
- **Commit with narrow explicit pathspecs** in this shared worktree — but check what you excluded;
  being too narrow has lost files here twice.

## CI state at handoff, and the class the failures belong to

Six Test jobs red. Three distinct failures, all in files **outside** the 191-file local gate's scope
— which is itself the frozen-list disease one more time, now caught by CI rather than locally:

1. `test/vocabulary-sweep.test.ts` — 30 new `workspace_*` tokens from child 2's binding module trip a
   guard that keeps the retired `rasen workspace` noun-command surface dead. The guard's own comment
   says a new token must be "a deliberate decision recorded in the ledger" — the fix is to record
   them there, with the distinction that these are error codes under `store workspace`, not a revived
   top-level command group.
2. `test/core/completions/command-registry.test.ts` — "keeps simple aliases on canonical commands"
   pins the `store` subcommand list at 11; it is now 16 (`target-line`, `workspace`, `issue`,
   `changes`, `projects` added).
3. same file — "keeps store-selection options paired and guidance complete":
   `store target-line list --project` expected `['store','json']` to include `'project'`.

The session-3 LEAD is fixing these on the PR branch. If they are still red when you pick this up,
they are mechanical: update the pinned lists to the surface that actually ships.

## Working set

- Worktree: `.claude/worktrees/store-v2-foundation`, branch `feat/store-v2-foundation` (pushed).
- Direction: `rasen/work/issue-centered-automation-platform/store-v2-onto-020/`.
- 0.1.7 reference: `origin/dev/0.1.7` — **read-only behaviour reference, never a copy target**, but
  under the new directive it IS the port source and its behaviour is accepted as-is.
- Target line: `origin/dev/0.2.0` (`e2e5e7b8` at the time this branch merged it in at `e6cd8860`).
- The proxy at `127.0.0.1:7890` needs a Clash rule routing `github.com` / `githubusercontent.com` /
  `ghcr.io` through a node; without it git fails with `SSL_read: unexpected eof` after the proxy
  answers `200 Connection established`.
