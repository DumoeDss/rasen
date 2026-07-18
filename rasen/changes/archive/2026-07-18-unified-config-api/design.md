## Context

Child 1 shipped the in-process surface this API wraps (all in this working tree, review-clean, commit 6471007):

- `resolveEffectiveConfig({ projectRoot? })` (`src/core/effective-config.ts`) → `EffectiveConfigEntry[]` with `{ definition, value, source: 'default'|'global'|'project'|'env-override', scopeValues: { global?, project? } }`. Wildcard registry entries (`featureFlags.*`) are excluded from resolution.
- `CONFIG_KEY_REGISTRY` / `validateConfigKeyPath(keyPath, scope)` / `validateConfigValue(definition, value)` / `NOT_SETTABLE_KEYS` (`src/core/config-keys.ts`).
- `updateProjectConfigKey(projectRoot, keyPath, value | undefined)` (`src/core/project-config.ts`) — comment-preserving YAML writes; throws with guidance when no `rasen/config.yaml` exists.
- `getGlobalConfig()` / `saveGlobalConfig()` (`src/core/global-config.ts`) — note: `getGlobalConfig()` does **no** schema validation on read, and merges baked-in defaults into its return value.
- Machine project registry (`src/core/project-registry.ts`): `registry.json` maps canonical absolute project roots to `{ projectId, name, mode, home, lastSeen }` — the basis for project addressing.

Child-1 reviewer findings that bind this design: (a) route every endpoint through explicit scope resolution — never infer; (b) validate through the registry for BOTH scopes (global CLI writes validate via zod only; the API must close that parity gap); (c) `getGlobalConfig()` propagates hand-edited invalid values silently — the API needs read-time signaling; (d) accepted-known MIN4: the CLI's global `set` persists baked-in defaults alongside the target key, flipping later source annotations from `default` to `global` — the API write path must not repeat this.

Repo-history constraint: native `fetch`/undici keep-alive sockets once hung CLI exit ~10 s (memory: node-fetch-hangs-cli-exit). An embedded HTTP **server** has the same failure class via open keep-alive connections at shutdown.

Child 3 (`unified-config-ui-pkg`) consumes this API via a typed client and ships static assets only. This design's API contract section is its authoritative input.

## Goals / Non-Goals

**Goals:**
- A complete, versioned localhost JSON API over the child-1 modules — zero config logic duplicated in HTTP handlers.
- `rasen config ui` as the single entry point: API + optional static UI + browser open + clean shutdown.
- An API envelope (auth, errors, project addressing, versioning) that the future management platform extends without breaking the config page.
- Registry-parity validation on every write, both scopes.

**Non-Goals:**
- No UI package, assets, or monorepo work (child 3).
- No remote access, TLS, multi-user auth, or persistent daemon — this is a loopback, single-user, run-while-open tool.
- No new config keys and no changes to CLI config subcommand behavior.
- No WebSocket/live-reload channel in v1 (the platform may add one later; the envelope leaves room).

## Decisions

### D1: Node built-in `http`, no framework

The API is ~6 routes. Node's `http.createServer` with a small hand-rolled router (method + `URL` pathname match) avoids a new dependency in the CLI package for what Express would spend on middleware we must disable anyway (CORS, body limits are trivial inline). JSON body parsing is a bounded read (reject > 64 KB) + `JSON.parse` with a 400 on failure.

*Alternative considered:* Fastify/Express — rejected: dependency surface and startup cost for a tool whose whole API fits in one file's worth of handlers.

### D2: API contract (the platform foundation — normative for child 3)

All endpoints under `/api/v1/`. Content type `application/json` both ways. The `v1` segment is the compatibility promise: additive changes (new endpoints, new response fields) do not bump it; breaking changes mint `/api/v2/` alongside.

```
GET  /api/v1/health                          → 200 { ok: true, version, project: ProjectRef | null }
GET  /api/v1/config?project=<id|root>        → 200 { project: ProjectRef | null, entries: EffectiveConfigEntry[] }
GET  /api/v1/config/<key>?project=<id|root>  → 200 { entry: EffectiveConfigEntry } | 404
PUT  /api/v1/config/<key>                    body { scope: 'global'|'project', value: unknown, project?: <id|root> }
                                             → 200 { entry: EffectiveConfigEntry }  (re-resolved after write)
DELETE /api/v1/config/<key>?scope=...&project=... → 200 { entry: EffectiveConfigEntry }  (unset; re-resolved)
GET  /api/v1/projects                        → 200 { projects: ProjectRef[] }        (from the machine project registry)
```

