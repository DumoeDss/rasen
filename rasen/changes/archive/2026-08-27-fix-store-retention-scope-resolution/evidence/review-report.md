# Independent review — three-change batch (2026-08-26)

Reviewer: reviewer-1 (independent non-author, dispatched report-only mode).
Scope: `fix-store-retention-scope-resolution` (A), `fix-store-workspace-pair-transactions` (B),
`rehearse-legacy-store-layout-migration` (G2R), reviewed together as they sit in one working tree
on `dev/0.2.0`.

What I did: read all three changes' proposal/design/tasks/spec deltas; read the full `git diff`
of every owned file plus the three untracked test files; diffed every MODIFIED spec requirement
against the canonical spec; ran `rasen validate` on all three (all valid); ran the three NEW test
suites in one invocation on the joint tree — **3 files, 40 tests, all passed, exit 0, 107s**
(`workspace-repreparation`, `layout-migration-empty-store`, `store-scope-resolution-e2e`).
Per the dispatch, the 6/7-failing `archive-consumer-integration` suite and the documented machine
baseline cluster are NOT attributed to any of these changes, and no fixes were applied.

Severity vocabulary: Blocker / Major / Minor / Trivial per the canonical scale.

---

## Change A — fix-store-retention-scope-resolution

13/16 tasks (group 6 deferred by operator decision, correctly recorded as open obligations).
Spec delta: new capability `store-scope-resolution`, all ADDED — no omitted-scenario risk.
Scope check: diff touches only owned files (resolver.ts, store-planning dependencies/testing,
store/identity.ts, two fixture suites + new e2e suite + finalize-scope seam line). CLEAN.

### Findings

**A-1 (Major, design-vs-code).** Design.md (D2 + Risks) promises the repository-identity probe is
"only on path-miss, **cached per invocation**". The cache exists as a caller-owned option
(`RepositoryIdentityCache`, `probeThroughCache`, `src/core/store/identity.ts:346-372,441-457`) and
is test-covered — but **no production caller ever constructs or passes one**: grep for
`repositoryIdentityCache` outside `identity.ts` hits only `test/core/store/identity.test.ts`.
Worse, `resolveStoreBinding` (`src/core/store/identity.ts:715-720`) copies only `globalDataDir`
and `repositoryIdentity` from its input into the options it forwards and **silently drops
`repositoryIdentityCache`**, even though `ResolveStoreBindingInput` publicly includes it via
`StoreRootMatchOptions` — a caller that passes a cache there gets no caching. Net: in production
every path-miss match re-spawns git twice (root + entry) per call, at every call site
(`config-context.ts:91`, `learned-skills/context.ts:449`, `root-selection.ts:527/628/697`).
Impact is bounded (probe runs only when the root carries Store metadata and uniquely matches an
entry), but this is precisely the "stated mitigation that does not exist in code" class the
review was asked to hunt: the mechanism was built after the mid-run catch, and then never wired
into any invocation. Fix is small: thread one `Map` per command invocation (and stop dropping the
option in `resolveStoreBinding`).

**A-2 (Major, fail-closed divergence from own design + delta; the most serious finding in this
batch).** The planning-bound gate's inconsistency refusal is sibling- and order-dependent.
`assertProjectPlanningBound` (`src/core/store-planning/internal/resolver.ts:1148-1196`) iterates
every recorded pair for the store+project(+line) and **`return`s (admits the write) on the first
pair whose marker and association fully agree**. Disagreements collected from OTHER pairs are then
discarded, and pairs enumerated after the agreeing one are never read at all. Design D3 says "Any
disagreement among those sources is still a fail-closed conflict naming both sources"; the
change's own delta scenario "Inconsistent pair evidence refuses" says "WHEN an index entry,
marker, or association for the selected project disagrees … THEN the command refuses as a
conflict". The code satisfies that only in the single-pair shape — which is the only shape any
test covers (`store-planning.test.ts` gate tests and the e2e doctored-marker test both record
exactly one pair). Multiple pairs for one project+line is the NORMAL machine state (one index
entry per Change; elftia-store had ~40 concurrent planning branches), so "one healthy pair + one
pair with a contradicting marker" silently passes the gate. Mitigating: the seat's OWN marker
still conflicts in the fact merge, so only non-seat sibling pairs can be skipped, and passing may
even be the desirable semantics (an unrelated Change's corrupt marker arguably should not block
the whole project) — but then the delta scenario overpromises. **Either the code or the delta
must move before archive**: as written, archive will pin a testable scenario the shipped code
does not satisfy in a reachable state. If the current behavior is chosen, reword the scenario
(e.g. "WHEN every recorded pair for the selected project disagrees…" / scope it to the pair that
would satisfy the gate) and add a multi-pair mixed test either way.

