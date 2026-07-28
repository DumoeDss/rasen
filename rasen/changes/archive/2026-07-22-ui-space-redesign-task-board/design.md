## Context

The board (`packages/ui/src/components/BoardPage.tsx`) fetches `listChanges(selector)` + `listRuns(selector)` and renders one card per active change, placed into four lifecycle columns by the pure `deriveColumn` (`packages/ui/src/board/columns.ts`). Child 2 threaded the route's space selector through every call via `useSpace()` (`store/use-space.ts`) and placeholder-wired `/p|s/:id/task/:changeName`. The redesign's unit is the **Task**, not the change (planning-context §Decisions 6/7):

- A **portfolio** is a change directory with a `planning-context.md` whose children exist as `<parent>-<slice>` sibling changes. It is one Task; its children are the constituent changes. Critically, the portfolio parent directory holds **no `proposal.md`**, so `getActiveChangeIds` excludes it and it never appears in `/api/v1/changes` — the UI sees only the child changes, with no signal they belong together.
- A **bare change** with no portfolio container is an implicit single-item Task — zero ceremony, no wrapper (Decision 7).
- Task status is **purely derived**, never a new persisted field (Decision 7). Cards are **not draggable** — a read-only status-grouped view, not a kanban (Decision 6).

A store space (child 1) resolves to ONE central planning root; member repos externalize their planning there via a `store:` pointer, so `/api/v1/changes?space=store:<id>` reads the store's own `rasen/changes/`. There is no per-change member attribution field anywhere on disk — members are the reverse-enumerated pointer repos in `GET /api/v1/spaces`'s `members[]`.

Red line (Decision 10, inherited): the daemon is a reader + process launcher; Task/space semantics derive from `rasen/` workspace files; the UI writes nothing but the URL. Any server change here must be additive, read-only, and introduce no persistent state.

## Goals / Non-Goals

**Goals:**
- Group the space's active changes into Tasks: portfolio containers as one Task with nested children, bare changes as single-item Tasks.
- Place each Task in one of the four unchanged lifecycle columns by deriving from its children (portfolio) or its one change (single) — no new persisted status.
- Task cards: child/task progress, a `⦿` live-run indicator + current stage, an escalation badge, and a link to the Task detail route.
- In a store space, a member chip row (All rollup + per-member) fed by `members[]`.
- Fix child 2's carryover: a new change from any board lands in the currently viewed space.

**Non-Goals:**
- The Task detail page (child 4) — this child only links to its already-placeholdered route; it does not touch the route table's shape.
- The Archive page and Done-column truncation (child 5).
- A durable store-change→member authoring convention (see D4 limitation); any registry schema change; any version bump.
- Config-page concerns; drag/reorder; any write path other than the already-existing `createChange` bridge.

## Decisions

### D1 — Grouping split: the server reports portfolio *membership*; the UI does grouping, column placement, and rendering

The one fact the UI cannot compute from the flat change list is portfolio membership, because recognizing a portfolio requires reading the filesystem for `planning-context.md` — and the parent directory is invisible to `/changes`. A pure name-prefix heuristic is not safe: `store-add-project` and `store-project-namespace` share the `store-` prefix but are unrelated changes with no `store/` container, so name-only grouping would fabricate a phantom "store" Task. Therefore the server computes membership authoritatively and reports it; everything else stays UI-side.

**Server (`changes.ts`, additive):** after building the flat `changes[]`, enumerate sibling directories under `<root>/rasen/changes/` that contain a `planning-context.md` (the portfolio *containers*). For each active change `C`, attach `portfolio: P` where `P` is the **longest** container name such that `C === P` or `C.startsWith(P + '-')`. `ChangeSummary` gains an optional `portfolio?: string` (present only when a container matches). Longest-prefix handles the (unlikely) nested-portfolio case deterministically and correctly resolves `ui-space-redesign-*` to `ui-space-redesign`. This mirrors `hasRunFiles`: a filesystem-derived fact reported per change, not a column or a grouping. Read-only; enumerating directories mints nothing.

