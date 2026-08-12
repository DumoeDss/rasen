# store-finalization-outcomes-v2 — fix report, round 1

Fixer wrote neither the implementation nor the review. Input was
`evidence/review-report.md` (4 Major, 3 Medium, 7 Low), read in full, plus both
implementation reports, `archive-preconditions.md`, `tasks.md`, `design.md`,
`specs/`, and the production files each finding names.

**14 findings: 13 fixed, 1 rejected with a measurement, 0 deferred.** The
rejection is D1's *suggested repair* — the finding itself was real and is fixed
a different way.

Every production fix below was mutation-verified: the fix was reverted, the
suite re-run, and the specific failure recorded. Where a mutation made a test
pass that should have failed, that is recorded too.

---

## 1. Findings, one line each

| # | Verdict | What changed |
| --- | --- | --- |
| **M1** | Fixed | `association.ts` no longer writes `phase: 'complete'` into child 4's workspace index; the phase is preserved, and derived only when repairing a missing entry |
| **M2** | Fixed | `revalidate()`'s planning-HEAD and code-ref reachability checks no longer depend on a plan token, so they run on `--apply-plan` |
| **M3** | Fixed | The three absent preconditions — target-line catalog text, successor evidence, Change source fingerprint — are now compared before the first write; the dead `void catalogDigestSource` is gone |
| **M4** | Fixed | Three literal NUL bytes removed from `successor.ts`; repo-wide byte sweep run; a byte gate added |
| **D1** | Finding fixed, **suggested repair rejected** | The type-level proof was non-discriminating. The reviewer's `[T] extends [...]` repair does **not** fix it — measured. Repaired by widening to `never` instead |
| **D2** | Fixed | The parity suite's "module cycle" comment named a cycle that does not exist; replaced with what was actually observed |
| **D3** | Fixed | `archive-preconditions.md` §14.5 rewritten: both instructions were already satisfied, and the failure mode it predicted is not the real one |
| **L1** | Fixed | The tautology now asserts the actual behaviour (`expect(thrown).toBeUndefined()`) |
| **L2** | Fixed | All eight bare `.toThrow()` pinned to measured messages; the four-case target-line loop now pins a *different* reason per case |
| **L3** | Fixed | The determinism claim now states that it holds under the fixture's frozen clock, and why |
| **L4** | Fixed | Self-supersession is refused by name, before any Git access, instead of producing a factually false "no such Change" |
| **L5** | Fixed | The ambiguous-ref case carries a scope note saying real Git cannot produce it, and why it is still worth keeping |
| **L6** | Fixed | The journey states outright that three of four baselines are `{}`, and what actually carries the claim |
| **L7** | Fixed | `archive-preconditions.md` §14.4 now tells the shipper what to run instead of `git diff --check` |

---

## 2. M1 — and the class sweep

### The fix

`src/core/store/finalization/association.ts` wrote `phase: 'complete'` into the
machine workspace index. `'complete'` is the terminal `CleanupPhase`, and
`phaseReached()` in child 4's `workspace/cleanup.ts` is the only reader of
`entry.phase` in the repository — so `PHASE_ORDER.indexOf('complete')` being the
maximum made `phaseReached(entry, anything)` true for every target.

Fixed on child 5's side only, as instructed. The phase is now preserved
(`existing?.phase`) and derived only when repairing a missing entry, by the same
rule child 4's own bind path uses (`workspacePairId === undefined ? 'prepared' :
'bound'`). Child 4's reader and its `CleanupPhase` type were not touched.

The design already said this was right: `ArchiveAssociationPlan.expected` is
documented as *"what a REPAIR may write, all of it already true on disk at plan
time"*. A repair does not advance a lifecycle.

### Discrimination — this is the one the reviewer could not write

A new case in `finalization-association.test.ts` runs a real finalization and
then drives child 4's **production** `planCleanup` + `applyCleanup` against real
Git. The reviewer could only reach `applyCleanupPlan` with stubbed adapters.

With `phase: 'complete'` restored, the suite fails **6 of 8**, and the new case
fails on the load-bearing assertion:

```
× leaves the workspace pair CLEANABLE — child 4 still removes both worktrees
  → expected [] to deeply equal [ …(2) ]
