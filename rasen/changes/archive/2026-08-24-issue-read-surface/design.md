# Design — issue-read-surface

## Context

**What exists.** The issue truth surface is complete on the CLI side and pure by construction:
`projectIssueStatus(input)` (`src/core/issue-status/projection.ts:1020`) derives `IssueStatus`
(axes, nodes, delta, project lanes, problems, acceptance, `runStateVisibility`), and four
synchronous post-passes derive the rest over that one status: `deriveIssueReadySet`,
`deriveIssueAttention`, `deriveIssueDeliveryEvidence`, `deriveIssueReview`
(`src/core/issue-status/*.ts`). The CLI assembles inputs through seams already exported for
reuse — `resolveProjectionContext()` (cwd-bound run-state context), `resolveStoreWideningContext(store)`
(workspace index + project aliases), `statusInputFor(detail, context)` (pure input builder),
`resolvePredecessorPlan(scope, issueId, supersedes)` — proven callable outside their file by
`store.ts`'s attention command (`src/commands/store.ts:1786`).

**The daemon half-bridge.** The management API's flat Store-aggregate family
(`/api/v1/stores/issues|issue|issue-references|execution-plan`, `router.ts:1533-1645`) already
serves the RAW query reads via `stores.ts` handlers on a shared `run()`/`statusForIssueCode`
error spine, with wire types that are direct aliases of the core query types
(`wire-types.ts:1408-1478` — the documented "unwrapped passthrough, alias not redeclaration"
rule). Nothing serves the projection layer. A second, parametrized 0.1.7-port family exists in
`stores-routes.ts` with hand-redeclared `Wire*` types; it is not the pattern to extend.

**The UI.** `packages/ui` (Preact + preact-iso, no state library, fetch-on-mount pages) has an
old Task-based board (`BoardPage` — Changes grouped into Tasks; the 旧看板, untouched until
g-003) and two orphaned Issue-aware components (`StoreIssuesView`, `StoreAggregateBoard`)
that no route reaches and that predate the projection layer. Space routing is URL-derived
(`use-space.ts`), API access goes through one `request<T>()` seam (`api/client.ts`), UI wire
types are a hand-maintained mirror of `wire-types.ts` guarded by a source-text drift test
(`test/core/management-api/store-aggregate-wire-mirror.test.ts`).

**Portfolio fences.** `src/core/pipeline-registry/` frozen; no version bumps; `packages/ui`
unfrozen this slice; UI tests must run under packages/ui's own vitest config (the root config
silently runs zero UI tests); §11 prohibitions (no Task-as-Issue, chips never an ownership
partition, session cwd never a binding truth, no premature IA commitments); writes and
old-board disposal belong to g-002/g-003.

## Goals / Non-Goals

**Goals**

- Serve the CLI's exact issue read truth over HTTP: same derivations, same payload content,
  same problem reporting, same refusal codes — zero second state, zero cache.
- A read-only Issue Board (§9.1) and Issue Detail (§9.2) skeleton whose every displayed field
  traces to a projection payload field.
- Completion-evidence discipline made testable now: CLI↔API parity by construction plus pinned
  freshness (a store mutation between two requests is reflected without any invalidation
  step); UI holds no persistent status state to rebuild.

**Non-Goals**

- No writes from the UI (attach/create/resume/retry/stop — g-002); no old-board changes, no
  disposal of the orphaned components, no navigation rework beyond one nav entry (g-003).
- No pagination, live push, or polling — fetch on navigation plus a manual refresh.
- No new CLI verbs or flags; no change to any issue-family derivation or its spec.
- No Operations/Unlinked surfaces (g-002).

## Decisions

### D1 — One composition, two callers (`src/core/issue-read/`)

The zero-second-state guarantee is strongest when there is literally one composition. Today
the assembly lives inline in two CLI commands; the daemon would be a third copy. Instead a new
core module owns it:

