# Review Report: issue-read-surface

## Summary

| Dimension | Result |
|---|---|
| Scope | CLEAN — the final re-review stayed on the two-file roster delta; unrelated `.rasen/` content and `issue-ui-convergence` were excluded |
| Standards | CLEAN — Store membership and projection aliases now have separate, explicit responsibilities |
| Spec | CLEAN — every current Store member is offered and historical non-member lanes cannot create chips |

REVIEW VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

Re-review baseline: exact working tree against `1afa021f0d696e48e66d7e7b92690138036fd79a` (`feat/issue-phase7`), including the untracked implementation and test files named by the change artifacts.

## Findings

None.

## Resolved findings

1. **RESOLVED — invalid `state` no longer broadens the read.** `src/core/management-api/router.ts:1671-1683` rejects a present value outside `ISSUE_STATES` with HTTP 400 and `issue_state_undefined`; the over-the-wire regression at `test/core/management-api/issue-projection.test.ts:592-597` passed.
2. **RESOLVED — Detail now renders the material full-read facts previously omitted.** Session id/thread/transcript, record delivery location/evidence/missing fields, all five rollup and verification counts, narrowed-attention summary, attention-only completeness, and merged unsearched refs are rendered and asserted in `IssueDetailPage.tsx` and its focused component suite.
3. **RESOLVED — the Board fetches the Store project aggregate and includes a catalog member with zero Issue lanes.** `IssueBoardPage.tsx:111-114` seeds the full roster from `projects.projects`; the zero-lane member regression remains green.
4. **RESOLVED — Board and Detail have token-based responsive styling.** `packages/ui/src/style.css:543-714` supplies five-lane layout, responsive horizontal scrolling/Detail collapse, notices/cards/sections, card hover and `:focus-visible`, and reduced-motion handling.
5. **RESOLVED — projection lanes cannot add historical non-members to the roster.** `IssueBoardPage.tsx:115-124` updates an alias only when the catalog-seeded member already exists. The inverse regression at `issue-board-page.test.tsx:340-374` proves the stale lane creates no chip while its Issue remains visible under “All”.

## Coverage audit

```text
CODE PATH COVERAGE
==================
[+] Invalid HTTP state
    `-- [*** TESTED] 400 + issue_state_undefined over the real management server

[+] Issue Detail full-read fix
    |-- [*** TESTED] session/thread/transcript and delivery inventory/location/missing facts
    |-- [*** TESTED] five delivery/verification counts
    `-- [*** TESTED] attention-only incomplete + unsearched-ref disclosure

[+] Board project roster
    |-- [*** TESTED] current Store member with zero Issue lanes receives a chip
    |-- [*** TESTED] revision lane absent from current Store catalog creates no chip
    `-- [*** TESTED] the historical-lane Issue remains visible under the default All filter

[+] Presentation
    `-- [DIFF-READ] responsive lanes/Detail, hover, focus-visible, reduced motion
```

## Checks run

- `pnpm --filter @atelierai/rasen-ui test test/components/issue-board-page.test.tsx test/components/issue-detail-page.test.tsx` — PASS, 27/27.
- `pnpm --filter @atelierai/rasen-ui test test/components/issue-board-page.test.tsx` — final roster delta PASS, 14/14.
- `pnpm exec vitest run test/core/management-api/issue-projection.test.ts --testNamePattern="refuses over the wire" --reporter=verbose` — PASS, 1/1 selected (13 skipped), run serially.
- `node bin/rasen.js validate issue-read-surface` — PASS.
- `git diff --check HEAD` — PASS (line-ending conversion warnings only).
- Strict UTF-8 validation of 45 attributable tracked/untracked text files — PASS; zero decode failures, BOMs, or U+FFFD. All 6 attributable JSON files parsed successfully.
- Final two-file roster delta — strict UTF-8 PASS, zero BOM/U+FFFD/trailing whitespace; `git diff --check HEAD -- <two files>` PASS.
- `pnpm --filter @atelierai/rasen-ui typecheck` — non-gating repository baseline: the same 13 pre-existing errors in tracked-clean Canvas files reported by verification; zero diagnostics name an Issue read-surface file.
- The root full suite was not run, per the handoff; CI/LEAD remains its owner.

## Durable review notes

- `status.projects` is a revision-derived lane set, not a Store-membership source; roster membership must come only from the Store project aggregate.
- The Detail's session, delivery, verification, and attention-completeness gaps are now covered by payload-backed assertions rather than section-presence checks.
- Store project aggregation is the sole membership authority; projection lanes can improve labels and drive filtering without widening the roster.
- All five review findings across the two rounds are non-author-confirmed resolved; there are no accepted-known Minor or Trivial findings.
