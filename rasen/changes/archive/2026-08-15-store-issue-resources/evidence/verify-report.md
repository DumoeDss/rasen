# Verify report — store-issue-resources

Verifier: independent of the implementer, both reviewers, and both fix rounds.
Scope: task truthfulness, spec-delta-vs-implementation, archive projection, proposal/design
accuracy, and range scope over `501b8943..HEAD`. All runs solo at `VITEST_MAX_WORKERS=1`
(UI suites via `pnpm -C packages/ui`). The full gate was NOT re-taken, per instruction.

## Verdict

**NOT archive-ready.** Two blocker-class delta-vs-implementation contradictions (both
measured, not inferred) and one Major proposal.md inaccuracy block it. Everything else
sampled — including both prior fix rounds' headline claims — verified true, several by
independent re-measurement.

The brief said to assume a third instance of the ticked-task-with-a-false-clause pattern.
There is one, and it is the same shape as 2.4 and 2.5: a refusal/never claim, zero test
coverage over the false clause, every gate green.

## Blockers

### B-V1. A malformed committed Change is silently omitted; a malformed Issue's "why" is dropped

Delta `specs/store-aggregate-query/spec.md`, requirement "A partially unreadable Store is
reported, not refused": "naming each unreadable or inconsistent item and why. It SHALL NOT
fail the whole answer because one Issue, one project catalog, or one Change is malformed,
and it SHALL NOT silently omit the item either." Scenario "An unreadable item is never
silently omitted" adds "it appears in the reported problems AND the result does not present
itself as complete." Task 3.4 is ticked with the same claim ("a named problem for the
unreadable one ... never a silent omission").

Measured with a throwaway probe test (written, run solo, deleted; described below):

- **Change with unparseable committed `.openspec.yaml`**: absent from every group of
  `listChanges`; no diagnostic anywhere; `complete: true`; result keys are exactly
  `{complete, groups, unsearchedRefs}` — there is no surface that could carry the problem.
  Mechanism: `refs.ts:428-437` (`changeEvidence` returns `null` on YAML/schema/identity
  failure), `refs.ts:484/504` (`if (evidence !== null) record(...)` — the null is dropped),
  and `ChangeGroup`/`GroupedChanges` (`query/types.ts:148-184`) define no problem field.
