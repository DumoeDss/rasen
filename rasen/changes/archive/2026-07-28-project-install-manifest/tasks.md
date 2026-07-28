## 1. Project config schema and resilient parser

**Files**
- `src/core/project-config.ts`

**Changes**
- Add `tools: z.array(z.string().min(1)).optional()` to `ProjectConfigSchema`.
- Add `update: z.object({ pin: z.boolean().optional() }).optional()` to `ProjectConfigSchema` (the `update:` map is reserved for future update-related config; only `pin` is parsed today).
- Extend `parseProjectConfigContent` to parse both keys field-by-field using the existing resilient `warnConfig` pattern. Drop invalid values with new diagnostic keys (`invalidTools`, `invalidToolsEntries`, `invalidUpdate`, `invalidUpdatePin`) so an invalid sibling never breaks the rest of the config. Mirror the existing pattern for `workflows`/`profile`.
- Add both keys to the exported `ProjectConfig` type.

**Tests** (`tests/core/project-config.test.ts`)
- `tools: [claude]` parses to `{ tools: ['claude'] }`.
- `tools: [claude, 42]` drops the numeric entry with a warning; `claude` survives.
- `tools: "claude"` (non-array) drops with a warning.
- `tools: []` parses to `{ tools: [] }`.
- `update.pin: true` parses to `{ update: { pin: true } }`.
- `update: "yes"` (non-map) drops with a warning.
- Config without either key still loads cleanly.

## 2. Project registry schema: optional cache fields

**Files**
- `src/core/project-registry.ts`

**Changes**
- Extend `ProjectRegistryEntryState` with `tools?: string[]`, `installedVersion?: string`, `lastUpdated?: string`.
- Extend `ProjectRegistryEntrySchema` (still `.strict()`) with the same optional fields. The strict check continues to reject unknown top-level keys; the new optional keys are known, so a newer registry parses and an older entry (without the fields) parses.
- Extend `RegisterProjectInput` with optional `tools?: string[]` and `installedVersion?: string`.
- In `registerProject`/`place`, when `input.tools` or `input.installedVersion` is supplied, write them onto the placed entry. When the caller does not supply them, PRESERVE the existing entry's values on path-exact / worktree-share / moved-repo dispositions (do not reset to undefined). A fresh entry (clone-fork path) inherits whatever the caller supplied, or starts with the fields absent.
- Document near `place`: cache fields never affect home naming, the home-never-renamed invariant, or path-exact/worktree/move dispositions.

**Tests** (`tests/core/project-registry.test.ts`)
- Round-trips the new fields through `serializeProjectRegistryState` → `parseProjectRegistryState`.
- An entry written without the new fields (legacy shape) still parses under the new schema; absent fields read as `undefined`.
- An entry written WITH the new fields still parses under a schema instance that lacks them (back-compat with older binaries — simulated by parsing with a stripped-down schema fixture).
- `.strict()` still rejects genuinely unknown keys (e.g. `color: 'red'`).
- `registerProject` with `tools` + `installedVersion` supplied on a fresh entry writes them.
- `registerProject` on a path-exact existing entry, WITHOUT supplying cache fields, preserves the existing entry's cache fields.

## 3. Tool-selection resolver: manifest with migration fallback

**Files**
- `src/core/shared/tool-detection.ts` (new exported helper, co-located with the existing detection primitives)

**Changes**
- New exported helper `resolveConfiguredTools(projectRoot): { tools: string[]; seeded: boolean }`:
  1. Read `rasen/config.yaml` via `readProjectConfig`. If `tools` is present (even if empty), return `{ tools: config.tools, seeded: false }`. This is the authoritative set.
  2. If `tools` is absent, compute the seed set as the union of `getConfiguredTools(projectRoot)` and `getCommandConfiguredTools(projectRoot)` (the existing on-disk signals). Write `tools: <seed>` into `rasen/config.yaml` via `updateProjectConfigKey(projectRoot, 'tools', seed)`. Return `{ tools: seed, seeded: true }`.
  3. If the config write fails (read-only, parse failure), log a warning naming the config path and return the in-memory seed for the current run (never abort). `seeded` remains `true` so the caller can log the migration intent, but the config is not modified.
  4. If the config itself cannot be parsed (readProjectConfig returned `null` because of a YAML error, not just absence), behave as the write-failed path: fall back to on-disk detection for the current run.

