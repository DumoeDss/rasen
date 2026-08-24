# Tasks — issue-operations-and-unlinked

## 1. Bulk Change-to-Issue association read

- [x] 1.1 Create `src/core/issue-read/change-links.ts` and export it from the module barrel. Define
  the D1 closed types (`linked|unlinked|unknown`, the five eligibility values, active/archive
  occurrence union, Issue link, entry, and payload) as core types over the existing Store query
  shapes; add no cache, index, or persistent record.
- [x] 1.2 Implement `composeChangeIssueLinks(query, scope)`: one grouped-Changes read, one Issues
  read, one latest-plan read per planned Issue; collect node references by stable Change instance;
  merge/deduplicate completeness channels; enforce D1's missing/ambiguous/proven-link/incomplete/
  attachable precedence; stable-sort entries, links, and node ids. A named-but-unreadable latest
  revision must lower completeness and can never prove unlinked.
- [x] 1.3 Add focused core tests on a real-Git Store fixture covering active + archived occurrence,
  proven links (including multiple Issues), complete zero-link, missing instance, duplicate instance,
  unreadable latest plan/ref, unrelated incompleteness beside a proven positive, stable ordering, and
  byte-identical Store content before/after repeated composition reads.

## 2. Conditional Execution Plan publication

- [x] 2.1 Extend the Store Issue contracts with optional
  `expectedRevisionId?: ExecutionPlanRevisionId | null` and the typed
  `execution_plan_revision_conflict` refusal. Preserve all callers that omit the field; add no sixth
  Issue mutation.
- [x] 2.2 In `StoreIssuesModule.publishPlan`, compare a supplied expectation with the actual
  `previous` revision while holding the existing Issue write lock, before reference reads or any
  write. Matching string/null continues; mismatch reports expected + actual + refresh guidance and
  writes no revision; omitted retains current gap-free allocation.
- [x] 2.3 Extend Store Issue tests for matching/null/omitted/stale bases and a two-writer race from one
  base (exactly one conditional writer succeeds). Check revision directory bytes and lock release
  after conflict; keep existing unconditional-publication assertions unchanged.

## 3. Management API and wire contracts

- [x] 3.1 Add `handleStoreChangeIssueLinks` to the maintained flat Store family and route
  `GET /api/v1/stores/change-issue-links?space=store:<id-or-uid>` through the same Store-resolution,
  `run()` error, auth, and unwrapped-response spine as g-001. Add a direct
  `StoreChangeIssueLinksResponse = ChangeIssueLinksPayload` wire alias; do not touch
  `stores-routes.ts`.
- [x] 3.2 Extend `StoreExecutionPlanPublishRequest` with `expectedRevisionId?: string | null`, validate
  `undefined|null|canonical revision` at the untrusted HTTP boundary, pass it to `publishPlan`, and
  map `execution_plan_revision_conflict` to 409 in the shared Store error envelope.
- [x] 3.3 Complete the plan-node request mirrors in core and UI with every admitted field —
  `lifecycle`, `reason`, `suggestedPipeline`, `rationale`, `uncertainty` — so read-modify-publish
  preserves Phase 4–6 plan facts; extend the Store aggregate wire-mirror floor test and a
  `satisfies` fixture.
- [x] 3.4 Align Session wire declarations with facts `toWire()` already sends: the planning identity
  block and optional frozen execution union (including planning-only/project). Mirror them in UI
  types and add focused contract coverage; legacy absence stays explicit and cwd stays an opaque
  locator.
- [x] 3.5 Add `getStoreChangeIssueLinks` and the expected-revision/full-node request support to
  `packages/ui/src/api/{client,types}.ts` using the existing authenticated `request<T>` seam.

## 4. Management API integration tests

- [x] 4.1 Extend/new `test/core/management-api` coverage for link handler and real HTTP route:
  required Store space, unwrapped response shape, active/archive coverage, all D1 association/
  eligibility channels, and direct deep equality with `composeChangeIssueLinks` on the same fixture.
- [x] 4.2 Pin link-read freshness and no-write behavior: mutate an Issue plan between identical GETs
  and observe unlinked→linked without invalidation; hash Store bytes around repeated reads; assert an
  unreadable plan remains HTTP 200 with `unknown`, `complete:false`, problems/unsearched refs.
- [x] 4.3 Cover the plan POST boundary: malformed expectations → 400, matching/null/omitted behavior,
  stale → 409 `execution_plan_revision_conflict` with zero written bytes, and a full-field existing
  node survives read-modify-publish verbatim.
- [x] 4.4 Run the focused Store/core/management suites serially where real Git fixtures are involved,
  and update `KNOWN_SLOW_TEST_WEIGHTS_MS` only if the new file's measured cost requires it.

## 5. Operations presentation model and reusable controls

- [x] 5.1 Add a pure UI operations model that classifies active/abnormal/settled Sessions exactly as
  D3 states and resolves Change/Issue attribution only from frozen execution project + D1 entries.
  Return named unavailable/ambiguous outcomes, never choose by cwd/list order, and never infer a
  Session→Run id. Unit-test project/target-line ambiguity, multiple Issue links, planning-only,
  legacy missing execution, Windows and POSIX cwd spellings.
- [x] 5.2 Refactor `OperationsSection.tsx` into a reusable project-tagged Run panel while retaining
  the Task-detail wrapper/API. Keep exact project selector on detail/control, existing paging facts,
  committed-view replacement, decision/escalate/read-only controls, and every existing parity test.
