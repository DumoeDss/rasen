# Proposal: unified-config-ui-pkg

## Why

`rasen config ui` (shipped by `unified-config-api`) starts a localhost config API and opens a browser — but no UI package exists yet, so every user lands on the built-in install-hint page. This change ships the optional web UI package itself: a separately-installed static bundle that turns the API into a visual config editor, and lays down the platform shell (routing, layout, typed API client) that future management modules plug into. It is the third and final child of the `unified-config` portfolio.

## What Changes

- New `packages/ui/` directory: a self-contained, separately-published npm package (working name `@atelierai/rasen-ui`, matching the CLI's `UI_PACKAGE_NAME` constant; the final published name is the user's decision) that builds to pure static assets under `dist/` with `dist/index.html` as the entry — exactly what the CLI's resolution and static-serving contract expects.
- The package is optional forever: CLI-only users lose nothing; every capability the UI exposes remains available via `rasen config` commands and the HTTP API.
- Platform shell with deliberate restraint: client-side routing skeleton, app layout (header with project switcher, navigation, content area), and a typed API client built against the config API's wire shapes — including the URL-fragment token handoff and uniform error envelope. No kanban/task/session-supervision state management is pre-built.
- Config page as the first shell module: keys grouped by registry group metadata, controls rendered from serialized `constraints` (boolean/enum/number/string), effective-value source annotations (default | global | project | env-override), scope-explicit writes and unsets, on-disk invalid-value `warnings[]` badges, and API error-code handling (including `invalid_scope`, `project_required`, `not_settable`).
- Zero config logic duplication: the UI never parses or writes config files; everything flows through `/api/v1/`.
- The UI package stays out of the root package entirely: no root `pnpm-workspace.yaml`, own lockfile, no entry in the root `files` whitelist (the `website/` self-contained precedent; rationale in design).
- CI: one new UI build job feeding the existing gate job — the cross-platform test matrix is not widened.
- Release dual-publish wiring is documented as a follow-up, not implemented here; this change is version-agnostic (version bumps are the user's call).

## Capabilities

### New Capabilities
- `config-ui-package`: the optional web UI package — its packaging/asset contract with the CLI, the platform shell (routing, layout, typed API client, token handling), the config page behavior, and its build/CI integration.

### Modified Capabilities

(none — the CLI-side serving/resolution behavior shipped in `config-ui-command` is unchanged, including the install-hint text; no existing spec's requirements change)

## Impact

- New code: `packages/ui/**` (package manifest, own lockfile, build config, source, tests). No changes to `src/` — the CLI-side contract (`src/core/config-api/ui-package.ts`, `static.ts`, `wire-types.ts`) is consumed as-is.
- CI: `.github/workflows/ci.yml` gains a `ui_build` job wired into the existing gate job's `needs`.
- Release: `.github/workflows/release.yml` untouched; dual-publish extension documented as follow-up in design.md.
- Root `package.json`, root lockfile, `flake.nix` (`pnpmDeps.hash`): deliberately untouched — keeping UI dependencies out of the root lockfile preserves the nix hash and the single-package root assumptions.
- npm: introduces a second publishable package name (user decision + user-executed publish; nothing in this change publishes).
