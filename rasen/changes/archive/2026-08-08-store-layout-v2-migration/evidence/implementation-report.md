# Implementation report — `store-layout-v2-migration`

Status: **production code complete, test suite partially complete.** 62 of 78 tasks ticked.
Every unticked task is enumerated in `handoff/implementer-1.md` with what remains.

## What was built

### The Module (`src/core/store/layout-migration/`)

One deep Module behind one public entry point (`index.ts`), with the Interface
the design specifies — `inventory` / `plan` / `apply` / `status` / `recover`.

| File | Owns |
| --- | --- |
| `types.ts` | Interface types, the closed item-state taxonomy, the stable error-code union |
| `dependencies.ts` | fs / read-only Git / machine-root coordination / project registry / clock / entropy adapters |
| `flat-source.ts` | the Module's ONE source-side reader for the legacy flat layout, plus tree digests |
| `inventory.ts` | ref survey + working-tree inventory + inventory fingerprint |
| `evidence.ts` | E1/E2/E3 readers, the precedence reducer, the spec provenance graph |
| `mapping.ts` | the strict mapping-file schema and its whole-file validation |
| `catalog-upgrade.ts` | v1 membership record → v2 project catalog |
| `plan.ts` | destinations, the gates, minted identity, canonical plan id and token |
| `apply.ts` | revalidation, staging, verification, ordered publication, retirement, rollback |
| `receipt.ts` | the committed receipt schema and its deterministic serialization |
| `module.ts` | composition, the Store-scoped owner-aware lock, worktree assertion |
| `diagnostics.ts` | the nine read-only doctor findings |

Read-only Git is enforced structurally: `spawnGit` refuses any verb outside an
allow-list that contains no `checkout`, `merge`, `rebase`, `branch`, `add`,
`commit`, `fetch`, or `push`.

### Beside the Module

- `src/core/store/layout-write-guard.ts` — `assertStoreLayoutForWrite`, plus
  `readStoreLayoutState`, which classifies declared/mixed/publication-recorded.
- `src/core/store/membership-layout.ts` — layout-dispatching membership read /
  list / catalog write. Readers choose the schema from the Store's declared
  layout version, never by sniffing the file.
- `src/core/store/migration-ops-v2.ts` — the partition algorithm for adopt and
  eject, kept beside the frozen flat implementation rather than interleaved
  with it.
- `src/core/store/migration-ops.ts` — adopt now writes partitions and refuses a
  non-v2 Store; eject dispatches to the partition path in a v2 Store and keeps
  the flat path (including `--all`) for a legacy one; `archive relocate --to
  store` requires `--target-line` and a bound project in a v2 Store.
- `src/core/store/operations.ts` — `doctorStores` appends the layout findings.
- `src/commands/store-migrate-layout.ts` + registration in `src/commands/store.ts`,
  the completions registry, and all three locale catalogs.

### §10b — the deferred legacy flat Store write refusal

- `src/core/store-planning/internal/resolver.ts` refuses `create-change`
  against a `legacy-store` scope with `legacy_flat_store_requires_migration`.
- `src/core/archive.ts` `storeFinalizationDiagnostic()` refuses a `legacy-store`
  scope with the same code and names `rasen store migrate-layout`.
- All four generated-skill gate paragraphs regained the refusal clause, and
  `test/core/templates/legacy-store-gate-guard.test.ts` asserts it — the guard
  10b.2 requires, **proven to discriminate** (reverting `ship.ts` alone fails
  2 of its 3 cases; restoring makes all 62 template tests green).
- Two spec deltas re-scope the routing child's contract text:
  `specs/store-planning-scope-routing/spec.md` (REMOVED + ADDED, see the
  judgment call below) and `specs/store-config-inheritance/spec.md` (MODIFIED).
- `proposal.md` gained the second BREAKING bullet.

