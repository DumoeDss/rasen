# Review round 2 — verification of the round-1 fix delta (`store-layout-v2-migration`)

Reviewer: same independent reviewer who filed `evidence/review-report.md`. Read-only.
Input: `evidence/fix-report-r1.md` (8 fixed, 1 partially rejected, 0 deferred).

Nothing in the fixer's tables was taken on trust. Every claim below was
re-derived: by reading the shipped code, by running the detectors against inputs
the fixer did not choose, and by driving the real CLI end to end against a Store
this change's own migration produced.

**Verdict: 8 of 9 genuinely closed. M4 is closed for one invocation form and
open for the other. 4 new findings (3 medium, 1 low) plus 1 attribution note.**

---

## Part 1 — Rulings the lead asked for

### 1.1 The `bootstrap.ts` override — **the fixer is right and I was wrong**

I filed both `bootstrap.ts` sites as correctly deferred to child 7 (I10). That
was incorrect, and the reason the fixer gives is verifiable.

`src/core/store/bootstrap.ts:2181-2187`:

```ts
const unreadable = await readUnreadableRecord(store, projectId);
if (unreadable) {
  // The Store's records STILL fail to parse after registration — the
  // unknown is real, not stale. Membership stays unverifiable-here.
  entry.diagnostics.push(...unreadable.diagnostics);
} else {
  const record = await resolveProjectMembership(store, projectId, options);
  …
}
```

`readUnreadableRecord` gates `resolveProjectMembership`. When the v1 parser fails
— which it did for **every healthy v2 catalog** — the `else` branch is never
entered, membership never asked, and the answer freezes at `unverifiable-here`.
Fixing only the two `membership.ts` readers would therefore have left bootstrap
reporting exactly what it reported before, with the H1 fix unobservable through
that surface. The same shape holds at the second pair (`:2623` / `:2538`).

Both sites now dispatch: `readUnreadableRecord` at `:2685` calls
`readStoreMembership` from `membership-layout.ts`, and the docblock at `:2670-2677`
records the short-circuit as the reason.

**Consequence for child 7, confirmed:** its tasks 2.1 and 2.2 are now no-ops, and
its task 3.2 — which enumerates `membership.ts` as a *frozen legacy adapter* —
describes a file that no longer behaves that way and would, if applied as
written, re-classify a fixed defect as intended behaviour. Child 7's census needs
re-deriving from the tree as it now stands. Its task 1.1 already says "trust the
re-run, not the citation", which is the right instinct; 3.2's pre-baked answer
contradicts it.

### 1.2 The data-destruction claim — **true, the guard is real, and it is the only thing stopping it**

Chain verified line by line:

1. `migrateStoreMembership` reads members through `listStoreMembers`
   (`migration-ops.ts:1550`). After H1 that returns migrated members with
   `provenance: 'project-catalog'`.
2. `alreadyRecorded` cannot save them: it is built from
   `listStoreProjectRecords(storeRoot)` (`:1551`) — the **v1-only** lister, which
   returns zero records for a v2 Store. The set is empty.
3. Without the guard, each member falls through to `:1626-1637`, which builds
   `const record: StoreProjectRecord = { version: 1, … }` and calls
   `writeStoreProjectRecord(storeRoot, record)` — **the same path the v2 catalog
   occupies**, `.rasen-store/projects/<projectId>.yaml`. `planningBinding` is not
   a field of `StoreProjectRecord`, so it is dropped, not carried.

The guard is `migration-ops.ts:1574`:

```ts
if (member.provenance === 'v2-record' || member.provenance === 'project-catalog') continue;
```

Verified as shipped, through the real CLI against a Store migrated and retired by
`rasen store migrate-layout`:

```
$ rasen store migrate-membership team-store --apply --json
exit=0   "converted": []   "store_writes": []
catalog BEFORE == catalog AFTER   (version: 2, planningBinding: bound, byte-identical)
```

