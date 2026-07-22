## Context

The UI shell today keeps the selected project in an in-memory pub-sub store (`store/project-store.ts`), seeded from `GET /api/v1/health` + `GET /api/v1/projects`, read by `ProjectSwitcher` and `ConfigPage` through `use-project-state.ts`. Nothing threads that selection into `listChanges`/`listRuns`/`listSessions`, so the board and sessions always answer for the daemon's launch project — the "switching does nothing" bug. Routing is flat (`app.tsx`): `/` and `/board` → board, `/config` → config, `/sessions` → sessions, default → board. Auth: `token.ts` reads `#token=` from the fragment at boot and scrubs it via `history.replaceState(null, '', location.pathname + location.search)` — critically, **`location.search` is preserved**, so a launch URL `…/?space=project:<id>#token=<t>` keeps `?space=` after scrub.

Child 1 (`ui-space-redesign-api-scope`, 8ba4dcf) is the server/CLI foundation this child consumes:
- **Space selector grammar** (`planning-space-addressing`): one prefixed token `project:<id|root>` | `store:<id>`; bare = 400 `invalid_space`; unknown = 404 `space_not_found`; unhealthy store = 409 `space_unavailable`; omitted = launch-project fallback.
- **`GET /api/v1/spaces`**: `{ spaces: [...] }` — project space `{ type:'project', id, name, root }`, store space `{ type:'store', id, name, root, members:[{projectId,name,root}] }`; dead roots filtered; store roots de-duped against project entries.
- **`GET /api/v1/changes|runs?space=<selector>`**, **`GET /api/v1/sessions?space=<selector>`** (filter), **`POST /api/v1/sessions`** body `space`.
- **`rasen ui`** emits `http://127.0.0.1:<port>/?space=<selector>#token=<t>` (query before fragment); no space → no `?space=`.

Locked portfolio decisions (planning-context, user-ratified): top level = planning space; URL is the source of truth; nav Board · Archive · Config; the switcher lists two type-tagged namespaces with no "No project" option; a running-summary dropdown in the header replaces the Sessions page; the daemon/UI red line holds — **the UI writes nothing but the URL** (navigation); all data reads flow through the single `client.ts` seam.

## Goals / Non-Goals

**Goals:**
- The URL fully determines the selected space: refresh, deep link, and each tab are independent; no shared mutable space state in module memory.
- Consume child 1's `?space=` launch URL and canonicalize it to a route once, so the address bar shows `/p/:id` / `/s/:id`, not the raw query.
- One dual-namespace switcher, fed by `GET /api/v1/spaces`, whose only side effect is navigation.
- One header running-run summary scoped to the current space, replacing both the board's live-sessions link and the top-level Sessions page.
- Generalize the client seam so every space-scoped call threads the route's selector, with zero behavior change when a selector matches today's launch project.

**Non-Goals:**
- Task grouping / four-column Task board / store member chips (child 3); the Task detail page (child 4); the Archive page + its listing API (child 5). Archive and Task-detail routes are wired to placeholders only.
- Config-page scope tabs and store-scoped config editing (a later Config concern); this child keeps `ConfigPage` a thin route-derived reader.
- Any server/CLI change (child 1 owns the API), any registry schema change, any version bump.

## Decisions

### D1 — URL is the source of truth; `?space=` bootstraps canonical `/p/:id` | `/s/:id` routes

Route table (preact-iso):
- `/` → `SpaceBootstrap` (resolves a space and redirects; never renders content itself).
- `/p/:projectId/board` and `/s/:storeId/board` → `BoardPage` (also the space root: `/p/:projectId` and `/s/:storeId` redirect to `…/board`).
- `/p/:projectId/config` · `/s/:storeId/config` → `ConfigPage`.
- `/p/:projectId/archive` · `/s/:storeId/archive` → placeholder (child 5).
- `/p/:projectId/task/:changeName` · `/s/:storeId/task/:changeName` → placeholder (child 4; the running dropdown links here).
- `default` → `SpaceBootstrap` (unknown path re-resolves rather than dead-ending).

