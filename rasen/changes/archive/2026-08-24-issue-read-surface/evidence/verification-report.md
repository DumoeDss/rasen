# Verification Report: issue-read-surface

## Summary

| Dimension | Status |
|---|---|
| Completeness | CLEAN — 22/22 tasks complete; 8/8 delta requirements have implementation evidence |
| Correctness | CLEAN — all 27 scenarios map to implementation and tests; the verification-found empty-Store lane gap was fixed and regression-tested |
| Coherence | CLEAN — implementation follows design D1–D7 and the repository's flat Store-aggregate/UI patterns |

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Completeness

- `tasks.md` contains 22 checked tasks and no unchecked task.
- The two delta specs contain 8 requirements and 27 scenarios. All requirements map to concrete implementation and test evidence below.
- The expected implementation surfaces exist: the shared `src/core/issue-read/` composition, three flat management GET routes, direct wire aliases, UI mirrors/client calls, Board/Detail pages, store-only routing/navigation, locale entries, server/UI tests, architecture-index updates, and five dogfood evidence artifacts.

## Correctness: requirement and scenario coverage

| Requirement | Scenarios | Implementation evidence | Test evidence |
|---|---:|---|---|
| Board: one Issue card in one of five phase lanes | 4 | Fixed vocabulary and unconditional five-lane rendering at `packages/ui/src/components/IssueBoardPage.tsx:215`; payload phase selects the lane and the first scan item is passed to each card at `packages/ui/src/components/IssueBoardPage.tsx:227`; card axes/attention stay payload-backed at `packages/ui/src/components/IssueCard.tsx:35` | Lane/card traceability at `packages/ui/test/components/issue-board-page.test.tsx:78`; zero-Issue five-empty-lanes regression at `packages/ui/test/components/issue-board-page.test.tsx:96` |
| Board: surface incompleteness and divergence | 3 | Projection and attention completeness plus both unsearched-ref sets are surfaced at `packages/ui/src/components/IssueBoardPage.tsx:136`; record diagnostic/divergence/uncommitted facts render at `packages/ui/src/components/IssueCard.tsx:65` | Incompleteness payload coverage at `packages/ui/test/components/issue-board-page.test.tsx:201`; visibility coverage is in the same component suite |
| Board: member chips filter without repartitioning | 2 | Chip roster is read from projection lanes and filtering leaves phase lanes intact at `packages/ui/src/components/IssueBoardPage.tsx:104`; selection is mount-local state at `packages/ui/src/components/IssueBoardPage.tsx:45` | Filter semantics at `packages/ui/test/components/issue-board-page.test.tsx:249`; remount/no-storage behavior at `packages/ui/test/components/issue-board-page.test.tsx:286` |
| Detail: present the full projection read | 3 | The page consumes detail + narrowed attention together at `packages/ui/src/components/IssueDetailPage.tsx:120`; the seven payload-backed sections start at lines 254, 344, 418, 454, 481, 540, and 592 | Axes/background/plan/delta/lanes/blockers/delivery/review/attention/problems coverage starts at `packages/ui/test/components/issue-detail-page.test.tsx:88` |
| UI: no second Issue state | 3 | Board and Detail fetch on selector/issue/refresh nonce with cancellation and no module cache or storage at `packages/ui/src/components/IssueBoardPage.tsx:50` and `packages/ui/src/components/IssueDetailPage.tsx:116`; closed vocabulary mapping is presentation-only at `packages/ui/src/components/issue-vocabulary.ts:14` | Board refresh/no-storage coverage at `packages/ui/test/components/issue-board-page.test.tsx:286`; Detail refresh/no-storage coverage at `packages/ui/test/components/issue-detail-page.test.tsx:286` |
| UI: store-space reachability | 3 | Store-only routes at `packages/ui/src/app.tsx:91`; store-only nav gate at `packages/ui/src/components/Layout.tsx:82` | Board/deep-link/store-nav/project-absence coverage starts at `packages/ui/test/app.test.tsx:223` |
| API: Store projection paths serve status, attention, and review | 4 | One shared composition supplies list/detail/attention at `src/core/issue-read/composition.ts:287`, `src/core/issue-read/composition.ts:325`, and `src/core/issue-read/composition.ts:371`; handlers are thin pass-throughs at `src/core/management-api/stores.ts:320`; routes are unwrapped GETs at `src/core/management-api/router.ts:1664`; core wire responses are direct aliases at `src/core/management-api/wire-types.ts:1457` | Handler shapes/narrowing/review at `test/core/management-api/issue-projection.test.ts:299`; byte-for-byte CLI↔HTTP witness at `test/core/management-api/issue-projection.test.ts:495` |
| API: fresh derivation and honest channels | 5 | Run-state is resolved per request at `src/core/management-api/router.ts:1673`; unknown attention narrowing maps to 404 at `src/core/management-api/stores.ts:197`; unreadable evidence stays in successful composition payloads; run-context never throws at `src/core/issue-read/run-context.ts:34` | 404 channel at `test/core/management-api/issue-projection.test.ts:382`; unreadable-200 at line 425; freshness at line 439; byte-identical no-write at line 451; visibility degradation at line 476; wire error envelope at line 569 |

