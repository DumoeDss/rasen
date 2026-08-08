# Independent review — `store-layout-v2-migration` (child 3)

Reviewer: independent, read-only. Scope reconstructed from `tasks.md` (83 tasks,
all ticked), `design.md`, `proposal.md`, `specs/`, `evidence/implementation-report.md`
and `evidence/caller-inventory.md`, because children 3–5 share one uncommitted
working tree and `git diff` cannot isolate this child.

**Findings: 2 high, 4 medium, 2 low, 2 informational.**

Concurrent-edit exclusion honoured: `src/core/store/finalization/**`,
`src/core/archive.ts`, `src/core/archive-engine.ts`, `src/core/archive-accounting-v2.ts`
and finalization additions to `src/core/management-api/` are attributed to child 5.

---

## H1 — `listStoreMembers` and `resolveProjectMembership` do not dispatch on the declared layout; a correctly migrated Store reports its own healthy catalogs as invalid and shows zero members

**Severity:** HIGH
**Where:** `src/core/store/membership.ts:279` (`listStoreMembers` → `listStoreProjectRecords`, the v1-only lister) and `src/core/store/membership.ts:390,395` (`resolveProjectMembership` → `readStoreProjectRecord` then `listStoreMembers`, both v1-only).
**Task claimed:** 7.3 — *"Make **every** membership reader dispatch on the Store's declared layout version rather than sniffing file content"* — ticked `[x]`.
**Inventory claim contradicted:** `evidence/caller-inventory.md` §3 classifies `membership.ts` (`resolveProjectMembership`, `writeMembershipRecord`, `planMembershipMutation`) as **"migration Module owner — Dispatches on the declared layout since defect 2."** Two of those three do. `resolveProjectMembership` does not, and `listStoreMembers` — the most widely consumed reader in the file — is not in the inventory at all.

The dispatcher exists and is correct (`src/core/store/membership-layout.ts:123` `listStoreMembership`, and `readStoreMembership`). These two readers simply do not use it.

### Failure scenario (reproduced end to end)

Real CLI, real Git, fresh temp Store, isolated `XDG_DATA_HOME`:

```
rasen store register <store>            → ok
rasen store migrate-layout team-store --mapping rasen/migration-mapping.yaml --apply   → exit 0, phase published
rasen store migrate-layout team-store --retire-flat                                    → exit 0, phase retired
```

Store is now exactly what this change produces: `layoutVersion: 2`, flat tree gone,
receipt phases `staged → published → retired`, catalog on disk:

```yaml
version: 2
projectId: elftia
roles: { planning: true, knowledge: true }
planningBinding: { state: bound, boundAt: 2026-01-02T03:04:05.000Z }
```

Direct calls against that Store (`dist/`, freshly built):

```
listStoreMembers  members:     []
listStoreMembers  diagnostics: ["error:invalid_store_project_record",
                                "error:invalid_store_project_record",
                                "warning:store_legacy_reference_unresolved"]
resolveProjectMembership(ref,'elftia'): null
listStoreMembership (dispatcher)  layout: 2  entries: ["1a52…4226","elftia"]  diags: []
readStoreMembership (dispatcher)  entry: "elftia"  layout: 2
```

And through the CLI, on a Store that has just migrated successfully with no other problem:

```
rasen store doctor team-store --json
  error  invalid_store_project_record
    msg: Invalid store project membership record: version: Invalid input: expected 1;
         root: Unrecognized key: "planningBinding"
    fix: Repair or remove <store>/.rasen-store/projects/elftia.yaml
```

`rasen store doctor` — the command this change *extends* with nine new layout
diagnostics — tells the operator, at severity `error`, to **delete the project
catalog the migration just wrote**. Following that repair destroys the ownership
record and leaves an orphaned partition.

Root cause is unambiguous: `StoreProjectRecordSchema` is
`z.object({ version: z.literal(1), … }).strict()` (`src/core/store/project-records.ts:211-221`),
so a v2 catalog fails on both the literal and the unknown `planningBinding` key.

### Blast radius — every one of these is reachable and wrong in a migrated Store

| Call site | Consequence |
|---|---|
| `src/core/store/operations.ts:1993` (`doctorStores`) | two spurious `error` findings per member; member roster empty |
| `src/core/management-api/spaces.ts:184` | **management API**: a Store's member projects vanish from the space listing |
| `src/core/management-api/session-launch-context.ts:145` | **management API**: session launch resolves no membership for a bound project |
| `src/core/learned-skills/authority.ts:106` | Store-scoped learned-skill authority sees no members |
| `src/core/store/bootstrap.ts:2179, 2530, 2884, 3109` | membership answers collapse to "not a member" |
| `src/core/store/membership.ts:484, 515` | the eligibility/candidate union loses the membership arm |

