## Why

Batch 1 (`rasen-ui-slice1-readonly-api`) shipped a hidden `rasen ui` command whose server already serves both the management endpoints and the config endpoints — yet users still face two coexisting web surfaces: `rasen config ui` (config-only server, config page at `/`) and the hidden `rasen ui` (board at `/board`, no in-UI navigation between views). Two entry points to one product confuses users and doubles the launch-flow code (`openInBrowser` and the whole launch sequence are literal copies between `src/commands/config.ts` and `src/commands/ui.ts`). This batch converges them into one management platform: `rasen ui` becomes the public, sole entry point, and the config page becomes one of its views.

## What Changes

- `rasen ui` is promoted from hidden/experimental to a public, documented command: it appears in `rasen --help`, and its landing page is the board (the platform home at `/`).
- `rasen config ui` becomes a deprecated alias: it launches the same unified management server, opens the config view directly, and prints a one-line deprecation notice pointing at `rasen ui`. All its flags (`--port`, `--no-open`), error behavior, and every `/api/v1/config*` contract (paths, auth, error-code semantics) are preserved.
- The server composition is made explicit: the unified server assembles two route groups — the management route group (`/api/v1/{status,changes,runs}`) and the existing config route group (everything else, including static assets) — instead of the management router privately delegating leftovers. `src/core/config-api/router.ts` and its tests are not modified.
- The duplicated launch flow (port validation, token mint, server start, URL print, `openInBrowser`, signal-driven shutdown) collapses into one shared launch module used by both commands.
- The UI gains a unified shell: shared Layout navigation with Board and Config entries; routes `/` (board, platform home), `/board` (alias), `/config` (config page, which keeps its gates-inventory section as shipped in c6c5004). This closes batch 1's known-open m2 (no in-UI navigation to the board).
- Batch-1 known-opens folded in: m4 (each board load resolved the project home twice — once per endpoint; now resolved once and cached at the server layer, with null results re-probed so a mid-session project registration is still picked up) and t1 (`/api/v1/status/` with a trailing slash fell through to the config router's 404; management paths now tolerate a trailing slash).

## Capabilities

### New Capabilities

None — this change converges existing capabilities; no new spec is introduced.

### Modified Capabilities

- `management-ui-command`: `rasen ui` is no longer hidden — it is the public management-platform entry point, listed in help, landing on the board at `/`; the "config command untouched" guarantee is superseded by the alias behavior below.
- `config-ui-command`: `rasen config ui` becomes a deprecated alias that launches the unified management server and opens the config view, preserving flags, error behavior, and clean shutdown, and printing a deprecation pointer to `rasen ui`.
- `config-ui-package`: the platform shell's navigation now offers Board and Config (config page is no longer the sole module); the re-launch notice names `rasen ui` as the way to get a fresh session.
- `board-ui`: the board is the platform home (`/`) and is reachable from the shared navigation (closes m2).
- `management-http-api`: management endpoint paths tolerate a trailing slash (t1) instead of falling through to a 404 from the config route group.

## Impact

- **Code**: `src/commands/ui.ts`, `src/commands/config.ts` (the `config ui` action only), a new shared launch module under `src/commands/`, `src/core/management-api/{router,server}.ts` (route-group assembly, path normalization, cached home resolution), `src/cli/index.ts` (help visibility). UI package: `packages/ui/src/app.tsx` (routes), `packages/ui/src/components/Layout.tsx` (navigation), `RelaunchNotice.tsx` (wording).
- **Not touched**: `src/core/config-api/router.ts` and its test surface; the `/api/v1/config*` wire contracts; identity headers (`x-rasen-daemon`/`x-rasen-pid`); read-only semantics; loopback + bearer auth; the `getActiveChangeIds` enumeration definition (both SHALL NOTs in `management-http-api` and `board-ui` stand).
- **Out of scope**: daemon residency (detach, adopt-or-spawn, background schedulers) — slice 3; write paths / task submission — slice 2; `packages/daemon` extraction.
- **Compatibility**: the CLI is published as `@atelierai/rasen` 0.1.x; `rasen config ui` keeps working (alias) so no user-facing removal in 0.1.x. Session URLs carry a per-session token minted at launch, so no durable bookmarks or deep links exist to break when entry paths change.
