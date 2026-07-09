# Proposal: externalize-artifacts-machine-home

## Why

The externalize-artifacts portfolio (design of record: `rasen/office-hours/externalize-openspec-artifacts.md`, Decision 4) moves process ephemera (T3) and optionally archives out of the repo into a per-project machine home. Nothing can land on that home until every project has a stable identity and a resolvable home directory on the machine. Today a project has no identity at all: naming a home by path breaks on repo moves, and a bare generated ID collides across clones. This child builds the foundation — project identity, machine registry, home layout, and the resolver API — that the T3-workdir and archive-destination children land on.

## What Changes

- `rasen init` generates a stable `projectId` (UUID) and records it in the repo's `rasen/config.yaml`; re-running init on a project that already has one keeps it.
- New machine-wide project registry at `<globalDataDir>/projects/registry.json` mapping canonical absolute project path → `{projectId, name, mode, home, lastSeen}`, written at init and self-healed (rebind on repo move, refresh `lastSeen`) on CLI runs; updates are atomic and lock-guarded, reusing the store registry's file-state machinery.
- Per-project home directory `<globalDataDir>/projects/<name>-<shortHash(projectId)>/`. Two clones sharing one projectId on the same machine get distinct homes via an instance suffix; git worktrees of one repo share one home.
- New exported resolver API (`resolveProjectHome`) that later children call to place T3 `work/` dirs and external archives; designed and frozen in this child.
- `rasen doctor` gains a machine-home section: reports this project's registry entry and any dangling entries (registered paths that no longer exist), and `rasen doctor --gc` removes dangling entries and their orphaned home directories.
- Projects initialized before this change acquire a projectId lazily: the first command that actually needs the home mints one and appends it to `rasen/config.yaml`; ordinary reads never write to the repo.

Out of scope (deferred to siblings / follow-ups): T3 externalization and template changes (child 2), archive timing/destination (children 3/4), merging the store registry (`stores/registry.yaml`) into the project registry (noted follow-up, deliberately deferred).

## Capabilities

### New Capabilities
- `project-registry`: stable project identity (projectId in `rasen/config.yaml`), the machine-wide project registry with atomic locked updates and self-healing, the per-project home directory naming/layout contract, the home resolver API for other subsystems, and doctor's dangling-entry reporting and GC.

### Modified Capabilities
- `config-loading`: `rasen/config.yaml` gains an optional `projectId` field parsed with the same resilient field-by-field validation as existing fields.
- `cli-init`: init mints/preserves the projectId, registers the project in the machine registry, and reports the machine home in its summary.

## Impact

- Code: new `src/core/project-registry.ts` (registry state + locking) and `src/core/project-home.ts` (resolver API); edits to `src/core/project-config.ts` (projectId parse), `src/core/init.ts` (mint + register), `src/core/config-prompts.ts` (serialize projectId), `src/commands/doctor.ts` + `src/core/relationship-health.ts` (machine-home section, GC), `src/cli/index.ts` (self-heal hook). Reuses `src/core/file-state.ts` lock/atomic-write machinery unchanged.
- No template edits (`src/core/templates/**` untouched — the concurrent session owns dirty files there).
- New on-disk state: `<globalDataDir>/projects/registry.json` and `<globalDataDir>/projects/<home>/` directories. Existing `stores/registry.yaml` untouched.
- Dependencies: none added (`crypto.randomUUID`, `node:crypto` hashing).
- Consumers: children 2 (T3 workdir) and 4 (external archive) build on `resolveProjectHome`.
