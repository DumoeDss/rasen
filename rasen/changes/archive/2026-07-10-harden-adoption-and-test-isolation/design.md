## Context

`relocate-machine-home` moved the machine root to `~/.rasen` and added `adoptLegacyMachineData`, a one-time copy of old-scheme data (`%LOCALAPPDATA%\rasen` / `~/.local/share/rasen`, and their ancient `openspec` siblings) into the new root. Live use on this machine exposed four defects. The current adoption code (`src/core/global-config.ts`):

- `adoptChildrenInto` iterates the source's TOP-LEVEL children and skips any child already present at the target (`if (fs.existsSync(destChild)) continue`). For `projects/`, that means a target `projects/` created by any other session skips the ENTIRE legacy `projects/` subtree — a full day of work dirs stayed behind.
- It copies children by NAME. The old data has `projects/openspec-code-1e42477e/` but the current registry references `projects/autonomy-ladder-1e42477e/` for the same `projectId` (only the display-name prefix differs; the `sha256(projectId)` short hash is identical). A name-based copy would create `projects/openspec-code-1e42477e/` that no registry entry references — GC-bait deleted by `doctor --gc`.

`registerProject` (`src/core/project-registry.ts`) case 2c derives a new home's base name from the REGISTERING path's basename via `deriveHomeBaseName(canonicalPath, ...)`. When a `.claude/worktrees/autonomy-ladder` worktree registers before the main repo, the shared home is permanently named `autonomy-ladder-<hash>` instead of the main repo's `openspec-code-<hash>`. Case 1 (path-exact) also overwrites the entry's `name` field on every self-heal.

Test isolation: `runCLI` (`test/helpers/run-cli.ts`) isolates SPAWNED CLIs via `XDG_*` + blanked `RASEN_HOME`. But IN-PROCESS unit tests that call `resolveProjectHome`/`registerProject`/`getGlobalDataDir` without a `globalDataDir` override hit the real `~/.rasen`. Evidence: ~200 `openspec-test-*`/`init-profile-test-*`/`handoff-test-*` entries in the real registry. `vitest.setup.ts` currently only builds the CLI; there is no machine-root safety net.

## Goals / Non-Goals

**Goals:**
- Adopt legacy `projects/` content at a grain fine enough that a pre-existing target subtree does not skip it, and land it under the CURRENTLY-referenced home name.
- Name a newly created shared home after the main repo regardless of which worktree registers first; never rename an existing home.
- Guarantee that no test — in-process or spawned — writes the real machine root, via a per-run temp root safety net, without weakening the primary per-test `globalDataDir` isolation.

**Non-Goals:**
- No new CLI command or flag (`doctor --gc` already exists and already sweeps unreferenced homes).
- No config-schema or registry-schema change; no version bump (repo at 0.1.1).
- Not touching `src/core/store/**` (store registry) — this change is scoped to the project registry, global-config, and the test harness. Concurrent sessions own store-project-namespace / delivery-mode work.
- Not deleting the old machine roots — that stays a manual step after `doctor` reports clean.

## Decisions

### D1 — Adoption granularity: recurse into `projects/` per home dir, merge below

`adoptChildrenInto` keeps its per-top-level-child all-or-nothing behavior for children OTHER than `projects/` (config.json, stores/, etc. — copied atomically, never overwritten). For `projects/` specifically, when the target already exists, recurse one level: adopt each old `projects/<home>/` into the target `projects/`, still never overwriting an existing target home. When the target `projects/` does NOT exist, the whole-subtree atomic copy still applies (fast path, unchanged).

- `projects/registry.json` is a child of `projects/`; it is copied only if the target lacks it (never-overwrite preserves the current registry — the load-bearing "recorded facts over recomputation" invariant). Old-registry data is READ for mapping (D2), never written over the current registry.
- Alternative considered: fully recursive file-level merge everywhere. Rejected — atomicity per home dir is the right grain; a half-copied home is worse than an all-or-nothing one, and file-level merge across the whole tree loses the temp-then-rename crash safety.

### D2 — Home-name mapping via the OLD registry's projectId

Before adopting `projects/<oldHome>/`, resolve where it should land:
1. Read the OLD `projects/registry.json` (best-effort; parse failure → fall back to name-based copy so adoption still makes progress).
2. Find the old entry whose `home === oldHome`, take its `projectId`.
3. Read the CURRENT (target) `projects/registry.json`; find the entry with that same `projectId`; use ITS `home` as the destination name.
4. If either lookup misses (no current entry, unreadable registry), fall back to copying under the old name — still lossless, and `doctor --gc`'s unreferenced-home sweep is the backstop, not a silent deleter of referenced data.