## Gate results

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm run lint` | PASS |
| `pnpm run build` | PASS |
| `rasen validate store-layout-v2-migration --strict` | PASS |
| `test/core/templates/` (11 files) | PASS — 62/62 |
| `test/locales/` + `test/core/completions/` (13 files) | PASS — 338 passed, 13 skipped |
| `test/core/store-planning/planning-path-source-guard.test.ts` | PASS — 3/3 |
| `test/core/store/layout-migration-module.test.ts` (new) | PASS — 10/10 |
| `test/core/store/` (31 files, `--maxWorkers=1`) | **22 failed / 578 passed / 1 skipped** |
| `git diff --check` | PASS — line-ending conversion warnings only, no whitespace errors |
| Strict UTF-8 / BOM / NUL audit over 51 changed/untracked files | PASS — 0 NUL, 0 invalid UTF-8, 1 baseline-identical BOM (`skill-templates-parity.test.ts`), replacement-character counts in `ja.json` (3) and `zh-cn.json` (4) byte-identical to `HEAD` |

### The 22 failures are this change's BREAKING behavior, and are NOT triaged away

17 in `test/core/store/migration-ops.test.ts` and 5 in
`test/core/store/membership-operations.test.ts`. Every one adopts into (or
ejects from, after adopting into) a fixture Store that never declares
`layoutVersion: 2`, and adopt now refuses that with
`legacy_flat_store_requires_migration`. That refusal is mandated by
`specs/store-adopt/spec.md` ("Adopt into a legacy flat store is refused") and by
both BREAKING bullets in `proposal.md`.

**They are left red on purpose.** Rewriting them to match the new code is
exactly the failure mode that cost `store-planning-scope-routing` three review
rounds. Each one needs a deliberate decision — declare the fixture Store layout
v2 and assert partition destinations, or assert the refusal with a spec
citation — and that work is enumerated task-by-task in the handoff rather than
done hastily at the end of a context window.

## Judgment calls

1. **`REMOVED` + `ADDED` for "Layout and planning binding states fail closed".**
   `specs-apply.ts:308` refuses a MODIFIED block that omits any scenario the
   canonical spec carries, so the scenario "Legacy flat Store keeps writing its
   own flat layout" cannot be dropped inside a MODIFIED requirement — and it
   cannot be kept, because it is now false. The delta therefore REMOVEs the
   requirement with a stated reason and ADDs "Layout and planning binding states
   fail closed with a read-only legacy layout", carrying every other scenario
   byte-identical.

2. **Eject and `archive relocate --to in-repo` stay available on a legacy flat
   Store.** The BREAKING bullet says a legacy flat Store refuses "those
   mutations", but `specs/store-eject/spec.md` explicitly keeps the legacy read
   path and the `--all` consent path. Refusing eject would trap content in a
   Store nobody can migrate. Only `new`, `archive`, and `adopt` are refused.

3. **UTF-8 verification compares, it does not police.** Task 6.2 says "strict
   UTF-8 decode with BOM/replacement-character rejection". Implemented as: a
   staged file must be byte-identical to its source, AND a source that decoded
   as clean UTF-8 must still decode cleanly after staging. Rejecting a
   pre-existing BOM outright would refuse to migrate a Store for a property
   migration did not introduce and must not change.

4. **E3 association = the machine project home's `changes/<changeId>/`
   directories.** The frozen base has no persistent change-association record
   family; the session registry is in-memory. A project's machine home holding
   a work directory for change `X` is a real, auditable, machine-local
   association, and it is admitted only when that project is a member of this
   Store.

5. **A pointer-only planning binding blocks rather than inventing `boundAt`.**
   Design D10 allows binding from "a proven pointer-without-local-planning
   binding", but the v2 catalog requires a canonical binding timestamp and no
   such pointer records when it was bound. `catalog-upgrade.ts` therefore
   reports `blocked:unrecordable-catalog-field` naming
   `planningBinding.boundAt` rather than stamping the clock.

6. **A v1 record carrying `adoption` but `roles.planning: false` blocks.** The
   v2 contract rejects `bound` without the planning role, and the design says
   roles carry over unchanged. Rather than silently widening the role or
   silently dropping the binding, the record blocks with
   `unrecordable-catalog-field` naming `roles.planning`.

7. **`blocked:mixed-layout` and `blocked:store-identity-missing` attach to
   items.** The taxonomy says every item carries exactly one state, so
   Store-level conditions are projected onto the items they actually block:
   mixed layout onto every flat content item, missing Store identity onto the
   Changes that would need a minted identity.

8. **The pinned-hash re-baseline was proved before it was applied.** For each of
   the four templates, substituting the OLD gate paragraph back into the CURRENT
   template reproduces the OLD recorded hash exactly — all eight, verified by a
   throwaway test that was then deleted. The re-baseline script asserted each
   old value before replacing it and refused to run on a miss, and the file's
   baseline BOM was preserved byte-for-byte.

9. **`store migrate-layout` previews by default.** `--dry-run` is the documented
   flag but the command previews unless `--apply` is passed, so a mistyped
   invocation cannot publish.

## Nothing in the plan was found wrong

Two places were underspecified rather than wrong, and are resolved above:
the canonical binding timestamp for a pointer-only binding (5) and the
concrete E3 record family (4). Everything else was implementable as written.

---

# Implementer 2 — the test work

Status: **the 22 stale tests are resolved and `test/core/store/` is fully
green.** Four production defects surfaced while doing it; three are fixed and
mutation-proved, one is reported below and deliberately left. Tasks 10b.4 and
11.1 are done. The remaining named test files, 10b.3, and the closing audits go
to implementer 3.

## The 22, per test

`test/core/store/migration-ops.test.ts` (17) and
`test/core/store/membership-operations.test.ts` (5).

**Bucket A — adopt/eject mechanics, re-pointed at the layout v2 address (18).**
The fixture Store declares `layoutVersion: 2` through a new per-test
`declareLayoutV2()` helper (opt-in, so the cases that are genuinely about the
legacy layout still meet one), and every destination assertion moved to
`rasen/projects/<projectId>/{specs,changes,changes/archive/<line>}` — spelled
out literally rather than computed through the contract under test. Each
assertion says what it always said, in the new address.

| Test | Note |
| --- | --- |
| adopts an in-repo project into the store and converts it to a pointer | partition destinations; the flat namespace is asserted to gain nothing |
| fails closed on a case-insensitive name collision, moving nothing | the colliding `BILLING` is planted INSIDE the project's partition, because the precheck is partition-scoped |
| rejects a source that already declares a store pointer | fixture only |
| dry-run changes nothing | additionally asserts `rasen/projects` stayed empty |
| dry-run leaves the tracked config byte-identical (mints no projectId) | fixture + `--target-line` |
| dry-run previews the real archive move count without moving anything | the project is given its identity first so the preview can address the destination; see defect 1 |
| --archive move consolidates into the store and writes no destination config | entries land under `changes/archive/<targetLine>/` with their names unchanged |
| still moves the full archive on a real adopt after the dry-run preview | same |
| round-trips adopt -> eject restoring the same content | additionally asserts the partition itself is gone |
| eject dry-run previews without moving anything | partition still holds `billing` |
| eject warns on a destination collision rather than silently overwriting | fixture only |
| home prune reports dangling entries and applies removal | adopt is incidental setup |
| home prune never lists a registered project whose path still exists | same |
| (membership) records ownership in the project catalog with no source path | renamed: v2 records a CATALOG (spec store-adopt). Asserts the bound binding, no name list, no machine path, and the partition contents |
| (membership) resumes an interrupted adopt from the bound catalog | renamed; asserts the partition contents and that `boundAt` is PRESERVED rather than re-stamped |
| (membership) never follows a legacy recorded source path | fixture only |
| (membership) releases the planning binding and restores the project | renamed: v2 eject unbinds and KEEPS the catalog (spec store-eject). The original "no role nobody established" guard survives as `knowledge: false` |
| (membership) keeps a knowledge role that eject did not end | v2 preserves roles verbatim and ends the BINDING; needed defect 2 fixed before it could pass |

**Bucket B — genuinely about the legacy flat Store; kept there, renamed, cited
(3).** Each keeps a live gate over the legacy path this change deliberately
leaves working, and each is seeded directly because adopt into a flat Store is
now refused.

- `eject from a legacy flat store refuses without a manifest unless --all` —
  spec store-eject, "Missing manifest without --all". `--all` is rejected
  outright in a v2 Store, so this scenario has no v2 form.
- `eject from a legacy flat store fails closed on manifest drift and proceeds
  with --force` — spec store-eject, "Missing files block eject". A v2 partition
  has no recorded name list to drift from.
- `diagnoses a legacy ownership record referencing content missing from the
  store` — `drift_manifest_missing_content` compares a recorded name list
  against flat content; the v2 counterpart is `store_layout_partition_orphan`.

**Bucket C — one new test (1).** `refuses an archive move with no target line
even before an identity exists`, the discriminator for defect 1.

## Production defects found

### 1. FIXED — the adopt preview did not report the refusal the real run gives

`adoptProject` guarded `requireTargetLineCatalog` behind
`projectId !== UNASSIGNED_PROJECT_ID`, so a FIRST adoption — the case where the
project has no identity yet — previewed clean and then refused for real once
the identity had been minted. Spec store-adopt, "Archive move without a target
line is refused", makes no exception for a project without an identity, and the
code's own comment already claimed the check ran before the preview.
`src/core/store/migration-ops.ts` now runs the check unconditionally for
`--archive move`; only the destination computation still needs the identity.

**Discriminates:** restoring the old condition fails exactly one test — the new
one (28 passed / 1 failed).

### 2. FIXED — `add-project` wrote a legacy record into a layout v2 Store, and adopt then destroyed data

`writeMembershipRecord` wrote a `version: 1` record unconditionally. Spec
store-project-membership requires "The record's schema SHALL follow the Store's
declared planning layout", and task 9.1 requires the layout assertion in front
of membership record writes. Two consequences, both observed on a real fixture:

- `store add-project` into a v2 Store planted the exact
  `store_layout_legacy_membership_record` state the migration exists to remove.
- Every `adopt` runs `storeAddProject` first, so that v1 write CLOBBERED any
  existing v2 catalog; `bindProjectCatalog` then read the mismatched file as
  ABSENT and rewrote it, silently dropping the project's knowledge role, display
  id, remote, and — on a resumed adopt — the recorded `boundAt` the catalog
  exists to preserve.

`src/core/store/membership.ts` now dispatches on the declared layout: a v2 Store
gets a v2 catalog composed by `composeCatalog` (roles OR-widen exactly as
before; the planning binding is preserved when one exists, derived from adoption
evidence when the caller supplies it, and otherwise left `unbound`, because
membership alone never binds). The layout is re-read INSIDE the record lock.
`planMembershipMutation` dispatches the same way so a preview names the right
file. The return type became `{ entry: StoreMembershipEntry; filePath; changed }`
— no caller read the old `record` field.

**Discriminates:** disabling the dispatch fails exactly three tests, all of them
preservation assertions (58 -> 55 passed).

### 3. FIXED — apply dropped the minted identity for a Change with no `.openspec.yaml`

Found by driving the real CLI for task 11.1. `stagePlan` wrote the v2
`identity:` block only when the Change ALREADY had a metadata file, but a Change
written by the flat layout usually has none — so `apply` failed its own staging
verification with "`.openspec.yaml` is missing after staging" for every such
Change. **`migrate-layout --apply` could not migrate a realistic Store at all.**
Design decision 6 says migration mints, verifies, and WRITES the block.
`layout-migration/apply.ts` now creates the file when absent, carrying the Store
root's declared `schema` (which the Change was already read under, and which
`ChangeMetadataSchema` requires), and the staged-vs-source comparison skips the
one file staging is allowed to author.

Fixed in the same pass: `--retire-flat` refused its own second run with
`migration_retire_without_publication`, because the guard required
`manifest.phase === 'published'` and the first run had already set `retired`.
Task 6.6 requires retirement to be idempotent; `retired` is now accepted
alongside `published`, with the receipt check unchanged.

**Discriminates:** `test/commands/store-v2-migration-journey.test.ts` fails at
exactly those two points without them.

### 4. NOT FIXED HERE — the `archive` half of task 10b.1 is unreachable

> **Resolved by implementer 3.** Left as written because the analysis below is
> what the fix was built from; see "Defect 4, both halves, as handed over".

`storeFinalizationDiagnostic()` in `src/core/archive.ts` keys the legacy refusal
on `root.planningScope?.kind === 'legacy-store'`, but only the AUTHORING
resolution attaches a planning scope. `rasen archive` against a legacy flat
Store therefore still succeeds, through both the declared pointer and `--store`.
`rasen new change` does refuse (its resolution throws inside the resolver), so
task 10b.1 is half-live.

Left for one reason: repairing it turns every remaining flat-Store archive
journey red, and that set is exactly what task 10b.3 rewrites. Doing half of
that would leave the tree worse than either finishing it or leaving it. Fix
sketch: for a store-selected root with no planning scope, resolve the Store's
declared layout rather than treating an absent scope as "not a Store".

Because of this, `test/commands/declared-store-fallback.test.ts` asserts NEITHER
outcome for archive — the refusal would fail, and the success would pin the
defect as the contract. The gap is named in a comment at that spot.

## Two further observations, not defects

- **A newly created Store is born legacy-flat.** `registerExistingStore` mints
  `{version: 2, uid, id}` with no `layoutVersion`, so `rasen store setup`
  produces a Store that immediately refuses `new`, `archive`, and `adopt` and
  must be "migrated" before first use — with nothing to migrate. The proposal's
  BREAKING bullet covers "every existing Store"; a Store created after this
  change is not one. Recommend minting `layoutVersion: 2` when a Store is
  created from scratch.
- **`--archive move` is the default**, so `--target-line` is effectively
  mandatory for every adopt into a v2 Store even when the source repo has no
  archive entries at all. That is literally what spec store-adopt says; it is
  only a usability note.

## Coverage relocated, deliberately

Two assertions could no longer live where they were. Neither was dropped:

- **The root JSON `scope` block for a legacy Store.** Only the authoring
  resolution attaches a scope, and authoring against a legacy flat Store is
  refused, so the block is unreachable in `store-root-selection.test.ts` and
  `declared-store-fallback.test.ts`. `store-v2-planning-scope-journey.test.ts`
  asserts it for `store-project` and `store-aggregate`; both suites keep the
  established `path`/`source`/`store_id` shape assertion, exact-key-set included.
- **Creating a Change in a Store, in `store-root-selection.test.ts`.** Creation
  in a v2 Store additionally requires a verified planning worktree, and that
  suite's fixture is an integration checkout. The same root block, absolute
  `change.path`, and partition destination are asserted in
  `store-v2-planning-scope-journey.test.ts`. What that suite owns — `--store`
  resolving the registered Store and never falling back to a local root —
  survives in both remaining cases, including the refusal case.

## Beyond 10b.4's six

10b.4 named six unit-level cases. Measuring `test/commands/` found five more
with the same cause, all handled the same way:
`store-root-selection.test.ts` (2, above), `store-identity-cli.test.ts` (1 —
the twin Store now declares layout v2, with `--archive leave` so the case still
tests identity resolution and not the archive), `store.test.ts` (1 — the store
subcommand hint list had not been re-baselined after `migrate-layout` was
registered), and a second `store-add-project.test.ts` case.

A shared fixture helper, `seedFlatStoreChange()` in
`test/helpers/rasen-fixtures.ts`, seeds an active Change into a legacy flat
Store for suites whose subject is NOT creation, and carries the citation for
why `rasen new change` cannot be used.

## Gate results (implementer 2)

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm run lint` | PASS |
| `test/core/store/` (31 files) | PASS — 601 passed, 1 skipped, **0 failed** (was 22 failed) |
| `test/core/store/membership.test.ts` | PASS — the layout dispatch is a no-op for a flat Store |
| `test/commands/store-v2-migration-journey.test.ts` (new) | PASS — real CLI: preview -> apply -> retire -> retire again -> adopt -> eject |
| `pnpm run build` | PASS |
| `rasen validate store-layout-v2-migration --strict` | PASS |
| `git diff --check` | PASS — line-ending conversion warnings only, no whitespace errors |
| UTF-8 / BOM / NUL audit over 78 changed and untracked text files | PASS — 0 NUL, 0 invalid UTF-8. Three known-baseline items only: the BOM in `skill-templates-parity.test.ts`, the replacement-character counts in `ja.json` (3) and `zh-cn.json` (4) that are byte-identical to `HEAD`, and one deliberate `const REPLACEMENT_CHARACTER = '�'` literal in `layout-migration/apply.ts` |
| **Sweep**: `test/commands/` + `test/cli-e2e/` + `test/core/{store,store-planning,templates}/` + `test/core/archive` (115 files) | **10 failed / 1944 passed / 3 skipped** |