This is the portfolio's own recorded failure mode, third occurrence, same shape:
*"child 3 swept the CLI and missed the management API."* Two management-API
surfaces are in the list.

### Why no test caught it

`test/core/store/membership.test.ts` exercises both readers, but every fixture is
a **legacy v1** Store. No test in `test/` calls `listStoreMembers` or
`resolveProjectMembership` against a Store declaring `layoutVersion: 2`. Task 7.6's
"layout dispatch" coverage tests the dispatcher module itself
(`membership-layout.ts`), never its would-be consumers — so the guard for task 7.3
proves the dispatcher works and proves nothing about "every membership reader".

`test/core/store/layout-migration-doctor.test.ts:121` *does* run a real
migrate + retire and then calls `findings()` — but asserts only that
`store_layout_legacy_archive_record` is `toBeDefined()`. The two
`invalid_store_project_record` errors sitting beside it are invisible to a
`.find()` assertion. Add an "no unexpected error-severity finding after a clean
migration" assertion and this fails immediately.

### Not covered by child 7

Child 7's tasks 2.1/2.2 name only the two `bootstrap.ts` sites. Worse, its task
3.2 pre-classifies **`membership.ts` as a "frozen legacy adapter"**, which would
enshrine this defect rather than fix it. Nothing in the portfolio currently owns
`listStoreMembers`, `resolveProjectMembership`, `spaces.ts`,
`session-launch-context.ts`, or `learned-skills/authority.ts`.

---

## H2 — The new bounded source guard (task 1.3) matches four literal argument spellings and is blind to 16 of the 23 flat-helper calls already in `src/`

**Severity:** HIGH
**Where:** `test/core/store-planning/planning-path-source-guard.test.ts:60-61` (`FLAT_HELPER_AGAINST_STORE_ROOT`).
**Claim contradicted:** `evidence/caller-inventory.md` §1 — *"Bounded by the third assertion … which pins the file set and the per-file count, so adding one outside these two files fails the guard"* — and §5 — *"**The guard is the enforcement**; this document is the classification. A new hit fails the guard first."*

The regex is

```
\b(?:specsDir|changesDir|inRepoArchiveDir)\(\s*(?:storeRoot|store\.root|store\.storeRoot|input\.storeRoot)\s*\)
```

It matches the **argument spelling**, not the call. Measured over `src/`:

```
total specsDir/changesDir/inRepoArchiveDir calls: 23    seen by the guard: 7
argument spellings: storeRoot ×7 | sourcePath ×6 | root: string ×3 | root ×3
                    destinationPath ×2 | projectRoot ×2
```

Direct probe of the regex:

```
MATCH   "const d = changesDir(storeRoot);"
ESCAPES "const d = changesDir(root);"
ESCAPES "const d = changesDir(planningRoot);"
ESCAPES "const d = changesDir(store.path);"
ESCAPES "const d = changesDir(s.root);"
ESCAPES "const d = inRepoArchiveDir(resolvedStoreRoot);"
ESCAPES "const d = specsDir(this.storeRoot);"
ESCAPES "const d = changesDir(storeRoot, opts);"     ← even a second argument defeats it
```

### Failure scenario

Child 5 (or any later slice) adds to `src/core/store/finalization/module.ts`:

```ts
const planningRoot = store.storeRoot;
const archiveTarget = inRepoArchiveDir(planningRoot);   // flat rasen/changes/archive
```

`observed` gains no entry, `expect(observed).toEqual(expected)` passes, CI is
green, and a layout v2 Store gains a root-level flat archive path — the single
thing design D12's "compile/source" level exists to make impossible. The
caller-inventory's own note that `flat-source.ts` *"deliberately names its
parameter `storeRoot` so the census can see it"* is an explicit admission that
the guard is name-based.

### This is the exact anti-pattern the file's own helper module forbids

`test/helpers/source-guards.ts:1-21` documents, at length, two guards that were
defeated by *"a receiver shape nobody had thought to enumerate"*, and states the
fix: **invert the question** — find every read of the property, whatever the
receiver, and make the caller allowlist the receivers. The inverted form here is
mechanical: match every `specsDir(`/`changesDir(`/`inRepoArchiveDir(` call, extract
the argument token, and allowlist argument tokens per file. Child 3's new census
is written in precisely the style that helper module was created to retire, in
the same test file.