**Bootstrap sequence** (`SpaceBootstrap`, run after `initTokenFromLocation`):
1. If `location.search` carries `?space=<selector>`, parse the prefix. `project:<rest>` → `route('/p/' + encodeURIComponent(rest) + '/board', true)`; `store:<rest>` → `/s/…`. Use `route(..., true)` (replace) so the `?space=` URL never becomes a history entry. The `rest` is used **verbatim as an opaque canonical token** (see D5) — no normalization.
2. Else `GET /api/v1/health`; if it carries a launch `project`, redirect to `/p/<project.id>/board`.
3. Else `GET /api/v1/spaces`; redirect to the first space (`/p` or `/s` by `type`).
4. Else (zero spaces) render an explicit empty state: "No planning space registered — run `rasen ui` inside a Rasen project." (not a spinner, not a crash).

Because the space lives only in the path, two tabs on `/p/a/board` and `/s/b/board` never interfere, and a reload re-renders the same space. `token.ts` is unchanged: it already preserves `location.search` through the scrub, so `?space=` reaches the bootstrap; the bootstrap's `route(replace)` then drops the query in favor of the clean path.

*Alternative rejected:* keep `?space=` as the live source of truth (no `/p/:id` routes). Rejected by the locked decision ("`/p/<id>`/`/s/<id>`; URL is the source of truth") and because a query param reads as ephemeral state, not a location — deep links and the switcher's "navigate to re-scope" model are clearer as paths.

### D2 — Space derived from the route via `useSpace()`; the pub-sub project store is retired

New `store/use-space.ts`: `useSpace()` reads the current route params (preact-iso `useRoute()`), returning `{ type:'project'|'store', id, selector } | null`, where `selector = \`${type}:${id}\``. `id` is the decoded route param; `selector` is what every API call and every intra-shell link is built from. A `null` return means "not on a space route" (only `/` and the empty state), so space-scoped pages always mount under a resolved space.

`store/project-store.ts` and `store/use-project-state.ts` are **deleted**. Their two consumers move to `useSpace()`: `ProjectSwitcher` (rewritten, D3) and `ConfigPage` (D6). This removes the last piece of shared mutable UI state; the redesign's whole point is that the route, not a store, is the space.

*Alternative rejected:* repurpose `project-store.ts` as a thin URL-derived read. Rejected — a store that only mirrors the route is a subscription with no state to subscribe to; `useRoute()` already re-renders on navigation. Deleting it is less surface.

### D3 — Dual-namespace space switcher; navigation is its only effect