**A-3 (Minor, undocumented extra suppression).** D1 as implemented suppresses not only the store
checkout root config's `projectId` but also its `executionRoot` contribution to the
project-binding fact (`resolver.ts:1873-1902`). The code comment argues it well (the Store root
claiming to be the project's execution root collides with the marker), but neither design.md D1
nor the delta requirement ("…SHALL NOT contribute a projectId fact") mentions executionRoot, so
the archived spec will not protect that half of the behavior.

**A-4 (Minor, fallthrough not covered by D1's rationale).** When the selected root IS a store
checkout, `bindingProjectId` still falls through to `selectedProjectRegistry?.entry.projectId`
(`resolver.ts:1893`): a machine project-registry entry keyed to a store checkout root would still
inject a projectId fact. Technically compliant with the delta (which names only the root config),
but the D1 rationale — a Store aggregate is not a project — applies equally. Untested either way.

**A-5 (Minor, evidence gap).** Change A carries NO evidence directory (this report creates it).
The fail-first red runs for task 1.2 and the 121/121 + binned-run results exist only as prose in
tasks.md's verification notes; B and G2R both recorded receipts for the equivalent claims. The
claims are plausible (the e2e suite passes on the joint tree and its pre-fix semantics are
documented per test), but nothing on disk proves fail-first for A.

**A-6 (Trivial).** Two conflict tests assert on message content without pinning the diagnostic
code: `store-planning.test.ts` "refuses as a conflict when the recorded pair disagrees with
itself" asserts only `toContain('project-zeta')`; the e2e disagreement test accepts either
`planning_selection_conflict` or `project_not_in_store`. Message content does discriminate in
both, so they are not vacuous — but the code assertion would be cheap.

Notes, not defects: the intentional BEHAVIOR CHANGE on the execution-worktree seat
(`split_planning_truth` instead of a wrong-root archive plan) is disclosed in design.md Risks
with its root cause and repair ownership — good honesty. The new gate reads marker/association
paths as string literals, matching pre-existing resolver idiom (`resolver.ts:974,1008`) rather
than `binding.ts`'s constants — consistent, left alone.

### Fail-closed answers (dispatch question B)

- Two-source conflict with the config fact suppressed: **still refuses** — marker-vs-association
  and explicit-selector-vs-marker conflicts both pinned (`store-planning.test.ts`).
- Inconsistent recorded pair: **refuses in the single-pair shape (tested); does NOT refuse when a
  sibling agreeing pair exists (A-2)**.
- Probe failure: degrades to no-match, never wrong-match — tested (fixture + e2e); uid
  disagreement refuses — tested; `cp -r` copy of a store (different repo, same metadata) refused —
  tested.

### Verdict: SHIP WITH CONDITIONS — 0 Blocker / 2 Major / 3 Minor / 1 Trivial

The code solves the three reproduced refusals and the e2e pins are real. Both Majors are cheap to
resolve, but A-2 requires an explicit decision (code vs delta wording) before archive, and A-1 is
a stated-mitigation-absent defect by the run's own standard. I would not ship as-is without those
two decisions; nothing here requires re-architecture.

---

## Change B — fix-store-workspace-pair-transactions

23/23 tasks. Spec delta: MODIFIED ×2 + ADDED ×1 on `store-planning-worktree-bindings`.
Scope check: owned files only, plus attributed shared-file edits (vitest weight entry, timeout
headers on five sibling workspace suites + `store-archive-delivery`, quick-locate row, three
locale strings — all additive, all annotated with the owning task). CLEAN.

### Spec delta correctness (dispatch question C) — checked scenario by scenario

- MODIFIED "A Change workspace is prepared through an immutable plan and a revalidated token":
  all 5 canonical scenarios present verbatim, 5 added. Body strictly additive. **No deletion risk.**
- MODIFIED "Applying revalidates Git preconditions and creates worktrees from frozen commits":
  all 4 canonical scenarios present verbatim, 3 added. Body strictly additive. **No deletion risk.**
- No renamed scenario headings anywhere in the batch.

### Findings

**B-1 (Major, artifact traceability).** The pair-branch **reattachment** semantics — a third,
load-bearing behavior surface of this change (`plan.ts:145-244 planCreatedSide`,
`apply.ts:157-173` branch-tip revalidation, `dependencies.ts:1350-1371` `createBranch` form of
`addWorktree`) — is specified in the delta (req-1 branch paragraph + 2 scenarios; req-2 paragraph
+ 1 scenario) and well tested (3 dedicated tests), but **design.md contains no decision for it
(D1–D5 only; the dispatch's "D6" does not exist on disk in `rasen/changes/…/design.md`) and
tasks.md contains no task line for it**. The behavior is necessary (without it, `git worktree add
-b` fails on every surviving pair branch and the vanished-worktree shape re-wedges the moment a
branch carries commits — which is exactly the elftia field state), so this is not scope creep to
remove; it is a design/tasks record that omits a chunk of what shipped. Fix: write the missing
design decision (and rationale for reattach-at-own-tip vs line tip) and the task-ledger lines;
no code change.

**B-2 (Major, unmodified canonical requirement now contradicted).** Canonical requirement "A
prepared workspace binds to exactly one Change instance"
(`rasen/specs/store-planning-worktree-bindings/spec.md:111-116`) states: "**Re-preparing a
workspace for a Change SHALL produce a different pair identity rather than reuse the previous
one.**" B's new same-root re-creation path produces the SAME pair identity — asserted
deliberately by the task-2.2 test (`workspace-repreparation.test.ts`:
`expect(applied.workspacePairId).toBe(first.workspacePairId)`), with an in-test comment
explaining the identity model (pair id is a function of Change instance + worktree paths, so
same-root re-creation re-derives the same id) and re-reading the canonical scenario's "with new
worktrees" qualifier into the requirement. The scenario is qualified; the SHALL sentence is not,
and B's delta does not modify that requirement. Code and test agree with each other; the archived
spec will disagree with both. Fix: add that requirement to the delta as MODIFIED (carrying all 3
of its scenarios) with the sentence scoped to new-destination re-preparation. Cheap, but it must
happen before archive — this is exactly the class the repo's own history ("MODIFIED delta
scenario" traps) warns about, in reverse.

**B-3 (Minor, refusal legibility on a race).** If the pair branch becomes checked out in another
worktree between plan and apply without moving, the apply-side branch-tip check passes and
`git worktree add <dest> <branch>` fails with a raw git error rather than a named
`workspace_*` refusal. Fail-closed (nothing written), but off the "refusals name a repair"
contract. Plan-side occupancy IS refused with a named precondition (tested); only the
plan→apply window is raw.

**B-4 (Trivial).** `renderPlan(plan, /*compound*/ true)` prints "Applying under the same lock
hold." after the apply has, in fact, already completed (prepare() returns both). Cosmetic tense.

### Fail-closed answers (dispatch question B)

- Mismatched identity at the SAME root: **still refuses stale** — code (`apply.ts:194-217`
  `recordedAtPlannedRoot` scoping) and test both verified; the guard is mutation-proved with a
  unique landing site and file hashes (`evidence/mutation-proof-2.3.txt` — exemplary).
- Branch checked out elsewhere: **plan refuses** with a named blocked precondition (tested); the
  post-plan race degrades to a raw git error (B-3).
- MOVED reattached branch: **apply refuses stale** naming both OIDs; a deleted/ambiguous branch
  also refuses (`(unresolved or ambiguous)` path). Tested.
- Moved target-line ref, occupied destination, reused-side HEAD/ref/identity staleness, index
  fingerprint, catalog digest: all untouched by the diff; sibling suites re-run green with only
  timeout-header edits (verified: those 5 diffs contain no assertion changes).
- Compound: mid-window competitor movement still refuses stale (tested via a dependency-seam
  hook), held lock fails with the named holder (tested), blockered plan applies nothing and
  returns the preview with exit 1.

### Test quality (dispatch question D)

Best of the batch: fail-first red run recorded (8 failed / 4 passed), defect pins written GREEN
against pre-fix code to prove landing, inversion recorded, pins then deleted with the rationale
documented in the suite header; mutation proof anchored to a grep-count-1 landing site with
before/after/revert hashes; full store suite green (89 files / 1572 tests, EXIT=0,
`evidence/postfix-store-suite.txt`); real-CLI dogfood receipts; explicit 180s per-test timeouts
everywhere; vitest weight entry carries its measurement provenance. Windows case-alias covered.

### Verdict: SHIP — 0 Blocker / 2 Major / 1 Minor / 1 Trivial

The code is sound and the two Majors are artifact/spec bookkeeping (design/tasks writeback for
B-1; a MODIFIED delta entry for B-2). Both should land before archive, since archive-time spec
sync is precisely where B-2 bites; neither needs a code change.

---

## Change G2R — rehearse-legacy-store-layout-migration

26/26 tasks. Spec delta: new capability `store-layout-migration`, all ADDED — no omitted-scenario
risk. Scope check: owned files only; `src/commands/store-migration.ts` was not in the proposal's
initial impact list but entered via the triage mechanism the design pre-authorized (O5, task
4.4), and the dispatch's ownership list includes it. CLEAN.

### Findings

**G-1 (Minor, disclosed ship-gate deviation).** Design D4's gate is "every category (a)/(b) item
fixed+guarded **or explicitly re-classified with reason**". O14 (retire-flat succeeds while the
publication is uncommitted, contradicting its own refusal text) and O18 (post-rollback `--resume`
wedged with a dead-end repair; a fresh `--apply` recovers) remain class (b), **deferred** with
recorded reasons rather than fixed or re-classified. Honest and findable (triage "Deferred, with
reason" section + named for the G2 tranche report), but the gate as literally written is not met.
LEAD should consciously accept the deferral.

**G-2 (Minor, error-contract trade-off).** `runAdopt`/`runRelocate`/`runHomePrune` human paths no
longer rethrow: EVERY error — including genuinely unexpected internal ones — is now flattened by
`emitFailure` to `Error: <message>` with no stack. Correct for StoreError refusals (the measured
O5 defect, guarded by a test that also pins no-stack/no-dist-paths), consistent with `runEject`'s
existing contract, but non-diagnostic crashes lose their stack in human mode. Acceptable; noting
the trade.

**G-3 (Trivial).** Dead import: `asErrorMessage` in `src/commands/store-migration.ts:10` — its
only user (`failJson`) was removed. tsconfig does not set `noUnusedLocals`, so tsc stays quiet.

**G-4 (Trivial, vacuous assertion).** `layout-migration-empty-store.test.ts` (adopt human-path
test, last assertion): `expect(rendered).not.toContain('dist\core\store')` — in a normal string
`\c`/`\s` collapse, so this checks for `distcorestore` and can never fire. Should be
`'dist\\core\\store'`. The sibling `'dist/core/store'` assertion above it is real, so the test is
not toothless overall.

### Fail-closed answer (dispatch question B)

The blockers gate refuses everything it refused before. `applicable = blockers.length === 0`
drops only the `frozenItems.length > 0` conjunct; every previously-item-blocked refusal is
unchanged (regression-pinned: "still refuses an empty-blocker gate it should refuse", plus the
existing 10 layout-migration suites green post-fix — the 2 failures in
`evidence/guards/04-existing-suites-green.txt` were this change's own fixture defect, fixed and
re-measured; the pre-existing suites all passed, though the file's name vs its EXIT=1 content
takes a moment to reconcile). The fix additionally STRENGTHENS the gate: apply-token
preconditions (store identity, checked-out ref, unborn ref) that used to be silent (O24 printed
"Ready to apply" at exit 0, then `--apply` exited 1 with no diagnostic) are now reported blocked
items, and a runtime invariant (`migration_plan_gate_desync`) closes the defect CLASS. The
five-shape invariant table ("never reports readiness it cannot back") is a model guard. The new
`store-metadata` item kind is only ever emitted blocked, so it can never reach staging/publication
(blocked ⇒ no token ⇒ no apply).

### Test/evidence quality (dispatch question D)

Strong: triage criteria pre-registered before evidence existed; 26 observations each citing a
numbered evidence step; pre-fix red run recorded (`guards/02`: 15 failed / 4 passed); post-fix
green recorded; SS15 rows given an honest real-vs-fixture accounting (long-path stays
fixture-only, stated); real store proven byte-untouched with a recorded baseline; registered-store
seam (machine-registry resolution by store id) covered for the first time; explicit 120s
timeouts; vitest weight entry measured. The command-handler tests run `runStoreMigrateLayout`
in-process rather than the shipped binary, but the rehearsal itself drove `node bin/rasen.js`
end-to-end, so the seam claim holds across the two layers.

### Verdict: SHIP — 0 Blocker / 0 Major / 2 Minor / 2 Trivial

---

## Cross-change interactions (dispatch question E)

- **Shared files**: `vitest.config.ts` (B + G2R weight entries, additive, both annotated),
  sibling workspace-suite timeout headers + `store-archive-delivery.test.ts` (B, timeout-only —
  verified no assertion edits), `quick-locate.md` (B). No conflicts.
- **A consumes what B produces**: A's planning-bound gate reads exactly the triple B's flow
  records (index entry + marker + association). B's re-recording on re-preparation keeps the
  triple; B's cleanup removes the entry, which A's gate treats as "no pair" → named repair.
  Coherent. B does not write the catalog's `planningBinding`, matching A's D3 assumption.
- **A's e2e suite drives B's modified plan/apply** and passes on the joint tree (my run, 40/40).
- **Ownership fences held**: B's diff does not touch resolver/identity; A's does not touch
  workspace/*; G2R touches neither, and its triage explicitly records that no finding implicated
  sibling files. G2R's O26 (`upgrade-identity` preview mints a different uuid than `--apply`) is
  handed to A via `rasen/changes/rehearse-legacy-store-layout-migration/handoff/to-sibling-a-upgrade-identity-uuid-mismatch.md`
  — **note: A has not acted on it; it remains an open handover for A/G2.**
- **No vacuity introduced across changes**: B's D1 narrowing does not weaken A's gate (different
  seams); G2R's gate change does not touch either sibling's refusals.
- **Tree hygiene for ship (not a change defect)**: the working tree also carries unrelated
  uncommitted work (docs, HANDOFF, `.gitignore`, `rasen/config.yaml` storeMemberships,
  `.rasen-pipeline-command-ipp26E/`), plus junk that a careless `git add rasen/` would sweep into
  the canonical trees: untracked `rasen/specs/billing/spec.md` (Purpose: "p") and
  `rasen/changes/add-thing/`. Ship must use narrow pathspecs.

## Batch summary

| Change | Blocker | Major | Minor | Trivial | Verdict |
|---|---|---|---|---|---|
| A — fix-store-retention-scope-resolution | 0 | 2 (A-1, A-2) | 3 | 1 | SHIP WITH CONDITIONS (decide A-1 wiring + A-2 code-vs-delta before archive) |
| B — fix-store-workspace-pair-transactions | 0 | 2 (B-1, B-2) | 1 | 1 | SHIP (artifact repairs before archive; code sound) |
| G2R — rehearse-legacy-store-layout-migration | 0 | 0 | 2 | 2 | SHIP |

**Single most serious finding: A-2** — the planning-bound gate admits a scoped write despite
inconsistent recorded-pair evidence whenever any sibling pair for the same project+line fully
agrees (order-dependent, sibling pairs after the first agreeing one never read), contradicting
both design D3's "any disagreement is a fail-closed conflict" and the change's own delta scenario
"Inconsistent pair evidence refuses"; the multi-pair shape is the normal machine state and no
test covers it.
