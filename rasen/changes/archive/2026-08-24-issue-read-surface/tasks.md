# Tasks — issue-read-surface

## 1. Core composition module (`src/core/issue-read/`)

- [x] 1.1 Create `src/core/issue-read/composition.ts`: named payload types
  (`IssueProjectionListPayload`, `IssueProjectionDetailPayload`, `StoreAttentionPayload` —
  key order matching today's CLI `--json` literals exactly) and the three compose functions
  `composeIssueProjectionList(query, scope, runState, state?)`,
  `composeIssueProjectionDetail(query, scope, runState, issueId)`,
  `composeStoreAttention(query, scope, runState, narrowIssueId?)`, taking the query module
  injected (design D1). Move `statusInputFor`, `resolveStoreWideningContext`, and
  `resolvePredecessorPlan` down from `src/commands/store-issue.ts`, and fold the list-side
  per-Issue detail assembly (`detailForList`) and the attention scan loop (from
  `src/commands/store.ts`) into the compose functions. Attention narrowing keeps throwing the
  existing `issue_attention_unknown_issue` refusal on an unknown id.
- [x] 1.2 Create `src/core/issue-read/run-context.ts` with
  `resolveRunStateContext(startPath: string | undefined)`: `resolveOpenSpecRoot` probe with
  `reporter: false`, never throws, `{}` when nothing resolves; `index.ts` barrel for the
  module.
- [x] 1.3 Rewire the CLI: `store issue list`/`show` (`src/commands/store-issue.ts`) and
  `store attention` (`src/commands/store.ts`) call the compose functions;
  `resolveProjectionContext()` becomes a thin `resolveRunStateContext(process.cwd())`
  wrapper; `store.ts` imports move to `core/issue-read`; the moved exports leave
  `store-issue.ts`. Human rendering, `--json` bytes, exit codes, and the attention failure
  sentinel (omitting `unsearchedRefs`/`complete`) all unchanged.
- [x] 1.4 Refactor guard: the existing store-issue and store-attention CLI suites pass
  unchanged (no assertion edits) — they pin the `--json` bytes across the extraction.

## 2. Daemon endpoints (management API, flat Store-aggregate family)

- [x] 2.1 In `src/core/management-api/stores.ts`: add `handleStoreIssueProjections(space,
  runState, state?)`, `handleStoreIssueProjection(space, runState, issueId?)`,
  `handleStoreIssueAttention(space, runState, issueId?)` on the `run()` spine, calling the
  compose functions with the uid-addressed query and scope
  `{store: space.storeUid, startPath: ''}`; a missing `issueId` on the single-Issue read is
  refused with the store's scope code (the `handleStoreIssue` precedent).
- [x] 2.2 Extend `mapThrown` so the `issue_attention_unknown_issue` refusal maps to 404 with
  its own code (today it would fall to 500 `store_query_failed`); leave `statusForIssueCode`
  and the legacy `stores-routes.ts` family untouched.
- [x] 2.3 In `src/core/management-api/router.ts`: add `/api/v1/stores/issue-projections`,
  `/api/v1/stores/issue-projection`, `/api/v1/stores/issue-attention` to
  `MANAGEMENT_PATHS` AND their three GET dispatch branches (`resolveStoreSpace` →
  per-request `resolveRunStateContext(context.launchProjectRoot ?? undefined)` → handler →
  `sendJson` unwrapped); params: `state` (list, validated to the closed set), `issueId`
  (detail required, attention optional).
- [x] 2.4 In `src/core/management-api/wire-types.ts`: add the three alias response types to
  the Store aggregate section (`StoreIssueProjectionsResponse`,
  `StoreIssueProjectionResponse`, `StoreIssueAttentionResponse`) as direct aliases of the
  payload types — no redeclaration.

## 3. Server tests (root vitest config)

- [x] 3.1 New `test/core/management-api/issue-projection.test.ts`, handler-level (the
  `stores.test.ts` in-process pattern) on a `createStoreWorkspaceFixture` store that includes
  a superseded revision (delta non-null — pins the predecessor input) and an unreadable-plan
  member (problems channel): list carries per-Issue status; detail carries status + delivery
  + review with the CLI payload's exact keys; attention scan + narrowing; unknown narrowing
  id → 404 `issue_attention_unknown_issue`; an unknown Issue on the single-Issue read
  answered exactly as the command line answers it (the query never throws on an Issue it
  cannot find — the empty-record read, not a refusal, so a server-side 404 would BREAK the
  parity requirement; `issue_not_found` remains mapped for the callers that do throw it);
  missing `issueId` → 400 `issue_id_required`; missing space → 400 `space_required`.
- [x] 3.2 Over-the-wire CLI↔API parity witness (the `stores-api.test.ts` pattern):
  `startManagementServer` + raw HTTP vs `runCLI('store','issue','list|show','--json')` and
  `runCLI('store','attention','--json')` on the same fixture — deep-equal payloads,
  including reported problems.
- [x] 3.3 Channel and freshness pins: unreadable evidence returns 200 with
  `problems`/`complete:false` (never an error envelope); a store mutation between two
  identical GETs is reflected in the second response with no invalidation step; store bytes
  identical before/after every projection read (write-nothing).
- [x] 3.4 Add the new test file's `KNOWN_SLOW_TEST_WEIGHTS_MS` entry in root
  `vitest.config.ts` (real-Git fixture + CLI spawns).

## 4. UI wire mirror and client

- [x] 4.1 Mirror the three response types (and their supporting structural types —
  `IssueStatus`, `IssueNodeStatus`, node delivery, attention item/kinds, review
  determination/threads, delivery rollup, scan entries) into `packages/ui/src/api/types.ts`,
  and add the three names to the `STORE_AGGREGATE_WIRE_TYPES` floor list in
  `test/core/management-api/store-aggregate-wire-mirror.test.ts`; run that test.
- [x] 4.2 Add `getStoreIssueProjections(space)`, `getStoreIssueProjection(issueId, space)`,
  `getStoreIssueAttention(space, issueId?)` to `packages/ui/src/api/client.ts` in the Store
  aggregate section (the one-liner `request<T>` pattern).

## 5. UI pages (read-only skeleton)

- [x] 5.1 `IssueBoardPage.tsx` + `IssueCard.tsx`: `Promise.all` of projections + attention on
  `[selector, refreshNonce]`; five fixed phase lanes (closed vocabulary, always rendered);
  card = title (record title, issueId fallback), health badge, progress pair, first
  fail-first attention item for the issue, divergence/uncommitted/diagnostic notice when the
  record is null or uncommitted; notice strip for `problems`/`complete:false`/
  `unsearchedRefs`/`runStateVisibility: none`; `MemberChips` reused as filter-only (entries =
  every project from the existing read-only Store project aggregate, including members with
  no Issue lane; projection aliases improve labels; "All" default, nothing persisted);
  cards link to detail via `spaceHref(space, 'issues', issueId)`.
- [x] 5.2 `IssueDetailPage.tsx`: `Promise.all` of `getStoreIssueProjection(issueId)` +
  narrowed attention; sections per design D5 — header (three separated axes), background &
  acceptance, Execution Plan nodes (+ revision delta block when present), Changes grouped by
  member project with per-group progress, cross-project dependencies (blocker
  `node@project: state` labels), runs/sessions/delivery (per-node attribution + delivery
  states + rollup counts), review (determination, threads, verification summary), needs
  attention (empty state named). Every displayed value comes from a payload field —
  closed-vocabulary labels via literal-key lookup tables.
- [x] 5.3 Wire-up: two routes in `app.tsx` (`/s/:storeId/issues`,
  `/s/:storeId/issues/:issueId` — store spaces only, no `/p/` pair, no
  `SWITCHABLE_SECTIONS` entry per design D5); store-space-only `Issues` nav entry in
  `Layout.tsx`; `issues.*` keys added to all three locale files (en/ja/zh-cn, key parity;
  zh-cn edited with small spans and checked for U+FFFD).
- [x] 5.4 UI tests under packages/ui's own config (`pnpm --filter @atelierai/rasen-ui test`
  — NEVER the root config, which silently runs zero UI tests):
  `issue-board-page.test.tsx` (lane placement equals payload phase; separated axes; top
  attention item; chips filter without regrouping and reset on remount; divergent Issue
  still appears with its reason; notice strip on problems/incomplete/visibility-none;
  refresh re-calls the client) and `issue-detail-page.test.tsx` (sections render payload
  fields verbatim; blockers labeled; problems presented beside the read; no storage API
  touched), with `satisfies`-typed fixtures in `packages/ui/test/fixtures/`; route entries
  added to `packages/ui/test/app.test.tsx`.