```
src/core/issue-read/
  composition.ts   payload types + the three compose functions
                   + statusInputFor, resolveStoreWideningContext, resolvePredecessorPlan
                   (moved down from src/commands/store-issue.ts)
  run-context.ts   resolveRunStateContext(startPath) — resolveOpenSpecRoot probe,
                   reporter off, never throws, {} on failure
  index.ts         barrel — consumers import from core/issue-read directly
                   (not folded into issue-status; see the placement note below)
```

Signatures (scope mirrors `StoreQuery`; `query` is injected so the daemon can pass its
uid-strict instance):

```ts
interface IssueRunStateContext { executionRoot?: string; changesDir?: string; projectRoot?: string }

composeIssueProjectionList(query: StoreQueryModule, scope: {store?: string; startPath: string},
                           runState: IssueRunStateContext, state?: IssueState
                          ): Promise<IssueProjectionListPayload>
composeIssueProjectionDetail(query, scope, runState, issueId: string
                          ): Promise<IssueProjectionDetailPayload>
composeStoreAttention(query, scope, runState, narrowIssueId?: string
                          ): Promise<StoreAttentionPayload>
```

Payload types are the CLI's `--json` bodies, named (key order preserved — `printJson`
serializes insertion order, so the compose functions build objects in today's literal order):

```ts
IssueProjectionListPayload  = { issues: (IssueSummary & {status: IssueStatus})[];
                                complete; unsearchedRefs; problems }
IssueProjectionDetailPayload = { issue; plan; status; delivery; review;
                                 complete; unsearchedRefs; problems }
StoreAttentionPayload       = { narrowed; issueId; scannedCount; scanned; items;
                                counts; total; unsearchedRefs; complete }
```

Callers:

- **CLI** — `store issue list/show` and `store attention` call the compose functions and keep
  their renderers; `resolveProjectionContext()` stays in `store-issue.ts` as a thin
  `resolveRunStateContext(process.cwd())` wrapper. `store.ts` updates its imports to
  `core/issue-read` (the moved exports leave `store-issue.ts`). Behavior pin: `--json` bytes
  and human rendering identical; the attention failure sentinel (which omits
  `unsearchedRefs`/`complete`) stays CLI-side in the catch, unchanged.
- **Daemon** — handlers pass the uid-addressed query (`createStoreQueryByUid()`), scope
  `{store: space.storeUid, startPath: ''}`, and a per-request
  `resolveRunStateContext(context.launchProjectRoot ?? undefined)`.

Why not have management-api import the seams from `src/commands/`? Layering — core must not
import commands. Why not duplicate the loop daemon-side (as `store.ts` once did)? The ordered
input gathering (acceptance, predecessor plan, widening) is exactly where silent drift lives —
a forgotten `predecessorPlan` yields `delta: null` with no error. Moving it down is the
mechanical completion of the extraction `store.ts` already started.

Note on module placement: `issue-status/` stays I/O-free by charter (pure derivations plus the
one documented run-state probe); the composition does store reads, so it gets its own module —
the `issue-execution/confirm.ts` read-compose-report precedent.

### D2 — Endpoint shapes: flat family, "projection" nouns, review rides the detail

Three GET paths join the flat Store-aggregate family (space-addressed, loopback + bearer +
identity headers inherited by construction, GET auto-admitted by `isMethodAdmitted`):

| Path | Params | Body (wire alias) |
| --- | --- | --- |
| `GET /api/v1/stores/issue-projections` | `space=store:<uid>` required; `state=open\|resolved\|dropped` optional | `StoreIssueProjectionsResponse = IssueProjectionListPayload` |
| `GET /api/v1/stores/issue-projection` | `space`, `issueId` required | `StoreIssueProjectionResponse = IssueProjectionDetailPayload` |
| `GET /api/v1/stores/issue-attention` | `space` required; `issueId` optional (narrowing) | `StoreIssueAttentionResponse = StoreAttentionPayload` |

