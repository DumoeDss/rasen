## 1. Server assembly and management router fixes (D2, D5, D6)

- [x] 1.1 Hoist the config-router delegation out of `src/core/management-api/router.ts` into `src/core/management-api/server.ts`: the server builds both route groups (`createRouter` from `config-api/router.js` unmodified, plus the management group) and dispatches by path; the management router handles only its own paths and returns a "not mine" signal (or the server consults the path set) instead of privately constructing the delegate. Identity headers stay stamped in the server before any routing.
- [x] 1.2 Normalize a single trailing slash on management-path matching (t1): `/api/v1/status/` ≡ `/api/v1/status`; deeper suffixes still fall through to the config group. Unit-test both the tolerated and the fall-through case.
- [x] 1.3 Move project-home resolution to server-lifetime state (m4, design D5): lazy read-only resolution (`ensure: false`), cached once resolved, re-probed while null; pass the resolved `ProjectHome | null` into `handleChanges`/`handleRuns` instead of resolving inside each handler. Test: two sequential board-load request pairs trigger exactly one successful resolution; a null result is re-probed on the next request.
- [x] 1.4 Run the existing management-api and config-api test suites unchanged to confirm no contract drift (config-api tests must pass without modification).

## 2. Shared launch module and commands (D1, D3)

- [x] 2.1 Create `src/commands/ui-launch.ts` exporting the shared launch flow (port validation, launch-project + UI-package resolution, token mint, `startManagementServer` with EADDRINUSE/invalid-port handling, URL print with configurable entry path, install hint, `openInBrowser`, SIGINT/SIGTERM shutdown), parameterized by entry path, printed label, and an optional notice line. `openInBrowser` lives only here.
- [x] 2.2 Rewrite `src/commands/ui.ts` as a thin wrapper: public command (drop `{ hidden: true }`), description naming it the management platform entry point, entry path `/` (URL `http://127.0.0.1:<port>/#token=...`), delete its private `openInBrowser` copy.
- [x] 2.3 Rewrite the `config ui` action in `src/commands/config.ts` as a thin wrapper over the shared launch module: unified management server, entry path `/config`, one-line deprecation notice naming `rasen ui`; delete `config.ts`'s private `openInBrowser` and its `startConfigApiServer` launch path. Keep the subcommand's registration, description, and flags in place.
- [x] 2.4 Update `test/commands/ui.test.ts` and `test/commands/config-ui.test.ts`: `rasen ui` visible in `--help`; both commands preserve `--port`/`--no-open`/invalid-port/EADDRINUSE behavior; `config ui` prints the deprecation notice and serves management endpoints (one origin, one token); config endpoint contracts asserted unchanged against the alias-started server.

## 3. UI shell and routes (D4, closes m2)

- [x] 3.1 Update `packages/ui/src/app.tsx` routes: `/` → BoardPage, `/board` → BoardPage, `/config` → ConfigPage, default → BoardPage.
- [x] 3.2 Update `packages/ui/src/components/Layout.tsx`: platform title ("Rasen"), navigation entries for Board (`/`) and Config (`/config`) with the active view indicated; keep the project switcher. Gates inventory stays inside the config page (design D4).
- [x] 3.3 Update `RelaunchNotice.tsx` (and any other user-visible copy naming `rasen config ui`) to name `rasen ui` as the re-launch command. Also updated `packages/ui/index.html`'s `<title>` from "Rasen Config" to "Rasen" (user-visible browser-tab title, in scope as "any other user-visible copy").
- [x] 3.4 Update/add UI package tests: added `test/app.test.tsx` (root route renders board, `/board` alias renders board, `/config` renders config page, nav offers both entries with `aria-current` on the active one, clicking the Board nav link from `/config` navigates without a full reload) and `test/components/relaunch-notice.test.tsx` (names `rasen ui`, not `rasen config ui`). Full `packages/ui` test suite (13 files / 88 tests) and `vite build` both green.

## 4. Docs, verification, and archive notes

- [x] 4.1 Update help text and any repo docs that reference the hidden status of `rasen ui` or present `rasen config ui` as the primary entry. Re-verified at implementation time: `grep -rln "rasen ui\|config ui\|Rasen UI\|Config UI" README.md docs/` — zero hits, confirming the planning-context research. Also found and fixed `src/core/completions/command-registry.ts` (not called out in planning-context): added a top-level `ui` entry (the shell-completion registry required parity with visible Commander commands — `rasen ui` un-hiding without a matching registry entry failed `test/core/completions/command-registry.test.ts`'s "matches visible Commander command flags and aliases" check) and updated the `config ui` entry's stale description.
- [x] 4.2 Full-repo verification: root `pnpm run build` (via `pnpm install`'s `prepare` hook) green; root test suite 149 files / 3051 tests green; both root and `packages/ui` `tsc --noEmit` clean; `packages/ui` build + tests green (see 3.4). Confirmed identity headers, 401 envelope, read-only semantics, and `getActiveChangeIds` enumeration untouched: no edits under `src/core/config-api/`, and `changes.ts`'s enumeration call (`getActiveChangeIds`) is unchanged — only its home-resolution plumbing changed (D5).
- [x] 4.3 Archive-time note: spec sync must re-check the main tree's `rasen/specs/config-*` state (concurrent sessions may have moved it since this worktree branched from dev/0.1.5 @ aeaf67a). No action taken here — recorded for the ship/archive step.

## Runtime verification (recorded per handoff instructions)

Ran the built CLI directly against the built UI package. `packages/ui` has no `node_modules` symlink into this worktree's root by default, so `resolveUiPackageDir()`'s sibling-directory probe (`src/core/config-api/ui-package.ts`) was satisfied with a temporary symlink:

```
ln -s /Users/sayo/repos/rasen-worktrees/rasen-ui-slice1-b2/packages/ui \
      /Users/sayo/repos/rasen-worktrees/@atelierai/rasen-ui
```

(`cliPackageRoot()` resolves to the worktree root; the probe looks for `<worktree-parent>/@atelierai/rasen-ui/dist`.) Removed with `rm -f .../@atelierai/rasen-ui && rmdir .../@atelierai` after verification.

With `packages/ui` built (`pnpm --dir packages/ui run build`):
- `node bin/rasen.js ui --port 8471 --no-open`: printed `Rasen UI: http://127.0.0.1:8471/#token=...`; `rasen --help` lists `ui` with the management-platform description; `GET /` returns the SPA shell (`<title>Rasen</title>`) with `x-rasen-daemon`/`x-rasen-pid` headers; the built JS bundle contains the "Board" nav label; `GET /api/v1/status` (bearer-authed) returns 200 with version/pid/project; `GET /api/v1/status/` (trailing slash) also returns 200 (t1).
- `node bin/rasen.js config ui --port 8472 --no-open`: printed the deprecation notice (`Notice: \`rasen config ui\` is deprecated — use \`rasen ui\` instead.`) followed by `Config UI: http://127.0.0.1:8472/config#token=...`; `GET /config` returns 200 (config view); `GET /api/v1/config` (bearer-authed) returns the config entries payload unchanged; `GET /api/v1/status` also answers on the same alias-started server (one origin, one token, management endpoints reachable through the alias).
