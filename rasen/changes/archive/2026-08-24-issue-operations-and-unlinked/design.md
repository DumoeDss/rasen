# Design — issue-operations-and-unlinked

## Context

g-001 established the shared Issue read surface: `src/core/issue-read/` composes Store evidence and
Phase 1–6 projections once, the management API's maintained flat Store family passes it through, and
`IssueBoardPage` / `IssueDetailPage` render it without a status cache. g-002 consumes that boundary;
it does not add another Issue status model.

The operational pieces already exist but are split across older UI locations:

- `GET /api/v1/sessions` returns supervised Session records plus each Session's read-only run-state
  join. The record already stores actual `cwd`, planning `space`, frozen `execution`, Change alias,
  timing, state, and termination. `SessionRow` renders output tails and a confirm-first DELETE, while
  `RunningSessionsMenu` shows only a small live header summary.
- `GET /api/v1/runs` and exact `GET/POST /api/v1/runs/<changeId>/<runId>` expose canonical
  reconciler summaries, projected Run detail, and optimistic-concurrency controls. The existing
  `OperationsSection` in Task detail submits only server-projected `allowedControls` and replaces its
  view from committed responses; it already handles Record-version conflict correctly.
- A Store aggregate cannot be passed to `/api/v1/runs`: Runs are execution-project scoped. The Store
  spaces inventory supplies current member checkout locators, while `getStoreProjects()` remains the
  authority for Store membership. A Store Operations page must therefore query each rooted current
  member explicitly and keep the selector that produced each Run for later detail/control calls.
- `GET /api/v1/stores/changes` already supplies grouped active and archived Change occurrences;
  `issuesReferencing(changeInstanceId)` supplies one reverse lookup. Doing one reverse lookup per row
  would be an N×Issue scan and would still make an incomplete scan easy to mislabel as absence. A
  single bulk composition is needed for both Operations attribution and the Unlinked page.
- The existing Store mutations are exactly the declared five Issue mutations: create an Issue and
  publish a complete next Execution Plan already exist over HTTP. The missing safety fact is the
  revision a read-modify-publish client based its graph on. Today two UI writers can both read `0002`;
  the second publication will legally allocate `0004` while resubmitting a graph that omits `0003`'s
  node. Immutable history preserves the evidence of the mistake but does not prevent it.

Constraints: the persistent `issue-registry` Store is read-only; all mutation tests use temporary
Stores. `src/core/pipeline-registry/` and version fields remain untouched. Store query reads stay
lock-free. UI tests run with `pnpm --filter @atelierai/rasen-ui test`, never the root Vitest config.
All paths remain opaque values or use Node's `path` module server-side; the browser never parses a
Windows/POSIX filesystem path to recover identity.

## Goals / Non-Goals

**Goals**

- One Store-level Operations page that makes active/abnormal Sessions, actual cwd, execution
  project, Change/Issue attribution, and canonical Runs operable without duplicating lifecycle
  decisions.
- A fresh bulk Change↔Issue association read that can prove “unlinked” or name why it cannot.
- An Unlinked Changes page that keeps Change identity visible and offers confirmed attach/create
  flows using the existing Issue mutations.
- Prevent stale read-modify-publish replacement through an optional revision precondition checked
  inside the existing Issue lock.
- Leave stable routes, wire shapes, and component seams for g-003's final board/navigation cutover.

**Non-Goals**

- No new Session/Run lifecycle, scheduler, retry engine, or control command. “Retry” is the existing
  projected resume of a retryable infrastructure wait; “stop” maps to projected Run cancel or the
  existing confirmed Session kill.
- No inferred Session→Run association. A Change alias shared by several Runs is not an exact Run id.
- No Issue edit, Issue deletion/rollback, plan-node deletion, dependency editor, or arbitrary plan
  editor. Attach appends one required node; create publishes one-node revision `0001`.
- No uniqueness rule that globally forbids a Change instance in several Issues; the Unlinked flow
  acts only while the bulk read proves zero current links, while generic plan authoring keeps its
  existing domain contract.
- No old Board, `StoreIssuesView`, `StoreAggregateBoard`, or `RunningSessionsMenu` disposal. g-003
  owns the one-time cutover.
- No project-wide Operations route. Existing Task detail remains the project-scoped surface; g-002's
  new surface is Store-only because Issue attribution and member filtering are Store concerns.

## Decisions

