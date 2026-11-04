# Review Cycle: issue-read-surface

Rounds: 2/3   Tier: A   Status: CLEAN

Final verdict: **CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0**

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|---|---:|---|---|---|---:|
| 1 | 0/3/1/0 | API boundary, Detail fidelity, Store-member roster, and presentation fixes routed as non-trivial | role-isolated Codex fixer | independent Codex report-only reviewer | 4/4; one follow-up roster-boundary Major discovered |
| 2 | 0/1/0/0 | Restrict roster membership to the Store aggregate; lanes may update aliases only | role-isolated Codex fixer | independent Codex report-only reviewer | 1/1 |

## Round 1 findings and disposition

1. **Major — invalid HTTP `state` broadened the read.** Fixed with an explicit closed-vocabulary check returning HTTP 400 / `issue_state_undefined`; confirmed by the focused real-server regression.
2. **Major — Issue Detail omitted material full-read fields.** Fixed by rendering session thread/transcript pointers, complete delivery facts, all rollup/verification counts, and attention-only incompleteness; confirmed by payload-backed Detail assertions.
3. **Major — the Board roster omitted Store members with no Issue lane.** Fixed by fetching the existing read-only Store project aggregate and seeding the roster from it; confirmed by the zero-lane member test.
4. **Minor — Board and Detail had no matching CSS.** Fixed with token-based responsive layout, notices/cards/sections, hover/focus-visible states, and reduced-motion handling; confirmed by diff-read and component coverage.

Round 1 re-review found one follow-up Major: the alias merge unconditionally inserted every projection lane into the catalog-seeded map, so a historical lane could create a non-member chip.

## Round 2 finding and disposition

1. **Major — projection lanes widened the Store-member roster.** Fixed at `packages/ui/src/components/IssueBoardPage.tsx:115-124`: a lane now updates the label only when `memberById` already contains the catalog member and the lane reports a non-null alias. The regression at `packages/ui/test/components/issue-board-page.test.tsx:340-374` proves a stale non-member lane creates no chip while its Issue remains visible under the default “All” filter. The existing zero-lane current-member test remains green, confirming both sides of the membership boundary.

## Final clean-round test evidence

- **Required verification scope:** the exact two-file Board roster delta — `IssueBoardPage.tsx` and `issue-board-page.test.tsx`.
- **Rationale:** round 2 changed only membership seeding/alias refinement and its component regression. The Board suite exercises the new inverse case together with the already-resolved zero-lane current-member case, filtering, fixed phase lanes, refresh, and non-persistence. Server, Detail, CSS, and locale paths were untouched in round 2 and retain round 1 evidence.
- **Command:** `pnpm --filter @atelierai/rasen-ui test test/components/issue-board-page.test.tsx`
- **Result:** PASS — 1 file, 14/14 tests.
- **Command:** `git diff --check HEAD -- packages/ui/src/components/IssueBoardPage.tsx packages/ui/test/components/issue-board-page.test.tsx`
- **Result:** PASS.
- **Integrity check:** strict UTF-8 decode of both files, BOM/U+FFFD scan, and trailing-whitespace scan — PASS, zero findings.
- **HEAD content tree fingerprint:** `48a571d6ed78ecb449595e63f20924230c72a4e5` (`git rev-parse HEAD^{tree}`; implementation remains an uncommitted working-tree change).
- **Focused file object ids:** `IssueBoardPage.tsx` = `25d5f72d7d314aff3ec464ae76733d29dcf9c3e6`; `issue-board-page.test.tsx` = `fac18aa9735fa9875f1d42a11d45ba992020482e`.

## Cumulative checks retained from round 1

- Board + Detail component suites — PASS, 27/27 before the final roster delta.
- Focused invalid-state real-server regression — PASS, 1/1 selected.
- `node bin/rasen.js validate issue-read-surface` — PASS.
- Attributable strict UTF-8/JSON validation — PASS.
- UI typecheck reported only the 13 previously documented tracked-clean Canvas baseline errors; no Issue read-surface diagnostic.
- Root full suite was intentionally not run; CI/LEAD remains its owner per the implementation handoff.

## Accepted-known lower severities

None.

## Durable findings

- `status.projects` is revision-derived and cannot establish current Store membership.
- The Store project aggregate exclusively owns chip membership; projection lanes may only improve labels and drive filtering.
- Both directions are now regression-pinned: current member without a lane is present, historical lane without current membership is absent.

## Report

- `rasen/changes/issue-read-surface/evidence/review-report.md`
- `rasen/changes/issue-read-surface/evidence/review-cycle-report.md`