**UI (`columns.ts` + `BoardPage`):** group `changes[]` by `portfolio`. Changes sharing a `portfolio` value → one portfolio Task (`id` = `label` = that container name, `kind: 'portfolio'`, `children` = the grouped changes). Each change without a `portfolio` → its own single-item Task (`id` = `label` = the change name, `kind: 'single'`, `children` = `[thatChange]`). Column policy stays where the codebase already keeps it (`columns.ts`'s own header: "Column assignment is UI policy, not a wire field").

*Alternatives rejected:* (a) server-side grouping that nests children and emits a `tasks[]` envelope — duplicates the `changes[]` list, moves column policy server-side against the existing architecture, and is a larger, less-additive wire change. (b) UI-only name-prefix grouping with no server change — fabricates phantom Tasks from coincidental prefixes; the UI genuinely lacks the `planning-context.md` signal. (c) parsing a Task title from `planning-context.md` — scope creep; the container directory name is the Task label for this child, and child 4 (which has the parent dir) can enrich it.

### D2 — Task model and column aggregation

New in `columns.ts`:

```ts
export interface Task {
  id: string;                 // portfolio container name, or the bare change name
  label: string;              // same as id for this child
  kind: 'portfolio' | 'single';
  children: ChangeSummary[];  // ≥1; a single Task has exactly one
  column: BoardColumn;        // derived, D2
  escalated: boolean;         // any child's run escalated
  progress: { done: number; total: number };
  liveStage?: string;         // set when a live session targets a child (D3)
}
```

`deriveTaskColumn(children, runsByName)`: run the existing `deriveColumn(child, run)` per child, then aggregate by precedence (planning-context §Decision 6, formalized to a coherent terminal):

1. any child column `in-progress` → **In Progress**
2. else any child column `ready` → **Ready**
3. else any child column `planning` → **Planning**
4. else (every child `done`) → **Done**

This honors Decision 6's stated order (In Progress > Ready > Planning) and makes Done the terminal reached only when no child is still planning/ready/in-progress. A portfolio with `[done, planning]` → Planning (there is more to plan); `[done, ready]` → Ready; `[in-progress, planning]` → In Progress; `[done, done]` → Done. A single-item Task's column is just its one change's `deriveColumn` result (the aggregation degenerates to it). `escalated` = OR of each child's `deriveColumn().escalated`. Kept pure (no DOM, no fetch) exactly like `deriveColumn`, so it is unit-testable.

`progress`: for a portfolio, `total` = children currently on the board, `done` = children whose `deriveColumn` column is `done`. For a single Task, `progress` = the change's own `taskProgress` (checkbox counts). The card label distinguishes them: "N/M changes" vs "N/M tasks". **Limitation (documented, not a bug):** archived children have left `/changes`, so a portfolio's `total` counts only active children — a portfolio one archive away from complete reads "2/3 changes", not "2/8". The full roster (active + archived) needs the archive listing (child 5) and the parent-dir read (child 4); surfacing it here would pull in child 5's scope. Flagged as a finding for child 4.

### D3 — Live-run indicator and current stage from live sessions, not run files

`hasRunFiles`/run-state persists after a run ends, so it cannot mean "running now". The authoritative "something is running for this Task right now" signal is a **live session** (`state ∈ {starting, running, exiting}` — the existing `LIVE_SESSION_STATES`). `BoardPage` therefore fetches `listSessions(selector)` alongside changes/runs (the same call child 2's header dropdown makes). A session maps to a Task via the change it targets: `session.changeName` → the change → its Task (by `portfolio` membership, or the bare-change identity). A Task shows `⦿` when ≥1 live session maps to one of its children; `liveStage` is that session's current stage, taken from its joined `runState` when `ok` (pipeline/stage — the shape child 2 already renders), else the raw `session.task`. A `changeName`-less `auto` session (no change yet) maps to no Task and is invisible here — consistent with child 1's `runState:absent` join and child 2's header (which shows it in the count without a task link).

### D4 — Store member chips: rendered from `members[]`, filtered by session provenance

In a store space (`useSpace().type === 'store'`), the board renders a chip row: `All` (default, the full rollup) plus one chip per entry in the store space's `members[]` (from `GET /api/v1/spaces`, which `BoardPage`/`MemberChips` fetches once). Project spaces render no chip row.

Filtering a central store board by member needs a change→member link, and **none exists on disk** — a store centralizes planning and no change records an owning member. The only file-derived link is **session provenance**: a session's `cwd` is the physical member repo it ran in (planning-context §Decision 5: session → cwd → space). So a Task is attributed to member `M` when it has a live-or-listed session whose `cwd` is under `M.root` (canonical path prefix). Selecting a member chip keeps only Tasks attributed to it; `All` shows every Task. This reuses the `listSessions` data D3 already fetches, adds **zero** new server state, and respects the red line (attribution is derived from session records, themselves derived from cwd).

**Limitation (documented):** a Task no session has ever run for is unattributed and appears only under `All` — a purely-planning change nobody has executed yet is not yet linkable to a member. This is honest and self-correcting (the first run attributes it), and it is the correct ceiling given the data model. A durable store-change→member convention (e.g. authoring metadata recorded at change creation) is a future concern, explicitly out of scope and flagged as a finding.

*Alternatives rejected:* (a) member chip navigates to the member's own project space — members externalize planning to the store, so a member's own board is empty; a dead end. (b) a new server field attributing each store change to a member — there is no source of truth for it on disk, so the server would have to invent one, violating "derive from files, no new state." (c) omit chips entirely — the prompt and Decision 5 make the chip row this child's responsibility; render it with the achievable session-provenance filter and document the ceiling.

### D5 — New-change submission is space-scoped (carryover fix)

`NewChangeDialog` takes a `space?: string` prop (the current `useSpace().selector`, passed by `BoardPage`) and includes it in `client.createChange({ name, description, space })`. `SubmitChangeRequest.space` already exists (child 1) and the server already resolves the body `space` before spawning the CLI (`router.ts` — an unresolvable selector rejects before any subprocess). Omitting it (no space route — impossible on a mounted board, but safe) preserves the launch-project fallback. This is pure UI wiring; no server change.

### D6 — Board fetch and render shape

`BoardPage` fetches three space-scoped calls in parallel — `listChanges`, `listRuns`, `listSessions` — re-fetching on `selector` change (the effect dep already keyed on `selector`). It then: groups changes into Tasks (D1), places each Task by `deriveTaskColumn` (D2), computes `⦿`/`liveStage` and member attribution from sessions (D3/D4), and renders columns of **Task cards**. A new `TaskCard` renders label, progress, `⦿ liveStage`, the escalation badge, and wraps the card in a link to `spaceHref(space, 'task', task.id)`. `BoardColumn`/`BoardColumnEntry` shift from carrying a `change` to carrying a `Task` (or a thin `TaskColumnEntry`); the per-change `BoardCard` is either folded into `TaskCard` or retained for the broken-change list. The existing broken-change section (`errors[]`) is unchanged — a change that failed to load is not a Task and stays in its own list.

### D7 — Opaque-token discipline (inherited, D5 of child 1/2)

Every intra-space link is built only via `spaceHref(space, section, sub?)` from `store/use-space.ts`; the id after `project:`/`store:` is never re-derived, normalized, or path-canonicalized. The Task detail link's sub-segment is `task.id` (the portfolio container name or the bare change name), which `spaceHref` `encodeURIComponent`-guards. Member-root comparison for D4 attribution uses canonical path prefixing on the session `cwd` and `member.root` (both server-emitted, already canonical) — this is a path comparison, not a space-token transform, so it does not violate the token rule.

## Risks / Trade-offs

- **[Longest-prefix portfolio detection mis-groups a change that legitimately starts with a container's name but is not its child]** → the container must be a real directory with `planning-context.md`; a change `foo-bar` is grouped under container `foo` only if `foo/planning-context.md` exists AND the name is `foo` or `foo-…`. A standalone `foo-bar` with no `foo/` container stays a single Task. Deterministic and testable.
- **[Portfolio progress undercounts archived children ("2/3" not "2/8")]** → documented in D2; the active board honestly reflects active work, and the full roster is child 4/5's surface. Flagged as a finding.
- **[Member attribution is session-provenance-only; planning-stage Tasks are unattributed]** → documented in D4; `All` always shows them; the filter is best-effort and self-correcting. Not a regression (there is no chip filter today at all).
- **[Extra `/sessions` fetch on every board load]** → one added parallel call, same cadence as changes/runs, already space-scoped and cheap; child 2's header already polls it. No new endpoint.
- **[Server `portfolio` field is a wire addition]** → optional and additive; the UI mirror (`api/types.ts`) falls back to "no portfolio → single Task", so a UI newer than the CLI (or vice versa) degrades to today's flat behavior, never crashes — same forward-compat posture as `errors[]` (child 1 review N2).
- **[board-ui / management-http-api archive-order collision]** → this child ADDs the portfolio requirement to `management-http-api` (child 1 modified "Changes listing") and modifies only `board-ui`'s change-submission requirement (child 2 modified only "Board is the platform home"); no two unarchived deltas touch the same requirement. Reconcile-at-archive note carried in the proposal.

## Open Questions

None blocking. Whether `BoardCard` is folded into `TaskCard` or kept for the broken-change list, and the exact module split between `TaskCard.tsx`/`MemberChips.tsx`, are implementer-level choices bounded by D6. A durable store-change→member attribution convention (beyond session provenance) is deferred to a future change, not resolved here.