**Tests** (`tests/shared/tool-detection.test.ts` or co-located)
- Returns manifest verbatim when present (including empty list).
- Seeds from skill-configured tools when manifest absent.
- Seeds from skill+command union when commands-only legacy install.
- Idempotent on second call (no rewrite, `seeded: false`).
- Falls back to on-disk when config write fails; returns a non-empty list for the current run.
- Falls back to on-disk when config is unparseable; logs a warning.

## 4. `rasen init` persists tool selection

**Files**
- `src/core/init.ts`

**Changes**
- After successful tool setup (after `generateSkillsAndCommands` returns, before the success message), call `updateProjectConfigKey(projectPath, 'tools', validatedTools.map(t => t.value))`. This overwrites any prior `tools:` value.
- Wrap the write in a try/catch. On failure, emit a yellow warning naming the config path and continue — init has already created the skill files, and the next `rasen update` will seed the manifest through the migration path.
- Skip the write when `pointerToolOnlySelection !== undefined` AND no project-local `rasen/` was created (the externalized-repo pointer-only case). In all other paths (fresh init, extend mode, pointer-with-explicit-tools at the root), the write happens.

**Tests** (`tests/commands/init.test.ts`)
- Fresh interactive init with [Claude Code, Codex] writes `tools: [claude, codex]`.
- Re-init with a different selection overwrites the prior `tools:` value (no union).
- `--tools claude` writes `tools: [claude]`.
- `--tools none` writes `tools: []`.
- Config-write failure emits a warning and exits successfully.
- Pointer-only init (externalized repo, `--tools codex` at root) does NOT attempt to write `tools:` into a config that does not exist locally (the existing pointer guard already prevents the planning-shape write; the tools write follows the same gate).

## 5. `rasen update` honors the manifest

**Files**
- `src/core/update.ts`

**Changes**
- Replace the existing `configuredTools` computation (the union of `getConfiguredToolsForProfileSync` and `getCommandConfiguredTools`) with a call to `resolveConfiguredTools(resolvedProjectPath)`.
- When `seeded === true`, log an informational line: `Seeded tools: <list>` (or the locale-equivalent), so the user sees the one-time migration happened.
- The rest of update's logic (version status, profile sync, skill generation, learned reconciliation, cleanup) operates on the manifest-resolved list unchanged.
- The existing `detectNewTools` advisory continues to fire for tool directories present on disk but absent from the manifest — its message already points at `rasen init`, which is now the only path to add a tool.
- The empty-manifest case (`tools: []`) flows through the existing "No configured tools found." branch without scanning the disk.

**Tests** (`tests/commands/update.test.ts`)
- Manifest `[claude]` refreshes only Claude even when `.codex/skills/rasen-propose/SKILL.md` exists; Codex is reported via the new-tool-detection advisory.
- Absent manifest seeds and proceeds; the seed message is printed exactly once.
- Empty manifest shows "No configured tools found." without scanning the disk.
- Manifest `[claude, codex]` with `.codex/skills/` deleted regenerates Codex's skills (manifest is authoritative, not disk state).
- Second run after seeding does not re-seed (idempotent).

## 6. Registry self-heal learns `installedVersion` and mirrors `tools`

**Files**
- `src/core/project-home.ts`

**Changes**
- In `touchProjectRegistry`, after determining a refresh is needed (entry is missing, path/name/mode drifted, or `lastSeen` is stale):
  1. Read `rasen/config.yaml` via `readProjectConfig`. If `tools` is present, capture it for the cache mirror.
  2. Find one surviving skill file via the same iteration `getToolVersionStatus` uses (the first existing `SKILL.md` across `SKILL_NAMES × configured tools`), then `extractGeneratedByVersion(skillFilePath)`. If non-null, capture it for `installedVersion`.
  3. Pass `tools` and `installedVersion` into the `registerProject` call. Set `lastUpdated` to `now()` inside `registerProject`'s entry construction (or accept it as part of `RegisterProjectInput`).
