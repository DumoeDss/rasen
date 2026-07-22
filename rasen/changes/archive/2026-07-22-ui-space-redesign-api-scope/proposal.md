## Why

The management UI's project switcher is unreliable ("switching project does nothing") because every management endpoint is hard-bound to the daemon's `launchProjectRoot` — whichever directory the resident daemon happened to be started from. With a resident daemon adopted across terminals, that binding is wrong by construction: the daemon outlives any single project context. This child is the server/CLI foundation of the `ui-space-redesign` portfolio: it makes every management read/write addressable by an explicit planning space (project or store) so the UI (children 2–5) can make the URL the source of truth.

## What Changes

- Management endpoints (`GET /api/v1/changes`, `GET /api/v1/runs`, `POST /api/v1/changes`, `GET/POST /api/v1/sessions`) accept an explicit planning-space selector spanning both namespaces: `project:<id|root>` (machine project registry, reusing `resolveProjectSelector`) and `store:<id>` (machine store registry). A missing selector falls back to the daemon's launch project, so every existing client keeps working.
- The daemon becomes space-agnostic: `launchProjectRoot` is demoted to a default hint (still reported by `/health` and `/status`); no data path requires the daemon to have been started inside the project it serves.
- Each supervised session records its planning space, derived from its cwd at launch (the repo's own `rasen/` root, or the store its config `store:` pointer names); `GET /api/v1/sessions` is filterable by space, and each session's run-state join resolves against its own space rather than the launch project.
- New space listing endpoint `GET /api/v1/spaces` returns both namespaces with type tags — in-repo projects from the machine project registry plus registered stores — with dead-root entries filtered and store entries carrying their member projects (reverse enumeration of the one-way `store:` pointer, derived from registry `mode: store` entries validated against each member's config at read time).
- `rasen ui` resolves the cwd's planning space at launch (ensure-registering it via the CLI's own write path), and puts it in the opened URL as `?space=project:<id>` / `?space=store:<id>` instead of relying on the daemon's launch binding. URL routing that consumes the parameter is child 2.
- `GET /api/v1/projects` keeps its shape for compat, retaining the dead-root filter already in the working tree.

**Not in scope:** any `packages/ui` change (children 2–5); Task entity semantics; Archive listing API (child 5).

**Ship note:** the working tree carries uncommitted precursor fixes belonging to this portfolio (test isolation in `vitest.setup.ts`/`test/core/init.test.ts` and the `handleListProjects` dead-root filter in `src/core/config-api/router.ts`). Child 1's ship includes them (or commits them first, shipper's call) — they must not be dropped or reverted.

**Archive-order note:** unarchived changes `platform-slice2-task-submission`, `slice3-session-runtime`, and `slice3-daemon-residency` hold pending deltas for `change-submission`, `management-http-api`, and `management-ui-command` whose content is already reflected in main specs. This change's deltas deliberately avoid MODIFYING any requirement those pending deltas also touch (`Loopback and bearer security…`, `Whitelisted operations only…`, `Public management platform launch command`, `Clean shutdown`); the one exception-adjacent edit (`Subprocess confinement` in `change-submission`) is touched only by slice2's stale ADDED delta, which is already in main — reconcile at archive time by archiving the slice2/slice3 leftovers first.

## Capabilities

### New Capabilities
- `planning-space-addressing`: the planning-space model for the management platform — the dual-namespace space selector grammar and resolution rules, the cwd→space derivation rule shared by `rasen ui` and session attribution, the space listing with store-member reverse enumeration, and the daemon's space-agnostic posture (launch project as hint only).

### Modified Capabilities
- `management-http-api`: `GET /api/v1/changes` and `GET /api/v1/runs` accept the space selector and answer for the selected space; fallback-to-launch-project compat when omitted.
- `change-submission`: the submission subprocess's working directory is locked to the server-resolved space root (selected space, or launch project when no selector) — still never client-controlled free text.
- `session-supervision` (pending capability, delta ADDED only): sessions carry a cwd-derived space attribution; the listing is space-filterable; launch accepts a space selector that sets the subprocess cwd to the space root.
- `config-http-api`: the registered-projects listing filters entries whose root no longer exists on disk (read-only filtering; pruning stays with `rasen doctor --gc`).
- `management-ui-command`: the launch URL carries the cwd-resolved space selector (new requirement; the existing launch-command requirement is left untouched for the pending daemon-residency delta).

## Impact

- `src/core/management-api/`: `router.ts` (selector parsing + space resolution per request), `changes.ts`, `runs.ts`, `sessions.ts`, `submit.ts` (space-root cwd), `session-registry.ts`/`supervisor.ts` (space field on records), `wire-types.ts` (space on session records, spaces listing shapes), `server.ts` (per-space home resolution replacing the single launch-home cache).
- `src/core/config-api/`: `router.ts` (spaces endpoint or delegation seam; projects filter already in tree), `project-addressing.ts` (space selector resolution helper), `wire-types.ts`.
- `src/commands/ui-launch.ts` (cwd space resolution + URL query), `src/commands/daemon.ts` (unchanged posture, hint semantics documented).
- Read-only reuse of `src/core/root-selection.ts` inspection seams (`inspectRegisteredStore`) and `src/core/store/registry.ts` (`listRegisteredStores`) for `store:` resolution — the daemon stays a reader; all workspace writes remain CLI subprocesses.
- No version bump. Windows-safe path handling throughout (canonical-path comparisons via `FileSystemUtils`).
