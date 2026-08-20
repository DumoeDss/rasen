# Review report — issue-node-lifecycle (VERIFY, small-feature)

Reviewer: reviewer-node-lifecycle (independent; did not write the code)
Date: 2026-08-20. Worktree: `feat/issue-phase2` @ delta over `010dcf70`.
Method: claims-first sweep over proposal/design/tasks + all four deltas, full
source diff read, independent re-runs of every claimed batch (real exit codes,
`pnpm run build` first), independent digest-pin cross-check against the
PRE-CHANGE module, two mutation spot-checks, receipts and fences re-verified.

## Verdict

**PASS — no Blocker, no Major. 2 Minor, 3 informational.**

## 1. Unit-test gate (re-run by reviewer, real exit codes)

| Batch | Claim | Reviewer run | Result |
|---|---|---|---|
| New suites (schema/status/gate/CLI/binding) | 10+8+6+4+5-in-binding | run inside B/D below | all green |
| Store family + issue batch | 20 files / 236 | `npx vitest run <20 files>` → `Tests 236 passed (236)` | exit 0, count exact |
| Prior CLI suites | 5 files / 34 | 5 files → `Tests 34 passed (34)` | exit 0 |
| Trio zero-diff | 3 files / 34 | cli-presentation 11 + command-registry 7 + catalog 16 = 34 | exit 0 |
| New CLI lifecycle suite | 4 | 4 passed | exit 0 |
| `pnpm run build` | — | exit 0 (before CLI batches) | green |
| `node bin/rasen.js validate issue-node-lifecycle` | green | "Change 'issue-node-lifecycle' is valid" | exit 0 |

M-1 pin (`issue-plan-publication-resolution.test.ts`, "pins the M-1 layer
divergence…") ran green inside the 236 batch; the file is untouched (not in
`git status`). One claim discrepancy found — see Minor R1.

## 2. The flagged choice — `reason` on WANTED work refused at schema

**Grade: spec-faithful, not over-strict. Correctly implemented.**

