# Handoff: store-v2-onto-020 — LEAD session 4

Written in English deliberately: the Write tool corrupts multibyte text in this repo.

Successor to `lead-3.md`. Read that one too — it carries the operator's standing directive and the
`layout-migration` survey. This handoff covers what changed after it and what you are to do next.

## YOUR TASK, in order

The operator's instruction, verbatim in intent:

1. **Open a NEW worktree off the LATEST `origin/dev/0.2.0`.** Do NOT work in
   `.claude/worktrees/store-v2-foundation` — see "The worktree you must avoid" below.
2. Create a **fix branch** there.
3. **Fix the CI failure** described below.
4. **Open a PR to `dev/0.2.0`** and get it green.
5. **Then archive** the three children, in order.

`EnterWorktree` branches off `origin/main`/HEAD, NOT `dev/0.2.0`. Use a manual
`git worktree add -b <branch> <path> origin/dev/0.2.0` after fetching.

## Position

**PR #157 is merged.** `feat/store-v2-foundation` -> `dev/0.2.0`: 80 commits, 172 files,
+45,190/-73. Slice 1 (`store-v2-foundation`) code is now on the 0.2.0 line.

Three children landed, all previously shipped `local`:

| Child | Tasks | Note |
|---|---|---|
| `store-planning-contract-v2` | 35/36 | task 6.5 unticked, needs the CI run reference |
| `store-worktree-bindings-v2` | 32/33 | task 6.9 unticked, same |
| `store-issue-resources` | 39/39 | task 8.6's CI-matrix half open, same |

**Nothing is archived.** That is the remaining work of slice 1 and it is step 5 of your task.

## The CI failure you are fixing

PR #157 was merged with **one** check red. Everything else passed: Lint & Type Check, UI Build, Nix,
all provider/policy jobs, all three macOS shards, Windows shards 1 and 2, linux-bash and
linux-bash-node24.

```
Test (windows-pwsh-shard-3)
test/acceptance/session-cache/protocol.test.ts
  > immutable session-cache acceptance generations
  > routes two launch/observe processes through the real product admission fence
  30249ms
  AssertionError: expected [ { …(19) }, { …(19) } ] to deeply equal [ ObjectContaining{…} ]
```

Run: https://github.com/DumoeDss/rasen/actions/runs/31869784203

**What is known, and what is not.**

- It is **unrelated to Store-v2**. Nothing in slice 1 touches the session-cache acceptance surface.
- It **passed on this exact shard in the previous CI round** of the same PR, and the only change
  between rounds was two test files (`vocabulary-sweep.test.ts`, `command-registry.test.ts`),
  neither of which this suite reads.
