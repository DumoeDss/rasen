# Tasks: externalize-artifacts-machine-home

## 1. Config identity (projectId)

- [x] 1.1 Add optional `projectId` (string) to `ProjectConfigSchema` and resilient parsing in `src/core/project-config.ts` (valid string exposed; non-string warned and dropped; absence silent)
- [x] 1.2 Extend `serializeConfig` in `src/core/config-prompts.ts` to emit `projectId` when present (fresh-config path)
- [x] 1.3 Add `ensureProjectIdInConfig(projectRoot)` helper: read via `resolveConfigFilePath`; if missing, mint `crypto.randomUUID()` and APPEND a `projectId:` line preserving existing content/comments (guaranteed leading newline; re-read and validate after write, revert append on validation failure); honor `config.yml`
- [x] 1.4 Unit tests: parse valid/invalid/absent projectId; append-preserves-comments; append to `config.yml`; append validation-failure revert

## 2. Project registry core (`src/core/project-registry.ts`)

- [x] 2.1 Define Zod schema + types for `{version: 1, projects: Record<canonicalAbsPath, {projectId, name, mode, home, lastSeen}>}` with strict parsing and clear diagnostics naming `<globalDataDir>/projects/registry.json` (mirror `store/foundation.ts` error style)
- [x] 2.2 Implement `readProjectRegistryState` / `writeProjectRegistryState` / `updateProjectRegistryState` reusing `file-state.ts` (`acquireFileLock` on `registry.json.lock`, `writeFileAtomically`, `makeLockErrorFactory` with code `project_registry_busy`); `globalDataDir` injectable via options like `StorePathOptions`
- [x] 2.3 Implement home-name derivation: kebab-cased root basename (reuse `src/core/id.ts` utilities, fallback `project`) + `-` + first 8 hex of sha256(projectId) (`node:crypto`)
- [x] 2.4 Implement `registerProject` under the lock per design D4: path-exact update-in-place; moved-repo rebind (stale path deleted, home reused); worktree share (compare resolved `git rev-parse --git-common-dir` of both paths — add helper in or beside `src/core/store/git.ts`); clone fork with first-free `-N` suffix; fork when relationship undeterminable; canonicalize all path keys with `FileSystemUtils.canonicalizeExistingPath`
- [x] 2.5 Unit tests: schema round-trip; concurrent `updateProjectRegistryState` writers both land; register/update idempotence; rebind, fork-suffix, worktree-share, undeterminable-defaults-to-fork; Windows path canonicalization (per-test temp `globalDataDir`)

## 3. Resolver API (`src/core/project-home.ts`)

- [x] 3.1 Implement `resolveProjectHome(projectRoot, {globalDataDir?, ensure?})` returning `ProjectHome` (`projectId`, `name`, `mode`, `homeDir`, `workDir(changeName)`, `archiveDir`) per design D5; `ensure: true` (default) mints identity via 1.3, registers via 2.4, and creates `homeDir` (but not `changes/`/`archive/`); `ensure: false` is a pure probe returning null when unregistered/no identity; mode derived from `classifyOpenSpecDir` (config-only store pointer → `store`, else `in-repo`)
- [x] 3.2 Unit tests: ensure-mode end-to-end on a fresh temp project (config gains projectId, registry entry exists, home dir created, paths absolute and platform-joined); probe mode creates nothing; unwritable config fails with actionable message

## 4. Init integration

- [x] 4.1 Wire `InitCommand` to call `resolveProjectHome(..., {ensure: true})` after workspace creation; catch and downgrade registration failures to a warning (repo-side init still succeeds); print `Machine home: <path>` in the success summary
- [x] 4.2 Cover the second config-creation site (`src/core/workspace-root.ts` ~line 266) so configs created there also receive a projectId
- [x] 4.3 Tests: fresh init registers + creates home; re-init preserves projectId/entry/home; registry write failure → warning, exit 0

## 5. Self-healing hook

- [x] 5.1 Add best-effort `touchProjectRegistry(root)` invoked from `resolveRootForCommand` (`src/core/root-selection.ts`): skip when config has no projectId; read-only fast path when entry current and `lastSeen` < 24h; otherwise update binding/name/mode/lastSeen under lock; swallow all errors
- [x] 5.2 Tests: refresh on stale `lastSeen`; rebind on moved path; no write when current; corrupt registry does not break the command

## 6. Doctor reporting and GC

- [x] 6.1 Extend doctor gathering (`src/commands/doctor.ts` / `src/core/relationship-health.ts`) with a machine-home section: current project's entry (home path, projectId, lastSeen) or "not registered", plus dangling entries (registered paths that no longer exist); include in `--json` and human output
- [x] 6.2 Add `rasen doctor --gc`: under the lock, remove dangling entries; delete home dirs no remaining entry references (reference-count across entries; never delete a still-referenced home); report what was removed
- [x] 6.3 Tests: dangling entry reported with `--gc` suggestion; GC removes entry + orphaned home; GC keeps a home shared with a live (worktree) entry; default doctor performs no writes

## 7. Verification and follow-up notes

- [x] 7.1 Run `pnpm build` and the full `pnpm test` on Windows (this machine); isolate-rerun any CLI-spawning EBUSY flakes before treating them as failures; confirm no files owned by the concurrent session (`src/core/templates/**`, `src/telemetry/*`, related tests) are touched by `git status`
- [x] 7.2 Record follow-ups in the change dir: stores-registry merge deferred (design D8); template/T3 consumers arrive in child `externalize-artifacts-t3-workdir`

## Follow-ups (task 7.2)

- **Stores-registry merge deferred (design D8).** `stores/registry.yaml` and the
  new `projects/registry.json` stay separate machine-local registries under the
  same `<globalDataDir>`, sharing only the `file-state.ts` lock machinery.
  Merging them is mechanical (same lock, similar shape) but was deliberately
  left out of scope here — see design.md D8 for the full rationale. No action
  needed unless a future change wants to unify project/store identity.
- **Template and T3 consumers arrive in child `externalize-artifacts-t3-workdir`.**
  This child intentionally touches no files under `src/core/templates/**` (a
  concurrent session owned that directory during this work) and does not wire
  any workflow template to `resolveProjectHome`'s `workDir()`/`archiveDir`. The
  next child in the portfolio (`externalize-artifacts-t3-workdir`) is expected
  to: (1) audit template-written ephemera paths, (2) switch them to the
  CLI-resolved `workDir(changeName)`, and (3) update CLI readers (e.g.
  `pipeline resume`) to follow. The resolver API (`ProjectHome`) is frozen and
  ready to consume as-is — see the "From child 1 implementation" entry in
  `rasen/changes/externalize-artifacts/planning-context.md` for the exact
  shape and gotchas (worktree-share git cost, `ensure:false` probe semantics,
  the `rasen init` extend-mode behavior change).
