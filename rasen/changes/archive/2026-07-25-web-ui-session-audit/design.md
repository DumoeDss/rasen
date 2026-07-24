## Context

Rasen already has the complete local audit engine in `src/core/token-audit/`: `runAudit()` accepts a Claude transcript/session id, a Codex rollout/thread id, or a Zed database/thread id, produces the discriminated `rasen-token-audit/2` report, and writes it under the machine data directory's `analytics` folder by default. `viewer/audit.html` renders every supported runtime and older compatible reports, but it is a standalone monolithic page whose only inputs are a report file or `?src=`.

The management UI is a Preact application served by the loopback-only management server. Its API calls pass through one bearer-authenticated client seam. Space-scoped pages live below `/p/:id` or `/s/:id`, while user-wide capabilities such as Workflows and Profiles have global routes. Audit data is machine-wide, not owned by a planning space.

This change crosses the audit core, management HTTP API, static viewer, and UI. It must preserve Windows/macOS/Linux path behavior, avoid turning localhost into an arbitrary-file-read API, and coexist with unrelated changes already present in the worktree.

## Goals / Non-Goals

**Goals:**

- Make recent auditable sessions discoverable and runnable from one global Audit page.
- Accept a user-granted local file as either an audit source (`.jsonl`, `.db`, `.sqlite`) or an existing `rasen-token-audit/*` JSON report.
- Treat valid reports in the resolved Rasen `analytics` directory as the durable result inventory and support fast switching between them.
- Reuse `runAudit()` and the existing runtime-aware viewer instead of defining another audit schema or chart implementation.
- Keep every sensitive operation bearer-authenticated, loopback-only, bounded, and restricted to known session stores, the analytics directory, or browser-uploaded bytes.
- Keep the management UI responsive enough to show progress, errors, and retries while analysis runs.
- Prioritize the audit visualization's usable width through a wide page shell and a collapsible saved-results rail, without sacrificing report switching, accessibility, or narrow-screen usability.

**Non-Goals:**

- Changing audit accounting, pricing, churn/rebuild classification, report schema, or CLI syntax.
- Uploading any session/report to a remote service.
- Editing or deleting saved reports from the first Web UI iteration.
- Watching session stores or `analytics` continuously; explicit refresh and refresh-after-audit are sufficient.
- Reconstructing an imported Claude transcript's missing sibling `subagents/` tree. A single imported transcript is analyzed honestly as the material the user granted; native discovered sessions retain full-family discovery.
- Replacing the standalone viewer or removing its offline file-drop/`--open` entry points.

## Decisions

### D1. Audit is an installation-wide route

Add `/audit` beside `/workflows` and `/profiles`, with a permanent Audit navigation item. It does not carry a project/store selector because the native session stores and `~/.rasen/analytics` are user-wide. The existing recent-space fallback continues to keep space-scoped navigation reachable while the user is on `/audit`.

Alternative considered: put Audit below each space route and restrict discovery to that space. This would hide sessions whose recorded working directory cannot be mapped to a registered space and would incorrectly imply that saved analytics belong to a project.

### D2. One audit service owns discovery, execution, imports, and saved reports

Add a token-audit-facing service behind the management router, rather than placing filesystem scans and `runAudit()` calls directly in route branches. The service exposes four operations:

1. discover recent native sessions,
2. list/read saved reports,
3. run a native session by runtime plus exact id,
4. accept and classify an uploaded file.

The HTTP surface is:

- `GET /api/v1/audits/sessions?limit=<n>` — recent native sessions plus per-runtime availability diagnostics;
- `GET /api/v1/audits` — saved report descriptors, newest first;
- `GET /api/v1/audits/<report-id>` — one descriptor plus its report;
- `POST /api/v1/audits` with JSON `{ runtime, sessionId }` — audit one discovered native session;
- `POST /api/v1/audits/import` with raw file bytes and a URI-encoded basename header — import/analyze a browser-selected file.

Both POST forms return the same detail response as GET detail, so the client can render immediately and then refresh the inventory. The server admits one audit execution/import at a time and answers competing work with a retryable `409 audit_busy`; listing and reading remain available.

Alternative considered: make the UI spawn `rasen agent audit`. Calling the core service avoids CLI-output parsing and keeps one authoritative error/report contract. Audit computation should run in a worker execution boundary so its synchronous transcript parsing does not freeze the HTTP loop; this worker still invokes the same `runAudit()` code and writes the same report.

### D3. Recent-session discovery resolves opaque ids inside known runtime stores