### D1 — One bulk Change-to-Issue composition extends `src/core/issue-read/`

Add `src/core/issue-read/change-links.ts`, exported from the existing barrel. It performs one
`listChanges`, one `listIssues`, and at most one `resolveExecutionPlan` per Issue with a latest
revision, then walks the readable revision nodes once. It never calls `issuesReferencing` once per
Change.

The payload is a direct core type and a direct management wire alias:

```ts
type ChangeIssueAssociation = 'linked' | 'unlinked' | 'unknown';
type ChangeIssueEligibility =
  | 'attachable'
  | 'already-linked'
  | 'identity-missing'
  | 'identity-ambiguous'
  | 'evidence-incomplete';

type ChangeOccurrence =
  | { kind: 'active'; change: AggregateChangeEntry }
  | { kind: 'archived'; change: AggregateArchiveEntry };

interface ChangeIssueLink {
  issueId: string;
  title: string | null;
  state: IssueState | null;
  revisionId: string;
  nodeIds: readonly string[];
}

interface ChangeIssueLinkEntry {
  occurrence: ChangeOccurrence;
  association: ChangeIssueAssociation;
  eligibility: ChangeIssueEligibility;
  issues: readonly ChangeIssueLink[];
}

interface ChangeIssueLinksPayload extends AggregateCompleteness {
  entries: readonly ChangeIssueLinkEntry[];
}
```

Decision rules, in order:

1. `changeInstanceId === null` → `unknown / identity-missing`.
2. More than one occurrence claims the same non-null instance → `unknown / identity-ambiguous`.
3. At least one readable latest plan names the exact instance → `linked / already-linked`, even if
   unrelated evidence is incomplete; a proven positive does not become unknown.
4. No link plus any unreadable relevant Issue plan/ref/problem → `unknown / evidence-incomplete`.
5. Exactly one stable occurrence, zero links, complete scan → `unlinked / attachable`.

The composition merges `complete`, `unsearchedRefs`, and `problems` from the Change, Issue, and plan
reads with deterministic de-duplication; a latest revision that is named but unreadable also lowers
the scan to incomplete. Entries sort by project, target line, active-before-archived, Change alias,
then stable instance. Links and node ids sort lexically. This gives deterministic tests and renders
without turning sort order into authority.

The flat management family adds:

```
GET /api/v1/stores/change-issue-links?space=store:<uid-or-alias>
  -> StoreChangeIssueLinksResponse = ChangeIssueLinksPayload
```

`handleStoreChangeIssueLinks()` is a passthrough using the uid-addressed Store query and
`{store: storeUid, startPath: ''}`. It inherits loopback/bearer security and the existing refusal
envelope. The legacy parameterized `stores-routes.ts` family stays untouched.

Alternative rejected: compute “unlinked” in `UnlinkedChangesPage` by calling
`getStoreIssueReferences` per Change. It is quadratic, crosses several request-time snapshots, and
has no single place to enforce “incomplete is not absence.” Alternative rejected: persist a link
index. It would be a second truth requiring invalidation and would violate Phase 7's rebuild line.

### D2 — Operations is a UI composition over existing lifecycle endpoints

No `/stores/operations` endpoint and no new lifecycle projection are introduced. `OperationsPage`
loads four input families:

| Input | Selector | Authority used |
| --- | --- | --- |
| Store roster | `getStoreProjects(store)` | current Store membership/project ids |
| Machine locators | `listSpaces()` | optional current checkout root/name only |
| Sessions | `listSessions(store)` plus `listSessions(project:<root>)` per rooted member | Session registry + its existing per-Session run-state join |
| Runs | `listRuns(project:<root>)` per rooted member | canonical Run projector for that execution checkout |
| Issue links | `getStoreChangeIssueLinks(store)` | D1's fresh Store-evidence association |

Requests use `Promise.allSettled` at the member/source boundary. A failing member gets its own error
and retry action; successful member data stays rendered. Session ids de-duplicate the Store and
member queries. Each Run response is stored beside the exact `project:<root>` selector that produced
it, and that selector is passed unchanged to Run detail/control. A rooted member's first page follows
the existing 100-summary bound; its existing opaque cursor drives an explicit “load more” request,
not an unbounded eager drain.

The Store roster owns membership as g-001's review established. `listSpaces()` may attach a root to a
roster member but cannot add a chip. A current member without a root remains visible as unavailable.
Store-planning/planning-only Sessions appear under “All” and no project chip claims them.