- All failures are swallowed (the existing `catch {}` around the self-heal body already enforces the "registry problems never break a user command" contract).
- The 24h staleness threshold that already gates `lastSeen` refresh also gates the version refresh — a cache written within 24h is not re-read.

**Tests** (`tests/core/project-home.test.ts`)
- Touch with a project that has a skill file stamped `0.1.7` writes `installedVersion: "0.1.7"`.
- Touch with no skill files on disk leaves `installedVersion` absent.
- Touch with a corrupt skill `SKILL.md` (no frontmatter) does not throw.
- Touch mirrors `tools: [claude]` from config into the cache when config is readable.
- Touch with a stale cache (>24h) re-reads `generatedBy` and updates.
- Touch with a fresh cache (<24h) does not re-read.

## 7. `rasen update` writes version cache after success

**Files**
- `src/core/update.ts`, `src/core/project-home.ts` (or `src/core/project-registry.ts` directly)

**Changes**
- After the successful update summary, refresh the current project's registry entry. Preferred seam: extend `touchProjectRegistry` to accept optional `{ tools?, installedVersion? }` and write them when supplied. Then `rasen update` calls `touchProjectRegistry(projectPath, { tools: configuredTools, installedVersion: OPENSPEC_VERSION })` after the summary prints.
- The write is best-effort: a registry failure emits at most a warning and does not abort (the skill files are already refreshed on disk, and the next self-heal converges the cache).
- This MUST NOT run before the update's skill-generation loop, so a failed update does not advance the cache.

