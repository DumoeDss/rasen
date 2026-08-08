# Flat Store planning caller inventory — task 1.1

Every production hit on a flat Store planning address, classified. Three
surfaces count as "a flat Store planning address":

1. `specsDir()` / `changesDir()` / `inRepoArchiveDir()` called **against a Store
   root** — these three helpers *are* the flat Store path constructors, so the
   argument decides whether a call is a Store address or a project one;
2. `.rasen-store/adoptions.yaml` access (the legacy adoption manifest);
3. v1 membership record access at `.rasen-store/projects/<projectId>.yaml`.

Literal `join(rasen, 'changes'|'specs'|…)` joins are a fourth surface, already
bounded per file and per count by
`test/core/store-planning/planning-path-source-guard.test.ts`
(`EXPECTED_DIRECT_JOINS`), which child 2 introduced and this change extended.

The classification vocabulary is the one task 1.1 asks for: **migration-source
reader**, **migration Module owner**, **legacy frozen adapter**, **later-slice
owner**, **fixture**, **defect**.

## 1. `specsDir` / `changesDir` / `inRepoArchiveDir`

Bounded by the third assertion in
`test/core/store-planning/planning-path-source-guard.test.ts`
(`EXPECTED_FLAT_HELPER_CALLS`), which enumerates **every** call of the three
helpers anywhere in `src/` and compares the whole per-file, per-argument map.

> **Corrected in review round 1 (finding H2).** The first version of that census
> matched four literal argument spellings — `storeRoot`, `store.root`,
> `store.storeRoot`, `input.storeRoot` — and therefore saw **7 of the 23** calls
> that existed the day it was written. `changesDir(root)`,
> `inRepoArchiveDir(projectRoot)`, `specsDir(sourcePath)` and even
> `changesDir(storeRoot, opts)` all escaped it, so the sentence this paragraph
> used to carry ("adding one outside these two files fails the guard") was false.
> The census is now inverted per `test/helpers/source-guards.ts`: it finds every
> CALL whatever the argument is named, and the allowlist below classifies each.
> Measured proof: adding `inRepoArchiveDir(planningRoot)` to `flat-source.ts`
> left the old regex reporting exactly 7 and failed the new census.

All 23 calls, classified:

| Site | Calls | Classification | Note |
| --- | --- | --- | --- |
| `src/core/store/migration.ts` | 6 | **helper definition** | The module that defines the three helpers (3 declarations) plus `inRepoArchiveDir`'s own `changesDir(root)` and the two generic listers, which take whichever root the caller resolved. |
| `src/core/store/layout-migration/flat-source.ts` (`flatStorePaths`) | 3 | **migration-source reader** | The Module's ONE source-side reader. |
| `src/core/store/migration-ops.ts` — eject restore (`specsDir(storeRoot)`, `changesDir(storeRoot)`) | 2 | **legacy frozen adapter** | The legacy eject read path. Refusing it would trap content in a Store nobody can migrate; pinned by `migration-ops-flat-baseline.test.ts`. |
| `src/core/store/migration-ops.ts` — `inRepoArchiveDir(storeRoot)` in `relocateArchive` | 2 | **legacy frozen adapter** | Guarded by `if (!storeIsV2)` on the read side and by the target-line requirement on the write side. A v2 Store never reaches either. |
| `src/core/store/migration-ops.ts` — `specsDir/changesDir/inRepoArchiveDir(sourcePath)` (adopt), `specsDir/changesDir(destinationPath)` (eject restore), `inRepoArchiveDir(projectRoot)` (relocate) | 10 | **in-project layout** | **PROJECT** roots, not Store roots: the in-project flat layout adopt reads from and eject restores to. Out of scope for this change, and now visible to the census rather than invisible to it. |

## 2. `.rasen-store/adoptions.yaml`

| Site | Classification | Note |
| --- | --- | --- |
| `src/core/store/migration.ts` (`adoptionsManifestPath`, `readAdoptionsManifest`, `upsertAdoptionEntry`) | **legacy frozen adapter** | The manifest family itself. Still read; no new writer. |
| `src/core/store/membership.ts:231` | **legacy frozen adapter** | The membership provider normalizes the manifest into the one membership shape every reader already consumes. |
| `src/core/store/layout-migration/evidence.ts:188` | **migration Module owner** | `E2` evidence. The manifest's content is preserved verbatim in the receipt before retirement removes it. |
| `src/core/store/layout-migration/flat-source.ts:60` | **migration-source reader** | Path only, for the inventory and the retirement set. |
| `src/commands/store.ts:836-837` | **legacy frozen adapter** | Two `console.log` lines suggesting `git log` on the manifest. Text, not an access. |

## 3. v1 membership records (`.rasen-store/projects/<projectId>.yaml`)

The same path holds a `version: 1` record in a flat Store and a `version: 2`
project catalog in a layout v2 one, so every reader must dispatch on the Store's
declared layout rather than sniff the file. `membership-layout.ts` is that
dispatcher.