Polling stays bounded: the page refreshes every three seconds only while an active Session or
non-terminal Run is displayed, plus an explicit refresh. Filter and dialog state are mount-local;
no localStorage/module cache is introduced.

Alternative rejected: reuse the Store selector with `/runs`. That endpoint correctly refuses a
Store aggregate because it cannot choose an execution project. Alternative rejected: make cwd the
project key. cwd is a locator; the frozen `session.execution.projectId` and the member query source
are the identity facts.

### D3 — Classification and attribution are small, explicit presentation functions

Add a UI-only pure module `components/operations-model.ts` (or adjacent equivalent), covered without
DOM, that maps wire facts to presentation groups. It stores nothing and introduces no domain axis.

Session grouping is closed for this page:

- **active**: recorded state `starting | running | exiting`;
- **abnormal**: a joined run entry is `error`, an auto-run file is `invalid`, or an exited Session
  has missing/non-`exit` termination reason or a non-zero exit code;
- **settled**: exited with termination `exit` and exit code null/zero, available behind disclosure.

Attribution uses exact fields only:

1. actual cwd renders `session.cwd` verbatim with “locator only” language;
2. execution project renders `session.execution` (`planning-only`, project, or legacy unknown);
3. a Session Change requires `changeName`, `execution.kind === 'project'`, and exactly one D1
   occurrence matching project id + Change alias; target-line facts remain presentation only and
   never narrow this candidate set;
4. a Run Change uses the member project whose explicit selector returned the Run plus its `changeId`;
5. Issue links are copied from the one matched D1 entry; zero/multiple Change candidates yield a
   named unavailable/ambiguous result;
6. exact Run id is displayed from a Run summary/view only. A Session's joined legacy run-state can
   show pipeline/stage but is never assigned one of several reconciler Run ids by Change alias.

The server `SessionRecordWire` is aligned with facts `toWire()` already emits: `SessionSpaceWire`
gains the optional `planning` identity block, a `SessionExecutionWire` mirrors
`RuntimeExecutionRef`, and `SessionRecordWire.execution?` is declared. The UI mirror gains the same
fields. This is type/contract repair, not a new derivation or path parser.

### D4 — Run and Session controls reuse the current components and APIs

Refactor `OperationsSection.tsx` just enough to expose a reusable Run list/detail panel whose input
is one project-tagged `RunsResponse`; Task detail keeps its existing wrapper and behavior. The new
page renders one panel per visible member. Run detail continues to call `getRunDetail` and
`postRunControl` with that member's exact selector.

Control wording is a presentation of projected authority:

- an `AllowedControl {kind:'resume', waitId}` whose matching wait is
  `{kind:'infrastructure', retryable:true}` renders **Retry**;
- another projected resume renders **Resume**;
- projected cancel renders **Stop Run**, with the existing two-step confirmation;
- live Session DELETE renders **Stop Session**, with `SessionRow`'s existing two-step confirmation;
- `decision`, `escalate`, and read-only `accept-workspace-revision` retain existing behavior.

Requests continue to carry exact ids and `expectedRecordVersion`. A 409 refetches detail; success
uses `response.view`; neither optimistically edits the Run. Session 404 means already gone and causes
a list refresh. Operations never automatically retries an HTTP request or relaunches a Session.

### D5 — Unlinked Changes consumes D1 and never upgrades a Change visually

Route: `/s/:storeId/unlinked-changes` (Store only). `UnlinkedChangesPage` fetches D1 plus the g-001
Issue projection list narrowed to `open`. It groups occurrences by project/target line and visually
separates active from archived. Only `unlinked / attachable` rows expose write actions. Linked rows
may be summarized by count; unknown entries remain visible in an “association unknown” section with
the exact reason and completeness notice.

Every row leads with “Change” and renders alias, stable instance, project, target line, evidence ref,
and active/archive facts. It does not use `IssueCard`, create a phase lane, or map a Change state to
an Issue state. Project chips are local filters only.

`LinkChangeDialog.tsx` has two explicit modes:

**Attach existing Issue**

1. Select an open readable Issue from the projection list.
2. Fetch that Issue's fresh g-001 detail; require a readable current revision or the explicit no-plan
   state.
