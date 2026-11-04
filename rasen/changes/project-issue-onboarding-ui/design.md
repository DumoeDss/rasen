## Context

The Store-owned Issue Board and Detail are complete read surfaces at `/s/:storeId/issues[/:issueId]`, while a Project still exposes only its Change Board. A user who starts `rasen ui` in a standalone Project therefore has no UI path to discover the Issue workflow, choose a Store, or establish the Store membership that makes Issues available. The sibling `project-store-membership-api` change supplies the missing mutation as the narrow `addProjectToStore(projectId, storeId)` client call and returns a freshly observed `StoreSpaceEntry`.

The UI already has three relevant seams. The URL is the selected-space authority; `SpaceCatalogProvider` owns a shared, refreshable `SpaceEntry[]` projection; and `CreateSpaceDialog` owns the bounded create/register workflow, catalog publication, and default navigation. Store membership is present in that catalog as `StoreSpaceEntry.members[].projectId`. This change must compose those seams without creating Project-local Issues, a persisted Project→Store lookup, or a second canonical Issue route.

The implementation spans routing, navigation, a new stateful page, a small controlled-dialog seam, localization, styling, and component tests. It does not change filesystem semantics or the Management API wire contract. The UI remains a local browser application on every supported desktop platform; machine paths may be displayed by existing Store rows/dialogs, but the onboarding flow never constructs or submits a filesystem path.

## Goals / Non-Goals

**Goals:**

- Make Issues discoverable from every Project navigation context.
- Resolve zero, one, and multiple Store memberships from the current shared catalog with deterministic, explicit behavior.
- Establish a selected membership through the existing two-identifier client interface, then enter the Store-owned Issue Board using fresh response truth.
- Support Store creation as a recoverable two-step operation, including retry after creation succeeded but membership did not.
- Keep async responses owned by the Project and attempt that started them.
- Extend the warm-editorial UI with one accessible topology rail that explains the real Project → Store → Issues relationship.

**Non-Goals:**

- Rendering an Issue Board or Issue Detail under a Project URL.
- Adding Project-owned Issue records, moving planning artifacts, changing a Project's primary/planning Store, or invoking adoption.
- Persisting a Project→Store Map, membership cache, preferred Store, or onboarding progress in browser/config storage.
- Guessing among multiple memberships or ambiguous catalog identities.
- Changing Store canonical homes, Store navigation, space-switch behavior, or the Management API.
- Redesigning the general Spaces page, the Issue Board, or the application visual system.

## Decisions

### D1. Add one transitional Project route, not a second Issue surface

`app.tsx` registers the exact `/p/:projectId/issues` route to a new `ProjectIssueOnboardingPage`. `Layout` always renders an Issues navigation entry for Projects and marks it current on that route. Existing Store routes continue to mount `IssueBoardPage` and `IssueDetailPage`, and Store navigation continues to link directly to `/s/:storeId/issues`.

The onboarding page has no import or render branch for either Issue read component. Its terminal action is a replace-navigation to `spaceHref(store, 'issues')`. No `/p/:projectId/issues/:issueId` route is added. `spaceHomeHref` remains Project→Board and Store→Issues, and the existing `spaceSwitchHref` matrix remains unchanged: a Project Issues onboarding route switched to another Project falls back to that Project's Board, while switching to a Store enters Store Issues.

This keeps route ownership deep and obvious: Project Issues means membership onboarding; Store Issues means the Issue read surface. Reusing `IssueBoardPage` behind a Project prefix was rejected because every Issue API call is Store-scoped and a Project may belong to zero or many Stores. Redirecting the Project nav link straight to the first Store was rejected because it cannot represent zero or multiple memberships honestly.

### D2. Derive membership on every render from the shared catalog projection

The page consumes `useSpaceCatalog()` and derives matching Stores by filtering the current `spaces` array for `type === 'store'` and comparing each member's Project identity with the core-equivalent canonical rule, `trim().toLowerCase()`. A small local `sameProjectIdentity` helper applies that rule only to the two Project ids involved in membership equality. It does not normalize Store ids or the route token used by navigation and mutation; `project.id` is still passed unchanged to `addProjectToStore` and Project URLs. The page stores neither that derived collection nor a Project→Store Map in component, module, browser, or config state. Store candidates and memberships are recomputed when the shared catalog publishes a new array.

On mount, the Project-keyed page requests a catalog refresh so an external membership change can be observed. It does not auto-route until that load has settled successfully. The state split is:

- unresolved/loading: show a localized resolving state and make no routing choice;
- catalog failure: retain any already published rows for inspection, show the actionable error, and require retry before automatic routing;
- zero memberships: offer all listed Stores as explicit join targets plus Store creation;
- exactly one membership: replace-navigate to that Store's `/issues` route after the successful catalog load;
- multiple memberships: show only the matching Stores and require the user to select one before replace-navigation.

The candidate list uses catalog row facts for labels and paths and the Store id for the canonical route/mutation. It does not collapse or choose rows by array order. If pre-existing catalog corruption makes an id ambiguous, the existing API refusal remains visible rather than being bypassed with a client path.

A module-level membership index was rejected by the deletion test: removing it would leave a single linear filter at one page, while keeping it would introduce invalidation, identity, and test obligations without leverage. Persisting a preferred Store was rejected because it would become a second selection authority beside the URL and catalog.

### D3. Use a Project-keyed child and attempt ownership for async work

`ProjectIssueOnboardingPage` reads the route-derived Project and renders a child keyed by the full Project selector. The child owns catalog gating, selected Store id, create-dialog visibility, joining state, partial-success state, and the current error. A Project route transition therefore replaces all interaction state synchronously before an earlier response can render under the new URL.

Each membership submission receives a monotonically increasing attempt token held in a ref. Completion handlers verify both that the child remains mounted and that the token is still current before publishing, setting state, or navigating. Cleanup invalidates the current attempt. Submit controls are disabled while their attempt is active, while a failed attempt clears the busy state and preserves its exact target for an idempotent retry.

Only keying the request effect by `projectId` was rejected because event-driven create/join promises can outlive that effect and still commit. A global request coordinator was rejected because attempt ownership is local to one route and one mutation button; globalizing it would make the interface shallower and harder to test.

### D4. Keep the membership mutation behind the existing two-identifier client seam

The page calls only `addProjectToStore(project.id, selectedStore.id)`. It never calls generic `createSpace` with a membership discriminant and never accepts or synthesizes a Project root, `set-primary`, alias, dry-run, or adoption option. This preserves the API module as the deep adapter over HTTP details and the server/CLI as the sole membership mutation authority.

On success, ordering is fixed:

1. call `publishSpace(result.space)` with the fresh Store entry returned by the API;
2. start `refreshSpaceCatalog()` in the background;
3. replace-navigate using `result.space.id` to `/s/:storeId/issues`.

Publishing before navigation lets the already-mounted switcher and destination consumers see the membership in the same SPA turn. Navigation uses the returned Store rather than the pre-request row, so optimistic or stale selection data never becomes success authority. The background refresh is not awaited because the returned row already proves the postcondition and delaying canonical navigation adds no correctness.

Calling `refreshSpaceCatalog()` and searching for the target before routing was rejected because it discards the stronger per-operation response, adds a failure window after a successful mutation, and can be confused by unrelated catalog rows. Optimistically editing a Store member array was rejected because it would fabricate domain success.

### D5. Add one controlled Store-creation seam to `CreateSpaceDialog`

`CreateSpaceDialog` gains two optional props in addition to `onCancel`:

```ts
fixedOperation?: 'create-store';
onSuccess?: (result: CreateSpaceResponse) => void;
```

With `fixedOperation="create-store"`, the dialog initializes and remains on Store creation and omits the operation chooser. The dialog still owns validation, `client.createSpace`, `publishSpace(result.space)`, and background `refreshSpaceCatalog()`. After success it calls `onSuccess` when supplied and suppresses its default `spaceHomeHref` navigation. Without `onSuccess`, its current Spaces-page behavior is byte-for-byte equivalent at the interface: publish, refresh, and navigate to the created or registered space's canonical home. Without `fixedOperation`, all three existing operation choices remain available.

The callback is a synchronous ownership handoff, not a second mutation adapter. The onboarding caller closes the dialog, records the returned Store as the selected/created target, and starts the normal membership attempt. This keeps membership failures on the onboarding page, where “Store created, membership pending” can be represented and retried, rather than mislabeling them as Store-creation failures inside the dialog.

Duplicating Store creation inside the onboarding page was rejected because it would repeat path selection, validation, error handling, catalog publication, and accessibility behavior. Turning the whole dialog into a fully controlled form was rejected as a shallow, high-cost interface when the caller needs only one fixed operation and one success handoff.

### D6. Model Store creation plus membership as recoverable partial success

