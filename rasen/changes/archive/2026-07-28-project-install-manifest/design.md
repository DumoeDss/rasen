## Context

Today Rasen decides which tools to refresh by inspecting the project directory: `getConfiguredTools` (`src/core/shared/tool-detection.ts`) walks each tool's `skillsDir` and counts Rasen `SKILL.md` files; `getConfiguredToolsForProfileSync` (`src/core/profile-sync-drift.ts`) unions that with catalog-dirname and workflow-ledger signals; `getCommandConfiguredTools` (`src/core/update.ts`) adds tools with leftover pre-retirement command files. There is no durable record of the user's actual selection at `rasen init`, so any tool whose directory happens to contain a Rasen artifact gets refreshed on `rasen update`.

The machine-wide project registry at `~/.rasen/projects/registry.json` (`src/core/project-registry.ts`) already records each registered project's canonical path, `projectId`, display `name`, planning `mode`, `home` directory, and `lastSeen` timestamp. Its schema is zod `.strict()`, which rejects unknown keys but accepts missing optional ones — so adding optional fields is back-compat. `registerProject` and the throttled `touchProjectRegistry` self-heal (`src/core/project-home.ts`) already maintain it under a file lock.

The resilient `readProjectConfig` parser (`src/core/project-config.ts`) parses `rasen/config.yaml` field-by-field via `safeParse`, dropping invalid siblings with a warning so a single bad key cannot break the whole config. The top-level schema is a plain `z.object({...})`, so adding new optional keys is structurally additive and a config without them still loads.

## Goals / Non-Goals

**Goals**
- Stop silently installing Rasen into tool directories the user never opted into.
- Make the user's tool selection at `rasen init` durable and portable across clones/forks/worktrees.
- Let `rasen update` upgrade every registered project on the machine in one pass with explicit consent.
- Reuse the existing project registry and self-heal machinery rather than adding parallel bookkeeping.

**Non-Goals**
- Redesigning the registry's worktree/move/gc semantics, the profile system, or the delivery surface.
- Changing how `detectNewTools` discovers and advertises newly-available adapted tools.
- Adding new tool auto-discovery or background/scheduled update.
- Synchronizing state across multiple machines (that is the portfolio this change belongs to; this change is strictly machine-local plus repo-portable).

## Decisions

### D1. Manifest lives in `rasen/config.yaml`; the registry mirrors it as a cache

**Decision.** The source of truth for "which tools did the user select for THIS project" is a new `tools:` key in `rasen/config.yaml`. The machine-wide registry entry mirrors that list and additionally caches `installedVersion` + `lastUpdated` so multi-project scans can be answered from one file read.

**Why this split.** The user's literal ask was "放在~/.rasen下面" — put it under `~/.rasen`. The registry under `~/.rasen/projects/registry.json` already exists and is the natural home for the *cache* the user's mental model expects. But a machine-local-only manifest does not travel with the repo: a fresh clone on a new machine resolves to nothing, and two machines with different selections would silently fight. Putting the source of truth in the project config makes the selection durable across clone/fork/worktree (the same property `projectId` already has), while the registry cache gives multi-project scans the fast path.

**Alternatives considered.**
- *Machine-local only (literal ask).* Rejected: loses the selection on clone and across machines. The portfolio this change ships in already addresses multi-machine state separately; creating a second machine-local source of truth that drifts from the repo would re-create exactly the drift the wider portfolio is trying to eliminate.
- *Project-local only (no cache).* Rejected: multi-project update would have to open every project's `rasen/config.yaml` to discover what's behind. The registry cache is the difference between an O(1) registry read and an O(N) directory walk, which matters on machines with many registered projects.

### D2. On-disk detection becomes migration fallback, never silent expansion

**Decision.** When `rasen/config.yaml` has a `tools:` key, that key is authoritative — on-disk detection cannot add to it or shrink it. When the key is absent, the first command that resolves configured tools seeds it losslessly from on-disk artifacts. After the seed, the key is authoritative forever.

**Why.** The alternative — keep on-disk detection as a live signal that can add tools post-migration — recreates the bug. Letting the manifest shrink based on on-disk state would silently drop a tool the user selected the moment its directory is cleaned up by `rasen update` itself (or any external action). Asymmetric authority (manifest is authoritative; disk is migration-only) is the smallest rule that closes the bug without losing any existing install.

**Why fail-open on unreadable config.** A config that cannot be parsed must not block the user's command — the same contract every other field in the resilient parser obeys. On-disk detection is the fallback for that single run; the seed is retried on the next run that can parse the config.

### D3. Version tracking via the registry cache, refreshed by self-heal