### Attribution of all 10 sweep failures

| Failure | Attribution |
| --- | --- |
| `config.test.ts` x1, `config-editor.test.ts` x4 | **Environmental, not this change.** `%LOCALAPPDATA%\rasen` is an ancestor of `os.tmpdir()` on this host. Never "fixed". |
| `cli-e2e/store-lifecycle.test.ts` x4, `cli-e2e/capstone-journeys.test.ts` journey 3 | **Task 10b.3, outstanding.** These are exactly the five end-to-end journeys 10b.3 rewrites into "migrate, then run the lifecycle". They are red because `new change` against a legacy flat Store now refuses; the follow-on cases in the same file fail on the state the refused case did not create. Nothing else in the sweep is red. |

---

# Implementer 3 — task 10b.3, the remaining suites, and the closing audits

Status: **all 78 tasks ticked.** Three more production defects were found and
fixed, each mutation-proved. Two artifact statements were found to be false and
corrected. Nothing is committed.

## Defect 4, both halves, as handed over

### The refusal was unreachable on every route, not just one

`storeFinalizationDiagnostic()` keyed on `root.planningScope?.kind ===
'legacy-store'`, and only the AUTHORING resolution attaches a scope. Measured
against the real CLI, `rasen archive` succeeded on **all three** routes into a
legacy flat Store while `rasen new change` refused on all three:

| Route | `new change` (before) | `archive` (before) | `archive` (after) |
| --- | --- | --- | --- |
| `--store <id>` from an unrelated directory | refused | **succeeded** | refused |
| a `store:` pointer repo, no flags | refused | **succeeded** | refused |
| cwd inside the Store checkout, no flags | refused | **succeeded** | refused |

The fix does not special-case the routes. `src/core/store/layout-write-guard.ts`
gained `classifyStoreRootLayout(candidateRoot)`, which answers "is this path a
Store root, and which layout does it declare?" from the Store's own metadata;
`storeFinalizationDiagnostic()` calls it whenever no scope is attached. Presence
of the metadata file decides whether the path is a Store; the parse result never
does, because answering `not-a-store` for an unreadable declaration would fail
OPEN into the flat tree the guard protects.

**Discriminates:** reverting the classification branch to `return null` fails
`declared-store-fallback.test.ts` "runs the externalized-planning journey
without --store anywhere" and `store-lifecycle.test.ts` "the legacy flat
planning tree is read-only until it is migrated" (plus that journey's five
downstream cases, which the un-refused archive corrupts) — and nothing else.
`capstone-journeys.test.ts` stays green under the revert, correctly: it never
archives a flat Store.

### The five journeys, rewritten onto a migrated Store

