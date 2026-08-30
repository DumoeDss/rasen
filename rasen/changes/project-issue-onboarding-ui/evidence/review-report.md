# Pre-Landing Review: Project Issues Onboarding UI

- Mode: dispatched / report-only
- Branch: `feat/project-issue-onboarding`
- Base: `origin/dev/0.2.0`
- Reviewed HEAD: `8f6266525b3b32940780a94f0f3565aaeeaf06d1` plus the current uncommitted UI implementation
- Result: **CHANGES REQUIRED — 0 Blocker, 1 Major, 2 Minor, 0 Trivial**
- Greptile: no PR exists yet, so there were no comments to triage

## Scope Check

**CLEAN.** The implementation stays within the approved topology: Project navigation gains only a transitional `/p/:projectId/issues` onboarding route; Issue Board and Detail remain Store-owned; membership is established through the sibling two-identifier API; no Project→Store map, preferred Store, adoption, or planning rebind was added.

## Findings

### Major — Membership comparison contradicts the domain's case-insensitive Project identity

- Evidence: `packages/ui/src/components/ProjectIssueOnboardingPage.tsx:100-102` derives membership with `member.projectId === project.id`. The route intentionally preserves the Project token verbatim (`packages/ui/src/store/use-space.ts:5-11`, `:39-52`), while Store membership explicitly normalizes identity with trim + lowercase (`src/core/store/project-records.ts:54-81`; `src/core/store/membership.ts:759`). `handleSpaces()` returns the registry's original Project id at `src/core/management-api/spaces.ts:109-115` but returns the normalized membership-record id at `:180-191`. The real-CLI test exercises exactly this state with uppercase UUID `8A8B...` and only finds the returned member after lowercasing both sides (`test/core/management-api/create-space.integration.test.ts:91-98`, `:114-130`).
- Impact: an already-member Project whose configured/URL id contains uppercase characters is misclassified as having zero memberships. It does not auto-enter its sole Store, and multiple-member choices are also wrong; the user is instead offered a redundant Join flow even though the server correctly considers the membership present. This breaks the core zero/one/many routing requirement.
- Fix: compare canonical Project identities (trim + lowercase) only for membership equality while preserving the opaque route token for URLs and mutation input. Prefer one shared, explicit identity helper or normalize the catalog projection server-side. Amend design/spec wording that currently mandates raw-string “exact” equality, and add an uppercase-UUID regression covering Project row → Store member → automatic Store Issues navigation.
- Classification: **ASK** because the code, identity contract wording, and regression evidence must be changed together.

### Minor — Fixed Store creation exposes English-only copy in Japanese and Chinese onboarding

- Evidence: onboarding opens `CreateSpaceDialog` in fixed Store mode (`packages/ui/src/components/ProjectIssueOnboardingPage.tsx:302-309`), but the dialog still hardcodes the Store instructions, path label, Store-id label, validation message, cancel/action labels, and related accessible copy (`packages/ui/src/components/CreateSpaceDialog.tsx:62`, `:131`, `:161-190`, `:223-244`). Locale keys such as `spaces.create.kind_label`, `spaces.create.store`, `spaces.create.store_id`, `spaces.create.cancel`, `spaces.create.creating`, and `spaces.create.create` already exist in all three catalogs.
- Impact: the Japanese and Simplified Chinese onboarding path switches to English at the required “Create Store” step, violating `specs/project-issue-onboarding/spec.md:136-160` and the completed localization task 4.3.
- Fix: route all visible strings and accessible names in the dialog through locale keys, adding operation-specific keys where the existing generic keys are insufficient; add a non-English fixed-mode assertion.
- Classification: **AUTO-FIX** (mechanical localization plus focused test).

### Minor — Required interaction/identity boundaries are not fully regression-tested

- Evidence: the focused suite covers loading/failure, zero/one/many raw-equal memberships, first join, same-target retry, create-then-retry, route transition, and unmount (`packages/ui/test/components/project-issue-onboarding-page.test.tsx:153-370`). It does not exercise (a) canonical-equivalent ids with different casing, (b) a rapid second submit while join is pending, (c) selecting a different Store after a failed join (`spec.md:81-85`), (d) zero/one/many recomputation after an external catalog publication or retry supersession (`spec.md:53-57`), or (e) navigation from a returned Store id different from the preselected row (`spec.md:69-73`).
- Impact: the identity defect above passed all current tests, and attempt-ownership/returned-truth behavior can regress without failing the suite.
- Fix: add focused component cases for these five boundaries. The casing case is part of the Major fix; the remaining cases are ordinary unit/component coverage.
- Classification: **AUTO-FIX**.

