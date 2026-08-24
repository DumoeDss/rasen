# Proposal — issue-board-cutover

## Why

The Phase 7 Issue Board, Issue Detail, Store Operations, and Unlinked Changes surfaces now
exist, but the shell still lands Store users on the earlier Task/Change board and still exposes a
second live-session summary. This final slice makes the Issue interface the single navigable
Store truth, closes its route-transition and evidence-tracing interactions, and proves that the
same view can be rebuilt from Git/runtime evidence after client caches are discarded.

## What Changes

- **BREAKING (Store UI navigation):** make `/s/<store>/issues` the canonical Store home. Store
  launch, root, space-list, and Store-to-Store navigation land there; the legacy
  `/s/<store>/board` and `/s/<store>/task/<change>` URLs replace-redirect to canonical Store
  surfaces rather than rendering the Task board/detail. Project `/p/<project>/board` and
  `/p/<project>/task/<change>` remain the project-scoped Change and Run/detail/control surfaces.
- Complete Issue Board/Detail navigation without new truth or mutation APIs: selector-keyed
  state owners prevent same-component Store/Issue transitions from showing or accepting stale
  results; Board state links enter stable Detail evidence anchors; Detail links to Store
  Operations for live controls and to Unlinked Changes for association work while keeping all
  displayed phase, health, progress, attention, review, and delivery facts payload-backed.
- Add an explicit provenance map to Issue Detail. Each displayed state family links to the Git
  record/plan/ref/delivery facts or runtime root/run-state/session facts already present in the
  g-001 projection payload, with missing/unreadable provenance shown as such rather than filled
  in. No endpoint, index, browser database, or UI status cache is added.
- Apply the roadmap §11 replacement disposition in one pass: retain the old Task Board only for
  project spaces, remove its Store-only branches and navigation, remove the header
  `RunningSessionsMenu`, and delete the unreachable `StoreIssuesView` and
  `StoreAggregateBoard` components plus their exclusive tests/styles/locale keys. Store
  Operations and Unlinked Changes keep their existing Store-only routes; no `/p/` mirrors or
  dead switchable sections are introduced.
- Add completion receipts over real Git/runtime fixtures and read-only `issue-registry` dogfood:
  every rendered state-to-provenance link resolves, real same-component route transitions are
  isolated, and clearing/remounting the built UI reproduces an equivalent normalized view from
  fresh API reads. Persistent Store bytes are hashed before and after.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `issue-board-ui`: complete Board/Detail navigation, synchronous selector isolation,
  evidence-backed provenance links, and discard/rebuild equivalence without a second UI truth.
- `management-ui-shell`: make Issues the Store home, preserve only valid sections across
  type-aware space switches, retire the duplicate header session summary, and keep Store-only
  routes out of project navigation.
- `board-ui`: narrow the Task/Change board and Task detail to project spaces and retire the
  superseded Store board/member-board contracts while retaining project Change creation,
  worktrees, live indicators, and Task detail controls.
- `spaces-ui`: route Store rows and newly created/registered Stores to their Issue Board while
  project rows continue to enter the project Task/Change board.

## Impact

- `packages/ui/src/app.tsx`, `store/use-space.ts`, `components/Layout.tsx`,
  `SpaceBootstrap.tsx`, `SpaceSwitcher.tsx`, `SpacesPage.tsx`, and create-space success routing:
  type-aware canonical homes, redirects, and active navigation.
- `IssueBoardPage.tsx`, `IssueCard.tsx`, and `IssueDetailPage.tsx`: selector-keyed state owners,
  evidence anchors/provenance map, and safe links to the stable g-002 Store surfaces; no new
  server or persistence dependency.
- `BoardPage.tsx`: project-only simplification. `StoreIssuesView.tsx`,
  `StoreAggregateBoard.tsx`, and `RunningSessionsMenu.tsx` plus exclusive tests/presentation
  assets are removed after a production-reference sweep.
- Tests cover real `preact-iso` same-component transitions, type-aware route matrices, legacy
  redirects, no `/p/` Store-surface mirrors, project Board/Task-detail preservation,
  state-to-provenance resolution, fresh remount equivalence, and no storage writes. UI tests run
  with `pnpm --filter @atelierai/rasen-ui test`; the production UI and root package builds also
  run.
- The persistent `issue-registry` Store is read-only. Versions,
  `src/core/pipeline-registry/`, the g-001 projection truth, and the g-002 Operations/Unlinked
  data and mutation contracts remain unchanged.
