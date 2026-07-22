# Design — Spaces page, capped switcher, create-space (W6)

## Context

Authoritative design: `rasen/office-hours/ui-config-and-library-redesign.md` §W6 + Premises (ratified 2026-07-22). Verified current state:

- `GET /api/v1/spaces` (`src/core/management-api/spaces.ts`) already returns everything the page needs: `{ type:'project', id, name, root }` and `{ type:'store', id, name, root, members }`, dead roots filtered read-only.
- `SpaceSwitcher` (`packages/ui/src/components/SpaceSwitcher.tsx`) renders the full listing in one `<select>` — no search, no cap, no ordering.
- Routing: the URL is the source of truth (`/p/<id>/…`, `/s/<id>/…`, `packages/ui/src/store/use-space.ts`); `app.tsx` has no space-agnostic content route besides `/` bootstrap.
- Change submission (`src/core/management-api/submit.ts`) is the established CLI-spawn pattern: own-installation entry (never PATH), argv array + `shell: false`, cwd from registry-resolved roots only, 30s timeout with SIGTERM→SIGKILL, cap-1 in-flight, verbatim error passthrough, admission via the data-driven whitelist (`whitelist.ts`, bounded-cli tier currently exactly `create-change`).
- Management route admission is a closed set (`router.ts:65` `MANAGEMENT_PATHS`, `isMethodAdmitted` at `router.ts:117`).
- CLI creation verbs: `rasen init [path]` (no `--json`; mints projectId + registers via `resolveProjectHome(ensure:true)` at `src/core/init.ts:259`, so the new project appears in the spaces listing immediately); `rasen store register [path] --id <id> --yes --json`; `rasen store setup [id] --path <path> --json` (`src/commands/store.ts:817-837`).
- `GlobalConfigSchema` (`src/core/config-schema.ts:12`) is `.passthrough()`; the UI's array-type control is already read-only (`packages/ui/src/config/controls.ts:90`); the CLI editor special-cases `workflows` (the only array key) as a disabled row (`src/commands/config.ts:170`).
- Portfolio context: this child runs in a **parallel worktree** while W1 edits `config-keys.ts` on the main branch. Keep the registry diff minimal and additive.

## Goals / Non-Goals

**Goals:**
- `/spaces` page: full listing, client-side search, pins (`ui.pinnedSpaces` global key), pinned-first ordering, create-space flow that lands in the new space.
- Header switcher capped at 8 (pinned + recent) with "All spaces…" routing to `/spaces`.
- `GET /api/v1/local-paths` + `POST /api/v1/spaces` under the established security posture; the POST spawns the CLI, never writes workspace files in-process.
- Resolve design open questions 6/7/8 concretely (D3, D4, D5 below).
- Fix the stale `management-http-api` single-mutating-endpoint clause.

**Non-Goals:**
- No config API surface changes (W1 owns config addressing; this change only registers the `ui.pinnedSpaces` key).
- No server-side search/recency — search is a client-side filter; recency is client-side memory.
- No store member management, no space deletion/unregistration UI, no `rasen doctor --gc` exposure.
- No visual redesign; frozen warm-editorial + CRT styles reused.
- No change to `GET /api/v1/spaces` response content.

## Decisions

### D1 — Pins are a global config key; recency is localStorage; the page composes both

`ui.pinnedSpaces: string[]` of full space selectors (`project:<id>` / `store:<id>` — the same opaque tokens every API call uses; a bare id would be ambiguous across namespaces). Registry entry: `scopes: ['global']`, `type: 'array'`, `defaultValue: []`, group `Appearance`. Written through the existing `PUT /api/v1/config/ui.pinnedSpaces` global write path — no new write machinery. `GlobalConfigSchema` gains a typed `ui: { pinnedSpaces?: string[] }` block (schema is passthrough, but typing keeps the registry round-trip test meaningful), `GlobalConfig` interface likewise. The CLI editor marks the key list-managed (disabled row like `workflows`, hint pointing at the Spaces page / `rasen config set`) — the CLI editor has no array prompt and must not crash on the second-ever array key. The UI Config page needs nothing: array controls are already read-only.

Recency ("most-recently-visited spaces") lives in `localStorage` (a small module beside `use-space.ts`; updated on space-route navigation; capped list of selectors). Rationale: pins are a durable preference worth CLI visibility (the design doc chose the config key); recency is ephemeral UX state — putting it in config would spam config writes on every navigation.

**Rejected**: extending the spaces listing with registry `lastSeen` for server-side recency — it would delta `planning-space-addressing`'s listing requirement for marginal value and still miss store visits (stores have no lastSeen).

### D2 — `/spaces` is a space-agnostic route; the switcher caps at 8