(The two pre-existing censuses in that file are child 2's and out of scope; this
finding is about the third, added by task 1.3.)

---

## M3 — After retirement, a re-introduced flat tree is not a mixed state: doctor downgrades it to `info` with a false message, and `assertStoreLayoutForWrite` lets writes through

**Severity:** MEDIUM
**Where:** `src/core/store/layout-write-guard.ts:71-73, 79` (`publicationRecorded` = "the receipts directory is non-empty"; `mixed = declared === 2 && flatContentPresent && !publicationRecorded`) and `src/core/store/layout-migration/diagnostics.ts:75` (severity ternary on `publicationRecorded`).
**Contract contradicted:** design D12 — *"a mixed state refuses both and points at recovery"* — and D13 — *"Because Git can bypass Rasen entirely, these checks are what catch **a manually merged wrong layout**."*

`publicationRecorded` never looks at the receipt's *phase*. Once any receipt
exists — including one recording `retired` — the Store can never be classified
`mixed` again.

### Failure scenario (reproduced)

1. `team-store` migrated and retired via the real CLI; receipt phases
   `staged → published → retired`; flat tree gone; both commits made.
2. A branch that still carried flat planning content is merged (simulated by
   restoring `rasen/changes/legacy-work/` and `rasen/specs/telemetry/` and
   committing) — Git merges it cleanly, because those paths simply do not exist
   on the target.
3. `rasen store doctor team-store --json`:

```
info    store_layout_mixed_residue
        msg: This store declares planning layout version 2 and still holds the flat
             planning tree; retirement is a separate step and has not run yet.
        fix: rasen store migrate-layout team-store --retire-flat
```

   Both the message and the fix are false: retirement ran two commits ago. The
   finding is `info`, not `error`.
4. `rasen store adopt <project> --to team-store --target-line line-0.2` → **exit 0.**
   The adopt succeeds into a Store holding both layouts. D12 says it must refuse.

Following the suggested repair is worse than doing nothing: `--retire-flat`
deletes `plan.retirementSet` from the **original** plan
(`src/core/store/layout-migration/apply.ts:619-631`). Content whose name is in
that set is deleted without ever being inventoried; content whose name is not is
left behind and doctor keeps reporting `info` forever.

`readStoreLayoutState` has the receipt path in hand — reading the recorded phase,
or scoping `publicationRecorded` to *this ref's unretired run*, distinguishes the
two states.

**No test covers it.** `layout-migration-doctor.test.ts:92` builds the
mixed-residue case with *no* receipt (the `error` arm only); the only test that
migrates and retires for real (`:121`) never re-adds flat content.

---

## M4 — `rasen doctor` reports none of the nine new codes; task 10.4 is ticked and design D13 says both doctors

**Severity:** MEDIUM
**Where:** `diagnoseLayoutMigration` has exactly one call site, `src/core/store/operations.ts:2023` (inside `doctorStores`). `src/commands/doctor.ts` references neither `doctorStores` nor `diagnoseLayoutMigration`.
**Task claimed:** 10.4 — *"Report every new code from **both `rasen doctor` and `rasen store doctor`** with identical codes and repair commands in human and JSON output"* — ticked `[x]`. Design D13 repeats it verbatim.

### Failure scenario (reproduced)

One legacy flat Store, registered, `rasen/specs/billing` + `rasen/changes/fix-a`:

```
rasen store doctor probe-store --json
  store_layout_flat_requires_migration | rasen store migrate-layout probe-store --apply
  store_layout_unresolved_ownership    | rasen store migrate-layout probe-store --mapping <path>

rasen doctor --json          (cwd = the Store root)
  status:         []
  migrationDrift: []
  store_layout_* codes anywhere in the payload: none
```

A Store owner running `rasen doctor` — the obvious first move, and the command
`store doctor`'s own findings do not replace — is told nothing about flat refs,
mixed residue, or an interrupted migration.

Two secondary observations:

- The delivered delta silently narrows the contract: `specs/store-registration/spec.md:5-7`
  scopes the whole requirement to `rasen store doctor`. That is a real change to
  what D13 promised, made without a recorded decision.
- `src/core/store/operations.ts:2025` swallows every diagnosis failure with
  `.catch(() => [])`, so a Store whose layout cannot be diagnosed reports as
  healthy.

Child 7 tasks 4.1–4.9 schedule the fix (including `.catch(() => [])`, at 4.2).
The finding stands against child 3 because task 10.4 is ticked as done and the
delta text was narrowed rather than the gap being recorded as deferred.