## 6. Dogfood receipts (real store, read-only)

- [x] 6.1 On `issue-registry` (READ-ONLY): capture `store issue list --json`,
  `store issue show --json` for each of the five done Issues, and `store attention --json`;
  start the daemon against this repo and capture the three endpoints' responses for
  `?space=store:<uid>`; deep-equal each pair and file the receipts under `evidence/`.
- [x] 6.2 Board smoke against the real store: five cards all in the Done lane, no attention
  lines, run-state visibility disclosed; evidence captured as rendered DOM
  (`evidence/dogfood-board-render.html` + `.json`). Distill one representative real detail
  payload into a `satisfies StoreIssueProjectionResponse` UI test fixture
  (`realIssueProjectionFixture`, sourced from `evidence/dogfood-real-issue-projection.json`).
  **Method note**: the smoke renders the real `IssueBoardPage` component against the real
  Store's own `issue-projections` + `issue-attention` payloads (captured over HTTP from the
  real management server) in jsdom, rather than driving a browser against `rasen ui`. Same
  component, same data, same assertions, and it produces the DOM the task asks for; what it
  does not cover is the asset-serving and browser layer, which carries no Issue logic in this
  slice. The one-off harness was deleted after capture so CI never depends on a
  machine-local Store (design D7).

## 7. Closure

