# Ship Log — issue-unified-review-gate (P6 g-002)

## Delivery

- Change: `issue-unified-review-gate` (Phase 6, Issue #4, gap g-002).
- Ship commit: `e5c88225d4c40d2eaabcceafccd19a8a0788c63c` on branch `feat/issue-phase6`.
- Subject: `feat(store): unify issue review determination as a 1:1 acceptance-gate mapping`.
- Delivery mode: **local** — commit only, no push, no PR. The Phase 6 portfolio (parent
  `issue-level-review-delivery`) opens a single rollup PR when all its children (g-001 already
  shipped, g-002 this change, g-003 pending) are done; individual gaps commit locally in the
  shared worktree in the meantime.

## What changed

A pure `deriveIssueReview(issueId, revisionId, status)` derivation (`src/core/issue-status/review.ts`,
new) that maps the Issue's acceptance gate onto a closed seven-value `IssueReviewDetermination`
vocabulary (`review-ready`, `not-ready`, `accepted`, `acceptance-unknown`, plus the three
`conditions-*` refusal codes) as a total 1:1 function over the gate's own closed refusal union —
no second blocking basis, no re-derived rule. Also derives a bounded, deduplicated set of
non-blocking "thread" items (archive-pending / evidence-missing / record-absent / optional-open)
from the status projection, explicitly excluding the two Issue-level attention kinds
(`acceptance-awaiting`, `problem`) that the determination already carries. Wired into
`store issue show` (`src/commands/store-issue.ts`) as a new review section rendered above the
existing acceptance section.

## Files

**Implementation**
- `src/core/issue-status/review.ts` (new — `deriveIssueReview`, `mapDetermination`, thread derivation)
- `src/core/issue-status/types.ts` (modified — `IssueReviewDetermination`, `IssueReviewThread`, `IssueReviewView` types, D1–D3 doc comments)
- `src/core/issue-status/index.ts` (modified — re-exports)
- `src/commands/store-issue.ts` (modified — review section wired into `store issue show`)

**Tests**
- `test/core/issue-status/issue-unified-review.test.ts` (new — 17 tests: determination matrix over the real acceptance gate, thread derivation, exclusion pins, live-pin non-constancy)
- `test/commands/store-issue-review-cli.test.ts` (new — 7 tests: CLI rendering incl. tampered-record and not-ready cases)
- `test/core/issue-status/issue-status-read-only-guard.test.ts` (modified — guard extended to cover the new review path)

**Docs**
- `.claude/skills/architecture-index/detail/quick-locate.md` (modified)
- `.claude/skills/architecture-index/detail/modules/spec-store-engine.md` (modified)

**Artifacts** (`rasen/changes/issue-unified-review-gate/`)
- `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`
- `specs/issue-unified-review/spec.md`
- `evidence/dogfood-1-autodecompose-uplift.txt`
- `evidence/dogfood-2-cross-project-execution.txt`
- `evidence/dogfood-3-cross-project-replanning.txt`
- `evidence/dogfood-4-multi-change-execution.txt`
- `evidence/dogfood-5-multi-change-execution.json`
- `evidence/dogfood-receipts-summary.md`
- `evidence/review-report.md`

## Test evidence

From the apply-stage and verify-stage records (re-confirmed in `evidence/review-report.md`):

| Suite | Result |
| --- | --- |
| `test/core/issue-status/issue-unified-review.test.ts` | 17/17 passed |
| `test/commands/store-issue-review-cli.test.ts` | 7/7 passed |
| `test/core/issue-status/issue-status-read-only-guard.test.ts` | 9/9 passed |
| `node bin/rasen.js validate issue-unified-review-gate` | "Change 'issue-unified-review-gate' is valid" |

Verify-stage also live-read the four closed Issues on the persistent `issue-registry` store
(read-only, store byte-clean before/after) and confirmed the rendered determinations and threads
match receipts exactly, and ran 3 targeted mutations of `review.ts` (backup/restore sha256-verified)
that each turned the unit suite red before being restored byte-identically.

Note (Info-level, not a defect in this change): one `pnpm run build` run on the verify box emitted
an incomplete dist (missing `dist/commands/shared-output.js`), causing a transient false-red on the
CLI suite; a direct `tsc` re-run fixed it and the suite went 7/7 green. See I-3 in the review report.

## Verify determination

**VERDICT: CLEAN** — 0 Blocker, 0 Major, 0 Minor, 4 Info findings (I-1 doc-wording nit on thread
sort order description, I-2 a sound-but-uncheckable `as string` cast, I-3 the transient build/dist
gap above, I-4 a cosmetic test-file style nit). All five verify focus items PASS. Full report at
`rasen/changes/issue-unified-review-gate/evidence/review-report.md`.

## Archive
**Date:** 2026-08-23T10:50:26.078Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-23-issue-unified-review-gate
**Transaction:** 70688685-269b-4792-948d-1f219f619957
