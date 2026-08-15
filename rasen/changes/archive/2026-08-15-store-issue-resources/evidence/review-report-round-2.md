# Review report -- round 2 (`store-issue-resources`, S3 fix delta)

Reviewer: independent (authored neither the code, nor the round-1 review, nor the
fixes). Subject: exactly `git diff ef816972..HEAD` -- commits `87c11f19` (round-1
report artifact), `10b74431` (the fixes, 10 files), `076242c9` (task 2.5 record
correction) -- plus whether the delta broke anything around it.

Method: read the full fix diff and the current state of every touched source file;
re-ran every mutation claim myself from out-of-repo snapshots (in-place labels,
solo runs at `VITEST_MAX_WORKERS=1`, restores verified byte-exact by sha256 with
`git diff` empty after each); `pnpm run build` before any CLI suite (the
`ensureCliBuilt` staleness trap); one temporary probe file (written, run, deleted)
to measure the MINOR-2 residual empirically. Every RED/GREEN count below is my own
run, not the fixer's.

Legend: **CONFIRMED** = I re-ran or re-derived it this session. **PLAUSIBLE** =
reasoned from code, not executed.

Pre-mutation baseline hashes taken this session, all restored to exactly:
`issues/module.ts` `2f7821e2...`, `packages/ui/src/api/types.ts` `18d36de4...`
(matches round 1's recorded hash), `management-api/wire-types.ts` `78aa5825...`.

---

## Round-1 findings: closed or not

### BLOCKER-1 -- CLOSED (CONFIRMED, both mutations re-run)

`publishPlan` now refuses a node whose only evidence is the machine-local
workspace index, via `issue_reference_uncommitted` (`src/core/store/issues/module.ts:452-473`).

- Baseline: `test/core/store/store-issue-uncommitted-reference.test.ts` 3/3 GREEN
  solo (15.1s wall).
- **Mutation A** (restored `if (found === null) continue;`, the round-1 defect):
  RED **1/3**, exactly the refusal test; the committed case and the resolver-seam
  test stayed GREEN. The guard fires on the defect path.
- **Mutation B** (`if (resolved.localLocator !== null)` -- blanket refusal on any
  local locator): RED **1/3**, exactly "still publishes when the same instance IS
  committed, index entry and all". The refusal is conditional, not blanket.
- Both restores byte-exact (sha256 `2f7821e2...` re-verified, `git diff` empty).

**Design split judged SOUND.** `resolveChangeReference` has exactly one other
caller: `deriveReadiness` (`src/core/store/query/module.ts:600`), the read side,
which deliberately presents a locally-located node with its inert `localLocator`
(readiness `in-progress`). Refusing in the resolver would either break that read
or force a new status through `PlanNodeResolutionStatus`, the wire types, and the
UI mirror. The mutation path already layers stricter checks on the same resolver
output (`issue_reference_foreign_store`, `issue_reference_scope_conflict`,
module.ts:474-497) that the read side reports rather than refuses -- the fix
follows the module's established read/mutation asymmetry, and the new suite's
third test pins the seam so a later "simplification" into the resolver has to
break it. Rim checked: `issue_reference_uncommitted` is mapped in
`statusForIssueCode` (409, beside `issue_reference_unresolved`), and the code
union has no other consumer anywhere (no UI mirror of it, no locale table keyed
by it -- grep-verified).

Task 2.5's record correction (`076242c9`) is accurate: 39 tasks, all markers
`[ ]`/`[x]` (no `[~]`), and `node bin/rasen.js validate store-issue-resources
--type change --strict` passes at HEAD (CONFIRMED).

### MAJOR-2 -- CLOSED (CONFIRMED, both directions re-run + vacuous-pass probed)

The guard (`test/core/management-api/store-aggregate-wire-mirror.test.ts`) now
lists all 13 types and gained the section->list completeness direction. Baseline
15/15 GREEN solo.

- **Mirror direction** (renamed the UI mirror of `StoreExecutionPlanNodeInput`,
  the exact type that was blind in round 1): RED **1/15**, the `it.each` case
  naming it. Restored, sha256 `18d36de4...` re-verified.
- **Completeness direction** (added `export type StoreProbeUnlistedMutationR2`
  to the core file's Store-aggregate section BODY -- placement verified below the
  banner's closing `// -----` rule at wire-types.ts:1412, body runs 1413..EOF):
  RED **1/15**, the completeness test naming the probe. Restored, sha256
  `78aa5825...` re-verified.
- **Vacuous-pass probe** (renamed the banner title line): RED **1/15** with the
  explicit "no longer contains the banner line" error -- a failure, not a silent
  pass. The empty-section throw was verified by reading
  (`sectionExportNames` throws when `names.size === 0`); not separately run.

The updated evidence file's corrected numbers match my own runs exactly (1/15
each direction, the same two sha256 prefixes). TRIVIAL-1's other correction
(task 6.2's "3/5 for A alone") is consistent with round 1's re-run; not re-run
again here.

### MAJOR-1 -- measurement VERIFIED ACCURATE; the finding itself remains OPEN

The claim: siting a canonical sort in `normalizePlanNodes` moves zero pinned
literals. **CONFIRMED by my own enumeration:**

- The five task-7.1 anchors do not route through `normalizePlanNodes`.
  `store-issue-digest-anchors.test.ts` builds its revisions directly as typed
  objects (single-node, `nodes: [NODE]`) and never calls the normalizer; the
  lock-filename anchor and both read-side anchors (5a issue.yaml divergence, 5b
  committed-change de-dup) carry no plan nodes at all.
- `normalizePlanNodes` has exactly one production caller (`issues/module.ts:215`).
- Every multi-node plan published anywhere in the tree is already in `nodeId`
  order: `store-aggregate-query.test.ts` `[a]`/`[a,b]`/`[a,b,c]` (plan-order) and
  `[done-node, not-started]` (readiness; its order-sensitive assertion
  `['in-progress','blocked']` would not move); `stores.test.ts`'s
  `[complete-node, incomplete-node]` is refused before publication. Every other
  publish in `test/` and `packages/ui` fixtures is single-node. No committed plan
  revision fixture exists under `rasen/` or `.rasen/` (grep-verified).
- Additionally: reads verify the digest over the STORED node order
  (`parseExecutionPlanRevision(..., verifyDigest: true)`), so a publication-time
  sort could not invalidate any already-published revision either.

**But the contradiction round 1 reported still stands at HEAD**: the spec delta
(`specs/store-issue-resources/spec.md:126-127`) promises "two plans differ only
in node ordering ... THEN they normalize to the same canonical plan", and
`normalizePlanNodes` (`plans.ts:434-460`) still preserves input order. The
measurement establishes that EITHER resolution is now cheap and safe -- implement
the sort (nothing moves) or reword the scenario -- but one of them must still
happen before archive, or the delta lands a false SHALL as recorded truth. This
is the operator's ruling to make; the fix delta itself is honest about not making
it.

### MINOR-2 -- the reported symptom CLOSED; the class is NOT closed (new Minor below)

- The bogus-`kind` 500 is fixed: `findInvalidPlanNodes`
  (`src/core/management-api/stores.ts:420-450`) refuses it as 400
  `plan_node_invalid`. CONFIRMED: the 3 pure tests and the fixture-backed
  undefined-kind test all pass solo, and the refusal precedes every write.
- The fixer's `mapThrown` reasoning **checks out as far as it goes**:
  `StorePlanningValidationError extends Error` (`planning-validation.ts:37`),
  `isStoreIssueError` is an `instanceof StoreIssueError` check
  (`issues/diagnostics.ts:46-48`), so a THROWING schema check inside
  `normalizePlanNodes` surfaces as 500 `store_query_failed`
  (`stores.ts:173-181`). Declining that siting was correct.
- However, round 1's suggestion was `NodeSchema.safeParse` -- which does not
  throw. Sited in the HANDLER on the raw body (branch on `.success` -> 400), it
  would have closed the whole class, including what the shipped fix does not
  cover. The decline reasoning defeats a throwing variant of the suggestion, not
  the suggestion itself.

### MINOR-1 -- decline JUDGED SOUND

Revision-divergence parity would need a new read-side divergence model across
`readRevision`, `ResolvedExecutionPlan`'s wire shape, the UI mirror, and the
spec -- a design change, not an unambiguous repair, exactly as the fixer argued.
It remains a recorded, inherited asymmetry (round-1 report + fix commit message);
acceptable to carry.

### MINOR-3 -- CLOSED (CONFIRMED)

`store issue show`/`list` now print the plan digest, divergence copy digests,
plan diagnostics, and per-ref unsearched reasons (`src/commands/store-issue.ts`).
The new CLI test passes solo **against a freshly built `dist/`** and takes the
digest from the machine form rather than recomputing it. Build ran before the
suite (the `ensureCliBuilt` trap).

### TRIVIAL-1 / TRIVIAL-2 / TRIVIAL-3 -- CLOSED

- TRIVIAL-1: both evidence corrections verified against my own re-runs (mirror
  proof) and round 1's recorded re-run (scope 3/5). CONFIRMED accurate.
- TRIVIAL-2: `IssueRecordV1.reason`'s comment now states permitted-not-required;
  matches `records.ts` behavior. CONFIRMED by reading.
- TRIVIAL-3: `--state closed` now refuses naming the vocabulary
  (`issue_state_undefined`), and a defined state still filters. CONFIRMED solo
  against the fresh build (exit non-zero, names all four states, no
  "No Issues found.").

---

## New findings this round

### MINOR-R2-1 -- untrusted HTTP publish bodies can still 500 past `findInvalidPlanNodes` (CONFIRMED by probe)

`findInvalidPlanNodes` checks `kind` and the per-kind required field only. Two
bodies that pass it and still produce 500 `store_query_failed`, measured through
`handleStorePublishPlan` against a real fixture (temporary probe file, run solo,
then deleted):

- An intent node with a **501-char summary** -> 500, message `revision:
  nodes.0.summary: Too big: expected string to have <=500 characters`.
  `NodeSchema`'s `max(500)` is bypassed by `normalizePlanNodes` (it casts,
  `plans.ts:456`) and `assertPortableIssueText` has no length rule, so the limit
  is first enforced at serialize time (`serializeExecutionPlanRevision` ->
  `RevisionSchema`) -> `StorePlanningValidationError` -> `mapThrown` -> 500.
- A node with a **numeric `nodeId`** -> 500, message `nodes[0].nodeId:
  value.includes is not a function` (raw TypeError inside
  `assertPortableSegment`, wrapped by `rethrow` into the same 500 path).

Also in the class, reasoned not run (PLAUSIBLE): wrong-typed `dependsOn`
(spread of a non-iterable throws before `validateNode`; spread of a STRING
explodes into characters), non-string `changeAlias`. Nothing is written in any
of these -- the failure precedes every write -- so this stays Minor,
robustness/diagnostics, the same severity round 1 gave the class. Concrete fix
shapes: extend `findInvalidPlanNodes` with the remaining type checks, or run the
raw nodes through `NodeSchema.safeParse` in the handler (non-throwing) and 400 on
failure, which also retires the length gap.

### TRIVIAL-R2-1 -- `sectionExportNames` cannot see an export inside the banner comment block (CONFIRMED)

An export inserted between the banner title (wire-types.ts:1402) and the
banner's closing rule (:1412) is invisible to the completeness direction: probed
live, guard stayed **15/15 GREEN** with the export in place. Narrow by
construction -- it requires declaring a type in the middle of a prose comment
block, which no natural edit does -- and scanning from the title instead would
trade it for false positives on prose that mentions `export type X`. Recorded so
nobody claims the completeness direction is airtight; needs no fix in this
change. Related nuance, by reading only: the dedicated "banner has no closing
rule" throw is nearly unreachable mid-file (deleting the closing rule makes the
next section's rule terminate the header, and the empty-set throw backstops it);
harmless.

**No Blocker-grade and no Major-grade finding this round.** Severity levels
Blocker and Major are empty, stated rather than padded.

---

## Regression surface

- The exact case the brief flagged -- a plan node naming a Change that IS
  committed while a local planning worktree with the same instance sits beside
  it -- is the new suite's second test, GREEN at baseline and RED only under
  mutation B (CONFIRMED, both directions).
- `issue_reference_uncommitted` reaches no surface that switches on the code
  union except `statusForIssueCode` (updated); no UI mirror, no locale key
  (grep-verified).
- The touched CLI command still filters correctly for defined states (asserted
  inside the TRIVIAL-3 test), and the render additions are all
  null-guarded (`detail.plan.revision`, `diagnostic !== null`) -- build's `tsc`
  passes over them.
- Wire-mirror guard back to 15/15, uncommitted-reference back to 3/3 after all
  restores; working tree clean except the pre-existing untracked
  `test-engine-ownership-tmp/`.

## Runs taken (all solo, `VITEST_MAX_WORKERS=1`, this worktree)

GREEN baselines/re-runs: `store-aggregate-wire-mirror` 15/15 (x3: baseline and
after each restore); `store-issue-uncommitted-reference` 3/3;
`stores.test.ts -t "findInvalidPlanNodes"` 3/3; `stores.test.ts -t "refuses an
undefined node kind"` 1/1; after `pnpm run build`: `store-issue-cli -t
"round-1 TRIVIAL-3"` 1/1 and `-t "carries the plan digest"` 1/1;
`validate --type change --strict` passes. Probe run: minor2-residual probe 1/1
(observations above; file deleted after).

RED (mutations, each restored byte-exact): module.ts mutation A 1/3; module.ts
mutation B 1/3; ui-types mirror rename 1/15; wire-types unlisted-export 1/15;
wire-types banner rename 1/15 (throw). Deliberate GREEN-under-mutation probe:
banner-block export 15/15 (the documented blind spot).

Not re-run, relied on round 1 + the fix delta's own solo records: the full
`stores.test.ts` (~200s), full CLI suites, `store-aggregate-query` (315s), the
UI component suites. The portfolio gate is explicitly not mine to take, and task
8.3 remains open as round 1 recorded.
