# Review round 2 — fixes (`store-layout-v2-migration`, child 3)

Input: `evidence/review-report-r2.md` — 3 medium, 1 low, plus one carry-forward
recommendation and one attribution note that is not child 3's.

**4 fixed, 1 carry-forward implemented, 0 rejected, 0 deferred.**

---

## R2-4 — the `id` contract divergence (the blocker)

**Fixed on the validator's side.** The contract is right; the validator was
wrong, and it was wrong in a way that made the entry point of the whole
portfolio unusable on real data.

### Which side is wrong, and how I decided

`id` is a human display name. Four independent pieces of evidence, none of them
the comment the review quoted:

1. `StoreProjectRecord.id` — *"Display name, for reading only. Never keys
   anything."*
2. `StoreMembershipRecord.id` — *"The project's display name, when the source
   knew one."*
3. `MembershipMutationInput.projectDisplayId` — the parameter that feeds it.
4. Every consumer treats it as a name or an exact-match alias:
   `spaces.ts` (`name: member.id ?? …`), `migration-ops.ts` (`alias: member.id`),
   `resolver.ts` (`catalog.id === selector`, string equality). **Nothing derives
   a path or a filename from it** — `projectId`, validated by `parseProjectId`,
   names the file.

And the decisive one: the validator was `parseChangeId`. Measured across the
tree, that function has 14 call sites and 13 of them parse a change, capability
or node id. `planning-catalogs.ts:267` was the only one applied to something that
is not an id at all. That is a copy-paste, not a contract — if the intent had
been "this must be canonical", it would have been `parseProjectId`.

**So: no second field.** A display name does not need a canonical id derived
from it, because the canonical id already exists beside it and is the only thing
anything keys on. Adding a `displayName` alongside a demoted `id` would migrate
the same data into a new field for no reader's benefit.

The v2 catalog now accepts exactly what the v1 record accepts, stated as an
invariant rather than a list of examples: **a migration must never block on data
the schema it migrates FROM accepted.**

### The repair messages

`catalog-upgrade.ts` gained `repairFor(field, record)`, and every blocked outcome
carries a `blockedRepair`. `plan.ts` renders that instead of the generic
*"Repair '<field>' in <path>; migration never rewrites a value to make it fit."*
The remaining blockable fields now say what to change the value to:

| Field | Repair |
| --- | --- |
| `projectId` | canonical lowercase kebab, and rename the record file to match |
| `roles.planning` | set it true (the adoption IS a planning binding), or delete the `adoption:` block |
| `adoption.adoptedAt` | replace with a real instant, with an example |
| `planningBinding.boundAt` | add an `adoption:` block, or set `roles.planning: false` to migrate unbound |
| `remote` | a credential-free https:// or ssh:// URL |
| `knowledgeBundle` | Store-root-relative, forward slashes, no `..` |

### A test that pinned the defect as the contract

`layout-migration-catalog-receipt.test.ts:130` was
*"blocks a v1 value the stricter v2 validators reject, naming the field"*, and
its fixture was `id: Not A Portable Id`. It asserted the blocker as intended
behaviour — the same pattern this portfolio keeps hitting, a test written to
match the code. Rewritten onto a field v2 is genuinely and correctly stricter
about (a credential-bearing `remote`, which a committed shared catalog should
refuse), and it now also asserts the repair names the remedy and that the
display name is not what blocked it.

### Discrimination

Restored the `parseChangeId` call:

| | Result |
| --- | --- |
| `layout-migration-catalog-receipt.test.ts` | **3 failed / 5 passed** |
| Failing, by name | *accepts every display name the v1 record accepts*; *migrates a Store whose membership record carries a human display name*; *blocks a v1 value … telling the operator what to change it to* |
| Restored | 8/8 |

The third is the rewritten test failing for the right reason: under the revert,
`id: Elftia` blocks first with a kebab-case message, so the credential-bearing
remote it is actually about is never reached.