## Standards Axis

- Route ownership is deep and correct: Project onboarding does not import or mount Store Issue read components.
- The membership mutation stays behind `addProjectToStore(projectId, storeId)` and uses the returned Store for publication/navigation.
- Async ownership guards prevent late create/join results from publishing or navigating after Project change/unmount.
- Styling uses existing tokens and the narrow layout retains textual relationship labels.
- **Major exception:** client identity comparison does not use the canonical equality already established by core.
- **Minor exception:** the controlled dialog is not fully localized in the new onboarding flow.

## Spec Axis

- Implemented: Project Issues discovery, exact transitional route boundary, Store-canonical Board/Detail, catalog gating, zero/one/many UI, explicit joining, returned-space publication before revalidation/navigation, partial-success retry, and Project-attempt ownership.
- Not correctly implemented: one/many membership routing for canonical-equivalent Project ids with different casing.
- Not completely implemented: all onboarding-visible and accessible dialog copy resolving from English, Japanese, and Simplified Chinese catalogs.
- Coverage is incomplete for several explicitly specified concurrency and retry scenarios listed above.

## Coverage Map

```text
CODE PATH COVERAGE
==================
[+] Route/navigation boundary
    ├── [★★★ TESTED] Project onboarding vs Store Board/Detail ownership
    └── [★★★ TESTED] canonical homes, deep-URL refusal, space switching
[+] Catalog-derived membership
    ├── [★★★ TESTED] unresolved, failed+retry, zero, one, many (raw-equal ids)
    ├── [GAP]         canonical-equivalent ids with different casing
    └── [GAP]         external publication/retry supersession recomputation
[+] Existing-Store membership
    ├── [★★★ TESTED] exact request ids, publish → refresh → replace route
    ├── [★★★ TESTED] failure and same-target idempotent retry
    ├── [GAP]         duplicate submit while the promise is pending
    ├── [GAP]         choose another Store after failure
    └── [GAP]         returned Store id differs from selected row
[+] Store creation handoff
    ├── [★★★ TESTED] fixed operation, callback, no default navigation
    └── [★★★ TESTED] create success + join failure + membership-only retry

USER FLOW COVERAGE
==================
[+] [★★★ TESTED] Project nav → onboarding; Store nav → canonical Issues
[+] [★★★ TESTED] sole membership auto-entry and multi-membership choice
[+] [★★★ TESTED] join existing Store and create-then-join Store
[+] [★★★ TESTED] Project transition/unmount rejects late async completion
[!] [DEFECT]      uppercase UUID member is presented as zero membership
[!] [DEFECT]      Japanese/Chinese create-Store step contains English copy
[ ] [GAP]         double-click, alternate Store after failure, live publication

QUALITY: core happy/error flows are strong; identity and locale boundaries are not.
```

## Verification Evidence

- API bridge/wire/whitelist: 51/51 passed.
- Management router: 46/46 passed.
- UI onboarding component suite: 11/11 passed.
- UI route/dialog/switch matrix: 70/70 passed.
- UI client/fixtures: 46/46 passed.
- Real CLI membership integration: 2/2 passed, including idempotent replay, unique membership, and unchanged Project planning Store.
- Isolated i18n checks: 12/12 passed; these check catalogs/keys but do not detect the dialog's hardcoded English literals.
- Root `tsc --noEmit`: passed.
- Both Change artifacts: strict validation passed.
- `git diff --check origin/dev/0.2.0`: passed.
- Strict UTF-8 decode, no-BOM/replacement/mojibake/trailing-whitespace checks over all changed files, plus JSON parsing: passed before this report.
- UI global typecheck remains blocked by 13 pre-existing Canvas diagnostics outside this diff.
- The full UI test run reached passing functional suites but its aggregate gate failed when `build-split.test.ts` hit `ENOSPC`; the concurrent i18n scan timed out and passed 12/12 in isolation. E: currently has about 0.11 GB free, so UI/root production builds were not rerun.

## Verdict

**NOT REVIEW-CLEAN.** Route the Major identity mismatch and both Minor items to a non-author fixer, then require a fresh independent re-review. Shipping must not proceed while the Major remains.
