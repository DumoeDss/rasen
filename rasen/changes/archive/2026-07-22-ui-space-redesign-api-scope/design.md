## Context

Every management read (`/changes`, `/runs`, `/sessions` join) and both write bridges (submit, session launch) resolve against `context.launchProjectRoot` — the `rasen/` root found from the daemon's cwd at startup (`src/core/management-api/router.ts:242,259,270,300`; `submit.ts:166`; `sessions.ts:110`). The resident daemon (slice3) outlives any one project, so this binding is stale by design. Config-api already solved half the problem: `resolveProjectContext` accepts `?project=<id|root>` against the machine project registry (`src/core/config-api/router.ts:141`, `project-addressing.ts`). The other half — store spaces — has a complete CLI-side resolution stack (`root-selection.ts`: `resolveStoreRoot`, `inspectRegisteredStore`) that the server has never used.

Two registries with confusingly similar vocabulary are in play:
- **Machine project registry** (`~/.rasen/projects/registry.json`, `project-registry.ts`): every repo the CLI has run in; entries carry `projectId`, `name`, `mode: in-repo | store` (`mode: store` = a config-only pointer repo whose planning lives in a store).
- **Machine store registry** (`~/.rasen/stores/registry.json`, `store/foundation.ts`): registered stores, plus a separate `project:`-prefixed namespace created by `store add-project` (spec-source references — NOT the same thing as the project registry).

Locked portfolio decisions (planning-context.md, user-ratified): top level = planning space (project | store); URL is the source of truth (child 2); daemon is space-agnostic; sessions belong to the space derived from their cwd; daemon = reader + process launcher only, CLI is the only workspace writer.

## Goals / Non-Goals

**Goals:**
- Every management data endpoint answers for an explicitly selected space; omission = launch-project fallback (zero client breakage).
- `store:` spaces resolve read-only through the existing registered-store inspection seam — no new store logic, no daemon-side writes.
- One shared cwd→space derivation used by `rasen ui` (URL emission) and session attribution.
- Store→member reverse enumeration without new persistent state.

**Non-Goals:**
- UI routing/consumption of `?space=` (child 2); Task grouping of `/changes` (child 3); archive listing (child 5).
- No change to CLI `--store`/`--project` flag semantics or to the store-registry `project:` reference namespace.
- No registry schema changes, no version bump.

## Decisions

### D1 — Space selector grammar: `project:<id|root>` | `store:<id>`, in `?space=` / body `space`

One string parameter with an explicit namespace prefix, matching the URL vocabulary child 2 will use (`?space=project:<id>`, `/p/<id>`, `/s/<id>`). After `project:` the selector reuses `resolveProjectSelector` verbatim (projectId first, canonical-root-path second). After `store:` the id resolves via the machine store registry's **store** namespace only. A bare selector (no prefix) is rejected (400 `invalid_space`) rather than guessed — the two namespaces may share ids, so guessing can silently address the wrong space. Missing/empty selector = launch-project fallback. Unresolvable selector = 404 `space_not_found` (message says which namespace was searched); a `store:` id whose registration fails read-only inspection (missing/mismatched metadata, unhealthy root) = 409 `space_unavailable` carrying the inspection reason.

*Alternative rejected:* reusing `?project=` and adding `?store=` (two mutually exclusive params, mirrors CLI flags) — two params on every endpoint plus a precedence rule is more surface than one typed token, and child 2 needs the single-token form in the URL anyway.

*Naming hazard, called out for the implementer:* the API's `project:` prefix addresses the **machine project registry** (config-api namespace) — not the store registry's `project:` reference namespace used by `store add-project`. `resolveSpaceSelector` lives in `config-api/project-addressing.ts` next to `resolveProjectSelector` so the reuse is literal.

### D2 — Space resolution is read-only and per-request; per-space home cache replaces the single launch-home cache

A resolved space = `{ type, id, name, root }` + lazily resolved `ProjectHome | null` (`resolveProjectHome(root, { ensure: false })` — the documented non-mutating probe). `server.ts`'s single `cachedHome` becomes a `Map<canonicalRoot, ProjectHome>` keyed by resolved space root, same null-retry semantics. Store roots resolve through `inspectRegisteredStore` (read-only; never `ensureStoreMetadata`-with-write, never `touchProjectRegistry` from the daemon). A store root that happens to have a project-registry entry gets its home; one that doesn't resolves `home = null` and run-state falls back to legacy change-dir locations — already the supported degradation path in `changes.ts`/`runs.ts`.

### D3 — Sessions: space attributed once at launch, from cwd; listing filter + per-session run-state join

`SessionRecord` gains `space?: { type: 'project' | 'store', id: string, root: string }`, computed at launch time by the shared cwd→space derivation (D5) and frozen on the record (a session's meaning shouldn't drift if registries change mid-run). For UI-launched sessions the space is the request's resolved space (cwd is set to its root, so derivation and selection agree by construction). `GET /api/v1/sessions?space=<selector>` filters records whose `space.root` canonically equals the selected space root; no filter = all sessions (compat). Sessions whose cwd resolves to no space carry `space: undefined` and appear only in the unfiltered listing. The run-state join (`handleListSessions`) switches from the global `launchProjectRoot`/home pair to each record's own `space.root` + per-space home (D2) — this fixes the join being wrong today for any session not launched from the daemon's own project.

`POST /api/v1/sessions` accepts `space` in the body; resolved root becomes `supervisor.launch`'s `cwd`. No selector → launch project (compat); neither → 409 `no_project` (unchanged shape, message updated to mention selecting a space).