- **30249ms against a 30000ms `testTimeout`** — 249ms over. The assertion shape ("expected 2 to
  equal 1") is what a slow run looks like when an extra process record survives into the window.
- Everything above is consistent with a flake, and **that is a hypothesis, not a verdict.** This
  repo's standing rule is that failure shape does not separate contention from defect — a hard
  assertion failure has passed solo here before. **Re-run the job first.** If it goes green, the
  fix may be a timeout or a stabilisation of that test rather than a product change; if it fails
  again, you have a real defect and the 249ms is a symptom, not the cause.

Do not assume the earlier CI round's other failures are still relevant — they were fixed in
`2628f83f` (two frozen inventories that this portfolio legitimately grew) and are green now.

## The worktree you must avoid, and why

`.claude/worktrees/store-v2-foundation` is on branch `feat/store-v2-foundation` (the merged PR head)
and **another session is actively working in it**, with the entire `layout-migration` slice
uncommitted in the tree: the 13-file `layout-migration/` module, `layout-write-guard.ts`,
`membership-layout.ts`, `migration-ops-v2.ts`, `consistency-gates.ts`,
`src/commands/store-migrate-layout.ts`, the registry/locale wiring, and about a dozen test files —
most of them staged.

Consequences you must respect:

- **Never commit broadly there.** A `git commit -a` or a wide `git add` sweeps slice 2's work into
  whatever you are doing. Narrow explicit pathspecs only, and check what you excluded.
- **Local test runs there measure a mixed tree** (slice 1 + half of slice 2) and cannot be
  attributed to either.
- That session added `migrate-layout` to `src/core/completions/command-registry.ts` and to
  `test/core/completions/command-registry.test.ts`'s pinned list. Both are correct and are theirs.

This handoff file itself lives in that worktree. If your fresh worktree does not have it, fetch it
from the `feat/store-v2-foundation` branch on the remote.

## Step 5: archiving the three children

This has hard constraints. Getting them wrong is expensive and in one case unrepairable.

**Order is required, not stylistic: child 1 -> child 2 -> child 3.** Child 3's archive projection
lists `store-planning-layout-v2` as a CREATE, which means child 1 has not yet archived the
capability both of them touch. Out of order, they collide.

**Backfill the three CI-gated tasks first**, using a real run reference from a green CI run on
`dev/0.2.0` (your fix PR's run will do):
`store-planning-contract-v2` 6.5, `store-worktree-bindings-v2` 6.9, `store-issue-resources` 8.6.
All three are Windows-matrix verification whose "record the run reference" half was structurally
unobtainable from a local worktree. Until they are ticked, `archive --dry-run` reports
`1 task(s) are incomplete` for children 1 and 2 — that blocker is the machine telling the truth.
**Never use `[~]`**: it matches neither `[ ]` nor `[x]`, so the task vanishes from numerator AND
denominator and no gate can see it.

**Archive must land on the merged line**, i.e. do it from a worktree on `dev/0.2.0` (or a branch off
it that you PR back), not on the now-merged feature branch.

**`rasen archive` does not commit.** Commit afterwards with a narrow pathspec.

**Archive evidence is content-addressed.** `archive.json` and the journal each record per-file
sha256. Appending or editing anything after the fact desyncs both records and cannot be cleanly
repaired. Get it right in one pass; do not plan to "add a note later".

**Do not pre-write an `## Archive` heading in any ship log** — `rasen archive` treats it as belonging
to another transaction and refuses with `archive_recovery_required`. The three ship logs are already
written correctly; do not "tidy" them.

Use `node bin/rasen.js archive '<change>' --dry-run --json` and require `blockers: []` before the
real run. `validate --strict` does NOT check deltas against code or project the archive — a passing
validate proves nothing about archivability.

## Also outstanding after archive

`slices/store-v2-foundation/result.md` still says **`Status: not started`** while all three children
have shipped and merged. Reconcile it with the four evidence items its own text promises: ported
suite results, the Issue-lifecycle artifact, the regression proof, and the 0.1.7->0.2.0 structural
adaptation notes. This is the same disease slice 1 kept finding — a record saying A while the fact
is B, with nothing to catch it.

## The standing directive (from lead-3, still in force)

> Port everything first, then check. 0.1.7 already did all of this.

Slice 1 was run at a verification density 0.1.7 was never held to. It found four real defects — and
**all four are present in the released, tagged 0.1.7**, verified by reading `origin/dev/0.1.7`
directly. The port itself was nearly free (`git diff e62b101f origin/dev/0.2.0 -- src/core/store` is
EMPTY; store internals were a greenfield drop).

For the remaining slices: port the module and its tests as-is, keep `tsc`/`lint`/`build` clean, run
only the ported module's own suites locally, push, and **let CI be the gate**. Do not run verify
rounds, audit spec-vs-code consistency, hunt latent 0.1.7 defects, or mutation-prove ported guards.
**Do not re-run the full suite locally** — see below.

## The machine

**Local full-suite runs are not trustworthy here.** Three runs at `VITEST_MAX_WORKERS=2` produced
19 distinct failing files across 21 occurrences, only 2 repeating, and **zero appearing in all
three**. One run was cut off at 118/189 files while still exiting 0 — **`exit 0` is not proof a run
finished; check for the `Test Files` summary block.**

Two measured causes:

1. **Contention.** `VITEST_MAX_WORKERS=1` fixes it. Every suite that failed repeatedly at 2 workers
   passed first time at 1.
2. **`%TEMP%` fixture residue**, which reached **3,983** leftover `rasen-*` directories (many full
   Git repos). `statSync` over them alone took >120s, and `node bin/rasen.js --version` measured
   **2223-29470ms on the same binary**. After deleting the 3,430 older than an hour, the startup
   *spread* collapsed from 13x to 1.1x. It re-accumulates, and it is self-reinforcing: residue slows
   the FS, tests time out, cleanup is skipped or EPERMs, residue grows. **Check it before trusting
   any local measurement.**

If you must take a local gate: `VITEST_MAX_WORKERS=1` plus `VITEST_FILE_PARTITION` in thirds keeps
each run to 10-25 minutes and completes.

## Traps

- **`test/helpers/run-cli.ts:166` — `ensureCliBuilt()` builds ONLY when `dist/cli/index.js` is
  ABSENT.** It never rebuilds on source change. **`pnpm run build` before any CLI suite**, or your
  result describes a stale binary. Related: **do not read `dist/` to learn what the source says.**
  Session 3 enumerated the command registry from `dist/` and got a stale answer that was missing an
  entry, then wrote a test expectation from it.
- **`node bin/rasen.js …`, never bare `rasen`** — the bare command is a globally installed **0.1.7**
  build while this repo is 0.2.0.
- **`packages/ui` is excluded from the root vitest config** — `pnpm exec vitest run packages/ui/test/`
  runs ZERO tests and prints "passed". Use `pnpm -C packages/ui exec …`.
- **Never `git checkout --` to revert a mutation** — `core.autocrlf` rewrites the tree to CRLF and
  produces a spurious whole-file diff. Snapshot out-of-repo, restore, verify by sha256.
- **Backticks inside `node -e "…"` are executed by bash as command substitution.** This silently ate
  a phrase out of a record in session 3, leaving a plausible sentence with a hole in it. Use single
  quotes, a heredoc, or the Write tool.
- **`commander-presentation.ts` hard-crashes CLI startup** on a structural mismatch with
  `command-registry.ts`, or on missing English locale copy for any registered command or flag. The
  failure mode is a dead binary, not a red test — `node bin/rasen.js --help` is a real check.
- **Locale catalogs must keep identical key sets across en/ja/zh-cn.**
- **The proxy**: `127.0.0.1:7890` needs a Clash rule routing `github.com`, `githubusercontent.com`
  and `ghcr.io` through a node. Without it git fails with `SSL_read: unexpected eof` *after* the
  proxy answers `200 Connection established` — the proxy accepts the tunnel and then routes it
  DIRECT, which is blocked.

## Working set

- Merged PR: https://github.com/DumoeDss/rasen/pull/157
- CI run to diagnose: https://github.com/DumoeDss/rasen/actions/runs/31869784203
- Direction: `rasen/work/issue-centered-automation-platform/store-v2-onto-020/`
- Prior handoffs: `handoff/lead-1.md` through `lead-3.md`. `lead-3.md` carries the
  `layout-migration` survey (port target `95f26f4c`, two inbound files, zero re-implementation) —
  that slice is now in flight in the other session, so treat that section as context, not as work.