**Second path with the same shape: none.** The only other raw
`writeStoreProjectRecord` caller reachable with a v2 catalog present is
`clearProjectOwnership` (`migration-ops.ts:251`), and it is inside
`if (read.record)` — `readStoreProjectRecord` returns `record: null` for a v2
catalog, so it writes nothing. The third caller (`membership.ts:934`) is the v1
arm of `writeMembershipRecord`, now behind the layout dispatch and the M6 assert.

**One thing worth recording:** `migrateStoreMembership` writes through the *raw*
`writeStoreProjectRecord`, not through `writeMembershipRecord`, so the M6 fix
(assert inside the record lock) does **not** cover this path. The provenance
check at `:1574` is the sole protection. If a later slice adds a member source
with a new provenance value, that `continue` must be extended with it — a
default-deny (`if (member.provenance !== 'legacy-adoption' && member.provenance !== 'legacy-reference') continue;`)
would fail closed instead of open. Recorded, not filed: the current enumeration
is correct and tested.

### 1.3 The M6 partial rejection — **I agree, and the reasoning is sound**

Both arms of the rejection hold:

- The migration publishes `writes: 'partition'` while `declared === 1`. That is
  the flat→v2 publication itself, and it is precisely the input
  `assertStoreLayoutForWrite`'s third branch refuses with
  `legacy_flat_store_requires_migration` (`layout-write-guard.ts:173-182`). The
  migration would refuse itself.
- A run interrupted after the layout flip and before the receipt lands is
  `mixed === true` by construction, and `--resume` is the documented recovery for
  exactly that state (`module.ts:365-367`). The mixed refusal would block the
  only remedy.

The equivalent gates the fixer points at are real and tested: `blocked:mixed-layout`
at plan time (`plan.ts:197-202`), `revalidatePlan` at apply time
(`apply.ts:111-187`), and the Store-scoped owner-aware lock. Amending task 9.1's
text rather than leaving a tick over code that deliberately does not satisfy it
is the right disposition — a false tick is what produced findings M4, M6 and 10.5
in the first place.

### 1.4 The membership-write half of M6 — closed

`membership.ts:912-919`: the assert is inside `withOwnerAwareFileLock`, beside the
read it dispatches, and the branch consumes the returned state rather than
re-deriving it. The new `StorePlanningWriteShape` value `'metadata'` is correct
rather than a convenience: the record file lives at the same path under both
layouts and only its schema follows the declaration, so neither the flat nor the
partition refusal applies — but the mixed refusal must, and that was the finding.

---

## Part 2 — Independent verification of the fixes that matter

I re-derived these rather than reading the fixer's discrimination table.

### H1 — closed, verified end to end

Round 1's reproduction, re-run against the same fixture shape after the fix
(real CLI: register → `migrate-layout --apply` → `--retire-flat`, two commits):

| | round 1 | now |
|---|---|---|
| `rasen store doctor team-store --json` on a clean migrated Store | `["error:invalid_store_project_record"]` — *"Repair or remove …elftia.yaml"* | **`[]`** |
| `listStoreMembers(...)` | `members: []`, 2 × `error:invalid_store_project_record` | `['elftia']`, `provenance: 'project-catalog'`, 0 error diagnostics |
| `resolveProjectMembership(..., 'elftia')` | `null` | non-null |

The tests added are against `layoutVersion: 2` fixtures — the layout no test in
`test/` had ever built for a membership reader (`membership.test.ts:657`,
"reads dispatch on the declared planning layout", 3 cases; plus
`layout-migration-doctor.test.ts:170`, `bootstrap-bundle-import.test.ts`,
`space-scoping.test.ts:307`).

`layout-migration-doctor.test.ts:167` now carries
`expect(reported.filter((entry) => entry.severity === 'error')).toEqual([])`
with the reason written beside it. That is exactly the assertion I said in round 1
would have caught H1 the day the test was written, and the fixer confirms it fails
under the H1 revert. I verified it is present and reachable (the test migrates and
retires for real before asserting).

### H2 — closed, and I probed it with inputs the fixer did not choose

`flatPathHelperCalls()` (`test/helpers/source-guards.ts:85-123`) is inverted the
way that module's own docblock prescribes, and the guard compares the whole
per-file map by equality (`planning-path-source-guard.test.ts:168-178`), so a new
file fails on the file key and a new argument spelling fails on the token key.

