# store-planning-worktree-bindings — fix report, round 2

Fixer: same independent fixer as round 1; wrote neither the original code nor
either review. Input: `evidence/review-report-r2.md`, which closed all 12
round-1 findings and raised two new low-severity items.

**Both closed: 13 fixed, 14 fixed by broadening enforcement.** No round-1 fix
was touched. Discrimination for each is in §3.

---

## 1. Finding 13 — the human `rasen context` output contradicted itself

`src/commands/context.ts:197-210`, and the sibling surface the review did not
name: `src/commands/workspace.ts:173-186`.

**The cause is narrower than "the sentence is wrong".** Both printers re-derived
a claim — "no workspace is prepared" — from a boolean that answers a different
question. `prepared === false` is true in three distinct situations:

1. nothing is prepared for the scope (the sentence is correct);
2. several pairs are prepared and the caller's location names none of them
   (finding 3's fix, and what finding 13 reports);
3. the pair could not be resolved at all (`gatherWorkspace`'s catch branch,
   which emits `workspace_unresolved`) — where the sentence was *already* false
   before finding 3 existed.

So the fix is not to special-case ambiguity. It is to stop the printer deciding
at all: `types.ts` now exports `WORKSPACE_NOT_PREPARED_CODE` and
`reportsNoPreparedWorkspace(findings)`, `module.ts` emits the finding through
that same constant, and both printers print the sentence only when the Module
said it. The Module already distinguishes the three cases; the printers now
repeat that instead of guessing from a flag. Case 3 is fixed as a side effect,
and a future fourth absence code cannot reintroduce the contradiction.

Fixing `workspace.ts` as well is the repository rule the round-1 brief states:
one surface is never proof of an invariant. `rasen store workspace show`
without `--change` reaches the identical branch, and its printer had the
identical `if (!description.prepared)`.

Two tests, one per surface, plus a third that pins the sentence is still printed
where it is true — `#### Scenario: A scope with no prepared workspace` requires
the payload to say so explicitly, and a gate that silences a true statement
would trade one defect for another.

## 2. Finding 14 — the guard's claim exceeded its enforcement

**I broadened the enforcement, and narrowed the claim. Both, because neither
alone is honest.**

### Why not the obvious stronger guard

The first thing I tried was the guard whose claim would be literally true: no
workspace module may *reach* a Git-spawning module, transitively. I built the
import graph over `src/` and measured it. It is not achievable, and the reason
matters:

```
--- transitive reach to a git spawner ---
    apply.ts    -> src/core/store/workspace/dependencies.ts, src/core/store/git.ts
    binding.ts  -> …, src/core/store/git.ts
    cleanup.ts  -> …, src/core/store/git.ts
    module.ts   -> …, src/core/store/git.ts
    …every one of the 13 workspace files…
```

Every workspace module already reaches `store/git.ts` today, through
`store/registry.ts`. A transitive guard would be red on the day it was written,
and it would be asserting a property this codebase does not have. Writing it and
then exempting the paths that fail is how a guard becomes decorative.

### What is enforceable, stated exactly

Three checks, and the boundary between them is now written into the test file
rather than implied:

1. **`names the Git executable in exactly one file of this Module`** — the
   round-1 spawn-site check, renamed and with its scope stated. It reads only
   this directory's text and establishes only that: within the workspace
   directory, one file spawns Git. Its comment now says in as many words that
   this does NOT establish Git is unreachable, and points at the ledger.
2. **`reaches outside its own directory only through the enumerated ledger`** —
   new. Every import that leaves `src/core/store/workspace/` must appear in
   `ALLOWED_EXTERNAL_IMPORTS` (21 entries: 7 packages/builtins, 14 repository
   modules), enumerated one by one with no directory-prefix rule, and checked
   for staleness in both directions exactly like the token ledger. Adding a door
   is a diff to that list, which is the review moment the source guard exists to
   create.
3. **`never imports a module that spawns Git`** — new, and the sharper half
   because it needs no curation. The spawner set is **derived**, not listed: any
   `src/` module that imports `child_process` and names `git` as a quoted
   executable. Whatever the ledger happens to permit, such a module may not be
   reached directly. The check asserts its own derivation found
   `src/core/store/git.ts` first, so an empty spawner set cannot make it
   vacuous — the check is guarded against becoming the very thing this review
   round is about.

The honest combined claim, which is what the test names now say: *the set of
doors out of this Module is closed and reviewed, and none of them spawns Git.*
Not "Git is unreachable" — that would be false.

### The concrete scenario

A fourth test constructs exactly the reviewer's scenario in memory: prepend
`import { commitStoreFiles } from '../git.js';` to `module.ts` and call it — the
natural next step from "print the pathspec the user may commit themselves" to
committing it. It asserts, in one place, both halves of the finding:

- all three **text-scanning** checks stay clean (no verb, no `'git'` literal, no
  `child_process` in this directory) — which is why the round-1 guard's claim
  was wrong;
- both **import** checks fire, each naming the file and what it reached.

That is the discrimination and the documentation in the same case.

---

## 3. Discrimination — what was observed with each fix reverted

| Fix | Revert | Observed |
| --- | --- | --- |
| 13 | both printers back to `if (!prepared)` | exactly 2 failed: `× reports NO pair, and names every candidate, when the location decides nothing` (context) and `× does not claim a scope with two prepared pairs has none, when --change names neither` (`store workspace show`). **`still says so, in both forms, when the scope genuinely has no workspace` stayed green**, which is the half that proves the fix did not simply delete the sentence. 21 other cases green. |
| 14a | `ledgerEntryFor` returns `null` for relative specifiers — the round-1 state, where no import analysis existed | 2 failed: `× reaches outside its own directory only through the enumerated ledger` (on the **staleness** direction: all 14 repository entries became unreachable) and `× fails when a sibling Git-spawning module is imported…`. Note `never imports a module that spawns Git` *passed* under this revert — vacuously, having no relative imports left to inspect. The two checks are not redundant, and only the scenario case catches both blind spots at once. |
| 14b | spawner derivation disabled (`gitSpawningModules` returns empty) | 2 failed: `× never imports a module that spawns Git` — on its own **sanity assertion**, before reaching the offender list — and `× fails when a sibling Git-spawning module is imported…`. This is what stops an empty derived set from making the check pass by having nothing to compare against. |

All reverts restored; the suite is green afterwards (see §4).

---

## 4. Gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean, no output |
| `npx eslint src test` | clean, no output |
| `node bin/rasen.js validate store-planning-worktree-bindings --strict` | `Change 'store-planning-worktree-bindings' is valid`, EXIT=0 |
| `git diff --check` | clean, exit 0 |
| `test/core/store/**`, `test/core/store-planning/**`, `test/vocabulary-sweep.test.ts`, `test/core/session-runtime-context.test.ts` | 69 files, **1072 passed, 2 skipped, 0 failed** |
| `test/commands/` — `workspace-cli`, `context-workspace`, `context`, both v2 workspace journeys, `store-target-line-cli`, `legacy-groups-removed`, `store-v2-planning-scope-journey` | 8 files, **49 passed, 0 failed** |
| `test/cli-e2e/**`, `test/core/completions/**`, `test/commands/pipeline-store-root-selection.test.ts` | 21 files, **408 passed, 13 skipped, 0 failed** |

**Failing files: none.**

One transient, named rather than waved away: the first run of the core batch
reported `FAIL test/core/store/workspace-plan.test.ts > reports both root
containment checks as satisfied for the normal case`. The same file then passed
22/22 in isolation and the identical batch passed 69/69 on re-run, so it is
contention, not a regression — but I record the case name so it is not
rediscovered as new.

## 5. The `workspace-cli.test.ts` cleanup case — margin

**Measured, and the budget is now explicit.**

| condition | duration | budget | headroom |
| --- | --- | --- | --- |
| reviewer's isolated run (round 1) | 20.2s | 30s default | 33% |
| my isolated run (round 2, busier host) | 25.1s | 30s default | 16% |
| 2-file batch | 29.6s | 30s default | 1.4% |
| after the explicit budget, 8-file batch | 26.7s | 120s | 78% |

**My round-2 changes add no Git calls to that path** — finding 13 is a printer
change and finding 14 is test-only — so the drift from 20.2s to 25.1s is host
load, not new work. But 4.9s of headroom on a default nobody chose is not a
budget, and this case is the first in the change to fail on a slower CI, where
an overrun reads as a defect rather than a timeout. I gave it an explicit
`120_000` with a comment recording all three measurements and why. That is a
budget statement, not a slowness fix: the case drives three cleanup previews and
one apply through real Git and four CLI subprocesses.

The one new case I added to that file (`does not claim a scope with two prepared
pairs has none`) prepares two pairs and runs 18.6s; it carries its own explicit
`120_000` for the same reason and does not touch the cleanup case's path.

## 6. Boundaries

Nothing outside child 4's scope was edited this round. `src/core/store/git.ts`
was **read** — to confirm it spawns `git add`, `git commit`, `git rm`,
`git clone`, and `git init` — and not modified. No child 3 file
(`membership.ts`, `layout-migration/**`, `layout-write-guard.ts`,
`store-migrate-layout.ts`, `bootstrap.ts`, `operations.ts`) and no child 5 file
was touched.

Files changed this round: `src/core/store/workspace/types.ts` (the exported
constant and predicate), `src/core/store/workspace/module.ts` (emit through the
constant), `src/commands/context.ts`, `src/commands/workspace.ts`,
`test/core/store/workspace-git-verb-guard.test.ts`,
`test/commands/context-workspace.test.ts`, `test/commands/workspace-cli.test.ts`.

**One thing for the shipper, carried over and still open:** the round-1 report's
note that `workspace_dirty_tree` is a declared taxonomy member no code path can
raise. The r2 review confirmed it appears in `proposal.md:17` and
`design.md:160` and in **no delta spec**, so it never reaches `rasen/specs/` at
archive — it is one line of PR-body editing before ship, not a blocking item.

**One new note.** `ALLOWED_EXTERNAL_IMPORTS` is a ledger over a directory three
other children also build near. If a sibling adds a file under
`src/core/store/workspace/` that imports something new, this gate turns red on
their change — by design, and the failure message names the file and the module
it reached.

---

## 7. The reported `module.ts` <-> `binding.ts` import cycle: it does not exist

Referred by child 5's implementer, whose
`test/core/store/finalization-surface-parity.test.ts:20-24` carries an
import-ordering workaround and this comment:

> The fixture is imported FIRST on purpose. It pulls the Store planning and
> workspace modules, which have a cycle between `workspace/module.ts` and
> `workspace/binding.ts`; letting the management-API bridge's graph load ahead
> of it evaluates that cycle from the wrong entry point and leaves
> `assertCarrierAgreesWithScope` in its temporal dead zone.

**The stated cause is wrong in three independent ways.** Each was checked, not
reasoned about.

**1. Static — there is no such edge, and no cycle at all.** Tarjan over the
value-import graph of all of `src/` finds three strongly-connected components
and **none contains any workspace file**. The workspace directory's internal
graph is a strict DAG:

```
module.ts  -> apply, binding, cleanup, dependencies, diagnostics, identity, locks, plan, registry, types
binding.ts -> diagnostics, identity, registry            (and ../identity-types.js)
```

`binding.ts` imports nothing from `module.ts`. The dependency is one-directional.

**2. Language — the named symbol cannot be TDZ-trapped.**
`assertCarrierAgreesWithScope` is `export function` (`binding.ts:192`), a
hoisted function declaration. The temporal dead zone applies to `let`, `const`,
and `class` bindings. A hoisted function is callable even from a
partially-evaluated module inside a *genuine* cycle, which is precisely why ESM
cycles usually work for function exports.

**3. Runtime — it does not reproduce.** Against the built artifact, importing
the management-API graph FIRST (`management-api/finalize.js`,
`archive-consumer-invocation.js`, `store/finalization/index.js`) and then the
workspace graph, versus the reverse order:

```
order                                : management-first
typeof assertCarrierAgreesWithScope  : function
call with agreeing scope             : OK (no throw)
call with disagreeing scope          : refused with workspace_marker_conflict

order                                : workspace-first
…identical…
```

### What child 5 probably hit

Something failed for them; the attribution is what is wrong. The workspace
Module sits downstream of a **real** 7-module cycle, at three separate entry
points:

```
cli-locale.ts <-> config-diagnostic-locale.ts <-> global-config.ts <->
project-registry.ts <-> retired-edit-boundary.ts <-> store/foundation.ts <->
store/project-records.ts
```

`workspace/cleanup.ts` and `workspace/dependencies.ts` import `global-config.ts`;
`dependencies.ts` imports `project-registry.ts`; `scope.ts` imports
`store/foundation.ts`. Entering that component from a different edge is exactly
the described failure mode, and any `const` or `class` in those seven modules IS
TDZ-eligible. **None of the seven is a child 4 file** — they are shared core and
Store core.

### Recommendation

- **Nothing to break in child 4's files.** Moving a helper to "break" a cycle
  that does not exist would churn a file three reviewers have read and would not
  touch the real component.
- **The comment should be corrected or removed** — it is child 5's file, so the
  LEAD routes it. A false comment is worse than none: it is a wrong map handed
  to whoever debugs the next occurrence.
- **Whether the ordering workaround is still needed is now an open question, not
  a settled one.** The stated mechanism does not exist, so if the ordering is
  load-bearing it is load-bearing for a reason nobody has identified. That is a
  one-line experiment in child 5's file (drop the ordering constraint, run the
  suite) which I did not perform because the file is not mine.
