# Design — issue-board-cutover

## Context

g-001 and g-002 have already delivered the complete Phase 7 data and action boundaries. The
shared `src/core/issue-read/` compositions expose fresh Issue projections and Change associations;
`IssueBoardPage` and `IssueDetailPage` render those projections; Store Operations composes existing
Session/Run APIs; Unlinked Changes composes the five existing Issue mutations with revision CAS.
Both children are independently verified and review-clean. This child consumes those contracts and
adds no server endpoint, status derivation, mutation, link index, or browser persistence.

The remaining inconsistency is entirely at the UI cutover boundary. `app.tsx` still routes both
`/p/:id/board` and `/s/:id/board` to the Task/Change `BoardPage`; Store roots, launch selectors,
space rows, and create success all enter that old route. `Layout` shows Board and a separately
polling `RunningSessionsMenu` beside the new Store Issues/Operations/Unlinked navigation. Two older
Store components — `StoreIssuesView` and `StoreAggregateBoard` — have tests and presentation assets
but no production route/import. Store Task detail is still addressable even though g-002 fixed Task
Detail as the project-scoped Run/detail/control surface.

The Issue pages also need one routing hardening already proven necessary by g-002: `preact-iso` may
reuse a route component across parameter changes. An effect cleanup prevents a late request from
committing, but it does not create a synchronous ownership boundary before the next paint. Finally,
the pages render many exact Git/runtime locators, yet Board state has no explicit link to the Detail
evidence that supports it and no end-to-end receipt proves cache-discard rebuild equivalence.

Constraints: Store-only routes remain `/s/:storeId/issues[/:issueId]`, `/operations`, and
`/unlinked-changes`, with no `/p/` mirror. They do not enter `SWITCHABLE_SECTIONS`. The persistent
`issue-registry` Store is read-only. Real-Git fixtures run serially on Windows. UI tests use
`pnpm --filter @atelierai/rasen-ui test`; the root Vitest config silently excludes them. Version
fields and `src/core/pipeline-registry/` remain untouched. The 13 known Canvas/consultation
type-check diagnostics are an unrelated baseline.

## Goals / Non-Goals

**Goals**

- Make the Issue Board the single canonical Store home while retaining the Task/Change Board and
  Task Detail as project-only surfaces.
- Finish Issue Board/Detail routing interactions with synchronous selector ownership, stable
  evidence anchors, and links to the already-delivered Operations/Unlinked action owners.
- Apply one explicit disposition to every frozen orphan/cutover item and prove no navigable Store
  duplicate truth remains.
- Produce an end-to-end evidence line from each rendered state family to Git/runtime locators and
  prove a cache-cleared remount reconstructs an equivalent view from fresh reads.

**Non-Goals**

- No new Issue/Change/Run/Session API, mutation, projection, lifecycle, cache, persisted UI state,
  service worker, or project-wide Operations route.
- No Board-side Issue editor, plan editor, acceptance action, Run control, or Change-link mutation;
  those remain with the existing CLI, Operations, and Unlinked Changes owners.
- No reinterpretation of phase, health, progress, attention, review, delivery, Change association,
  project membership, or Session attribution.
- No Phase 7 Issue #6 close/accept/dogfood mutation in implementation tasks. LEAD owns that action
  after portfolio delivery; this child records only read-only UI evidence.

## Decisions

### D1 — Type-aware canonical homes and one frozen route matrix

Add pure route helpers rather than scattering `space.type` conditionals:

```ts
spaceHomeHref(space): string
// project -> /p/<id>/board
// store   -> /s/<id>/issues

spaceSwitchHref(path, destination): string
// common config/archive/pipelines sections survive across either namespace;
// a Store-only section survives only for Store -> Store;
// every other destination falls back to that destination's canonical home.
```

