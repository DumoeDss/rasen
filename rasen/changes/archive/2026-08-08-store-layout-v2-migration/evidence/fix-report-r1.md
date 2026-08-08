# Review round 1 — fixes (`store-layout-v2-migration`, child 3)

Fixer: independent of both the implementers and the reviewer.
Input: `evidence/review-report.md` (2 high, 4 medium, 2 low, 2 informational).

**8 fixed, 1 partially rejected with reasoning, 0 deferred.**

Every fix below was mutation-proved: the production change was reverted, the
suite re-run, the failing set recorded by name, the fix restored, and the suite
re-run green. Where a revert made more than one test fail, all of them are
listed — the count is the evidence, not a summary of it.

---

## H1 — membership readers did not dispatch on the declared layout

**Fixed.** The review named three lines. Enumerated independently, the true
extent is **four readers in two files**, and the two the review classified as
"correctly deferred to child 7" (I10) turned out to be load-bearing for the fix
itself.

### The full enumeration

Every production read of `.rasen-store/projects/<projectId>.yaml` in `src/` —
13 sites, classified:

| Site | Verdict |
| --- | --- |
| `membership.ts` `listStoreMembers` | **BROKEN** — `listStoreProjectRecords`, v1-only |
| `membership.ts` `resolveProjectMembership` | **BROKEN** — `readStoreProjectRecord`, v1-only |
| `bootstrap.ts` `projectFirstBundleDeclarations` | **BROKEN** — v1-only |
| `bootstrap.ts` `readUnreadableRecord` | **BROKEN** — v1-only |
| `membership.ts` `plannedMembershipWrites`, `writeMembershipRecord` | correct — dispatches |
| `membership-layout.ts` | the dispatcher itself |
| `migration-ops-v2.ts` ×3, `migration-ops.ts:494` | correct — `readStoreMembership` |
| `layout-migration/diagnostics.ts` ×2 | correct — `listStoreMembership` |
| `migration-ops.ts` `readProjectOwnership` / `clearProjectOwnership` | correct as v1-only — the legacy eject path; a v2 Store dispatches to `migration-ops-v2.ts` and never reaches it |
| `migration-ops.ts` `migrateStoreMembership` | correct as v1-only — the legacy `store migrate-membership` command, which produces `version: 1` records by definition |
| `layout-migration/plan.ts:469`, `evidence.ts:156` (`parseStoreProjectRecord`) | correct as v1-only — the migration's SOURCE reader; it is reading the pre-migration record on purpose |
| `project-records.ts` | the v1 schema and its reader/writer |
| `operations.ts:1468` | a path string in a message, not a read |

### Why the two `bootstrap.ts` sites could not be deferred

`readUnreadableRecord` runs **before** `resolveProjectMembership` and
short-circuits it (`bootstrap.ts:2173-2179`): when it answers "the record exists
and cannot be read", membership is never asked. Against a layout v2 catalog the
v1 parser fails, so it answered that for every healthy catalog in a migrated
Store — and fixing only the two membership readers would have left bootstrap
reporting `unverifiable-here` for every project in a migrated Store, with the H1
fix unobservable through that surface entirely.

Both bootstrap sites now dispatch through `readStoreMembership`.
`store-v2-compat-hardening` tasks 2.1 and 2.2 are consequently no-ops, and its
task 3.2 — which classifies `membership.ts` as a frozen legacy adapter — is
wrong and should be dropped.

### One consequence the finding did not mention

`MembershipProvenance` gained `'project-catalog'` so a caller can tell a layout
v2 catalog from a v1 record. That was not cosmetic: `migration-ops.ts:1571`
skips conversion when `provenance === 'v2-record'`, so once `listStoreMembers`
started returning migrated members, `store migrate-membership` would have seen
each v2 catalog as unconverted legacy data and **rewritten it backwards into a
`version: 1` record**, dropping the planning binding. The skip now covers both
record-family provenances.

### Discrimination