- **Issue whose sole committed `issue.yaml` copy is malformed** (one unknown field): the
  read survives and the id appears — but as `{record: null, divergence: null}` with no
  diagnostic-carrying key on the summary, and `complete: true`. The why IS captured
  (`issues-read.ts:44-49`, `IssueRecordCopy.diagnostic`) and then discarded by
  `summaries()` (`query/module.ts:460-472`), because `IssueSummary` has no field for it.
  The divergent case does surface per-copy diagnostics; the sole-malformed-copy case
  cannot. (Side effect: `query/types.ts:218`'s comment "Null exactly when the Issue is
  divergent" is false — also null here.)

The catalog case — the third item class the sentence names — is genuinely delivered and
tested ("reports an invalid catalog as an entry carrying its diagnostic",
`store-aggregate-query.test.ts:357`). Neither the malformed-Change nor the
malformed-Issue clause has any test anywhere in the tree, which is why every gate stayed
green over them. Neither review round mentions this.

Probe (reproducible): seed two Changes via `f.seedChange` + commit; overwrite one's
`.openspec.yaml` with invalid YAML; commit; `query().listChanges(scope)`. And: create two
Issues via `StoreIssuesModule`; commit; rewrite one `issue.yaml` adding
`surpriseField: ...`; commit; `query().listIssues(scope)`. Both suspected-defect
expectations passed (healthy items survive, broken Change absent, broken Issue why-less,
`complete === true`).

### B-V2. "An empty project or line is present and empty" is false at both deltas

`specs/store-aggregate-query/spec.md` requirement "Changes are listed grouped by project
and by target line": "A project with no Changes and a target line with no Changes SHALL
each be reported as present and empty rather than omitted", scenario "it is reported as
present with an empty list AND it is not omitted from the result".
`specs/board-ui/spec.md` mirrors it: "SHALL appear as present and empty rather than be
hidden ... it appears on the board with an empty group AND it is not hidden."

Shipped behaviour: `listChanges` can never emit an empty group. `collectGroups`
(`query/module.ts:279-318`) creates a bucket only via `bucketFor`, which is called only
when pushing a committed-Change entry; every filter `continue`s before bucketing. Measured
in the same probe: a Store with three declared projects and changes in one returned groups
for that one only — the other two declared projects and the second declared target line
were omitted outright, not reported empty.

Two shipped tests make this worse, not better:

- `store-aggregate-query.test.ts:118-119` PINS the omission: with three fixture projects
  it asserts `keys` `toEqual` exactly the two non-empty group keys.
- The UI suite's "shows a group with zero Changes as present-and-empty"
  (`store-aggregate-board.test.tsx:81`) feeds the component a hand-built fixture group the
  real server can never produce (the component fetches only `getStoreChanges`,
  `StoreAggregateBoard.tsx:40`, and renders `groups` verbatim). The component-level
  behaviour is real; the end-to-end scenario is not reachable. This is the
  fixture-coincides-with-the-gap pattern this portfolio has met before.

Mitigating fact for the fix decision: the facts ARE available on the same surface —
`listProjects`/`listTargetLines` rollups report every declared project/line with zero
counts (`ProjectRollupEntry.activeChangeCount` etc.). So the resolution is either to
synthesize empty groups from the declared catalogs in `collectGroups`, or to reword both
scenarios to point at the rollup listings. On the two prior instances of a false SHALL
(round-1 BLOCKER-1, MAJOR-1) the operator ruled implement-don't-reword; that ruling is the
operator's to make again, not mine.

## Major

### M-V1. proposal.md describes a command surface that deliberately does not exist

`proposal.md` says "Add `rasen store issue` and `rasen store aggregate` command groups"
(What Changes) and "**Adds** `rasen store issue` and `rasen store aggregate` to the
command tree" (Impact). Shipped: `rasen store changes` and `rasen store projects`, two
`store` siblings, and `src/commands/store-aggregate.ts:8` states "There is deliberately no
`rasen store aggregate` group". Tasks 4.1/4.2 record the deviation with its reason;
proposal.md was never reconciled and becomes the PR body — a reader will look for a
command that is not there. One-line fix.

Related, weaker: proposal's "surface them in the operations UI as a Store-scoped Issue
view and an aggregate board" does not mention that both components ship unwired
(design.md Decision 7 records this plainly, with reasons; the proposal does not).

## Minors (none block archive; listed for the fixer/operator to triage)

1. **Reverse-lookup superseded-revision scenario untested.** True by construction —
   `issuesReferencing` reads only `latestRevisionId` (`query/module.ts:432`) — but no test
   publishes rev 2 dropping a reference and asserts the Change is no longer reported.
2. **Undefined-state refusal untested at the mutation surface.** True in code:
   `isPermittedIssueTransition` (`records.ts:178-181`) refuses any target outside
   `{resolved, dropped}`, same throw site as the tested terminal-refusal. Tested at the
   HTTP layer ("refusing an invalid state name", `stores.test.ts:220`); the CLI `state`
   command does not pre-validate (`store-issue.ts:277` casts) and no module/CLI test
   drives an out-of-vocabulary state.
3. **Record strict-read scenarios untested.** "An unrecognized field is reported" and "A
   record missing required facts is refused" are delivered by the Zod `.strict()` schema
   (`records.ts:79-90`) — code-verified, no direct test seeds either input.
4. **Dead-owner lock clause tested only through the shared primitive.** The issue lock
   delegates to `acquireOwnerAwareFileLock` (PID-dead stale-steal, `file-state.ts:193`),
   covered by `workspace-locks.test.ts:295`; no test exercises it through `withIssueLock`.
5. **design.md Decision 5 cross-reference**: "Task 3.4 pins that" — the brand-guard task
   is 1.4.
6. **Task 8.6 is ticked with its literal second half open** (no CI-matrix run reference
   can exist before the portfolio push). The record is honest and hands the item to
   portfolio task #8 explicitly; noted so the tick is not misread later.

## What was verified true (sampled, with evidence)

Task truthfulness — ~15 of 39 sampled, prioritizing refusal/guarantee/never claims:

| Task | Claim checked | Evidence |
| --- | --- | --- |
| 1.2/1.3 | 4 Store-level addresses; project/line input cannot change result; case-alias/traversal/device/zero-ordinal rejection | `store-issue-layout.test.ts` re-run solo 45/45; names map 1:1 to delta scenarios; type-level exclusion asserted in `store-query-lock-free.test.ts:158` |
| 2.2 | duplicate create refused without touching existing | `store-aggregate-query.test.ts:481` |
| 2.3 | ordinals in order, never rewritten, merge-planted revision left intact | tests at :525, :573, :597 |
| 2.4 | node-order canonicalization + guard discriminates | **independently re-proved by my own mutation**: removed the sort at `plans.ts:560`; canonicalization RED 3/10 naming exactly the three node-order cases; digest anchors stayed GREEN 3/3 (proving they bypass the normalizer); restored byte-exact, sha256 `a96b2b71...` equal before/after, matching the sha in task 2.4's record |
| 2.5 | uncommitted reference refused | `store-issue-uncommitted-reference.test.ts` (:169 refusal naming reason+intent, :200 committed publishes, :231 resolver reports rather than refuses) |
| 2.6 | released on failure; dead owner does not block | locks suite :158; delegation to `acquireOwnerAwareFileLock` + `workspace-locks.test.ts:295` (see Minor 4) |
| 3.3 | reads lock-free and byte-identical | lock-free suite :65/:98; aggregate :404 byte-identical pass; `store-query-read-only-guard` static suite (no write fns, no effectful git verbs, no spawn) |
| 3.5/7.4 | tampered digest reported unverifiable | aggregate test asserts `revision: null` + diagnostic naming `contentSha256` mismatch (:889-891) |
| 4.1-4.3 | commands, registry, three-locale lockstep | CLI suites in gate; deviation recorded in-place; `store.ts:1569-1579` registrations |
| 5.2 | wire-mirror guard incl. round-1 completeness repair | re-run solo 15/15 |
| 5.3 | incomplete scope refused; sole candidate never adopted | `stores.test.ts:318` (with explicit 1-project/1-line precondition), :349 whole-request refusal |
| 5.5 | no MODIFIED delta needed; new paths inherit security | verified: all 8 `/api/v1/stores/*` paths in the one `MANAGEMENT_PATHS` set (`router.ts:325-332`) |
| 7.5 | change/integration lock kinds have zero takers | grep: only barrel re-export in `src/`, only constructor unit tests in `test/` |
| 8.8 | additive-only src | re-derived myself: pre-merge own work 28 files +6048/-0; post-merge fix deletions (30) confined to this change's OWN new files, so every pre-existing `src/` file remains pure-addition at HEAD |

Suites independently re-run solo (all match recorded counts): canonicalization 10/10,
digest-anchors 3/3, wire-mirror 15/15, issue-locks 16/16, issue-layout 45/45, UI board
4/4, UI issues-view 7/7. `validate --type change --strict` passes (proves shape only).
`git diff --check 501b8943..HEAD` clean (CI whitespace gate).

Tasks file: 39 tasks, 39 `[x]`, zero `[ ]`, zero `[~]`.

## Archive projection — correct

`node bin/rasen.js archive 'store-issue-resources' --dry-run --json`: `blockers: []`;
plan = CREATE `store-aggregate-query`, `store-issue-resources`, `store-planning-layout-v2`
+ UPDATE `board-ui`, `management-http-api`, `management-ui-shell`.

- The three creates are genuine: none of the three exists under `rasen/specs/`.
- All six deltas are ADDED-only, so the heading-drift/implicit-delete trap cannot fire
  (nothing is renamed or replaced). Checked the other collision direction too: no ADDED
  heading duplicates any live requirement heading in the three update targets (11/18/6
  live headings compared).
- Sibling ordering is safe: S1 (`store-planning-contract-v2`) also carries a
  `store-planning-layout-v2` delta; its 8 ADDED headings and this change's 2 are disjoint,
  so whichever archives first, the second applies cleanly as an update. (This is why
  proposal.md lists the capability under "Modified" while a solo dry-run says "create" —
  not a defect.)

## Scope over `501b8943..HEAD` — clean

- The range contains merge `e6cd8860` (origin/dev/0.2.0: omnicross + Teacher fixes + lead
  handoffs) — attributed, not this change's work.
- This change's own work (branch side + post-merge fixes): exactly the scoped files. Zero
  matches for `finalization/`, `store-planning/`, `layout-migration/`,
  `layout-write-guard.ts`, `membership-layout.ts`, `consistency-gates.ts`,
  `migration-compiler.ts`.
- One out-of-change touch: `2d89ab38` reconciles sibling `store-worktree-bindings-v2`'s
  task 6.10 tick — LEAD-adjacent portfolio bookkeeping in its own commit, noted.
- Working tree left clean; probe test and mutation snapshot both removed; `plans.ts`
  restored byte-exact (sha verified).

## What blocks archive, exactly

1. B-V1: make the malformed-Change and malformed-Issue clauses of the
   partially-unreadable requirement true (surface the captured diagnostics + an entry for
   the dropped Change, with tests), or have the operator rule to reword the delta to what
   ships. As archived text today it is a false claim about product behaviour.
2. B-V2: same decision for the empty-project/empty-line scenario in BOTH
   `store-aggregate-query` and `board-ui` deltas (synthesize empty groups from the
   declared catalogs, or reword to the rollup listings) — and if implementing, fix
   `store-aggregate-query.test.ts:118` which currently pins the opposite.
3. M-V1: reconcile proposal.md's command-surface sentences with the shipped
   `store changes` / `store projects` spelling (and ideally note the unwired UI
   components, which design.md already records).