---

## R2-2 — `store migrate-membership` told the operator to delete their catalog

**Fixed**, and the enumeration flaw behind it is fixed too.

`migrateStoreMembership` now returns early when the Store declares layout
version 2: nothing converted, nothing written, and one `info` diagnostic
(`store_layout_membership_already_migrated`) saying the membership is already
recorded as v2 catalogs and pointing at `store doctor`. The legacy census — and
therefore its parse diagnostics — is never reached for such a Store.

### Discrimination

Disabled the early return: `layout-migration-doctor.test.ts` **1 failed /
11 passed**, and the failure is the assertion that the advice does not contain
`Repair or remove` — with the reviewer's exact string back in the output:

```
"fix": "Repair or remove …\\team-store\\.rasen-store\\projects\\elftia.yaml."
```

Restored → 12/12.

### The re-audit, per READ rather than per function

The lead was right that this is the real finding. I had classified
`migrateStoreMembership` "correct as v1-only" because it *writes* `version: 1`
records by definition — true — while one of its two *reads* was reporting a
healthy v2 catalog as corrupt on a live command surface.

Re-asked every v1-only read with the discriminating question — **can this read be
reached with a v2 catalog on disk, and does its RESULT or its DIAGNOSTICS escape
to a user or a decision?** Full table in `evidence/caller-inventory.md`.

