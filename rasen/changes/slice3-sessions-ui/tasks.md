## 1. API seam (mirror + client)

- [x] 1.1 Add session mirror types to `packages/ui/src/api/types.ts`, copied field-for-field from `src/core/management-api/wire-types.ts` (SessionRecordWire, LaunchSessionRequest, SessionRunStateJoin, SessionListEntry, SessionsResponse, SessionDetailResponse, SessionActionResponse) with a header comment naming the source file — read-only mirror, no import
- [x] 1.2 Add `listSessions()`, `getSession(id)`, `launchSession(body)`, `killSession(id)` to `packages/ui/src/api/client.ts` through the existing `request()` wrapper (auth + ApiError narrowing untouched)

## 2. Sessions view

- [x] 2.1 Add the `/sessions` route and "Sessions" nav item in `packages/ui/src/components/Layout.tsx` + `app.tsx`, following the Board/Config active-check pattern
- [x] 2.2 Implement `SessionsPage.tsx`: list from `listSessions()`, 3s poll while mounted (interval cleared on unmount) merged with the nonce manual-refresh pattern; entries merged by session id (no duplicates from optimistic inserts); loading/error/empty states per the app's existing conventions
- [x] 2.3 Implement the session entry component: kind/task/state/timing facts; terminal facts (reason, exit code/signal) with reason-coded styling; pipeline progress rendered from a joined `ChangeRunEntry` with parsed `autoRun` (stage glyphs, current stage highlighted); honest "no linked change" note for `runState.kind === 'absent'`; invalid run-state shows its reason
- [x] 2.4 Implement expandable detail: fetch `getSession(id)` while expanded on the same cadence, render bounded stdout/stderr tails (preformatted, scrollable)

## 3. Kill and launch flows

- [x] 3.1 Kill flow: kill button on `starting|running` entries → inline confirmation (no browser `confirm()`) → `killSession(id)`; patch the entry to `exiting` from the 202 body and disable the button; polling carries it to `exited`/`killed`; 404 → treat as gone and refresh; entries never removed on kill
- [x] 3.2 Implement `LaunchSessionDialog.tsx` (NewChangeDialog conventions): kind choice (auto preselected | goal), task textarea (non-empty client check only), optional changeName input with the linkage hint; submit via `launchSession`; 201 → prepend session optimistically (merge-by-id); server 400/409/503 envelopes surfaced verbatim in-dialog; NewChangeDialog untouched
- [x] 3.3 Board indicator in `BoardPage.tsx`: compact live-session count (states starting|running|exiting) linking to `/sessions`; fed by `listSessions()` on board load, re-polled at 3s only while the last response had a live session; zero live sessions renders nothing prominent

## 4. Styles

- [x] 4.1 Extend `packages/ui/src/style.css` for the sessions list, state/reason badges, tails block, dialog, and board indicator — reuse existing tokens/patterns from the current theme (both themes), no horizontal page scroll on narrow widths

## 5. Tests and verification

- [ ] 5.1 Client tests: the four session calls hit the right method/path/body with auth headers, and shape-check fixture responses matching the settled contract (fixtures copied from wire-types shapes — loud failure on mirror drift)
- [ ] 5.2 Component tests: list renders live/exited/absent-join/invalid-join fixtures correctly; kill requires confirmation and patches to exiting from the 202 body; 404-on-kill refreshes without error noise; launch success prepends without duplication when the next poll includes it; launch error shows the server message
- [ ] 5.3 Polling tests: interval starts on mount and is cleared on unmount; detail polling only while expanded; board indicator polls only while a session is live
- [ ] 5.4 Footprint check: `git status`/diff shows every modified path under `packages/ui/` (the parallel-safety guarantee with the daemon sibling)
- [ ] 5.5 UI package suite green (`pnpm test` in `packages/ui`) and `rasen validate slice3-sessions-ui --json` passes
- [ ] 5.6 Live acceptance rehearsal against a real server (never port 8890; the sibling symlink/port note from the parent planning-context applies): launch an auto session from the UI, watch it live, kill it from the UI, confirm the entry reaches exited/killed and the board indicator drops — the roadmap's kill-reflected-on-board rule, end to end