I ran the detector directly against my round-1 escapes **plus four shapes nobody
enumerated**:

```
SEEN     plain storeRoot               {"changesDir(storeRoot)":1}
SEEN     planningRoot (r1 escape)      {"changesDir(planningRoot)":1}
SEEN     second arg (r1 escape)        {"changesDir(storeRoot)":1}
SEEN     this.storeRoot (r1 escape)    {"specsDir(this.storeRoot)":1}
SEEN     call-result arg (r1 escape)   {"changesDir(store.paths().root)":1}
SEEN     multiline arg                 {"changesDir(storeRoot)":1}
SEEN     non-null assertion            {"changesDir(storeRoot!)":1}
SEEN     nested comma                  {"changesDir(join(a, b))":1}
SEEN     method call                   {"changesDir(root)":1}
ESCAPES  OPTIONAL CALL                 changesDir?.(storeRoot)
ESCAPES  IMPORT ALIAS + call           import { changesDir as cd } … cd(storeRoot)
ESCAPES  COMPUTED PROPERTY             helpers['changesDir'](storeRoot)
ESCAPES  ALIAS via const (recorded)    const f = changesDir; f(storeRoot)
ESCAPES  bare reference (correct: {})  const changesDir = paths.changes;
```

All five round-1 escapes are now visible, each with its own token so it cannot be
mistaken for an already-classified call. Three escapes remain — see R2-3 below.

### M3 — closed, verified end to end including the part that made it worse than doing nothing

Same probe as round 1: migrate → retire → commit → commit flat content back.

```
store doctor team-store --json
  error  store_layout_mixed_residue
    msg: This store retired its flat planning tree and is holding flat planning
         content again at …\team-store\rasen; Git can add those paths back
         without conflict once they no longer exist here.
    fix: git -C …\team-store log -- rasen/specs rasen/changes
         # then remove the re-introduced flat planning content

store adopt <project> --to team-store --target-line line-0.2
  exit=1  store_layout_mixed_residue
    "…retired its flat planning tree and is holding flat planning content again,
     so store-adopt cannot write either layout."
```

Round 1 this was `info`, said *"retirement is a separate step and has not run
yet"* two commits after it ran, offered `--retire-flat`, and the adopt **exited 0**.
All four are corrected. `--retire-flat` is specifically absent from the repair,
which was the half of the finding that made following the advice destructive.

### M5, L7, L8, I9 — closed (read, not re-derived at runtime)

- **M5** `plan.ts` now derives first (`deriveSpecOwners`) and applies the
  declaration only when the derived resolution left the item unresolved — the same
  `decision.reason !== undefined` precondition the Change/Archive arm carries at
  `:223`. `supersededEvidence` is populated on spec items instead of hard-coded
  `[]`, so the disagreement reaches the receipt. Both remedies I offered, not one.
- **L7** `storeTree()` walks the whole Store root, and both membership cases now
  assert `.rasen-store/projects/<id>.yaml` **is in the added set** before claiming
  anything about flat or partition paths — so the emptiness assertions are made
  against a non-empty diff and can no longer be true by construction. The relocate
  case gained the `--to store` direction (the only one that writes into a Store),
  and the migration surface task 11.3 named is present as a second describe block.
- **L8** the fixture now produces all six components task 9.4 enumerates (design
  doc, second flat ref, untracked file with `--include-untracked`), and the test
  asserts state label, reason, destination, target line and untracked paths per
  item, with `toBeGreaterThan(0)` preconditions so an empty fixture cannot make
  the loops vacuous again.
- **I9** `submit.ts`'s comment now states what ships.

### The six guards I judged non-discriminating

