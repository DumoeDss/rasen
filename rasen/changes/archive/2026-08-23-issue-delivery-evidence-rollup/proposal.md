# Proposal — issue-delivery-evidence-rollup

## Why

Phase 6's operator moment — "multi-project Changes are done; review the Issue" — has no single
place to see what each Change actually delivered. The projection reports each node `finalized`,
and the acceptance gate reports the work complete, but the delivery facts themselves (which
commit shipped the code, on which planning branch, when it archived, which evidence files the
archive froze, which verification artifacts were recorded missing) live one `archive.json` per
Change, read by nobody on any Issue surface. The roadmap's §10 exit criterion names this
directly: Change 级交付证据回流到 Issue（commit/PR/验证报告汇总）. The raw material is already
committed Store content — every fact this change surfaces is inside the `archive.json` blob the
query already reads for the outcome basis — so this is an aggregation read surface, not a new
truth: no new writes, no second mutable state, no fact the Store cannot honestly stand behind.

## What Changes

- Per-Change-node delivery facts derived on read from the committed archive record, through the
  one projection seam: `readArchiveEntry` (which already parses every archive record for the
  outcome basis) additionally extracts the delivery block — `archivedAt`, the code commit (the
  v1 ledger's `codeCommit`, or the v2 record's `codeMerge.commit`), the planning-branch fact in
  the record's own spelling (v1 `planningBranch`, v2 `planning.sourceRef`), the outcome where
  the record basis carries one (v2; a legacy record's absent outcome stays the named absence it
  is), the frozen evidence inventory (path + sha256 per file), and the missing-evidence names.
  The block threads `AggregateArchiveEntry` → `PlanNodeResolution` → `IssueNodeStatus.delivery`
  exactly as `outcomeBasis` and the attribution facts thread today: display-only, driving no
  phase, health, or progress value.
- A closed named-absence vocabulary so absent evidence reads as absence, never as a guess: an
  archived entry whose ledger is present (`record`), an archived entry with no `archive.json`
  at all (`no-record`), a committed instance not yet archived (`not-archived` — the
  run-terminal siblings' truth), an unreadable record (`unreadable`, the existing
  `invalid-archive-record` problem staying authoritative), an unresolved or ambiguous reference
  (`unattributed`), and intent nodes carrying none by construction. The Store also names what
  it cannot know: no structured PR fact exists in either record shape — the ship-log is
  surfaced as an inventory fact (its store-relative path and frozen digest, presence or
  absence named) and document prose is never parsed into facts.
- An Issue-level rollup derived as a pure post-pass over the status projection's own facts
  (the attention/ready-set precedent): every change node's delivery entry in canonical node
  order plus honest counts — counts summarize, every entry stays listed — null when the
  revision did not read back ("no readable plan" is not "no delivery evidence").
- `rasen store issue show` renders a delivery-evidence section beside the status and
  acceptance sections, and its `--json` form carries the same facts (the rollup beside
  `status`, per-node `delivery` on the status nodes). `list` stays compact. Nothing writes:
  Store refs, run-state files, and the workspace index are byte-identical before and after.
- Dogfood: the four closed Issues of the persistent store `issue-registry` (read-only
  receipts material) — nine archived v1-ledger entries whose commit/branch/evidence/missing
  facts must read back, and three run-terminal nodes (not archived) that must read the named
  `not-archived` absence. Byte-level shape coverage (v1 ledger, v2 landed-code, v2
  planning-only, v2 passive, record-absent, unparseable) runs on temp stores, extending the
  `store-archive-outcome-basis` fixture recipe.

## Capabilities

### New Capabilities

- `issue-delivery-evidence`: per-Change delivery evidence (code commit, planning branch,
  archive date, outcome basis, frozen evidence inventory, recorded missing evidence) derived
  on read from the committed archive record, carried per node through the status projection,
  aggregated to the Issue read surface with named absences, and shown in human and `--json`
  parity on `rasen store issue show`.

### Modified Capabilities

(none — the attention precedent: the projection spec's read-surface requirement states
minimums and is untouched; the delivery facts are display facts owned by their own capability,
exactly as `issue-execution-binding` owns the attribution facts that ride the same node
statuses.)

## Impact

- `src/core/store/query/module.ts` — `readArchiveEntry` extracts the delivery block (both
  record shapes, honestly mapped); `deriveReadiness` threads it onto `PlanNodeResolution`
  (the `outcomeBasis` pattern).
- `src/core/store/query/types.ts` — `AggregateArchiveEntry` and `PlanNodeResolution` gain the
  additive delivery block.
- `src/core/issue-status/types.ts` / `projection.ts` — `IssueNodeStatus.delivery` (the
  attribution pattern: one widening copy from the resolution, every branch, drives no axis).
- `src/core/issue-status/delivery.ts` (new) — `deriveIssueDeliveryEvidence`, pure over the
  projection output.
- `src/commands/store-issue.ts` — the show section renderer + `--json` payload.
- Tests: `test/core/issue-status/issue-delivery-evidence.test.ts` (derivation, parity,
  named-absence vocabulary, read-only discipline) and a store-query byte suite extending
  `test/core/store/store-archive-outcome-basis.test.ts`'s five-shape fixture with delivery
  assertions per shape.
- Frozen untouched: `src/core/pipeline-registry/`, `packages/ui/**`, the registry; no new CLI
  command, option, or flag (no completions/locale churn); no version changes.