---

## M5 — An E4 mapping entry silently overrides a provenance-resolved spec owner, with no superseded record and no shared-spec entry

**Severity:** MEDIUM
**Where:** `src/core/store/layout-migration/plan.ts:950` (`resolveSpecOwners`).
**Contract:** design D4 — *"E4 may resolve an item that is `unknown-owner`, `evidence-conflict`, or `shared-spec`"* — and *"the mapping file is an operator statement about unknowns, not a licence to relabel recorded history."*

For Changes and Archive entries the code is correct — `plan.ts:223`:

```ts
if (declaration !== undefined && decision.reason !== undefined) { … }
```

i.e. the mapping applies **only when the derived decision is unresolved**.

For specs, `resolveSpecOwners` returns on the declaration first, before the graph
is consulted at all:

```ts
if (declaration !== undefined) {
  return { state: 'assigned', projects: declaration.projects, … };
}
```

### Failure scenario

Store `elftia-store`, members `elftia`, `rocut`, `elftia-website`. Capability
`session-relay` has exactly one contributing archived Change, owned by `elftia`,
so provenance assigns it cleanly. The operator's mapping file — carried over from
an earlier draft written when the capability *was* shared — still contains:

```yaml
specs:
  session-relay:
    owner: rocut
```

Result: `session-relay` is planned into `rasen/projects/rocut/specs/session-relay`,
state `resolved`, plan `applicable: true`. The provenance disagreement is recorded
**nowhere**: `supersededEvidence` is hard-coded `[]` on every spec item
(`plan.ts:332, 366, 382`), and `sharedSpecResolutions` is only appended when
`graph.contributors.length > 1` (`plan.ts:342`), which is false here. The receipt
therefore claims an E4 assertion and never records that derived evidence said
otherwise. An identical mapping entry against a *Change* would have been ignored.

Either apply the same `decision.reason !== undefined` precondition, or record the
override as superseded evidence so it survives into the receipt.

---

## M6 — `assertStoreLayoutForWrite` is never called for two of the five surfaces task 9.1 names; the `'membership-record'` and `'layout-migration'` intents are dead code

**Severity:** MEDIUM
**Where:** `src/core/store/layout-write-guard.ts:26-31` declares five intents. Repo-wide grep for the string literals `'membership-record'` and `'layout-migration'` as *intents* returns zero call sites (the only hits are `item.kind === 'membership-record'` in `apply.ts`/`plan.ts`, an unrelated union).
**Task claimed:** 9.1 — *"call it from adopt, eject, archive relocation, **membership record writes, and the migration Module** before any write"* — ticked `[x]`.

Wired: adopt (`migration-ops.ts:471`), eject (`:1087`), archive relocate (`:1325`, `:1341`). Not wired: membership writes and the migration Module.

Membership writes instead branch on `readStoreLayoutState(...).declared === 2`
(`membership.ts:781, 847`) and never consult `.mixed`.

### Failure scenario

A migration is interrupted after the layout flip but before the receipt lands
(`store.yaml` says `layoutVersion: 2`, flat tree still present, no receipt →
`mixed === true`). A concurrent `rasen store add-project` writes a v2 project
catalog into the half-migrated Store. `assertStoreLayoutForWrite` would have
refused with `store_layout_mixed_residue` and named `--status`; the `.declared`
branch writes happily. The subsequent `--resume` then fails revalidation
(`migration_plan_stale`, destination-existence check) and the operator is left
diagnosing a stale-plan error whose real cause was an unguarded concurrent write.

Behaviourally the *schema* chosen is right; what is missing is the mixed-state
refusal task 9.1 and design D12 both promise.

---

## L7 — `layout-no-dual-write.test.ts`: the relocate case cannot fail, two membership assertions cannot fail, and the migration surface task 11.3 names is absent

**Severity:** LOW (the underlying invariants are covered elsewhere; the suite that claims to be the sweep is not one)
**Where:** `test/core/store/layout-no-dual-write.test.ts:201-213, 169-199, 31-48`.
**Task claimed:** 11.3 — *"across adopt, eject, relocate, membership writes, **and migration**."*

1. **The relocate case is vacuous.** `relocateArchive({ projectRoot: source, to: 'in-repo' })`
   on a standalone project resolves `targetDir = inRepoArchiveDir(projectRoot)`
   (`migration-ops.ts:1300`) and never addresses the Store at all. `expect(newPaths(before, after)).toEqual([])`
   and `expect(partitionPaths(after)).toEqual([])` would both pass if
   `relocateArchive` were replaced by a no-op. The one relocate path that writes
   into a Store — `--to store` — is never exercised here. (It *is* covered by
   `migration-ops-v2-partitions.test.ts:262`, which is why this is LOW rather
   than MEDIUM.)
