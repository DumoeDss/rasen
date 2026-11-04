## 1. Route and Navigation Boundary

- [x] 1.1 Add `ProjectIssueOnboardingPage.tsx` with a route-derived Project wrapper and a selector-keyed child, without importing or rendering Issue Board/Detail components.
- [x] 1.2 Register only the exact `/p/:projectId/issues` onboarding route in `app.tsx`, keeping `/s/:storeId/issues[/:issueId]`, Project/Store canonical homes, and legacy Store redirects unchanged.
- [x] 1.3 Update `Layout.tsx` so every Project nav includes an active-aware Issues link to onboarding while Store nav continues to link directly to its canonical Issue Board.

## 2. Controlled Store Creation Seam

- [x] 2.1 Extend `CreateSpaceDialog` with the minimal optional `fixedOperation="create-store"` and `onSuccess(result)` props, hiding the operation chooser only in fixed mode.
- [x] 2.2 Preserve dialog ownership of validation, creation, `publishSpace`, and background `refreshSpaceCatalog`; invoke the callback and suppress default navigation only when a callback is present.
- [x] 2.3 Add dialog/Spaces-page tests for fixed Store mode, callback result delivery without navigation, and unchanged three-operation default creation/registration navigation.

## 3. Project Onboarding State Machine

- [x] 3.1 Refresh the shared spaces catalog on onboarding entry and derive Store rows directly on render using core-equivalent canonical Project identity equality (trim + lowercase) only for membership comparison, with no persisted lookup, preferred Store, or membership Map and no rewriting of route/mutation tokens.
- [x] 3.2 Implement unresolved and failed catalog states with localized retry, gating automatic routing until a refresh has settled successfully even when older rows remain published.
- [x] 3.3 Implement zero-membership selection across listed Stores, one-membership replace redirect, and explicit multi-membership selection without list-order fallback.
- [x] 3.4 Implement existing-Store joining through only `addProjectToStore(projectId, storeId)`, preserving the selected target on actionable failure and disabling duplicate submission while active.
- [x] 3.5 On membership success, publish the returned fresh `StoreSpaceEntry`, start a background catalog refresh, and replace-navigate from the returned Store id to `/s/:storeId/issues` in that order.
- [x] 3.6 Add mount and monotonically increasing attempt guards so stale catalog/membership completions cannot set state, publish, or navigate after a Project transition, retry supersession, or unmount.
- [x] 3.7 Connect fixed Store creation to the membership path and represent creation-success/membership-failure as recoverable partial success that retries only membership against the created Store.

## 4. Presentation, Accessibility, and Localization

- [x] 4.1 Build the Project → membership → Store → canonical Issues topology rail and Store-choice controls with semantic labels, document-order keyboard interaction, and existing `PageHeader`/button/form primitives.
- [x] 4.2 Add onboarding styles to `style.css` using only existing warm-editorial tokens, including a vertical narrow-screen rail and visible focus behavior, with no decorative animation or new visual tokens.
- [x] 4.3 Add every new visible string, state, action, relationship label, fixed-dialog validation, shared LocalPathPicker control/status, and accessible name to the English, Japanese, and Simplified Chinese locale JSON files and verify key parity/JSON syntax.

## 5. Behavioral Tests and Verification

- [x] 5.1 Extend `app.test.tsx` and `use-space` regression coverage for Project Issues navigation/onboarding, Store Board/Detail ownership, Project deep-URL refusal, canonical homes, and cross-namespace switch behavior.
- [x] 5.2 Add focused onboarding component tests for catalog loading/error, zero/one/many memberships, canonical-equivalent Project ids, external catalog recomputation, empty-Store joining, explicit ids, multi-Store choice, duplicate-submit bounding, alternate selection after failure, API-returned Store truth and publish-refresh-replace ordering, failure, and idempotent retry.
- [x] 5.3 Add onboarding tests for created-Store partial success, non-English fixed Store creation, and late catalog/create/join completions after Project transition, superseding attempt, and unmount.
- [x] 5.4 On Windows, run the CreateSpaceDialog/local-path tests and confirm the onboarding seam passes through existing selections without constructing filesystem paths or hardcoded filesystem separators.
- [x] 5.5 Run `pnpm --filter @atelierai/rasen-ui typecheck`, focused UI tests, the full UI test suite, `pnpm --filter @atelierai/rasen-ui build`, strict change validation, and `git diff --check`.
