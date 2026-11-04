# Ship Log — issue-deferral-record (P6 g-003)

## Delivery

- Change: `issue-deferral-record` (Phase 6, Issue #4, gap g-003).
- Ship commit: `a0d4d6b2` on branch `feat/issue-phase6` (parent `62553fe0`, the archive of g-002
  `issue-unified-review-gate`).
- Subject: `feat(store): record explicit deferral of issue plan nodes with reasons`.
- Delivery mode: **local** — commit only, no push, no PR. The Phase 6 portfolio (parent
  `issue-level-review-delivery`) opens a single rollup PR once all its children are done
  (g-001, g-002 already shipped/archived; g-003 this change); individual gaps commit locally in
  the shared worktree in the meantime.

## What changed

An explicit `deferred` lifecycle value for optional Issue plan nodes, with a required recorded
reason, closing the gap the roadmap names directly (可选节点延期或取消的明确记录): today an
operator who decides not to pursue an optional node for this Issue only had dishonest spellings
available — leave it dangling as an `optional-open` review thread forever, falsely record it as
`cancelled` (abandonment), or drop it and lose the record. `deferred` is isomorphic to
`cancelled`/`superseded` at every seam that matters (gate refusal ordering, acceptance-record
exclusions, ready-set exclusion, plan revision immutability) and never holds the Issue's Done.
g-002's review view needed no new determination branch or second blocking basis: the
`optional-open` thread check is positive on the `optional` lifecycle, so a deferral simply
dissolves the thread.

## Files

**Implementation (13 modified)**
- `src/commands/store-issue.ts`
- `src/core/issue-acceptance/gate.ts`
- `src/core/issue-acceptance/types.ts`
- `src/core/issue-execution/binding.ts`
- `src/core/issue-execution/confirm.ts`
- `src/core/issue-execution/types.ts`
- `src/core/issue-status/attention.ts`
- `src/core/issue-status/projection.ts`
- `src/core/issue-status/ready-set.ts`
- `src/core/issue-status/types.ts`
- `src/core/store/issues/acceptance.ts`
- `src/core/store/issues/plans.ts`
- `src/core/store/issues/types.ts`

**Tests (7: 3 modified, 4 new)**
- `test/core/issue-execution/issue-execution-binding.test.ts` (modified)
- `test/core/issue-execution/issue-execution-confirm.test.ts` (modified)
- `test/core/store/store-issue-node-lifecycle.test.ts` (modified)
- `test/commands/store-issue-deferral-cli.test.ts` (new)
- `test/core/issue-acceptance/issue-acceptance-gate-deferral.test.ts` (new)
- `test/core/issue-status/issue-deferral-family.test.ts` (new)
- `test/core/store/store-issue-deferral-record.test.ts` (new)

**Docs / artifacts** — none outside the change directory this round (no architecture-index
touch was needed for g-003).

**Artifacts** (`rasen/changes/issue-deferral-record/`, 23 files)
- `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`
- `specs/issue-acceptance-close/spec.md`
- `specs/issue-execution-binding/spec.md`
- `specs/issue-ready-set-scheduling/spec.md`
- `specs/issue-status-projection/spec.md`
- `specs/issue-unified-review/spec.md`
- `specs/store-issue-resources/spec.md`
- `evidence/dogfood-1-publish-deferral.txt`
- `evidence/dogfood-2-show.txt`
- `evidence/dogfood-3-show.json`
- `evidence/dogfood-4-ready-and-start.txt`
- `evidence/dogfood-5-accept.txt`
- `evidence/dogfood-6-refusals.txt`
- `evidence/dogfood-receipts-summary.md`
- `evidence/readonly-1-cross-project-replanning.txt`
- `evidence/readonly-2-cross-project-replanning.json`
- `evidence/readonly-3-autodecompose-uplift.txt`
- `evidence/readonly-4-multi-change-execution.txt`
- `evidence/readonly-5-cross-project-execution.txt`
- `evidence/review-report.md`

## Test evidence

Apply-stage: 18/18 tasks done; every affected suite green plus the 39 new pins added across the
four new test files (deferral record, gate-deferral, deferral-family, deferral CLI).

Verify-stage (independent reviewer, per-file runs, no full-suite masking):

| Group | Result |
| --- | --- |
| Store issue lifecycle/acceptance/plan suites (6 files) | 66 passed |
| Issue-acceptance suites incl. new gate-deferral + execution binding/confirm | 78 passed |
| Deferral-family + ready-set + attention + unified-review + status-lifecycle | 60 passed |
| `store-issue-deferral-cli` (real dist CLI) | 2 passed |
| Lifecycle/ready/start/acceptance-exclusions CLI suites | 18 passed |
| Status-projection + revision-delta + ready-set-equivalence | 41 passed |
| `node bin/rasen.js validate issue-deferral-record` | valid |

**Total: 265 tests / 25 files green**, plus 40/40 hermetic live-replay checks (own bootstrap
against a from-scratch layout-v2 store, no test-harness code) and 3/3 targeted mutations caught
(each with a unique, line-verified landing site and byte-clean restore). No failures, no flake.

## Verify determination

**VERDICT: FINDINGS (1 Minor, 2 Info — nothing blocked ship).**

- **F1 (Minor)** — existing scenario "A record with no exclusions writes the absent form"
  (`issue-acceptance-close`) had a literal WHEN premise ("no cancelled or superseded nodes")
  that a deferred-node plan satisfies while its THEN (no exclusions) is false — a widening gap
  in the scenario's premise, not a runtime defect (runtime behavior was correct and separately
  pinned). **Fixed and reverified**: the delta's WHEN now reads "no cancelled, superseded, or
  deferred nodes" (`specs/issue-acceptance-close/spec.md`); the review-loop closed on the fix.
- **F2 (Info)** — a verified-sound D5 wording deviation (shared refusal-message head phrasing);
  no action.
- **F3 (Info)** — family-level rationale prose vs. a per-value runtime message; no hazard, no
  action.

All seven verify focus areas (isomorphism with cancelled/superseded, negative-enumeration sweep,
positive zero-change/seam checks, gate refusal order byte-stability, spec↔implementation 1:1 +
archive precheck, live evidence, mutation checks) PASS. Full report at
`rasen/changes/issue-deferral-record/evidence/review-report.md`.

## Archive
**Date:** 2026-08-23T13:01:26.546Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-23-issue-deferral-record
**Transaction:** 100ffef3-7867-4145-87b3-604dbf4ea255