- `EffectiveConfigEntry` is serialized exactly as the in-process type, except `definition.validate` (a function) is replaced by a serializable `constraints` description (`{ type, enumValues?, range? }`) derived from the registry — the UI renders forms from this.
- `ProjectRef` = `{ projectId, name, root }`.
- Error shape (uniform): non-2xx → `{ error: { code: string, message: string, fix?: string } }`. Implemented codes: `unknown_key`, `invalid_value`, `scope_required` (scope missing/invalid), `project_required` (scope `"project"` with no resolvable project — the distinct half of the "scope_required-family" from D4), `not_settable`, `invalid_scope` (key exists but not in the requested scope; fix hint names the correct scope), `project_not_found`, `unauthorized`, `not_supported` (see featureFlags note below), `write_failed` (a scope-valid write that still failed at the file layer, e.g. no `rasen/config.yaml` yet), `bad_request`, `payload_too_large`, `unsupported_media_type`, `method_not_allowed`, `not_found`, `internal_error`. Mirrors the CLI's StoreError `code`/`fix` vocabulary; the set is additive, not closed.
- Key paths appear URL-encoded in the path segment (`handoff.threshold` is dot-safe; encoding is specified for future keys).
- `featureFlags.<name>` (the registry's one wildcard-family key) is explicitly OUT of the v1 API surface: PUT/DELETE reject it with `not_supported` and a fix hint pointing at the CLI (`rasen config set --scope global featureFlags.<name> <value>`), and GET never returns a per-flag entry (matching `resolveEffectiveConfig()`, which excludes wildcard registry entries from resolution entirely — there is no single "the" value for a flag family, so there is nothing for a per-key GET/PUT to re-resolve against). Revisit if the UI needs per-flag editing; not required by this change's proposal or spec scenarios.
- Writes are scope-EXPLICIT: `scope` is required on PUT/DELETE; there is no "default scope" (reviewer finding (a)). `scope: 'project'` without a resolvable project → 400 `scope_required`-family error, never a silent global write.

### D3: Validation and write path — registry for both scopes, minimal-diff global writes

Every PUT validates in order: key path via `validateConfigKeyPath(key, scope)` (which also rejects `NOT_SETTABLE_KEYS`), then value via `validateConfigValue(definition, value)` — for BOTH scopes, closing the CLI's global-side zod-only gap (reviewer finding (b)); zod validation still runs at save as the final backstop. Values arrive as JSON, so no string coercion layer is needed (booleans/numbers are typed by the client).

Global writes do NOT go through `getGlobalConfig() → mutate → saveGlobalConfig()` — that is the MIN4 bug (persisting baked-in defaults, corrupting source annotations). Instead the handler reads the RAW file content (same approach as `readRawGlobalConfig` in effective-config.ts), applies only the requested key change, validates the result against `GlobalConfigSchema`, and saves. This gives the API minimal-diff semantics the CLI currently lacks; the CLI can adopt the same helper later (flagged follow-up, not in scope).

Read-time invalidity (reviewer finding (c)): the API never clamps or rewrites hand-edited values. `resolveEffectiveConfig()` already reports what resolution actually uses (child 1 added out-of-range global threshold dropping with a warning in `resolveHandoffThresholdLayers`). For the API, each entry additionally carries `warnings?: string[]` populated when a raw scope value fails `validateConfigValue` — the UI can badge "invalid value on disk, ignored" without the API mutating anything.

### D4: Project addressing via the machine project registry

`?project=` (or body `project`) accepts a `projectId` or an absolute root path. Resolution: exact `projectId` match in `registry.json` first, else canonical-path match on the registry key, else 404 `project_not_found` (with a fix hint to open the project once with the CLI). The resolved root feeds `resolveEffectiveConfig({ projectRoot })` and `updateProjectConfigKey(root, ...)`. Omitted `project` = the launch project: `rasen config ui` resolves the nearest Rasen root from cwd at startup (nullable — launching outside a project serves global-only config, and project-scope operations without an explicit `project` then fail with `scope_required` guidance). `GET /api/v1/projects` lists registry entries so the UI can offer a project switcher — this endpoint is the management platform's seed.

*Store-namespace addressing (`--store`) is deliberately excluded from v1* — stores are planning roots, not project config carriers; revisit if a store config surface appears.

### D5: Security — loopback bind + per-session token

- Bind `127.0.0.1` exclusively (never `0.0.0.0`, never `::` — explicit host argument), ephemeral port by default (`--port` to pin).
- At startup the CLI mints a random token (`crypto.randomBytes(32).toString('hex')`). ALL `/api/` requests require `Authorization: Bearer <token>`; 401 otherwise. The token reaches the browser via the opened URL's fragment (`#token=...`), which the UI shell stores in memory — the fragment never appears in server logs or referrers. The printed URL includes it so manual opening works.
- No CORS headers are ever emitted (same-origin only), defeating cross-origin XHR from random pages; the bearer token additionally defeats non-CORS-readable blind requests and DNS-rebinding (a rebound origin cannot know the token). `Host` header is not trusted for anything.
- Mutating routes additionally require `Content-Type: application/json` (blocks HTML-form CSRF, which cannot set that header cross-origin).

*Proportionality:* this is a single-user local tool; token-in-fragment + loopback + no-CORS is the standard local-dev-server posture (same class as Jupyter). No cookies, no sessions, no TLS.

### D6: `rasen config ui` lifecycle — sockets must not hang exit

- Start server → resolve UI assets → print `Config UI: http://127.0.0.1:<port>/#token=...` → open browser unless `--no-open`. Browser opening spawns the platform opener (`open` / `start` via `cmd /c` / `xdg-open`) detached with `stdio: 'ignore'` and `.unref()` — no npm `open` package, and the child never holds the event loop.
- The server process stays in the foreground until terminated. Shutdown triggers: SIGINT/SIGTERM. On shutdown: `server.close()` AND destroy all live sockets — the server tracks connections via the `connection` event in a `Set` (removed on `close`) and calls `socket.destroy()` on each at shutdown. `server.close()` alone waits for keep-alive connections to end — exactly the open-socket exit hang this repo has been bitten by before (undici keep-alive, ~10 s); browsers hold keep-alive connections indefinitely, so force-destroy is mandatory, with a 2 s guard timer + `process.exit` as the backstop.
- `--port` collision → clear error naming the port and suggesting another; ephemeral default makes this rare.

### D7: Optional UI package resolution

The UI package (child 3, working name `@atelierai/rasen-ui`) is resolved at `config ui` startup:

1. `require.resolve('<ui-pkg>/package.json', { paths: [<CLI's own module root>] })` — via `createRequire(import.meta.url)`, so resolution starts from the CLI's install location, which works for global installs (`npm i -g rasen @atelierai/rasen-ui` land side by side in the same global `node_modules`) and for local installs alike.
2. Fallback probe: sibling directory of the CLI package root (`path.join(cliPackageRoot, '..', '<ui-pkg>')`) — covers pnpm's isolated global layout where sibling packages are not on the resolution path.

Resolved → serve the package's `dist/` statics at `/` (index fallback for client-side routes, correct MIME types for a small known extension set, `Cache-Control: no-store` — local tool, staleness is worse than re-reads). Not resolved → the API still starts; `GET /` returns a minimal built-in page showing the install hint, and the CLI prints: `UI package not installed. Run: npm install -g <ui-pkg>` (install command mirrors how the CLI itself was installed where detectable; generic hint otherwise). The exact package name is declared in ONE constant module so child 3 renames touch one place.

The package-name constant, resolution probes, and hint text are specified now so child 3 can rely on them; asset layout contract for child 3: static files under the UI package's `dist/`, entry `dist/index.html`.

## Risks / Trade-offs

- [Serialized registry `constraints` could drift from the real `validate` functions] → constraints are DERIVED (enum from `enumValues`, range from a declared range field for `handoff.threshold`) and the server re-validates every write with the real functions; the serialization is advisory for form rendering only.
- [Token in URL fragment can be leaked by the user copying the URL] → acceptable for loopback single-user; token dies with the process.
- [Raw-file global write path diverges from the CLI's `saveGlobalConfig` semantics] → both end in `GlobalConfigSchema` validation before write; a unit test asserts a PUT touches only the target key in the file (the MIN4 regression test).
- [`require.resolve` behavior differs across npm/pnpm/yarn global layouts] → two-probe strategy plus an integration test with a simulated global layout; worst case the hint path still works (API remains usable, UI degraded to install hint).
- [Force-destroying sockets can drop an in-flight write] → writes are synchronous file operations completing within the handler before the response is queued; destruction at shutdown only kills idle keep-alive connections and unfinished reads, never a completed write.
- [Ephemeral port breaks bookmarks] → intentional (no daemon, no fixed attack surface); `--port` exists for users who want stability.

## Migration Plan

Purely additive: a new module and one new subcommand. No config format changes, no data migration. Rollback = revert. The API version namespace (`/api/v1/`) is the forward-compatibility mechanism for the platform siblings.

## Open Questions

- Final UI package name (working: `@atelierai/rasen-ui`) — user decision at child 3 / publish time; isolated to the single constant module.
- Whether `GET /api/v1/projects` should include per-project health (registry `lastSeen`, root existence) — deferred; the platform sibling can add fields additively.