- **The trap is now non-positional for this Module.** Rather than trusting the
  DAG, `workspace-git-verb-guard.test.ts` asserts it: `has no import cycle of
  its own, so no binding can sit in a temporal dead zone` runs Tarjan over the
  Module's value-import graph. Value imports only, because `import type` is
  erased and cannot cause a runtime cycle — a scan counting those would forbid a
  harmless type cycle and call it a defect.

**Discrimination**, executed in-suite rather than by reverting production code,
because the checker IS the artifact: `reports a back-edge that would create one`
injects `import { completeChangeBinding } from './module.js'` into `binding.ts`
in memory — the exact edge the false report describes — and the checker returns
one component containing both files and **five** modules in total, because
`module.ts` also reaches `binding.ts` through `apply.ts`, `cleanup.ts`, and
`plan.ts`. One back-edge would make five modules mutually dependent, and the
guard names all of them. The acyclicity test also asserts its own graph is
non-empty and that a known edge is present, so an empty or unresolved graph
cannot make it pass vacuously.

### Gates after §7

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean (one poll: a sibling's in-flight `src/core/store/query/refs.ts(392,12) TS2304` cleared on its own; not a child 4 file) |
| `npx eslint src test` | clean |
| `git diff --check` | clean, exit 0 |
| `test/core/store/**`, `test/core/store-planning/**`, `test/vocabulary-sweep.test.ts` | 68 files, **1048 passed, 2 skipped, 0 failed** |
| `test/core/store/workspace-git-verb-guard.test.ts` | **12 passed** |

**Failing files: none.**