| Site | Classification | Note |
| --- | --- | --- |
| `src/core/store/membership-layout.ts` | **migration Module owner** | The layout-dispatching read/list/write seam this change added. Everything below should route through it. |
| `src/core/store/membership.ts` (`listStoreMembers`, `resolveProjectMembership`, `writeMembershipRecord`, `planMembershipMutation`) | **migration Module owner** | All four dispatch on the declared layout. **Corrected in review round 1 (finding H1):** this row previously named three functions and claimed all three dispatched. `resolveProjectMembership` did not, and `listStoreMembers` — the most widely consumed reader in the file, behind `store doctor`, the management API's space listing and session-launch membership check, learned-skill authority and bootstrap — was not in this inventory at all. Both read the v1 parser directly, so a Store this change's own migration produced reported zero members and two `invalid_store_project_record` errors against the catalogs the migration had just written. |
| `src/core/store/migration-ops.ts:199-251` (`readProjectOwnership` / `clearProjectOwnership`) | **legacy frozen adapter** | Role clearing and ownership read on the legacy path. `migration-ops-v2.ts` owns the v2 counterpart. See the read-level audit below: the eject call sites are structurally unreachable in a v2 Store, the `diagnoseMigrationDrift` call site is not. |
| `src/core/store/migration-ops.ts` (`migrateStoreMembership`) | **legacy frozen adapter, with a v2 early return** | The explicit v1 membership migration, which converts legacy adoption/reference entries into `version: 1` records. It does not flip a record to v2; only the migration Module does. **Corrected in review round 2 (finding R2-2):** its census read was v1-only and its parse diagnostics reached the operator, so against a migrated Store it reported `error: invalid_store_project_record — Repair or remove <catalog>`. It now returns early on a layout v2 Store, and the conversion loop is default-deny on provenance. |

### Read-level audit (review round 2)

R2-2 exposed a flaw in how this section was built: it classified by FUNCTION, and a
function can be right as a writer and wrong as a reader. `migrateStoreMembership`
produces `version: 1` records by definition — correct — while one of its two reads
was reporting a healthy v2 catalog as corrupt on a live command surface.

Every v1-only read re-asked with the discriminating question — **can this read be
reached with a v2 catalog on disk, and does its RESULT or its DIAGNOSTICS escape
to a user or a decision?**

| Read | Reachable in a v2 Store | Result | Diagnostics escape | Verdict |
| --- | --- | --- | --- | --- |
| `migrateStoreMembership` census (`listStoreProjectRecords`) | yes | wrong — always empty, so `alreadyRecorded` is meaningless | **yes, to the operator** | **was a defect; fixed R2-2** |
| `migrateStoreMembership` apply loop (`readStoreProjectRecord` ×2) | no — the v2 early return, then default-deny on provenance | — | — | guarded |
| `readProjectOwnership` ← `ejectProject` | no — `storeDeclaresLayoutV2` returns to `ejectPartition` first | — | — | structurally guarded |
| `clearProjectOwnership` ← `ejectProject` | no — same guard, same path | — | — | structurally guarded |
| `readProjectOwnership` ← `diagnoseMigrationDrift` | **yes** | correct — a v2 catalog carries no adoption name list by design, and retirement removed the manifest, so `null` is the true answer | no — it reads `record?.adoption` and discards `read.diagnostics` | reachable, benign; recorded rather than changed |
| `layout-migration/evidence.ts` (E2 reader) | yes, when flat content is present | — | no — `catch { continue }` | migration source reader |
| `layout-migration/plan.ts` (catalog upgrade) | yes | — | yes, as `blocked:unrecordable-catalog-field` — which is the point of the read | migration source reader |
| `project-records.ts`, `operations.ts` path helper | schema / message string | — | — | not reads of a Store |

Two reads in one function differed on exactly this question. The structural guards
(an early `return` on `storeDeclaresLayoutV2`) are why classifying by function
happened to be right everywhere else — not a property of the classification.
| `src/core/store/bootstrap.ts` `projectFirstBundleDeclarations` and `readUnreadableRecord` | **migration Module owner** | **Reclassified in review round 1 (finding H1).** Both read `readStoreProjectRecord` — the v1 parser — directly, so against a layout v2 catalog the first **skipped the project's declared knowledge bundle** and the second **reported a perfectly healthy catalog as an unreadable record**. Deferring them was not viable: `readUnreadableRecord` runs BEFORE `resolveProjectMembership` and short-circuits it, so fixing the membership readers alone left bootstrap answering `unverifiable-here` for every project in a migrated Store — the H1 fix would have been unobservable through bootstrap. Both now dispatch through `readStoreMembership`. `store-v2-compat-hardening` tasks 2.1/2.2 name these two sites and are now no-ops. |
| `src/core/store/project-records.ts` | **legacy frozen adapter** | The v1 record schema and its reader/writer. Still the only writer of a `version: 1` record. |

## 4. Defects

None outstanding in this inventory. Two were found and fixed while it was being
taken, both recorded in `implementation-report.md`: `writeMembershipRecord`
wrote a v1 record into a v2 Store (defect 2), and `adoptProject` guarded the
target-line check behind an existing identity (defect 1).

Two more were found by the independent review and fixed in round 1, both
recorded above: the two membership readers that did not dispatch (H1) and the
name-based helper census (H2). The lesson this document should carry forward is
that **the census only bounded what it happened to be able to see** — §1's
enforcement claim and §3's dispatch claim were both written about code neither
had actually been measured against.

## 5. How to re-run this census

```
grep -rn "specsDir(\|changesDir(\|inRepoArchiveDir(" src/ --include=*.ts
grep -rn "adoptions\.yaml\|readAdoptionsManifest\|upsertAdoptionEntry" src/ --include=*.ts
grep -rn "readStoreProjectRecord\|writeStoreProjectRecord\|getStoreProjectRecordPath" src/ --include=*.ts
pnpm exec vitest run test/core/store-planning/planning-path-source-guard.test.ts
```

The guard is the enforcement; this document is the classification. A new hit
fails the guard first, and is then classified here.

Read the guard's own assertion before trusting that sentence again: it holds
only while the census is argument-blind and compares the WHOLE map. It did not
hold when the census matched four argument spellings, and nothing in this
document could have revealed that — the census had to be measured against the
calls it was supposed to bound.
