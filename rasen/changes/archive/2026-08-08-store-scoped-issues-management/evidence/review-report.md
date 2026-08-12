# Review report — store-scoped-issues-management (child 6)

Independent review of 101/102 tasks (11.11 is a shipper task). The
implementer was honest that the second session's 34 tests were not
mutation-verified. This review checks whether those unverified guards
discriminate.

## Gate results (re-verified)

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `workflow-whitelist.test.ts` | 9/9 pass |
| `store-issue-locks.test.ts` | 15/15 pass |
| `store-query-read-only-guard.test.ts` | 10/10 pass |
| `stores-api.test.ts` | 18/18 pass |
| `store-query-lock-free.test.ts` | 5/5 pass |
| `store-issue-scope-intent.test.ts` | 7/7 pass |
| `store-v2-cross-project-journey.test.ts` | 6/6 pass |
| NUL/BOM/U+FFFD sweep on new files | 0 findings |

No failing file.

## Findings

### MEDIUM-1: stores-api POST admission test claims three shapes, tests one

`test/core/management-api/stores-api.test.ts:170-183`

The test is named "POST is admitted on the three mutation shapes" and
its comment says "POST on issues, issue-plans, and line-changes should
NOT be a 405." But the body sends POST to only one shape:
`/api/v1/stores/:storeUid/issues`. The `issue-plans` shape
(`/api/v1/stores/:storeUid/issues/:issueId/plans`) is never POSTed to
in any test in this suite.

The `line-changes` shape IS indirectly covered: the scope-completeness
tests at lines 267-293 send POST to `line-changes` paths and expect 422
(not 405), so removing POST admission for `line-changes` would turn
those into 405 failures.

But `issue-plans` POST admission is verified by NO test. If someone
removed `route.kind === 'issue-plans'` from `storeRouteAdmitsMethod`
(`src/core/store/.../stores.ts:162`), nothing would go red.

**Fix**: add one `req` call to `/api/v1/stores/:storeUid/issues/test-issue/plans`
with a `{ nodesFile: '...' }` body, asserting `status !== 405`.

### LOW-1: The 11.6 whitelist name assertion checks op names, not behavior

`test/core/management-api/workflow-whitelist.test.ts:106-112`

The test "keeps finalize-change the only bounded op that reaches
finalization" filters bounded ops by regex `/finali[sz]/u` on their
NAMES. This catches a new op whose name contains "finali" but not an
op whose CODE reaches finalization under a different name. The actual
behavioral protection is the source guard (preventing archive functions
in `issues/` and `query/`) plus the bridge architecture (mutations
spawn the CLI). The test discriminates narrowly; its name overstates.

Not a defect — the protection is real, just distributed across the
source guard and the architecture rather than in this assertion.

### INFO-1: The 11.3 finalization independence uses a fixture, not the real archive CLI

`test/commands/store-v2-cross-project-journey.test.ts:123-187`

The `archiveChange()` helper manually renames the Change directory and
writes an archive.json record using `serializeArchiveV2`. The
byte-identity assertion proves the QUERY path doesn't write back after
reading an archived Change — but does not prove the real archive CLI
doesn't write to the Issue.

The implementer disclosed this in report-3 section 4. The real archive
CLI IS exercised in the 11.6 test. The source guard proves the Issue
Module cannot reach the archive engine. The combination is sound.

### INFO-2: Lock-order enumeration discrimination for the reorder case

`test/core/store/store-issue-locks.test.ts:39-50`

The enumeration test discriminates independently of the load-time
assertion for add/remove. For reorder, the load-time assertion fires
at import time, manifesting as "no tests found" rather than a targeted
assertion failure. The implementer disclosed this honestly. The test
still discriminates — the diagnostic shape differs by case.

## Guard-discrimination table

| Guard | Discriminates? | What would fail it | How verified |
|---|---|---|---|
| Whitelist count (18 ops) | YES | Add/remove/rename any op | By inspection: exact sorted array comparison |
| Lock-order enumeration (5 keys) | YES (add/remove); indirect (reorder) | Add/remove/reorder keys | Session-2 mutation (reorder); inspection (add/remove) |
| Source guard: Git verbs | YES | Add 'checkout' to STORE_QUERY_GIT_VERBS | Mutation-verified (session 1) |
| Source guard: archive functions | YES (by inspection) | Add `serializeArchiveV2` import to issues/ | Simple string-containment check; trivially discriminating |
| Source guard: FS writes | YES (by inspection) | Add `writeFile` call to query/ | Simple string-containment check |
| Source guard: FS interface no-write | YES | Add write method to StoreQueryFileSystem | Interface-body regex check |
| 11.6 --outcome requirement | YES | Remove outcome gate from archive CLI | Test drives real CLI; asserts exit code and message |
| 11.6 whitelist name assertion | WEAK | Only ops with "finali" in their name | Name-check only, not behavioral |
| Stores-api auth (401) | YES | Remove auth check from router | Sends unauthenticated request |
| Stores-api method rejection (405) | YES | Admit PUT/DELETE/PATCH | Tests each method individually |
| Stores-api scope-completeness (422) | YES | Remove `assertDeclaredScope` | Tests project and line refusal separately |
| Stores-api POST admission | PARTIAL | Only `issues` shape verified; `issue-plans` not tested | See MEDIUM-1 |
| Lock-free query (6.10) | YES (structural) | Query would deadlock if it took a lock | Structural: source guard proves no lock import; test proves query completes under held locks |
| Resolver exhaustive switch | YES (compile-time) | Add intent without arm | TypeScript `never` check fails compilation |
| Scope-intent Issue-address-only | YES | Add project address to StoreIssueAddress | Runtime throw + type system |
| seedChange YAML quoting | YES (by inspection) | Unquoted instanceSeed | `JSON.stringify` wrapping; YAML parses quoted scalars as strings |

