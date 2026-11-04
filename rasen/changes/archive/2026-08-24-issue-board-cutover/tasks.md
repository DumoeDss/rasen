# Tasks — issue-board-cutover

## 1. Canonical route helpers and route matrix

- [x] 1.1 Add focused pure tests for the D1 route matrix in `packages/ui/test/store/use-space.test.ts`
  (or the existing route-helper suite): project home = Board; Store home = Issues; common
  Config/Archive/Pipelines sections survive cross-namespace switches; Store-only
  Issues/Operations/Unlinked sections survive only Store→Store; every other switch falls back to
  the destination home. Include opaque ids containing case, percent-escaped characters, and colons.
- [x] 1.2 Implement explicit `spaceHomeHref(space)` and `spaceSwitchHref(path, destination)` helpers
  in `packages/ui/src/store/use-space.ts`. Keep Store-only sections outside
  `SWITCHABLE_SECTIONS`, use named exact lookup sets instead of regex/path inference, and preserve
  the current `spaceHref` encoding contract.
- [x] 1.3 Rewire `SpaceRootRedirect`, `SpaceBootstrap`, `SpaceSwitcher`, and `SpacesPage` to the new
  helpers so launch/root/list navigation selects the namespace home and Store-only routes never
  manufacture `/p/` mirrors. Preserve navigation guards and replace-history semantics.
- [x] 1.4 Rewire every successful create/register-space destination (including
  `CreateSpaceDialog.tsx` and shared catalog publication flow) to the returned space's canonical
  home; extend create/Spaces tests for project→Board and new/registered Store→Issues, including a
  late catalog revalidation and revalidation failure.

## 2. App and shell cutover

- [x] 2.1 Add RED app-level tests with the real `preact-iso` Router for Store root and legacy
  `/s/:storeId/board` replace-redirects to Issues, legacy Store Task Detail redirect to Operations,
  project root/Board/Task-detail preservation, and direct Store Issues/Detail/Operations/Unlinked
  routes. Assert the superseded Board/Task components never mount on a legacy Store URL.
- [x] 2.2 Implement small explicit redirect route components and update `packages/ui/src/app.tsx`:
  retain project Board and project Task Detail; make Store Issues canonical; redirect legacy Store
  Board→Issues and Store Task→Operations; keep all three Store-only routes without `/p/` pairs.
- [x] 2.3 Update `Layout.tsx` navigation and active-state logic: project spaces show Board, Store
  spaces show Issues/Operations/Unlinked with Issues first, common sections remain, no Store Board
  entry appears, and `RunningSessionsMenu` is no longer imported or rendered.
- [x] 2.4 Extend `app.test.tsx`, `space-bootstrap.test.tsx`, `space-switcher.test.tsx`,
  `spaces-page.test.tsx`, and create-space tests with the complete positive/negative route matrix,
  replace-history behavior, `aria-current`, Store→Store preservation, Store→project fallback, and
  explicit absence of `/p/.../issues|operations|unlinked-changes` dead links.

## 3. Project-only Task/Change Board

- [x] 3.1 Add/adjust Board tests proving project Change creation, worktree switching, live indicators,
  Task cards, and Task Detail links remain unchanged while no Store member-chip/session-attribution
  branch is reachable from the Board.
- [x] 3.2 Simplify `BoardPage.tsx` to its project-only contract: remove Store-space roster fetches,
  member filters, Store-specific selection state/imports, and Store-only wording while retaining
  project selector/worktree refresh, New Change, incomplete-Change visibility, and Done overflow.
- [x] 3.3 Re-run focused Board/Task Detail/New Change/worktree suites and verify a project route still
  submits its exact project selector, while the Store Issue Board exposes no raw project Change
  creation form.

## 4. Synchronous Issue route ownership

- [x] 4.1 Add RED true same-component transition tests for `IssueBoardPage`: mount a real Router on
  Store A, hold all A reads unresolved, navigate to Store B without remounting the app, resolve A
  late, and prove no A cards/filter/error/provenance render under B and B's fresh reads win.
- [x] 4.2 Add the corresponding Issue Detail tests for Store A→B and Issue A→B in one Store, including
  delayed projection and attention reads, colon-bearing opaque Store ids, and mount-local refresh
  reset.
- [x] 4.3 Split each Issue route component into a thin route owner and selector-keyed stateful child
  (`selector` for Board; `selector + issueId` for Detail), retaining cancelled-request guards and
  all g-001 read/refresh behavior. The key, not effect timing, must be the synchronous ownership
  boundary.

## 5. State provenance and supported interaction links

- [x] 5.1 Define the explicit presentation-only provenance vocabulary/anchor table beside the Issue
  components: Issue record, plan/projection, acceptance/review, runtime, delivery, and attention;
  entries copy only existing payload fields and classify only `git|runtime`, with no phase,
  association, membership, lifecycle, or success derivation.
- [x] 5.2 Extend `IssueCard.tsx` and Board rendering so phase/health/progress/top-attention evidence
  affordances point to the matching Issue Detail provenance fragments while the main card still
  opens Detail. Preserve one card per Issue, one top attention item, and five fixed lanes.