`spaceRouteFromSelector`, `SpaceRootRedirect`, `SpaceBootstrap`, `SpacesPage`, and successful
create/register navigation use `spaceHomeHref`. `SpaceSwitcher` uses `spaceSwitchHref`. The
Store-only nouns remain outside `SWITCHABLE_SECTIONS`; adding them to that set would manufacture
`/p/.../issues|operations|unlinked-changes` dead links. Explicit lookup sets, not path regexes,
decide common and Store-only sections.

Final route/disposition matrix:

| Route/surface | Disposition |
| --- | --- |
| `/p/:projectId/board` | Retain `BoardPage` as project Change/Task board |
| `/p/:projectId/task/:changeName` | Retain `TaskDetailPage` and its Run detail/controls |
| `/s/:storeId/issues[/:issueId]` | Canonical Store home/read surface |
| `/s/:storeId/operations` | Retain exact g-002 Store execution surface |
| `/s/:storeId/unlinked-changes` | Retain exact g-002 association/write surface |
| `/s/:storeId/board` | Replace-history redirect to `/s/:storeId/issues`; never mount `BoardPage` |
| `/s/:storeId/task/:changeName` | Replace-history redirect to `/s/:storeId/operations`; never mount `TaskDetailPage` |
| Store root/launch/space-row/create success | Land on `/s/:storeId/issues` |
| Project root/launch/space-row/create success | Land on `/p/:projectId/board` |

The legacy redirects preserve bookmarked URLs without preserving a duplicate renderer. A Store Task
URL redirects to Operations because that is the Store owner for Run/Session detail and controls; it
does not guess an exact Run from a Change alias. Project routes retain all existing Change creation,
worktree, Task, and Run-control behavior.

Alternative rejected: keep `/s/:id/board` as an alias that directly renders `IssueBoardPage`.
Two canonical URLs for one truth create active-state/history ambiguity and make orphan detection
harder. Alternative rejected: remove the paths and rely on the default route. The default bootstrap
can resolve a different launch space and is not a safe migration for a bookmarked Store URL.

### D2 — Selector-keyed children are the synchronous route ownership boundary

`IssueBoardPage` becomes a thin route owner that renders a stateful child keyed by the full Store
selector. `IssueDetailPage` keys its child by the full selector plus decoded Issue id. The child owns
all fetch state, filter state, and refresh nonces. A Store or Issue route transition therefore
unmounts old state synchronously, before any effect or deferred promise can paint/commit it.

Real `preact-iso` Router tests hold Store A requests unresolved, navigate the same mounted component
to Store B, resolve A late, and prove only B can appear. The Detail test also changes Issue ids in one
Store. The key includes the selector, not display id alone, so Store/project namespaces and ids
containing colons remain opaque and distinct.

This consumes the g-002 review finding verbatim: **Selector-keyed stateful children provide the
synchronous Store boundary required by `preact-iso`.** A cancelled flag remains defense in depth,
not the ownership primitive.

### D3 — Provenance is a render-time index over existing payload facts

Add no evidence API and no durable browser model. `IssueDetailPage` renders a stable provenance
section from the same `projection` and narrowed `attention` objects already used by the page. Each
entry has a stable DOM anchor, a closed kind (`git` or `runtime`), a source label, and the exact
locator/fingerprint fields present in the payload:

| Provenance entry | Existing facts rendered |
| --- | --- |
| Issue record | `issue.refs`, latest revision id, record/copy content hashes and diagnostics |
| Plan and projection inputs | plan revision/supersedes/content hash, searched/found refs, Change instance/project/target facts, problems and completeness |
| Acceptance/review | conditions path/revision/content hash, accepted record content hash, determination and thread inputs |
| Runtime | `runStateVisibility`, node `runStatePath`, `locatedBy`, evidence locator, Session/thread/transcript pointers |
| Delivery | archive ref/blob path, code commit, planning branch, structured evidence path + SHA, missing fields |

Board phase/health/progress and top-attention affordances link to the Issue Detail provenance anchors
for their family. Detail state labels link locally to the same entries. The links are browser-safe
anchors, never `file://` URLs; server-local Windows/POSIX paths remain opaque displayed locators.
Missing/unreadable evidence produces an anchored diagnostic entry rather than an invented target.