## Verdict on the unverified guards

The unverified guards fall into three categories, all sound:

1. **Compile-time / load-time enforced** — the resolver's exhaustive
   `switch` with `never` default, the lock-order load-time agreement
   assertion. These discriminate before any test runs. Sound.

2. **Simple string-containment source guards** — the archive-function
   and FS-write checks in `store-query-read-only-guard.test.ts`. Not
   mutation-verified, but trivially discriminating: if the string
   `serializeArchiveV2` appears in any `.ts` file under
   `src/core/store/issues/`, the test fails. A mutation that adds such
   an import would fail the guard. The lack of mutation verification is
   a process gap, not a discriminating-power gap.

3. **Behavioral / integration tests** — the stores-api and journey
   tests. The stores-api POST admission gap (MEDIUM-1) is the one
   place where a guard claims more coverage than it delivers. The rest
   are sound: auth, method rejection, scope-completeness, and the
   real-CLI --outcome requirement all discriminate.

## Integration seams

All four seams are sound:

1. **PlanningIntent union** (`types.ts:9-14`): both `finalize-change`
   (child 5) and `store-issue` (child 6) are present. The resolver
   dispatches with an exhaustive `switch` + `never` default
   (`resolver.ts:471-490`). A new intent without an arm fails to
   compile. `isStoreLevelIntent` (`resolver.ts:432-434`) correctly
   recognizes both Store-level intents.

2. **Management API bridge** (`stores.ts:469-547`): `createStoreMutator`
   spawns the CLI for all mutations. It has its own cap-1 concurrency,
   independent of the change submitter and finalizer. Auth is enforced
   by the router. Every scope segment comes from the PATH; no field is
   inferred from a filter, session, or launch project. The
   `assertDeclaredScope` check runs before any subprocess exists.

3. **StoreQueryModule**: read-only by source guard + Interface design
   (`StoreQueryFileSystem` has only `readText` and `listNames` — no
   write methods). Query takes no lock (verified structurally by the
   source guard and behaviorally by `store-query-lock-free.test.ts`).
   A concurrent Issue write cannot corrupt a query result because the
   query reads files atomically and treats unparseable records as
   non-candidates.

4. **Route precedence**: the finalization route (8 segments,
   `router.ts:169-191`) is matched BEFORE the Store route family (2-6
   segments, `stores.ts:109-156`). `matchStoreRoute` checks exact
   segment counts, so the 8-segment finalization path cannot match the
   6-segment line-changes route. No conflict.

## Design contract compliance

- section 9.3 (cross-project work): 11.1 tests the full journey; 11.2
  verifies one project owner per Change; 11.4 verifies spec isolation.
- section 12 (management API): all five GET routes and three POST
  routes are implemented. `WirePlanNode` references Changes by
  `changeInstanceId` (stable identity), with `changeAlias` explicitly
  marked "Human convenience. Never resolved by." Paths are returned
  only as `localLocator`. Scope comes from the path only.
- section 16 (not to do): no shared flat changes directory, no
  branch-name-based identity (11.5), no multi-project Change, no spec
  sync for non-landed outcomes (Issue Module reaches no spec-apply
  function).

## The seedChange fix

`test/helpers/store-workspace-fixture.ts:291`: `JSON.stringify(instanceSeed)`
wraps the value in double quotes, which is the correct YAML scalar
quoting fix. An unquoted all-numeric seed parsed as a YAML number and
was rejected by `ChangeMetadataSchema`, making the Change invisible to
blob-reading consumers.

The fix does not break existing tests: YAML treats quoted scalars as
strings regardless of content, so seeds that previously contained
letters (and were already parsed as strings) are unaffected.

## UI components

`StoreAggregateBoard.tsx` and `StoreIssuesView.tsx` are minimal but
functional. They render the data model correctly (grouping, card
contents, incomplete banner, mutation guard, UID addressing, node
states). They are not wired into app routing, which the implementer
attributed to child 7. This is an acceptable scope boundary for child
6, whose section 10 tasks concern component creation and test coverage,
not routing.

## What I could not verify

1. **The issue-plans POST admission through the HTTP bridge**. See
   MEDIUM-1.
2. **The Issue creation 201 success path through the HTTP bridge**.
   The stores-api POST test checks `!== 405` only. The CLI tests verify
   Issue creation via the CLI, and the finalization API test verifies
   the bridge pattern, but the specific Issue-creation-via-HTTP
   success response is not tested.
3. **UI component tests** (`packages/ui/test/board/*.test.tsx`). The
   implementer reported them passing (8 tests). I did not re-run them.
4. **Full `pnpm test`**. I ran every suite this change touches (84
   tests across 7 files, all green). Session 2 reported the full store
   + store-planning + management-api suites green (1180 + 525).