Decisions inside this:

- **Flat family, not `stores-routes.ts`.** The flat family is the maintained pattern (alias
  passthrough, central error mapping, space addressing); the parametrized family is a 0.1.7
  port with hand-redeclared wire types and a coarser error rule. It is left untouched.
- **"projection", not "status".** `/api/v1/stores/issue-state` (POST, record-state mutation)
  already exists; `issue-status` beside it would invite exactly the state/status confusion the
  domain vocabulary works to keep apart. "Projection" is the specs' own word for these reads.
- **No fourth "review" path.** Review is derived from the same status on the same read
  (`deriveIssueReview`) and rides the detail payload under its `review` key — exactly where
  the CLI carries it (`show --json`; `list` carries no review facts). A separate path would be
  a second composition of the same facts with no consumer: the Detail page needs the whole
  read anyway. The charter's list/show/attention/review passthrough is thus three paths, with
  review a named key of the detail body.
- **Space required, never defaulted.** `resolveStoreSpace` refuses an absent selector
  (`space_required`, 400) — the documented no-launch-store-fallback rule. An HTTP request has
  no ambient cwd; the CLI's cwd defaulting is deliberately not mirrored.

### D3 — Error mapping: two disjoint channels, one central table

- **Refusals** (thrown `StoreIssueError`) → `ApiErrorBody` via the existing
  `statusForIssueCode` table (`stores.ts:146`): `issue_not_found` → 404, scope faults → 400,
  `store_query_ref_unreadable` → 502, etc. One addition to `mapThrown`: the attention
  narrowing refusal `issue_attention_unknown_issue` (a `StoreError`, not a
  `StoreIssueErrorCode` — that union stays closed) maps to 404; without it the code would fall
  to 500 `store_query_failed` and misreport a client error as a server fault.
- **Unreadable evidence is not a refusal.** An Issue whose plan fails its digest, an
  unreadable ref, a divergent record — these come back inside a 200 payload as
  `problems[]` / `complete: false` / `unsearchedRefs` / per-node `status.problems`, exactly as
  the CLI reports them. The endpoints add no translation layer that would collapse the
  channels.
- The legacy `stores-routes.ts` family's coarser mapping (`issue_scope_required` ? 404 : 422)
  disagrees with `statusForIssueCode` today; that discrepancy is documented here and left
  alone — converging it is not this change's business.

### D4 — Run-state visibility over HTTP: honest degradation, disclosed

The CLI resolves its run-state context from the operator's cwd. The daemon has no request cwd;
it uses `context.launchProjectRoot` (the project the daemon was launched from) as the probe
start path, re-resolved per request (no cached context — freshness discipline). When no
execution root resolves, the projection honestly degrades: `runStateVisibility: {kind:'none'}`
and committed-evidence-only observations — never a fabricated live fact. The payload already
carries `runStateVisibility`; the UI must disclose it (a quiet notice on Board and Detail when
`kind === 'none'`), so a viewer always knows whether live-run facts were in scope.
Store-resident nodes located via the workspace index are unaffected — widening context comes
from the store root, which the space resolution supplies.

### D5 — UI information architecture

**Routes** (store spaces only — Issues live in stores):

```
/s/:storeId/issues            IssueBoardPage
/s/:storeId/issues/:issueId   IssueDetailPage
```

