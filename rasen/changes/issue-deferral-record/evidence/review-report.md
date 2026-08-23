# Verify review — issue-deferral-record (P6 g-003)

Reviewer: fresh verify-stage reviewer (did not implement). Report-only pass over
branch `feat/issue-phase6` at HEAD `62553fe0` + the uncommitted g-003 working-tree
changes. All commands run from the `issue-layer` worktree; `pnpm run build` first,
dist freshness confirmed by mtime (seconds before first CLI capture) and by
`grep deferred` in the emitted JS.

Scope reviewed: `rasen/changes/issue-deferral-record/` (proposal, design, 6 MODIFIED
deltas, 18 tasks all `[x]`, 12 evidence receipts), plus the uncommitted implementation:
13 modified src files, 3 modified suites, 4 new suites (`git status`/`git diff` circled;
`review.ts` untouched, `projection.ts`/`attention.ts`/`confirm.ts` comment-only —
verified against the full 835-line diff, not the stat).

---

## 1. Isomorphism with cancelled/superseded — PASS

Point-by-point, `deferred` gets exactly the mechanics of the other two not-demanded
values:

- **Mandatory reason at the schema**: `plans.ts:214` extends the one conditional;
  reasonless deferral refused with field `nodes[i].reason`
  (`store-issue-deferral-record.test.ts:119`, live CLI ring 4: exit 1, "recorded
  reason", zero bytes written). Portable-durable-text check is the same shared path
  (`assertPortableIssueText`); a path-shaped deferred reason refuses at the schema
  (test :132; record-level too at :371).
- **Change-node-only**: intent-node `deferred` refused with its own message naming the
  two honest spellings (`plans.ts:261-267`; test :145; live ring 4).
- **Canonical form omits only `required`**: serialized revision carries
  `lifecycle: deferred`, required sibling carries neither field (test :109-116; live
  `0002.yaml` bytes).
- **Lifecycle change only via a new revision**: revision 0002 at the next ordinal,
  predecessor bytes byte-identical after the deferral
  (`store-issue-deferral-record.test.ts:217`; live ring plans dir `0001+0002`).
- **Old digests byte-stable**: the four-value-era digest literal
  `07e5b12c…` is **copied** from `store-issue-node-lifecycle.test.ts:93` into the new
  suite (:200, :213) — not recomputed — and both suites are green, so a canonical-body
  drift would break the pin in both places. Pre-field acceptance record's exact bytes
  hand-assembled and matched (`store-issue-deferral-record.test.ts:327-343`);
  `exclusions: []` still reads back as absence.

Deliberate, documented anisomorphism: the refusal *stance* differs ("postponed beyond
this Issue" vs "its work is not wanted") and the code is its own
(`issue_start_node_deferred`) — the same per-value structure cancelled/superseded
already have. Consistent with design D1/D5.

## 2. Negative-enumeration sweep (independent, whole repo) — PASS

Independently grepped all of `src/` (and `packages/`) for every site where `cancelled`
and `superseded` are jointly judged, then classified each. Runtime judgment points on
the **node lifecycle** axis:

| # | site | disposition |
| --- | --- | --- |
| 1 | `gate.ts:73-75` lifecycleAccounting | handled (`deferred` → exclusions) |
| 2 | `gate.ts:186-188` failing-node skip | handled |
| 3 | `ready-set.ts:56-58` exit ladder | handled (`deferred` exit before observation switch) |
| 4 | `binding.ts:307-321` addressed `--node` refusal | handled (own code + own stance) |
| 5 | `binding.ts:359-364` not-runnable reasons enumeration | handled |
| 6 | `plans.ts:214` reason conditional | handled |
| 7 | `plans.ts:261-275` intent-node refusal | handled (dedicated deferred branch) |
| 8 | `acceptance.ts:125` RecordExclusionSchema enum | widened |
| 9 | `store-issue.ts:1153-1158` renderReadyExit switch | case added (the one CLI edit) |

Type unions widened in step: `store/issues/types.ts:161,322`,
`issue-acceptance/types.ts:137`, `issue-status/types.ts` exit union,
`issue-execution/types.ts` refusal code. Every other lifecycle check in the repo is
**positive** (`required`/`optional`: `isWanted`/`isRequired` in projection :664/:669,
attention :60, ready-set :41, binding :66, confirm :57, review :151,
`store-issue.ts` :450/:583/:1110/:1145) — a fifth value falls out, not through.

No seventh unhandled runtime judgment point exists. Checked and cleared as
different-axis or fail-closed:

- `ExecutionPlanNodeLifecycle` has exactly three consumers (`store/issues`,
  `issue-status/types`); **no wire-type mirror** (`WireFinalizationOutcome`'s
  `superseded|cancelled` is the finalization-outcome axis), **no packages/ui
  consumer** (only hit is unrelated canvas code), completions' vocabulary
  (`command-registry.ts:216`) is finalization outcomes.
- `issue-publication/decomposition.ts:49` authors intent nodes with a closed
  `required|optional` zod enum — a decomposition authoring `deferred` is refused,
  not absorbed.
- `findPlanNodeSchemaProblems` (`plans.ts:747`) routes through the same
  `validateNode`, so the reporting boundary inherits the deferred rules (pinned).
- Templates (`_orchestration.ts` etc.) enumerate cancelled/superseded in prose only;
  the normative "required and optional only" phrase stays true — consciously left
  untouched per proposal (skill-template hash coordination avoided).

## 3. Positive checks zero-change + seam evidence — PASS

- `git status` circles the change: `review.ts` is **not modified** (absent from the
  diff entirely). `attention.ts` (6 lines), `projection.ts` (8), `confirm.ts` (8) are
  comment-only — verified hunk by hunk in the full diff.
- Seam proven by test, not comment: `issue-deferral-family.test.ts:284` — deferring a
  previously optional in-flight node dissolves its `optional-open` thread
  (before: exactly `['optional-open']`; after: `[]`, and no thread kind contains
  "defer"); determination `JSON.stringify`-**byte-identical** across the deferral
  (:296-304) — no second blocking basis. Deferral's only home is the gate exclusion
  account (:306). Honest leftovers pinned: lifecycle-blind `archive-pending` still
  fires for a deferred node (:319).
- Discriminating halves everywhere: same failure on a wanted node still drives health/
  failing-node blocker; same observation on wanted work still raises attention — so
  the silences belong to the lifecycle, not to weakened derivations.

## 4. Gate refusal order byte-stable — PASS

- The refusal ladder region of `gate.ts` is untouched by the diff (only accounting,
  failing-skip, and comments changed). Code set unchanged:
  `IssueAcceptanceRefusalCode` still exactly
  `requires_plan | conditions_required | already_accepted | dropped | blocked`
  (`issue-acceptance/types.ts:120-125`) — zero new codes.
- The order pin is real, read at assertion level:
  `issue-acceptance-gate-deferral.test.ts:473-511` holds **multiple refusal conditions
  at once** over a deferred-only plan and peels them off one rung at a time — dropped
  outranks an existing record; already_accepted outranks missing plan/conditions;
  requires_plan outranks missing conditions; conditions_required outranks fact
  blockers; blocked is last and never names the deferred node. That pins relative
  priority (shadowing), not just code presence. Mutation M1 additionally shows the
  suite is sensitive to the accounting itself.

## 5. Spec ↔ implementation 1:1 + archive precheck — PASS (one Minor, one Info)

- **Archive guard precheck (scripted, all six capabilities)**: every MODIFIED
  requirement title byte-matches its main spec; every existing scenario present with
  **byte-identical body** (zero renames, zero losses); 10 new scenarios are appended
  only. Requirement-body sentence diff shows exclusively the intended widenings.
  `node bin/rasen.js validate issue-deferral-record` → valid.
- **Every new scenario has an implementation + test witness** (spot-mapped all ten:
  publish/read-back, reasonless refusal, intent refusal, gate exclusion eligible +
  failure-not-blocker, record freeze, phase/health/progress family pins, node line,
  ready exit + deferred-dependency blocking, start refusal, review-seam dissolution).
- **D5 wording deviation verified sound** (Info, no action): design D5 said
  `refusalFix` "reuses the existing lifecycle-refusal fix text"; the implementation
  reworded the shared head "The plan does not want this node's work." →
  "The plan does not demand this node's work now." for all three codes.
  No test or spec anywhere pinned the old head (checked HEAD-version suites and all
  of `rasen/specs/`); the delta spec's own rationale ("not demanded now") matches the
  NEW text; the cancelled/superseded refusal *messages* are byte-unchanged. The
  deviation makes the shared text true of deferral — sound. The reworded existing pin
  (`store-issue-node-lifecycle.test.ts:206`) is the plans.ts message pin, which design
  D1 itself prescribes.
- **Info**: the delta requirement's rationale clause "because the plan says its work
  is not demanded now" is family-level prose; the cancelled/superseded runtime
  message still says "its work is not wanted". Nothing quotes a message and the
  scenarios pin only "naming the node, lifecycle, reason" — no archive hazard.

### Finding F1 (Minor) — an existing scenario's WHEN premise is falsifiable after the widening

`rasen/changes/issue-deferral-record/specs/issue-acceptance-close/spec.md` (and today's
main spec), requirement "The acceptance record is durable close evidence", scenario
**"A record with no exclusions writes the absent form"**:

> WHEN an Issue whose plan carries no cancelled or superseded nodes is accepted
> THEN the record's stored bytes omit the exclusions field

Post-widening there is a counterexample: a plan with one complete required node and one
`deferred` node *carries no cancelled or superseded nodes*, yet its accepted record
correctly **carries** an exclusion — the literal WHEN is satisfied while the THEN is
false. The scenario title ("no exclusions") carries the real intent, runtime behavior
is correct and separately pinned, and the byte-verbatim-existing-scenarios discipline
explains how it survived — but a MODIFIED requirement may edit scenario bodies, and
this one now needs it ("no cancelled, superseded, or deferred nodes"). No other
existing scenario in the six deltas (or in the unmodified issue specs — checked
`issue-needs-attention`, `issue-plan-publication`, `issue-delivery-evidence`) is
falsifiable this way: the other enumerating premises merely under-cover, they do not
contradict.

**Recommendation**: one-line WHEN edit in the delta before archive (or as an immediate
follow-up); no code change.

## 6. Live evidence — PASS

**Temp-store ring, replayed independently** (own bootstrap script importing dist only —
no test-harness code; hermetic store built from scratch: layout-v2 checkout, registries
under redirected XDG, identities via `deriveChangeInstanceId`; real
`node bin/rasen.js` throughout; tree deleted on success). Four rings, 40/40 checks:

1. publish rev1 → conditions → rev2 deferral → `show` human+`--json`: node line
   `(deferred: <reason>)`, delta `~ lifecycle g-opt (optional -> deferred)`, gate
   exclusion on the **blocked** evaluation, `--json` parity for node/delta/exclusions/
   blockers.
2. `ready` members `[g-001]`, exit `{kind: 'deferred', reason}` (human
   `deferred (<reason>)`); `start --node g-opt` → exit 1, `issue_start_node_deferred`,
   message names node+lifecycle+reason+postponed stance, fix points at re-publishing,
   `binding: null`; **writes-nothing**: sha256 tree fingerprints of store checkout and
   global data dir identical across all reads, porcelain empty.
3. terminal run-state for the required node → `accept`: gate `1/1`, exclusion named on
   the **eligible** evaluation; `accepted.yaml` bytes carry the
   `exclusions:` block verbatim inside the digest body; post-accept `show --json`:
   `record.exclusions` parity, phase `done`.
4. reasonless deferral + deferred intent node both refused, exit 1, zero bytes
   written, plans dir still exactly `0001.yaml, 0002.yaml`.

**Persistent store `issue-registry`, read-only**: HEAD `3af7041e` and empty porcelain
confirmed **before and after**. Re-captured `show` for
`issue-cross-project-replanning` and `issue-multi-change-execution` on the widened
build: both **byte-identical** to the checked-in receipts
(`readonly-1`, `readonly-4`) modulo the receipts' `$ command` header lines (scripted
normalize-and-compare). Zero `deferred`/`excluded` tokens invented; determinations,
timestamps, and thread inventories unchanged from the g-002 era.

## 7. Mutation checks — PASS (3/3 caught, byte-clean restores)

| # | mutation | landing site (unique, line-verified) | mutated run | restore | re-run |
| --- | --- | --- | --- | --- | --- |
| M1 | drop `deferred` from gate exclusions routing | `gate.ts:74` | RED — 6 failures (eligible/blocked exclusion rows, failing-skip, 0/0, record freeze, ladder fall-through) | sha256 identical | GREEN |
| M2 | drop `deferred` arm of the addressed `--node` refusal | `binding.ts:308` | RED — 2 failures (own-code refusal, fix routing) | sha256 identical | GREEN |
| M3 | revert the `deferred` ready-exit kind | `ready-set.ts:58` | RED — 3 failures (deferred exit rows) | sha256 identical | GREEN |

Each mutation asserted a **single** occurrence of its target before applying, was backed
up to `.rasen/`, restored byte-identically (sha256 compared), and the focused suite
re-ran green. The matrix suites discriminate, they do not decorate.

---

## Test runs (all green, per-file, no full suite)

- `store-issue-deferral-record` + `store-issue-node-lifecycle` +
  `store-issue-intent-lifecycle` + `store-issue-acceptance-content` +
  `store-issue-acceptance-exclusions` + `store-issue-plan-canonicalization`:
  **66 passed**.
- `test/core/issue-acceptance/` (4 files incl. new gate-deferral) +
  `issue-execution-binding` + `issue-execution-confirm`: **78 passed**.
- `issue-deferral-family` + `issue-ready-set` + `issue-attention` +
  `issue-unified-review` + `issue-status-lifecycle`: **60 passed**.
- `store-issue-deferral-cli` (real dist CLI): **2 passed**.
- `store-issue-lifecycle-cli` + `store-issue-ready-cli`: **7 passed**;
  `store-issue-start-cli` + `store-issue-acceptance-exclusions-cli`: **11 passed**.
- `issue-status-projection` + `issue-status-revision-delta` +
  `issue-ready-set-equivalence`: **41 passed**.
- `node bin/rasen.js validate issue-deferral-record`: valid.

Total: **265 tests / 25 files green** + 40/40 live-replay checks + 3/3 mutations
caught. No failures anywhere; no flake encountered.

## Findings summary

| ID | Severity | Finding |
| --- | --- | --- |
| F1 | Minor | Existing scenario "A record with no exclusions writes the absent form" (issue-acceptance-close): literal WHEN ("no cancelled or superseded nodes") admits a deferred-node counterexample after the widening — one-line premise edit recommended before/at archive. |
| F2 | Info | D5 deviation (shared refusalFix head "does not want" → "does not demand … now") verified sound: nothing pinned the old text, delta phrasing matches the new text, cancelled/superseded messages byte-frozen. |
| F3 | Info | Delta rationale "not demanded now" vs cancelled/superseded runtime message "not wanted" — family-level prose vs per-value message; nothing quotes a message; no hazard. |

VERDICT: FINDINGS (1 Minor, 2 Info — nothing blocks ship; F1 is a one-line delta-spec
premise edit best taken before archive)
