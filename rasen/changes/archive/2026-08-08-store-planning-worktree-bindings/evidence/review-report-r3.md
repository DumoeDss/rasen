# store-planning-worktree-bindings — independent review, round 3

Reviewer: same independent reviewer who wrote `evidence/review-report.md` and
`evidence/review-report-r2.md`; wrote none of the code and none of the fixes.
Read-only: no `src/`, `test/`, or other artifact was modified.

**Verdict: finding 13 genuinely closed; finding 14 genuinely closed; the
`module.ts` ↔ `binding.ts` import cycle does not exist.** No new findings.

---

## A. Finding 13 — the human `rasen context` output contradicted itself

### (a) The undecided case now produces a consistent message

The fix moved the decision from the printer to the Module. I traced all three
code paths:

**`module.ts:201-224`** — when `entry === null`, the finding emitted depends on
`selected.undecided.length`:
- `> 0` → finding code `workspace_binding_ambiguous`
- `=== 0` → finding code `WORKSPACE_NOT_PREPARED_CODE` (the constant from
  `types.ts:315`, value `'workspace_not_prepared'`)

**`context.ts:207`** — the printer now gates on
`reportsNoPreparedWorkspace(workspace.findings)`, which checks for
code `=== 'workspace_not_prepared'`. In the undecided case the finding code is
`workspace_binding_ambiguous`, so the predicate returns `false`, and
"No workspace is prepared" is NOT printed. The `workspace_binding_ambiguous`
finding IS then printed by the findings loop at `context.ts:228-230`. Output is
consistent: one finding, no contradiction.

