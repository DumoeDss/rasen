# Design — issue-unified-review-gate

## Context

g-001 shipped the delivery rollup (`deriveIssueDeliveryEvidence(revisionId, status)` in
`src/core/issue-status/delivery.ts`): per-node delivery facts ride
`IssueNodeStatus.delivery`, show renders a delivery section, `--json` carries the rollup.
The acceptance gate (`src/core/issue-acceptance/gate.ts`) evaluates eligibility over the
projection with a single-order refusal taxonomy (`issue_accept_dropped >
already_accepted > requires_plan > conditions_required > blocked`), and its evaluation
rides `status.acceptance.gate` whenever the read supplied acceptance facts — which show
always does. Attention (`deriveIssueAttention(issueId, status)`) owns the
needs-a-human vocabulary. Every input the unified review needs is therefore already
derived on the one show read; g-002 is the composition that ties them into one
Issue-level conclusion.

The four closed Issues on `issue-registry` (binding receipts material): all four read
`accepted` determinations with threads standing — nine `record` rows each contributing
`evidence-missing: verification-report`, three run-terminal nodes contributing
`archive-pending` (one cross-project via workspace-index).

Constraints (portfolio fences): no UI, `pipeline-registry`/`packages/ui` frozen, no
version changes, one projection seam, close acts only in evidence, human/JSON parity, no
invented verdicts.

## Goals / Non-Goals

**Goals**

- One Issue-level review conclusion, machine-checkable, composable by g-003's dogfood and
  later automation.
- The reviewer's full picture in one place: what blocks (the gate's own blockers), what is
  merely still moving (threads), what the evidence standing is (counts by reference).
- Determinism and seam discipline: pure derivation over the same status, zero new reads.

**Non-Goals**

- No re-derivation, widening, or narrowing of the gate's rule — the gate is the one
  blocking basis; the review lens maps it, never re-evaluates it.
- No verification verdicts: review-report prose stays repo-side and unparsed; recorded
  `missing[]` names inform as threads.
- No new CLI verb/flag; no `list` change; no persistence; no attention-verb change.
- No treatment of `not-archived` as damage — binding planner finding: it is expected
  progress.

## Decisions

### D1 — The determination maps the gate's evaluation; the gate stays the one blocking basis

`IssueReviewDetermination` is a closed vocabulary mapped one-to-one from
`status.acceptance.gate`:

| gate outcome | determination | carried facts |
| --- | --- | --- |
| `eligible: true` | `review-ready` | `conditionsRevisionId` |
| `issue_accept_already_accepted` | `accepted` | record's `acceptedAt`, `conditionsRevisionId` |
| `issue_accept_blocked` | `not-ready` | blocker count (the blockers stay in `status.acceptance.gate.blockers` — rendered above in the acceptance section, not duplicated) |
| `issue_accept_conditions_required` | `conditions-missing` | the gate's own message |
| `issue_accept_requires_plan` | `no-plan` | — |
| `issue_accept_dropped` | `dropped` | — |
| `status.acceptance === null` | `acceptance-unknown` | the omission named |

*Why a mapping and not a re-evaluation:* two evaluations of one rule is the two-truths
failure — the review view and `store issue accept` could disagree about eligibility. The
mapping is total (the refusal codes are a closed Zod union), so the compiler pins
exhaustiveness. The LEAD's message phrased the rule as "all wanted nodes terminal"; the
roadmap's own formula (全部必需完成) and the gate's shipped ruling agree on REQUIRED scope
with optional/cancelled/superseded excluded — the determination follows the gate, and
optional-incomplete work rides as the `optional-open` thread. This also sets up g-003
cleanly: a deferred optional node will stop reading as an open thread once its disposition
vocabulary exists, without this change's determination ever having needed a second basis.

*Why `acceptance-unknown` rather than null:* attention's precedent — the item still fires;
a read that omitted acceptance facts is a named condition of THIS read, not absence of a
review view. Show always supplies the facts, so the state is reachable only from partial
compositions (unit-pinned).

### D2 — Threads are the gate's deliberate exclusions, composed from the same status

Closed kinds, each carrying its node where it names one:

- `optional-open` — a wanted optional node whose observation is not terminal
  (`in-flight | advanced | waiting-human | failed | not-started | unknown`), named with
  the observation. Failed/waiting optional nodes ALSO surface as attention threads — two
  threads naming one node is the honest overlap: one names progress, one names trouble.
- `archive-pending` — delivery state `not-archived` on any change node (its observation
  rides in the entry). Expected progress, per the binding finding.
