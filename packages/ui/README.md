# @atelierai/rasen-ui

The optional local management platform for `rasen ui`: boards and Spaces,
pipeline assembly, configuration, archives, and supervised agent sessions,
served by the Rasen CLI once this package is installed beside it.

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

1. In a separate terminal, inside a Rasen project: `rasen ui --no-open`.
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
3. Run `rasen ui` from a Rasen project. The browser should open the local
   management platform (not the install-hint page), list the current Space,
   and reach the daemon-backed management API.

## Publishing

During the 0.1.x line this package releases in strict lockstep with
`@atelierai/rasen`. Both manifests use the same canonical `X.Y.Z`, one
`rasen-vX.Y.Z` tag builds and tests both dependency graphs, and one release
workflow publishes both npm packages. A UI-only correction still advances
both packages by one normal patch (for example `0.1.5` to `0.1.6`).

Four-component versions such as `0.1.5.1` are not SemVer and are rejected by
the release guard. Independent UI versions can be reconsidered only after the
management API exposes an explicit compatibility handshake.

Before tagging, run `pnpm check:release -- --tag rasen-vX.Y.Z` and
`pnpm check:paired-pack` from the repository root.