| # | Guard | Verified disposition |
|---|---|---|
| 1 | task-1.3 census | Rewritten and inverted; I re-probed it myself (above) |
| 2 | task 7.3 dispatch coverage | Four new tests, each on a `layoutVersion: 2` fixture; I confirmed the fixtures declare it |
| 3 | `layout-no-dual-write` relocate | Real `--to store` direction added; `--to in-repo` case strengthened so a stubbed `relocateArchive` fails it |
| 4 | `layout-no-dual-write` membership | `storeTree()` + "the write is visible to the sweep" precondition |
| 5 | `layout-migration-doctor.test.ts:121` | `expect(errors).toEqual([])` added at `:167` |
| 6 | `store-migrate-layout-cli` parity | Fixture now produces all six components |

All six are genuinely closed. The **new** guards are themselves discriminating,
with one qualification: see R2-1, where the new M4 parity test is built on the one
fixture shape that cannot expose the gap it was written to close.

---

## Part 3 — The fixer's own findings: confirm / refute

**1. `readUnreadableRecord` short-circuits `resolveProjectMembership`** — **CONFIRMED**, see 1.1. I was wrong.

**2. Task 10.5 is a second ticked-but-not-done task** — **CONFIRMED.**
`test/commands/store-migration-cli.test.ts` had three cases
(`config set archive.destination`, `store adopt --archive external`,
`store eject --all`) and no layout content of any kind. It now carries the
both-doctors parity case at `:119`. Task 10.5 said "extend … for the new
diagnostic surface"; it was ticked without that having happened. I missed it.

**3. Fixing H1 without `migration-ops.ts:1574` would have destroyed data** — **CONFIRMED**, see 1.2.

**4. Nothing proved the management API's space listing sees a migrated Store's members** — **CONFIRMED.**
`space-scoping.test.ts`'s only Store fixture was legacy flat with members from
pointer repos, so `listStoreMembers` contributed nothing to the assertion in the
first place. The new `seedMigratedStore()` (`:207`) builds a `layoutVersion: 2`
Store with a v2 catalog and asserts the member is addressable. This is the surface
the portfolio has now been bitten on three times; it is now covered. Good catch —
better than mine, which traced the call chain but stopped short of a test.

**5. `StoreProjectCatalogV2.id` is documented as a display name but validated as a canonical kebab id** — **CONFIRMED, and it is worse than "recorded".** See R2-4; I am filing it as a finding rather than a note.

**6. `operations.ts` had the `.catch(() => [])`** — **CONFIRMED**; both swallows
are gone and an undiagnosable Store now reports `store_layout_diagnosis_failed`
rather than reporting as healthy.

---

## Part 4 — New findings in the fix delta

### R2-1 — MEDIUM — `rasen doctor` still reports nothing for a **migrated** Store when run without `--store`, and the new parity test uses the one fixture that cannot show it

**Where:** `src/commands/doctor.ts:640-642` (the `intent: 'store-read'` conditional) reached before `:660` (`gatherStoreLayoutFindings`); test at `test/commands/store-migration-cli.test.ts:119`.

The aggregate branch itself is correct — `storeLayout` is computed at `:660`,
before the `store-aggregate` early return at `:662`, and the branch emits it. The
comment at `:657-659` states the motivation exactly right:

> Computed before the aggregate early-return: a MIGRATED Store resolves as a
> store aggregate, so leaving it below that branch would report the layout of
> every Store except the ones this migration produced.

But that branch is unreachable ambiently, because root resolution refuses first.
`intent: 'store-read'` is passed **only** when `--store` is given without
`--project`; without it the resolver defaults to a project intent and
`resolver.ts:1691` throws `project_scope_required` for a `store-aggregate` ref.

Measured against one Store, all three invocation forms:

```
rasen doctor --json           (cwd = migrated STORE root)  exit=1  << NO storeLayout KEY >>
                                                            status=["project_scope_required"]
rasen doctor --store team-store --json                     exit=0  storeLayout=
                                                            ["error:store_layout_mixed_residue",
                                                             "warning:store_layout_unresolved_ownership"]
rasen store doctor team-store --json                       (same two findings)
```

**Failure scenario.** A Store owner migrates their Store — the product this change
ships — then stands in the Store worktree and types `rasen doctor`. Before the
migration that printed a report. After it, it exits 1 with
*"This operation requires one project; --store alone selects only the Store
aggregate. Fix: Add --project <project-id>."* — no health report, no layout
section, and no hint that `--store` would have worked. M4's stated purpose was
"`rasen doctor` is the obvious first command for a Store owner"; for a migrated
Store, ambient is the one form that does not deliver it.

