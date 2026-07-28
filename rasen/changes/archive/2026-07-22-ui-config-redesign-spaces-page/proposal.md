## Why

The only way to change planning space in the web UI is a single unfiltered `<select>` fed by one `GET /api/v1/spaces` fetch — workable at 5 spaces, unusable at 40 (no search, no ordering, no cap). And there is no way to create a space from the UI at all: initialising a project or registering a store requires returning to a terminal, breaking the "manage from the browser" story the platform is building. This change implements W6 of the ratified ui-config-redesign design: a dedicated `/spaces` page that absorbs scale, a capped fast-path switcher, and a create-space flow whose only write mechanism is spawning the CLI.

## What Changes

- **New `/spaces` route** (space-agnostic — it sits above the space model, no `/p/…`/`/s/…` prefix): lists every addressable space from the existing `GET /api/v1/spaces` response (projects, stores, store members), with client-side search over id/name/root and pinning. Pins persist in a new global config key **`ui.pinnedSpaces`** (`scopes: ['global']`, `type: 'array'` of `<type>:<id>` selectors — same shape as the existing `workflows` key) written through the existing config API, so pins survive a browser change and stay visible to the CLI. Pinned spaces sort first.
- **Header switcher capped**: the `SpaceSwitcher` keeps the fast path but renders at most ~8 entries (pinned first, then most-recently-visited from client-side memory), with a trailing **"All spaces…"** item routing to `/spaces`.
- **`GET /api/v1/local-paths`** (new, management route group, GET-only): server-side directory enumeration for the create-space picker — `{ path, parent, separator, entries: [{ name, isDir, isGitRepo }] }`, plus a home start-point response when no path is given. **Traversal rule (resolves design open question 6)**: with no `path` the server offers only the user's home as the start point (it never suggests locations above home unprompted); any client-supplied **absolute** path is enumerated (this is the explicit escape hatch — repos on another drive are reachable by typing the path); relative paths are rejected. Loopback + bearer token, read-only, structured errors for missing/forbidden/non-directory paths.
- **`POST /api/v1/spaces`** (new): `{ kind: 'project' | 'store', path, id? }` creates a space **exclusively by spawning the CLI as a subprocess** (same machinery pattern as change submission: own-installation entry, argv array, `shell: false`, cwd never client free text, timeout + SIGTERM/SIGKILL, cap-1 concurrency, CLI errors passed through verbatim). **Resolves design open question 7 — registering an existing store IS covered**: `kind: 'project'` spawns `rasen init <path>`; `kind: 'store'` spawns `rasen store register <path> --yes [--id <id>] --json` when the target directory already contains a `rasen/` root, else `rasen store setup <id> --path <path> --json` (id required in that branch). The response reports the operation performed plus the new space entry (re-read from the spaces listing), and the UI routes straight into the new space.
- **Whitelist growth (resolves design open question 8)**: the three create operations become new rows in the existing admission whitelist's bounded-CLI tier (deterministic, bounded, no LLM, no resident process, observable via `GET /api/v1/spaces`) — the same single-admission-source mechanism change submission uses, not a parallel path. Pre-spawn validation: `path` must be an absolute, control-character-free path (absoluteness doubles as the option-injection guard — an absolute path cannot begin with `-`); `id` must pass the CLI's own store-id validation; all values bound as discrete argv tokens.
- **Stale spec clause fixed in the same delta**: `management-http-api` still says `POST /api/v1/changes` "SHALL be the only mutating endpoint" — already false since sessions. Restated as the general rule: the server never writes workspace files; every workspace-mutating endpoint mutates exclusively by spawning the CLI.
- **Unchanged**: `GET /api/v1/spaces` read behavior (resolution stays non-mutating; dead-root filtering stays read-only); visual style (warm-editorial + CRT toggle); config-endpoint addressing (W1's business — this change does not touch the config API surface beyond registering the one new key).

## Capabilities

### New Capabilities

- `space-creation`: the `POST /api/v1/spaces` contract — kinds, CLI verb selection, validation and injection posture, confinement (timeout, cap-1), response shape, error passthrough, whitelist membership.
- `local-path-browsing`: the `GET /api/v1/local-paths` contract — response shape, home start point, absolute-path rule, git-repo detection, read-only guarantee, security posture.
- `spaces-ui`: the `/spaces` page (list, search, pin, create flow, route-into-new-space) and the capped header switcher with the "All spaces…" escape.

### Modified Capabilities

- `management-http-api`: the "only mutating endpoint" clause becomes the general CLI-spawn rule with the mutating endpoints enumerated; the spaces path additionally admits POST (its requirement currently mandates 405 for POST).
- `change-submission`: the whitelist requirement currently mandates "exactly one operation: create-change"; it grows to enumerate the bounded-CLI tier's four operations (create-change plus the three space-creation operations) under the same eligibility rule.
- `config-key-registry`: additive — a new `ui.pinnedSpaces` global-only array key (no existing requirement's scenario set changes; new requirement only).

## Impact

- **Server**: `src/core/management-api/router.ts` (route admission for `/api/v1/local-paths` GET and `/api/v1/spaces` POST), new `src/core/management-api/local-paths.ts` and `src/core/management-api/create-space.ts`, `src/core/management-api/whitelist.ts` (+3 bounded-cli rows), `src/core/management-api/wire-types.ts` (request/response shapes).
- **Config**: `src/core/config-keys.ts` (+1 global entry `ui.pinnedSpaces`), `src/core/config-schema.ts` (typed `ui` block), `src/core/global-config.ts` (`GlobalConfig.ui`), `src/commands/config.ts` (editor treats the key as list-managed, like `workflows`).
- **UI**: new `packages/ui/src/components/SpacesPage.tsx` (+ create-space flow), `SpaceSwitcher.tsx` (cap + "All spaces…"), `app.tsx` (`/spaces` route), `api/client.ts` + `api/types.ts` (three new calls/shapes), recency memory in localStorage.
- **Specs**: 3 new + 3 delta files; `management-http-api` and `change-submission` deltas use REMOVED + ADDED with distinct requirement names.
- **Tests**: management-api (local-paths, create-space, router admission), config-keys registry, UI (spaces page, switcher cap, bootstrap unaffected).
- **Merge note (portfolio)**: this child is implemented in a parallel worktree while W1 (store-scope) edits `config-keys.ts` and its count-asserting test on the main branch — the registry addition here is deliberately one appended entry + one test block so the LEAD's merge is additive; W1's "8 global-only keys" count assertion becomes 9 at merge time.
