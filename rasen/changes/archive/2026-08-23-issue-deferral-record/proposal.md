# Proposal — issue-deferral-record

## Why

The Issue lifecycle vocabulary can say that work was abandoned (`cancelled`) or replaced
(`superseded`), but it cannot say the thing operators actually do to optional work at close
time: postpone it. Today an optional node the operator decides not to pursue for THIS Issue
has only dishonest spellings — leave it `optional` and let it dangle as an `optional-open`
review thread forever, cancel it and falsely record abandonment, or drop it from the next
revision and lose the record entirely. The roadmap's §10 exit criterion names the gap
directly: 可选节点延期或取消的明确记录 — cancellation exists, deferral does not. The Phase 6
charter fixes the semantics: an explicit `deferred` lifecycle with a recorded reason, where
deferral never holds the Issue's Done but is recorded on the books — in the immutable plan
revision, beside the acceptance gate, and frozen into the acceptance record. g-002 left the
seam on purpose: the review view's `optional-open` thread checks the `optional` lifecycle
positively, so a deferral dissolves the thread with no new determination branch and no second
blocking basis.

## What Changes

- The plan-node lifecycle vocabulary widens from four values to five: `required`, `optional`,
  `cancelled`, `superseded`, `deferred`. A `deferred` node records work the Issue still
  intends but explicitly postpones beyond this Issue's completion — postponed, not abandoned.
  It is Change-node-only (like `cancelled`/`superseded`), requires a recorded
  portable-durable reason, is stored in the canonical form exactly as the other non-required
  values are (absent still reads `required`; published digests never move), and a deferral is
  expressed only as a new revision.
- The acceptance gate treats a deferred node as the third member of the not-demanded family:
  excluded from the required total, never an un-terminal or failing blocker, and named beside
  the gate as an exclusion with its recorded reason — on the eligible and the blocked
  evaluation alike. Deferral does not hold Done.
- The acceptance record freezes deferred exclusions exactly as cancelled/superseded ones:
  node, lifecycle, reason, inside the same digest-covered canonical form. The
  absent-when-none discipline is untouched, so pre-field records and no-exclusion records
  read back byte-identical.
- The projection's axes stop at the same family line: a deferred node's recorded activity
  drives no phase, its recorded escalation is history rather than health, its completion is
  counted in neither part of any progress pair or lane, and its observation stays reported on
  its node line with the deferral and its reason named.
- The ready set names a deferred node's exit honestly — a new `deferred` exit kind carrying
  the recorded reason (without it, the value would fall through to "blocked" with zero
  blockers, a lie) — and `store issue start --node` refuses a deferred node with its own
  refusal code naming the lifecycle and the reason (without it, a deferred node would emit a
  launch contract). The frontier, confirm scope, attention items, and review threads already
  exclude deferred nodes through their positive `required`/`optional` checks — zero logic
  changes there, pinned by tests and spec scenarios.
- The unified review view is UNCHANGED in code: deferring an optional node dissolves its
  `optional-open` thread through the existing seam, the determination never gains a second
  blocking basis, and the recorded deferral rides the gate's exclusion account the acceptance
  section already presents — no new thread kind.

## Capabilities

### New Capabilities

None. The deferral is a widening of the existing closed lifecycle vocabulary; its truths are
owned by the six specs that already carry that vocabulary. A seventh capability spec would
restate each of them — the two-witness drift this campaign refuses (the original
issue-node-lifecycle delivery set the precedent: distributed deltas, no spec of its own).

### Modified Capabilities

- `store-issue-resources` — the closed lifecycle vocabulary gains `deferred`: Change-node-only,
  reason required, refusals named per kind.
- `issue-acceptance-close` — the gate excludes deferred nodes with their reasons; the
  acceptance record freezes deferred exclusions.
- `issue-status-projection` — phase, health, progress, and the node-line naming extend the
  not-demanded family to `deferred`.
- `issue-ready-set-scheduling` — the closed exit vocabulary gains the `deferred` exit with its
  recorded reason.
- `issue-execution-binding` — `--node` naming a deferred node is refused, naming the lifecycle
  and the reason.
- `issue-unified-review` — a deferred node is no `optional-open` thread; the determination
  gains no second basis; the deferral's home is the exclusion account.

## Impact

- Code: `src/core/store/issues/{types,plans,acceptance}.ts` (vocabulary, publication
  validation, record schema), `src/core/issue-acceptance/{gate,types}.ts` (exclusion
  accounting, failing-node skip), `src/core/issue-status/{types,ready-set}.ts` (exit kind),
  `src/core/issue-execution/{types,binding}.ts` (start refusal),
  `src/commands/store-issue.ts` (ready-exit rendering; node line and gate exclusion
  rendering are already generic). Comment-only touch-ups where cancelled/superseded are
  enumerated in prose.
- Deliberately untouched: `review.ts`, `attention.ts`, `projection.ts` logic (their positive
  lifecycle checks absorb `deferred`), `delivery.ts`, wire-types (no node-lifecycle mirror
  exists), locales and completions (their `superseded`/`cancelled` strings are the
  finalization-outcome vocabulary, a different axis), skill templates (the normative
  "required and optional only" phrase already excludes deferred), and the frozen zones
  (`src/core/pipeline-registry/`, `packages/ui/**`).
- Compatibility: every pre-field byte reads back unchanged on the new build. An OLD build
  reading a revision or acceptance record that carries `deferred` refuses with its named
  unreadable problem — fail-closed, the same class as every prior vocabulary widening.
- No new command, flag, store file, or index shape. No version bump.