2. **Two membership assertions are structurally unfailable.** `planningTree()`
   walks only `<storeRoot>/rasen` (`:46`). Membership records live in
   `<storeRoot>/.rasen-store/projects/`. So `expect(newPaths(before, planningTree(storeRoot))).toEqual([])`
   (`:175`) and `expect(partitionPaths(added)).toEqual([])` (`:192`) are true by
   construction for any membership write whatsoever. Only the `version: 2` /
   `version: 1` content assertions discriminate.
3. **Migration is absent** from a suite whose docblock says "whichever of adopt,
   eject, relocate, membership write, **or migration** performed the write".

---

## L8 — The CLI human/JSON parity test asserts names only; states, reasons, destinations, retained design docs, other flat refs and untracked warnings are unasserted

**Severity:** LOW
**Where:** `test/commands/store-migrate-layout-cli.test.ts:156-176`.
**Task claimed:** 9.4 — *"Render the preview as the full item table with **states, reasons, destinations**, other flat refs, retained design docs, and untracked-file warnings, **identical in content** between human and JSON output."*

The test asserts `human.stdout` contains each item's `name`, plus the target-line
id and the project id. It never asserts a state, a reason, or a destination
appears in the human rendering, and the fixture has no retained design docs, no
second flat ref, and no untracked files — so three of the six named components
are never rendered at all.

**Failure scenario:** the human renderer drops the state column (or renders every
item as `resolved`). This test stays green; JSON still carries the truth. An
operator reading `rasen store migrate-layout <id>` without `--json` sees a table
that looks fully resolved. The apply gate still refuses, so nothing is corrupted
— but the preview, whose whole purpose is that the operator sees the blockers
before applying, silently stops showing them.

(The `--apply` refusal test at `:195-201` does check that the human output names
the blocker and says `no --force`, which is why this is LOW.)

---

## I9 — `submit.ts`'s doc comment now states the opposite of the shipped behaviour

**Severity:** INFORMATIONAL (comment only; the code path is correct)
**Where:** `src/core/management-api/submit.ts:48-56`.

> *"A legacy flat Store space is a valid submission target: it has no project
> catalog, so its flat `rasen/changes` IS the content a `store:` space addresses,
> and `rasen new change --store <id>` writes exactly there."*

Task 10b.1 makes that false. The endpoint itself is safe — it spawns the real
CLI `new change --json` (`:242-252`), so the refusal propagates as
`422 cli_error` carrying `legacy_flat_store_requires_migration`. Only the comment
is stale, and it is the comment a future reader would trust when deciding whether
this bridge needs its own gate.

---

## I10 — The two reported `bootstrap.ts` read defects are real, correctly deferred, and now scheduled

**Severity:** INFORMATIONAL — **judged independently; both confirmed**
**Where:** `src/core/store/bootstrap.ts:1235` (`projectFirstBundleDeclarations`) and `:2672` (`readUnreadableRecord`).

Both call `readStoreProjectRecord` (v1 parser) directly. Against a v2 catalog,
`parseStoreProjectRecord` throws `invalid_store_project_record`
(`project-records.ts:242-245`; schema `version: z.literal(1)` + `.strict()`,
`:211-221`), which `readStoreProjectRecord` converts to `{ record: null, diagnostics: [ … ] }`
(`:390-393`). Therefore:

- `projectFirstBundleDeclarations` hits `read.record?.knowledgeBundle === undefined`
  and `continue`s: the project's **declared knowledge bundle is dropped** and a
  parse diagnostic is emitted.
- `readUnreadableRecord` sees `record === null` with non-empty diagnostics, its
  exact "exists but cannot be read" signal, and **reports a healthy v2 catalog as
  an unreadable record**.

Child 3's `evidence/caller-inventory.md` §3 records both accurately, classifies
them "later-slice owner", and states the reasoning. Child 7's tasks 1.3, 2.1, 2.2
name both sites and describe the same two symptoms. **Not child 3's to fix** —
but note H1: these are two of a larger set, and the rest of that set is currently
owned by nobody.

---

## Verified clean

These were interrogated and found sound. Listed so a later reader knows they were
examined, not skipped.

### Delta structure (interrogation area 4) — clean

`validate` gate:

```
$ node bin/rasen.js validate store-layout-v2-migration --strict
Change 'store-layout-v2-migration' is valid
```

