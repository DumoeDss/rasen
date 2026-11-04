# Review Cycle Round 1 Re-review: Project Issues Onboarding UI

- Mode: dispatched / read-only re-review
- Branch: `feat/project-issue-onboarding`
- Base: `origin/dev/0.2.0`
- Reviewed HEAD: `8f6266525b3b32940780a94f0f3565aaeeaf06d1` plus the current non-author fix delta
- Status: **DONE (verification constrained by ENOSPC)**
- Result: **CHANGES REQUIRED — 0 Blocker, 0 Major, 1 Minor, 0 Trivial open**
- New Blocker/Major introduced by the fix: **none found**

## Original Finding Disposition

### RESOLVED — Major: membership comparison contradicted case-insensitive Project identity

- `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:20-28` now defines `sameProjectIdentity()` as trim + lowercase equality, and its only production use is membership filtering at `:100-103`.
- The opaque route token is not rewritten: `packages/ui/src/store/use-space.ts:39-52` parses it verbatim, while onboarding still calls `addProjectToStore(project.id, store.id)` at `ProjectIssueOnboardingPage.tsx:124-131`. Success navigation uses the API-returned `result.space.id` at `:132-135`.
- `packages/ui/test/components/project-issue-onboarding-page.test.tsx:193-202` is a real uppercase regression: an uppercase route Project matches a lowercase Store member, replace-routes to `/s/store-a/issues`, and never calls the membership mutation.
- `rasen/changes/project-issue-onboarding-ui/design.md:41-42` and `specs/project-issue-onboarding/spec.md:27-40,67-68` now require canonical equality only for membership comparison while expressly preserving route and mutation tokens. They still prohibit a persisted Map, cache, preferred Store, and normalized mutation token.

### OPEN — Minor: fixed/onboarding Store creation is not fully localized

- The direct `CreateSpaceDialog` literals named by the first review were fixed: form/operation accessibility, instructions, current-path label, Store-id label and validation, preview, cancel, and operation-specific actions now resolve through `t(...)` (`packages/ui/src/components/CreateSpaceDialog.tsx:114-118,124-180,186-244`). Default Spaces behavior remains covered by the three-operation and canonical-navigation cases.
- However, the fixed dialog necessarily renders `LocalPathPicker`, whose onboarding-visible controls remain English literals: `Choose directory` / `Choose package file` and both native-choice statuses (`packages/ui/src/components/LocalPathPicker.tsx:88-116`), `aria-label="Server-local path"`, its placeholder, `Go`, and `Up` (`:120-169`), plus the `resolved` status (`:177-182`). These are visible actions and accessible names inside the required onboarding creation step, so the locale scenario is still only partially implemented.
- The new Japanese test at `packages/ui/test/components/spaces-page.test.tsx:429-458` discriminates the strings owned directly by `CreateSpaceDialog`, including validation, but does not assert any of the picker strings above. There is no equivalent Simplified-Chinese rendered-dialog assertion; catalog key parity alone cannot detect hardcoded child copy.
- Required fix: localize the shared picker controls/status/accessibility strings (or provide a fully localized label contract), add keys in all three catalogs, and extend the fixed-dialog test so both Japanese and Simplified Chinese prove that these child controls do not fall back to English.

### RESOLVED — Minor: interaction and identity boundary coverage was incomplete

The added tests exercise public behavior and pin the claimed boundaries:

- canonical-equivalent uppercase identity: `project-issue-onboarding-page.test.tsx:193-202`;
- duplicate submit while pending, including disabled control and one API call: `:272-292`;
- failure followed by selecting a different Store and a second request with the new Store id: `:294-321`;
- recomputation from a shared-catalog publication and automatic canonical routing: `:323-334`;
- publishing and navigating from a returned Store id different from the selected row: `:336-371`.

The page retains a Project-keyed child, mount/attempt invalidation, an imperative in-flight guard, and a sole-membership effect keyed only by the derived Store id (`ProjectIssueOnboardingPage.tsx:35-39,58-85,109-135`). No fix-introduced effect loop or overlapping membership request path was found.

## Focused Verification Evidence