## Coherence: design adherence

- **D1 — one composition, two callers:** CLI imports the same compose functions at `src/commands/store-issue.ts:57` and `src/commands/store.ts:46`; management handlers import them at `src/core/management-api/stores.ts:38`. Payload key order is built once in the compose returns.
- **D2 — flat endpoint family:** the three paths live in the maintained flat Store-aggregate router and use unwrapped direct-alias response types; review remains the detail payload's `review` key.
- **D3 — disjoint error channels:** attention unknown narrowing is a 404 refusal, while unreadable evidence remains a 200 payload with completeness/problem facts. Tests pin both.
- **D4 — honest run-state degradation:** CLI passes cwd, daemon passes launch root, and unresolved context returns `{}` so the projection reports visibility `none`; Board and Detail disclose it.
- **D5 — store-only UI IA:** routes and navigation exist only under `/s/:storeId/issues[/:issueId]`; `issues` is deliberately absent from switchable sections; typed literal tables map closed vocabularies without recomputing axes.
- **D6 — zero second state:** requests re-derive on refresh; no Issue status is persisted in client storage or cached server-side. Freshness/no-write/no-storage tests cover both halves.
- **D7 — dogfood receipts:** `dogfood-cli-http-parity.json` records 12/12 byte-identical real-store CLI↔HTTP pairs plus the 404 refusal; `dogfood-board-render.json` records five cards, all Done, with zero attention lines. The real store proof remains read-only.
- Naming, directory placement, direct wire aliases, fetch-on-mount patterns, and architecture-index upkeep match the documented repository conventions. The frozen `src/core/pipeline-registry/` surface and version fields are unchanged.

## Findings

### Blocker

None.

### Major

None.

### Minor

None.

### Trivial

None.

## Resolved during verification

- Fixed the zero-Issue Board state so all five phase lanes remain present, as the spec requires, while retaining the empty-store notice. Added a focused regression test.
- Merged/deduplicated `unsearchedRefs` from both Board payloads so an attention-only incompleteness fact cannot be hidden. Extended the incompleteness test accordingly.
- Aligned the heavy CLI↔HTTP parity test's per-CLI timeout (120 seconds) with its outer test budget (600 seconds). The original failure was a 30-second helper timeout with no parity assertion failure; the focused retry then passed all six byte comparisons.

## Gate notes

- `node bin/rasen.js validate issue-read-surface` passed.
- The Issue projection file established all 14 tests across a serial full-file run (13 passed; the only failure was the repaired helper timeout) plus a focused post-fix retry of that parity case (passed).
- The post-verification Issue Board file passed 12/12 under the package's own Vitest configuration.
- Final strict UTF-8/JSON integrity checked 189 change-related files: no invalid UTF-8, BOM, U+FFFD, suspicious mojibake, or JSON parse error.
- An additional `pnpm --filter @atelierai/rasen-ui typecheck` probe reported 13 existing Canvas errors in four tracked-clean files (`ConsultationBindingEditor.tsx`, `IssuesDrawer.tsx`, and two Canvas tests). None is modified by this change and none points to an Issue read-surface file, so this is recorded as a repository-baseline gate concern rather than an open finding against this change.
- The root full suite remains owned by LEAD/CI per the implementation handoff; this verifier did not duplicate it.

TEST EVIDENCE
- scope: change-focused management API projection tests, Issue Board component tests, and change validation
- rationale: the commands cover the shared composition/parity/error/freshness/no-write risk and the only UI behavior changed during verification; the previously recorded full UI and guard-suite evidence remains in the handoff
- command: `pnpm exec vitest run test/core/management-api/issue-projection.test.ts --reporter=verbose`; `pnpm exec vitest run test/core/management-api/issue-projection.test.ts --testNamePattern=serves.*byte --reporter=verbose`; `pnpm --filter @atelierai/rasen-ui test test/components/issue-board-page.test.tsx`; `node bin/rasen.js validate issue-read-surface`
- result: pass
- tree: 48a571d6ed78ecb449595e63f20924230c72a4e5

## Final assessment

All change-attributable checks pass. The implementation matches the tasks, delta specs, and design, with no open Blocker or Major finding. It is ready for the next delivery/CI gate; archive timing remains `on-merge`.