3. Propose an editable canonical node id (Change alias first, then a deterministic `-2`, `-3`, …
   non-conflicting suffix). The operator sees it before confirmation. `dependsOn` is exactly `[]`;
   lifecycle is the canonical absent=`required` form.
4. Build a complete replacement by enumerating every admitted field from each existing revision
   node (`kind`, identity/summary, project, target line, dependencies, lifecycle, reason,
   suggestion, rationale, uncertainty), then append the new Change node.
5. Preview Change identity/scope, Issue id/title, base revision, preserved node count, and new node;
   confirmation calls the existing plan POST with `expectedRevisionId`.
6. Conflict refetches link + Issue reads and writes nothing. Success refreshes from Store evidence.

**Create a single-Change Issue**

1. Require operator-authored canonical Issue id and non-empty title; never derive Issue identity or
   title from the Change silently. Preview those plus the exact Change scope and node.
2. On confirmation call `createStoreIssue`, then `publishStoreExecutionPlan` with
   `expectedRevisionId:null` and one node.
3. Both success → refresh and link to the new Issue Detail.
4. Create success + plan failure → retain the legal Issue record, show its id plus the server error,
   state that the Change remains unlinked, and offer attach-existing recovery targeting that Issue.
   There is no rollback because Issue deletion is not one of the five domain mutations.

The browser never calls create/publish before the confirm step. Server validation remains
authoritative for every id, scope, reference, graph, and concurrency rule.

### D6 — Optional expected revision is checked inside `publishPlan`'s lock

Extend `PublishExecutionPlanInput` and the HTTP request mirror:

```ts
expectedRevisionId?: ExecutionPlanRevisionId | null
```

Semantics distinguish all three values:

- omitted (`undefined`): existing unconditional next-revision behavior for CLI/internal callers;
- `null`: caller observed no plan and requires `previous === null`;
- revision id: caller requires `previous === expectedRevisionId`.

Inside `StoreIssuesModule.publishPlan`, after record existence/schema validation and while holding the
existing Issue lock, allocate/read `{previous,next}`. If an expectation is present and differs from
`previous`, throw `execution_plan_revision_conflict` with expected/actual/fix and write nothing. Only
then perform reference verification and write the new immutable revision. The lock prevents another
Issue publication from changing `previous` between compare and write. Omitted callers keep the exact
old path.

`handleStorePublishPlan` validates the untrusted field (`undefined | null | canonical string`), passes
it through, and maps the new Store code to HTTP 409. The request node mirror is completed with
`lifecycle`, `reason`, `suggestedPipeline`, `rationale`, and `uncertainty`; otherwise a safe
read-modify-publish client could not preserve plans authored by Phases 4–6.

Alternative rejected: refetch immediately before POST and compare in the browser. Another writer can
publish between those two operations. Alternative rejected: add a sixth purpose-built “attach”
mutation. The domain already declares plan publication as the mutation that changes links; a
specialized UI should compose it, not create a second write authority.

### D7 — Read incompleteness, write refusal, and partial success are separate channels

- D1 read problems remain a successful payload with `complete:false`, `unsearchedRefs`, `problems`,
  and per-entry `unknown` eligibility. An unreadable plan is not an HTTP refusal.
- Missing/invalid Store scope remains the shared management error envelope.
- Plan validation/reference faults remain their Store Issue codes. Revision mismatch is the new 409
  `execution_plan_revision_conflict` and writes zero bytes.
- Operations member-source failures are per-source UI errors; they do not overwrite prior successful
  source data during polling.
- Create-single's two calls are not falsely called atomic. The UI records in component state that
  `createStoreIssue` succeeded, refreshes the real lists, and exposes recovery if publication fails.
  It never stores that partial fact beyond the page or writes a compensating deletion.

### D8 — Routes, navigation, files, and the g-003 seam

New store-only routes:

```
/s/:storeId/operations
/s/:storeId/unlinked-changes
```

They receive explicit store-only nav links and path-prefix `aria-current` handling like g-001
Issues. Neither enters `SWITCHABLE_SECTIONS`: preserving either across a Store→project switch would
create a dead project route, so the existing Board fallback remains correct. g-003 can reorder or
retire old navigation in one cutover without changing these page contracts.

File-level map:

| Area | Files |
| --- | --- |
| Core association read | `src/core/issue-read/change-links.ts`, `src/core/issue-read/index.ts` |
| Conditional plan publication | `src/core/store/issues/{types,module,diagnostics}.ts` (or the existing error-code owner) |
| Management API | `src/core/management-api/{stores,router,wire-types}.ts` |
| UI API/types | `packages/ui/src/api/{types,client}.ts` |
| Operations UI | new `OperationsPage.tsx`, pure attribution/model helper; refactor `OperationsSection.tsx` and `SessionRow.tsx` without changing Task-detail behavior |
| Unlinked UI | new `UnlinkedChangesPage.tsx`, `LinkChangeDialog.tsx` (or one page-local equivalent) |
| Shell | `packages/ui/src/app.tsx`, `components/Layout.tsx`, `store/use-space.ts` only if a helper needs explicit store-only active detection |
| Presentation | `packages/ui/src/styles.css`, all three locale JSON files |
| Server tests | new link-composition/API test; Store conditional-publication tests; existing stores/wire suites extended |
| UI tests | new Operations/Unlinked component tests; existing Operations controls, Task detail, SessionRow/app tests extended |
| Documentation | architecture index rows for link composition/endpoint/pages |

### D9 — Verification and dogfood

Server fixtures include active and archived Changes, two Issues, a no-plan Issue, an unreadable latest
plan, duplicate/missing Change identity cases, and a link mutation between two identical GETs. Tests
pin D1 ordering, complete/unknown rules, no-write reads, and direct handler/HTTP equivalence.

The CAS suite publishes from matching, null, omitted, and stale bases and checks revision file bytes
before/after the stale call. A concurrency test starts two conditional writers from one base and
proves exactly one wins. Existing unconditional publication tests remain unchanged.

UI fixtures exercise Store-planning and member-project Sessions, Windows and POSIX cwd strings,
planning-only/legacy execution, ambiguous Change aliases, multiple Issue links, partial member
failure, run paging, retry-vs-resume labels, both confirmations, stale attach refetch, and create
partial recovery. Existing `OperationsSection` control/parity suites protect the refactor.

Dogfood reads only from `issue-registry`: capture the bulk link payload and render Operations/Unlinked
with current real evidence. Any attach/create demonstration uses a temporary fixture Store; the
persistent Store's bytes are hashed before/after dogfood.

## Risks / Trade-offs

- **Multi-endpoint Operations snapshots can cross a mutation boundary** → Every fact retains its
  source identity; explicit refresh/poll converges, controls revalidate Record version, and Issue
  plan writes use their own revision CAS. No cross-resource atomic snapshot is claimed.
- **Many member projects create many requests** → Current-member roster bounds fan-out; requests run
  concurrently with per-source degradation, Run pages stay server-bounded, and polling runs only
  while live work exists.
- **Alias-based Session attribution can be ambiguous** → Require frozen execution project and one
  matching stable occurrence; otherwise show ambiguous/unknown and select none.
- **Bulk link scans cost O(Issue plans + Change occurrences)** → One plan read per Issue is strictly
  better than one reverse scan per Change; no cache is accepted. Performance is measured on the real
  Store and a bounded synthetic fixture before ship.
- **Create succeeds while first plan fails** → Report the legal partial outcome and offer explicit
  attach recovery; never delete intent silently.
- **Completing plan-node wire fields risks mirror drift** → Use explicit field lists and extend the
  existing Store aggregate wire-mirror test plus `satisfies` fixtures.
- **Session wire types currently under-declare emitted facts** → Align core and browser mirrors and
  add a focused wire fixture; do not change stored Session records or infer missing legacy fields.
- **Windows roots differ in slash/case spelling** → Render cwd verbatim; identity matching uses
  project ids and server-provided selectors, never browser path parsing. Tests include drive-letter
  and backslash roots.

## Migration Plan

1. Land the additive D1 read endpoint and conditional-plan input; old clients continue to omit the
   expectation and behave unchanged.
2. Land UI wire/client support and the two store-only pages/routes/nav entries.
3. Dogfood all reads against `issue-registry` without mutation; run attach/create only on fixtures.
4. g-003 may then cut over old board/navigation surfaces while treating the two routes and D1 payload
   as stable seams.

Rollback is additive: remove the new routes/pages and link endpoint; callers that never send
`expectedRevisionId` remain unaffected. Published Issue revisions are ordinary valid immutable
revisions and require no data migration or rollback.

## Open Questions

None. g-002 intentionally leaves visual/navigation consolidation and orphan removal to g-003; the
behavioral and API seams needed for that child are fixed above.