- `record-absent` — delivery state `no-record`: the evidence hole named.
- `evidence-missing` — the `missing[]` names a `record` froze (one thread per node,
  carrying the names).
- Attention-mapped `failure` / `blocked-behind` / `waiting-human` — composed by calling
  `deriveIssueAttention(issueId, status)` and mapping its items. `acceptance-awaiting` is
  excluded (it IS the review-ready conclusion), and `problem` items are excluded (every
  standing problem is a gate blocker the `not-ready` determination carries; a thread copy
  would read as if it did not block).

Ordering: attention threads first in the attention fail-first kind order (stable
(issueId, nodeId) within), then `optional-open`, `archive-pending`, `record-absent`,
`evidence-missing` in (kind, nodeId) code-point order. Threads never block — pinned by a
test that a review-ready Issue with every thread kind standing still reads `review-ready`.

### D3 — Signature and shape: plain strings beside status, never null

```ts
deriveIssueReview(issueId: string, revisionId: string | null, status: IssueStatus): IssueReview
```

— the delivery rollup's signature precedent (`deriveIssueDeliveryEvidence(revisionId,
status)`; attention's `issueId`). Never null: a no-plan Issue derives `no-plan` (attention's
no-null reasoning — every Issue has a review answer). The shape:

```ts
interface IssueReview {
  readonly issueId: string;
  readonly revisionId: string | null;
  readonly determination: IssueReviewDetermination; // discriminated: carries its facts
  readonly threads: readonly IssueReviewThread[];
  readonly verification: {
    readonly progress: IssueProgress | null;      // status.progress by reference
    readonly delivery: IssueDeliveryCounts | null; // the rollup's counts (null: no readable revision)
  };
}
```

No embedded blocker list, no embedded delivery entries — those live in `status` and
`delivery` of the same payload; the review view references and summarizes, it does not
copy. Internally the derivation calls `deriveIssueDeliveryEvidence(revisionId, status)`
and `deriveIssueAttention(issueId, status)` — both pure over the same input, so one
status yields one coherent triple (status facts, delivery rollup, review view).

### D4 — Surface: the concluding section, additive payload key

Show's current order is status → acceptance → delivery evidence; the `review:` section
renders after delivery (the conclusion concludes). Human shape:

```
  review:
    determination: review-ready (would accept conditions revision 0001)
    threads: 2
      archive-pending issue-persistent-baseline (run-terminal — evidence will exist when the Change archives)
      evidence-missing issue-node-lifecycle: verification-report
    verification: required 3/3, delivery 2 record / 0 no-record / 1 not-archived / 0 unreadable / 0 unattributed
    review derives; accepting remains the operator's act.
```

`--json` gains `review` beside `status` and `delivery` (same derivation call site as the
delivery rollup — one more line in show's action). `list` untouched. `not-ready` renders
`determination: not-ready (N blocker(s) named above)` — the acceptance section above
already lists them; the review block carries no duplicate.

### D5 — Dogfood split

Real store (read-only): the four closed Issues each read `accepted` + threads — the
retrospective review view; one `--json` parity receipt. Temp stores + units: the full
determination matrix (`review-ready` with threads standing, `not-ready` with mixed
blockers, `conditions-missing`, `no-plan`, `dropped`, `acceptance-unknown`), thread
mapping pins (attention overlap, exclusions), ordering stability, purity, parity,
write-nothing bytes. Fixture recipes extend the delivery suites'.

## Risks / Trade-offs

- [The determination could read as a re-statement of the gate with no added value] → the
  added value is the composition: threads + verification summary + the closing narrative
  a reviewer acts on, and the machine-checkable key g-003/automation consume; the design
  keeps the mapping honest rather than padding it with a second basis.
- [Attention threads duplicate facts the status section already shows] → deliberate:
  the review view must be readable alone; duplication is between SECTIONS of one read
  (consistent by construction), never between two derivations.
- [`optional-open` for failed optional nodes overlaps attention `failure` threads] → both
  name the node with their own fact (observation vs attention context); dropping either
  would hide a fact the reviewer asked for.
- [Threads list could grow with evidence inventory size] → threads are per-NODE (one
  `evidence-missing` thread carries all of a node's missing names), bounded by the
  revision's node count.

## Migration Plan

Additive: one new module, additive types, one additive CLI payload key, one new section.
No stored bytes change; no config; rollback is revert. The four closed Issues need no
touch — their `accepted` determinations derive from records already on the store.

## Open Questions

None blocking. g-003's deferral vocabulary will interact with `optional-open` (a deferred
optional node should stop reading as an open thread) — that is g-003's delta to THIS
capability, spec'd there.