```

`result.removed` is **empty**: both worktrees survive on disk and in Git while
the index entry that named them is deleted, and the CLI still reports success.
That is the reviewer's scenario, reproduced end to end. With the fix: 8/8 green.

### What the class sweep turned up beyond the named value

The instruction was to enumerate every field child 5 writes into another child's
record and check each reader, not just the value the reviewer named. Child 5
writes the **whole** `WorkspaceIndexEntry`, so every field is a cross-child
write. Field by field:

| Field child 5 writes | Reader | Verdict |
| --- | --- | --- |
| `phase` | `phaseReached` (`cleanup.ts:488`) — the only reader in the repo | **Broken. Fixed.** |
| `planId` | none that resolves a plan file — every `workspacePlanRelativePath` call uses `token.planId`, not `entry.planId` | **Second cross-contract value, found by this sweep.** Child 5 substituted `plan.transactionId` — an *archive transaction* id — into a field whose contract is "the workspace plan that created this pair". No reader today, so it could not cause M1's failure; changed anyway to `''`, which is exactly what child 4's own repair path writes (`workspace/module.ts:744`). Recorded as hygiene, not as a defect. |
| `planning` / `execution` | `cleanup.ts` (`recorded.root`), `binding.ts` | Safe. `ArchiveAssociationPlan.expected.{planning,execution}` is structurally identical to `WorkspaceIndexSide`, field for field. |
| `version`, `planningScopeId`, `storeUid`, `storeId`, `projectId`, `targetLineId`, `changeId` | `isEntry()` filter (`registry.ts:84`), `cleanup.ts` selectors | Safe. Note `isEntry` does not even check `storeId`, so it cannot reject on it. |
| `changeInstanceId`, `workspacePairId` | `assertIndexEntryAgrees`, `binding.ts` | Safe, and cross-checked before the write by `assertIndexEntryAgrees`. |
| `recordedAt` / `updatedAt` | none | Safe. |

I also re-derived the reviewer's other rows rather than taking them: the
`finalizedChange` block's four readers, the Archive v2 record, the `finalization`
block on the persisted plan, the `association-finalized` journal phase, the
refusal-code ledger, the CLI flags, the whitelist entry and the finalize route.
No further break. **One near-miss worth naming:** `phaseReached` is only ever
called with `'removed-execution'` / `'removed-planning'` (indices 2 and 4), so
the fact that `'planned'` appears in *both* the prep vocabulary and
`CleanupPhase` at index 0 is currently harmless. It is a latent collision in
child 4's type, not a live defect, and I did not touch it.

---

## 3. M2 — the token-gated preconditions

`archive.ts:553` calls `applyStoredPlan(plan)` with no token, and that is the
only surface a saved plan is applied through and the mutating half of the
management-API bridge. Two checks were gated on the token and therefore inert
there.

The repair does **not** thread a token into `--apply-plan`. It cannot: the
`--apply-plan <token>` argument is the *archive plan* token string, and the
typed `FinalizationPlanToken` is not stored with the archive plan. Instead the
frozen facts moved onto the plan itself, which is also where the spec says they
belong — "the plan SHALL be an immutable value whose identifier is derived from
its canonical serialization". Because they are now inside the plan, the plan id
covers them.

- **Planning HEAD** now compares against `record.planning.sourceHead`, which
  every surface carries and which is the same value `token.planningHeadOid` held.
- **Reachability** is now re-proved unconditionally whenever the record asserts
  a code merge. The token's exact-OID equality is kept as a strictly *stricter*
  check where a token exists, and runs first so the direct path keeps its more
  specific message. The safety property — the record claims `reachable: true`,
  and that claim survives a fast-forward but not a rewind — is not token-gated.

New `ArchiveFinalizationRevalidation` on `ArchivePlanFinalization` carries the
target-line catalog path/digest and the successor evidence. It is **required,
not optional**: an optional field is one an apply path can find absent and skip,
which is the shape of the defect being closed, and every producer of a
finalization block is in this same change.

### Discrimination (mutation round A and B, run separately for attribution)

| Mutation | Result |
| --- | --- |
| restore `&& token?.codeRefOid != null` on the code-merge branch | `APPLY-PLAN (no token) re-proves reachability…` fails — **nothing thrown**, the finalization published on a stale proof. The *token-carrying* "code ref moved" case still passed. |
| restore `token !== undefined &&` on the HEAD check | `APPLY-PLAN (no token) still aborts when the planning worktree HEAD moved` fails — nothing thrown. The *token-carrying* HEAD case still passed. |

The two "still passed" observations are M2's signature: the guard is real on the
surface that was tested and absent on the surface that ships. In both rounds
exactly the expected tests failed and no others.

The reachability case rewinds the ref (`git branch -f release/0.2 <before>`)
rather than advancing it — a fast-forward leaves the record's claim true, so
advancing it would not test the property.

---

## 4. M3 — the three absent preconditions

`module.ts` ended with `const catalogDigestSource = association.expected; void
catalogDigestSource;` — the digest computed at plan time was carried and
discarded. All three are now compared before the first write.

| Precondition | How | Mutation result |
| --- | --- | --- |
| target-line catalog text | re-read the frozen `catalogPath`, compare sha256 | replaced the check with the original dead code → `…refuses when the target-line catalog was re-pointed` fails, **nothing thrown**, the apply published a record naming a ref the line no longer used |
| successor evidence | re-read the blob at `foundAtRef:blobPath`, compare sha256 | forced `successor` to `undefined` → `…refuses when the successor Change is gone from the ref it was found at` fails, nothing thrown |
| Change source fingerprint | see below | removing it is what made the case fail before the fix existed — the test was written first and failed |

**The source fingerprint is worth reading in full, because I nearly dismissed it.**
The reviewer said it is checked "in the engine, but at source removal, i.e.
*after* publication". Reading the engine suggested otherwise — there is an
earlier check at `archive-engine.ts:4125` that compares the active tree's
deletion authority *before* staging. So I wrote a test instead of arguing:
plan, rewrite a file in the Change directory, apply the stored plan.

**The apply succeeded and published the entry.** The engine's comparison
protects a *deletion* ("may this tree be removed"), which is a different
question from the spec's ("is this plan still describing the Change it was made
for"). The reviewer was right about the consequence.

Fixed inside the finalization Module, comparing `fingerprintArchiveTree(paths.
active).digest` against the plan's frozen `sourceFingerprint.digest`. Deliberately
**not** in the engine: the engine's fingerprint semantics are shared with the v1
and standalone archive paths, which this change must not perturb. Only a Store v2
finalization reaches the new check.

The test asserts "before the first write" as observable state rather than as a
line number: nothing published, the source intact, and the archive-line directory
**still absent** — the transaction did not create the directory it would have
published into.

---

## 5. M4 — NUL bytes, and what the sweep covered

### The fix

`successor.ts:197` built a de-duplication key with three raw 0x00 bytes at
offsets 7021, 7044, 7066. Replaced with `\u0000` escapes — a pure encoding
change; the runtime string is byte-identical. Repaired with a Node script that
reads and writes a `Buffer`, not a text editor, because the authoring path is
what produced the problem. `git diff --no-index` now produces a normal text
diff instead of `Binary files … differ`.

### What I swept, and how

`node` reading each file as a `Buffer` and counting bytes — never a text-mode
tool, since a NUL is invisible to most editors and most greps. Checked per file:
0x00, UTF-8 BOM, U+FFFD, other C0 controls, CR, and a UTF-8 round-trip validity
test. Scope: **all of `src/`, all of `test/`, and the whole change directory —
943 files.** Attribution for anything found was settled by profiling the `HEAD`
blob with `git show HEAD:<path>` rather than assumed.

Script (reusable, absolute path):
`C:\Users\Sayo\AppData\Local\Temp\claude\E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code\e5c12824-b9c8-4192-8004-fc01432ebb53\scratchpad\nul-sweep.mjs`

### What it found

CR is present tree-wide and is this checkout's normal state (`core.autocrlf=true`);
excluded as noise. Everything else:

| File | Defect | Owner |
| --- | --- | --- |
| `src/core/store/finalization/successor.ts` | NUL ×3 | **child 5 — FIXED** |
| `src/core/store/query/module.ts` | **NUL ×2** | **child 6 — reported to the lead, and they have since repaired it (see §10)** |
| `src/core/store/layout-migration/apply.ts` | U+FFFD ×1 | child 3 — not mine, reported |
| `test/core/store/layout-migration-catalog-receipt.test.ts` | U+FFFD ×1 | child 3 — not mine, reported |
| `src/locales/ja.json` ×3, `src/locales/zh-cn.json` ×4, `test/core/pipeline-registry/run-state.test.ts` ×3 (U+FFFD), `test/core/templates/skill-templates-parity.test.ts` (BOM) | — | pre-existing; byte-identical to their `HEAD` blobs |

**Two independent children produced NUL bytes and a third produced U+FFFD.** That
is an authoring-path property, not one author's slip, and it is why the guard
below is repo-wide. A U+FFFD in particular means a character in that source is
already destroyed, not merely mis-encoded.

### The byte gate

New `test/source-byte-hygiene.test.ts` reads bytes over `src/` and `test/` and
fails on any NUL, BOM, or U+FFFD. Its exception list is **enumerated one file and
one defect at a time, with a reason** — never a prefix or glob — and is
**staleness-checked in both directions**: an entry whose file is clean fails the
suite and must be deleted, so the list cannot outlive the debt it records. That
is the pattern this repository already uses for `vocabulary-sweep`, and it is
what keeps the guard green today without hiding children 3's and 6's files.

It also asserts it scanned >500 files, so a green result cannot be an empty sweep
— the same failure mode L6 describes.

**Discrimination:** re-injecting the three NULs into `successor.ts` fails two of
its five cases, naming the file and the defect:

```
+ "src/core/store/finalization/successor.ts::nul"
```

---

## 6. D1 — the reviewer's suggested repair does not work, and I did not implement it

The finding is correct: `CarriesSpecActions<T>` distributed, so one passive
variant gaining `specActions` made the alias `boolean`, and `const X: boolean =
false` compiled. The proof was assignable in exactly the case it existed to reject.

The reviewer's repair — `type CarriesSpecActions<T> = [T] extends [{ specActions:
unknown }] ? true : false;` — was stated as "verified: with the brackets, the
mutant fails to compile". **I implemented it, applied the reviewer's own mutant
(`specActions` added to the `superseded` variant), and `tsc --noEmit` exited 0.**

The reason is structural, not incidental. Suppressing distribution changes the
question from "does ANY member carry the field" to "do ALL members carry it".
With one of three members carrying it, the union is not assignable to
`{ specActions: unknown }`, so the answer is `false` — and `const X: false =
false` compiles. The bracketed form is *worse* than the original, because it
would also stop failing if every member gained the field.

Repaired instead by keeping the distributive conditional — which asks the right
question — and widening to `never` rather than to `boolean`:

```ts
type IsExactly<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
type ExactlyFalse<T> = IsExactly<T, false> extends true ? false : never;
```

Mutation-verified in **both** directions against the repository's own compiler:

| Mutation | Result |
| --- | --- |
| `superseded` gains `specActions` | `types.ts(308,14): error TS2322: Type 'false' is not assignable to type 'never'` |
| `landed` loses `specActions` | `types.ts(311,14): error TS2322: Type 'true' is not assignable to type 'never'` |

This also closes D1's stated residual hole. An extracted `{ specActions: … }`
interface intersected into a member keeps the textual union-slice count at 1,
but it still carries the field structurally, so the type-level constant catches
it.

One more thing the finding implies and the suite did not say: `expect(CONSTANT)
.toBe(false)` proves almost nothing, because the constant is a literal in the
source and the assertion passes whatever the declared type resolves to. A third
case now pins the *spelling* in the source, so reverting the wrapper fails
immediately rather than silently at the next union edit. The suite header says
this out loud.

---

## 7. The remaining Medium and Low findings

- **D2.** Verified independently before rewriting: `binding.ts` imports only
  `dependencies`, `diagnostics`, `identity`, `registry`, `types`,
  `../identity-types`, `../planning-layout-v2` — it never reaches `module.js`, so
  the recorded `module.ts`/`binding.ts` cycle does not exist. The comment now
  records the **observed** TDZ and explicitly says it is a vitest/Vite
  SSR-transform artifact of the test graph, not production module structure, and
  tells the next reader to keep the import order and not go hunting the cycle.
  The escalation in `implementation-report-2.md` §3.6 ("a latent fragility a
  future `src/` import could hit") is wrong; I left that historical report alone
  and corrected the comment a future reader actually hits.
- **D3 / L7.** `archive-preconditions.md` rewritten. §14.5 now says plainly that
  both instructions are **already satisfied** and must not be followed twice, and
  records the real hazard instead: `findMissingCurrentScenarios` compares
  scenario **names only**, so a later sibling reproducing the same names with a
  stale body silently overwrites the earlier body with no diagnostic. §14.4 now
  states that `git diff --check` examined **none** of this change's files —
  they are all untracked, and it skips binary files besides — and gives the
  shipper `git add -A && git diff --cached --check` plus the new byte gate.
- **L1.** `expect(thrown === undefined || codeOf(thrown) === '…').toBe(true)` was
  satisfied by its first disjunct alone. The passive shape genuinely accepts the
  draft, so that acceptance is now asserted directly.
- **L2.** All eight pinned to **measured** messages, not guessed ones — captured
  by deliberately mis-pinning each site and reading the actual error back. The
  target-line loop was the interesting one: its four inputs refuse for three
  *different* reasons (traversal / path separators / trailing dot or space), and
  a shared bare `.toThrow()` could not tell one blanket rejection from three
  independent Windows checks. Each case now carries its own reason.
- **L3.** The suite header now states that `finalizationPlanId` excludes the
  transaction's instance fields but **not** the wall clock — `archivedAt` is
  inside the hashed decision — so the claim holds because the fixture freezes the
  clock, and notes that the parity suite states the same fact from the other side
  by normalizing both `archivedAt` fields.
- **L4.** `searchSuccessor` now refuses self-supersession by name, before any Git
  access. A pre-existing case asserted `result.matches` was `[]` — true, and
  precisely the defect, since an empty result is indistinguishable from "the
  successor does not exist". Three cases now cover it, including one asserting
  `git.calls` is empty (the refusal costs no repository read) and a negative
  control proving a *different* `--by` still searches normally. Mutation: with
  the guard disabled all three fail, one of them with
  `promise resolved "{ matches: [], … }" instead of rejecting`.
- **L5.** Scope note added: refnames are unique and the production adapter filters
  on `parts[0] === ref`, so the two-element list cannot arise through
  `nodeFinalizationGit`. Kept, with the reason it is still worth keeping (the
  prover must not pick one OID and continue) and the note that the ambiguity real
  Git *does* produce is excluded by construction because the catalog stores full
  ref names.
- **L6.** The journey now asserts `before.abandoned/superseded/planningOnly` each
  equal `{}` — stating the emptiness rather than letting `{} === {}` look like a
  byte-identity claim — and says what actually carries the assertion (the paired
  `existsSync` checks, plus the landed case as positive control).

---

## 8. Gate results

Taken **after** all fixes, on a tree where two sibling children were editing
concurrently.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean (exit 0) |
| `npx eslint src test` | clean (exit 0) |
| `pnpm run build` | clean (exit 0) |
| `node bin/rasen.js validate store-finalization-outcomes-v2 --strict` | `Change 'store-finalization-outcomes-v2' is valid` |
| byte/encoding sweep (927 files) | no NUL, BOM, U+FFFD or invalid UTF-8 in any child-5 file |

Suites, all run serially (`--maxWorkers=1` / `--no-file-parallelism`):

| Batch | Result |
| --- | --- |
| `finalization-{record,outcome,successor,windows-paths,reachability,plan-union,spec-sync}`, `finalize-scope`, `archive-standalone-baseline`, `archive-engine-finalization-seams`, `source-byte-hygiene`, `finalization-git-verb-guard`, `vocabulary-sweep` | **13 files, 149 passed, 0 failed** |
| `finalization-plan-token`, `finalization-association`, `finalization-surface-parity` | **3 files, 31 passed, 0 failed** |
| `archive-outcome-cli`, `workflow-whitelist`, `store-v2-finalization-journey` | **3 files, 26 passed, 0 failed** |
| `store-finalize-api` (re-run alone after a rebuild — see below) | **1 file, 9 passed, 0 failed** |
| all of `test/core/archive` | **9 files, 148 passed, 1 skipped, 0 failed** |
| child 4's `workspace-{cleanup,apply,binding,pairing}` + all `test/core/store-planning` | **7 files, 109 passed, 0 failed** — the M1 fix does not disturb child 4 |

### Every failing file, named

**Final state: none.** No suite in this change's scope fails.

Two things failed transiently during the run and both were resolved; recording
them because "it passed on the retry" is only credible with the cause named.

**1. `test/core/management-api/store-finalize-api.test.ts` — 2 failures, cause
identified, retry controlled.** Both carried
`Error: Cannot find module '…\dist\cli\index.js'` and one surfaced as
`expected 'cli_error' to be 'landed_commit_unreachable'`. This is the documented
hazard: another agent cleaned and rebuilt `dist/` mid-run, and this suite is the
most exposed in the repository because its bridge resolves `dist/cli/index.js`
directly and deliberately does not build first. The controlled retry was
`pnpm run build` followed by re-running **that file alone**: 9 passed, 0 failed.
Nothing about the suite or the code changed between the two runs.

**2. The shared tree stopped compiling mid-session, and not because of this
change.** `npx tsc --noEmit` reported 7 errors, all in **one file that is not
child 5's**:

```
src/core/store-planning/internal/resolver.ts(428,37)  TS2304: Cannot find name 'PlanningIntent'
src/core/store-planning/internal/resolver.ts(451,15)  TS2304: Cannot find name 'OpenStoreIssue'
src/core/store-planning/internal/resolver.ts(451,40)  TS2304: Cannot find name 'StoreIssueScope'
src/core/store-planning/internal/resolver.ts(459,7)   TS2304: Cannot find name 'StoreIssueScope'
src/core/store-planning/internal/resolver.ts(2184,56) TS2304: Cannot find name 'StoreIssueScope'
src/core/store-planning/internal/resolver.ts(2213,25) TS2304: Cannot find name 'StoreIssueAddress'
src/core/store-planning/internal/resolver.ts(2216,22) TS2304: Cannot find name 'StoreIssueScope'
```

Every missing symbol is child 6's issues-management vocabulary, and
`PlanningIntent` disappearing alongside them showed the file's import block was
mid-rewrite. `pnpm run build` failed on the same errors, which made every
CLI-spawning suite unrunnable for **everyone** in this worktree. Reported to the
lead; child 6 finished shortly after, the tree compiled again, and **every gate
and suite above was re-taken on the recovered tree**. The numbers in this
section are the post-recovery ones.

A third transient was a `pnpm run build:if-stale` failure that did not
reproduce — the same concurrent-rebuild hazard, resolved by a full
`pnpm run build` and a re-run.

I did **not** attempt a whole-repository `vitest run`; it is not attributable
while two siblings are editing, and the five environmental failures
(`config.test.ts` ×1, `config-editor.test.ts` ×4) remain what they were.

---

## 9. Left alone because it belongs to another child

- `src/core/store/query/module.ts` — **2 NUL bytes**, child 6. Same defect and
  same one-line repair as M4. Reported to the lead with offsets.
- `src/core/store/layout-migration/apply.ts` and
  `test/core/store/layout-migration-catalog-receipt.test.ts` — U+FFFD, child 3.
  Reported. Both are enumerated in the byte gate's exception list, which fails
  once they are repaired and the entry is not removed.
- `src/core/store/workspace/**` — child 4's, and a live fixer's. M1 was fixed
  entirely on child 5's side; `CleanupPhase`, `WorkspacePhase` and `phaseReached`
  are untouched. The latent `'planned'` collision between the prep vocabulary and
  `CleanupPhase` index 0 is noted in §2 and not acted on.
- `src/core/management-api/**` and `src/core/store-planning/types.ts` — child 6's
  live edit; not touched.
- `implementation-report.md` / `implementation-report-2.md` — historical records
  of what a previous session believed. D2's and D1's incorrect claims are
  corrected in the code comments a future reader hits, and here; the reports
  themselves were left as written.

Nothing was committed, shipped, or archived. No `git checkout --` and no
`git stash` was used at any point; the two production reverts in §2–§6 were done
by editing and re-editing.

---

## 10. One thing the shipper must not miss — and the guard has already proved itself

`test/source-byte-hygiene.test.ts` is a **repository-wide** guard added by this
change, and its exception list still names two files owned by child 3
(`layout-migration/apply.ts` and `layout-migration-catalog-receipt.test.ts`,
both U+FFFD). It is green today. It will fail — correctly — the moment either is
repaired and its entry is left behind. The fix is then to delete the entry,
never to relax the list.

**That round trip already happened once, unplanned, during this session.** After
I reported child 6's two NUL bytes, its owner repaired
`src/core/store/query/module.ts`. On the next run the guard's staleness half went
red:

```
× has no STALE exception: an entry whose file is clean must be deleted
  → expected [ Array(1) ] to deeply equal []
```

I removed the entry and the suite went green. So the mechanism is not a claim in
a comment — it fired against a real repair, named the obsolete entry, and forced
the list to shrink. A worked example of the round trip is left in the file where
that entry used to be.
