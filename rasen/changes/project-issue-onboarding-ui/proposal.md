## Why

Issues are discoverable only after a user has already entered a Store, leaving a standalone Project with no UI path to join the Store-owned Issue workflow. The new membership API is now available, so the Project surface can provide that missing onboarding without creating a second Issue model or changing where the Project plans.

## What Changes

- Add an Issues entry to Project navigation and a transitional `/p/:projectId/issues` route whose only job is Store onboarding or explicit Store selection; it never renders an Issue Board or Detail.
- Derive the Project's Store memberships fresh from the shared spaces catalog: redirect one membership to its canonical Store Issue Board, require an explicit choice among multiple memberships, and offer Store creation or explicit existing-Store selection when there are none.
- Join only through `addProjectToStore(projectId, storeId)`, publish the returned fresh `StoreSpaceEntry`, revalidate the shared catalog, and replace-navigate to `/s/:storeId/issues`.
- Make `CreateSpaceDialog` optionally controlled so the onboarding flow can create a Store, establish membership, and then navigate, while the existing Spaces-page create/register behavior remains unchanged.
- Keep API failures actionable and retryable, including partial progress where Store creation succeeded but membership failed.
- Reuse the existing warm-editorial component system and add one business-significant Project → Store → Issues topology rail; add responsive, accessible, localized states without a broader visual redesign.

## Capabilities

### New Capabilities

- `project-issue-onboarding`: Project Issues discovery, zero/one/many Store-membership routing, Store creation/selection, retry, catalog publication, and canonical Issue navigation.

### Modified Capabilities

- `issue-board-ui`: Replace the former absence of any Project Issues navigation with a transitional onboarding entry while keeping the Issue Board and Detail exclusively Store-owned.

## Impact

- UI routing and navigation: `packages/ui/src/app.tsx`, `components/Layout.tsx`, and a new Project Issue onboarding page.
- Shared UI seams: `components/CreateSpaceDialog.tsx` and `store/space-catalog.tsx`; the existing `addProjectToStore(projectId, storeId)` client contract is consumed unchanged.
- Presentation: `packages/ui/src/style.css` and all three locale catalogs, using existing tokens and typography.
- Tests: app route/navigation matrices, onboarding zero/one/many membership states, creation/selection, failure/retry and stale-response ownership, controlled dialog behavior, catalog publication, and existing Project Board/Store Issue regressions.
- No backend mutation changes, project-local Issue data, planning-Store binding, `store adopt`, or new dependency.