It found exactly one more defect (R2-2's site) and one reachable-but-benign read
worth recording:

- `readProjectOwnership` ← `ejectProject` and `clearProjectOwnership` ←
  `ejectProject`: **structurally unreachable** in a v2 Store —
  `if (await storeDeclaresLayoutV2(storeRoot)) return ejectPartition(...)`
  returns before either. Genuinely guarded, not guarded by classification.
- `readProjectOwnership` ← `diagnoseMigrationDrift`: **reachable**, and I had not
  checked that. It is benign for two independent reasons — it reads only
  `record?.adoption` and discards the diagnostics, and a v2 catalog carries no
  adoption name list by design, so `null` is the true answer. Recorded rather
  than changed.
- `evidence.ts` E2 reader: `catch { continue }`, nothing escapes.
- `plan.ts` catalog upgrade: its diagnostics DO escape, as
  `blocked:unrecordable-catalog-field` — which is the entire point of that read.

The lesson, written into the inventory: the structural guards are why classifying
by function happened to be right everywhere else. That was luck, not method.

---

## R2-1 — ambient `rasen doctor` in a migrated Store

**Fixed.** `doctor.ts` requested `intent: 'store-read'` only when `--store` was
passed, so ambient resolution defaulted to a project intent and a layout v2 Store
— which resolves as a store aggregate — was refused with
`project_scope_required` before doctor's own (correct) aggregate branch was
reached.

Doctor reads and never authors, so it now asks for `store-read` whenever no
`--project` is given. One condition, in child 3's own file: I did not touch the
resolver, which is child 6's and where the refusal itself lives.

**The lesson the review drew is the one worth recording:** the fix for a
"one surface is never proof" finding was itself verified on one surface. My
round-1 parity test *did* run ambient — but against a legacy flat fixture, which
resolves as `legacy-store` and never meets the refusal. The fixture, not the
invocation, was the blind spot.

The new test uses a Store in the layout this change produces, with an orphan
partition so it has a real finding to report and cannot pass on an empty list. It
asserts the ambient form emits `storeLayout`, contains
`store_layout_partition_orphan`, and agrees code-for-code and fix-for-fix with
both `rasen doctor --store <id>` and `rasen store doctor <id>`.

### Discrimination

Restored the `--store`-gated conditional → `store-migration-cli.test.ts`
**1 failed / 4 passed**, the new ambient test.

**Recorded because it nearly misled me:** the first run of that revert reported
**5 of 5 failed**, including three tests I have never touched. That was a torn
`dist/` from a concurrent rebuild, not a real result. `pnpm run build` then
re-running gave the true 1-of-5. I have counted this as discrimination only from
the post-build run.

---

## R2-3 — the census hole is three shapes, not one

**Fixed for the cheap one; recorded honestly for the other two.**

`flatPathHelperCalls()` now treats an optional call as a call (`changesDir?.(x)`),
which was the two-character fix the review identified — and it mattered, because
`?.(` has 39 sites in `src/`, so that was a flat-Store address one keystroke away
from invisible.

The docblock now records **three** residual shapes rather than one: import alias
(`{ changesDir as cd }`, a form 50 files use), `const` rebinding, and computed
property. All three need symbol resolution, none appears against a flat-path
helper today, and the note says what the right fix is if a fourth ever appears — a
real parse, not another regex. The round-1 report said "one"; a hole believed to
be one item wide does not get audited the way a three-item hole does.

**Discrimination:** disabled the `?.` branch → `planning-path-source-guard.test.ts`
**1 failed / 3 passed**, the escape-shape assertion. Restored → 4/4.

---

## Carry-forward — default-deny on provenance

**Implemented.** The reviewer noted that `migrateStoreMembership` writes through
the *raw* `writeStoreProjectRecord`, so the M6 assert does not cover it, and that
the provenance check is the sole protection.

```ts
if (member.provenance !== 'legacy-adoption' && member.provenance !== 'legacy-reference') {
  continue;
}
```

Now default-deny rather than an exclusion list: a member source added by a later
slice is skipped until someone adds it here on purpose, instead of falling
through to a writer that would rewrite a v2 catalog backwards into a v1 record
because nobody remembered to extend a list of things to skip.

With the R2-2 early return in front of it this is belt-and-braces — deliberately.
The early return protects a *declared* v2 Store; this protects the *member*,
which is the thing that would actually be destroyed.

---

## R2-5 — not mine, not touched

`src/core/store/query/module.ts`'s two NUL bytes are child 6's. Untouched.

---

## Gate results

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** |
| `npx eslint src test` | **PASS** |
| `pnpm run build` | **PASS** |
| `node bin/rasen.js validate store-layout-v2-migration --strict` | **PASS** |
| 7 core suites touched this round, `--maxWorkers=1` | **PASS** — 89 passed, 0 failed |
| 4 CLI/API suites the doctor `intent` change can reach, `--maxWorkers=1` after a clean build | **PASS** — 92 passed, 0 failed |
| `store-migrate-layout-cli` + `store.test.ts`, `--maxWorkers=1` after a clean build | **PASS** — 58 passed, 0 failed |
| `test/core/store/` + `test/core/store-planning/` | see the attribution below |

### The environment made every CLI gate unreliable, and I can name why

Three other agents are live in this worktree, and one of them is editing a file
the entire CLI imports. Caught directly:

```
$ pnpm run build
src/core/store-planning/internal/resolver.ts(428,37): error TS2304: Cannot find name 'PlanningIntent'.
src/core/store-planning/internal/resolver.ts(451,15): error TS2304: Cannot find name 'OpenStoreIssue'.
… 3 more
```

`store-planning/**` is child 6's. Every suite that spawns `dist/cli/index.js` or
loads a server fails wholesale while that is true. Measured across four
`--maxWorkers=1` runs of the SAME seven files:

| Run | Failures |
| --- | --- |
| 1 | `store-root-selection` ×1 |
| 2 (intent reverted) | `store-migration-cli` ×1 (mine, expected), `store-v2-planning-scope-journey` ×1, `space-scoping` ×2 |
| 3 (restored) | `store.test.ts` ×33, `store-migrate-layout-cli` ×8, `store-root-selection` ×8, `space-scoping` ×2, `store-v2-planning-scope-journey` ×1 |
| 4 (immediately after a successful build) | **none** |

Different files each time, whole files failing at ~2s, and `store.test.ts` 33 of
50 — the shape of a torn `dist/`, not of a regression. **Note run 1 and run 2 were
already `--maxWorkers=1`**, so "parallel load" was not available as an
explanation; the churn is between processes, not within vitest.

**This is why I did not accept a passing retry as evidence.** When
`store-root-selection` failed in run 1 I reverted my `intent` change and re-ran
the identical batch: it **passed** under the revert while three different suites
failed. A change cannot both cause a failure and be absent when it happens. The
only signal that survived every run is my own R2-1 test failing under the revert
and passing with it — which is the discrimination result, taken from a run made
immediately after a clean build.

Every gate above marked PASS was run immediately after a verified
`Build completed successfully` in the same shell invocation.

## Artifacts amended

- `evidence/caller-inventory.md` — the read-level audit table, and the correction
  that §3 classified by function.
- `tasks.md` — 1.3 (R2-3), 7.1 (R2-4), 10.4 (R2-1).
- `specs/store-project-membership/spec.md` — the display-name contract and its
  scenario; the legacy-migration no-op on a v2 Store and its scenario; the repair
  must name the remedy.

---

## Independent re-verification (second fixer session)

All four fixes were confirmed present in the working tree, each
discrimination test was re-run from scratch (revert → build → test → restore →
build → test), and all gates were re-run after a clean build.

### Discrimination re-confirmed

| Finding | Reverted | Failing set | Restored |
| --- | --- | --- | --- |
| R2-4 | re-added kebab regex for `id` in `planning-catalogs.ts` | `layout-migration-catalog-receipt.test.ts` **3 failed / 5 passed** | 8/8 |
| R2-2 | disabled `layout.declared === 2` early return (`if (false && …)`) | `layout-migration-doctor.test.ts` **1 failed / 11 passed** | 12/12 |
| R2-1 | restored `--store`-gated `intent: 'store-read'` | `store-migration-cli.test.ts` **1 failed / 4 passed** | 5/5 |
| R2-3 | disabled `?.` branch (`if (false && …)`) | `planning-path-source-guard.test.ts` **1 failed / 3 passed** | 4/4 |

Every failing test was the one written for that fix; every restored run was
green. The counts match the first session's report exactly.

### Re-audit of the 13-site enumeration (R2-2)

Re-derived independently by searching `src/` for all three v1-only reader
functions. 12 call sites found (one fewer than the first session's 13 because
the definition-site read inside `readRecordFile` is implementation, not a
call). Classifications agree:

- The R2-2 site (`migration-ops.ts:1585`) is now guarded by the
  `layout.declared === 2` early return.
- `plan.ts:472` (`parseStoreProjectRecord`) is unguarded with escaping
  diagnostics — correct as the migration's SOURCE reader (reads pre-migration
  v1 records on purpose).
- `evidence.ts:156` is unguarded but swallows diagnostics (`catch { continue }`).
- `migration-ops.ts:199` (`readProjectOwnership` ← `diagnoseMigrationDrift`) is
  reachable in a v2 Store but benign — reads only `record?.adoption`, discards
  diagnostics, and v2 catalogs carry no adoption name list.

No new defects found beyond what the first session documented.

### Additional fix

`source-guards.ts:85` docblock said "KNOWN HOLES — two" but listed three
items. Corrected to "three" so the count matches the list.

### Gate results (re-run after clean build)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** |
| `npx eslint src test` | **PASS** |
| `node bin/rasen.js validate store-layout-v2-migration --strict` | **PASS** |
| 16 core child-3 suites, `--maxWorkers=1` | **PASS** — 178 passed, 1 skipped, 0 failed |
| 9 suites touched by R2 fixes, `--maxWorkers=1` | **PASS** — 116 passed, 0 failed |

**Failing files: none.** The one skip is `plan-gates.test.ts:111`'s documented
`it.skipIf(!caseSensitiveFilesystem())`.