Not converted into refusal assertions. `store-lifecycle.test.ts` is now
`store setup` -> the team's existing flat content -> **the refusal, proved once
end to end** -> `migrate-layout --apply` -> `--retire-flat` -> a planning
worktree -> `new change` in the partition -> reads -> the finalization deferral
-> clone, register, read, and author again on machine B.
`capstone-journeys.test.ts` journey 3 keeps its premise exactly — a pointer repo
drives the whole lifecycle with zero selectors — and now proves the stronger
version of it: the `store:` declaration plus the recorded planning binding
supply Store, project AND target line, so `new change` lands in the partition
from the code repo with no flags at all.

## Wrong in the plan: a migrated Store does NOT regain archiving

`proposal.md` said "a migrated Store regains creation and archiving", and the
`store-planning-scope-routing` delta carried a scenario "A migrated Store
regains creation and archiving" asserting that archiving "SHALL proceed against
that project's partition". Measured: it does not, and cannot in this child.
`design.md` Non-Goals says `store_v2_finalization_unavailable` stays closed, and
`proposal.md`'s own Impact section says this change does not unlock it — so
`rasen archive` in a migrated Store answers `store_v2_finalization_unavailable`,
which `store-v2-planning-scope-journey.test.ts` has been asserting all along.

Both statements were corrected rather than implemented: the BREAKING bullet now
says creation returns and archiving stops saying "migrate first" and starts
saying "finalization is not activated", and the scenario was renamed **A
migrated Store regains planning writes** with that as its second `AND`. The
scenario lives in an ADDED requirement, so no canonical title is disturbed.

Both journeys assert the `store_v2_finalization_unavailable` code by name. That
is deliberate: when `store-finalization-outcomes-v2` lands, these two tests fail
and say so, rather than passing silently on a claim that stopped being true.

## Two more production defects

### 5. FIXED — a failed publication erased its own recovery manifest

`applyLocked`'s catch marked the run failed by spreading `initial`, the manifest
as it stood before publication began. `publishPlan` accumulates `createdPaths`
and `replacedFiles` as it renames and overwrites, and that accumulation is the
only thing `--rollback` can act on. So a mid-publication failure left orphaned
partitions and an already-upgraded catalog behind, with a manifest claiming the
run had created nothing and `status` reporting `createdPaths: []`. The catch now
spreads the LATEST manifest written.

**Discriminates:** reverting fails exactly two cases — "a rename that fails
mid-publication never flips the layout, and rollback restores the Store exactly"
and "a failed layout flip leaves the Store legacy-flat and rollback removes
every published path". The other six apply/recovery cases pass under the revert.

### 6. FIXED — the committed receipt could never say the migration completed

`buildMigrationReceipt` is called during staging, so the receipt's `phases` only
ever recorded `staged`. Design D10 and task 7.5 require the publication and
retirement phases, and without them the committed audit record cannot
distinguish a published migration from an abandoned staging run — nor show that
retirement happened at all. `receipt.ts` gained `withMigrationReceiptPhase`
(idempotent), `publishPlan` stamps `published` into the staged bytes immediately
before the rename that publishes them — which keeps the receipt inside the
rollback set — and `retireFlatTree` appends `retired` in the retirement commit.

