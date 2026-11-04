# Handoff: process-authority-prepare-unavailability-outcome — reviewer #1

## Original intent

Perform a fresh report-only review of the Change artifacts and exact shared process-authority delta. Focus on the typed unavailable accessor/diagnostic boundary, reservation release, no fallback/reference, rejection distinction, malformed lookalikes, and the conformance publisher seam. Do not inspect concurrent Linux-provider work and write only the round-1 review report and this handoff.

## Position

Round-1 non-author review is complete. Verdict: **NOT CLEAN — 0 Blocker, 1 Major, 0 Minor, 0 Trivial.**

## Finding to resolve

`MAJOR-1`: closed unavailable parsing at `coordinator.ts:495-510` is followed by permissive prepared-authority parsing at `coordinator.ts:472-493`. A malformed object with `state: 'authority-unavailable'`, a diagnostic, a valid provider reference, and callable `activate` fails the exact unavailable snapshot but is then accepted as `prepared-inert`. A direct probe confirmed that the coordinator exposes a common reference and publish function and ultimately invokes activation.

The existing malformed test at `process-authority-prepare-unavailable.test.ts:131-144` does not include a callable `activate`, so it cannot catch this fallthrough.

## Required next action

Close classification so an invalid unavailable-discriminated value cannot be reconsidered as prepared authority. Add a hybrid valid-reference/callable-activate mutation that proves generic invalid-preparation failure, no reference/publish capability, zero activation/workload starts, and no fallback. Then request a fresh re-review.

## Verified clean areas

- Typed exact unavailable diagnostic propagation and exact selection.
- No fallback and no common reference for a valid unavailable result.
- Reference reservation release across repeated unavailable results.
- Provider rejection remains prepare-phase control loss.
- All exact shared conformance publications use the fixture publisher seam; mismatch still delegates then mutates, and timeout coverage remains intact.
- Public union/export type changes compile.

## Verification evidence

- Focused unavailable plus shared conformance tests: PASS (`48/48`).
- TypeScript no-emit check: PASS.
- Strict Change validation: PASS.
- Path-scoped diff whitespace check: PASS (line-ending warnings only).
- Malformed-hybrid probe: reproduced `prepared-inert -> published-inert -> live`, with a reference, publish capability, and activation count `1`.

No product, test, spec, task, run-state, or Linux-provider file was changed by this review.