This maps `openspec-code-1e42477e` → `autonomy-ladder-1e42477e` so content merges into the referenced home. Never-overwrite still holds at the destination-home grain: if the current home already has content, individual old files that don't yet exist there are the copy unit (the finer grain from D1).

### D3 — Shared-home base name derives from the main repo; self-heal never renames

In `registerProject` case 2c (fresh home), derive the base name from the MAIN repo root — the parent directory of `git rev-parse --git-common-dir` — rather than the registering path's basename, when the path is inside a git worktree. Concretely: resolve `gitCommonDir(canonicalPath)`; if it ends in `.git`, its parent is the main working tree; use that directory's basename for `deriveProjectDisplayName`. Non-git or resolution-failure falls back to the registering path's basename (today's behavior). The short hash is unchanged (`sha256(projectId)`), so this only fixes the human-readable prefix.

Self-heal (`touchProjectRegistry`) and case 1 (path-exact) already reuse `existingAtPath.home` — the home DIRECTORY is never renamed. The remaining churn is the entry's `name` FIELD being overwritten with the registering path's basename on every touch. Decision: on path-exact update, preserve the existing entry's `home` unchanged (already done) and do NOT re-derive the home dir; the `name` field MAY refresh for display but the home directory name is immutable once set. Spec language: "self-healing SHALL never rename or re-create an existing home directory."

- Alternative considered: rename the home dir to match the main repo when a mis-named home is detected. Rejected — renaming a live home under concurrent access is exactly the data-loss risk this change exists to avoid; a cosmetically-wrong prefix on an already-created home is harmless (the hash keys identity). The fix is preventive (name it right at creation), not corrective.

### D4 — Test isolation: per-run temp machine root as a safety net + audit

Two layers:
1. **Safety net (global)**: `vitest.setup.ts` `setup()` creates one per-run temp dir (`mkdtempSync`), sets `process.env.RASEN_HOME` to it BEFORE workers fork (forked workers inherit it), and returns/records the path; `teardown()` removes it with the retrying cleanup helper. Because `RASEN_HOME` outranks XDG and the literal default, every in-process `getGlobalDataDir()` resolves into the temp root. Spawned CLIs are unaffected — `runCLI` still blanks `RASEN_HOME` and applies its own XDG isolation, so the two isolation schemes don't collide.
   - Forks-pool caveat: `globalSetup` runs in the main process before the pool forks, so setting `process.env.RASEN_HOME` there is inherited by every worker. This is the mechanism; no `provide()` plumbing needed. If a future pool change breaks inheritance, a `setupFiles` entry that reads the path from an env var is the fallback (documented, not built now).
2. **Primary isolation (audit)**: suites that call `resolveProjectHome`/`registerProject`/registry helpers are audited to pass an explicit `globalDataDir`/`options` temp dir per test (parallel-safe, already the pattern in registry tests). The safety net is a NET — it catches leaks; it is not the excuse to stop isolating per test.
   - The shared per-run root is acceptable for the net because fixture paths are unique temp dirs, registry writes are lock-serialized, and the whole root is swept at teardown.

## Risks / Trade-offs

- **Recursion into `projects/` changes a shipped adoption path** → Mitigation: fast path (target `projects/` absent) is byte-identical to today; recursion only activates when the target already exists, which today skips everything. Idempotency and never-overwrite are preserved; tests cover both the pre-existing-target and mapped-home cases.
- **D2 reads an old registry that may be malformed** → Mitigation: every read is best-effort with a name-based fallback; adoption never fails or overwrites the current registry.
- **Shared per-run RASEN_HOME across parallel workers could interleave registry writes** → Mitigation: registry lock serializes writers; keys are unique fixture paths; it is a net, not the primary isolation. Any residue is under a temp dir removed at teardown.
- **git-common-dir shell-out during registration** → already incurred by the worktree-sibling check; D3 adds at most one more `gitCommonDir` call on the fresh-home path, gated to git roots.

## Migration Plan

No runtime migration. On the next CLI start after this ships, the improved `adoptLegacyMachineData` re-attempts (idempotent) and picks up the previously-skipped `projects/` content, landing it under the referenced home. The developer then runs `rasen doctor` (should report clean / lingering-old-dir note) and may delete the old roots and run `rasen doctor --gc` to sweep any leaked Temp entries.

## Open Questions

- None blocking. If the OLD registry is entirely absent (only home dirs on disk, no `registry.json`), D2 falls back to name-based copy; whether to additionally attempt content-based home matching is deferred as unnecessary for the observed case (this machine has an intact old registry).