No `/p/...` pair. No `SWITCHABLE_SECTIONS` entry in g-001: the documented fallback ("anything
else falls back to the board" on a space switch) is the safe behavior, and preserving `issues`
across a switch to a project space would produce a dead route; g-003's interaction pass can
revisit with a type-aware switch. Nav: one `Issues` entry in `Layout.tsx`, rendered for store
spaces only, `aria-current` via the existing `spaceSection` mechanics (which needs no change —
unknown sections already report `board`; the nav link marks itself current by path prefix).

**Component tree** (new files, old board untouched):

```
IssueBoardPage.tsx      fetch: Promise.all(getStoreIssueProjections, getStoreIssueAttention,
                                           getStoreProjects)
  ├─ notice strip       problems / complete:false / unsearchedRefs / runStateVisibility none
  ├─ MemberChips        (reused) entries = every Store project catalog member, including
  │                     members with no Issue lane; projection aliases improve labels;
  │                     "All" default; filter-only, never persisted
  └─ IssueLane ×5       lanes = the closed phase vocabulary, fixed order
       └─ IssueCard     title (record.title, issueId fallback) · health badge ·
                        progress x/y · top attention item (first fail-first item for the
                        issue) · divergence/uncommitted notice when present · link to detail
IssueDetailPage.tsx     fetch: Promise.all(getStoreIssueProjection(issueId),
                                           getStoreIssueAttention(space, issueId))
  ├─ header             title · state · phase/health/progress (three separate facts)
  ├─ Background & Acceptance   record readme · acceptance conditions/gate/record
  ├─ Execution Plan     per node: id, kind, lifecycle+reason, observation, project/target
  │                     line, suggestedPipeline/rationale/uncertainty, diagnostic;
  │                     revision delta block when present
  ├─ Changes by project status.projects lanes: alias/id header, per-lane progress, node rows
  ├─ Cross-project dependencies  per-node blockedBy facts (`node@project: state` labels)
  ├─ Runs, Sessions & Delivery   per-node attribution (pipeline, sessions, evidence locator,
  │                     runStatePath) · per-node delivery states · rollup counts
  ├─ Review             determination (closed vocabulary) · threads · verification summary
  └─ Needs Attention    narrowed attention items (empty state says so)
```

**Presentation-only mapping rule** (the UI-side zero-derivation line): the UI maps closed
vocabularies to lanes, labels, and badges — it never computes a phase, health, progress,
determination, or attention fact from other facts. Lane placement IS `status.phase` verbatim;
every axis, count, and label renders a payload field. Closed-vocabulary labels go through
literal-key lookup tables (`Record<IssuePhase, 'issues.phase.planning' | …>`) so all keys stay
literal in source; the three-locale parity test guards the catalog.

**Data flow**: fetch-on-mount with `cancelled` flag + `refreshNonce`, keyed on
`[selector, refreshNonce]` — the package's standard triad (loading / error-as-i18n-key /
empty). No module-level cache, no localStorage, no derived-state store. §11 compliance is
structural: cards are Issues (never Tasks — the page fetches issue projections only); chips
take their complete roster from the existing read-only Store project aggregate, filter visible
cards, and reset on reload (nothing persisted, lanes stay phase lanes under any chip selection);
session cwd appears nowhere in this slice.

### D6 — Zero-second-state, pinned by tests

- **Parity by construction + witness**: over-the-wire test deep-equals the HTTP body with
  `runCLI('store','issue','show','--json')` (and list, and attention) on the same fixture
  store — a fixture that includes a superseded revision (so `delta` is non-null and a
  forgotten predecessor input would be caught) and an unreadable-plan member (so the problems
  channel is exercised).
- **Freshness (cache-rebuild consistency, server half)**: mutate the fixture store between two
  identical GETs (e.g. accept an Issue via the CLI); the second response reflects the new
  truth with no invalidation step — there is nothing to invalidate.
- **No mutation**: store bytes identical before/after each projection read (existing
  write-nothing pattern).
- **UI half**: component tests assert displayed axis/count/label values equal the mocked
  payload's fields (traceability); a refresh re-calls the client (no reuse of stale data);
  no storage API is touched (nothing persists to rebuild).

### D7 — Dogfood: receipts, not CI dependencies

CI tests run on temp fixture stores. The real `issue-registry` store (five Issues, all done,
attention empty) is evidence material, read-only:

- CLI `list`/`show`/`attention` `--json` captured beside the corresponding HTTP responses from
  a daemon launched against this repo (`?space=store:<uid>`), deep-equal receipts into
  `evidence/`.