**Why the test does not catch it.** `store-migration-cli.test.ts:135` runs
`runCLI(['doctor', '--json'], { cwd: storeRoot })` — ambient, correctly — but the
fixture Store is **legacy flat** (`.rasen-store/store.yaml` has no
`layoutVersion: 2`; the test writes flat `rasen/specs/billing` and
`rasen/changes/fix-a` into it). A flat Store resolves as `legacy-store`, not
`store-aggregate`, so it never reaches the refusal. The fix for a
"one surface is never proof" finding was verified on one surface.

**Attribution, stated honestly:** the refusal lives in child 2's resolver and the
`intent` conditional predates this fix. But child 3 is what turns a Store into
`store-aggregate`, M4 is child 3's fix, and the migrated Store is the case child 3
produces. Child 3 should either pass `intent: 'store-read'` when the resolved root
is itself a Store checkout, or record the gap explicitly instead of leaving the
comment at `:657` claiming a coverage the shipped path does not have.

### R2-2 — MEDIUM — `store migrate-membership` against a migrated Store still tells the operator to delete their healthy catalog

**Where:** `src/core/store/migration-ops.ts:1551` (`listStoreProjectRecords(storeRoot)`) surfaced at `:1557` (`const diagnostics = [...existing.diagnostics]`).

H1 fixed `listStoreMembers`. The *other* v1-only read in the same function was
left, and its diagnostics are reported to the user. Observed on a Store this
change's own migration had just produced, clean, no manual merge involved:

```
$ rasen store migrate-membership team-store --apply --json
exit=0
  "converted": [], "store_writes": []          ← the write guard holds (1.2)
  "status": [ {
      "severity": "error",
      "code": "invalid_store_project_record",
      "message": "Invalid store project membership record: version: Invalid input:
                  expected 1; root: Unrecognized key: \"planningBinding\"",
      "fix": "Repair or remove …\\.rasen-store\\projects\\elftia.yaml"
  } ]
```

This is the same message, the same severity, and the same destructive repair that
H1 was filed for — *"Repair or remove"* the catalog the migration just wrote —
surviving on a command surface. Following it deletes the ownership record and
orphans the partition.

The fixer's own enumeration classifies this site "correct as v1-only — the legacy
`store migrate-membership` command, which produces `version: 1` records by
definition". That is right about the **writer** and wrong about this **read**: the
v1 listing here serves `alreadyRecorded` (a set that is meaningless for a v2 Store
— it is always empty) and its parse diagnostics are passed straight through to the
operator. Either dispatch it, or drop its diagnostics and have the command report
`store_layout_*` guidance for a Store that has no v1 membership left to migrate.

**Failure scenario.** An operator follows the two commands in the order the CLI
lists them (`migrate-membership`, `migrate-layout` both appear in
`rasen store` help), or re-runs `migrate-membership` idempotently after migrating
the layout. They get an `error` telling them a file is invalid and to remove it.
They remove it. The project's `planningBinding: bound` and roles are gone, the
partition is orphaned, and `store doctor` then reports
`store_layout_partition_orphan`.

### R2-3 — LOW — the census's recorded hole is narrower than its actual hole, and two of the three escapes are idiomatic in this repo

**Where:** `test/helpers/source-guards.ts:87-96`; `fix-report-r1.md` §H2 "Not attempted".

The report records exactly one residual — `const f = changesDir` — with a measured
reason. Three escape, and the two unrecorded ones are shapes this codebase already
uses:

| Escape | Occurrences of that syntax in `src/` |
|---|---|
| `changesDir?.(storeRoot)` — optional call | 39 `?.(` call sites |
| `import { changesDir as cd }` … `cd(storeRoot)` | 50 files use the `{ X as Y }` import form |
| `helpers['changesDir'](storeRoot)` — computed | — |