Archive-time title check. I did **not** trust the supplied
`scratchpad/title-check.mjs`: it is hard-coded to `CHANGE = 'store-v2-compat-hardening'`
(child 7) and applies siblings in array order rather than DAG order. I wrote a
child-3 checker instead. Its baseline is **current `rasen/specs/` only**, which is
correct here: children 1 and 2 are already archived
(`rasen/changes/archive/2026-08-05-store-planning-foundation-v2`,
`2026-08-06-store-planning-scope-routing`), and children 4–7 come *after* child 3
in DAG order so they contribute nothing to its baseline. Rules mirrored from
`src/core/specs-apply.ts:290-310` (MODIFIED must exist; every baseline scenario
must reappear; REMOVED must exist; ADDED must not). Result: **ALL CLEAR**, 8
capabilities, 11 MODIFIED requirements, 1 REMOVED, 12 ADDED, zero dropped
scenarios anywhere.

- The requirement rename **is** REMOVED + ADDED at the requirement level, and
  correct: `Layout and planning binding states fail closed` (byte-matching
  `rasen/specs/store-planning-scope-routing/spec.md:78`) is REMOVED with a Reason
  and a Migration note; `… with a read-only legacy layout` is ADDED with 6
  scenarios. Four of the baseline's five scenarios are carried over byte-identical;
  the retired `Legacy flat Store keeps writing its own flat layout` is replaced by
  two new ones. No `RENAMED` block, no MODIFIED-with-a-new-title.
- Nothing else in child 3's deltas renames a requirement or a scenario in place —
  every MODIFIED block repeats all of its baseline scenarios verbatim and only
  appends.
- Child 5's delta MODIFIES the requirement child 3 ADDs. That is the
  archive-order-is-load-bearing case the planning context records, not drift.

### The legacy-flat write refusal (interrogation area 1) — enforced on every surface I could reach

Verb matrix probed against a real registered legacy flat Store through the real CLI:

| Verb | Result |
|---|---|
| `rasen list --store <id> --json` | exit 0, lists `fix-a` from the flat tree |
| `rasen show fix-a --store <id> --json` | exit 0 |
| `rasen new change … --store <id> --json` | exit 1, `legacy_flat_store_requires_migration` |
| `rasen archive fix-a --store <id> --json` | exit 1, `legacy_flat_store_requires_migration` |
| `rasen store migrate-layout <id> --json` (from the Store worktree) | exit 1 with a full preview and per-item blockers — plan works, apply refuses |
| `rasen store migrate-layout <id> --json` (from outside) | exit 1, `migration_not_checked_out` |
| `rasen store adopt … --to <id>` | `legacy_flat_store_requires_migration` (`layout-no-dual-write.test.ts:215`) |
| `rasen work migrate` | `legacy_flat_store_requires_migration` (`work.ts:118`) |

Repository-wide token sweep for `legacy_flat_store_requires_migration` across
**all** of `src/` and **all** of `test/`, not the files expected to own it:
producers are `store-planning/internal/resolver.ts:1749` (create-change),
`archive.ts:99/185/199` (finalize, both the scope arm and the
`classifyStoreRootLayout` arm for roots the frozen adapter hands back with no
scope), `layout-write-guard.ts:176` (adopt/eject/relocate), `work.ts:118`, and the
four generated-skill templates.

- **Management API, both mutation surfaces, checked:** `POST /api/v1/changes`
  spawns the real CLI (`submit.ts:242-252`), so the refusal propagates as a 422 —
  structurally, not by duplication. `/api/v1/archive` is GET-only per the method
  table (`router.ts:286`). The finalize path is child 5's.
- **The four generated-skill gate paragraphs are restored** (task 10b.2), one
  occurrence per template, and `test/core/templates/legacy-store-gate-guard.test.ts:33`
  does discriminate against deletion: each token appears exactly once per
  template, so removing the paragraph fails all three assertions. Its companion
  test at `:108` additionally pins the pre-refusal wording out.
- **Child 3's intent for the three journeys (task 10b.3) was sound.** They
  migrate and then run the lifecycle, proving the refusal once on the way past
  with real exit codes, the exact `fix` string, `git status --porcelain` empty,
  and the flat archive untouched (`store-lifecycle.test.ts:376-403`). That kept a
  live end-to-end gate over externalized planning instead of converting five
  product journeys into refusal assertions. Both e2e files pass today (12/12)
  after child 5's rewrite of the finalization tail.