Test confirmation (`context-workspace.test.ts:273-307`, "reports NO pair, and
names every candidate, when the location decides nothing"):
`human.stdout` asserts NOT containing `'No workspace is prepared'`, asserts
containing `'has 2 prepared workspaces'`, `'add-billing'`, `'zebra-fix'`, and
`'--change'`. This test ran green in my independent pass.

### (b) The sibling surface is fixed

**`workspace.ts:179`** — the `renderDescription` printer uses the identical
predicate: `reportsNoPreparedWorkspace(description.findings)`. The comment at
lines 176-178 states the same rule.

Test confirmation (`workspace-cli.test.ts:227-285`, "does not claim a scope with
two prepared pairs has none, when `--change` names neither"): prepares two pairs,
runs `store workspace show` with no `--change`, asserts
`human.stdout` does NOT contain `'No workspace is prepared'`, asserts containing
`'has 2 prepared workspaces'`. This test ran green in my independent pass.

### (c) No new contradiction

The third case the fix report named — the `catch` branch in
`context.ts:178-195` — produces a finding with code `'workspace_unresolved'`,
not `'workspace_not_prepared'`. `reportsNoPreparedWorkspace` returns `false`,
the sentence is not printed, and the `workspace_unresolved` finding IS printed.
Consistent. This case was already false before finding 3 existed, and the fix
closes it as a side effect.

The genuinely-no-workspace case is preserved:
`context-workspace.test.ts:309-325` ("still says so, in both forms, when the
scope genuinely has no workspace") asserts both that JSON findings contain
`workspace_not_prepared` and that human stdout contains
`'No workspace is prepared for project app-a'`. Ran green.

Re-export verified: `types.ts:315` exports `WORKSPACE_NOT_PREPARED_CODE` and
`types.ts:318-322` exports `reportsNoPreparedWorkspace`. `index.ts:8`
re-exports everything from `types.js`. Both printer files import it from
`'../core/store/workspace/index.js'`.

**Finding 13 is closed.**

---

## B. Finding 14 — the guard claimed Git was reachable from exactly one place, and it was not

### (a) The enforcement catches the concrete scenario

The test `fails when a sibling Git-spawning module is imported, in the shape a
maintainer would write` (`workspace-git-verb-guard.test.ts:549-583`) constructs
the exact scenario from my round-2 finding: it prepends
`import { commitStoreFiles } from '../git.js';` to `module.ts` and appends a
call.

The three text-scanning checks stay clean (asserted in the test at lines
564-569): no verb offender, no force offender, spawn offenders only show
`dependencies.ts`. This proves the round-1 guard's blind spot is real.

Both import checks fire (asserted at lines 572-582):
- The **ledger** check resolves `'../git.js'` to `src/core/store/git.ts`, which
  is NOT in `ALLOWED_EXTERNAL_IMPORTS` → reports
  `src/core/store/workspace/module.ts -> src/core/store/git.ts`.
- The **spawner** check derives `src/core/store/git.ts` as a Git-spawning module
  (confirmed: it imports `node:child_process` and names `'git'` as a quoted
  executable at lines 61, 83, 123, 132, 163, 196) and reports the same offender.

### (b) The claim and the enforcement match

The old test name — "spawns Git from exactly one place, so a call the verb scan
misreads still cannot reach Git" — asserted a property the codebase does not
have. The new test name ("names the Git executable in exactly one file of this
Module") states only what it proves: one file names `'git'`. Its comment
(lines 446-450) explicitly disclaims transitive unreachability and points to the
import ledger.

The three checks now compose honestly:
1. **Spawn-site** — one file in this directory names `'git'`. Scope stated.
2. **Import ledger** — every external import is in a curated, staleness-checked
   list.
3. **Spawner exclusion** — no curated import reaches a module that spawns Git,
   derived mechanically rather than listed.

The combined claim (stated in the test file's ledger comment, lines 60-66): the
set of doors out of this Module is closed and reviewed, and none spawns Git. Not
"Git is unreachable" — that is false, because every workspace module reaches
`store/git.ts` transitively via `registry.ts`.

### (c) Discrimination — confirmed by construction

I could not apply the fixer's production reverts (read-only review, other agents
live in the tree), but I verified discrimination by tracing the test's own
structure:

**Spawner derivation disabled** (empty set): The test "never imports a module
that spawns Git" (lines 479-499) carries a sanity assertion at lines 488-489:
`expect(spawners).toContain('src/core/store/git.ts')`. An empty set fails here
before reaching the offender check. The scenario test at lines 578-582 also
fails because the spawner filter produces an empty list.

**Ledger analysis disabled** (`ledgerEntryFor` returns null for relative
specifiers): The test "reaches outside its own directory only through the
enumerated ledger" (lines 460-477) has a staleness check at lines 474-476 that
asserts every `ALLOWED_EXTERNAL_IMPORTS` entry is reached. With no relative
imports resolved, all 14 repository entries become unreachable, and the
staleness assertion fails. The scenario test at lines 573-577 also fails.

The two checks are not redundant: the ledger catches any unreviewed import; the
spawner check catches Git-spawning imports regardless of the ledger.

**Finding 14 is closed.**

---

## C. The import cycle assessment

### 1. Is the cycle real?

**No.** I read both files' import statements.

**`module.ts`** imports from `binding.ts` (value imports, lines 28-35):
`assertCarrierAgreesWithScope`, `detectBindingAmbiguity`, `planningMarkerPath`,
`readBindingFact`, `surveyWorktree`, `verifyIndexEntry`.

**`binding.ts`** imports (lines 22-40):
`node:crypto`, `planning-layout-v2.js` (type-only), `identity-types.js`,
`dependencies.js` (type-only), `diagnostics.js`, `identity.js`, `registry.js`,
`types.js` (type-only).

**`binding.ts` does not import from `module.ts`.** Not directly, and not
transitively — its direct imports (`diagnostics.js`, `identity.js`,
`registry.js`) are leaf modules that do not reach back into the workspace
directory's other files. The dependency is strictly one-directional:
`module.ts → binding.ts`. There is no cycle.

### 2. If real, is it dangerous?

No, for two independent reasons that each suffices:

- **The cycle does not exist**, so there is no edge from which a different entry
  point could produce a TDZ.
- **Even if it did**, `assertCarrierAgreesWithScope` is
  `export function assertCarrierAgreesWithScope(...)` (`binding.ts:192`) — a
  hoisted function declaration. The temporal dead zone applies to `let`,
  `const`, and `class` bindings. A hoisted function is callable from a
  partially-evaluated module inside a genuine cycle, which is why ESM cycles
  generally work for function exports.

### 3. What should happen?

**Nothing in child 4's files.** The fixer added a structural assertion
(`workspace-git-verb-guard.test.ts:501-524`) that runs Tarjan over the workspace
Module's value-import graph and asserts no cycle exists, with a discrimination
test (`reports a back-edge that would create one`, lines 526-547) that injects
the claimed `binding.ts → module.ts` edge and confirms the checker catches a
5-module strongly-connected component. The assertion checks its own graph is
non-empty (line 522) and that a known forward edge is present (line 523), so it
cannot pass vacuously. This is the right structural fix: the property is now
enforced rather than assumed.

**Child 5's comment should be corrected or removed.** It is child 5's file
(`test/core/store/finalization-surface-parity.test.ts`), so routing is the
LEAD's call. The comment attributes a workaround to a non-existent mechanism.
The fix report's §7 correctly identifies the real hazard — a 7-module cycle in
shared core (`cli-locale.ts ↔ config-diagnostic-locale.ts ↔ global-config.ts ↔
project-registry.ts ↔ retired-edit-boundary.ts ↔ store/foundation.ts ↔
store/project-records.ts`) that the workspace Module sits downstream of — and
notes that none of those seven modules is a child 4 file. A false comment is
worse than none; whoever debugs the next occurrence would follow a wrong map.

**Whether child 5's import-ordering workaround is still load-bearing is an open
question.** The stated mechanism is wrong, so if removing the ordering
constraint breaks the suite, the real cause is the shared-core cycle, not this
Module. That is a one-line experiment in child 5's file (drop the ordering, run
the suite) which I did not perform because the file is not in my scope.

---

## D. Gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean, no output |
| `npx eslint` (scoped: workspace dir, context.ts, workspace.ts, verb guard test) | clean, no output |
| `node bin/rasen.js validate store-planning-worktree-bindings --strict` | valid, EXIT=0 |
| `test/core/store/workspace-git-verb-guard.test.ts` | 12 passed |
| `test/core/store/**` | 76 files, **1199 passed, 2 skipped, 0 failed** |
| `test/core/store-planning/**`, `test/core/session-runtime-context.test.ts`, `test/vocabulary-sweep.test.ts` | 5 files, **75 passed, 0 failed** |
| `test/commands/context-workspace.test.ts`, `test/commands/workspace-cli.test.ts` | 2 files, **23 passed, 0 failed** |

**Failing files: none.**

The 5 pre-declared environmental failures (`config.test.ts` ×1,
`config-editor.test.ts` ×4) were not in scope and were not run.

---

## E. No new findings

The round-2 fix delta introduces no new defect. Finding 13's printer fix is
correct across all three absence cases and both surfaces. Finding 14's
broadened enforcement is honest in its claims and discriminating in its
construction. The import cycle does not exist, and the structural assertion that
proves it is itself discriminating.
