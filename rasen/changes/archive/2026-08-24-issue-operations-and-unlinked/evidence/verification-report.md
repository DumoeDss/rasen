# Verification Report: issue-operations-and-unlinked

## Summary

| Dimension | Status |
|---|---|
| Completeness | CLEAN — 32/32 tasks checked; 13/13 delta requirements and 54/54 scenarios inspected |
| Correctness | CLEAN — all requirements and scenarios map to implementation/tests; the four prior findings are independently closed |
| Coherence | CLEAN — implementation, normative specs, design decisions D1–D9, and repository patterns agree |

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Completeness

- `tasks.md` contains 32 checked tasks and no unchecked task.
- The four delta specs contain 13 requirements and 54 scenarios. Every requirement and scenario maps
  to an implementation and test surface; none is absent.
- The expected implementation surfaces exist: Change-to-Issue composition and flat management API,
  conditional plan publication, UI mirrors/client, Operations and Unlinked pages/dialog, Store-only
  routes/navigation, locale/style updates, focused tests, architecture-index updates, and fixture and
  dogfood evidence.

## Correctness: requirement and scenario coverage

| Requirement | Scenarios | Implementation and test evidence | Assessment |
|---|---:|---|---|
| Operations prioritizes active and abnormal execution | 4 | Classification: `packages/ui/src/components/operations-model.ts:22`; grouping/source fan-out: `OperationsPage.tsx:120`, `:197`, `:230`; last-known-good merge: `:241-281`; tests: `operations-model.test.ts:63`, `operations-page.test.tsx:269`, `:300`, `:341` | Covered |
| Operations separates cwd, execution binding, and attribution | 5 | Project+alias-only attribution: `operations-model.ts:59-79`, `:83-98`, `:102-107`; rendering: `OperationsPage.tsx:104`; ambiguity regression: `operations-model.test.ts:81-96`; mounted ambiguity: `operations-page.test.tsx:269-285` | Covered |
| Operations filters by current member project without changing truth | 3 | Roster/filter: `OperationsPage.tsx:197-229`, `:309-323`; selector-scoped retention: `:177-194`, `:241-278`; tests: `operations-page.test.tsx:269-297`, `:370-386` | Covered |
| Operations submits only projected lifecycle controls | 5 | Run controls: `OperationsSection.tsx:729`, `:839`, `:897`; Session confirmation: `SessionRow.tsx:208`; tests: `operations-controls.test.tsx:278`, `:295`, `:371`, `:498`, `:594`; `session-row.test.tsx:42`, `:59` | Covered |
| Operations is directly reachable and holds no execution cache | 3 | Route/nav: `packages/ui/src/app.tsx:95`, `Layout.tsx:94`; refresh: `OperationsPage.tsx:175`, `:183`; visible-data polling: `:321-332`; tests: `app.test.tsx`, `operations-page.test.tsx:341`, `:370`, `:388` | Covered |
| Unlinked surface shows only provably unlinked Changes | 5 | D1 precedence: `src/core/issue-read/change-links.ts:117`; page partition: `UnlinkedChangesPage.tsx:121`; tests: `change-issue-links.test.ts:151`, `:172`, `:206`; `unlinked-changes-page.test.tsx:150` | Covered |
| A bare Change remains visibly a Change | 3 | Change rendering: `UnlinkedChangesPage.tsx:22`, `:40`; tests: `unlinked-changes-page.test.tsx:150`, `:177` | Covered |
| Attaching publishes one confirmed plan revision | 5 | Node copy/freshness/publish: `LinkChangeDialog.tsx:23`, `:149`, `:160`, `:177`; tests: `link-change-dialog.test.tsx:220`, `:282`; `change-issue-links.test.ts:312` | Covered |
| Creating a single-Change Issue is explicit and recoverable | 4 | Create/publish/recovery: `LinkChangeDialog.tsx:198`, `:210`, `:233`; tests: `link-change-dialog.test.tsx:302`, `:336`, `:352`; `change-issue-links.test.ts:260` | Covered |
| Unlinked Changes refreshes from Store evidence and is Store-only | 3 | Route/nav/read refresh: `app.tsx:96`, `Layout.tsx:101`, `UnlinkedChangesPage.tsx:82`, `:109`, `:190`; tests: `unlinked-changes-page.test.tsx:191`, `app.test.tsx:282` | Covered |
| Store Change-to-Issue path reports provable association | 5 | Composition/handler/route/alias: `change-links.ts:117`, `management-api/stores.ts:373`, `router.ts:1708`, `wire-types.ts:1492`; tests: `change-issue-links.test.ts:151`, `:206`, `:220`, `:239` | Covered |
| Plan publication can be conditioned on observed revision | 5 | HTTP boundary/mirrors: `management-api/stores.ts:591`, `wire-types.ts:1533`, `packages/ui/src/api/types.ts:2531`; tests: `change-issue-links.test.ts:312`, `store-aggregate-wire-mirror.test.ts` | Covered |
| Plan publication compares and publishes under the Issue lock | 4 | Locked compare: `store/issues/module.ts:234`; tests: `store-issue-plan-concurrency.test.ts:49`, `:77`, `:111` | Covered |

## Re-verification of prior findings