### D4 — Store→member reverse enumeration: derive from existing `mode: 'store'` registry entries + read-time pointer validation; no write-back field

The machine project registry already records which repos are pointer repos (`mode: 'store'`, self-healed by `touchProjectRegistry` on every root-resolving CLI command). Members of store S = project-registry entries with `mode: 'store'` whose root still exists AND whose `rasen/config.yaml` `store:` pointer (read at request time via `classifyOpenSpecDir`) names S. This is the planning-context's "write-back + read-time validation" leaning fulfilled by a field that already exists — the candidate index is `mode`, the authority is the pointer file, matching the red line that space semantics derive from workspace files.

*Alternative rejected:* adding `storeId` to `ProjectRegistryEntryState`. `ProjectRegistryEntrySchema` is `.strict()`, so an older CLI reading a registry written with the new field hard-fails (`invalid_project_registry`) — a machine-wide breakage for zero gain, since read-time validation must re-read the pointer anyway and candidate sets are small (registry entries number in the dozens). *Alternative rejected:* full scan of all entries' configs — same reads, just unbounded by `mode`.

Staleness accepted: a repo that became a pointer repo since its last registration shows `mode: in-repo` until any CLI command self-heals it — the repo appears as a (dead-ish) project space instead of a member until then. Cheap, self-correcting, honest.

### D5 — One cwd→space derivation, exported for `rasen ui` and session attribution

`deriveSpaceFromCwd(cwd)`: nearest qualifying `rasen/` root (same walk as `findQualifyingRootSync`); if it has planning shape → project space (identity from the project registry entry, else config `projectId`); if config-only with a valid `store:` pointer → that store's space (id = pointer value, root = registered store root); malformed pointer or unregistered store → no space (callers degrade: `rasen ui` omits the param, session records omit `space`). Lives beside the other resolution seams in `core/` (exact module placement is the implementer's call; it must be importable by both `commands/ui-launch.ts` and `core/management-api/`).

`rasen ui` (CLI side, allowed to write): before emitting the URL, ensure-registers the cwd project (`resolveProjectHome(root, { ensure: true })` — the same thing every root-resolving command already does via touch) so the emitted `project:<id>` selector always resolves against the daemon. URL form: `http://127.0.0.1:<port>/?space=<selector>#token=<t>` — query before fragment, both launch forms (adopt/spawn and `--no-daemon`). Cwd outside any space → URL unchanged from today.

### D6 — `GET /api/v1/spaces`: both namespaces, type-tagged, dead-root filtered, members inline

New management-group endpoint (it serves the board shell, not the config page): `{ spaces: [...] }` where a project space = `{ type: 'project', id: projectId, name, root }` (project-registry entries, `mode: 'in-repo'` only, root exists on disk) and a store space = `{ type: 'store', id, name: id, root, members: [{ projectId, name, root }] }` (store-namespace registry entries, root exists; members per D4, each member's root also existing). Pointer repos are members, not spaces. Dedupe rule: a project-registry entry whose canonical root equals a registered store's root is presented as the store space only (store roots self-register as `in-repo` when the CLI runs inside them — without dedupe every store would appear twice). `/api/v1/projects` keeps its exact shape + dead-root filter for compat.

*Alternative rejected:* members as a separate `/api/v1/stores/<id>/members` endpoint — the switcher needs the whole picture in one request, and the member read is cheap (D4).

### D7 — Daemon demotion is semantic, not structural

`launchProjectRoot`/`launchProjectRef` stay in the context object as the **default hint**: `/health` and `/status` keep reporting `project` (the hint), and selector-less requests keep using it. What changes is that no handler treats it as the only world: every data handler goes through "resolve request space (explicit or fallback)" first. `daemon run` keeps resolving it from cwd for compat; nothing new binds to it.

## Risks / Trade-offs

- [Archive-order collision: slice2/slice3 pending deltas name requirements this change's deltas sit next to] → This change only ADDs requirements in `session-supervision` / `management-ui-command` / `management-http-api`'s endpoint set and MODIFIes only requirements no pending delta modifies (`Changes listing…`, `Run-state reporting…`, `Subprocess confinement…`, config-api's `Localhost config API endpoints` + `Project addressing`); proposal carries the reconcile-at-archive note.
- [Same-id spaces across namespaces mislead users] → prefix is mandatory in selectors (D1); listing type-tags every entry (D6).
- [Store inspection cost on hot read paths] → inspection is two small file reads per request for `store:` selectors only; per-space home cache (D2) absorbs the registry lookup. No caching of inspection results — freshness over micro-latency, same posture as "every read computed fresh from disk".
- [Windows path identity (case, separators, 8.3)] → all root comparisons go through `FileSystemUtils.canonicalizeExistingPath` before equality, as `resolveProjectSelector` and `normalizePathForComparison` already do.
- [Session space frozen at launch can go stale if a repo's pointer changes mid-session] → accepted; a session is an event anchored to where it ran, and re-deriving per read would make records mutate retroactively.
- [`rasen ui` ensure-registration writes from the launcher] → in-contract: `rasen ui` is a CLI command (the writer side of the red line), and it performs exactly the registration any `rasen status` in that cwd would.

## Open Questions

None blocking. Exact module path for `deriveSpaceFromCwd` and whether `spaces.ts` lives in `management-api/` or reuses `config-api` plumbing are implementer-level choices bounded by D5/D6.