**Decision.** The registry entry carries optional `installedVersion` and `lastUpdated`. `rasen update` writes both after a successful run. The self-heal `touchProjectRegistry` reads `generatedBy` from one surviving skill file as ground truth when the cache is empty or stale (the existing 24h threshold matches the self-heal's existing staleness contract).

**Why not re-read on every scan.** A multi-project scan that opens every project's skill files to read `generatedBy` is O(N×M) where M is skill count — measurably slower on machines with many registered projects. The cache lets the scan be a single read of the registry file, with the self-heal providing eventual convergence.

**Why not trust the cache blindly.** A user who runs an older binary on a project (or manually deletes skills) can leave the cache stale. The self-heal's `generatedBy` read is cheap (one file) and runs at most once per 24h per project, so the cost is bounded; the drift is self-correcting on the next touch.

**Why the registry is cache, not authority.** The project config is authoritative because it is what the user actually edited and what travels with the repo. The registry cache is a best-effort mirror. Doctor surfaces the disagreement when the two drift; the cache is never silently promoted to authority.

### D4. Multi-project UX: prompt by default, flag-gated for scripts

**Decision.** After the current project is updated, `rasen update` reads the registry and surfaces behind projects. Interactive runs get a three-way prompt (all / select / skip, default skip). Non-interactive runs skip the prompt. `--all-projects` is the scripting escape hatch. `--only-this` opts out of the registry consultation entirely.

**Why default skip.** A multi-project update that touches several of the user's projects in one run is a blast-radius upgrade. Defaulting to "skip" makes the prompt informative (the user learns which projects are behind) without ever acting without consent. `--all-projects` is the explicit opt-in for scripting, and it still respects `update.pin`.

**Why `--only-this` instead of a `--no-multi-project`.** The existing flag idiom in this CLI (`--only-this`, `--all-projects`) reads better than a negation. `--only-this` is also symmetric with the upcoming `rasen update <path>` flag consideration: the user always has a way to say "this directory, nothing else."

### D5. Pinning via `update.pin: true` in `rasen/config.yaml`

**Decision.** A project opts out of multi-project update by setting `update.pin: true`. Pinned projects stay visible in the registry (so `rasen doctor` continues to report them) but are never touched by `--all-projects` and never offered by the prompt.

**Why a new config axis.** Pinning is a per-project, durable intent — exactly what `rasen/config.yaml` is for. The alternative (a sentinel value in the registry entry, or a separate `rasen/pin` file) either couples pin state to machine-local bookkeeping that can drift across machines, or adds a new file. A single key under a new `update:` map leaves room for future update-related config (auto-update, quiet hours, etc.) without a schema reshuffle.

## Risks / Trade-offs

- **[Manifest drift after manual `cp -r`]** → If a user copies their `rasen/config.yaml` into a project that has different tools installed on disk, the manifest will list tools whose directories are absent. `rasen update` will regenerate the missing skill files for those tools, which is the correct behavior (the manifest is authoritative). If the user wants different tools, they re-run `rasen init`.
- **[Registry cache stale after an upgrade run crashes mid-way]** → `rasen update` writes the cache at the end of a successful run; a crash before that leaves the cache stale. The self-heal touch converges it within 24h, and the next successful update overwrites it. The cache is never used as the source of truth for the configured-tool set (the project config is).
- **[Migration writes to `rasen/config.yaml` on the first update]** → A user who has intentionally kept a minimal config file will see a new `tools:` line appear. The write uses the existing comment-preserving single-key writer, so every other line stays untouched. The informational message names the seeded value so the user can edit or remove it.
- **[`--all-projects` across many projects is slow]** → Updating ten projects serially can be slow. Each per-project update is independent; a future change can parallelize. For now, the summary makes the sequence observable, and a failed project does not abort the batch.
- **[Doctor reports cache-vs-config drift]** → Readers prefer the project config when cache and config disagree. Surfaced as a doctor advisory, not silently rewritten. Re-running init/update in the drifted project resyncs the cache.
- **[Existing tests assert on the union of disk-detected tools]** → The behavior change is deliberate: tests that asserted "stray `.codex` skill file causes Codex to be refreshed" now assert the opposite. The migration path covers the existing-install case, so tests that reflect real installs continue to pass after adding a `tools:` key to their fixtures; tests that intentionally exercise the bug being fixed are rewritten to the new contract.

## Migration Plan

1. **Schema and parser changes ship first** (ProjectConfigSchema gains `tools:` and `update.pin`; ProjectRegistryEntrySchema gains optional `tools`, `installedVersion`, `lastUpdated`). At this point every existing binary continues to work and a newer binary reading an older config/registry still loads cleanly.
2. **Init and update read the manifest, seed on first run.** Existing installs gain a `tools:` key on their first `rasen init`/`rasen update`; the registry cache backfills on the next self-heal touch. This step is invisible to users who never run init/update, and lossless for everyone who does.
3. **Multi-project update UX ships.** The prompt is additive — users who never run `rasen update` interactively, or who always pass `--only-this`, see no change. Users who do run interactively get a new offer that defaults to Skip.

**Rollback.** Reverting the change leaves the new config keys and registry fields in place; they are ignored by older binaries (resilient parser drops unknown keys silently; `.strict()` registry schema treats optional fields as absent when missing). The user can manually delete the `tools:` line from `rasen/config.yaml` to restore on-disk detection as the authority for that project — this is not required for correctness.

## Open Questions

- **Should the multi-project prompt also appear after `rasen init`?** Default in this proposal: no — init is setup, update is refresh. If the user wants init to also offer upgrading other projects, that is a small follow-up.
- **Should `rasen doctor` gain a `--update-cache` flag** that refreshes every registry entry's cache fields in one pass? Default: no — self-heal covers it within 24h. If the user wants explicit control, that is a small follow-up.
- **Should `rasen update <path>`** (update a specific project by path, not the cwd) be added now or as a follow-up? Default: follow-up. The current prompt + `--all-projects` covers the user's stated ask.