Deriving this presentation list during render is not a second truth: it copies and groups payload
fields without deciding an axis, association, membership, or lifecycle. Tests assert the link target
exists and its locator text equals the fixture field. Closed kind/anchor tables stay explicit.

Alternative rejected: create a generic provenance endpoint or persist a client evidence graph.
Both would duplicate the already-composed projection and introduce an invalidation problem precisely
where the roadmap requires rebuildability.

### D4 — Interaction links hand work to the existing owners

Issue Detail gains explicit, ordinary links to Store Operations (Run/Session inspection and
controls) and Unlinked Changes (association work). Board cards continue to enter Detail, now at the
relevant provenance anchor when a state/evidence affordance is used. No Issue page sends a mutation.

The page does not manufacture a per-Change Task-detail link. A projected target line is display data,
and project id + Change alias does not prove the exact rooted member selector needed for Run/detail
control. Operators enter Store Operations, whose g-002 data retains that selector. Likewise, the UI
does not narrow ambiguous Change attribution by target line.

These existing g-002 decisions remain verbatim regression fences:

- **Dialog operations must freeze owner selector, entry, and confirmation facts before asynchronous
  work.**
- **Aggregate updates must validate both Store ownership and exact member selector; project id alone
  is insufficient.**
- Frozen project + alias is the only Change-attribution authority; target line is display-only.
- Last-known-good is isolated by full Store and exact member selector.
- Polling derives from filtered visible data.

g-003 does not alter the dialogs, aggregate update logic, or polling, but the full UI suite and
focused route tests guard these seams during navigation cleanup.

### D5 — The roadmap §11 disposition is replacement, with explicit orphan deletion

The selected §11 option is **replace the old Store Board after the new Issue Board is available**.
It is applied as one patch, not a staged mixed navigation:

- `BoardPage` remains for project routes and loses Store member chips, Store-wide Session fetch
  assumptions, and Store-only branches/tests.
- `RunningSessionsMenu` is removed from `Layout`, then its source, exclusive test, styles, and locale
  keys are deleted. Store execution lives in Operations; project live indicators and controls live
  in project Board/Task Detail.
- `StoreIssuesView` and `StoreAggregateBoard` plus their exclusive tests/styles/locale keys are
  deleted. Their raw API contracts are not deleted merely because these components disappear;
  active consumers and public management contracts are resolved by a reference sweep first.
- Store Board/Task routes redirect without importing or mounting the superseded components.

An explicit `rg` production/test/locale/style inventory before and after deletion proves the three
deleted component names and the Store branches of `BoardPage` have no navigable/imported duplicate.
The final app route and navigation matrix is asserted both positively and negatively.

Alternative rejected: retain the old Store board under an “experimental” or “diagnostics” label.
Operations and Unlinked Changes now own those diagnostics from evidence-backed contracts; retaining
the old aggregate would preserve two visible interpretations of the same Store work.

### D6 — Completion evidence uses the real component and real evidence boundaries

Automated UI tests cover deterministic behavior; a reproducible dogfood receipt covers the complete
browser line:

1. Build the root and `@atelierai/rasen-ui` production assets.
2. On a disposable real-Git Store/execution fixture, start the real management server/UI, navigate
   with a browser through Store Issues → Detail → Operations → Unlinked Changes, and record the
   authenticated HTTP inputs and normalized state-bearing DOM.
3. For every rendered state provenance link, prove its fragment resolves to exactly one provenance
   entry carrying a `git` or `runtime` kind and at least one exact payload locator/fingerprint.
4. Clear localStorage, sessionStorage, Cache Storage, IndexedDB databases, and any service-worker
   registration in that origin; remount/reload; require fresh projection/attention requests and
   compare the normalized state/provenance DOM digest with the pre-clear digest while evidence is
   unchanged.
5. Mutate only the disposable fixture's committed evidence and reload to prove the view changes
   without an invalidation call. Real-Git fixture work remains serial on Windows.