The optional-call case is a two-character fix at `:96` (accept `?.` before the
`(`). The alias cases are the same family as the recorded one and genuinely need
symbol resolution — but the record should say "three shapes, of which one is
cheap", not "one". A hole believed to be one item wide is not audited the same way
as a hole three items wide.

This is LOW because the census is now vastly stronger than what it replaced (7 of
23 calls visible → all 23 plus every future spelling), and because none of the
three shapes appears against a flat-path helper today.

### R2-4 — MEDIUM — `StoreProjectCatalogV2.id` is a display name by contract and a canonical id by validation; a real Store carrying `id: Elftia` cannot migrate

**Where:** `src/core/store/membership.ts:664` (*"The project's display name, recorded for reading only"*) → `membership.ts:810` (`composeCatalog`: `const id = input.projectDisplayId ?? existing?.id`) → `src/core/store/planning-catalogs.ts:265-269` (`parseChangeId(result.data.id, 'id')` → *"must be a canonical lowercase kebab id"*).

The fixer recorded this without a severity. It deserves one, because the two
schemas diverge on data that already exists:

```
id="elftia"          v1 record: ACCEPTS   v2 catalog: ACCEPTS
id="Elftia"          v1 record: ACCEPTS   v2 catalog: REJECTS (invalid_project_catalog)
id="my app"          v1 record: ACCEPTS   v2 catalog: REJECTS (invalid_project_catalog)
id="elftia-website"  v1 record: ACCEPTS   v2 catalog: ACCEPTS

writeMembershipRecord({ projectDisplayId: 'Elftia' }):
  legacy flat Store  OK   → id: Elftia written
  layout v2 Store    FAIL → invalid_project_catalog: id: must be a canonical lowercase kebab id
```

Two consequences, both reachable:

1. **Migration blocks on real legacy data.** `catalog-upgrade.ts:140` carries
   `record.id` forward verbatim and blocks via the serializer
   (`:152-165`, `blockedField: 'id'`) when it fails. Any existing Store whose
   membership record carries a human display name — which is what the field is
   documented to hold, and what `store add-project --display` would have written —
   is unmigratable until someone hand-edits the record. The repair the operator
   sees names the field and the validator, not "rename it to kebab-case".
2. **The same command diverges by layout.** `store add-project` /
   `store adopt` with a mixed-case or spaced display name succeeds against a flat
   Store and fails against a migrated one.

Either widen the v2 validator to accept a display string (matching the documented
contract and the v1 schema), or change the field's contract and its comment, and
give `catalog-upgrade` a repair that names the actual remedy. Not a fix to make
during a review round — but it should not ship as an unrated note either.

### R2-5 — attribution note, not child 3 — two literal NUL bytes in `src/core/store/query/module.ts`

The lead asked me to carry child 5's lesson forward, so I ran a byte-level audit
rather than trusting `git diff --check`. It found this in a **new, untracked**
file:

```
src/core/store/query/module.ts:267   const key = `${projectId}^@${targetLineId}`;
src/core/store/query/module.ts:311   const [rawProject, rawLine] = key.split('^@') as [string, string];
```

(`^@` is `cat -A` for a raw 0x00.) The pair is matched and functionally coherent —
a NUL map-key delimiter — but written as raw control bytes in source rather than
`' '` escapes, and `git diff --check` cannot see it because the file is
untracked. `src/core/store/query/` is the StoreQueryModule: **child 6**, not
child 3. Reported only so it is not lost.

---

