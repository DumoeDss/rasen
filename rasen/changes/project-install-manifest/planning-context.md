# Planning Context — project-install-manifest

LEAD-seeded findings for the planner. Research the gaps; do not treat this as
a complete spec. The user's two problems share one substrate (a per-project
install record consulted by `rasen update`), so this is scoped as ONE
small-feature change addressing both.

## User intent (verbatim, paraphrased into English)

1. **Unwanted tool install on `rasen update`.** A user who did NOT select codex
   at install time nevertheless finds a `.agent` folder in their project (they
   believe it is codex's skills dir). Running `rasen update` installs rasen into
   it. The user asks: should there be a file recording which tools the current
   project actually opted into — placed under `~/.rasen`?

2. **Multi-project update is tedious.** After initializing rasen in several
   project directories, every rasen upgrade must be applied one project at a
   time. The user asks: record every installed target's version under `~/.rasen`,
   and on `rasen update` prompt whether to upgrade all other projects too — with
   a choice of "upgrade all" or "only this project" (so a project can
   intentionally pin a different version).

## Critical correction to the user's framing (verify, then respect intent)

In `src/core/config.ts` the `AI_TOOLS` table says:
- `.agent` → **Antigravity** (`value: 'antigravity'`).
- `.codex` → **Codex** (`value: 'codex'`, `adapted: true`).

So `.agent` is Antigravity's skills dir, not codex's. The substance of the bug
is unchanged regardless of which tool: rasen detects "configured" purely from
on-disk artifacts and will refresh any tool whose skills dir contains a rasen
skill — even one the user never opted into this install. Confirm this with the
user's exact repro if possible, but design the fix tool-agnostically.

## Confirmed root cause (Problem 1)

"Configured tool" is derived ONLY from on-disk rasen artifacts. There is no
durable manifest of the user's explicit tool selection from `rasen init`.

- `src/core/shared/tool-detection.ts`
  - `getConfiguredTools(projectRoot)` (L246) → `getToolSkillStatus` → counts
    rasen `SKILL.md` files under `<project>/<tool.skillsDir>/skills/`.
  - `getToolVersionStatus` reads `generatedBy` frontmatter per skill file.
- `src/core/profile-sync-drift.ts`
  - `getConfiguredToolsForProfileSync` (L92) unions three directory-presence
    signals: skill-configured, catalog-skill-dirname-present, and
    workflow-artifact-ledger keys.
- `src/core/update.ts`
  - `configuredTools` (L281) = union of `getConfiguredToolsForProfileSync` and
    `getCommandConfiguredTools` (retired command files).
  - `detectNewTools` (L525) surfaces `getAvailableTools(...)`.`adapted` tools
    that are present on disk but not yet configured → hints `rasen init`.
- `src/core/available-tools.ts` — `getAvailableTools` = any AI tool whose
  `skillsDir` (or `detectionPaths`) exists on disk.
- `src/core/init.ts` — writes skills into the user's selected tools' dirs; the
  selection itself is NOT persisted anywhere durable.

Consequence: if `.agent/skills/` (or any tool's skillsDir) holds a rasen skill
— from a prior install, a `cp -r`, a shared worktree, or another tool seeding
the dir — `rasen update` treats that tool as configured and refreshes it.

## Existing infrastructure to build on (Problem 2)

A machine-wide project registry ALREADY exists:

- `src/core/project-registry.ts`
  - File: `<globalDataDir>/projects/registry.json` (= `~/.rasen/projects/registry.json`;
    `getGlobalDataDir` in `src/core/global-config.ts`, default `~/.rasen`).
  - `ProjectRegistryEntryState` = `{ projectId, name, mode, home, lastSeen }`.
  - Schema is zod `.strict()` (L79/L87) — adding OPTIONAL fields is backward-
    compatible (strict rejects unknown keys, not missing optional ones).
  - `registerProject`, `findProjectRegistryEntry`, `findDanglingProjectEntries`,
    `gcProjectRegistry`, and the self-healing `touchProjectRegistry` already
    maintain it.
- `src/core/project-home.ts` — `resolveProjectHome` + the throttled self-heal
  touch invoked from root-resolving commands (`touchProjectRegistry`).

What is MISSING for the user's asks:
- The registry entry records neither the **installed rasen version** nor the
  **explicitly-selected tools** per project.
- `rasen update` never consults the registry to offer multi-project upgrade.

## Key design decisions the proposal MUST resolve

1. **Where does the explicit tool-selection manifest live?** Weigh:
   - Project-local `rasen/config.yaml` (a `tools:` list) — travels with the
     repo (clone/fork/worktree inherit it), is reviewable/commitable. This is
     the robust home for "which tools did the user opt into for THIS project".
   - Machine-local registry entry (`~/.rasen/projects/registry.json`) — matches
     the user's "~/.rasen" mental model and is cheap for multi-project scans,
     but does NOT travel with the repo.
   - Hybrid (recommended to evaluate): `rasen/config.yaml` is the source of
     truth for tool selection; the registry entry caches it + the installed
     version for fast multi-project scans.
   The user literally asked "放在~/.rasen下面", so the proposal should justify
   whichever layer it picks and explain the trade-off to the user in the
   proposal.

2. **Authority vs. migration.** If tool selection becomes authoritative, what
   happens to existing projects that have rasen artifacts on disk but no
   manifest? Plan a one-time migration (seed the manifest from detected
   artifacts) so no existing install loses its tools. Decide whether on-disk
   detection remains a fallback or becomes purely advisory.

3. **Version source for multi-project update.** Prefer caching
   `installedVersion` (+ `lastUpdated`) in the registry entry, refreshed by
   `touchProjectRegistry` self-heal and by `rasen update` itself; optionally
   verify against the on-disk `generatedBy` frontmatter. Decide staleness
   handling (re-read on demand vs. trust cache).

4. **Multi-project update UX.** `rasen update` should, after updating the
   current project, surface other registered projects that are behind and offer
   to update them — interactive (prompt: all / select / skip) AND a non-
   interactive flag for scripting. Respect the user's "intentionally pin a
   different version" case: never auto-upgrade a project without consent; a
   project can be excluded/pinned. Decide the exact prompt shape, the flag(s)
   (e.g. `--all`, `--only-this`), and how missing/offline project dirs are
   reported (skip + summarize, do not fail).

5. **Scope discipline.** Keep this a small-feature: persist the manifest,
   make `init`/`update` honor it, add version tracking + a multi-project
   update prompt. Do NOT redesign the registry, the profile system, or the
   delivery surface. Reuse `registerProject`/`touchProjectRegistry` rather than
   adding parallel bookkeeping.

## Non-negotiable constraints (from rasen/config.yaml)

- Cross-platform: `path.join`/`path.resolve` only; never hardcode separators;
  tests must use `path.join` for expected paths; add Windows CI verification
  tasks when paths are involved.
- Generate artifacts? Track by explicit name in a constant — never pattern-match
  deletions.
- Specs/proposal in user-facing product behavior language; mechanism goes in
  design.md/tasks.md.
- The registry is best-effort and must never break or visibly slow a user
  command (existing contract in `touchProjectRegistry`/`gcProjectRegistry`).

## Suggested task structure (planner refines)

1. Schema: add optional `tools` + `installedVersion` (+ `lastUpdated`?) to
   `ProjectRegistryEntryState`; keep `.strict()` back-compat; add migration/
   seed path. Consider parallel `rasen/config.yaml` `tools:` key (+ schema).
2. `init.ts`: persist the user's selected tool ids into the manifest on every
   init/re-init.
3. `update.ts`: read the manifest as the authoritative configured-tool set
   (with on-disk migration fallback); stop auto-onboarding unselected tools.
4. Version tracking: refresh `installedVersion` in the registry on update and
   via the self-heal touch.
5. Multi-project update: enumerate registry, compare versions, prompt/flag to
   update others; handle offline/missing dirs and pinned projects.
6. Specs (CLI / update / project-registry as relevant) + cross-platform tests.

## Frontier / open questions for the user (surface in proposal or gate)

- Confirm the exact repro for Problem 1 (which tool's dir, how it got there).
- Should the tool-selection manifest be committed in `rasen/config.yaml`
   (travels with repo) or kept machine-local in `~/.rasen` (user's literal
   ask), or both? This affects clone/fork/worktree behavior.
- Preferred multi-project prompt shape and default (prompt vs. flag-gated).