- PASS — `pnpm exec vitest run test/components/project-issue-onboarding-page.test.tsx`: **1 file, 16/16 tests**, 5.48 s.
- PASS — `pnpm exec vitest run test/components/spaces-page.test.tsx`: **1 file, 18/18 tests**, 6.28 s.
- NOT RUN — i18n catalog assertions. `pnpm exec vitest run test/i18n/catalog.test.ts` failed during Vite config startup with `ENOSPC: no space left on device, write`; no test file executed.
- Tracked `git diff --check` emitted no whitespace diagnostics before ENOSPC (only configured LF→CRLF warnings). A complete post-report/untracked-file diff check was not run.
- NOT RUN after ENOSPC, per the explicit stop rule: strict Rasen validation, further tests, formal strict UTF-8/no-BOM scan, typecheck, build, and full suites. The three locale JSON files had parsed successfully before ENOSPC, but that is not claimed as the requested final UTF-8 gate.

ENOSPC is an environment limitation, not a code finding.

## Durable Findings

- The identity fix is appropriately narrow: trim/lowercase is an equality helper, not a normalized Project/Store token or cached mapping.
- The new concurrency tests are meaningful; they assert API counts/arguments and returned-truth publication/navigation rather than component internals.
- The localization seam must include the child path picker, not only literals lexically located in `CreateSpaceDialog`. A locale-parity test cannot catch English text that never calls `t()`.
- Re-run the i18n catalog test, strict change validation, full UTF-8/diff checks, and any remaining required gates only after disk space is restored.

## Verdict

**NOT REVIEW-CLEAN.** The original Major and coverage Minor are resolved, and the fix introduced no new Blocker or Major. The localization Minor remains open because the fixed onboarding dialog still exposes English child controls and accessible copy; it is small and should be completed rather than accepted silently. Verification is additionally incomplete after the mandatory ENOSPC stop.

---

# Review Cycle Round 2 Re-review: LocalPathPicker i18n Fix

- Mode: dispatched / read-only re-review
- Branch: `feat/project-issue-onboarding`
- Reviewed scope: round 2 `LocalPathPicker` implementation, locale keys, focused tests, and the round 1 finding state
- Status: **DONE**
- Result: **CHANGES REQUIRED — 1 Blocker, 0 Major, 0 Minor, 0 Trivial open**
- Fixer evidence: no separate fixer-result artifact was present; the latest run-state identifies round 2 and the LocalPathPicker localization finding, so this re-review used the current fix delta as source truth.

## Round 2 Finding

### OPEN — Blocker: the Spaces regression suite was truncated to an empty file

- `packages/ui/test/components/spaces-page.test.tsx` is currently **0 bytes / 0 lines**. `git diff --numstat` reports `0` insertions and `485` deletions for that file.
- The required focused command fails: `pnpm exec vitest run test/components/spaces-page.test.tsx` reports `No test suite found`, one failed suite, and zero tests.
- This deletes all 18 cases that passed in round 1, including standalone three-operation behavior, default Project/Store creation and registration navigation, fixed-mode callback suppression, Store validation, Windows path behavior, catalog publication safety, and the Japanese fixed-dialog assertion. Consequently there is no Japanese or Simplified-Chinese fixed Store dialog test exercising the picker child, and ordinary Spaces behavior is no longer regression-protected.
- Required fix: restore the exact pre-round-2 `spaces-page.test.tsx` content (including its round 1 additions), then extend the fixed-dialog coverage with discriminating Japanese **and** Simplified-Chinese assertions for picker buttons, path accessible name/placeholder, navigation actions, fallback/status copy, and resolved text. Do not restore only the base-branch version because that would lose the onboarding tests added in round 1.
- Canonical severity: **Blocker** because a required focused gate fails and a complete existing regression suite was removed.

## LocalPathPicker Implementation Review

The production localization change itself is correct within the reviewed scope:

- `LocalPathPicker` now obtains `t` inside the component (`packages/ui/src/components/LocalPathPicker.tsx:5,43`) and routes every component-owned visible/accessibility/status literal through `local_path_picker.*`: choose-directory/file, cancelled/unavailable statuses, path aria-label and placeholder, Go/Up, default Target, resolved state, and git badge (`:99-116,125-126,145,159,170-173,199`).
- A caller-provided `currentLabel` remains authoritative while the component default is localized. This preserves existing caller behavior; onboarding already passes a localized `spaces.create.path_label.*` value.
- Entry names and `controller.error` remain server/domain data rather than component-owned UI literals.
- English, Japanese, and Simplified-Chinese catalogs define the same 11 keys at `packages/ui/src/i18n/locales/{en,ja,zh-cn}.json:71-81`. The Japanese and Chinese values are semantically appropriate and are not copied English, except the intentional technology badge `git`.
- `packages/ui/test/components/local-path-picker.test.tsx:99-107` preserves English-default assertions for the shared component, and its complete behavior suite passed 5/5. This proves no ordinary picker regression on selection, cancellation/fallback, resolution, directory/file navigation, git marking, or Windows separators, but it does not replace the missing ja/zh-cn fixed-dialog integration coverage.

No new production-code race, effect loop, mutation, route, or accessibility defect was found in this round 2 implementation.

## Round 1 Finding Recheck

- **Identity Major remains resolved:** `sameProjectIdentity()` is still trim+lowercase membership equality only, while `addProjectToStore(project.id, store.id)` still receives the original tokens (`ProjectIssueOnboardingPage.tsx:26-28,110,130`).
- **Interaction/identity coverage Minor remains resolved in its own file:** the uppercase identity, pending duplicate, alternate Store after failure, external catalog recomputation, and API-returned Store-id cases remain present in `project-issue-onboarding-page.test.tsx:193-202,272-371`.
- **Localization Minor is resolved in production code but not accepted as closed:** the required ja/zh-cn fixed-dialog proof was deleted with `spaces-page.test.tsx`; this is subsumed by the Blocker above rather than counted twice as a Minor.

## Round 2 Verification Evidence

- PASS — `pnpm exec vitest run test/components/local-path-picker.test.tsx`: **1 file, 5/5 tests**, 3.28 s.
- FAIL — `pnpm exec vitest run test/components/spaces-page.test.tsx`: **1 failed suite, 0 tests**, `No test suite found`, 1.16 s.
- PASS — `pnpm exec vitest run test/i18n/catalog.test.ts`: **1 file, 12/12 tests**, 1.51 s.
- PASS — `node E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\bin\rasen.js validate project-issue-onboarding-ui --strict --json`: **1/1 change valid, 0 issues**.
- PASS — `git diff --check`: no whitespace errors; only configured LF→CRLF warnings.
- PASS — strict UTF-8 decode, no BOM/U+FFFD/mojibake/trailing-whitespace checks over eight related files; all three locale JSON files parsed successfully.
- No ENOSPC occurred in round 2.

## Round 2 Durable Findings

- The i18n implementation is deep enough: localization lives in `LocalPathPicker` itself rather than being duplicated by onboarding.
- Catalog parity plus English shared-component tests cannot prove non-English integration; keep explicit Japanese and Simplified-Chinese fixed-dialog assertions.
- A zero-byte test file is not an acceptable disk-pressure workaround or partial fix. Restore the pre-round-2 suite before any further review-cycle attempt.

## Round 2 Verdict

**NOT REVIEW-CLEAN.** The production picker strings and locale catalogs are corrected, but round 2 introduced a failing focused gate by truncating the entire Spaces test suite. Restore that suite and add real Japanese and Simplified-Chinese picker-child coverage before independent re-review.

---

# Review Cycle Round 3 Final Re-review

- Mode: dispatched / read-only re-review
- Branch: `feat/project-issue-onboarding`
- Reviewed scope: rebuilt Spaces suite, cumulative round 1–3 finding dispositions, and final focused/static gates
- Status: **DONE**
- Result: **REVIEW-CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial open**
- Review-cycle total: **3 rounds**

## Round 3 Blocker Disposition

### RESOLVED — Blocker: Spaces regression suite was truncated

- `packages/ui/test/components/spaces-page.test.tsx` is restored to a non-empty 27,693-byte file. A repository-wide scan found **0 zero-byte files across all 27 changed/untracked files**.
- An exact title comparison against `HEAD:packages/ui/test/components/spaces-page.test.tsx` found all **15/15 baseline test titles** in the rebuilt file. The current suite contains 19 tests: the 15 baseline cases plus four scoped onboarding/dialog cases.
- The diff preserves every baseline assertion path. Its only modification inside a baseline case adds default-English picker assertions and moves the existing `pathInput` declaration earlier; directory navigation, Up/Go behavior, typed-path resolution, creation, publication, pinning, search, registration, Windows separator, and duplicate-selector coverage remain intact.
- The required focused suite now passes **19/19**, resolving the round 2 failing gate.