- [x] 7.1 Update the `architecture-index` skill: quick-locate rows for the projection
  endpoints and the `issue-read` module; module entries in
  `detail/modules/spec-store-engine.md` (or the issue domain rows) and
  `detail/modules/workflow-pipeline.md` (management-api endpoint list).
- [x] 7.2 Full gates. Implementer-owned half DONE: `pnpm build` green;
  `node bin/rasen.js validate issue-read-surface` green; the whole UI suite green
  under packages/ui's own config via `pnpm --filter @atelierai/rasen-ui test`
  (71 files / 953 tests at the original full gate); verification then added the
  zero-Issue five-empty-lanes regression and reran the Board file green (12/12).
  Worktree note: a fresh worktree carries no
  `packages/ui/node_modules` (node_modules is not tracked), so that command
  fails with a bare "tsc/vitest is not recognized" until `pnpm install` is run
  once inside `packages/ui` — the filter itself resolves fine; the 13 store-issue /
  store-attention CLI guard suites green (66 tests); the new
  `issue-projection.test.ts` has all 14 tests verified serially (13 passed in the
  full-file run; its sole 30-second CLI timeout then passed on focused retry after
  aligning that parity case's CLI and outer test budgets, with no parity assertion
  failure); `stores.test.ts` / `stores-api.test.ts`
  / `router.test.ts` / the wire-mirror drift test green (100). No version field
  changed anywhere; `src/core/pipeline-registry/` untouched. **Still open and
  held by the LEAD**: the root full-suite run (`pnpm test` / the binned runner),
  which this slice's implementer was instructed not to run — CI is the
  authority for it.