The ADDED requirement mandates a reason for `cancelled`/`superseded`, refuses
out-of-vocabulary values, and refuses lifecycle on intent nodes — it never
authorizes a reason on wanted work, and the MODIFIED read-surface requirement
enumerates exactly when a reason is a readable fact ("a `cancelled` or
`superseded` node SHALL have its recorded reason shown with it" — nothing
else). A reason stored on an `optional` node would ride the digest body but be
shown on NO surface: accepting it would be the silent-absorption shape this
spec family refuses everywhere ("no plan SHALL be stored with a defect the
checker can name"; strict-read: visible, never silent). Refusal with a named
message (`plans.ts` validateNode: "a reason is recorded only for work the plan
no longer wants") is the family's idiom, and it is pinned by a test
(`store-issue-node-lifecycle.test.ts` "refuses a reason on wanted work").
The "operator documents why a node is optional" need is real product
speculation, but no spec text supports it and D5 deliberately added no surface
for it; loosening later is a one-line schema change plus a MODIFIED
requirement — refusing now costs nothing reversible. Informational I1 asks
that the closed reading be recorded in the spec text at archive time.

## 3. Task count — reconciled, no dropped work

tasks.md: 19 rows, 19 ticked, 0 unchecked (verified by grep). The "planner
said 21" figure was the planner's **scenario-title** count, not a task count:
auto-run.json propose note reads "scenario titles script-verified byte-stable
(**21 kept verbatim**, 0 renamed, 15 added)". The 15 new scenarios across the
four deltas are present; no task was dropped or silently merged.

## 4. Claim sweep

- **D2 digest stability — VERIFIED INDEPENDENTLY, methodology sound.** I
  materialized the PRE-CHANGE module (`git show 010dcf70:…/plans.ts`) as a
  sibling module and ran a one-off cross-check: (a) the old source itself
  mints the pinned literal `07e5b12c…` over the suite's exact fixture — the
  pin is a genuine pre-change anchor, not reverse-computed from new code; (b)
  old and new agree on BOTH `executionPlanDigest` AND the full
  `serializeExecutionPlanRevision` bytes over the same g-001-shaped revision —
  the serialized form is unchanged, not merely re-parseable. The two
  pre-existing intent-node pins (`d35cf8f0…`/`0961437e…`) also re-derived
  green inside the 236 batch.
- **Prior-test touches (exactly 2 files, as claimed).**
  `issue-status-projection.test.ts`: the all-intent plan's progress moved
  `{0,1}→{0,0}` — that IS the required-CHANGE-node re-scoping (an intent node
  is not a required node per the MODIFIED progress requirement); the assertion
  stays an exact-pair pin and a `lifecycle: null` check was added. Strength
  preserved. `issue-execution-binding.test.ts`: helper/type conformance only
  (`lifecycle`/`reason` defaults added; one intent literal null/null); all
  prior assertions untouched; 5 new lifecycle rows added. No other prior test
  file modified (git status confirms).
- **D3/D4 semantics through the stack** — verified in code and by named
  tests: progress required-only both parts; optional/cancelled/superseded
  named-not-counted; failure/blockage → health never phase (failures via
  wanted nodes only); optional never blocks on completion but a FAILED
  optional is failed health holding the gate as a `failing-node` blocker
  (gate-lifecycle test 5) — the D4 reading implemented as designed;
  cancelled-with-reason clears a wanted-work failure (gate-lifecycle test 6:
  live escalation on a cancelled node is only an exclusion); zero-required =
  stated 0/0 + vacuous eligible gate with exclusions and optional nodes named
  beside it (D6). The blocked-gate render's `requiredTotal` derivation from
  `status.nodes` uses the same change+required scoping as the gate's own
  accounting — consistent.
- **D5 no-new-surface** — trio re-run green (34/34); CLI renders carry
  lifecycle/reason/exclusions with no new commands/options/locales; `--json`
  parity asserted per fact in the CLI suite.
- **D7 M-1 fence** — pin test untouched and green (in the 236 batch).
- **Dogfood receipts** — receipt 1 (0001 via `--from-portfolio`, all
  required, 1/3) → receipt 2 (0002 copy-edit-publish with cancelled+optional):
  the CORRECTED comparison is right — the three equal file-digest lines are
  receipt-1:229 `01ffd5a8…`, receipt-2:5 (before), receipt-2:47 (after); the
  in-place correction note naming the earlier contentSha256 mistake is
  honest and the final comparison is against file digests. Progress re-scoped
  1/1, exclusion rendered with reason, start refused `issue_start_node_cancelled`
  exit 1, frontier still offered the optional node (advanced to workspace
  resolution = a wanted node was selected). Receipt 3: teardown with both
  registry namespaces cleared and temp root gone.
- **Fences** — `git diff -- src/core/pipeline-registry/ packages/ui
  package.json` → 0 bytes (re-measured); version numbers untouched;
  architecture-index diff is exactly the three claimed spots (7→9 refusal
  count; lifecycle scoping phrases), no module topology change.

## 5. Fixture-coincidence sweep (mutations)

- **Mutation 1** — removed the wanted-lifecycle filter from `isWanted`
  (`projection.ts`): exactly the two cancelled-outside-graph tests failed
  ("lets a cancelled node with stale in-flight run-state drive no phase",
  "treats a cancelled node with a recorded failure as history, not health").
- **Mutation 2** — removed required-only progress scoping
  (`const required = nodes`): 6 tests failed, including the moved prior pin
  ("derives planning for an all-intent plan" {0,0}) and four lifecycle rows.
  Both mutations reverted; tree verified byte-identical to pre-review state.

## Findings

### Minor

- **R1 — evidence log miscounts the binding file.**
  `evidence/affected-set-gate.log` §A says "issue-execution-binding.test.ts —
  35 tests (30 prior rows green unchanged + 5 new)". Actual: **29 tests (24
  prior + 5 new)** — pre-change file had 24 `it(` rows (verified against
  `git show 010dcf70:…`), current has 29, and my re-run confirms 29 green.
  All green either way, so there is no coverage consequence; the log's numbers
  are simply wrong and should be corrected before archive (evidence files
  must be accurate where quoted).
- **R2 — `ready` clause edge: spec-literal vs code on an intent +
  cancelled-only plan.** The MODIFIED phase requirement's ready clause still
  reads "a readable plan names at least one Change node and no node has
  started"; the code requires a **wanted** change node. A plan of one intent
  node + only cancelled/superseded change nodes (nothing started) is
  spec-literal `ready` but code `planning`. Neither the delta's planning
  definition ("names only intent nodes") nor its ready clause literally
  covers this corner. The code's reading follows design D3 (cancelled =
  outside the execution graph, so effectively an all-intent plan) and is
  defensible; the spec text kept the clause un-scoped. Uncovered by any
  scenario. Recommend scoping the synced clause at archive ("at least one
  Change node whose work the plan wants") or adding the scenario — no
  behavioral defect claimable today.

### Informational

- **I1** — the wanted-work reason refusal (§2) is pinned by code+test but not
  stated in the ADDED requirement's text; record the closed reading in the
  synced spec at archive time.
- **I2** — copy-edit-publish friction: `show --json` emits `"reason": null`
  on wanted node lines; pasting that verbatim into `--from-file` is refused
  with a zod format issue ("expected string") rather than the semantic
  message. Loud and by design (D5 accepts the clunk); cosmetic only.
- **I3** — `issue-status-lifecycle.test.ts` test 5 is titled "maps a failed
  optional node to failed health" but actually asserts a waiting-human
  escalation; the true failed-optional row lives in gate-lifecycle test 5.
  Coverage exists; the title is misleading.

## Commands of record (reviewer)

- `npx vitest run <20 store-family+issue files>` → 236/236, exit 0
- `npx vitest run <5 prior CLI files>` → 34/34, exit 0
- `npx vitest run <trio 3 files>` → 34/34, exit 0
- `npx vitest run test/commands/store-issue-lifecycle-cli.test.ts` → 4/4, exit 0
- `pnpm run build` → exit 0; `node bin/rasen.js validate issue-node-lifecycle` → exit 0
- Digest cross-check (temp module from `git show 010dcf70`, deleted after) → 2/2
- Mutations 1/2 → 2 and 6 named failures respectively, then restored

## Round-1 re-review (fix delta only)

Date: 2026-08-20. Scope re-reviewed: the five files named in
`evidence/fix-round-1.md` and nothing else.

**Verdict: CLEAN.** R1 and R2 resolved; I1 recorded; I2/I3 accepted as they
stand. No new findings.

- **Scope verified**: the tracked diff is byte-identical in aggregate to round
  1 (14 files, 555 insertions, 67 deletions; `projection.ts` still 101/37) —
  no production code, no prior test, and no other evidence file moved. The
  other new suites are unchanged (schema 10 with the wanted-work refusal test
  at :204; CLI 4; gate-lifecycle 6).
- **R2 resolved** — the MODIFIED ready clause now reads "at least one Change
  node **whose work the plan still wants (`required` or `optional`)**",
  matching `derivePhase`'s `wanted.length > 0 && wanted.every(not-started)`
  exactly. New scenario "A plan of intent nodes and only-cancelled nodes
  stays planning" and the new pin test ("stays planning for a plan of intent
  nodes and only-cancelled change nodes (R2 pin)") assert all five facts:
  phase `planning`, health `healthy`, progress `{0,0}`, lifecycle
  `cancelled`, observation `not-started`. The pin is discriminative: reverting
  the wanted-scoping in the ready branch (or `isWanted`) makes it fail.
- **I1 resolved** — the ADDED requirement now states the closed reading ("A
  reason SHALL be recorded only for `cancelled` and `superseded` nodes — a
  reason authored on wanted work … is refused rather than stored"), matching
  the round-1 grade (§2); the existing schema refusal test backs it, code
  unchanged.
- **R1 resolved** — §A corrected to "29 tests (24 prior + 5 new)" with the
  cause named in place (35 was the directory total: binding 29 +
  read-only-guard 6, which my round-1 batch output confirms) and the
  correction carried as an honest note rather than a silent rewrite.
- **Title discipline** — verified by full two-directional comparison of the
  two touched deltas against the synced specs (stronger than the requested
  spot-check): issue-status-projection carries exactly its 24 round-1 titles
  plus the 1 new R2 scenario (25 total); store-issue-resources is unchanged
  in scenarios (10); zero renames, zero drops; every delta title from round 1
  survives verbatim. The other two deltas are untouched (7 + 7).
- **Tests** — `npx vitest run issue-status-lifecycle issue-status-projection`
  → 2 files, **31/31 (9 + 22), exit 0**. `node bin/rasen.js validate
  issue-node-lifecycle` → valid, exit 0.