- [x] 5.3 Add stable ids to the existing Detail evidence sections and render a provenance map from
  the projection/attention payload: refs, revision ids, supersedes/content hashes, readiness
  searched/found refs, record copies/diagnostics, acceptance hashes/path, run-state root/path,
  located-by/evidence locator, Session/thread/transcript pointers, archive ref/blob, code commit,
  and structured evidence paths/hashes. Keep Windows/POSIX locators opaque and show explicit
  unavailable/unreadable entries.
- [x] 5.4 Add read-only Issue Detail actions linking to the same Store's Operations and Unlinked
  Changes routes. Do not add a per-Change Task link, project-wide Operations route, inferred Run id,
  mutation, target-line attribution, or selector reconstruction.
- [x] 5.5 Extend Board/Detail component tests with the distilled real g-001 payload: every state link
  resolves to exactly one provenance entry, entry text/attributes equal exact payload facts,
  incomplete/runtime-none cases resolve to diagnostics, fragment navigation works, and the two
  Store action links send no API write.

## 6. One-time orphan and duplicate disposal

- [x] 6.1 Record a pre-deletion production/test/style/locale reference inventory for
  `StoreIssuesView`, `StoreAggregateBoard`, `RunningSessionsMenu`, Store `BoardPage` branches, and
  their exclusive keys/classes. Identify shared raw Store API types/client methods separately and
  retain any still consumed or public contract surface.
- [x] 6.2 Delete `StoreIssuesView.tsx`, `StoreAggregateBoard.tsx`, `RunningSessionsMenu.tsx`, their
  exclusive component tests, and only zero-reference locale/CSS assets; remove imports/mocks and
  adjust locale parity snapshots. Do not remove g-001/g-002 APIs, Issue mutations, Operations,
  Unlinked Changes, project Board, or Task Detail.
- [x] 6.3 Run a post-deletion `rg` sweep and app navigation assertions proving none of the three
  component names or superseded Store Board/Task renderers remains production-navigable, while all
  retained client/server contracts have a named consumer or documented public owner.

## 7. Regression and presentation coverage

- [x] 7.1 Add/update en, ja, and zh-cn keys for canonical Store home, redirects, provenance kinds,
  missing evidence, and interaction links; remove only proven-exclusive orphan keys. Parse all
  locale JSON and run key parity; edit multibyte files in small UTF-8-safe spans.
- [x] 7.2 Update token-based responsive CSS for provenance entries, fragment focus/target state, and
  Board evidence affordances; preserve keyboard focus visibility and reduced motion. Remove only
  zero-reference orphan blocks and verify narrow/mobile layouts do not hide locators or actions.
- [x] 7.3 Run the focused Issue route/provenance tests plus existing Operations, Unlinked Changes,
  LinkChangeDialog, Task Detail, Run controls, and Session control suites. Confirm the g-002
  invariants remain pinned: owner/confirmation snapshots, full Store + exact member-selector
  isolation, project+alias-only Change attribution, last-known-good retention, and visible-data
  polling.

## 8. Completion evidence and read-only dogfood

- [x] 8.1 Build a disposable real-Git Store/execution fixture with at least one Issue covering Git
  record/plan/ref/acceptance/delivery provenance and one active runtime covering execution root,
  run-state, Session/thread/transcript locators. Keep fixture tests serial on Windows and use Node
  `path.join`/`path.resolve` for filesystem expectations.
- [x] 8.2 Against the production-built real management UI, capture a browser receipt for Store
  Issues→Detail→Operations→Unlinked navigation and enumerate every state evidence link. Require
  each fragment to resolve exactly once to a `git|runtime` entry carrying an exact HTTP payload
  locator/fingerprint; save normalized JSON plus a concise markdown index under `evidence/`.
- [x] 8.3 Clear localStorage, sessionStorage, Cache Storage, IndexedDB databases, and available
  service-worker registrations for the test origin, reload/remount, prove fresh projection and
  attention requests occur, and compare normalized state/provenance DOM digests before/after.
  Then mutate only the disposable committed evidence and prove the next rebuild changes without a
  client invalidation call.
- [x] 8.4 Run the same navigation/provenance smoke read-only against persistent `issue-registry`;
  record Store HEAD and a deterministic tracked-byte manifest/hash before and after, require exact
  equality, and store only receipts in this change. Do not create, attach, accept, close, or update
  Issue #6 or any other persistent Issue; LEAD owns post-delivery close evidence.

## 9. Documentation, validation, and final gates

- [x] 9.1 Update the architecture index's quick-locate and UI/project-layout entries for the
  project-only Board, Store Issues canonical home, type-aware switch behavior, provenance map, and
  removal of the three orphan components. Do not edit generated skill bodies.
- [x] 9.2 Run attributable gates: `pnpm run build`; all UI tests with
  `pnpm --filter @atelierai/rasen-ui test` (never root Vitest, which silently excludes UI);
  `pnpm --filter @atelierai/rasen-ui build`; and
  `node bin/rasen.js validate issue-board-cutover`. Leave the repository-wide full test suite to
  LEAD/CI unless implementation evidence expands beyond this UI cutover.
- [x] 9.3 Strict-decode every changed text file as UTF-8; parse every changed JSON file; scan for
  BOM, U+FFFD, known mojibake, trailing whitespace, and unintentional full-file rewrites; run
  `git diff --check`; prove no version field or `src/core/pipeline-registry/` file changed; and
  preserve all unrelated `.rasen/` debris.
