# Design: externalize-artifacts-machine-home

## Context

Decision 4 of `rasen/office-hours/externalize-openspec-artifacts.md` calls for a unified machine home per project. This child builds only the foundation: identity, registry, home layout, resolver, doctor integration. Children 2 (T3 workdir) and 4 (external archive) consume the resolver; they are out of scope here.

Verified current state of the codebase this design builds on:

- The "machine home root" already exists: `getGlobalDataDir()` in `src/core/global-config.ts` (XDG: `$XDG_DATA_HOME/rasen`, Windows `%LOCALAPPDATA%\rasen`, Unix `~/.local/share/rasen`). The design doc's `~/.rasen/` notation is shorthand; the doc's own Decision 2 says "project namespacing via the existing global-data-dir/registry machinery", and the store registry already lives at `<globalDataDir>/stores/registry.yaml`. We do NOT introduce a literal `~/.rasen` directory.
- Reusable atomic-state machinery exists in `src/core/file-state.ts`: `acquireFileLock` (lock file + 30s stale-steal + 5s deadline), `releaseFileLock`, `writeFileAtomically` (temp + rename), `makeLockErrorFactory`. The store registry's `updateStoreRegistryState` (`src/core/store/foundation.ts`) is the read-modify-write-under-lock pattern to copy.
- Project config is `rasen/config.yaml` (`WORKSPACE_DIR_NAME = 'rasen'` in `src/core/config.ts`), parsed resiliently field-by-field in `src/core/project-config.ts` (`readProjectConfig`), created at init by `InitCommand.createConfig` via `serializeConfig` (`src/core/config-prompts.ts`). A second config-creating site exists in `src/core/workspace-root.ts` (~line 266) and must be covered too.
- Root/mode facts: `classifyOpenSpecDir` distinguishes planning-shaped roots from config-only store pointers; `ResolvedOpenSpecRoot.source` is `'store' | 'declared' | 'nearest' | 'implicit'`. `rasen doctor` (`src/commands/doctor.ts`) is a read-only health report built on `inspectRelationships`.
- CLI entry: `runCli` in `src/cli/index.ts` already runs a best-effort startup migration (`migrateLegacyBrandConfig`) before `program.parse` — precedent for a cheap best-effort hook.

Constraint: a concurrent session owns uncommitted edits in `src/core/templates/**`, `src/telemetry/*`, and related tests. This change touches none of those files.

## Goals / Non-Goals

**Goals:**
- Stable project identity that survives repo moves and distinguishes clones.
- One machine-wide project registry with crash-safe, concurrency-safe updates.
- Deterministic per-project home path, shared across git worktrees, forked across clones.
- A frozen resolver API other children can build on without re-litigating layout.
- Doctor visibility and GC for registry rot.

**Non-Goals:**
- T3 `work/` externalization, template edits, archive timing/destination (siblings).
- Merging `stores/registry.yaml` into the project registry (deferred follow-up; see Decision 8).
- Any cross-machine sync of the registry or homes.
- A `--global-data-dir` CLI flag; tests inject `globalDataDir` via options like the store code does.

## Decisions

### D1. Registry location and format (Q4: schema)

`<globalDataDir>/projects/registry.json`, JSON (matching global `config.json`; the design doc names `registry.json`). Homes live beside it: `<globalDataDir>/projects/<home>/`. This mirrors the existing `stores/` namespace (`stores/registry.yaml` + store roots elsewhere) without touching it.

Schema (Zod-validated, strict, like the store registry):

```jsonc
{
  "version": 1,
  "projects": {
    // key: canonical absolute project root (FileSystemUtils.canonicalizeExistingPath)
    "E:\\work\\my-app": {
      "projectId": "6f9c1e2a-…",        // UUID from crypto.randomUUID()
      "name": "my-app",                  // kebab-cased basename of the root at registration
      "mode": "in-repo",                 // "in-repo" | "store"
      "home": "my-app-a1b2c3d4",         // home dir name under <globalDataDir>/projects/
      "lastSeen": "2026-07-09T12:00:00Z" // ISO-8601, refreshed by self-healing
    }
  }
}
```