`app.tsx` gains `<Route path="/spaces" component={SpacesPage} />` (above the default route). `Layout` renders fine without a space (nav hidden, switcher shown) — no layout change needed beyond an "All spaces" link treatment. The page: one `listSpaces()` fetch + one `getKey('ui.pinnedSpaces')` fetch; search input filters entries by id/name/root substring (case-insensitive); pinned entries sort first, then projects, then stores (each group alphabetical); store rows show their members inline (read-only chips); every row navigates via the existing `spaceHref(space, section)` preserving the current section rule (default board). Pin/unpin toggles write the full updated array via `putKey('ui.pinnedSpaces', { scope: 'global', value })`; unknown/dead selectors in the pin list are ignored for ordering and silently retained (a pin to a temporarily-unplugged store must survive).

`SpaceSwitcher` keeps its `<select>` shape (smallest diff, established tests): options become pinned-first + recent fill, capped at 8, plus a final `__all__` option ("All spaces…") that routes to `/spaces` instead of a space. When the current space is outside the cap it is still included (selected value must exist). Full listing still fetched (it is the source of the cap's candidates; no new endpoint).

### D3 — `GET /api/v1/local-paths`: home start point; any explicit absolute path; nothing above home unprompted (OQ6)

Contract (new `src/core/management-api/local-paths.ts`, GET-only management path):

- **No `path` param** → the start-point response: the user's home directory listing, plus `home` identified in the payload. The server never volunteers anything above home — no drive-root enumeration, no parent-of-home suggestion. This is the confinement half of the rule.
- **`path=<absolute>`** → enumerate that directory, wherever it is. An explicitly supplied absolute path IS the escape hatch (the design's "typed absolute path"): the UI only ever sends paths the user typed or clicked from a previous response, so every escalation above home traces to an explicit user action. Repos on another drive (`E:\…`) are reachable by typing the path into the picker's path input.
- **Relative or empty `path`** → 400 `invalid_path` (also the option-injection guard for the later spawn: `path.isAbsolute` excludes `-`-prefixed values).
- Response: `{ path: <canonical>, parent: <canonical parent or null at a filesystem root>, separator: path.sep, entries: [{ name, isDir, isGitRepo }] }`, entries sorted directories-first alphabetical. `isDir` from `readdir withFileTypes` (symlinks not followed); `isGitRepo` = the entry contains a `.git` directory **or file** (worktrees/submodules use a `.git` file). Windows paths canonicalized via the existing `FileSystemUtils.canonicalizeExistingPath` so drive-letter case and separators are stable.
- Errors: nonexistent → 404 `path_not_found`; not a directory → 400 `not_a_directory`; EACCES/EPERM → 403 `path_forbidden`. Never a crash, never a write, no registry interaction.
- Security posture: identical to every management path — loopback bind, bearer token, no CORS. The marginal exposure is bounded: `POST /api/v1/sessions` already lets the same caller run an agent with full machine access.

### D4 — `POST /api/v1/spaces`: kind + directory state select the CLI verb; register-existing is covered (OQ7)

Body `{ kind: 'project' | 'store', path: string, id?: string }`. Verb selection is deterministic and reported back:

| kind | target state | spawned argv | notes |
|---|---|---|---|
| `project` | any | `init <path>` | init mints identity + registers (init.ts:259), so the space is listable immediately; init's own guards (pointer-repo refusal etc.) pass through as 422 |
| `store` | `<path>/rasen` exists | `store register <path> --yes [--id <id>] --json` | **OQ7: yes** — registering an existing store is first-class; `--yes` confirms metadata creation for a healthy root non-interactively; `id` optional (defaults to metadata/folder name) |
| `store` | no `<path>/rasen` | `store setup <id> --path <path> --json` | fresh store; `id` required → 400 `invalid_input` when missing |

The directory probe (`<path>/rasen` exists) is a read-only stat on an explicit POST — resolution-stays-non-mutating is untouched (that rule governs side effects of *answering* reads/space resolution, and this endpoint's only mutation path is the subprocess). On subprocess success the handler re-runs the existing `handleSpaces()` and returns 201 `{ space, operation }` where `space` is the entry whose canonical root matches the target (project) or whose id matches the registered/created store; a success it cannot find in the listing → 500 `cli_protocol_error` (loud, not silent). `rasen init` has no `--json`, so success is exit-code-0 + listing re-read — deliberately not parsing init's human output.

**Rejected**: an explicit `mode: 'init' | 'register'` field — it pushes a distinction onto the client that the filesystem already answers, and a wrong client guess would 422 anyway; the response's `operation` field keeps the outcome transparent. Also rejected: calling `InitCommand`/store operations in-process — the codebase has exactly one workspace-write channel (the CLI) and this endpoint must not open a second; this is the ratified red line.

### D5 — Confinement and admission reuse the change-submission machinery (OQ8)

New `src/core/management-api/create-space.ts` mirroring `submit.ts`: own-installation CLI entry via the same `require.resolve('../../../package.json')` pattern; argv array with `shell: false`; **cwd is the server process's own cwd — never derived from client input** (the target path travels only as a validated argv token; unlike change submission there is no space-root cwd to lock to, because the space does not exist yet). Timeout 60s (init writes many files; store ops are fast but share the ceiling) with the same SIGTERM → 2s → SIGKILL escalation and slot-release-on-child-close discipline; cap-1 in-flight per server (409 `busy`), independent of the change-submission cap (each requirement owns its own cap; sharing state across modules buys nothing).

Pre-spawn validation (the OQ8 scrutiny, all before any subprocess): `kind` ∈ {project, store}; `path` absolute (`path.isAbsolute`), control-character-free (reuse `CONTROL_CHAR_PATTERN`), length-capped; `id` (when present/required) validated with the store module's own `validateStoreId` so the server and CLI can never disagree on id shape. Absoluteness is the option-injection guard for the positional path; `id` lands after `--id`/as the `setup` positional and store-id validation excludes option-like strings. Admission goes through the whitelist table: three new bounded-cli rows (`create-project-space`, `register-store-space`, `setup-store-space`), each checked via `getBoundedCliEntry` before spawn — same single-admission-source contract as create-change; the session whitelist's supervised tier is not involved (these are bounded, deterministic, resident-free operations — the session mechanism solves a different problem and its skill-prefix shape does not fit a non-agent CLI verb).

Router wiring: `MANAGEMENT_PATHS` gains `/api/v1/local-paths`; `isMethodAdmitted` admits GET there and POST on `/api/v1/spaces`; both inherit the bearer/loopback/trailing-slash posture automatically from the management router.

### D6 — Spec surgery

- `management-http-api`: REMOVED "Loopback and bearer security with a single CLI-backed write endpoint" → ADDED "Loopback and bearer security with CLI-backed mutation" (general rule + enumerated mutating endpoints: POST changes, POST sessions, POST spaces; DELETE sessions/<id> terminates a supervised process and writes no workspace file). REMOVED "The spaces listing is a management endpoint under the same security posture" (its scenario mandates 405 on POST) → ADDED "The spaces path serves listing and creation under the management security posture".
- `change-submission`: REMOVED "Whitelisted operations only, bounded by the slice boundary rule" (mandates exactly one op) → ADDED "Whitelisted operations only, with an enumerated bounded-CLI tier" (four ops, same eligibility rule, agent commands still excluded).
- New capability specs `space-creation`, `local-path-browsing`, `spaces-ui`; `config-key-registry` gets an ADDED-only requirement for `ui.pinnedSpaces` (no existing requirement touched — deliberate, to stay mergeable with W1's parallel delta to the same spec).

## Risks / Trade-offs

- **[`rasen init` interactivity in a subprocess]** init has interactive paths (welcome screen, tool selection). Non-TTY stdio makes `canPromptInteractively()` false, and the 60s timeout + verbatim error passthrough bound any surprise. → Mitigation: an integration test spawning the real CLI `init` in a temp dir through the endpoint path; if a prompt ever blocks, the timeout surfaces it as 504 rather than a hang.
- **[Parallel-worktree merge with W1]** Both children touch `config-keys.ts` and its test. → Mitigation: this change appends exactly one registry entry and one test block; the proposal's merge note flags that W1's "8 global-only keys" count assertion becomes 9; LEAD resolves at merge.
- **[Path disclosure]** local-paths enumerates any absolute path for a token-holding loopback caller. → Accepted: the same caller can already launch unrestricted agent sessions; the endpoint adds convenience, not privilege. The home-only start point keeps the UI from ever suggesting an escalation.
- **[Pin rot]** Pinned selectors can outlive their spaces. → Pins to unlisted spaces are retained in config but not rendered; no auto-pruning (a dead root may be a temporarily absent drive — mirroring the listing's own read-only filtering philosophy).
- **[init on an existing project]** `kind:'project'` at an already-initialized root runs init's extend mode. → Accepted: idempotent-ish by the CLI's own semantics; the response still reports the (existing) space; CLI refusals (e.g. pointer repo) pass through as 422 verbatim.

## Migration Plan

Purely additive: new routes, new key, new page. Rollback = revert. No data migration; pins absent = today's behavior; old UIs ignore the new endpoints.

## Open Questions

None. Design-doc open questions 6, 7, 8 are resolved in D3, D4, D5 respectively.