- `archive relocate --to store` into a *legacy flat* Store is still permitted
  (`migration-ops.ts:1341`, `writes: 'flat'`). Deliberate, documented in the
  caller inventory as a frozen legacy adapter, and consistent with §11.4, which
  lists `new`/`apply`/`archive` and not relocation. Noted, not filed.

### Ownership never guesses (interrogation area 2) — genuinely enforced and genuinely tested

`layout-migration-provenance.test.ts:226` is the strongest test in this change:
one fixture engineered so that **every** excluded heuristic would fire —
`elftia-rework` prefixed with a member id, the checked-out branch literally named
`elftia`, `adjacent-change` beside an owned spec, `zzz-last` after an owned Change,
and `elftia` the only member with a planning role. All three unattributed items
come back `unresolved:unknown-owner` with `evidence: []` and `plan.applicable === false`.
That discriminates: any one heuristic being consulted flips a specific assertion.

Also verified: E2/E3 disagreement → `unresolved:evidence-conflict`, blocks
(`:137`); non-member owner → `unresolved:non-member-owner`, never falls back to a
member (`:154`); a non-portable id → `unresolved:unrecordable-identity` with the
offending id preserved **verbatim** in the evidence chain and no destination
(`:168`); E1 binds and outranks E2 with the loser recorded as superseded
(`layout-migration-module.test.ts:170`).

The `elftia-store` case design §11.2 names by name is honoured. Reproduced live:
a flat Store with content carrying no adoption evidence produces

```
change fix-a  → unresolved:unknown-owner  "no ownership evidence exists in any class"
spec   billing → unresolved:unknown-owner  "no ownership evidence exists in any class"
applicable: false
```

with a per-item repair naming the exact mapping key. Nothing is guessed; apply is
blocked; there is no `--force` (`plan.ts` `planGateError`, asserted at
`store-migrate-layout-cli.test.ts:201`).

### Spec provenance (interrogation area 3) — correct

A capability with two distinct contributing projects → `unresolved:shared-spec`,
`contributors: ['elftia','scene-bridge']`, repair `specs.telemetry.owner`,
`applicable: false` (`layout-migration-module.test.ts:184`). One *unresolved*
contributor propagates as `unknown` and keeps the capability `unresolved:unknown-owner`
rather than letting the remaining contributor make it look single-owner
(`provenance.test.ts:186`) — the subtle case D4 calls out, and it is tested.
`owner:` and `split:` both work and both record every contributor in
`sharedSpecResolutions` and in the receipt (`mapping.test.ts:132,157`;
`catalog-receipt.test.ts:206`). No anonymous shared spec can reach layout v2.
Mapping entries are validated against the inventory for unknown items, non-member
projects, portable ids, and E1 contradiction before any of this runs
(`mapping.ts:251-318`, called at `plan.ts:185`).

### Other spot checks

- Rollback after retirement refuses (`module.ts:308-315`, `migration_rollback_after_retirement`,
  naming Git as the recovery path) — task 6.7 satisfied.
- Publication order is catalogs → target lines → partitions → receipt → layout
  flip last as the single linearization point (`apply.ts:544-596`), with the
  receipt stamped *before* the flip so it stays inside the rollback set.
- `store-migrate-layout-cli.test.ts` is a strong suite: real CLI, real Git,
  `git status --porcelain` empty after preview, commit count unchanged after
  apply + retire, `migration_mapping_outside_store` and `migration_not_checked_out`
  both asserted.
- The one skipped test (`plan-gates.test.ts:111`) is `it.skipIf(!caseSensitiveFilesystem())`
  with a documented reason — the collision is unconstructable on NTFS — and the
  case-folding check is covered by `layout-migration-windows-paths.test.ts`
  ("produces destinations that fold onto one path on a case-insensitive host",
  passing).

---

## Gate results

| Gate | Result |
|---|---|
| `node bin/rasen.js validate store-layout-v2-migration --strict` | **PASS** — "Change 'store-layout-v2-migration' is valid" |
| Child-3 archive-time title/scenario check (own checker; supplied one rejected as child-7-scoped) | **ALL CLEAR** |
| `pnpm run build:if-stale` / `pnpm run build` | **PASS** |
| 14 core suites (`layout-migration-*` ×9, `layout-no-dual-write`, `migration-ops-flat-baseline`, `migration-ops-v2-partitions`, `planning-path-source-guard`, `legacy-store-gate-guard`) | **111 passed, 1 skipped (documented), 0 failed** |
| 14 CLI/store suites (`store-migrate-layout-cli`, `store-v2-migration-journey`, `store-migration-cli`, `membership-operations`, `migration-ops`, `declared-store-fallback`, `store-references`, `store-add-project`, `legacy-groups-removed`, `store-root-selection`, `store-identity-cli`, `store`, `vocabulary-sweep`, `management-api/space-scoping`) | **232 passed, 1 failed** |
| `test/cli-e2e/store-lifecycle.test.ts`, `test/cli-e2e/capstone-journeys.test.ts` | **12 passed, 0 failed** |