`ProjectSwitcher` is rewritten (kept at its file for churn economy, or renamed `SpaceSwitcher` — implementer's call) into a two-group control fed by one `GET /api/v1/spaces` fetch: a **Projects** group (`type:'project'` entries) and a **Stores** group (`type:'store'` entries), each entry type-tagged and labeled by `name`. The current selection is `useSpace()` matched by `id` within `type`. Selecting an entry calls `route()` to `/p/<id>/<section>` or `/s/<id>/<section>`, where `<section>` is the current section (`board` | `config` | `archive`) parsed from the route — switching space keeps you on the same view, re-scoped. There is **no "No project (global only)" option**. Empty spaces list → a static hint, not a dropdown. The switcher writes nothing but the URL (red line).

Members are not shown here (store member chips = child 3); the switcher only needs top-level spaces, so it renders `spaces` and ignores `members`.

### D4 — Header `⦿ N running` dropdown: current-space live-run summary, links to Task detail

A new header component polls `GET /api/v1/sessions?space=<useSpace().selector>`, filters to live states (`starting|running|exiting` — the existing `LIVE_SESSION_STATES` set), and renders `⦿ N running` (hidden when N=0). Opening it reveals, per live run: task name (`session.task`), stage (`session.changeName` and, when the joined `runState` is `ok`, its pipeline/stage — reuse the existing run-state shape), and duration (`now − session.startedAt`, ticking). Each row links to the Task detail route `/p/<id>/task/<encodeURIComponent(changeName)>` (child 4's page; placeholder route here). It re-polls on the same idle-skipping cadence as today's `LiveSessionsIndicator` (poll only while ≥1 live) and re-subscribes when `useSpace().selector` changes (space switch resets the summary). This replaces `BoardPage`'s `LiveSessionsIndicator`, which is deleted.

Sessions with a `changeName` link to that task; a `changeName`-less `auto` run (no task yet) links to nothing actionable — it still shows in the count with its task text but without a task link, matching child 1's `runState:absent` join.

### D5 — Opaque space tokens; ids threaded, never re-derived (finding m1 + finding 3)

The `<id>` after `project:` / `store:` is treated as an **opaque canonical token** end to end: `SpaceBootstrap` copies it into the route param, `useSpace()` reads it back, and `client.ts` re-prefixes it (`?space=project:<id>`) when calling the API. The UI never normalizes, lowercases, or path-canonicalizes it — child 1's `handleSpaces` emits a project-space root as the raw registry key (finding m1) and the two `project:` namespaces are unrelated (finding 3); re-deriving client-side would risk addressing the wrong space. `rasen ui` and `GET /api/v1/spaces` both emit the id form (not a root path), so route params stay path-safe; `encodeURIComponent` guards any exotic id in the path segment, and `spaceQuery()` re-encodes for the query.

### D6 — Space plumbing: `spaceQuery()` generalizes `projectQuery()`; config stays thin

`client.ts`: replace `projectQuery(project)` with `spaceQuery(selector)` → `selector ? \`?space=${encodeURIComponent(selector)}\` : ''`. Thread an optional `space?: string` (a full `type:id` selector) into `listChanges`, `listRuns`, `listSessions`, and `launchSession` (the last as a body field `space`, not query). Omitting it preserves today's launch-project fallback exactly (child 1's compat contract), so any not-yet-migrated call is safe.

`BoardPage` reads `useSpace().selector` and passes it to `listChanges`/`listRuns` (re-fetch on selector change via the effect dep). No other board behavior changes — Task grouping and card redesign are child 3.

`ConfigPage` reads `useSpace()` instead of the deleted project store. Config still uses the config-api's own `?project=` param (child 1 did not move config onto `?space=`), so for a **project** space it passes the project id (works as before). Store-scoped config is **deferred** to the later Config child: on a store space, `ConfigPage` renders a "store configuration arrives with the Config redesign" notice rather than mis-addressing the store root as a project. This is deliberately minimal — the guardrail is to keep `ConfigPage` a thin reader, not to build scope tabs here.

### D7 — Nav restructure and Sessions removal

`Layout` nav: **Board** (`/p/:id/board`), **Archive** (`/p/:id/archive`), **Config** (`/p/:id/config`), built from the current space prefix (`useSpace()`), with active detection relative to that prefix (the existing `isActivePath` logic, applied to the space-prefixed section). The Sessions nav entry, the `/sessions` route, and the top-level `SessionsPage` mount are removed. `SessionRow` and `LaunchSessionDialog` are **retained** (child 4 reuses them in Task detail); `SessionsPage.tsx` itself is removed from routing (delete or park — it has no route). The header hosts the running dropdown (D4) and the switcher (D3).

## Risks / Trade-offs

- [`?space=` from `rasen ui` must survive token scrubbing] → verified: `token.ts` scrubs to `location.pathname + location.search`, preserving the query; `SpaceBootstrap` runs after `initTokenFromLocation` and consumes it. A test pins this ordering (launch URL with both `?space=` and `#token=` → lands on `/p/:id/board`, token still in memory).
- [Archive-order collision with the unarchived `sessions-ui` capability] → this child removes the top-level Sessions page whose requirement lives in `slice3-sessions-ui`'s unarchived `sessions-ui` delta; the `config-ui-package` MODIFY here re-asserts Board · Archive · Config. Proposal carries the reconcile-at-archive note (archive slice3/slice2 leftovers with the portfolio).
- [Store-space config is a stub this child ships] → intentional; flagged as a Config-child follow-up. A project space (the common case) is fully functional; a store space degrades to an explicit notice, never a wrong-target write.
- [Placeholder Archive/Task-detail routes look unfinished] → acceptable for a serial portfolio; the routes exist so nav and the running-dropdown links are live, and children 4/5 replace the placeholders without touching the route table's shape.
- [Opaque-token discipline is a convention the compiler can't enforce] → concentrated in three seams (bootstrap parse, `useSpace`, `spaceQuery`); a test asserts an id with mixed case / separators round-trips unchanged through route → API call.
- [Bootstrap does up to two extra fetches on a param-less `/`] → only when `?space=` is absent (rare — `rasen ui` always emits it); `health` is already cached-cheap and the path is a one-time redirect, not a render loop (guard against re-entry with `route(replace)`).

## Open Questions

None blocking. Whether the switcher file is renamed `SpaceSwitcher.tsx` or kept as `ProjectSwitcher.tsx`, and whether `SessionsPage.tsx` is deleted now or parked for child 4's Task detail, are implementer-level choices bounded by D3/D7.
