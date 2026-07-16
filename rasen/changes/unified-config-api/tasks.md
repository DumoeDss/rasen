## 1. API core: routing, envelope, auth

- [x] 1.1 Create `src/core/config-api/server.ts`: `http.createServer` bound to 127.0.0.1 (explicit host), ephemeral port default, connection tracking Set (add on `connection`, remove on socket `close`), `stopServer()` that closes the server, destroys all tracked sockets, and arms a 2 s guard timer backstop
- [x] 1.2 Create `src/core/config-api/router.ts`: method + pathname dispatch for `/api/v1/*`, bounded JSON body reader (64 KB cap, 400 on parse failure), uniform error responder `{ error: { code, message, fix? } }`, and 404 fallback
- [x] 1.3 Auth middleware: per-session token minted via `crypto.randomBytes(32)`, bearer-token check on every `/api/` request (401 `unauthorized`), no CORS headers ever, `application/json` content-type requirement on mutating methods
- [x] 1.4 Unit tests: loopback bind, token accept/reject, content-type rejection on PUT, body size cap, error envelope shape

## 2. Config endpoints

- [x] 2.1 Serialization: map `EffectiveConfigEntry` to the wire shape — replace `definition.validate` with derived `constraints` (`{ type, enumValues?, range? }`); add per-entry `warnings[]` populated when a raw scope value fails `validateConfigValue`
- [x] 2.2 `GET /api/v1/health` (ok, version from package.json, launch ProjectRef | null) and `GET /api/v1/config` (entries via `resolveEffectiveConfig({ projectRoot })`)
- [x] 2.3 `GET /api/v1/config/<key>` with URL-decoded key lookup; 404 `unknown_key` for unregistered keys
- [x] 2.4 `PUT /api/v1/config/<key>`: require explicit `scope`; validate via `validateConfigKeyPath(key, scope)` + `validateConfigValue` for BOTH scopes; project scope → `updateProjectConfigKey`; global scope → minimal-diff raw-file write (read raw JSON, apply only the target key, validate against `GlobalConfigSchema`, save) — never `getGlobalConfig()`-merge (MIN4); respond with the re-resolved entry
- [x] 2.5 `DELETE /api/v1/config/<key>?scope=...`: unset in the addressed scope, respond with the re-resolved entry
- [x] 2.6 Endpoint tests: list/get/set/unset round-trips both scopes, missing-scope 400, invalid enum/range 400 with constraint message, `not_settable` on telemetry.anonymousId, MIN4 regression (global PUT leaves never-set keys absent from the file), on-disk invalid value surfaces as a warning without file rewrite

## 3. Project addressing

- [x] 3.1 Resolver: `project` selector (query or body) → registry lookup by `projectId`, else canonical-root-path match, else 404 `project_not_found` with fix hint; omitted → launch project (nullable)
- [x] 3.2 `GET /api/v1/projects` from `readProjectRegistryState` as `ProjectRef[]` (`{ projectId, name, root }`)
- [x] 3.3 Reject `scope: "project"` writes with no resolvable project (explicit error, never a global fallback)
- [x] 3.4 Tests: address by id, address by root path, unknown selector 404, project-write-without-project rejection, cross-project set lands in the right config.yaml

## 4. `rasen config ui` command

- [x] 4.1 Declare the UI package name constant in one module (`src/core/config-api/ui-package.ts`); implement two-probe resolution: `createRequire(import.meta.url).resolve('<pkg>/package.json')` then sibling-directory probe from the CLI package root
- [x] 4.2 Static serving when resolved: UI package `dist/` at `/`, index.html fallback for non-`/api/` routes, known-extension MIME map, `Cache-Control: no-store`; when absent: built-in minimal hint page at `/` and printed install instruction
- [x] 4.3 Register `ui` subcommand on the config command in `src/commands/config.ts`: resolve launch project from cwd, start server, print `http://127.0.0.1:<port>/#token=...`, spawn platform opener (`open`/`start`/`xdg-open`, detached, `stdio: 'ignore'`, `.unref()`) unless `--no-open`; `--port` pinning with clear collision error
- [x] 4.4 Wire SIGINT/SIGTERM to `stopServer()`; verify no telemetry/guard-timer interaction keeps the process alive
- [x] 4.5 Tests: command starts and serves health, `--no-open` spawns nothing, absent UI package serves hint page and prints instruction, resolved (fixture) UI package serves statics with index fallback, port collision error, shutdown promptness with an open keep-alive connection (exit within guard interval)

## 5. Contract documentation and verification

- [x] 5.1 Ensure design.md's API contract section matches the implemented envelope exactly (endpoint table, error codes, ProjectRef, constraints serialization) — update whichever drifted
- [x] 5.2 Run full suite (`pnpm test`), `tsc` clean, and `rasen validate unified-config-api`; fix regressions
