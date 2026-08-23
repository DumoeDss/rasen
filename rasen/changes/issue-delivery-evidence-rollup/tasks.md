# Tasks — issue-delivery-evidence-rollup

## 1. Store query: extract and thread the delivery block

- [x] 1.1 Add the `IssueArchiveDelivery` fact block to `AggregateArchiveEntry` and
  `PlanNodeResolution` in `src/core/store/query/types.ts` (additive; optional on the
  resolution, `null`/absent when no record was consulted — the `outcomeBasis` pattern).
- [x] 1.2 In `readArchiveEntry` (`src/core/store/query/module.ts`), extract the block per
  design D2: v1 ledger fields read defensively verbatim (absent/wrong-typed → named
  absence, never repaired), v2 mapped from the validated record (`codeMerge.commit`,
  `planning.sourceRef`, `outcome`, `evidence`, `missing`, `archivedAt`); `null` on the
  `text === null` branch.
- [x] 1.3 Thread the block through `deriveReadiness` onto `PlanNodeResolution` beside the
  existing `outcomeBasis` spread (`module.ts:709-715`).

## 2. Projection: carry per-node delivery facts

- [x] 2.1 Add `IssueNodeDelivery` to `src/core/issue-status/types.ts` (the five named
  states of design D2 + `null` for intent nodes) and the `delivery` field on
  `IssueNodeStatus`.
- [x] 2.2 In `projection.ts`, copy the resolution's delivery block onto every change-node
  branch in ONE widening wrapper (the attribution pattern): `record`/`no-record` from an
  archived resolution, `not-archived` from a resolved non-archived one, `unreadable` from
  the invalid basis, `unattributed` from unresolved/ambiguous, `null` for intent. No axis
  reads the field.
- [x] 2.3 Pin no-axis drift: extend the projection suite (or the new delivery suite) with
  a before/after check that phase, health, progress, lanes, and the gate are identical
  with and without delivery facts on the same evidence.

## 3. Rollup derivation

- [x] 3.1 Create `src/core/issue-status/delivery.ts` with
  `deriveIssueDeliveryEvidence(status): IssueDeliveryEvidence | null` (design D4): entries
  per change node in canonical node order, counts over the five states, `null` when the
  revision did not read back. Export from the module index.
- [x] 3.2 Unit-pin the derivation: purity (same status → identical rollup, twice), the
  entry-per-change-node rule (intent excluded), counts-summarize-entries-stay-full, and
  the null-on-unreadable-revision rule.

## 4. CLI surface

- [x] 4.1 In `src/commands/store-issue.ts` show: render the `delivery evidence:` section
  after acceptance (per-node rows + fact lines + counts; named absences rendered as the
  named state; ship-log as inventory fact with digest or named absence) and add the
  `delivery` rollup to the `--json` payload beside `status`.
- [x] 4.2 Parity test: human vs `--json` carry the same facts (rollup + per-node
  `delivery` on status nodes); `list` output unchanged (no delivery facts).

## 5. Byte-level shape coverage (temp stores)

- [x] 5.1 Extend the `store-archive-outcome-basis` five-shape fixture recipe in a new
  store-query suite: assert the delivery block per shape — v1 ledger (facts verbatim),
  v2 landed-code (mapped), v2 planning-only (no-merge named), record-absent
  (`no-record`), unparseable-json (`unreadable`, no facts), and v2 passive/cancelled.
- [x] 5.2 Read-discipline bytes: before/after store refs, run-state files, and workspace
  index byte-identical across a show with the delivery section (extend the read-only
  guard pattern of `issue-status-read-only-guard.test.ts`).

## 6. Dogfood receipts (real store, read-only)

- [x] 6.1 On `issue-registry` (READ-ONLY — no writes, no Issue #5 authoring): capture
  `store issue show` receipts for the four closed Issues — nine archived rows reading
  their ledger facts (spot-pin `issue-node-lifecycle`: commit `31d0b644…`, branch
  `feat/issue-phase2`, 7 evidence files, ship-log present, missing `verification-report`)
  and three `not-archived` rows (`issue-needs-attention`, `issue-persistent-baseline`,
  `document-multi-project-issues`), with `--json` parity for one Issue.
- [x] 6.2 Record the receipts under this change's `evidence/` and note any fact that
  surprised (a named absence where a fact was expected is a finding, not a fixture edit).

## 7. Close-out

- [x] 7.1 Update `architecture-index` (quick-locate row + the issue-status module note)
  for the new `delivery.ts` derivation and the show section.
- [x] 7.2 Full affected-set run (store-family + issue-status + CLI suites), validate
  green, and hand to review with the receipts.
