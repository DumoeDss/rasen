## Context

Third and last child of the `store-v2-foundation` slice, Layer 2, and the outcome the workstream was
named for. `store-planning-contract-v2` (`f8e17e3d`) and `store-worktree-bindings-v2` (`501b8943`) are
both landed on this branch.

### Attribution: a third distinct answer, reached by the same recipe

The portfolio's rule is that the reference tip is never assumed to be the port target. The recipe has
now produced three different answers: "not the tip" for child 1 (its tip carried this child's code),
"the tip" for child 2 (every later commit was one of its own mandated fixups). For this child:

```
git log --oneline e62b101f..origin/dev/0.1.7 -- src/core/store/issues/ src/core/store/query/ \
    src/commands/store-issue.ts src/commands/store-aggregate.ts
  f4a48a36  feat(store): migrate coordinators to Store Issues
  0ede6cfb  feat(rasen): Store v2 partitions, planning worktrees, ... scoped issues, ...
```

Exactly two commits. `0ede6cfb` is the five-child squash and creates this child's files from nothing.
`f4a48a36` is the **coordinator bridge** — a separate, later roadmap slice of this same workstream
(`migrate-cross-project-coordinators-to-store-issues`), and it added +409 lines to this child's files:

| Added by `f4a48a36` | What it is | Decision |
| --- | --- | --- |
| `issues/migration-compiler.ts` +110 (new file) | compiles a legacy coordinator into an Issue | **exclude** |
| `test/core/store/store-issue-migration-compiler.test.ts` +176 (whole file) | its dedicated suite | **exclude** |
| `issues/locks.ts` +70 — `withIssueLockBatch`, `issueLockCanonicalBytes`, `heldIssueLockKeys`, an `onAcquired` seam | its own docstrings say "one complete **migration** Issue batch" and "seam used by Store **migration** tests" | **exclude** |
| `test/core/store/store-issue-locks.test.ts` +93 | the batch cases | **exclude** |
| `issues/reference-verification.ts` +156 (new file), `issues/module.ts` +205 / −147, `issues/index.ts` +10, `query/references.ts` +5 | an **extraction** of reference verification out of `module.ts`, plus coordinator-specific extension — `module.ts` shrinks 520 → 441 lines | **exclude** |

So this child ports the **squash base**, and excludes `f4a48a36` whole.

Three facts make that exclusion safe rather than convenient, and each was checked:

1. **Nothing is left untested and no test is orphaned.** `f4a48a36`'s source additions and its test
   additions move together — it added `migration-compiler.ts` *and* the only suite for it, and the
   `locks.ts` batch code *and* the only cases for it. This is the mirror of the rule child 2
   established ("no production consumer is not sufficient — check for a dedicated suite"): here the
   dedicated suite arrives with the code, so both leave together.
2. **The named deliverable survives.** "Reference verification against committed Store evidence" is
   in this child's charter, and `f4a48a36` did not introduce it — it *extracted* it. The squash base
   already performs reference verification inline in `module.ts`, covered by the base change's own
   tests. Excluding the extraction keeps the behavior and loses only the file split.
3. **Behavior is byte-identical where it matters.** `issueLockCanonicalBytes` is an extraction of an
   expression the base computes inline; the lock filename digest is the same either way. Excluding it
   changes no value.

The remaining risk is stated plainly: the excluded extraction means `issues/module.ts` here is the
520-line squash version rather than the 441-line tip version, so this child's `module.ts` will **not**
be byte-identical to `origin/dev/0.1.7`. That is a deliberate departure from the portfolio's
byte-comparability preference, and it is the correct one — comparability is a means of keeping the
archived reference diffable, not a reason to import a later slice.

### Collision surface: greenfield core, high-risk rim

`git diff e62b101f origin/dev/0.2.0 -- src/core/store` is still empty, so `issues/**` and `query/**`
land on an untouched base. The rim is where this child differs from its two siblings, and it is the
highest-risk surface in the portfolio: `management-api/router.ts` (0.1.7 +267 vs 0.2.0 +798),
`wire-types.ts` (+263 vs +493), `packages/ui/src/api/types.ts` (+290 vs +991), plus `cli/index.ts`,
`completions/command-registry.ts`, and six locale files.

### CLI-surface dependency check, done at propose time

Child 2 discovered mid-implementation that seven ported tests needed `rasen new change --target-line`,
delivered upstream by `store-planning-scope-routing` (`3b050663`), which is not an ancestor of this
line. That commit also touched `show.ts` and `spec.ts`, adjacent to this child. So the check was run
before proposing, over every test this child plans to port:

- `git grep -- "--target-line|new change|planning_worktree_required"` across
  `store-issue-cli`, `store-aggregate-cli`, `store-aggregate-query`, `store-issue-layout`,
  `store-issue-locks`, `store-query-lock-free`, `store-query-read-only-guard`: the only hits are
  `store issue new …` and `store aggregate --project/--target-line`, which are **this change's own new
  command surface**, not an upstream dependency.
- Their whole import surface is `store/issues/**`, `store/query/**`, `store/workspace/{dependencies,
  locks}` (child 2, landed), `store/{planning-foundation,planning-identity,finalization-v2}` (child 1,
  landed), `test/helpers/store-workspace-fixture.js` (child 2, landed), `test/helpers/run-cli.js`, and
  node builtins.

**Result: no decomposition gap of child 2's kind exists here.** That is a measured finding, not an
assumption, and it is why this child carries no deferral other than the one already known.

## Goals / Non-Goals

**Goals:**

- Land `issues/**` and `query/**` as one unit, with the CLI, API, and UI surfaces that make them
  usable.
- Close the layout debt child 1 deliberately deferred here: the Store-level Issue addresses and the
  Issue / revision identifier validators.
- Anchor every durable-format value with pinned literals, at propose time, because this child ships
  more of that shape than either sibling.
- Keep the rim additive: add surface beside what this line built, restructure nothing.
- Regress nothing in the daemon, management API, or UI.

**Non-Goals:**

- The coordinator migration compiler and batch Issue locking — the coordinator-bridge slice.
- `finalization/`, `store-planning/`, `layout-migration/`, `layout-write-guard.ts`,
  `membership-layout.ts`, `consistency-gates.ts`.
- Scope routing. The reference change carried a `store-planning-scope-routing` delta; that capability
  does not exist on this line, and the requirement is dropped rather than invented.
- Issue Dispatch, Execution Plan scheduling, and Issue acceptance — the parent direction, not this
  slice.

## Decisions

### 1. `issues/` and `query/` are one change, not two

Not reopened: the import cycle is bidirectional and proven (`issues/module.ts` → `query/refs.js`;
`query/issues-read.ts` → `issues/{records,plans,types}.js`). Splitting them would require inventing a
seam neither side has.

The design principle that keeps them coherent is the split they already encode: **a mutation refuses,
a query reports.** `StoreIssues` has exactly three methods and every one can refuse. The read surface
has seven and none of them can — a partially unreadable Store produces a report naming what could not
be read, never a failure. That asymmetry is a product contract in both specs, not an implementation
detail.

### 2. Digest and serializer anchors are written now, not discovered at review

This child ships the shape that cost child 1 three review rounds. Relational assertions —
`toMatch(shape)`, `.toBe(other)`, `.not.toBe(other)`, distinct-set counts — are uniformly blind to any
change that transforms every value the same way, which is exactly what a preimage, digest, or
serialization change is.

Sites in this child, enumerated from the reference:

| Site | Value |
| --- | --- |
| `issues/plans.ts:312` `executionPlanDigest` over `executionPlanDigestBody` | the revision content digest |
| `issues/plans.ts` `serializeExecutionPlanRevision` | the revision's durable bytes |
| `issues/records.ts` Issue record serializer | the Issue's durable bytes |
| `issues/locks.ts:130` | the Issue lock filename digest, over the `issue-lock/v1` domain preimage |
| `query/issues-read.ts:29` and `query/refs.ts:447` | the read-side content digests |

Each needs a pinned-literal anchor. Three rules, all paid for by this portfolio:

- **Pinned literal inputs per anchor, never chained.** An anchor computed from another anchor's output
  smears a single break across all of them instead of localising it.
- **Walk the value back through its own reader.** `validateExecutionPlanRevision(..., {verifyDigest:
  true})` must be exercised against the anchored bytes, so a preimage change cannot hide behind a
  verifier that stopped checking.
- **Where a live per-run fact makes a fixed literal impossible** (a timestamp inside the preimage),
  the test independently reconstructs and rehashes with its **own hardcoded hash call** — a third
  shape, distinct from both pinned-literal and relational.

And the trap child 2 nearly shipped: **an anchor that builds its expected value by calling
production's own serializer a second time is blind**, because a serializer change moves both sides
together. Perturbing an input field does *not* discriminate — that moves only one side, and is the
break the unstrengthened anchor already caught. The mutation that discriminates is a change to the
**serializer or preimage itself** (reorder a field, change the separator, drop a domain tag) with
inputs held fixed. Task 7.3 states that as the required proof.

### 3. The rim is additive only, and the mirror is enforced by a test

The three rim files this child touches are the most divergent in the repository. The strategy is
therefore: **add beside, never restructure.** New router paths, new wire types, new UI components,
new locale keys — no existing endpoint, type, or key changes shape.

A wire type added without its UI mirror is a known silent-drift failure mode here. Child 2 verified
locale lockstep by **key set**, not by count, and found all 28 of its new keys genuinely translated;
this child holds that standard and extends it to the wire-type mirror, which gets a test rather than
an inspection.

The reference change also carried two **MODIFIED** requirements — amending `board-ui`'s member chip
filter and `management-http-api`'s loopback/bearer security. Those are deliberately **not** ported as
written, because a MODIFIED delta is whole-requirement replacement against text that has diverged on
this line, and getting it wrong silently deletes scenarios at archive time. Task 5.5 converts this
into a bounded check: read the live 0.2.0 text of both requirements, decide whether the Issue and
aggregate surface genuinely changes either **on this line**, and if so author the MODIFIED delta from
the 0.2.0 text — never from the reference's. If neither changes, record that and move on. The ADDED
requirements already carry all the new surface.

### 4. The Issue lock order assertion cannot be trusted as evidence

`issues/locks.ts:101` calls `assertStoreLockOrderAgreesWithWorkspace()` at module load, comparing two
frozen arrays element-wise. It keeps passing under any partial port, even when the ordering it encodes
has no enforcement surface left — its own docstring names this failure mode.

On this branch, after child 2: `scope` and `workspace` are taken by `WorkspaceModule.apply()` and
`applyCleanup()` (plus `scope` alone by `TargetLineModule`'s catalog writes); `issue` is taken by this
child. **`change` and `integration` have no taker at all**, because their taker is the finalization
slice. Task 7.5 requires each kind's taker to be named in shipped code and the two with none to be
recorded as unenforced-by-design. Comparing the arrays proves nothing about this child and must not be
offered as evidence that ordering survived. (Full taker table: `evidence/store-lock-order-takers.md`.)

### 5. New branded types: checked, and the answer is none in the module, two in the shared layer

`git grep 'unique symbol'` over `src/core/store/issues/**` and `src/core/store/query/**` on the
reference returns nothing — this child's own modules declare no brand.

But this child does add `IssueId` and `ExecutionPlanRevisionId` to
`src/core/store/planning-validation.ts`, which **is** one of the three files child 1's
brand-vocabulary guard reads. So the guard covers them automatically, and no source-list extension is
needed — provided the two brands are declared in that file, in the same single-line form the guard's
text scan recognises. Task 3.4 pins that: add the brands there, and assert the guard's count moves,
so a brand that lands in a file the guard does not read fails loudly instead of silently.

### 6. The known deferral, and its substitute coverage

`test/core/store/store-issue-scope-intent.test.ts` (7 cases) cannot run here: it imports
`test/helpers/store-finalization-fixture.ts`, which pulls the whole `finalization/` module and
`store-planning/**` — a later slice. The standing rule is that **deferring the case is acceptable;
shipping the behaviour untested is not.**

`issues/scope.ts` is 207 lines. Task 6.2 requires the implementer to determine which of its behaviours
only that file covers, and to author finalization-free equivalents driven through `StoreIssues` and
the aggregate query directly — the same treatment child 2's seven deferred cases received. The file
itself is handed forward as an inbound acceptance item for the finalization slice.

### 7. The two UI components ship unwired; navigation is a named follow-up, not an oversight

`StoreIssuesView.tsx` and `StoreAggregateBoard.tsx` (task 5.4) are complete, tested, and reachable only
by direct import — neither is wired into `app.tsx`/`Layout.tsx`/`use-space.ts`'s `SWITCHABLE_SECTIONS`,
so no user reaches either from the shell's navigation today.

This is deliberate, not an omission, for three reasons:

- **Neither spec requirement this child ships needs reachability to be satisfied.** The
  `management-ui-shell` requirement this child adds ("Store-scoped calls address their Store by stable
  identity through the same client seam") governs how a call is made once issued, not whether the view
  that would issue it is on a menu. The `board-ui` requirement ("An aggregate view never submits a
  mutation with an incomplete scope") governs the form's own behavior once rendered, which the suite
  exercises directly against the component — again, independent of whether the shell links to it.
  Neither requirement's scenarios mention navigation, a menu entry, or a route.
- **Decision 3's additive-only rule is a positive reason not to wire it here, not just silence on the
  question.** Wiring a new section into `SWITCHABLE_SECTIONS` touches shared shell state every other
  section also depends on — exactly the kind of restructuring Decision 3 rules out for this child's rim
  surface. Task 5.1 already established the pattern at the API layer (new `stores.ts`/`router.ts` paths
  added with no existing endpoint's shape touched, and no CLI menu wiring implied by that); task 5.4
  applies the identical discipline one layer up, in the UI shell.
- **The honest risk is not "it doesn't work," it is that it looks like it does.** A component that
  exists, compiles, has passing tests, and cannot be reached by any user looks exactly like delivered
  value from every angle except the one that matters. Recording that plainly here — rather than only in
  a suite's green checkmarks or a commit message — is what keeps a future reader from mistaking "shipped
  and tested" for "usable."

Follow-up, named rather than left implicit: wiring `StoreIssuesView`/`StoreAggregateBoard` into the
shell's navigation is left for whichever future change first needs an operator to reach a Store's
Issues or aggregate board from the UI — most naturally the same slice that wires Issue Dispatch or
Execution Plan scheduling into the UI, since a reachable Issues view is more useful once there is
something to dispatch from it.

## Risks / Trade-offs

- [Risk] The rim files are the most divergent in the repository, and a wire type without its UI mirror
  drifts silently. → Additive-only (Decision 3), mirror enforced by a test, locale parity by key set.
- [Risk] Five digest and serializer sites, and the reference suite is relationally shaped. → Decision 2
  and tasks 7.1–7.3, with the symmetric-anchor trap named and the discriminating mutation specified.
- [Risk] Excluding `f4a48a36` leaves `issues/module.ts` non-byte-identical to the reference tip,
  breaking the portfolio's comparability preference for one file. → Stated in Context; the alternative
  imports a later roadmap slice, which is worse. Task 8.4 records the intended divergence so a
  reviewer does not read it as drift.
- [Risk] This child adds heavy suites, and the portfolio has already established that a full run at
  default parallelism produces failures that all pass solo — including a hard assertion failure. →
  Task 8.1: never triage a full-run failure by its shape, re-run solo, and take the gate at reduced
  parallelism.
- [Risk] A gate command frozen before this child existed will silently not run its suites — which is
  exactly what happened to child 2's four command suites. → Task 8.2 re-derives the gate's file list
  from this change's own test-file additions and verifies the run's file count against them.
- [Risk] `packages/ui` is excluded from the root test runner, so a UI suite run from the root reports
  "passed" having run zero tests. → Task 5.4 requires the UI package's own runner and an explicit
  non-zero test count.
- [Trade-off] The aggregate read surface reports rather than refuses, so a caller can receive a
  partial answer. That is deliberate: a Store with one malformed Issue must still be inspectable, and
  the alternative — refusing the whole read — makes a damaged Store undiagnosable.

## Migration Plan

1. Add the two layout addresses and identifier validators to the shared planning contract, closing
   child 1's deferred debt.
2. Add `issues/**` and `query/**` together at the squash-base state.
3. Add the two command groups and register them across the command tree, completions, and locales.
4. Add the API paths, their wire types, and the UI mirror in one step; then the two UI components.
5. Port the test surface, then add the anchors Decision 2 requires and the substitutes Decision 6
   requires.

Rollback is removal of two modules, two command groups, their registrations, the additive API paths
and wire types, two UI components, and two validators. Nothing in this child changes an existing
record format or an existing endpoint, so rollback needs no data migration.

## Open Questions

None blocking. One item is handed forward: `test/core/store/store-issue-scope-intent.test.ts` is an
inbound acceptance item for the finalization slice, with substitute coverage delivered here.