**Tests** (`tests/commands/update.test.ts`)
- Successful update writes `installedVersion` (current CLI version) and `lastUpdated` (fresh timestamp) to the registry entry.
- Successful update mirrors `tools` from the manifest into the cache.
- Failed update (one tool's skill generation throws) leaves the cache unchanged.
- Registry write failure (e.g. lock contention simulated by holding the lock externally) is tolerated and the command exits successfully.

## 8. Multi-project update enumeration and execution

**Files**
- New `src/core/multi-project-update.ts`
- `src/core/update.ts`
- `src/cli/update.ts` (or wherever the `rasen update` commander registration lives)

**Changes — `src/core/multi-project-update.ts`**
- `enumerateBehindProjects(currentProjectRoot, currentVersion, options) → BehindProject[]`:
  1. Read the registry via `readProjectRegistryState`.
  2. Exclude the current project (path-exact and pierced-root).
  3. Exclude entries whose path is missing on disk.
  4. For each remaining entry, read that project's `rasen/config.yaml` for `update.pin` (skip pinned) and the cached `installedVersion` (skip when equal to `currentVersion` — unknown is NOT equal, so unknown-version entries are eligible).
  5. Return a structured list: `{ projectRoot, name, cachedVersion, lastUpdated, pinned }`.
- `updateMultipleProjects(projects, currentVersion, options) → PerProjectResult[]`:
  1. Serial loop. For each project, invoke the same skill-refresh logic `rasen update` runs for the current project (extract or factor out a `refreshProjectTools(projectRoot)` helper).
  2. Catch per-project errors → record as `{ projectRoot, name, status: 'failed', error }`.
  3. Continue with the remaining candidates.
  4. Return the structured summary.

**Changes — `src/core/update.ts`**
- After the current project's summary (and after the version-cache write in task 7), if `options.onlyThis` is unset:
  1. Call `enumerateBehindProjects`.
  2. If the list is empty, optionally print a one-line note ("All registered projects are current.") and return.
  3. If interactive and `options.allProjects` is unset, present the three-way prompt (all / select / skip; default skip).
  4. If non-interactive and `options.allProjects` is set, target the full list. If non-interactive and `allProjects` is unset, skip the offer (same as `--only-this`).
  5. Call `updateMultipleProjects` against the chosen subset.
  6. Print the per-project summary: updated / skipped-pinned / skipped-missing / skipped-unreadable / failed.

**Changes — `src/cli/update.ts`**
- Add `--all-projects` and `--only-this` as mutually-exclusive boolean flags on `rasen update`.
- Default: neither flag set. Interactive runs get the prompt; non-interactive runs behave as if `--only-this` were set (no prompt, no registry consultation).
- Pass both flags through to `UpdateCommand`.

**Tests**
- `tests/core/multi-project-update.test.ts`:
  - `enumerateBehindProjects` excludes the current project (path-exact).
  - `enumerateBehindProjects` excludes missing-dir entries.
  - `enumerateBehindProjects` excludes pinned entries (config has `update.pin: true`).
  - `enumerateBehindProjects` excludes entries whose cached version equals currentVersion.
  - `enumerateBehindProjects` INCLUDES entries whose cached version is absent (unknown).
  - `updateMultipleProjects` skips and summarizes a per-project failure without aborting the batch.
  - `updateMultipleProjects` skips and summarizes a missing-dir candidate without aborting.
  - `updateMultipleProjects` skips and summarizes a pinned candidate (defensive — even if enumeration missed it).
- `tests/commands/update.test.ts`:
  - Interactive run with two behind projects prompts with default skip; choosing "Update all" updates both.
  - `--all-projects` updates all reachable non-pinned; does not prompt.
  - `--only-this` does not read the registry.
  - Non-interactive run without `--all-projects` does not prompt and does not consult the registry.
  - No behind projects → no prompt, optional one-line note.

## 9. `rasen doctor` surfaces cache/config drift (advisory only)

**Files**
- `src/commands/doctor.ts` (or equivalent)

**Changes**
- When the current project has both a readable `rasen/config.yaml` `tools:` key and a registry entry with cached `tools`, compare them. If they disagree, print an advisory naming both values and suggest re-running `rasen init` or `rasen update` in that project to resync the cache.
- Never rewrite either side from doctor — it remains read-only by default; `--gc` is unchanged.
- Optional: surface the same drift in `--json` output under a new `cacheDrift` field.

**Tests** (`tests/commands/doctor.test.ts`)
- Matching `tools` → no advisory.
- Mismatched `tools` → advisory printed, neither side rewritten.
- Pinned project still listed in the registry section.
- Cache `installedVersion` missing → surfaced as "version unknown" without an error.

## 10. Cross-platform verification

**Files**
- `tests/core/project-registry.test.ts` (extended)
- New `tests/commands/update-multi-project-win32.test.ts` (or platform-conditional skip)

**Changes**
- Add a Windows-CI verification that round-trips a registry containing the new optional fields under both `win32` and `posix` path handlers (the registry already uses `FileSystemUtils.joinPath` for cross-platform joining; the test asserts that paths round-trip identically).
- Add an end-to-end test that simulates: init project A → copy its directory to project B → run `rasen update --all-projects` from A → assert B is updated and A's manifest governs both.
- Audit every new test for hardcoded forward-slash paths; use `path.join` for expected values.

## 11. Locale strings and help text

**Files**
- `src/cli/locale/en.ts`, `src/cli/locale/zh-cn.ts`, `src/cli/locale/ja.ts` (or the equivalent locale-bundle file names)
- CLI flag descriptions in commander registration

**Changes**
- Add the new CLI flags' descriptions (`--all-projects`, `--only-this`) to every supported locale bundle.
- Add the migration informational message ("Seeded tools: <list>") to the locale bundles.
- Add doctor's drift advisory to the locale bundles.
- Add the multi-project prompt strings ("Update all", "Select", "Skip", per-project summary line templates) to the locale bundles.

**Tests**
- Existing locale-coverage tests assert every key used in the CLI appears in every supported locale; extend the same coverage to the new keys.
