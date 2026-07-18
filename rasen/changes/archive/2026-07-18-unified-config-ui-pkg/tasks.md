# Tasks: unified-config-ui-pkg

## 1. Package scaffold (design D1, D2)

- [x] 1.1 Create `packages/ui/package.json`: name `@atelierai/rasen-ui` (matching `UI_PACKAGE_NAME` in `src/core/config-api/ui-package.ts`), `"private": true`, `"type": "module"`, engines node `>=20.19.0`, scripts `dev`/`build` (vite)/`test` (vitest run)/`typecheck`; dependencies preact + preact-iso, devDependencies vite + `@preact/preset-vite` + typescript + vitest (+ jsdom); generate the package's own `pnpm-lock.yaml`
- [x] 1.2 Add `packages/ui/vite.config.ts` (preact preset, `base: '/'`, build to `dist/`, dev-only `server.proxy` for `/api` → a locally running `rasen config ui --no-open` with the token supplied via a dev env var) and `packages/ui/tsconfig.json` (strict, preact JSX)
- [x] 1.3 Add `packages/ui/README.md`: standalone-package notice (all commands run inside `packages/ui/`, no root workspace), dev-proxy workflow, and the local verification recipe (build, then symlink/place beside the CLI package root as the sibling probe expects, or `npm link`)
- [x] 1.4 Add `packages/ui/.gitignore` (`dist/`, `node_modules/`) and verify the root `files` whitelist and root lockfile are untouched: root `pnpm run build` passes and `npm pack --dry-run` confirms `packages/ui` is absent from the tarball with no root lockfile diff. `check:pack-version` (`scripts/pack-version-check.mjs`) does NOT pass — it fails independently of this change (hardcodes `node_modules/rasen/bin/rasen.js`, but the package installs scoped as `@atelierai/rasen` since the 0.1.1 rename); confirmed via `git log` that the script predates this change and nothing here touches it. Flagged to the LEAD as a pre-existing repo issue, out of scope to fix here (review round 1 finding m6).

## 2. Typed API client + token handling (design D4, D5)

- [x] 2.1 Create `packages/ui/src/api/types.ts` mirroring `src/core/config-api/wire-types.ts` (`WireConfigEntry`, `WireConfigKeyDefinition`, `WireConstraints`, `ProjectRef`, `ApiErrorBody`) plus the router's response envelopes (`{project, entries}`, `{entry}`, `{projects}`, health `{ok, version, project}`), with a provenance header naming the CLI module as source of truth
- [x] 2.2 Create `packages/ui/src/api/token.ts`: extract `#token=` from `location.hash` on boot, hold in module memory only, scrub the fragment via `history.replaceState`; export a "no token" state for the re-launch notice
- [x] 2.3 Create `packages/ui/src/api/client.ts`: single fetch wrapper injecting `Authorization: Bearer` on all calls and `Content-Type: application/json` on mutations; typed methods `health()`, `listProjects()`, `listConfig(project?)`, `getKey(key, project?)`, `putKey(key, {scope, value}, project?)`, `deleteKey(key, scope, project?)`; non-2xx narrowed to `ApiErrorBody`; 401 routed to the unauthorized state
- [x] 2.4 Record response fixtures from a live `rasen config ui` run into `packages/ui/test/fixtures/` (config list with grouped keys + a warnings entry, projects list, error envelopes incl. `invalid_scope`, `scope_required`, `project_required`)
- [x] 2.5 Vitest: token extraction/scrub (fixture URLs, missing-token case), client header injection, mutation content-type, scope-explicit request shapes (PUT body `scope`, DELETE `scope=` query), error-envelope narrowing against the fixtures

## 3. Shell: routing + layout (design D2, D3, D6)

- [x] 3.1 App entry (`index.html`, `src/main.tsx`, `src/app.tsx`): boot token handling first, then mount preact-iso path-based router (no hash routing — fragment is reserved for the token); full-screen re-launch notice for missing token / any 401
- [x] 3.2 Layout component: header with app title, project switcher, and nav; content area; config page as the only route (plus a catch-all redirect to it)
- [x] 3.3 Project switcher: options from `listProjects()`, default from `health().project` (nullable → "no project" state with project-scope editing disabled and an explanatory hint); selection re-fetches config with `?project=`

## 4. Config page (design D6)

- [x] 4.1 Entry list rendering: group by `definition.group` in stable order, key + description + effective value per entry; source badge (default | global | project | env-override); shadowed `scopeValues` revealed when a narrower scope wins; `warnings[]` rendered as visible warning badges (never auto-corrected)
- [x] 4.2 Constraint-driven controls: boolean toggle, enum select, ranged numeric input (bounds from `constraints.range`, client-side mirror validation), string input; env-override entries read-only; `not_settable`/wildcard (`not_supported`) entries display-only
- [x] 4.3 Scope-explicit writes: scope choice required when a key allows both scopes (selection defaults to the effective writable scope, request always carries explicit scope); unset action per scope with a value, sending DELETE with explicit scope; row updates in place from the API's re-resolved entry response
- [x] 4.4 Error surfacing per design D6: field-level (`invalid_value`, `invalid_scope` with the API's fix text, `not_settable`, `not_supported`), page-level (`project_required`, `project_not_found` pointing at the switcher), full-screen (`unauthorized`); unknown codes fall back to the message
- [x] 4.5 Vitest for pure logic: grouping/ordering, control-type selection from `constraints`, error-code → surface mapping, scope-choice defaulting; jsdom only where a DOM is unavoidable

## 5. Build verification + CI (design D3, D7)

- [x] 5.1 Verify `pnpm build` output: `dist/index.html` exists, all asset URLs root-absolute (deep-link check: serve `dist/` through the real CLI `static.ts` path or a local static server with index-fallback and load a nested route)
- [x] 5.2 End-to-end local smoke against the real CLI: build, place the package beside the CLI root (sibling probe), run `rasen config ui`, confirm the editor loads, a read renders groups, and one scope-explicit write + unset round-trips (manual, documented in the README recipe)
- [x] 5.3 Add `ui_build` job to `.github/workflows/ci.yml`: ubuntu-latest, Node `20.19.0`, pnpm; `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test` in `packages/ui`, assert `dist/index.html` exists; add `ui_build` to the existing gate job's `needs`/success assertion; do NOT touch the test matrix
- [x] 5.4 Confirm `.github/workflows/release.yml` is untouched and no version literal or bump entered the diff (version-agnostic rule)

## 6. Documentation + follow-up flags

- [x] 6.1 Document the dual-publish follow-up in `packages/ui/README.md` (or a short docs note): second token-gated publish step mirroring release.yml's pattern, tag-scheme decision, UI pack-version-check sibling, flipping `"private": true` — all user-decision-gated, none implemented here
- [x] 6.2 Note the open questions where the user will see them (proposal/design already carry them): final package name (`UI_PACKAGE_NAME` + package.json are the only two touch points), publish timing, workspace revisit condition
- [x] 6.3 Run full root test suite + `rasen validate unified-config-ui-pkg` and confirm green