- Board smoke: `rasen ui` against the store — five cards, all in the Done lane, no attention
  lines, `runStateVisibility` disclosed as resolved; capture into evidence (DOM/screenshot).
- One representative real payload distilled into a `satisfies StoreIssueProjectionResponse`
  test fixture — the truthful crossing from real store to typed test data.

## File-level change map

| Area | Files |
| --- | --- |
| Core composition (new) | `src/core/issue-read/composition.ts`, `run-context.ts`, `index.ts` |
| CLI rewire | `src/commands/store-issue.ts` (list/show onto compose; moved exports removed), `src/commands/store.ts` (attention onto compose; imports updated) |
| Daemon | `src/core/management-api/stores.ts` (3 handlers + `mapThrown` addition), `router.ts` (3 `MANAGEMENT_PATHS` entries + 3 GET branches), `wire-types.ts` (3 aliases in the Store aggregate section) |
| UI api | `packages/ui/src/api/types.ts` (3 mirrored response types + supporting structural mirrors), `packages/ui/src/api/client.ts` (3 methods) |
| UI pages | `packages/ui/src/components/IssueBoardPage.tsx`, `IssueCard.tsx`, `IssueDetailPage.tsx`; `app.tsx` (2 routes); `Layout.tsx` (store-space nav entry) |
| i18n | `packages/ui/src/i18n/locales/{en,ja,zh-cn}.json` (`issues.*` keys, key-parity across all three) |
| Server tests | `test/core/management-api/issue-projection.test.ts` (new; weight entry in root `vitest.config.ts` slow-test table), wire-mirror floor list in `test/core/management-api/store-aggregate-wire-mirror.test.ts` |
| UI tests | `packages/ui/test/components/issue-board-page.test.tsx`, `issue-detail-page.test.tsx`, `packages/ui/test/app.test.tsx` (routes), fixtures in `packages/ui/test/fixtures/` |
| Index upkeep | `architecture-index` skill: quick-locate rows + `detail/modules/` entries for the new core module and endpoints |

## Testing strategy (which config runs what)

- **Server/core/CLI**: root `vitest.config.ts` (`pnpm test` or targeted
  `pnpm exec vitest run test/core/management-api/issue-projection.test.ts`). New file gets a
  `KNOWN_SLOW_TEST_WEIGHTS_MS` entry (real-Git fixtures + `runCLI` spawns).
- **UI**: packages/ui's own config only — `pnpm --filter @atelierai/rasen-ui test`. The root
  config's include glob matches neither `packages/ui/test/**` nor `.tsx`; running UI tests
  through the root config reports green on zero tests. Component tests use
  `// @vitest-environment jsdom`, `vi.mock` of `api/client.js`, `mountAtSpace`, and
  `satisfies`-typed fixtures.
- **Refactor guard**: the existing store-issue / store-attention CLI suites run unchanged —
  they pin the `--json` bytes across the D1 extraction.

## Risks

- **CLI refactor regression** — mitigated by the byte-parity pins (existing suites) plus the
  new CLI↔API deep-equal witness; the extraction moves code, it does not reshape output.
- **Wire-mirror typing volume** (the `IssueStatus` tree is deep) — mechanical; guarded by the
  drift test's floor list and `satisfies`-typed fixtures; no structural invention allowed.
- **Daemon run-state context surprises** (launch root ≠ operator cwd) — by design: honest
  degradation, disclosed in the payload and the UI (D4); receipts on the real store make the
  difference visible rather than latent.
- **Two Issue UIs briefly coexist** (new pages + orphaned `StoreIssuesView`) — accepted;
  disposal is g-003's single pass, per the P6 pre-analysis.
- **zh-cn locale edits** — multibyte-safe editing discipline (small `Edit` spans, verify no
  U+FFFD after write) per the known Write-tool hazard.