**The single failure, enumerated by name, not extrapolated:**

`test/vocabulary-sweep.test.ts > keeps the deleted workspace/initiative token
surface from regrowing` — `expected [ 'workspace_pair_unavailable' ] to deeply
equal []` (`:191`).

**Attribution: child 5, not child 3.** `workspace_pair_unavailable` is defined in
`src/core/store/finalization/record.ts:82` and `finalization/types.ts:340` — the
directory explicitly excluded from this review as child 5's in-flight work. No
child-3 file introduces it.

No environmental failure was encountered in this review's suites (the five known
`%LOCALAPPDATA%\rasen` cases live in `config.test.ts` / `config-editor.test.ts`,
neither of which is in scope here).

---

## Guard tests I judge non-discriminating

1. **`planning-path-source-guard.test.ts` third census (task 1.3)** — H2. Fails
   only for four literal argument spellings; 16 of 23 existing calls are invisible.
   The document that depends on it calls it "the enforcement".
2. **Task 7.3's dispatch coverage** — H1. `layout-migration-catalog-receipt.test.ts`
   proves the *dispatcher* dispatches. Nothing proves the *readers* use it, and
   `membership.test.ts` never builds a layout v2 Store. Two of them don't.
3. **`layout-no-dual-write.test.ts:201` (relocate)** — L7. Passes with
   `relocateArchive` stubbed out; the operation as invoked cannot address the
   Store.
4. **`layout-no-dual-write.test.ts:175, 192`** — L7. `planningTree()` walks only
   `rasen/`; membership records are in `.rasen-store/`. True by construction.
5. **`layout-migration-doctor.test.ts:121`** — a `.find(code === …).toBeDefined()`
   over a real post-migration doctor run. It cannot see the two spurious
   error-severity findings sitting beside the one it looks for (H1). An
   "expect no unexpected `error` finding" assertion in the same test would have
   caught H1 at the moment it was written.
6. **`store-migrate-layout-cli.test.ts:156` (human/JSON parity)** — L8. Names
   only; three of the six components task 9.4 enumerates are absent from the
   fixture entirely.

Discriminating, for contrast: `provenance.test.ts:226` (every excluded heuristic
made to fire), `legacy-store-gate-guard.test.ts:33` (token occurs once per
template, so deletion fails), `store-lifecycle.test.ts:376` (refusal + `git status`
empty + flat archive untouched), `layout-migration-doctor.test.ts:189`
(before/after directory snapshot of both the Store and the machine data dir),
`store-migrate-layout-cli.test.ts:208` (commit count unchanged across apply +
retire).

---

## What I could not verify

- **Child 3's true diff.** Children 3–5 share one uncommitted working tree and an
  implementer was editing `src/` throughout. Scope came from the change's own
  artifacts and from `git status --porcelain` classification, so a change made by
  child 4 or 5 inside a file child 3 also touches could be mis-attributed. Where I
  could not separate them I said so and deferred.
- **`src/core/archive.ts`'s legacy-store arm (task 10b.1) beyond a read.** The
  file is child 5's during this review. I read `storeFinalizationDiagnostic`
  (`:169-200`) and confirmed both arms are present and correct, and I exercised
  the refusal through the CLI — but I did not run the archive suites, because a
  failure there could not be attributed.
- **Non-Windows behaviour.** Everything here ran on win32. The Windows-path suite
  covers `path.posix` construction, but no POSIX host was available, and the one
  skipped test needs a case-sensitive filesystem.
- **The management API at runtime.** I traced `spaces.ts:184` and
  `session-launch-context.ts:145` to `listStoreMembers` and proved
  `listStoreMembers` returns `[]` for a migrated Store by direct invocation, but I
  did not stand up an HTTP server to observe the resulting space listing. The call
  chain is unconditional; I rate the consequence certain and the exact rendering
  unverified.
- **Whether `--retire-flat` deletes or ignores re-introduced content** in the M3
  scenario. That depends on whether the merged directory name is in the original
  `plan.retirementSet`. Both outcomes are bad and both follow from the same
  defect, so I did not split the case.