Create reusable discovery records with `runtime`, exact `sessionId`, display label, start/updated timestamps, optional working-directory/title hint, and auditability. Discovery reads only established runtime locations using existing helpers/constants:

- Claude: top-level main transcripts below the Claude projects store, excluding subagent files;
- Codex: main, non-fork rollouts from the active/archived session stores using rollout metadata;
- Zed: root threads from the default per-platform `threads.db`.

Results are globally sorted newest-first and capped server-side. A missing/unreadable runtime store becomes an `unavailable` diagnostic for that runtime rather than failing the entire response. The client submits only `{runtime, sessionId}`; the server resolves that exact id again within the same known store. It never accepts a discovered-session filesystem path from the browser.

Alternative considered: return transcript paths as selectable values. That would make the browser round-trip a privileged local path and create a path-tampering surface.

### D4. The analytics directory is the result index

Resolve the directory through `getGlobalDataDir()` and `path.join(..., 'analytics')`; never spell `~`, assume separators, or bind it to the launch project. Listing examines direct, regular `.json` files only, skips symlinks/directories, validates the `rasen-token-audit/` schema and required session discriminator, and returns stable ids derived from the exact basename. Descriptors include report id, runtime, session id/title, generated time, session start/end, agent/thread count, and file modification time. Invalid files are omitted and summarized as a skipped count rather than crashing the page.

Detail lookup percent-decodes exactly one segment, requires the listed basename form, resolves it beneath the analytics directory, rejects traversal/symlinks, re-validates the report, and reads fresh on every request. Native audits retain the existing default filename behavior. Imported valid report JSON is copied into analytics under a collision-safe generated basename and then participates in the same listing/detail flow.

Alternative considered: maintain a second index database. The files already are the durable source of truth, and an index would add synchronization and migration failure modes without improving the first iteration.

### D5. Browser imports grant bytes, never server paths

The page uses a normal file input/drop target and uploads raw bytes. Accepted source extensions are `.jsonl`, `.db`, and `.sqlite`; `.json` is accepted only when it validates as a supported audit report. A dedicated streaming body reader enforces an explicit 256 MiB cap before or during upload. The transmitted filename is reduced to its basename and used only for extension/type detection; temporary names are server-generated under the Rasen machine-data area.

Source uploads are written to a temporary file with the preserved safe extension, passed to `runAudit()`, and removed in a `finally` path. This keeps Codex/Claude format sniffing and Zed database handling intact. Imported single-file sources may not include otherwise undiscoverable sibling agents; the UI discloses this before analysis. Report JSON imports are validated and persisted without re-analysis.

Unsupported types, oversize bodies, invalid report JSON, transcript format drift, ambiguous/colliding ids, and audit failures use the standard `{error:{code,message,fix?}}` envelope. No request field can name an arbitrary server-side path.

Alternative considered: reuse `GET /api/v1/local-paths` and let the user type/select a server path. That endpoint deliberately supports absolute browsing for space creation and is too broad a permission model for reading transcript contents.

### D6. Embed the shipped viewer through a same-origin message bridge

Keep `viewer/audit.html` as the rendering authority. Add `?embed=1` behavior that hides its picker/header/footer chrome, signals readiness to its parent, and accepts a structured `{type:'rasen-audit-report', report, theme}` message only when:

- it is served over HTTP(S),
- `event.source === window.parent`, and
- `event.origin === window.location.origin`.

After the same schema check used by file loading, the viewer calls its existing `render()` dispatch. It posts a structured error back if rendering cannot start. Offline `file://`, drag/drop, `?src=`, theme toggle, and `--open` behavior remain unchanged.

The management server exposes the shipped viewer HTML at a fixed non-API asset route, and `AuditPage` embeds it in an iframe. The parent fetches reports with the bearer-aware API client and sends data only after the ready signal; it never places a token or sensitive report path in the iframe URL. Theme changes resend the selected report/theme.

Alternative considered: port the viewer's hundreds of lines of SVG/rendering logic into Preact. That would create two renderers for the same schema and guarantee drift. An iframe bridge preserves the proven runtime-aware visualization while allowing the Web UI to own selection and loading UX.

### D7. The Audit page uses a master-detail state model

The page has:

- a saved-results list sorted newest-first;
- recent-session controls with runtime/filter context and an Analyze action;
- a file import/drop action;
- a report pane containing the embedded viewer.