| Reverted | Failing set |
| --- | --- |
| `listStoreMembers` → `listStoreProjectRecords` | `membership.test.ts` **2 failed / 26 passed** (both new dispatch tests); `layout-migration-doctor.test.ts` **2 failed / 8 passed** (new roster test + the strengthened pre-existing archive-record test); `space-scoping.test.ts` **1 failed / 21 passed** (new v2-catalog member listing) |
| `resolveProjectMembership` → `readStoreProjectRecord`, `listStoreMembers` left correct | `membership.test.ts` **1 failed / 27 passed** — only "reports a legacy v1 record inside a layout v2 Store rather than accepting it as membership", on the `resolveProjectMembership` line |
| both `bootstrap.ts` sites → `readStoreProjectRecord` | `bootstrap-bundle-import.test.ts` **1 failed / 13 passed** — only the new layout v2 catalog test |
| restored | all green |

The second row is the one worth reading. `resolveProjectMembership` falls back to
`listStoreMembers`, so once the lister is fixed the fallback masks the direct
read for every *positive* answer. The case that still discriminates is the one
the spec actually forbids: a v1 record inside a v2 Store, which the v1 direct
read hands back as a valid member (`provenance: 'v2-record'`) — "not silently
accepted as a second valid membership schema", spec `store-project-membership`.

### Tests added

- `membership.test.ts` — a new describe block whose fixture declares
  `layoutVersion: 2`. Nothing in `test/` did before.
- `layout-migration-doctor.test.ts` — the roster read through the same function
  every consumer uses, after a real migrate + retire.
- `bootstrap-bundle-import.test.ts` — a v2 catalog carrying a `knowledgeBundle`:
  the declaration survives and membership is `confirmed`.
- `management-api/space-scoping.test.ts` — a layout v2 Store's catalogued member
  appears in `GET /api/v1/spaces` with no live checkout on this machine.

---

## H2 — the task-1.3 census matched argument spellings

**Fixed.** Measured extent: **23 flat-helper calls in `src/`; the shipped regex
saw 7.**

```
src/core/store/layout-migration/flat-source.ts   3   specsDir/changesDir/inRepoArchiveDir(storeRoot)
src/core/store/migration-ops.ts                 14   sourcePath x6, storeRoot x4, projectRoot x2, destinationPath x2
src/core/store/migration.ts                      6   3 declarations, root x3
```

Only 7 of the 23 are Store addresses (`flat-source.ts` ×3, `migration-ops.ts`
`storeRoot` ×4). The other 16 were invisible to the census that was described as
"the enforcement".

`test/helpers/source-guards.ts` gained `flatPathHelperCalls()`, inverted exactly
as that module's own docblock prescribes: every CALL is found whatever its
argument is named, reported as `helper(argumentToken)`, with a declaration
distinguished from a call site, and argument extraction stopping at the first
top-level comma so a second argument cannot hide a call. The guard compares the
whole per-file map, so a call in a new file fails on the file key and a new
argument spelling in an existing file fails on the token key.

**Not attempted:** a bare-identifier guard against aliasing
(`const f = changesDir`). Measured across `src/`, `changesDir` and `specsDir` are
widely used as ordinary local variable and property names in 40 files, so such a
guard would be unreadable noise rather than enforcement. Recorded here so the
hole is known rather than assumed closed.

### What the census newly surfaced, and its disposition

All 16 are classified in the allowlist, none is a defect:

- **10 `in-project-layout`** — `sourcePath` (adopt reading the project's own flat
  tree), `destinationPath` (eject restoring into it), `projectRoot` (relocate).
  These are PROJECT roots. They were always out of scope; the difference is that
  they are now visible and classified instead of invisible.
- **6 `helper-definition`** — `migration.ts`, which defines the three helpers,
  plus `inRepoArchiveDir`'s own `changesDir(root)` and the two generic listers.

### Discrimination

Added `void inRepoArchiveDir(planningRoot);` to `flat-source.ts` — the review's
exact failure-scenario shape, an already-allowlisted file with an argument
spelling nobody enumerated.

- Shipped regex: still reported **exactly 7** matches, in the same two files.
  Blind to it.