6. Repeat the navigation/provenance capture read-only against `issue-registry`; hash all tracked
   Store bytes and record HEAD before/after. This is evidence, never a CI dependency.

Normalization includes state text, hrefs, anchor ids, source kinds, and locator text; it excludes
ephemeral auth tokens and browser-generated ordering noise. Receipts live under this change's
`evidence/` as JSON plus a concise markdown index. Any screenshot is corroborative, not the truth
source.

Alternative rejected: prove rebuildability only with mocked API calls. Component tests are valuable,
but they do not cover built assets, browser storage, real routing, or the management HTTP boundary.

### D7 — Test and integrity gates match the changed risk

- Pure route-helper matrix: opaque ids (including colon and percent-escaped tokens), project/store
  homes, common-section preservation, Store→Store-only preservation, Store→project fallback, and
  legacy redirects.
- Real `preact-iso` same-component transitions: Board Store A→B, Detail Store/Issue A→B, late promise
  resolution, and selector-keyed remount/filter reset.
- App/Layout/Bootstrap/Switcher/Spaces/create-flow route and active-nav coverage; explicit absence of
  `/p/.../issues|operations|unlinked-changes`, Store Board nav, Store Task Detail, and header running
  menu; explicit preservation of project Board/Task Detail.
- Provenance resolution and verbatim locator tests over the distilled real g-001 payload, including
  unreadable/missing evidence and Windows/POSIX locator strings.
- Existing Operations/Unlinked/Task Detail suites plus the full UI package to guard g-002 ownership,
  dialog, last-known-good, and polling seams.
- `pnpm run build`, `pnpm --filter @atelierai/rasen-ui test`,
  `pnpm --filter @atelierai/rasen-ui build`, and
  `node bin/rasen.js validate issue-board-cutover`; strict UTF-8, JSON parsing, BOM/U+FFFD/mojibake,
  trailing whitespace, `git diff --check`, version/frozen-path checks, and a production reference
  sweep. Root full-suite ownership remains with LEAD/CI unless implementation evidence expands risk.

## Risks / Trade-offs

- **Existing Store Board bookmarks lose their selected Change/Task context** → explicit
  replace-redirects land at Issues or Operations and never guess an exact Change/Run; project links
  are unchanged.
- **A route helper change can strand common pages or create `/p/` dead links** → one pure matrix owns
  all home/switch decisions, and negative app tests enumerate every forbidden mirror.
- **Provenance grouping could accidentally become another derivation** → entries only copy named
  payload fields; no axis or association calculation is admitted; fixture assertions compare every
  locator verbatim.
- **Deleting orphan presentation assets may remove a still-shared key/class** → inventory each name
  and delete only zero-reference assets; client/server API types are retained when any contract or
  consumer remains.
- **Browser cache APIs differ by engine** → the receipt enumerates available stores, clears each
  supported store, records unsupported APIs explicitly, and the source-level no-cache/no-storage
  sweep remains a separate invariant.
- **Live runtime evidence may change during a before/after DOM comparison** → equivalence uses a
  quiescent fixture; a separate controlled mutation receipt proves freshness.

## Migration Plan

1. Land selector-keyed Issue state owners and provenance/inter-surface links behind the existing
   Store routes; run focused component tests.
2. Land the pure type-aware home/switch helpers and update every launch/root/list/create/switch
   caller; add explicit legacy Store redirects and route-matrix tests.
3. Remove Store branches from `BoardPage`, remove `RunningSessionsMenu`, and delete the two orphan
   Store components with their exclusive assets after the reference inventory is clean.
4. Run the complete UI/build/validation/integrity gates and record disposable-fixture plus read-only
   `issue-registry` completion receipts.

Rollback restores the prior UI routes/components only; no server schema, persistent Store, Issue
revision, Run record, or migration changes exist to roll back. Legacy redirects make rollout
forward-compatible for existing bookmarks.

## Open Questions

None. The canonical route matrix, §11 disposition, evidence model, and ownership boundaries are
fixed for implementation.
