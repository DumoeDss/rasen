# Design: unified-config-ui-pkg

## Context

`unified-config-api` (child 2, implemented) shipped the CLI side of the contract this package plugs into. The implemented code is authoritative over its design doc; the load-bearing modules are:

- `src/core/config-api/ui-package.ts` — `UI_PACKAGE_NAME = '@atelierai/rasen-ui'` (ONE constant), two-probe resolution: `createRequire`-resolve of `<pkg>/package.json` from the CLI's install location, then a sibling-directory probe beside the CLI package root (pnpm isolated global layout). It resolves the package's `dist/` directory and requires nothing else of the package — no bin, no exports map.
- `src/core/config-api/static.ts` — serves the resolved `dist/` at `/`: `/` → `dist/index.html`, existing files by extension-mapped MIME, anything unresolvable falls back to `index.html` (client-side routing), all with `Cache-Control: no-store`.
- `src/core/config-api/wire-types.ts` + `serialize.ts` — the wire contract: `WireConfigEntry` (`definition` with serialized `constraints {type, enumValues?, range?}`, `value`, `source`, `scopeValues`, optional `warnings[]`), `ProjectRef`, `ApiErrorBody {error: {code, message, fix?}}`.
- `src/core/config-api/router.ts` — routes and codes as implemented: `GET /api/v1/health|projects|config|config/<key>`, `PUT/DELETE /api/v1/config/<key>`; bearer auth on every `/api/` path; `Content-Type: application/json` required on mutations; error codes `unauthorized`, `unknown_key`, `invalid_value`, `scope_required`, `invalid_scope`, `not_settable`, `not_supported` (featureFlags wildcard leaves), `project_not_found`, `project_required`, `write_failed`, `bad_request`, `payload_too_large`, `unsupported_media_type`, `method_not_allowed`, `internal_error`. Writes are scope-EXPLICIT (`scope` required in PUT body, `scope=` query on DELETE); project addressing via `?project=<id|root>`.
- `src/commands/config.ts:1064,1084` — the session token is minted per run and delivered in the URL **fragment**: `http://127.0.0.1:<port>/#token=<hex>`.

Repo constraints established by the portfolio and repo history:

- The root is a single-package repo (`@atelierai/rasen`); `website/` is the separate-package precedent — own `package.json`, own `pnpm-lock.yaml`, no workspace. The root has NO `pnpm-workspace.yaml`; a stray one once broke `pnpm run` at the root and was deleted.
- `flake.nix` pins `pnpmDeps.hash` against the root lockfile — anything that touches the root lockfile invalidates the nix build (recurring pain).
- Version discipline: version bumps are the user's call; nothing here reads or asserts a literal version.
- Platform-shell restraint (user decision): routing + layout + typed API client + config page only.

## Goals / Non-Goals

**Goals**
- Ship `packages/ui/` as a self-contained, separately-publishable package whose build output satisfies the D7 asset contract (`dist/index.html` entry, pure statics).
- Platform shell: routing skeleton, app layout, typed API client generated against the D2 wire shapes, fragment-token handling.
- Config page as the first (and only) shell module.
- CI builds and tests the package on every PR, feeding the existing gate job.
- Zero config logic in the UI — every read/write goes through `/api/v1/`.

**Non-Goals**
- No kanban/task/session-supervision modules or their state management.
- No changes to `src/` — the CLI contract is consumed, not modified (install-hint text included).
- No release workflow changes, no publishing, no version bumps (dual-publish is a documented follow-up).
- No store switcher (store namespace excluded from API v1), no featureFlags-leaf editing (API returns `not_supported`; the UI shows them read-only at most).
- No CORS/dev-proxy loosening in the CLI; dev workflow is solved inside the package (D5).

## Decisions

### D1: Package layout — self-contained `packages/ui`, NO root pnpm workspace

Follow the `website/` pattern: `packages/ui/` gets its own `package.json`, its own `pnpm-lock.yaml`, and no coupling to the root package. No root `pnpm-workspace.yaml` is introduced.

*Why:* Repo history is direct evidence — a stray root `pnpm-workspace.yaml` once broke `pnpm run` at the root and had to be deleted; CI, `npm publish` from root, and the nix flake all assume a single-package root today. `flake.nix`'s pinned `pnpmDeps.hash` means keeping UI dependencies out of the root lockfile is the only option that doesn't invalidate the nix build. The two packages share no code at build time (the wire contract is HTTP JSON), so workspace ergonomics buy almost nothing here.

*Alternative considered:* a deliberate root `pnpm-workspace.yaml` (workspace option). Rejected for now: it requires re-proving root `pnpm run`/`npm publish`/nix behavior for ergonomics this change doesn't need. It remains available later if the platform grows packages that genuinely share code.

