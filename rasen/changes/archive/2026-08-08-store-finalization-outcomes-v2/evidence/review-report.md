# store-finalization-outcomes-v2 — independent review report

Reviewer wrote none of this change. Read-only pass over `evidence/implementation-report.md`,
`evidence/implementation-report-2.md`, `evidence/archive-preconditions.md`,
`handoff/implementer-1.md`, `tasks.md`, `design.md`, `proposal.md`, `specs/`, the
production files they name, and every new test suite.

**Counts: 4 Major, 3 Medium, 7 Low.** Nothing here is a style opinion; every entry
carries a concrete failure scenario.

Every finding below was reproduced with a scratchpad probe or a repository command,
not inferred. Probe sources are named inline so they can be re-run.

Attribution note: nothing in child 3's files (`membership*.ts`, `layout-migration/**`,
`layout-write-guard.ts`, `store-migrate-layout.ts`, `bootstrap.ts`, `operations.ts`)
or child 4's (`store/workspace/**`, `target-lines.ts`, `commands/workspace.ts`, …) is
reported as this change's defect **except** where child 5 writes a value those files
consume — M1 is exactly that case and is child 5's write, not child 4's reader.

A child 6 implementer began editing `src/core/management-api/**` and
`src/core/store-planning/types.ts` after this review's reads. Every management-API
finding and verification below was taken against the tree in which `whitelist.ts`
holds fifteen `bounded-cli` entries and `workflow-whitelist.test.ts` asserts exactly
fifteen — i.e. the child 5 state, before child 6 extends it to eighteen. Nothing in
this report depends on `store-planning/types.ts` beyond the `finalize-change` intent
being present in the `PlanningIntent` union, which `finalize-scope.test.ts` exercises
independently. Child 5's own files (`src/core/store/finalization/**`,
`src/core/archive*.ts`) had no concurrent editor and were a stable read throughout.

---

## MAJOR

### M1 — A finalization poisons the workspace index so `store workspace cleanup` silently removes nothing

**`src/core/store/finalization/association.ts:86`** — the `association-finalized` phase
upserts the machine workspace index entry with `phase: 'complete'`, but `'complete'` is
the terminal **`CleanupPhase`** (`src/core/store/workspace/types.ts:228-235`), and
`phaseReached()` (`src/core/store/workspace/cleanup.ts:487-490`) is the only reader of
`entry.phase` in the whole repository.

`PHASE_ORDER.indexOf('complete')` is 6, the maximum, so `phaseReached(entry, anything)`
is true for every target.

**Failure scenario (reproduced):**

1. `rasen store workspace plan` + `apply` bind a pair for Change `X`; the index entry
   records `phase: 'bound'`.
2. `rasen archive X --outcome abandoned --reason '…' --yes` succeeds. The association
   phase rewrites the entry with `phase: 'complete'`.
3. `rasen store workspace cleanup --change X` is planned and applied.
   - `revalidateBeforeRemoval` (`cleanup.ts:533-536`) `continue`s past **both** targets,
     so the reachability safety pre-pass never runs.
   - `applyCleanupPlan`'s removal loop (`cleanup.ts:604-682`) `continue`s past both
     targets, so `git worktree remove` is **never called**.
   - `advance('pruned')` then `removeWorkspaceIndexEntry` deletes the entry.
   - The result is `{ phase: 'complete', removed: [], indexEntryRemoved: true }` and the
     CLI prints `Cleanup complete for Change X` (`src/commands/workspace.ts:250`).
4. Both worktree directories survive on disk **and** stay registered with Git, while the
   index entry that named them is gone. A second `cleanup --change X` now returns
   `applicable: false` with the `pair-recorded` blocker (`cleanup.ts:161-186`), so the
   pair is permanently un-cleanable through Rasen; re-preparing the same Change hits the
   destination-exists precondition.

**Probe** (`scratchpad/probe/cleanup-phase.mjs`, stubs adapters, runs production
`applyCleanupPlan` from `dist/`):

```
phase=bound      -> reaches worktree identity derivation (removal path entered)
phase=complete   -> result.phase=complete removed=[] indexEntryRemoved=true
                    gitRemoveWorktreeCalls=[]
```

**This is enshrined by a test.** `test/core/store/finalization-association.test.ts` asserts
`entry?.phase).toBe('complete')` at lines 111, 180, 213, 251, 274. Fixing the production
value requires changing those five assertions, so the suite currently guards the defect
rather than the invariant.

**Repair direction:** the workspace-phase vocabulary has no "finalized" member. Either add
one to `WorkspacePhase` (and leave `phaseReached` reading only `CleanupPhase` members), or
leave `entry.phase` untouched by the association phase and record finalization solely in
the execution-side `finalizedChange` block, which is already the durable carrier.

---

### M2 — `rasen archive --apply-plan` performs no reachability re-proof and no HEAD staleness check

**`src/core/archive.ts:553`** calls `ChangeFinalizationModuleInstance.applyStoredPlan(plan)`
with **no token**. In `src/core/store/finalization/module.ts`:

- line 909 — the planning-worktree HEAD comparison is guarded by `token !== undefined`;
- line 931 — the entire code-ref / reachability block is guarded by
  `token?.codeRefOid != null`.

Both are therefore **inert on the `--apply-plan` surface**, which is:

- the only surface a saved plan is ever applied through, and
- the mutating half of the management API bridge
  (`src/core/management-api/finalize.ts:199` builds `['archive','--apply-plan',token,'--json','--yes']`).

`ChangeFinalization.apply(token)` — the Interface method declared in
`ChangeFinalizationModule` (`types.ts:304`) and the only entry point that carries a
`FinalizationPlanToken` — has **no caller anywhere in `src/` or `test/`** (verified by grep).
The direct command path (`archive.ts:1214`) is the only one that passes a token.

**Failure scenario:** finalize `landed` in two steps, as the workflow templates instruct
(`--dry-run --save-plan` then `--apply-plan`):

1. `rasen archive X --store S --project P --target-line L --outcome landed --commit C --dry-run --save-plan --json`
   proves `C` reachable from `refs/heads/release/0.2` (tip `T`) and records
   `codeMerge: { commit: C, targetRef: refs/heads/release/0.2, reachable: true }`.
2. Someone force-moves the line: `git branch -f release/0.2 <older-commit>` (a revert, a
   reset after a bad merge, or a force-push landing in the local repo). `C` is no longer
   reachable.
3. `rasen archive --apply-plan <token> --yes` publishes the entry. `revalidate()` checks
   only the planning worktree's checked-out ref name and the canonical-spec digests. The
   Archive v2 record is written asserting `reachable: true` for a commit that is not, and
   because the outcome is `landed`, the canonical specs are synchronized on the strength
   of a proof that no longer holds.

The management API reaches the same state with a smaller window but no user in the loop:
its two subprocesses are plan-then-apply, and only the first re-proves anything.