`home` is stored explicitly rather than re-derived so that (a) instance suffixes are durable and (b) a future rename of the derivation rule cannot silently re-home existing projects. `mode` derives at write time from root resolution: config-only pointer dirs (`classifyOpenSpecDir` → no planning shape + `store:` pointer) register as `store`, everything else `in-repo`. Unknown fields are rejected on write, tolerated-and-dropped on read only via explicit schema evolution (same policy as store registry).

### D2. Locking and atomicity (Q4: locking)

Reuse `file-state.ts` verbatim: `updateProjectRegistryState(updater, {globalDataDir})` acquires `registry.json.lock` via `acquireFileLock` + `makeLockErrorFactory` (subject "the project registry lock file", busy message "Project registry is busy.", code `project_registry_busy`), reads, applies the updater, `writeFileAtomically`, releases. Identical shape to `updateStoreRegistryState` in `store/foundation.ts`. No new locking concepts; the 30s stale-steal and 5s deadline are already tuned for sub-second state writes.

New module `src/core/project-registry.ts` (state, schema, lock) stays independent of `src/core/store/**` except for shared `file-state.ts` — the store registry is not modified.

### D3. Identity: projectId in `rasen/config.yaml`

- Minted with `crypto.randomUUID()` at `rasen init`; init on a config that already has one preserves it.
- Parsed in `readProjectConfig` as optional string (resilient: invalid → warn + drop, like every other field). Non-UUID strings are accepted as opaque IDs (user may hand-author); only non-strings are dropped.
- Serialized by `serializeConfig` when present. For configs that already exist on disk, the ID is APPENDED as a single `projectId: <uuid>` line rather than re-serializing, preserving user comments and layout. `config.yml` variant honored via `resolveConfigFilePath`.

Lazy minting for pre-existing projects: only code paths that actually need the home (i.e. `resolveProjectHome`) mint an ID when missing, append it to the config file, and register. Ordinary commands (list/show/status/self-heal) never write into the repo. Rationale: silently dirtying a user's working tree on a read command is unacceptable (this repo itself has a live concurrent session sharing the tree); but requiring a manual re-init would break sibling children on every pre-existing project. If the config file is unwritable, `resolveProjectHome` fails with a clear fix ("run rasen init" / fix permissions).

### D4. Home naming and the multi-clone suffix rule (Q4: suffix rule)

Base name: `<name>-<shortHash>` where `name` = kebab-cased basename of the project root (reusing the existing kebab utilities in `src/core/id.ts`; fallback `project` if the basename kebab-cases to empty) and `shortHash` = first 8 hex chars of `sha256(projectId)` (`node:crypto`). Readable + collision-free per the design doc.

Registration algorithm, run under the registry lock (this is the Q4 suffix rule):

1. Canonicalize the project root path. If an entry exists for this exact path → update in place (refresh name/mode/lastSeen; `home` and `projectId` never change on update).
2. Else find entries with the same `projectId` at other paths:
   - For each such entry whose path no longer exists on disk → this is a MOVED repo: rebind (delete stale-path entry, create the new-path entry reusing its `home`). Repo moves keep their home and thus their T3 state.
   - For each such entry whose path still exists → same-ID fork. If the new path is a **git worktree of the same repository** as the existing entry (compare `git rev-parse --git-common-dir` resolved from both paths; the repo already shells to git in `src/core/store/git.ts`) → share: register the new path with the SAME `home`. Otherwise it is a true clone → fork: assign `home` = base name + `-2` (`-3`, … first free integer), keep the same `projectId` in the entry (identity is "same lineage", the home is the machine-local instance).
   - If git is unavailable or either path is not a git repo, treat as clone (fork). Forking when unsure costs an extra directory; sharing when wrong cross-contaminates two clones' run-state — fork is the safe default.
3. Create the home directory if absent.

Multiple registry entries may therefore point at one `home` (worktrees) — this is exactly the cross-worktree shared-resume semantics Decision 4 wants.

### D5. Resolver API (frozen for children 2 and 4)

New module `src/core/project-home.ts`:

```ts
export interface ProjectHome {
  projectId: string;
  name: string;
  mode: 'in-repo' | 'store';
  /** Absolute: <globalDataDir>/projects/<home> */
  homeDir: string;
  /** Absolute: <homeDir>/changes/<changeName>/work — T3 root for child 2 */
  workDir(changeName: string): string;
  /** Absolute: <homeDir>/archive — external archive destination for child 4 */
  archiveDir: string;
}

export interface ResolveProjectHomeOptions {
  /** Test/DI override; defaults to getGlobalDataDir() (store-code precedent). */
  globalDataDir?: string;
  /**
   * true (default): mint projectId + register + create the home dir if needed.
   * false: resolve only; returns null when the project has no identity yet.
   */
  ensure?: boolean;
}

/** projectRoot = directory containing rasen/ (a planning root, repo- or store-side). */
export async function resolveProjectHome(
  projectRoot: string,
  options?: ResolveProjectHomeOptions
): Promise<ProjectHome | null>;
```

Design choices: (a) takes an explicit `projectRoot` rather than resolving cwd itself, so callers thread the already-resolved root (`ResolvedOpenSpecRoot.path` / `PlanningHome.root`) and resolution logic is not duplicated; (b) `ensure:false` gives read-only consumers (doctor, status displays) a non-mutating probe; (c) `workDir`/`archiveDir` are provided by THIS child so children 2/4 consume paths instead of re-deriving layout — the home's internal layout is decided once, here (`changes/<name>/work/`, `archive/`, both per the design doc). The resolver creates `homeDir` itself when ensuring but does NOT pre-create `changes/` or `archive/` — consumers create what they use.

### D6. Self-healing on CLI runs

A best-effort, throttled touch: after a command resolves a planning root (hook point: `resolveRootForCommand` in `src/core/root-selection.ts`, the single funnel every root-using command already goes through), if the project's config carries a `projectId`, update the registry when — and only when — something changed (new path binding, changed name/mode, or `lastSeen` older than 24h). All errors swallowed; a broken registry must never break a user command (matching `migrateLegacyBrandConfig`'s contract). No minting here (see D3). The 24h `lastSeen` throttle keeps the common case write-free and lock-free (a pure read of registry.json, skipped entirely when the config has no projectId).

### D7. Doctor reporting and GC

`rasen doctor` gains a "Machine home" section (human + `--json`): this project's entry (home path, projectId, lastSeen) or "not registered", plus dangling entries — registry keys whose path no longer exists and is not covered by a rebind candidate. `rasen doctor --gc` (explicit opt-in flag; doctor stays read-only by default per its documented contract) deletes dangling entries under the lock and removes home directories no remaining entry references. GC never touches the store registry and never deletes a home referenced by any live entry (worktree sharing makes reference counting mandatory).

### D8. stores.json merge timing (Q4: defer)

The store registry (`stores/registry.yaml`) stays untouched. Merging it into the project registry is mechanical once both live under `<globalDataDir>` with the same lock machinery, but it churns store resolution and its error taxonomy for zero user-visible gain in this portfolio. Recorded as a follow-up, not scheduled.

## Risks / Trade-offs

- [Two clones registered before one is deleted leave a `-2` home forever] → doctor --gc removes it once its entry dangles; acceptable rot surface.
- [Worktree detection shells to git per NEW registration only] → cost bounded to first-run registration and same-ID forks; ordinary runs never invoke git.
- [Appending `projectId:` to a user-edited config could collide with a YAML edge (e.g. trailing block scalar)] → append with a guaranteed leading newline and re-read/validate after write; on validation failure, revert the append and fail with a clear message.
- [Concurrent rasen processes registering the same new project] → registry lock serializes; second writer's updater sees the first's entry (path-exact match) and becomes an update-in-place.
- [Case-insensitive filesystems produce path-key mismatches] → keys go through `FileSystemUtils.canonicalizeExistingPath` (already the store code's answer to the same problem).
- [Windows: registry writes hitting EBUSY under test parallelism] → same exposure as the store registry today; tests reuse the store tests' isolation patterns (`globalDataDir` per-test temp dirs).

## Migration Plan

Purely additive. No existing on-disk state changes shape. Projects without a projectId behave exactly as before until a home-needing feature (child 2+) or `rasen init` runs. Rollback = removing the code; stray `projects/` state is inert.

## Open Questions

None blocking. (Q4's sub-questions are answered above: schema D1, locking D2, suffix rule D4, stores merge D8.) One deliberate deferral: whether `name` in the registry should refresh when a repo directory is renamed in place — current answer: `name` refreshes on self-heal but `home` never changes (stability beats prettiness); revisit only if users complain about stale home names.