Initial load fetches the saved list and recent sessions independently. The newest valid report is selected only when no explicit selection is already active. Selecting a report fetches its detail and switches the renderer without rerunning analysis. Native audit/import sets an explicit indeterminate busy state, disables duplicate actions, renders the returned result, and refreshes both result/session lists afterward.

Each request owns its own loading/error/empty state, so a missing Zed database does not hide Claude reports and a failed new audit does not erase the currently selected report. Errors show the API message/fix and a retry action. Stale async responses are ignored after a newer selection.

### D8. Tests isolate filesystem, protocol, and rendering responsibilities

Core tests use temporary native homes and analytics directories, `path.join()` expectations, and fixtures for Claude/Codex/Zed/report imports. Router tests cover auth, methods, exact-path matching, traversal/symlink rejection, size/type failures, busy behavior, and standard error envelopes. UI tests mock the single API client and cover list selection, newest default, session analysis, imports, loading/errors/retry, partial runtime unavailability, and postMessage readiness. Viewer contract tests exercise standalone load behavior and same-origin embed acceptance/rejection for all runtime fixtures.

### D9. The report pane owns the Audit page's horizontal budget

Use a dedicated wide Audit page container rather than the shell's narrower reading-width container. Its maximum width should track substantially more of the viewport with small, responsive side gutters. The recent-session and import controls may continue to share the top row where space permits, while the saved-results/report region becomes a two-column layout whose report pane uses `min-width: 0` and whose iframe fills the available width.

The saved-results rail is expanded by default at normal desktop widths so saved-report switching remains discoverable. A native button in the rail header toggles it, keeps focus, exposes `aria-expanded` and `aria-controls`, and has a state-specific accessible name. When collapsed, the rail's list and notices leave layout flow and the report pane receives the reclaimed width; only the compact expand control remains. The user's toggle choice remains stable for the mounted page.

Below the responsive breakpoint, the rail starts collapsed to prioritize the report. Expanding it presents a full-width list above the report rather than squeezing two narrow columns together. The page and embedded viewer should not create horizontal scrolling at normal desktop widths; responsive sizing, wrapping, and the iframe's available-width contract are preferred over a page-level horizontal scrollbar. Exceptionally dense visualization internals may retain their existing bounded overflow only when they cannot be rendered legibly at the available width.

Alternative considered: permanently shrink the saved-results column or hide it on narrow screens. A permanent narrow column does not recover enough report width, while hiding it removes report switching. An explicit accessible disclosure preserves both functions and makes the width trade-off reversible.

## Risks / Trade-offs

- **[Large histories make discovery or listing expensive]** → cap recent-session results, read only metadata during discovery, sort by filesystem/database timestamps, and avoid loading full audit JSON until listing validation/detail requires it.
- **[A single imported transcript omits private sibling files]** → disclose the limitation and reserve full-family analysis for native discovered sessions; never imply an incomplete import is the full family.
- **[The iframe can expose report data to an unexpected receiver]** → use a fixed same-origin asset, exact origin/source checks, bearer-fetch in the parent, and no report/token in the URL.
- **[User-edited analytics files may be malformed or symlinked]** → list only validated direct regular files, reject symlinks/traversal, report skipped entries, and revalidate on detail read.
- **[Worker execution and native Zed access differ across packaged/dev builds]** → resolve the compiled worker/module by `import.meta.url` and cover both fixture-backed router tests and the packaged UI build smoke test.
- **[Import cap rejects unusually large transcripts]** → surface the exact cap and direct the user to `rasen agent audit <path>` as the no-upload fallback.
- **[Concurrent audit requests race on the same default output filename]** → serialize audit writes, return `audit_busy` for overlap, and refresh from the file source of truth after completion.
- **[Collapsing the saved-results rail can hide report-switching state or cause responsive layout shifts]** → keep a persistent labeled toggle, define desktop/narrow initial states, preserve focus/state during toggles, and test that the report pane reflows without page-level horizontal overflow.

## Migration Plan

1. Add discovery/result/import services and authenticated routes without changing the existing CLI or report format.
2. Add the viewer embed bridge and fixed viewer asset route while keeping every standalone path working.
3. Add the UI client/types/page/navigation and tests.
4. Build the UI package and run server, UI, audit-core, and CLI audit regression suites on fixture homes.

Rollback is additive: remove the `/audit` UI route and audit API routes/service, then remove the viewer embed bridge. Existing `rasen agent audit`, analytics files, and standalone viewer remain valid throughout and require no data migration.

## Open Questions

None for implementation. The 256 MiB import cap and recent-session default/cap should be constants covered by tests so they can be tuned later without changing the wire shape.