`test/core/store/finalization-plan-token.test.ts:186-214` ("aborts when the target-line
code ref moved") passes `plan.token` explicitly, so it exercises the branch the real
`--apply-plan` surface never takes. This is the portfolio's recorded "one surface is never
proof" pattern: the guard is real on the surface that was tested and absent on the surface
that ships.

---

### M3 — Three spec-mandated revalidation preconditions are absent, one of them as dead code

**`src/core/store/finalization/module.ts:1003-1004`:**

```ts
const catalogDigestSource = association.expected;
void catalogDigestSource;
```

`specs/change-finalization-transaction/spec.md`, requirement *"Finalization is planned
immutably and applied from a revalidated token"*, enumerates what applying SHALL revalidate
before its first write. Measured against the shipped `revalidate()`:

| Spec-required precondition | Implemented? |
| --- | --- |
| planning worktree's checked-out ref | yes (`module.ts:917-925`) |
| planning worktree's commit | only when a token is passed (M2) |
| target line's code ref commit + reachability proof | only when a token is passed (M2) |
| **target-line catalog text** | **no — dead code above; `targetLine.catalogDigest` is frozen into the plan and never compared** |
| every canonical-spec target digest | yes (`module.ts:970-1001`) |
| destination's non-existence | yes, in the engine (`archive-engine.ts:3959`, `:4101`) |
| Change source fingerprint | engine, but at source removal (`archive-engine.ts:4645-4651`), i.e. **after** publication, not before the first write |
| **successor evidence** | **no — `FinalizationSuccessorEvidence` is frozen into the plan and never re-read** |

**Failure scenario (catalog):** plan a `superseded` finalization on `line-0.2`, whose
catalog names `storeRef: refs/heads/release/0.2`. Before applying, run
`rasen store target-line set-ref line-0.2 --store-ref refs/heads/release/0.3`. The apply
succeeds and publishes an Archive v2 record whose `planning.targetRef` names a ref the
line no longer uses; the frozen `catalogDigest` that exists precisely to catch this is
computed, carried, and discarded.

**Failure scenario (successor):** plan `--outcome superseded --by <instance>`; the
successor Change's directory is then deleted from the Store planning worktree and the
deletion committed. Applying still publishes `supersededBy: <instance>` pointing at a
Change instance that no longer exists on any target-line ref — the exact fabrication the
successor search exists to prevent.

---

### M4 — `src/core/store/finalization/successor.ts` contains literal NUL bytes; Git treats the file as binary

**`src/core/store/finalization/successor.ts:197`** — the de-duplication key is built with
three **raw 0x00 bytes** embedded in the source (file offsets 7021, 7044, 7066) rather than
`\0` / `\u0000` escapes:

```ts
const key = `${candidate.changeInstanceId}<NUL>${candidate.projectId}<NUL>${candidate.changeId}<NUL>${candidate.digest}`;
```

It is the only file under `src/` or `test/` with this problem (whole-tree byte scan).

**Proven, not inferred:**

```
$ git diff --no-index -- /dev/null src/core/store/finalization/successor.ts
Binary files /dev/null and b/src/core/store/finalization/successor.ts differ

$ git diff --no-index -- /dev/null src/core/store/finalization/outcome.ts
--- /dev/null
+++ b/src/core/store/finalization/outcome.ts      (normal text diff)
```

**Failure scenario:** the moment this file is committed, `git diff` / `git show` / the PR's
"Files changed" view render it as an opaque binary blob — 260 lines of the module that owns
successor resolution become unreviewable. Two knock-on effects:

- `git diff --check`, the CI whitespace gate this repository has broken on repeatedly,
  skips binary files entirely, so the implementer's recorded `git diff --check | clean`
  says nothing about this file (it says nothing about any of the ~20 new untracked files
  either — see L7).
- `grep`/`rg` skip it: `rg by-target-line src/` prints
  `Binary file src/core/store/finalization/successor.ts matches` with no line content.
  The in-repo guard suites are *not* affected (`finalization-git-verb-guard.test.ts:78`,
  `vocabulary-sweep.test.ts:99,193` all use `readFileSync(…, 'utf8')`), but every
  developer-run and CI-run text sweep over `src/` silently excludes this file.

Repair is one line: use `\u0000` escapes, or a printable separator.

---

## MEDIUM

### D1 — The type-level proof for task 1.4 has no discriminating power

**`src/core/store/finalization/types.ts:258-272`.** `CarriesSpecActions<T>` is a naked
conditional type, so it **distributes** over the `PassiveFinalizationPlan` union. If exactly
one passive variant gains `specActions`, the result is `true | false` — i.e. `boolean` — and
`const X: boolean = false` compiles.

The direct answer to the question asked: **no, `PASSIVE_PLAN_CARRIES_SPEC_ACTIONS` does not
fail if the `superseded` variant gains `specActions`.**

**Proven** (`scratchpad/probe/union.ts` / `union-baseline.ts`, `tsc --noEmit --strict`
against the repository's own compiler):

```
baseline (as shipped)                : CarriesSpecActions<Passive> = false   -> `= true` ERRORS
mutant (superseded gains specActions): CarriesSpecActions<Passive> = boolean -> compiles clean, EXIT=0
```

So `implementation-report-2.md`'s "the proof lives in `src/` where the build enforces it"
and `finalization-plan-union.test.ts:10-11`'s "the BUILD fails, and this suite never runs
at all" are both false.

**What actually catches the inline form** is the textual test at
`finalization-plan-union.test.ts:45-63`, which counts `specActions` occurrences in the union
slice and requires exactly 1. That is real, and it is the only thing standing.

**Failure scenario for the residual hole:** a future edit writes
`interface SupersededSpecCarrier { readonly specActions: readonly PreparedArchiveSpecAction[] }`
elsewhere in `types.ts` and intersects it into the superseded member
(`… & SupersededSpecCarrier`). The textual count inside the union slice stays 1, the
type-level constant resolves to `boolean` and stays assignable, `tsc` is clean, and the
suite is green — while a passive plan now structurally carries spec actions.

Repair: make the check non-distributive, e.g.
`type CarriesSpecActions<T> = [T] extends [{ specActions: unknown }] ? true : false;`
(verified: with the brackets, the mutant fails to compile).

### D2 — The documented module cycle does not exist; the real import-order sensitivity is unattributed

**`test/core/store/finalization-surface-parity.test.ts:20-24`** and
`implementation-report-2.md` §3.6 / §8.5 both state that
`workspace/module.ts` and `workspace/binding.ts` have a cycle, and §3.6 escalates it to
"a latent fragility in production module structure … a future `src/` import could hit it."

Three checks say otherwise:

1. `binding.ts` imports only `dependencies`, `diagnostics`, `identity`, `registry`, `types`,
   `../identity-types`, `../planning-layout-v2`. None of them imports `module.js`.
   `workspace/module.ts` is imported by exactly one file in the repository —
   `workspace/index.ts` (grep for `from './module.js'`).
2. A full import-graph scan of `src/` (`scratchpad/probe/cycles2.mjs`, runtime imports only,
   `import type` and all-type-specifier imports excluded) finds **9 runtime cycles, none of
   them anywhere under `src/core/store/`**, and none involving `management-api/finalize.ts`
   (its `router.ts` edge is `import type` only).
3. Loading the graph in the order the comment says is dangerous, in real ESM
   (`scratchpad/probe/cycle-order.mjs`, against `dist/`): import
   `management-api/finalize.js`, then `management-api/router.js`, then
   `workspace/module.js`, then `workspace/binding.js` →
   `assertCarrierAgreesWithScope = function`. No TDZ, no error.

**Failure scenario for leaving it as written:** the next person to touch the parity suite
reads the comment, goes looking for a `module.ts`/`binding.ts` cycle, finds none, and either
deletes the import-order constraint (re-breaking the suite for its real, still-unidentified
reason) or "fixes" a cycle that is not there. Whatever produced the observed TDZ is a
Vite/vitest SSR-transform artifact of the test graph, not production module structure, and
the comment should say what was actually observed rather than name a cycle that does not
exist.

### D3 — `archive-preconditions.md` §14.5 is stale in both halves, and its stated failure mode is not the real one

**The corrections landed in children 6 and 7; the shipper-facing document was not
updated.** That distinction is the whole finding. `archive-preconditions.md` is
unchanged on disk (mtime 2026-08-07 21:26, text quoted below verbatim), while the
facts it describes were fixed in the sibling changes:

- `store-scoped-issues-management/tasks.md:129` now reads *"now that
  `store-finalization-outcomes-v2` has landed and `store_v2_finalization_unavailable`
  no longer exists"*.
- `…/tasks.md:100` and `…/proposal.md:28` both record the whitelist baseline correctly
  — "**fifteen** after `store-finalization-outcomes-v2` added `finalize-change`, so
  this change extends it to eighteen … never by relaxing the list to a prefix or a
  tier-wide exemption".
- `…/design.md:213-226` carries a section titled *"What this change takes from child 5,
  which has now landed"*.
- A repository-wide grep for `store_v2_finalization_unavailable` finds **zero** hits in
  children 6 and 7 (and zero in `src/`; the only live references are three
  documentation sites in `test/`).

So a shipper who follows §14.5 as written will go looking for a stale task that is
already fixed and a delta that already applies. Update or delete §14.5; do not act on it.

I re-derived the whole projection with production's own `findSpecUpdates` + `buildUpdatedSpec`
(`scratchpad/probe/project-specs.mjs`), applying each unshipped sibling's delta into a copy of
`rasen/specs/` in DAG order — deliberately not `scratchpad/title-check.mjs`.

- §14.5 says child 6's `tasks.md` "still contains task 11.6, which asserts that archiving
  still reports `store_v2_finalization_unavailable`". It does not:
  `rasen/changes/store-scoped-issues-management/tasks.md:129` already reads *"now that
  `store-finalization-outcomes-v2` has landed and `store_v2_finalization_unavailable` no
  longer exists"*. Already corrected.
- §14.5 says child 6's `management-http-api` delta "has to be refreshed after this change
  archives, or its own archive will be refused for scenario drift". It does not: applied in
  DAG order (3 → 4 → 5 → 6 → 7), child 6's delta applies **cleanly**
  (`management-http-api (update) added=2 modified=1`), and its MODIFIED body is already a
  strict superset of child 5's — it carries the finalize path in both the served-endpoint
  and mutating-endpoint lists.
- The stated failure mode is wrong anyway. `specs-apply.ts:404-409` (`findMissingCurrentScenarios`)
  compares **scenario names only**. A later sibling reproducing the same eight scenario names
  with a stale *body* is accepted silently and overwrites the earlier sibling's body — a
  silent revert, never an `archive_spec_update_failed`. That is the risk the note should
  describe, and it is the risk that will exist for any future edit to this shared requirement.

**Failure scenario:** child 6's `management-http-api` MODIFIED block is edited later (say to
add a Store aggregate endpoint) from a copy taken before child 5 archived. Every scenario
name still matches, the archive succeeds, and the canonical spec silently loses the
change-finalization endpoint from both endpoint lists — with no diagnostic anywhere.

---

## LOW

### L1 — `finalization-record.test.ts:257-259` is a tautology

```ts
expect(thrown === undefined || codeOf(thrown) === 'finalization_record_invalid').toBe(true);
```

Passes if nothing is thrown, which is what the passive branch does. The test named
*"refuses a record whose pair id does not derive from its own identities"* therefore asserts
nothing for the passive shape. The landed half immediately below (line 261-277) is real.
Either drop the passive half or assert the actual behaviour (`expect(thrown).toBeUndefined()`
with a comment saying the passive schema has no execution worktree to cross-check).

### L2 — Eight bare `.toThrow()` assertions do not pin which refusal fired

`finalization-outcome.test.ts:227`; `finalization-record.test.ts:420,442`;
`finalization-successor.test.ts:193`; `finalization-windows-paths.test.ts:113,114,153,169`;
`finalize-scope.test.ts:468`. Each would pass on an unrelated `TypeError` from a refactor.
All are paired with a specific assertion elsewhere in the same describe block, so the
practical exposure is small, but for a repository whose recorded failure mode is
"guard tests that do not guard" these are the cheapest ones to tighten.

### L3 — `finalization-plan-token.test.ts`'s determinism claim holds only under a frozen clock

The suite header (lines 6-10) states "PLANNING the same inputs twice produces the same
identifier". In production it does not: `finalizationPlanId` (`module.ts:1071-1078`)
excludes `plan.createdAt` and `archivePlan.createdAt`, but `recordDraft.archivedAt` and
`archivePlan.finalization.record.archivedAt` both carry the same wall-clock instant and are
**inside** the hashed decision. The fixture's `withDeterministicFinalizationClock` is what
makes the assertion true. The surface-parity suite already concedes this by overwriting both
`archivedAt` fields in `normalizePlan` (`finalization-surface-parity.test.ts:77,79-81`).
Not a code defect — `archivedAt` is a recorded fact — but the two suites state
contradictory properties and a reader will believe the stronger one.

### L4 — Self-supersession produces a misleading diagnostic

`successor.ts:187-191` filters out `candidate.changeInstanceId === input.excludeChangeInstanceId`
before counting matches, and `module.ts:154` then skips the canonical validator because the
search produced nothing. A user who passes their own Change instance to `--by` is told
*"No committed Change metadata under this Store's target-line refs derives the Change
instance 'ci_…'"* — which is false; it derives that Change, the one being finalized. The
canonical validator's self-supersession rule, which would say so correctly, is never
reached. One extra branch in `resolveSuccessor` would name the real problem.

### L5 — `finalization-reachability.test.ts:155-173` guards a branch real Git cannot produce

The "ambiguous code ref" case seeds two `FinalizationRefTarget`s with the same `ref`. The
production adapter builds that list from
`git for-each-ref --format=… <ref>` and then filters `parts[0] === ref`
(`dependencies.ts:167-181`). Refnames are unique in a repository, so the filtered list has at
most one element and `target_line_ref_unresolved`-for-ambiguity is unreachable through
`nodeFinalizationGit`. The test proves the pure function's behaviour, not a reachable
production state. Worth a comment saying so, or a note that the ambiguity Git actually
produces (short-name `refs/heads/x` vs `refs/tags/x`) is excluded by construction because
the catalog stores full ref names.

### L6 — The journey's "content-hashed before and after" is an empty baseline for three of four Changes

`test/commands/store-v2-finalization-journey.test.ts:203-207` captures `hashTree` of three
project `specs/` directories that do not exist yet (the shared workspace fixture seeds no
canonical specs — `test/helpers/store-workspace-fixture.ts` never writes under `specs/`), so
`before.abandoned`, `before.superseded` and `before.planningOnly` are all `{}`. The
comparison at lines 408-415 still discriminates, because a leaked passive spec-sync would
CREATE `<capability>/spec.md` and the paired `existsSync` assertions say so explicitly, and
the landed case at line 243-245 is a genuine positive control proving the pipeline can write
there. But `{} === {}` is not "byte-identical across a completed finalization" in the sense
`finalization-spec-sync.test.ts:371-375` means it — that suite asserts the baseline is
non-empty first, and the journey should borrow that one line.

### L7 — `git diff --check clean` is vacuous for this change's new files

`git status --porcelain` reports every new file this change adds as untracked (`??`):
`src/core/archive-accounting-v2.ts`, `src/core/management-api/finalize.ts`, all twelve
`src/core/store/finalization/*.ts`, and sixteen new `test/**` files. `git diff --check`
inspects the working-tree diff of *tracked* files, so the gate recorded in
`implementation-report.md` §4 and `implementation-report-2.md` §5 examined none of them.
That is how M4's NUL bytes survived the encoding audit — and the audit in
`implementation-report-2.md` §5 covered "all 20 files this implementer created", while
`successor.ts` was created by implementer-1 and re-audited by nobody. Re-run the whitespace
and encoding gates against `git add -A -n`-scoped content, or against the file list directly,
before committing.

---

## Guard-discrimination table

Verdict on each new suite's *refusal and invariant* assertions. "Sound" means a wrong or
absent refusal would fail the test; "weak" means it would not.

| Suite / assertion | Discriminating? | Basis |
| --- | --- | --- |
| `finalization-outcome` — all 6 refusal families | **Sound** | `refusalFor()` (l.32-39) throws `expected a refusal` when nothing is raised, and every case pins `finalizationCode` and/or `diagnostic.target`. Pure function, no adapters, so an I/O reach would surface as a different error. |
| `finalization-outcome:227` cross-Store successor | Weak | bare `.toThrow()` (L2) |
| `finalization-reachability` — 7 refusals | **Sound** | each pins a *distinct* code (`landed_commit_unresolved` / `target_line_ref_unresolved` / `landed_commit_unreachable` / `landed_proof_unavailable`), and l.202 explicitly asserts the indeterminate case is **not** collapsed into unreachable. In-memory adapter makes each state constructible. |
| `finalization-reachability:155-173` ambiguous ref | Sound-but-unreachable | see L5 |
| `finalization-successor` — `successor_scope_unverified` ×2, `successor_ambiguous` | **Sound** | codes pinned; l.313-338 proves an unsearched ref blocks a "not found" conclusion, which is the load-bearing property |
| `finalization-successor:193` | Weak | bare `.toThrow()` |
| `finalization-record` — `target_line_mismatch`, `landed_proof_unavailable`, `finalization_record_invalid` (passive-with-actions), `workspacePairUnavailable` | **Sound** | codes pinned plus message/`expected` content |
| `finalization-record:257-259` pair-id derivation (passive) | **NOT discriminating** | tautology, see L1 |
| `finalization-record:420,442` serializer refusals | Weak | bare `.toThrow()` |
| `finalization-spec-sync` — digest mapping + precondition blocks | **Sound** | exact `toEqual` on all four digest shapes; refusals pin code **and** `expected` string |
| `finalization-spec-sync` — byte-identity (task 6.7) | **Sound; the claim is real** | `hashTree` (`store-finalization-fixture.ts:272-294`) reads file bytes and computes sha256 per file — it is content hashing, not "no diff reported". l.372-375 asserts the baseline map has exactly two entries, so an empty map cannot satisfy it trivially. Reinforced structurally by `plan.archivePlan.specActions).toEqual([])` and `'specActions' in plan).toBe(false)`. |
| `finalization-plan-union` — type-level constants | **NOT discriminating** | proven by `tsc` probe, see D1 |
| `finalization-plan-union:45-63` — source-text count | **Sound for the inline form**, blind to an extracted interface | see D1 |
| `finalization-plan-token` — `finalization_plan_stale` ×3 | **Sound for the token path only** | all three pass `plan.token`; the surface that ships (`--apply-plan`) takes the token-less path where two of the three checks are inert — see M2 |
| `finalization-plan-token` — determinism | **Sound under the fixture clock**, overstated in prose | see L3; negative controls (different reason, different outcome) are present and real |
| `finalization-plan-token` — lock protocol (4 cases) | **Sound** | mutual exclusion measured from a separate async context with a short deadline; independence proven by completion rather than by absence of error |
| `finalization-association` — recovery matrix | **Sound for ordering/idempotence** | before/during/after injection each assert a distinct end state; mutation-verified per §4 |
| `finalization-association` — `phase: 'complete'` (5 sites) | **Guards the defect** | see M1 |
| `finalization-windows-paths` — reserved names, non-ASCII alias, flavors | **Sound** | exact expected strings and named regexes; `.toThrow(/reserved as a Windows device name/)` and `/canonical lowercase kebab id/` pin the reason |
| `finalization-windows-paths:113,114,153,169` | Weak | bare `.toThrow()` |
| `archive-engine-finalization-seams` — seam 1 (destination override) | **Sound** | `.toThrow(/same-volume rename/)` plus positive control that the default composition is unchanged |
| `archive-engine-finalization-seams` — seam 4 (suffix matching) | **Sound** | four negative cases including `${DATE}-other--<hex>` and a non-hex trailing segment |
| `archive-engine-finalization-seams` — seams 2, 3 | **Sound (mutation-verified)** | §4's row 7 reverted `finalizeArchiveAssociation` and 10 tests failed while standalone/v1 stayed green |
| `finalize-scope` — 5 refusals | **Sound** | `codeOf()` (l.218-221) **rethrows** a non-`PlanningScopeError`, so a wrong error type fails loudly rather than being coerced |
| `finalize-scope:468` | Weak | bare `.toThrow()` |
| `archive-outcome-cli` — every refusal | **Sound; strongest suite in the change** | real Commander program in a child process; each case asserts `status[0].code` **and** that `archiveLine` does not exist and/or `changeDir` survives, so "the code never fired" and "a different code fired" both fail |
| `archive-outcome-cli:107-125` flag-parsing matrix | Slightly loose | `toMatch(/^finalization_outcome_/)` accepts either `_required` or `_invalid`; adequate, since each row's contradiction is unambiguous |
| `store-finalize-api` — 401 / 405×3 / 400×2 / 409 | **Sound** | real loopback HTTP against the real router; the 409 case additionally hashes the change directory before and after, proving no mutating subprocess ran |
| `store-finalize-api` header claim "never completed from a query filter, a session, or the launch project" | Not asserted | no test supplies a partial path; the property rests on `matchStoreFinalizePath` requiring exactly 8 segments. `launchProjectRoot` is set to the bound checkout, so a fallback would be invisible. Cheap to add: POST a 6-segment path and assert 404. |
| `store-finalize-api` — cap-1 `409 busy` | Not asserted | no coverage |
| `finalization-surface-parity` | **Sound** | the CLI's `--json` emits the *whole* plan (`archive.ts:1293` `finalizationPlan: plan`, including `archivePlan` and its ordered action list), so the byte comparison is over real content, not a projection. Normalization is confined to `transactionId`, `planHash` and the two `archivedAt` fields. |
| `store-v2-finalization-journey` — landed-only spec sync | **Sound**, framing loose | positive control at l.243-245; see L6 |
| `store-v2-finalization-journey` — legacy entry untouched (13.4) | **Sound** | byte hash plus four explicit `not.toHaveProperty` assertions |
| `archive-standalone-baseline` — v1 path inert | **Sound** | asserts `phaseFingerprints` has no `association-finalized` key, which is a positive statement about the v1 journal rather than an absence of error |

**Direct answer on the ~160 unverified assertions.** The implementer's caution was warranted
but the outcome is better than feared: of the suites named as unverified, **one is genuinely
non-discriminating** (`finalization-plan-union`'s type-level half — D1), **one contains a
tautology** (`finalization-record:257-259` — L1), **eight assertions are bare `.toThrow()`**
(L2), and **one whole suite guards a defect rather than an invariant**
(`finalization-association`'s `phase: 'complete'` — M1). Everything else in the pure-function
suites pins a specific refusal code, a specific `expected`/`actual` value, or an exact string,
against a function whose inputs the test fully controls — a changed behaviour fails them.
The composed `finalize-scope` suite is stronger than its "unverified" label suggests because
`codeOf` rethrows unknown error types. The long journey's central claim is protected by a
positive control. The API suite's non-spawning cases are real HTTP round-trips and do
discriminate for route existence and method admission.

I re-ran the eight pure suites on the current tree: **8 files, 106 tests, 0 failed.** They
pass, which — as the brief says — proves nothing on its own; the table above is the answer.

---

## The four self-found defects: are the fixes complete?

| Defect | Fix real? | Complete? |
| --- | --- | --- |
| **D1 `parseAssociation` allow-list** | Yes — `resolver.ts:276-289` enumerates `finalizedChange` individually with its reason and parses it into `finalizedChangeId` explicitly **not** as scope evidence (`:317-322`). The allow-list was not relaxed to a prefix rule. | **Yes for the field it names**, and the class sweep below found no second strict reader that rejects it. |
| **D2 plan-id transaction normalization** | Yes — `module.ts:1085-1088` substitutes the transaction id at any depth rather than deleting the action list. Mutation-verified. | Yes, subject to L3's clock caveat. |
| **D3 landed-proof re-raise** | Yes — `module.ts:189` raises the collected blocker before `buildArchiveV2RecordDraft` can replace it. Mutation-verified, and pinned end-to-end by `archive-outcome-cli.test.ts:350-374` **and** `store-finalize-api.test.ts:261-288` (two surfaces). | Yes. |
| **D4 successor-arm skip** | Yes — `module.ts:154` skips the canonical validator exactly when the search produced no scope. | **Incomplete in one corner**: the self-supersession case now falls into the same branch and gets a message that is factually wrong (L4). |

### The D1 class: every strict reader child 5's new fields must pass

D1 is a class, not an incident. I enumerated every reader of every document child 5 writes
or extends and checked each one:

| New field / value | Written at | Readers found | Verdict |
| --- | --- | --- | --- |
| `finalizedChange` block in `.rasen/planning-binding.json` | `association.ts:213-218` | `store-planning/internal/resolver.ts:263` `parseAssociation` (strict allow-list) | **Fixed.** Enumerated at `:288`. |
| " | " | `store/workspace/binding.ts:118` `parseBindingFact` | **Safe.** Reads only known keys; ignores extras. Note it is called on the *original* text at `association.ts:96`, and on a replay it sees a document that already contains `finalizedChange` — still safe for the same reason. |
| " | " | `store/workspace/cleanup.ts:353-361` | **Safe**, and deliberately so: the association file is excluded from the untracked-file precondition by name, and no digest of it is frozen or revalidated (`plan.ts:748` digests the content the plan will *write*, not what is on disk). |
| " | " | `root-selection.ts:1097` | **Safe.** `existsSync` only. |
| `phase: 'complete'` in the machine workspace index | `association.ts:86` | `cleanup.ts:487-490` `phaseReached` — the **only** reader of `entry.phase` in the repository | **BROKEN — see M1.** This is the same class as D1: a strict consumer that had to learn a new value and did not. The reader here is an ordered enum rather than a key allow-list, which is why the type system accepted it (`WorkspacePhase` includes `CleanupPhase`). |
| Archive v2 `archive.json` record | `archive-accounting-v2.ts` | `parseArchiveV2` (`finalization-v2.ts:411`); `module.ts:880` (v1 records skipped, never upgraded); `store/layout-migration/evidence.ts:36` | **Safe.** The v1 accounting reader/verifier is not reached for a v2 plan — the engine dispatches on `plan.finalization` presence (`archive-engine.ts:4532-4544`), never on file content. |
| `finalization` block on the persisted `ArchivePlan` | `module.ts:229-241` | `loadStoredArchivePlan` (`archive-engine.ts:2021`) | **Safe.** `hasOnlyKeys` is applied to the *envelope* (`:2035-2042`), not to the plan body. |
| `association-finalized` journal phase | `archive-engine.ts:4624` | `JOURNAL_PHASE_ORDER` (`:2233-2246`), resume table, `sourceRemovalJournalPhase` (`:4636`) | **Safe.** Comparison is by name via the map, so an older journal recording `source-removed` still resumes correctly; `archive-standalone-baseline.test.ts:197-199` pins that a v1 journal gains no such key. |
| `workspace_pair_unavailable` and 17 other refusal codes | `types.ts:327-346` | `test/vocabulary-sweep.test.ts` token ledger | **Fixed** (`vocabulary-sweep.test.ts:187`), found only by the full-suite run — exactly the rule the portfolio wrote down. The other 17 codes do not match the sweep's `(workspace\|initiative)_` pattern, so no further ledger entry is due. |
| `--outcome/--reason/--by/--by-target-line/--commit` | `cli/index.ts:378-382` | `completions/command-registry.ts:223`; `src/locales/{en,ja,zh-cn}.json:1366` | **Safe.** All three locale trees carry `by-target-line`; the completions registry carries it. |
| `finalize-change` bounded-cli op | `management-api/whitelist.ts:73` | `workflow-whitelist.test.ts:45-71` | **Safe** — read in full, not taken on the report's word. See the note below. |
| finalize route admission | `router.ts:294` (POST-only), `:433` (`isManagementPath`) | `matchStoreFinalizePath` | **Safe**, including the trailing-slash case — see the note below. |

One reader in that table is broken. That is the finding this class was worth looking for.

### The whitelist entry and the finalize route, reviewed as they stand — both sound

Checked directly rather than accepted from `implementation-report-2.md` §8.3, because
this is child 5's half and stays child 5's regardless of what child 6 does on top of it:

- **`whitelist.ts:73`** adds `'finalize-change': { tier: 'bounded-cli', op: 'finalize-change' }`
  as the fifteenth entry, and the file header enumerates it individually **with its
  reason** at `:47-49` ("a read-only plan followed by one bounded apply, both through
  the CLI") and again at `:56` ("the finalization bridge only `finalize-change`"). The
  list was extended by enumeration; no prefix rule, no tier-wide exemption.
- **`workflow-whitelist.test.ts:45-66`** pins the merged `bounded-cli` tier to exactly
  fifteen named ops with `finalize-change` listed individually — a sixteenth entry fails
  it. `:67-71` additionally asserts `getBoundedCliEntry('finalize-change')` has the
  bounded tier **and** that `getSupervisedEntry('finalize-change')` is `undefined`, so
  the op cannot be silently promoted to a supervised long-runner. Both discriminate.
- **`finalize.ts:319-326`** re-checks `getBoundedCliEntry('finalize-change')` at request
  time and 500s if it is missing, so the whitelist is the single admission source rather
  than a parallel claim.
- **`router.ts:294`** admits POST only; GET/PUT/DELETE on the finalize path are 405
  (asserted by `store-finalize-api.test.ts:156-165`). **`:433`** puts the path in
  `isManagementPath`, so it is inside the bearer-auth boundary (asserted by the 401 case).
- **Trailing-slash consistency, specifically checked** because child 5's own MODIFIED
  requirement promises it: the handler's `pathname` is already normalized at `:527`
  (`const pathname = stripOneTrailingSlash(rawPathname)`), and both `isManagementPath`
  and the `:764` handler match against that same normalized value. `POST /…/finalize/`
  therefore authenticates, admits, and dispatches identically to the canonical form —
  there is no auth-passes-then-404 split. No defect.

The one gap here is coverage, not correctness: nothing asserts the cap-1 `409 busy`
path, and nothing POSTs a *partial* scope path to prove it is not completed from the
launch project (see the discrimination table).

---

## §14 — independent results

### §14.1 — CONFIRMED, and reproduced

Method: copy `rasen/specs/` to a scratch baseline, then apply each unshipped sibling's delta
into it in DAG order using production's own `findSpecUpdates` + `buildUpdatedSpec` — the exact
pair `archive` runs, so `normalizeRequirementName`, `findMissingCurrentScenarios` and the
`RENAMED → REMOVED → MODIFIED → ADDED` order in `specs-apply.ts:252-321` are the real ones.
Script: `scratchpad/probe/project-specs.mjs`. I did **not** use `scratchpad/title-check.mjs`.

```
baseline only            -> child 5: FAIL store-planning-scope-routing MODIFIED
                            "Layout and planning binding states fail closed with a
                             read-only legacy layout" - not found
child 4 only, then 5     -> same FAIL (child 4 is not the introducer)
child 3 -> child 4 -> 5  -> ALL 8 capabilities apply cleanly
```

Archive order 3 → 4 → 5 is load-bearing exactly as recorded, and the failure names exactly
that one requirement.

### §14.2 — CONFIRMED, re-derived independently

Against the effective baseline (today's `rasen/specs/` + children 3 and 4 applied in DAG
order), child 5's projection is clean for all eight capabilities:

```
change-finalization-outcomes  (create) added=7
change-finalization-transaction (create) added=8
cli-archive                   (update) added=2 modified=3
management-http-api           (update) added=1 modified=1
opsx-archive-skill            (update) added=1
opsx-ship-command             (update) added=1
specs-sync-skill              (update) added=1
store-planning-scope-routing  (update) added=1 modified=1
```

Five MODIFIED requirements total — 3 in `cli-archive`, 1 in `management-http-api`, 1 in
`store-planning-scope-routing` — matching §14.2's table exactly. Four match today's canonical
byte for byte; the fifth requires child 3. **No scenario drift anywhere.** Two facts §14.2
does not mention and the shipper will want: child 5 also ADDs requirements to five existing
capabilities, and the two NEW capabilities are what §14.3's Purpose work applies to.

Downstream check, since archive order is load-bearing: continuing the same projection through
children 6 and 7 also applies cleanly (child 6: 7 capabilities; child 7: 4). So the whole
remaining DAG is spec-consistent as the tree stands.

### §14.5 — WRONG on both claims; see D3

Both halves are already satisfied in the tree — verified by grep across children 6 and 7,
not re-derived from scratch — and the failure mode the note predicts
(`archive_spec_update_failed` for scenario drift) is not the one that applies. The real
hazard for this shared requirement is a silent body revert, because the engine matches
scenario *names* only.

Confirming the claim relayed to me, that child 5's implementer corrected child 6's stale
assertions and left its `management-http-api` delta untouched as already byte-correct:
**both halves check out.** Child 6's delta applies cleanly after child 5 in DAG order
(`management-http-api (update) added=2 modified=1`) and its MODIFIED body is a strict
superset of child 5's — it already carries the change-finalization path in both the
served-endpoint and mutating-endpoint lists and in the "every mutating endpoint routes
through a CLI subprocess" scenario. Leaving it untouched was the right call.

What was *not* done is updating `archive-preconditions.md` itself, which is the document
the shipper reads. It still instructs them to do both corrections. That is D3.

---

## What I could not verify, and why

1. **`revalidate()`'s catalog-digest and successor-evidence gaps under a real concurrent
   edit.** I read the code and confirmed the checks are absent (M3), but I did not construct
   a live fixture that re-points a target line between plan and apply, because doing so needs
   a new test file and I am read-only. The absence is unambiguous from `module.ts:1003-1004`
   and from the fact that `FinalizationSuccessorEvidence` is never read after `plan()`.
2. **Whether the M1 cleanup failure reproduces through the real `rasen store workspace
   cleanup` CLI**, as opposed to through `applyCleanupPlan` with stubbed adapters. The probe
   drives production `applyCleanupPlan` from `dist/` and shows `git worktree remove` is never
   called and the index entry is deleted; the remaining CLI layer only builds the plan and
   prints the result. A real end-to-end reproduction needs a fixture the repository does not
   have (no suite currently runs cleanup after a finalization) and a test file I may not write.
3. **The true cause of the parity suite's import-order sensitivity.** I proved the recorded
   cause is not it (D2), but reproducing the original TDZ requires running the suite with the
   imports reordered, which means editing `test/`.
4. **The full suite on a quiescent tree.** Two fixers are editing this worktree; per the
   brief and `implementation-report-2.md` §6 the whole-repo run is not attributable right now.
   I ran the eight pure finalization suites (106 passed, 0 failed) and every finding above is
   independent of the CLI-spawning suites' current state.
5. **`finalization-git-verb-guard`'s coverage of `successor.ts` after M4 is fixed.** The guard
   uses `readFileSync(…, 'utf8')` so it scans the file today; I did not check whether any
   *other* tooling in CI (lint config, format check, `.gitattributes` handling) treats the
   binary classification differently.