- [x] 5.3 Present a projected resume for `{kind:'infrastructure', retryable:true}` as Retry and other
  projected resume as Resume; present projected cancel as confirm-first Stop Run. Rename/present
  SessionRow's live DELETE as confirm-first Stop Session without changing 404 already-gone refresh
  behavior. Add focused control tests proving exact Wait/Run/Record ids and no request before confirm.

## 6. Store Operations page

- [x] 6.1 Create `OperationsPage.tsx` at `/s/:storeId/operations`. Fetch the Store project aggregate
  as roster authority, use `listSpaces()` only to attach optional member roots, load Store-planning
  plus rooted-member Sessions, rooted-member Runs, and D1 links with per-source `Promise.allSettled`;
  dedupe Sessions by id and keep each Run beside the exact member selector that produced it.
- [x] 6.2 Render active and abnormal Sessions directly (settled history behind disclosure), actual
  cwd and frozen execution in separate labelled fields, exact/ambiguous Change and Issue attribution,
  and per-member Run panels. A member/source failure must not erase other results; a member without a
  root remains visible and unavailable.
- [x] 6.3 Add current-member project chips as mount-local display filters, default All, with
  planning-only Sessions visible only under All. Implement explicit refresh, member-local retry,
  opaque-cursor Load More, and 3-second polling only while active/non-terminal work exists; persist
  no filter, execution fact, or attribution.
- [x] 6.4 Add `operations-page.test.tsx` using mocked existing APIs and typed fixtures: Store/member
  fan-out and dedupe, active/abnormal ordering, actual-cwd separation, exact/ambiguous attribution,
  filter reset, missing-root member, partial source failure/retry, bounded polling, paging, and Run/
  Session control integration.

## 7. Unlinked Changes page and confirmed writes

- [x] 7.1 Create `UnlinkedChangesPage.tsx` at `/s/:storeId/unlinked-changes`. Render only
  `unlinked/attachable` entries in project/target-line groups with active/archive facts; render
  linked counts and unknown/missing/ambiguous/incomplete entries separately with reasons. Every row
  leads with Change identity and never uses Issue cards/status.
- [x] 7.2 Implement attach-existing dialog flow: open readable Issue choices from g-001, fetch fresh
  detail, choose a canonical non-conflicting node id, explicitly copy every admitted existing-node
  field, append one exact-scope Change node with `dependsOn:[]`, preview all facts, and publish only
  after confirmation with the displayed base `expectedRevisionId`. Conflict refetches link + Issue
  truth and writes no optimistic state.
- [x] 7.3 Implement create-single flow: require operator-authored Issue id/title/node id, preview and
  confirm, call existing Issue create then expected-null one-node plan publish. Report success only
  after both; on plan failure show the created Issue + still-unlinked Change and an attach recovery,
  with no deletion or hidden compensation.
- [x] 7.4 Add `unlinked-changes-page.test.tsx` (and dialog test if split) covering active/archive rows,
  linked exclusion, all unknown reasons disabled, no synthesized Issue facts, complete-scope request,
  full-field graph preservation, duplicate node id, confirm-before-write, stale conflict/refetch,
  successful create, duplicate Issue refusal, honest partial recovery, refresh, and no storage use.

## 8. Shell, presentation, and g-003 seams

- [x] 8.1 Wire store-only routes `/s/:storeId/operations` and
  `/s/:storeId/unlinked-changes` plus store-only nav links and path-prefix active states. Add neither
  project route nor `SWITCHABLE_SECTIONS`; a Store→project switch keeps the existing Board fallback.
  Extend app/layout tests for direct links, nav reachability, `aria-current`, and project absence.
- [x] 8.2 Add `operations.*` / `unlinked.*` / nav keys to en, ja, zh-cn with locale-key parity, and
  token-based responsive CSS for source errors, Session groups, attribution, Change rows, dialogs,
  confirmations, focus-visible, and reduced motion. Edit multibyte JSON in small spans and parse all
  locale files afterward.
- [x] 8.3 Preserve the existing Task detail, RunningSessionsMenu, old Board, `StoreIssuesView`, and
  `StoreAggregateBoard` behavior for g-003's one-time disposal. Record the two stable routes, D1
  endpoint/payload, and remaining orphan/cutover list in the parent planning context/evidence rather
  than deleting them here.

## 9. Dogfood, documentation, and closure

- [x] 9.1 Read-only dogfood on `issue-registry`: hash Store tracked bytes before/after; capture the
  real Change-link payload and render Operations/Unlinked states from it. Perform attach/create only
  on a disposable fixture Store and record success, stale conflict, and partial-recovery receipts
  under this change's `evidence/`.
- [x] 9.2 Update the architecture index's quick-locate and relevant spec/store + workflow/UI module
  references for `change-links.ts`, the new flat endpoint, conditional plan publication, and the two
  pages. Do not edit generated skill bodies, versions, or `src/core/pipeline-registry/`.
- [x] 9.3 Run final attributable gates: `pnpm run build`; serial focused Store/link/API tests;
  existing Operations/Task-detail/Session tests; full UI package via
  `pnpm --filter @atelierai/rasen-ui test`; Store aggregate wire mirror; and
  `node bin/rasen.js validate issue-operations-and-unlinked`. Strict-decode all changed text as UTF-8,
  parse changed JSON, run `git diff --check`, scan for BOM/U+FFFD/mojibake, confirm no version/frozen
  pipeline file changed, and leave the root full suite to LEAD/CI unless new evidence requires it.
