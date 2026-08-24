# Verification Report: issue-board-cutover

## Summary

| Dimension | Status |
| --- | --- |
| Completeness | 32/32 tasks complete; 15/15 delta requirements covered |
| Correctness | 59/59 scenarios mapped to implementation, automated tests, or production-browser receipts |
| Coherence | Design decisions D1–D7 followed; no open issues |

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Completeness

- All 32 task checkboxes are complete in `tasks.md`.
- All 15 requirement headings across the four delta specs have implementation evidence.
- Removed Store Board/member aggregation and header run-summary requirements are represented by actual source/test deletion plus the before/after orphan inventories.
- The change validates after task completion.

## Correctness mapping

### Board and canonical routing

- Type-aware project/Store homes and switching are centralized in `packages/ui/src/store/use-space.ts:99` and `packages/ui/src/store/use-space.ts:109`.
- Store legacy Board/Task redirects and project-only Board/Task routes are explicit in `packages/ui/src/app.tsx:49`, `packages/ui/src/app.tsx:60`, and `packages/ui/src/app.tsx:103`.
- Space bootstrap, switcher, rows, and create success all consume the shared helpers in `SpaceBootstrap.tsx`, `SpaceSwitcher.tsx`, `SpacesPage.tsx`, and `CreateSpaceDialog.tsx`.
- Route/helper/app/space tests cover opaque selectors, cross-namespace preservation/fallback, replace history, canonical create destinations, stale revalidation, and absence of project mirrors.
- `BoardPage` remains project-only, while the deleted Store aggregate components and header running menu have zero production/test references.

### Issue ownership, provenance, and handoff links

- Synchronous route ownership is enforced by selector-keyed children in `packages/ui/src/components/IssueBoardPage.tsx:40` and `packages/ui/src/components/IssueDetailPage.tsx:236`.
- The closed six-family, `git|runtime` presentation index lives in `packages/ui/src/components/issue-provenance.ts`; Issue card state links consume its stable anchors.
- Detail renders unique provenance entries at `packages/ui/src/components/IssueDetailPage.tsx:205` and ordinary Store Operations/Unlinked links at lines 333 and 340.
- Real `preact-iso` transition tests cover late Store/Issue responses; provenance tests cover exact payload locators, diagnostics, fragment resolution, and no API writes.
- The Issue read components contain no localStorage, sessionStorage, Cache Storage, IndexedDB, or service-worker access.

### Replacement and presentation

- The pre/post orphan inventories prove the three retired components and their exclusive tests/styles/locales were removed without deleting shared public Store API contracts.
- Locale JSON parses and key-parity tests pass for en, ja, and zh-cn.
- Responsive/focus/target presentation is covered by token-based CSS and the production UI build.
- The architecture index now locates the canonical Store home, type-aware switching, project-only Board, provenance map, Operations/Unlinked owners, and removed components.

### Production-browser evidence

- `browser-disposable-receipt.json` proves Issues → Detail → Operations → Unlinked navigation, exact provenance fragments/locators, complete storage clearing, equal fresh-read rebuild digests, and a controlled committed-evidence change without invalidation.
- `browser-persistent-readonly-receipt.json` records the complete 311-entry tracked-byte manifest for `issue-registry`. HEAD, clean status, every tracked entry, and aggregate SHA-256 are identical before/after; all captured management-origin requests are GET.
- Harness processes, dedicated Chrome targets, secret metadata, and six scoped temp logs were cleaned up; the shared CDP proxy remained running.

## Coherence

- D1: one pure route matrix owns canonical homes and switch behavior.
- D2: selector keys, not effect timing, own Issue route state.
- D3: provenance only groups existing payload facts; no endpoint, durable model, or second status derivation was added.
- D4: Issue actions delegate to Store Operations and Unlinked Changes without guessing Run/project selectors.
- D5: Store Board duplicates and the header run summary are removed in one cutover.
- D6: disposable and persistent real-browser receipts cross the production asset, HTTP, Git, runtime, DOM, and storage boundaries.
- D7: focused regressions plus the full UI package, builds, validation, encoding, and diff integrity gates match the changed risk.
- No version file or `src/core/pipeline-registry/**` file changed, and unrelated `.rasen/` debris was preserved.

## Findings

### Blocker

None.

### Major

None.

### Minor

None.

### Trivial

None.

## Final assessment

All checks passed. Ready for the downstream merge/ship decision; archive remains gated by the change's `on-merge` timing.

TEST EVIDENCE
- scope: root TypeScript/native build; full `@atelierai/rasen-ui` test package; production UI build; change validation; disposable and persistent production-browser smoke
- rationale: the change is a UI routing/state/provenance cutover, so the full UI package plus both production browser evidence lines cover its behavior, while the root build and Rasen validation cover integration and artifacts
- command: `pnpm run build`; `pnpm --filter @atelierai/rasen-ui test`; `pnpm --filter @atelierai/rasen-ui build`; `node bin/rasen.js validate issue-board-cutover`
- result: pass
- tree: 90545c0c3df1137bb171138247ebcce9550340e6