## New Test Quality

- Fixed Store mode is real, not a snapshot-only assertion: `spaces-page.test.tsx:385-390` proves the standalone dialog keeps all three operations, while `:392-438` proves fixed mode hides the chooser, sends `create-store(parent,id)`, publishes/revalidates, calls `onSuccess` with the fresh response, and suppresses navigation from the Project onboarding URL.
- Default navigation remains pinned by the restored baseline cases: Project creation enters `/p/newproj/board`, Store creation enters `/s/team-store/issues`, and Store registration enters `/s/registered-store/issues`.
- Store-id validation is exercised through a real form submission with an empty id and asserts the Japanese validation result (`:440-490`).
- The Japanese fixed-dialog test is discriminating: it asserts picker button, aria-label, placeholder, Go/Up, resolved state, cancelled and unavailable statuses, rejects English fallback, and also covers dialog copy/actions (`:440-490`).
- The Simplified-Chinese case independently asserts picker button, aria-label, placeholder, Go/Up, resolved and unavailable statuses, rejects English fallback, and covers dialog copy/actions (`:493-533`). It is not satisfied merely by catalog key parity.
- The existing Spaces local-path baseline now also pins the unchanged English shared-component contract (`:229-267`).

## Cumulative Finding Disposition — All Three Rounds

1. **Round 1 Major — canonical Project identity:** RESOLVED. `sameProjectIdentity()` remains trim+lowercase equality only, and the original route token still enters `addProjectToStore(project.id, store.id)` unchanged (`ProjectIssueOnboardingPage.tsx:26-28,110,130`). The uppercase auto-route regression remains present and the onboarding suite passes 16/16.
2. **Round 1 Minor — fixed/onboarding dialog localization:** RESOLVED. Every component-owned picker string is routed through `LocalPathPicker`'s own `useT()` keys (`LocalPathPicker.tsx:46,99-116,125-126,145,159,170-172,199`); all 11 keys exist with meaningful English, Japanese, and Simplified-Chinese values at locale lines 71-81; the rebuilt ja/zh-cn fixed-dialog integration tests prove actual rendered behavior.
3. **Round 1 Minor — interaction/identity boundary coverage:** RESOLVED. The uppercase identity, pending duplicate, alternate Store after failure, external catalog recomputation, and API-returned Store-id cases remain at `project-issue-onboarding-page.test.tsx:193-202,272-371` and pass in the 16-test focused suite.
4. **Round 2 Blocker — zero-byte Spaces suite:** RESOLVED by the complete baseline-preserving reconstruction and 19/19 passing focused result.

No new production-code or test finding at Blocker, Major, Minor, or Trivial severity was found in round 3.

## Final Verification Evidence

- PASS — `pnpm exec vitest run test/components/spaces-page.test.tsx`: **1 file, 19/19 tests**, 5.28 s.
- PASS — `pnpm exec vitest run test/components/local-path-picker.test.tsx test/i18n/catalog.test.ts`: **2 files, 17/17 tests** (picker 5, catalog 12), 3.49 s.
- PASS — `pnpm exec vitest run test/components/project-issue-onboarding-page.test.tsx`: **1 file, 16/16 tests**, 5.26 s.
- PASS — `node E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\bin\rasen.js validate project-issue-onboarding-ui --strict --json`: **1/1 change valid, 0 issues**.
- PASS — `git diff --check`: no whitespace errors; only configured LF→CRLF warnings.
- PASS — strict UTF-8 decode, no BOM/U+FFFD/mojibake/trailing-whitespace, JSON parsing, and zero-byte scan over **all 27 changed/untracked files**.
- No ENOSPC occurred in round 3. Full UI/build/root suites were intentionally not run per dispatch scope.

## Final Verdict

**REVIEW-CLEAN.** After three rounds, every original and review-cycle finding is resolved, no open Blocker/Major/Minor remains, all requested focused tests pass, strict change validation passes, and the complete changed/untracked set passes whitespace, UTF-8, JSON, and zero-byte gates.