- New census: **failed**, with the offending `inRepoArchiveDir(planningRoot)` key
  in the diff.

Probe removed. A second assertion in the guard file pins the five spellings that
defeated the old regex (`changesDir(planningRoot)`,
`inRepoArchiveDir(resolvedStoreRoot)`, `specsDir(this.storeRoot)`,
`changesDir(storeRoot, opts)`, `changesDir(store.paths().root)`) plus the
bare-reference exclusion, so the inversion cannot be quietly undone.

`evidence/caller-inventory.md` §1 and §5 corrected: both claimed an enforcement
property the census did not have.

---

## M3 — a re-introduced flat tree after retirement

**Fixed.** `readStoreLayoutState` now reads the receipts' recorded **phase**
rather than counting files in the receipts directory.

- `publicationRecorded` = some receipt records `published` and **not** `retired`
  — the one window in which a v2 Store legitimately holds the flat tree.
- new `retirementRecorded` = some receipt records `retired`.
- `mixed` = `declared === 2 && flatContentPresent && !publicationRecorded`.

A receipt that cannot be read or parsed proves nothing and is skipped, so an
unreadable receipt leaves the Store classified `mixed` rather than blessing a
publication nobody could verify.

Doctor gained a third arm (`awaitingRetirement` / `reIntroduced` / no receipt).
The re-introduced arm is `error`, says the flat tree was retired and is present
again, and **does not** offer `--retire-flat` — following that repair was the
part of the finding that made the state worse than doing nothing.
`assertStoreLayoutForWrite`'s refusal is phase-aware for the same reason: a
retired Store has no interrupted run to resume, so it names
`git log -- rasen/specs rasen/changes` instead of `--status`.

