## Why

The sessions runtime (child 1, shipped) can launch, observe, and kill supervised agent sessions — but only over raw HTTP. The roadmap's slice-3 acceptance is explicitly a UI test: "kill a session and the board reflects it correctly", and the board is where users were promised running sessions would be visible. This change gives the management UI a sessions surface: see live runs with their pipeline progress, kill one with confirmation, and start an auto/goal run without opening a terminal.

## What Changes

- New Sessions view in the management UI (`packages/ui`): a third navigation destination listing every session the server knows (live and retained exited), each row showing kind, task, lifecycle state, timing, and — when the session targets a change — the joined run-state's pipeline progress (stage statuses from the existing typed shapes). A row expands to the detail (bounded stdout/stderr tails from the detail endpoint).
- Kill flow: a kill button per live session → confirmation → `DELETE /api/v1/sessions/:id` → the row shows `exiting` immediately (the 202 body) and reaches `exited` with reason `killed` via polling. Errors surface verbatim through the existing ApiError path.
- Launch flow: a launch dialog on the Sessions view — kind (`auto` | `goal`), task text, optional change name — posting `LaunchSessionRequest`; the 201 session appears in the list at once. The board's existing new-change dialog is untouched.
- Live updates: the Sessions view polls the list endpoint on a short fixed cadence (with the existing manual-refresh affordance kept); the board gets a lightweight running-sessions indicator linking to the Sessions view, so a kill is reflected on the board surface per the acceptance rule.
- API seam extension, mirror-style: `packages/ui/src/api/types.ts` gains hand-maintained mirrors of the settled session wire types (`SessionRecordWire`, `LaunchSessionRequest`, `SessionsResponse` = `{sessions:[{session, runState}]}`, `SessionDetailResponse` = `{session, tails}`, `SessionActionResponse` = `{session}`); `client.ts` gains the four calls. All launching/killing goes through the sessions API — the UI remains a shell with no parallel write path.

## Capabilities

### New Capabilities
- `sessions-ui`: the management UI's sessions surface — listing with live polling and run-state progress, session detail with output tails, the confirmed kill flow, the launch flow, board visibility of running sessions, and the shared API-seam/auth constraints it inherits.

### Modified Capabilities

(none — the board's existing requirements are unchanged; sessions visibility on the board is new behavior owned by the `sessions-ui` capability)

## Impact

- Affected code: `packages/ui/src/` ONLY — new `components/SessionsPage.tsx`, `components/SessionRow`/detail and `LaunchSessionDialog` components, `components/Layout.tsx` (nav item), `components/BoardPage.tsx` (running-sessions indicator), `api/types.ts`, `api/client.ts`, styles in `style.css`, tests alongside. **No file outside `packages/ui`** — this is the parallel-safety guarantee with the file-disjoint `slice3-daemon-residency` sibling.
- Consumes the wire contract exactly as settled in child 1 (`src/core/management-api/wire-types.ts` is the source the mirror copies); no server change is needed or permitted here.
- UI package version/publish is out of scope (versioning is the user's call); local verification via the worktree's own vite/vitest (`pnpm install` already run in `packages/ui`).