1. **Closed — target-line narrowing.** `attributeChange` now accepts only `projectId + changeId` and
   returns `ambiguous` for multiple matches at `operations-model.ts:59-73`. Session attribution no
   longer reads planning target line at `:83-98`. The regression at
   `operations-model.test.ts:81-96` supplies a Session whose planning target is `release` while two
   same-project/same-alias instances exist on `main` and `release`, and proves neither is selected.
   `design.md:194-196` now agrees that target-line facts are presentation-only.

2. **Closed — polling/source failures overwrote successful data.** `OperationsPage.tsx:177-194`
   scopes retained state to the current Store selector and clears all retained sources on a selector
   change. Member data is retained only when both `projectId` and exact member selector match at
   `:241-278`, preventing an old checkout's Sessions/Runs from crossing into a new selector. Rejected
   roster, links, Store Sessions, and member Sessions/Runs leave their last successful values in place
   while fresh errors are accumulated at `:204-210`, `:256-278`, and `:285-293`. The fake-timer
   regression at `operations-page.test.tsx:341-368` establishes successful Sessions, Runs, links, and
   roster; then fails each source across automatic polling and verifies old data and fresh errors are
   simultaneously visible.

3. **Closed — hidden live work kept polling.** `OperationsPage.tsx:309-327` derives `hasLiveWork`
   from `visibleSessions` and `visibleMembers`. The fake-timer regression at
   `operations-page.test.tsx:370-386` selects the member with no displayed live work, advances the
   polling interval, and proves roster/Session/Run call counts do not increase.

4. **Closed — receipt whitespace.** `evidence/fixture-mutation-receipts.md:3-5` uses ordinary lines;
   a strict trailing-whitespace scan reports zero findings.

The repair introduces no new implementation, test, design, encoding, scope-retention, or polling
regression in the inspected delta.

## Coherence: design adherence

- D1, D2, D5, D6, D8, and D9 remain coherent: the link read owns no second state, Operations composes
  existing APIs, Unlinked Changes stays Change-shaped, revision comparison occurs inside the Issue
  lock, Store-only IA is preserved, and persistent Store dogfood remains read-only.
- D3 is now internally consistent: normative spec, design, pure attribution model, and mounted tests
  all require exactly one project+alias occurrence and forbid target-line disambiguation.
- D4's polling boundary now follows displayed data after the mount-local project filter.
- D7's errors remain source-specific without destroying last-known-good values. The outer Store
  selector and exact member selector form explicit anti-contamination boundaries.
- Naming, file placement, direct wire aliases, routing, architecture-index maintenance, locale
  conventions, version manifests, frozen pipeline files, and g-003-preserved surfaces remain intact.

## Findings

### Blocker

None.

### Major

None.

### Minor

None.

### Trivial

None.

## Gate evidence

- `pnpm --filter @atelierai/rasen-ui test -- test/components/operations-model.test.ts test/components/operations-page.test.tsx` — independently passed, 2 files / 10 tests.
- `pnpm --filter @atelierai/rasen-ui test` — independently passed, 76 files / 983 tests, including
  Operations, Unlinked Changes, Task Detail, Running Sessions, old Board, and Store Issue surfaces.
  jsdom emitted its known navigation/`scrollTo` diagnostics; exit code was zero with no failed test.
- `pnpm --filter @atelierai/rasen-ui build` — independently passed; Vite transformed 566 modules and
  produced the production assets.
- `node bin/rasen.js validate issue-operations-and-unlinked --project issue-layer` — independently
  passed.
- Strict UTF-8/BOM/U+FFFD/mojibake/trailing-whitespace inspection passed for all six repair files;
  `git diff --check` passed.
- Repair-surface Git blob ids: `operations-model.ts` `ce13235b...`, `OperationsPage.tsx`
  `51238d4b...`, model test `3af93941...`, page test `2780ee27...`, `design.md` `386c8dc3...`,
  fixture receipt `c302abd2...`.
- Persistent `issue-registry` remained clean at HEAD `f295abce308297dd09eb34a81287c614a8c489c5`
  with 311 tracked files.
- Additional non-attributable observation: `pnpm --filter @atelierai/rasen-ui typecheck` is currently
  blocked by existing Canvas/consultation errors in `ConsultationBindingEditor.tsx`, `IssuesDrawer.tsx`,
  and Canvas tests. No diagnostic names a g-002 or repair file, so this was not used as a g-002 gate.

TEST EVIDENCE
- scope: exact six-file repair inspection; focused Operations model/page tests; complete UI package; UI production build; change validation; encoding/whitespace/read-only integrity checks
- rationale: this directly exercises all four repaired findings, checks selector-scoped last-known-good behavior and fake-timer polling, then covers every UI consumer and production bundling without running the unrelated root suite
- command: `pnpm --filter @atelierai/rasen-ui test -- test/components/operations-model.test.ts test/components/operations-page.test.tsx`; `pnpm --filter @atelierai/rasen-ui test`; `pnpm --filter @atelierai/rasen-ui build`; `node bin/rasen.js validate issue-operations-and-unlinked --project issue-layer`; strict six-file UTF-8/whitespace scan; `git diff --check`
- result: pass
- tree: bfacf34d3bbf9ecb673099e18c062505a4065ebc

## Final assessment

All four prior findings are independently resolved with meaningful regression coverage. The g-002
implementation is complete, correct, coherent with its artifacts, and ready for the review-cycle and
ship stages. Archive timing remains `on-merge`.