**Discriminates:** observed directly. Before the fix the new assertion read
`['staged']`; after it, `['staged','published']`, then `[...,'retired']`, and
re-running retirement does not duplicate the record.

## Not a defect, but the product is not usable end to end yet

**`rasen store setup` produces a Store that can never be used and can never be
migrated.** A new Store is born legacy-flat (implementer 2 observed the first
half), so `new`, `archive`, and `adopt` all refuse it — and `migrate-layout` is
`applicable: false` on it, because `plan.ts:757` requires `items.length > 0` and
a fresh Store has nothing to migrate. Measured through the real CLI.

Minting `layoutVersion: 2` at creation, as implementer 2 recommended, is
**necessary but not sufficient**: a usable v2 Store also needs a target-line
catalog, and in this portfolio the mapping file is the only thing that writes
one (design decision 6 — "Migration provides no other target-line management";
ref resolution and binding are child 4's). So the complete repair spans this
child and `store-planning-worktree-bindings`, and it is reported rather than
half-done here. The consequence for now: **the only route to a usable layout v2
Store is migrating a flat Store that already has content**, which is exactly
what both rewritten journeys do.

## Eight more stale tests the reachable refusal exposed

Making the refusal reachable turned eight cases in
`test/commands/store-root-selection.test.ts` red — all of them archiving into
the fixture's legacy flat Store through `--store team-context`. They are the
same class as implementer 1's original 22: the OLD behavior is exactly what task
10b.1 retires, so the code is right and the tests were only green because the
refusal could not fire. None was rewritten to match the code; each keeps
proving its own subject.

The dividing question was **what is this case actually about?**

- **Five cases are about archive's own JSON discipline** — validation failures
  as diagnostics rather than prose, REMOVED deltas against a new spec, "no files
  were changed" when a rebuilt spec fails, spec-update failures, incomplete
  tasks without `--yes`. None of that is layout-specific, and all of it is still
  live. They moved to a standalone root created in the block's `beforeEach`, and
  keep every assertion they had.
- **Three cases are about the SELECTED ROOT**, so they keep `--store` and now
  assert the deliberate refusal with the property each one always protected:
  - "refuses a selected legacy flat store without opening a picker" — still no
    picker, still exit 1, still pure JSON on stdout; only the code that comes
    first changed.
  - "refuses a selected empty store without init guidance" — still no
    `rasen init` anywhere in the payload; the refusal names the migration.
  - "refuses to archive into a selected legacy flat store, and writes nothing"
    (was "archives a change into the store archive with JSON output") — the
    Store is still named in the root block, the app repo still grows nothing,
    and the Change, the flat archive directory and the canonical spec are all
    proved untouched.

Archiving into a **migrated** Store — the successful-path coverage that case
used to carry — is proved end to end in `test/cli-e2e/store-lifecycle.test.ts`,
as far as this slice goes: to the finalization deferral.

## Coverage added

| Task | File | What it owns |
| --- | --- | --- |
| 1.1 | `evidence/caller-inventory.md` | Every production hit on the three flat-Store surfaces, classified. Names one narrowing left for `store-v2-compat-hardening`: `bootstrap.ts` reads project records through the v1 parser, so in a migrated Store it skips a declared knowledge bundle and reports a healthy catalog as unreadable. |
| 1.2 | `migration-ops-flat-baseline.test.ts` | The legacy behavior this change KEEPS: eject and its dry run, `archive relocate --to in-repo`, `version: 1` membership writes, the explicit membership migration, drift diagnosis. |
| 2.7 | `layout-migration-inventory.test.ts` | Empty Store, full enumeration, an unreadable sibling ref, mixed layout, remote-tracking exclusion, fingerprint sensitivity, zero writes to the Store AND the machine root. |
| 3.5, 3.9 | `layout-migration-provenance.test.ts` | Each evidence class alone, E2/E3 conflict, non-member and unrecordable owners, the unknown-contributor rule, and one fixture built so all five excluded heuristics would fire — proving each is ignored. |
| 4.6 | `layout-migration-mapping.test.ts` | Schema and unknown-key rejection, out-of-Store paths, E1 contradiction, unknown items, non-member projects, owner and split resolutions, target-line catalogs and their conflict, design-doc reclassification. |
| 5.9 | `layout-migration-plan-gates.test.ts` | Literal destinations, no-clobber, store-identity-missing, minted identity re-derived independently, an existing identity verified not re-minted, untracked handling, the one gate, the repair keys, the retirement set, the plan in the machine root. |
| 6.9 | `layout-migration-apply-recovery.test.ts` | Injected failures at copy, verify, a mid-partition rename, the layout flip, and retirement — each asserting a fully readable pre-publication state or one complete published state — plus rollback fidelity, the post-retirement rollback refusal, and resume as a no-op. |
| 7.6 | `layout-migration-catalog-receipt.test.ts` | The upgrade table, binding only from adoption evidence, both `unrecordable-catalog-field` blocks, receipt completeness, deterministic serialization, superseded evidence. |
| 8.9 | `migration-ops-v2-partitions.test.ts` | Two projects holding the same alias, the cross-line archive collision refusal, flattening when there is no collision, the missing partition, `--all` rejected, mixed-layout adopt refused, bind/unbind, the `relocate --to store` target-line requirement. |
| 9.6 | `store-migrate-layout-cli.test.ts` | Preview by default, human/JSON parity, the apply-gate refusal and its exit code, both commit suggestions with zero commits, `--status`, `--retire-flat` before publication, mapping outside the Store, running outside the worktree. |
| 10.5 | `layout-migration-doctor.test.ts` | Seven of the nine codes through `doctorStores`, an interrupted run produced by a real injected failure, zero writes, and every finding carrying a code and a repair. |
| 11.2 | `layout-migration-windows-paths.test.ts` | `path.win32`/`path.posix` construction, mixed-case drive letters, reserved device names, containment, case folding, a non-ASCII Store root, a MAX_PATH-crossing Store root, a non-portable Change id refused, and a wrong-flavor plan failing closed. |
| 11.3 | `layout-no-dual-write.test.ts` | Whole-tree before/after diffs across adopt, eject, membership writes and relocate, in both layouts. |
| — | `test/helpers/layout-migration-fixture.ts` | The shared Module fixture: a registered flat Store in a real Git repo, deterministic clock and entropy, and literal address helpers. |

### Judgment calls worth re-reading in review

1. **Two collision cases cannot be built from real files on a case-insensitive
   host.** `billing/` and `Billing/` are one directory on Windows and macOS, so
   the case-folded destination check is unreachable from a real fixture there.
   The planner-level case is `it.skipIf(!caseSensitiveFilesystem())` — it runs
   on Linux CI — and the fold itself is asserted unconditionally at the contract
   level in `layout-migration-windows-paths.test.ts`.
2. **A non-ASCII capability name migrates verbatim; a non-ASCII Change id does
   not.** Only project, target-line and Change ids are portable ids in layout
   v2; a capability is a directory name, and the flat layout already allowed
   any. Both are asserted, so the asymmetry is deliberate and visible.
3. **`pathFlavor` must match the Store root's spelling.** Planning a Windows
   Store root as `posix` resolves no destination at all. That is fail-closed and
   correct — it cannot produce a path anything could open — and it is now
   asserted rather than discovered again.
4. **Rollback leaves the empty directories `rename` created.** Only
   manifest-recorded paths are removed, and the manifest records destinations,
   not the parents made on the way. No file survives under the partition, so no
   reader can read one, and `store_layout_partition_orphan` reports the shell.
   Asserted as "no file under the partition" rather than "the directory is gone".

## Gate results (implementer 3)

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm run lint` | PASS |
| `pnpm run build` | PASS |
| `rasen validate store-layout-v2-migration --strict` | PASS |
| `git diff --check` | PASS — line-ending conversion warnings only, no whitespace errors |
| UTF-8 / BOM / NUL audit over 93 changed and untracked text files | PASS — 0 NUL, 0 invalid UTF-8. Four known items only: the BOM in `skill-templates-parity.test.ts`, the replacement-character counts in `ja.json` (3) and `zh-cn.json` (4) **verified byte-identical to `HEAD`**, and the deliberate `REPLACEMENT_CHARACTER` literal in `apply.ts` plus the two places that quote it |
| `test/core/store-planning/planning-path-source-guard.test.ts` | PASS — 3/3, no new flat-Store join |
| `test/core/templates/` + `test/core/completions/` (24 files) | PASS — 387 passed, 13 skipped |

### Suite results and the attribution of every failure (task 11.4)

Run per directory with `--maxWorkers=1`, after the final build:

| Suite | Result |
| --- | --- |
| `test/core/store/` (42 files) | PASS — 695 passed, 2 skipped, 0 failed (was 601/1/0 at implementer 2's handoff; this change adds ~94 cases) |
| `test/cli-e2e/` (8 files) | PASS — 73 passed |
| `test/core/archive*` + `test/core/store-planning/` (9 files) | PASS — 152 passed, 1 skipped |
| `test/core/templates/` + `test/core/completions/` (24 files) | PASS — 387 passed, 13 skipped |
| `test/locales/` | PASS — 16 passed |
| `test/commands/store-root-selection.test.ts` | PASS — 34 passed |
| `test/commands/` (57 files) | 5 failed / 1071 passed / 1 skipped — the five environmental cases only |

The combined 127-file sweep taken before the last fix reported **13 failed /
2045 passed / 4 skipped**, and every one is accounted for:

| Failure | Attribution |
| --- | --- |
| `config.test.ts` x1, `config-editor.test.ts` x4 | **Environmental, not this change.** `%LOCALAPPDATA%\rasen` is an ancestor of `os.tmpdir()` on this host, so "outside a Rasen project" assertions cannot hold. The same five, in the same cases, that implementer 2 recorded. Never "fixed". |
| `store-root-selection.test.ts` x8 | **This change's BREAKING behavior, now resolved** — see "Eight more stale tests the reachable refusal exposed" above. That file is 34/34 after the dispositions. |

Nothing else **in that file set** was red, in either direction: no other suite
in it noticed the reachable refusal, and no new suite depends on a fixture
another one leaves behind. The file set is the limit of that claim — it was
inherited from implementer 2 and does not include `test/core/management-api/`,
which is where the authoritative full suite then found the one case the next
section covers.

## Task 10b.4's enumeration was incomplete: the management API is a second submission surface

The authoritative full suite found one more case this change breaks, in a file
10b.4 never listed: `test/core/management-api/space-scoping.test.ts`, "POST
/api/v1/changes with body `space=store:<id>` creates the change under the store
root" (422, expected 201).

It was missed because **10b.4's list was written by enumerating the CLI
surface**, and change submission has two. `POST /api/v1/changes` does not
reimplement creation — it spawns the CLI's own `dist/cli/index.js` with the
resolved space's `followupSelection` as `--store/--project/--target-line`
(`src/core/management-api/submit.ts`) — so it inherits the `new change` refusal
exactly, and maps the CLI's non-zero exit to `422 cli_error` carrying the CLI's
own message.

### Why the case now selects `project:` rather than `store:`, and why that is not a weakening

This test has been edited twice before: inverted during
`store-planning-scope-routing` to bless a defect, then restored to expect 201
by that child's round-3 review (finding R3-2). Being the third editor, the bar
is that the version left behind asserts *correct* behavior for a Store that can
actually accept a submission — so the first thing checked was whether 201 is
reachable at all under `space=store:<id>`:

- against a **legacy flat** Store, submission is refused by task 10b.1, which
  is this change's whole point;
- against a **layout v2** Store, the router screens the space with
  `isStoreAggregateSpace()` and answers **400 `project_scope_required`** before
  spawning anything — a Store aggregate cannot select a project implicitly.
  That screen is child 2's, and it is right.

So no fixture makes `store:<id>` return 201, and asserting that it does would be
asserting behavior that neither exists nor should. What the describe block is
actually about — *submission lands in the selected space*, and that space can be
a Store — is preserved instead by selecting the **bound project**, which is how
layout v2 addresses Store planning. The submitter passes the complete
Store/project/target-line selection for exactly this case, proved independently
in `test/core/management-api/planning-scope-routing.test.ts`.

The one case became four, and the live 201 gate survives:

| Selector | Outcome asserted |
| --- | --- |
| `project:<bound project>` | **201**, and the change is at the literal partition address `<planning worktree>/rasen/projects/<projectId>/changes/<name>` — not the launch project, not a resurrected flat `rasen/changes`, and the member checkout grows no planning state |
| `store:<layout v2 store>` | 400 `project_scope_required`, nothing created anywhere |
| `store:<legacy flat store>` | 422 `cli_error` whose message names the legacy flat layout and layout v2, nothing created anywhere |
| `store:ghost` | 404 `space_not_found` before spawning (unchanged) |

The fixture is the migrated shape the rest of this change produces: a v2 Store
with a bound project catalog and a target-line catalog, a linked planning
worktree carrying `.rasen/planning-line.json`, and a member checkout carrying
`rasen/config.yaml` plus `.rasen/planning-binding.json`.

### How the rest of the tree was checked for the same gap

Two passes, both scripted rather than eyeballed, because the first enumeration
being incomplete is evidence that eyeballing is what failed.

1. **Store-fixture pass** — every test file building a Store fixture
   (`registerStore` / `writeStoreMetadataState` / `store setup`): 75 files, of
   which 17 also perform a refused mutation (`new change`, `archive`, `store
   adopt`) through any surface — CLI argv, direct core call, or management API.
2. **Widened pass** — dropped the requirement that the Store fixture live in the
   same file, and instead flagged every test performing a refused mutation (29)
   against whether it can reach a Store at all by any route: a `store:` pointer,
   a `--store` flag, a `space=store:` selector, or `seedFlatStoreChange`. That
   found 20 exposed files, three more than pass 1.

Every one is accounted for. Fourteen were already handled by implementer 2 or
earlier in this session; `space-scoping.test.ts` is the gap, now fixed. The
remaining five were checked individually and are green for the *right* reason,
not by accident:

| File | Why it is not exposed |
| --- | --- |
| `management-api/planning-scope-routing.test.ts` | Its Store fixture already declares `layoutVersion: 2`, and the submitter case uses the `argv-capture-cli.mjs` stub, so it asserts the selector plumbing rather than running a creation. |
| `commands/store-remote.test.ts` | `new change` runs in an app repo that has its own standalone root and a `references:` list — never a `store:` pointer, so it never resolves to the Store. |
| `commands/store-migration-cli.test.ts` | Its adopt case asserts the specific code `adopt_external_archive_retired`, which fires before the layout assertion. A precise code, not a bare non-zero exit — so it could not go green for a new reason. |
| `commands/change-initiative-link.test.ts` | Its `store:` hit is the legacy `initiative: { store: … }` link field, not a Store pointer; the subject is that `--initiative` is retired. |
| `management-api/submit.test.ts` | Submits into a standalone root; its `--store=evil` cases are argv-injection tests asserting the name is never parsed as an option. |

**Production surfaces were swept too**, since a missing test is only worth
finding if the code path behind it is covered: creation has exactly two entry
points (the CLI command and the API bridge that spawns it, both through
`StorePlanning`'s `create-change` intent), archiving has one
(`ArchiveCommand.execute`; `applyArchive` has no other caller and the management
API's `/api/v1/archive` is read-only and writes nothing), and adoption has one
(`adoptProject`, which calls `assertStoreLayoutForWrite` unconditionally). No
third surface exists for any of the three.

### Gate results (this pass)

| Gate | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm run lint` | PASS |
| `git diff --check` | PASS — line-ending conversion warnings only |
| UTF-8 / BOM / NUL audit over 100 changed and untracked text files | PASS — 0 NUL, 0 invalid UTF-8; the same four known items and no new ones |
| `test/core/management-api/` (38 files) | PASS — 467 passed, 1 skipped |
| `test/core/management-api/space-scoping.test.ts` | PASS — 21 passed (was 20 passed / 1 failed) |