**Discrimination:** reverted to `awaitingRetirement || retired` (the old "any
receipt" rule) → `layout-migration-doctor.test.ts` **1 failed / 10 passed**, only
"treats a flat tree re-introduced after retirement as mixed, and refuses writes".
Restored → 11/11.

The new test runs a real migrate + retire through the Module, commits, then
commits flat content back (which is what a merge produces once those paths no
longer exist on the target), and asserts the state, the severity, the absence of
the false message and the false repair, and the `store-adopt` refusal.

---

## M4 — `rasen doctor` reported none of the nine codes

**Fixed**, rather than recorded as deferred.

`src/commands/doctor.ts` gained `storeLayoutDiagnosisTarget` (the root IS a Store
checkout, or the project declares one that resolves) and
`gatherStoreLayoutFindings`, which calls the **same** `diagnoseLayoutMigration`
`store doctor` calls — one diagnoser, so the two commands cannot drift apart.
`diagnoseLayoutMigration` is now exported from the Module's public entry point
so `doctor.ts` does not reach into its internals.

Computed **before** the store-aggregate early return: a migrated Store resolves
as a store aggregate, so leaving it below that branch would have reported the
layout of every Store except the ones this migration produces.

JSON gains `storeLayout`; human output gains a `Store planning layout:` section
printing `[severity] code: message` and `Fix:` — the code is printed because the
task requires identical codes in both renderings.

Both `.catch(() => [])` swallows are gone (`operations.ts` and the new doctor
path): an undiagnosable Store now reports `store_layout_diagnosis_failed` instead
of reporting as healthy.

The narrowed delta text was widened back to what design D13 promises, with two
new scenarios (both doctors agree; a re-introduced flat tree is not pending
retirement).

**Discrimination:** stubbed `storeLayout` to `[]` →
`store-migration-cli.test.ts` **1 failed / 3 passed**. Restored → 4/4.

The new test runs both commands against one legacy flat Store and compares
`code|fix` pairs as sorted sets, then asserts each code and each fix appears in
the human rendering.

---

## M5 — an E4 mapping entry overrode a provenance-resolved spec owner

**Fixed** with both remedies the review offered, not one.

`resolveSpecOwners` now computes the derived resolution first
(`deriveSpecOwners`) and applies the declaration **only** when derived evidence
left the item unresolved — the same precondition the Change and Archive arm has
carried all along (`plan.ts:223`, `decision.reason !== undefined`).

And a declaration that disagrees with an assigned derived owner is recorded as
`supersededEvidence` on the item, so it reaches the committed receipt. That field
was hard-coded `[]` on every spec item, which is why the disagreement was
recorded nowhere.

**Discrimination:** reverted to declaration-wins →
`layout-migration-mapping.test.ts` **1 failed / 13 passed**, only "does not let a
mapping entry relabel a capability provenance already assigned". Restored →
14/14.

The new test builds the review's own scenario: one contributing Change owned by
`elftia`, a stale mapping entry saying `rocut`. The spec plans to `elftia`, its
evidence is `['spec-provenance']`, the `rocut` assertion is in
`supersededEvidence`, and `sharedSpecResolutions` stays empty because there is
only one contributor.

---

## M6 — `assertStoreLayoutForWrite` unwired for two of five surfaces

**Membership writes: fixed. The migration Module: rejected, with reasoning.**

### Membership writes — fixed

`writeMembershipRecord` now calls `assertStoreLayoutForWrite` inside the record
lock and branches on the state it returns, instead of branching on
`readStoreLayoutState(...).declared` and never consulting `.mixed`.

This needed a third write shape. A membership file lives at
`.rasen-store/projects/<projectId>.yaml` in **both** layouts and only its schema
follows the declared layout, so neither the flat nor the partition refusal
applies to it — but the mixed-state refusal does, and that is the entire finding.
`StorePlanningWriteShape` gained `'metadata'`, documented as exactly that.

**Discrimination:** replaced the assert with a bare `readStoreLayoutState` →
`membership.test.ts` **1 failed / 28 passed**, only "refuses a membership write
into a half-migrated Store instead of branching on the declaration alone", which
also asserts the record file was not created. Restored → 29/29.

### The migration Module — rejected

Task 9.1 also names the migration Module, and it should not. The migration is the
one writer that legitimately spans both layouts:

- `writes: 'partition'` while `declared === 1` **is** the flat-to-v2 publication.
  The guard's third branch would refuse it outright with
  `legacy_flat_store_requires_migration` — the migration would refuse itself.
- The mixed refusal would reject `--resume`, which is the documented recovery for
  precisely the mixed state the refusal fires on. A publication interrupted after
  the layout flip but before the receipt lands is `mixed === true`, and `--resume`
  is how the operator finishes it.

The Module's equivalent gates already exist and are tested: `blocked:mixed-layout`
at plan time (`plan.ts:197-202`), `revalidatePlan` at apply time, and the
Store-scoped owner-aware lock keyed by store UID and ref.

Task 9.1's text has been amended to state what is true and why, rather than
leaving a claim ticked that the code deliberately does not satisfy.

---

## L7 — `layout-no-dual-write.test.ts` was not the sweep it claimed to be

**Fixed, all three sub-items.**

1. **The vacuous relocate case.** `--to in-repo` on a standalone project never
   addresses the Store, so "the Store gained nothing" passed for a no-op. Added
   the relocate direction that actually writes into a Store — `--to store` into a
   v2 Store — asserting the entry arrives at the literal partition target-line
   archive path and leaves the machine home. The `--to in-repo` case stays, but
   now also asserts the entry really stayed in the project, so it can no longer
   pass for a stubbed `relocateArchive`.
2. **The unfailable membership assertions.** `planningTree()` walks only
   `rasen/`; membership records live in `.rasen-store/`. Added `storeTree()`,
   which walks the whole Store root (`.git` excluded). Both membership cases now
   assert the write is **visible to the sweep** —
   `.rasen-store/projects/<id>.yaml` is in the added set — before claiming
   anything about flat or partition paths, so the emptiness assertions are made
   against a non-empty diff.
3. **Migration absent.** Added a second describe block driving the real Module
   through plan → apply → retire, asserting the end state: every flat planning
   path gone, and both the spec and the Change present at literal partition
   addresses. Migration holds both layouts transiently by design, so the sweep
   asserts its end state rather than a per-step invariant.

---

## L8 — human/JSON parity asserted names only

**Fixed.** The renderer already printed states, reasons, destinations, retained
design docs, other flat refs and untracked warnings — the test did not look, and
the fixture produced three of the six components not at all.

The fixture now commits a Store-level design doc, branches `legacy-ref` (a second
ref carrying flat planning content), and leaves an untracked file inside a moved
tree, with `--include-untracked` so the plan stays applicable and the untracked
path is reported as a warning rather than blocking the preview. Per item the test
asserts the state label, the reason sentence, the destination, the target line
and every untracked path appear in the human rendering; plus every retained
design doc and every other flat ref, with `toBeGreaterThan(0)` preconditions so
an empty fixture cannot make the loops vacuous again.

**Discrimination:** dropped the `[${state}]` column from the human renderer →
"human output omits the state of fix-a: expected … to contain '[resolved]'".
Restored → green.

---

## I9 — the stale `submit.ts` comment

**Fixed (comment only; the code path was already correct).** It now says what
ships: no `store:` space is a submission target — a legacy flat Store arrives as
`422 cli_error` carrying the CLI's own refusal because the endpoint spawns the
CLI rather than reimplementing creation, a v2 aggregate is screened earlier by
`isStoreAggregateSpace()`, and the bound project is the target that works in
layout v2.

## I10 — the two `bootstrap.ts` read defects

**Absorbed into H1 rather than deferred.** See H1: `readUnreadableRecord`
short-circuits `resolveProjectMembership`, so leaving these to child 7 would have
made the H1 fix unobservable through bootstrap.

---

## The six guards the review judged non-discriminating

| # | Guard | Disposition |
| --- | --- | --- |
| 1 | `planning-path-source-guard` third census | Rewritten (H2), with its own discrimination assertions in the same file |
| 2 | Task 7.3 dispatch coverage | Four new tests (H1), each against a `layoutVersion: 2` fixture — the layout no test in `test/` had ever built for a membership reader |
| 3 | `layout-no-dual-write` relocate | L7.1 |
| 4 | `layout-no-dual-write` membership assertions | L7.2 |
| 5 | `layout-migration-doctor.test.ts:121` | Strengthened with "no error-severity finding after a clean migration". **The review's claim is confirmed exactly**: under the H1 revert this pre-existing test fails, so that assertion would have caught H1 the day it was written |
| 6 | `store-migrate-layout-cli` parity | L8 |

---

## What the reviewer missed

1. **`readUnreadableRecord` short-circuits `resolveProjectMembership`.** The
   review filed both `bootstrap.ts` sites as correctly deferred. With them
   deferred the H1 fix does not reach bootstrap at all.
2. **Task 10.5 is a second ticked-but-not-done task.** It says "extend
   `test/commands/store-migration-cli.test.ts` for the new diagnostic surface".
   That file contained no layout content of any kind. It does now.
3. **Fixing H1 without `migration-ops.ts:1571` would have destroyed data.** The
   legacy `store migrate-membership` skips members whose provenance is
   `'v2-record'`; once `listStoreMembers` started returning migrated members, a
   v2 catalog would have looked like unconverted legacy data and been rewritten
   backwards into a `version: 1` record, dropping the planning binding.
4. **Nothing proved the management API's space listing sees a migrated Store's
   members.** `space-scoping.test.ts`'s only Store fixture is legacy flat and its
   members come from pointer repos, so `listStoreMembers` contributed nothing
   there in the first place — the surface the portfolio has now been bitten on
   three times was, again, untested. Added.
5. **`StoreProjectCatalogV2.id` is documented as a display name but validated as
   a canonical lowercase kebab id.** `id: Elftia` is rejected with
   `invalid_project_catalog`. Not fixed here — recorded because the field's
   contract and its comment disagree, and anyone hand-writing a v2 catalog will
   hit it.
6. **`operations.ts` had the `.catch(() => [])` the review named and the doctor
   path would have grown a second one.** Both are diagnostics now.

---

## Gate results

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** |
| `npx eslint src test` | **PASS** |
| `node bin/rasen.js validate store-layout-v2-migration --strict` | **PASS** — "Change 'store-layout-v2-migration' is valid" |
| `test/core/store/` + `test/core/store-planning/` | **PASS** — 67 files, 1044 passed, 2 skipped, 0 failed |
| `test/core/management-api/` + `test/core/learned-skills/` | **PASS** — 47 files, 596 passed, 1 skipped |
| `test/cli-e2e/` | **PASS** — 8 files, 73 passed |
| `test/commands/` doctor-touching set (10 files) | **PASS** — 160 passed |
| `test/core/completions/` + `test/core/templates/` + `test/locales/` + `test/vocabulary-sweep.test.ts` | **PASS** — 25 files, 403 passed, 13 skipped |
| The 9 suites this fix touches, re-run serially after the final restore | **PASS** — 114 passed |
| `git diff --check` | **PASS** — line-ending conversion warnings only, no whitespace errors |
| UTF-8 / BOM / NUL / trailing-whitespace / EOF audit over all 25 touched files | **PASS** — clean; no mixed line endings |

`test/vocabulary-sweep.test.ts` now passes: `workspace_pair_unavailable` was
child 5's and child 5 has resolved it.

### The seven failures that were NOT failures

A parallel `test/core/store/` + `test/core/store-planning/` run reported 7 red
across 4 files. Enumerated by name rather than extrapolated:

```
workspace-cleanup.test.ts  > re-checks reachability before the first removal…        (64.4s)
workspace-cleanup.test.ts  > refuses an apply after a sibling Change was prepared…    (4.7s)
bootstrap-obtain.test.ts   > obtains ZERO projects under --yes…                      (30.1s)
bootstrap-obtain.test.ts   > does not prompt for projects under --yes                 (32.2s)
target-lines.test.ts       > refuses removing a code locator an active Change…       (64.1s)
workspace-binding.test.ts  > re-verifies a healthy entry as consistent               (35.2s)
workspace-binding.test.ts  > treats a removed worktree as a conflict rather than truth (37.9s)
```

Every one is a timeout under parallel load, not a logic failure: re-run serially
(`--maxWorkers=1`) all four files pass — 62 + 120 tests green. Recorded rather
than attributed, because `bootstrap-obtain.test.ts` is a file this fix touches
the dependencies of, and "it passed on a retry" is only evidence when the retry
is the controlled one.

### No environmental failure was encountered

The five known `%LOCALAPPDATA%\rasen` cases live in `config.test.ts` and
`config-editor.test.ts`; neither is in this fix's suite set.

---

## Left alone, because it belongs to someone else

- **Child 5:** `src/core/store/finalization/**`, `src/core/archive.ts`,
  `src/core/archive-engine.ts`, `src/core/archive-accounting-v2.ts`, and the
  finalization additions to `src/core/management-api/`. One transient build
  failure in `src/core/archive-consumer-invocation.ts` (`'finalization' is
  possibly 'undefined'`, ×3) blocked two of my test runs mid-session; it cleared
  on its own. Not touched, not reported as mine.
- **Child 4:** `src/core/store/workspace/**`, `target-lines.ts`,
  `commands/workspace.ts`, `commands/store-target-line.ts`,
  `session-runtime-context.ts`, `management-api/supervisor.ts`,
  `commands/context.ts`, `working-set.ts`, `commands/workflow/shared.ts`,
  `store-planning/internal/{dependencies,resolver}.ts`. Three of the four files
  in the parallel-timeout list above are child 4's; verified green serially and
  left alone.

## Artifacts amended

- `tasks.md` — 1.3, 7.3, 9.1 and 10.4 now say what is true, with the round-1
  finding named in each.
- `evidence/caller-inventory.md` — §1's enforcement claim and §3's dispatch claim
  were both false; corrected with the measurement that disproved them, and §4
  now records the lesson (the census bounded only what it could see).
- `specs/store-registration/spec.md` — the silently narrowed requirement widened
  back to both doctors, plus the failure-to-diagnose rule and the re-introduced
  flat tree rule, with two new scenarios.
