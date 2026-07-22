## 1. Space selector resolution seam (design D1/D2/D5)

- [x] 1.1 Add space selector parsing + resolution in `src/core/config-api/project-addressing.ts` (or a sibling module it re-exports): `parseSpaceSelector` (`project:`/`store:` prefix split, 400 `invalid_space` on missing prefix) and `resolveSpaceSelector` → `{ type, id, name, root }`; `project:` delegates to `resolveProjectSelector`; `store:` resolves the store-namespace registry entry and runs `inspectRegisteredStore` read-only (404 `space_not_found`, 409 `space_unavailable` with inspection reason). All root comparisons via `FileSystemUtils.canonicalizeExistingPath`.
- [x] 1.2 Add the shared cwd→space derivation `deriveSpaceFromCwd` (design D5): nearest qualifying root walk; planning shape → project space (registry entry id, else config projectId); config-only + valid `store:` pointer to a registered store → store space; malformed/unregistered → null. Importable by both `commands/` and `core/management-api/`.
- [x] 1.3 Unit tests for 1.1/1.2: both namespaces, shared-id disambiguation, bare-selector rejection, Windows path-form selector (case/separator variants), pointer-repo derivation, degradation cases.

## 2. Management router: per-request space + per-space home cache (design D2/D7)

- [x] 2.1 Replace `server.ts`'s single `cachedHome` with a per-space home cache keyed by canonical root (`resolveProjectHome(root, { ensure: false })`, null-retry semantics preserved); thread a `resolveSpace(request)` helper through `createManagementRouter` that applies explicit-selector-else-launch-project fallback.
- [x] 2.2 `GET /api/v1/changes` and `GET /api/v1/runs` accept `?space=`; handlers receive the resolved space root + its home instead of `context.launchProjectRoot`; selector-less behavior byte-compatible with today (including `/changes` 400 `project_required` and `/runs` empty-list postures when no launch project).
- [x] 2.3 `POST /api/v1/changes` accepts body `space`; `createChangeSubmitter` takes the resolved space root as subprocess cwd (spec: cwd never client free text — reject unresolvable selectors before spawn; keep 409 `no_project` when neither selector nor launch project).
- [x] 2.4 Router/handler tests: cross-space reads (daemon launched in project A answering for project B and a store), submission landing in a selected store root, unresolvable-selector errors, no-selector compat suite still green.

## 3. Sessions: space attribution, filtered listing, space-aware launch (design D3)

- [x] 3.1 Add `space?: { type, id, root }` to `SessionRecord` + `SessionRecordWire`; `handleLaunchSession` accepts body `space`, resolves it (else launch-project fallback), passes the space root as `supervisor.launch` cwd, and stamps the frozen attribution (explicit space verbatim; otherwise `deriveSpaceFromCwd(cwd)`).
- [x] 3.2 `GET /api/v1/sessions` accepts `?space=`: filter by canonical `space.root` equality; unattributed sessions only in unfiltered listing; run-state join per session's own space root + per-space home (replacing the global launchProjectRoot/home pair).
- [x] 3.3 Session tests: launch into explicit space sets cwd + attribution, unresolvable selector spawns nothing, filtered vs unfiltered listings, join reads the session's own space (change in space B joined correctly while daemon launched in A), attribution frozen across pointer change.

## 4. Spaces listing endpoint (design D4/D6)

- [x] 4.1 Implement `GET /api/v1/spaces` in the management route group: project spaces (project registry, `mode: 'in-repo'`, live roots), store spaces (store-namespace entries, live roots) with `members` derived from `mode: 'store'` entries validated at read time against each member's current `store:` pointer (live member roots only); dedupe project entries whose canonical root equals a store root; wire types in `wire-types.ts`.
- [x] 4.2 Endpoint tests: type tags, dead-root filtering in both namespaces (registry untouched — byte-compare the file), store-root dedupe, member validation (pointer moved away → excluded), 401/405 posture, trailing-slash tolerance.

## 5. `rasen ui` space-bearing URL (design D5)

- [x] 5.1 In `ui-launch.ts`, derive the cwd space before URL emission on BOTH forms (adopt-or-spawn and `--no-daemon`); for a project space, ensure-register first (`resolveProjectHome(root, { ensure: true })`) so the emitted id resolves; append `?space=<selector>` before `#token=`; no space → URL unchanged.
- [x] 5.2 Launch tests: project cwd → `?space=project:<id>` present and resolvable; pointer repo → `?space=store:<id>`; outside any root → no parameter; unregistered project registered during launch.

## 6. Verification and ship notes

- [x] 6.1 Full `pnpm test` on Windows green (known EBUSY/10s-timeout flakes per repo memory: isolate-rerun before judging regressions); `pnpm build` clean.
- [x] 6.2 Confirm the uncommitted precursor fixes (vitest.setup.ts, test/core/init.test.ts isolation; config-api router listProjects filter + its tests) are intact in the diff and covered by the config-http-api delta — ship includes them, never reverts them.
- [x] 6.3 Grep audit: no management data handler reads `context.launchProjectRoot` except through the fallback seam (`/status`//`/health` hint reporting exempt); no daemon-side call path reaches `registerProject`/`touchProjectRegistry`/`ensureStoreMetadata`-with-write (red line: resolution is read-only).