Creation and membership remain two explicit operations; there is no compensating delete. When the dialog returns a created Store, the page publishes that fact through the existing dialog behavior and then attempts membership. If membership fails, the page closes the modal, keeps the created Store as the selected target, identifies that the Store exists but the Project is not yet joined, and exposes retry for the same two ids. The user may also choose a different existing Store after the failed attempt.

This is safer than rollback because Store setup may have durable user-visible files and registration state, and the membership API is idempotent. Treating both calls as one optimistic success was rejected because it would navigate to a Store that may not contain the Project.

### D7. Make the topology rail the only new visual signature

The page reuses `PageHeader`, existing button variants, form controls, error/surface tokens, type scale, radii, shadows, and focus-ring variables. Its identifying element is a semantic topology rail with three labelled nodes:

```text
[Current Project] ── membership ──> [Choose/Create Store] ── canonical ──> [Issues]
```

The rail explains ownership rather than progress: nodes do not acquire completed/current styling and no step animation is added. It is marked up as a labelled list/relationship group, exposes Project and selected Store names as text, and keeps arrows supplemental to localized relationship labels. At the existing narrow breakpoint it becomes a vertical stack with rotated/replaced connectors; controls remain in document order and visible keyboard focus uses the existing focus token. All new copy and accessible names are added to the English, Japanese, and Simplified Chinese catalogs.

A generic wizard/stepper was rejected because the user may be redirected immediately, choose among existing memberships, or recover a partial success; presenting those branches as linear completion stages would misstate the domain. New colors, fonts, icons, or motion were rejected because they would weaken the established warm-editorial system without adding meaning.

### D8. Test at the route, dialog, and onboarding interfaces

Route tests pin that both namespaces offer Issues, Project `/issues` mounts only onboarding, Store `/issues[/:issueId]` still mounts the Board/Detail, Project deep Issue URLs never mount either read surface, and existing canonical homes/switch transitions do not change.

New onboarding component tests inject catalog snapshots and client outcomes through the existing module seams. They cover unresolved and failed catalog reads; zero/one/many membership, including an uppercase Project row matched to a lowercase Store member; explicit multi-membership choice; external catalog publication and membership recomputation; empty-Store joining; exact `addProjectToStore(projectId, storeId)` arguments; duplicate-submit bounding; changing Store after failure; publish→background refresh→replace navigation from the API-returned Store id; failure and idempotent retry; Store-creation success followed by membership failure; and stale completion after Project transition or unmount. Dialog tests pin fixed Store mode, non-English fixed-mode copy and validation, callback-without-navigation, and unchanged default Spaces-page navigation. Locale JSON parsing/key parity, focused UI tests, TypeScript/build checks, and existing Issue/Spaces regressions complete verification.

Tests do not reach into a derived membership Map because none exists. They assert visible choices and public calls, the same interfaces production uses.

## Risks / Trade-offs

- [A catalog can change between display and submission] → Keep target ids explicit, let the server re-resolve fresh authority, surface its refusal, and make retry refresh the catalog.
- [An old catalog row could cause an incorrect automatic redirect] → Force a catalog refresh on route entry and auto-route only after a successful settled load; never route from list order.
- [Store creation can succeed while membership fails] → Preserve the created Store and target, state the partial success, and retry only the idempotent membership operation; never delete the Store automatically.
- [Late promises can publish or navigate after a Project switch] → Replace state through a selector-keyed child and gate every mutation completion by mount and attempt ownership.
- [The shared catalog refresh can fail after a successful membership] → Publish the API's fresh Store entry before starting the best-effort refresh and canonical navigation; the successful operation response remains the immediate UI truth.
- [Adding a Project Issues link can be mistaken for Project-owned Issues] → Keep the page explanatory, use the topology rail, and mount all Issue data surfaces exclusively under Store routes.
- [A small controlled-dialog seam can grow into a generic form API] → Limit the prop to the one justified fixed operation and one success handoff; retain all form and side-effect ownership inside the dialog.

## Migration Plan

This is an additive UI route and component with no persisted schema or data migration. Ship it with the sibling membership API/client contract. Existing Project home URLs still resolve to Board, Store homes still resolve to Issues, old Store Board/Task redirects remain unchanged, and the Spaces page keeps its current create/register workflow.

Rollback removes the Project route/nav entry, onboarding component/styles/locale keys, and the two optional dialog props. Store memberships or Stores created through the flow are valid domain records and are not rolled back. Because no onboarding selection or membership index is persisted, there is no client-state cleanup.

## Open Questions

None.
