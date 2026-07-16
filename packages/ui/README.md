# @atelierai/rasen-ui

The optional web UI for `rasen config ui` — a visual editor for Rasen's
configuration, served by the CLI once this package is installed beside it.

This package is **standalone**: it is not part of a pnpm workspace with the
root `rasen` package (see `design.md` D1 of the `unified-config-ui-pkg`
change for why). Run every command from inside `packages/ui/`, not the repo
root — the root has no `pnpm-workspace.yaml` and does not know this package
exists.

## Commands

```bash
pnpm install
pnpm build       # -> dist/, with dist/index.html as the entry
pnpm test        # vitest
pnpm typecheck    # tsc --noEmit
pnpm dev          # vite dev server
```

## Dev workflow (talking to a real config API)

`vite dev` serves this package on its own dev port, so it can't reuse the
CLI's same-origin API the way the built package does. To develop against a
live config API:

1. In a separate terminal, inside a Rasen project: `rasen config ui --no-open`.
   Copy the port and the token from the printed URL
   (`http://127.0.0.1:<port>/#token=<hex>`).
2. Start the dev server with the proxy target and a dev-only token:
   ```bash
   VITE_DEV_API_TARGET=http://127.0.0.1:<port> VITE_DEV_TOKEN=<hex> pnpm dev
   ```
   `vite.config.ts` proxies `/api/*` to `VITE_DEV_API_TARGET`; `VITE_DEV_TOKEN`
   is read only in dev builds (`src/api/token.ts`) since there's no URL
   fragment to source it from outside the CLI's own launch. Neither variable
   is used in a production build.

The CLI itself is never loosened for this (no CORS added) — the proxy lives
entirely in this package's dev config.

## Local verification against the real CLI (no publish required)

1. `pnpm build` here.
2. Make the built package resolvable by the CLI's install-resolution probe
   (`src/core/config-api/ui-package.ts` in the root package), either:
   - **Sibling probe**: place or symlink this directory next to the CLI
     package's own root as `@atelierai/rasen-ui`, e.g.
     `ln -s $(pwd) ../../../@atelierai/rasen-ui` relative to a global CLI
     install layout (see `resolveUiPackageDir()` for the exact paths it
     checks), or
   - `npm link` this package into the CLI's own `node_modules` resolution
     path.
3. Run `rasen config ui` from a Rasen project. The browser should open
   straight into the editor (not the install-hint page), list config groups
   read from the live API, and round-trip a scope-explicit write and unset.

## Publishing (not part of this change)

This package is `"private": true` and unpublished. When the user decides to
publish it, the follow-up (documented, not implemented, in `design.md` D8) is:
a second token-gated publish step in `.github/workflows/release.yml` mirroring
the existing CLI publish step, a tag-scheme decision (shared tag vs. a
separate `ui-v*` scheme), a `pack-version-check` sibling for this package's
tarball, and flipping `"private"` to `false`. None of that is implemented
here — version bumps and the publish decision are the user's call.

## Open questions (carried from `design.md`)

- **Final npm package name**: the working name `@atelierai/rasen-ui` matches
  the CLI's `UI_PACKAGE_NAME` constant (`src/core/config-api/ui-package.ts`).
  A rename touches exactly that constant plus this package's `name` field.
- **Publish timing and tag scheme**: lock-step with the CLI vs. independently
  versioned; whether release tags split.
- **Whether this ever joins a real pnpm workspace**: revisit only if a second
  in-repo consumer needs to share code with it.