## Part 5 — Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — exit 0, no diagnostics |
| `npx eslint src test` | **PASS** — exit 0, no output |
| `node bin/rasen.js validate store-layout-v2-migration --strict` | **PASS** — "Change 'store-layout-v2-migration' is valid" |
| `pnpm run build` | **PASS** |
| 16 child-3 core suites, `--maxWorkers=1` | **PASS** — 175 passed, 1 skipped, **0 failed** |
| The 9 suites this fix touches, `--maxWorkers=1` | **PASS** — 114 passed, **0 failed** (matches the fixer's count exactly) |
| Byte-level audit, 205 new+modified files | **PASS for child 3** — see below |

**Failing files, enumerated: none.** Neither serial run produced a failure. The
one skip is `plan-gates.test.ts:111`'s documented
`it.skipIf(!caseSensitiveFilesystem())`.

Core suites run: `layout-migration-{inventory,provenance,mapping,plan-gates,apply-recovery,catalog-receipt,doctor,module,windows-paths}`,
`layout-no-dual-write`, `migration-ops-{flat-baseline,v2-partitions}`,
`membership`, `membership-operations`, `planning-path-source-guard`,
`legacy-store-gate-guard`.
Touched suites run: `layout-migration-{doctor,mapping}`, `layout-no-dual-write`,
`membership`, `planning-path-source-guard`, `store-migration-cli`,
`store-migrate-layout-cli`, `space-scoping`, `bootstrap-bundle-import`.

### Byte-level audit — `git diff --check` is vacuous for new files, so I read the bytes

205 new and modified files under `src/`, `test/` and the change directory, scanned
for NUL, BOM, U+FFFD, CR, trailing whitespace and EOF newline. Everything flagged
was then attributed against the frozen base `588afca1`:

| Flag | Verdict |
|---|---|
| `src/core/store/layout-migration/apply.ts:359` — 1 × U+FFFD | **Deliberate.** `const REPLACEMENT_CHARACTER = '<U+FFFD>'`, the literal `decodesCleanly()` rejects staged files for (task 6.2). Correct. |
| `test/core/store/layout-migration-catalog-receipt.test.ts:260` — 1 × U+FFFD | **Deliberate.** `expect(text).not.toContain('<U+FFFD>')` — the assertion for the above. Correct. |
| `src/locales/zh-cn.json` — 4 × U+FFFD (lines 985-986, `必��是`) | **Pre-existing.** Base carries the identical 4; no diff hunk touches those lines. Real corruption, but not this branch's. |
| `src/locales/ja.json` — 3 × U+FFFD (line 209, `変更��作`) | **Pre-existing.** Base carries the identical 3. |
| `test/core/templates/skill-templates-parity.test.ts` — BOM | **Pre-existing.** Base has the BOM. |
| `src/core/store/query/module.ts` — 2 × NUL | **Child 6**, see R2-5. |
| CR in 22 files | **Not a signal here.** `core.autocrlf = true`, and untouched files carry CR too (`src/core/store/errors.ts` 42, `src/utils/change-utils.ts` 189). Reported as noise, not a finding. |

Both U+FFFD hits in child 3's own new files are the guard and its test. Writing
the literal character rather than `'�'` is fragile — any tool that normalises
it silently disarms the guard — but that is a style note, not a defect.

The three locale/BOM items are shipping hygiene for the **parent** integration
gate, not for this change: they were on the base and this branch did not touch
those lines.

---

## Part 6 — What I could not verify

- **The fixer's revert-and-re-run discrimination runs.** I am read-only on `src/`
  and `test/`, and two other implementers are live in this tree, so I could not
  reproduce the reverts. Instead I verified the *outcomes* independently — the
  round-1 reproductions, re-run, now produce the corrected behaviour — and probed
  the new detectors with inputs the fixer did not choose. Where the fixer's claim
  and my re-derivation agree (H1, H2, M3, M6-half, 10.5, space-scoping, catalog
  `id`), I consider it verified; where I could only read the code (M5, L7, L8), I
  say so above.
- **The pointer-repo arm of `storeLayoutDiagnosisTarget`** (a project declaring a
  Store that resolves). My fixture's `store adopt` was correctly refused by the
  M3 fix, so no bound pointer repo existed to test it from. The direct arm and the
  `--store` arm are both verified; that third arm is read-only-verified.
- **Non-Windows behaviour.** All runs on win32.
- **Whether child 6's NUL bytes are intentional.** They are paired and functional;
  I did not read enough of child 6 to judge intent.
- **`dist/` stability.** Three runs died with `ERR_MODULE_NOT_FOUND` mid-session
  from a concurrent rebuild, exactly as the lead warned. Every result above is
  from a run after a clean `pnpm run build` in the same shell invocation.