*Consequences:* the root `files` whitelist in `package.json` is untouched (the UI must never leak into the CLI tarball — verify with the existing pack checks); `packages/ui` is `"private": false`-ready but carries `"private": true` until the user decides to publish (flipping it is part of the user's publish decision, see Open Questions).

### D2: Tech stack — Vite + Preact + TypeScript

`vite build` emits exactly the pure static `dist/` the contract wants, with `pnpm build` as the only command. Preact (+ `preact-iso` for routing) gives JSX components, hooks, and a router in ~5 KB of runtime — enough structure for a shell that will grow more modules, without a heavyweight framework lock-in for what is today one config page.

*Alternatives considered:*
- **Vanilla TS + hand-rolled DOM/router** — smallest possible, but the shell explicitly exists to be extended; hand-rolled component/state plumbing is the part future modules would pay for repeatedly.
- **React** — identical ergonomics at this scale for ~10x the runtime; if a future module needs the React ecosystem, `@preact/compat` is the escape hatch before a rewrite is.
- **Next.js/framework SSG** (the `website/` stack) — server-oriented, static export is a constrained mode; wrong shape for an SPA served by a CLI.

Node engine aligned with the root (`>=20.19.0`); dependencies pinned in the package's own lockfile.

### D3: Asset URLs are root-absolute (`base: '/'`), routing is path-based

`static.ts` always serves `dist/` at the server root and falls back to `index.html` for unresolvable paths — so a deep link like `/config` loads `index.html`, which must then reference `/assets/*.js` **absolutely**; relative (`./assets/...`) URLs would resolve against `/config/` and 404 into the index-fallback. Vite `base: '/'` (the default) is therefore correct. This supersedes the earlier "relative asset paths" phrasing in the planner handoff — the implemented CLI contract (root mount, any port, index-fallback) is what the package must match, and root-absolute satisfies it on every port.

Routing is path-based (`preact-iso`), NOT hash-based: the URL fragment is reserved for the token handoff (D4), and the CLI's index-fallback exists precisely to make path routing work.

### D4: Token handling — read fragment once, hold in memory, scrub the URL

`rasen config ui` opens `http://127.0.0.1:<port>/#token=<hex>`. On boot the app reads `location.hash`, extracts the token, stores it in module-scope memory (never `localStorage`/`sessionStorage`/cookies — the fragment delivery exists to keep the token out of server logs and persistent storage), and immediately clears the fragment via `history.replaceState` so the token doesn't linger in the address bar or get copied with the URL. Every `/api/` request sends `Authorization: Bearer <token>`; mutations set `Content-Type: application/json`.

No token in the fragment, or any 401 response, renders a full-screen notice telling the user to re-launch via `rasen config ui` (each run mints a fresh token; a stale tab after a restart is the common case). No retry loops, no token prompt — re-launching is the recovery path.

### D5: Typed API client — hand-maintained mirror of the wire types

`packages/ui/src/api/types.ts` mirrors `src/core/config-api/wire-types.ts` (plus the response envelopes the router actually sends: `{project, entries}`, `{entry}`, `{projects}`, `{ok, version, project}`) with a provenance header naming the CLI module as source of truth. `packages/ui/src/api/client.ts` is the single fetch wrapper: injects auth headers, narrows non-2xx bodies to `ApiErrorBody`, and exposes typed methods `health()`, `listProjects()`, `listConfig(project?)`, `getKey(key, project?)`, `putKey(key, {scope, value}, project?)`, `deleteKey(key, scope, project?)`. Nothing else in the app touches `fetch`.

*Why hand-maintained:* with no workspace (D1) there is no import path between the packages, and standing up codegen or a shared published types package for ~5 interfaces is machinery the contract's size doesn't justify. The wire contract is v1-frozen by child 2's spec; drift is caught by the client's tests against recorded response fixtures. A shared types package is the flagged follow-up if the platform grows more API surface.

*Dev workflow note:* because the CLI serves the UI same-origin and CORS is deliberately absent, `vite dev` uses a dev-only proxy (`server.proxy` for `/api` → a running `rasen config ui --no-open` instance, token pasted into a dev env var). This lives entirely in `vite.config.ts`; the CLI is not loosened.

### D6: Config page behavior

- **Data**: one `listConfig(project?)` call renders the whole page; groups come from `entry.definition.group` (registry metadata: Profile, Behavior, Autopilot, Telemetry, Project, Archive, Workflow, Advanced), rendered in a stable order with the key's `description` inline.
- **Controls from `constraints`**: `boolean` → toggle; `enumValues` → select; `number` with `range {gt, lte}` → validated numeric input showing the bounds; `string` → text input. Client-side validation mirrors constraints for immediate feedback, but the server verdict is authoritative — an `invalid_value`/`invalid_scope` response surfaces the server's `message` (+ `fix` when present) on the field.
- **Source + scope**: each entry badges its effective `source` (default | global | project | env-override) and shows `scopeValues` so a user sees when a project value shadows a global one. Every write is scope-explicit: the edit control requires choosing global vs project when the key allows both (defaulting the *selection* to the currently-effective writable scope is UI convenience; the request always carries the explicit scope). Unset (DELETE with explicit scope) is offered on any scope that has a value; env-override is displayed as read-only precedence, never writable.
- **Warnings**: entries carrying `warnings[]` (invalid on-disk values) get a visible warning badge with the message — the UI never rewrites or clamps on-disk values (mirror of the API's reporting-not-fixing stance).
- **Errors**: error handling is code-driven off `ApiErrorBody`: field-level for `invalid_value`/`invalid_scope`/`not_settable`/`not_supported`, page-level for `project_required`/`project_not_found` (points at the project switcher), full-screen for `unauthorized` (D4). Unknown codes fall back to showing `message`.
- **Project switcher**: header dropdown fed by `listProjects()`, defaulting to the health endpoint's launch `project` (nullable → "no project" state where project-scope editing is disabled with an explanatory hint); switching re-fetches the config list with `?project=`.
- **Write feedback**: a successful PUT/DELETE returns the re-resolved entry; the row updates from the response body (no full-page refetch), keeping source badges honest after a write.

### D7: CI — one `ui_build` job feeding the existing gate

`.github/workflows/ci.yml` gains a single job (ubuntu-latest, the repo's pinned Node `20.19.0`, pnpm): `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` inside `packages/ui`, plus an asserted `dist/index.html` existence check (the one file the CLI contract names). The gate job adds `ui_build` to its `needs`/success assertion. The os/node/shell test matrix is NOT widened — it exists for cross-platform CLI process spawning; a browser-target static build has no per-OS behavior worth 4 platforms of CI time.

### D8: Release dual-publish — documented follow-up, not implemented

This change does not touch `.github/workflows/release.yml`. When the user decides to publish the UI package, the follow-up is mechanical and mirrors the existing single-package shape: a second token-gated publish step (same `NPM_TOKEN` presence-check pattern, `npm publish --provenance --access public` from `packages/ui`), a decision on tag scheme (shared tag vs `ui-v*`), a sibling of `scripts/pack-version-check.mjs` for the UI tarball, and flipping `"private": true`. All of it is version-agnostic by construction; the publish itself, the final package name, and any version are the user's call.

### D9: Testing — vitest inside the package

- API client unit tests (vitest, node environment, mocked `fetch`): auth header injection, JSON content-type on mutations, error-envelope narrowing, scope-explicit request shapes, token-extraction/scrub logic against fixture URLs.
- Pure-logic tests: grouping/ordering of entries, control-type selection from `constraints`, error-code → surface mapping. Component logic is factored so these run without a DOM where possible; anything needing a DOM uses vitest's jsdom environment — no browser/E2E harness in this change.
- Response fixtures are hand-recorded from a live `rasen config ui` run and checked in; they double as the drift tripwire for D5.
- A CLI-side integration smoke (built `dist/` served through the real server) is deferred — child 2 already tests `static.ts` serving against fixture directories, which pins the CLI half of the contract.

## Risks / Trade-offs

- [Wire-type drift between `wire-types.ts` and the UI's mirror] → provenance headers on the mirrored types, recorded-fixture tests (D9), and the v1-frozen API spec from child 2; shared-types package flagged as follow-up if the surface grows.
- [Package name churn: `UI_PACKAGE_NAME` says `@atelierai/rasen-ui` but the final name is the user's decision] → the name lives in exactly two places by design (the CLI constant and `packages/ui/package.json`); a rename is a two-line diff plus republish. Flagged as an open question, not baked as final.
- [UI assets accidentally entering the CLI tarball or root lockfile] → `packages/ui` is outside the root `files` whitelist and has its own lockfile; the existing root pack checks stay green because nothing at the root changes.
- [Ubuntu-only CI for the package] → accepted: the build output is browser-target statics with no OS-specific behavior; package scripts are kept cross-platform (plain `vite build`/`vitest`, no shell-isms) so local dev on Windows/macOS works even though CI doesn't exercise it.
- [Stale browser tab after server restart shows a dead UI] → every 401 renders the re-launch notice (D4); `no-store` caching means a reload gets fresh assets.
- [`pnpm install` inside `packages/ui` from repo root confusion (no workspace)] → README section inside `packages/ui` states the package is standalone: all commands run from `packages/ui/`.

## Migration Plan

Additive only. `packages/ui/` lands unreferenced by any root workflow except the new CI job; users see zero behavior change until they install the (not-yet-published) package beside the CLI, at which point `rasen config ui` starts serving it via the already-shipped resolution. Rollback = delete the directory and the CI job. Local verification without publishing: build the package, then place/symlink it beside the CLI package root as `@atelierai/rasen-ui` (the sibling probe) or `npm link` it into the CLI's resolution path, and run `rasen config ui`.

## Open Questions

- **Final npm package name** (user decision): working name `@atelierai/rasen-ui` matches the CLI constant; repo history (bare `rasen` rejected by npm similar-name policy) argues for staying under the `@atelierai` scope. A different choice changes `UI_PACKAGE_NAME` + `packages/ui/package.json` only.
- **Publish timing and tag scheme** (user decision): whether the UI publishes lock-step with the CLI or independently versioned, and whether release tags split (`ui-v*`) — inputs to the D8 follow-up.
- **Whether `packages/ui` should ever join a real pnpm workspace**: revisit only when a second in-repo consumer of shared code appears.
