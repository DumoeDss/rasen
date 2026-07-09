## Why

After `relocate-machine-home` (cba4073) shipped, four live defects surfaced that silently lose or misplace machine data and pollute the real machine root. Legacy adoption skips whole subtrees and copies to unreferenced (GC-bait) home names; worktree registration names a shared home after the wrong path; and full-suite test runs register hundreds of fixture projects into the developer's REAL `~/.rasen`. These are data-integrity and hygiene bugs in code that already shipped, so they need fixing before the old machine roots are deleted.

## What Changes

- **Adoption granularity**: `adoptLegacyMachineData` recurses BELOW the data root's top-level child instead of treating each (e.g. `projects/`) as one atom. A pre-existing target `projects/` no longer skips the entire legacy `projects/` subtree; never-overwrite moves to the finer per-child grain so this machine's work dirs are adopted even when another session created `projects/` first.
- **Home-name mapping**: When adopting the `projects/` subtree, old home directory names are mapped to the CURRENT registry's home for the same `projectId` (read from the OLD `projects/registry.json`). Content merges into the referenced home name rather than copying to the old name, which would create an unreferenced dir that `doctor --gc` deletes.
- **Worktree name derivation**: A newly created shared home's base name derives from the main repo (the parent of `git rev-parse --git-common-dir`), not from whichever worktree path happens to register first. Self-heal SHALL never rename or re-derive an existing home directory.
- **Test-isolation leak**: A vitest global setup forces the machine data root (`RASEN_HOME`) to a per-run temp directory as a safety net so in-process tests never touch the real machine root; leaky suites that resolve the machine home without an explicit override are audited and pinned. `doctor --gc` sweeps any already-leaked Temp entries.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `global-config`: The "One-time brand config migration" requirement gains finer-than-top-level adoption granularity and old→current home-name mapping for the `projects/` subtree.
- `project-registry`: The shared-home naming rules ("Clones fork, worktrees share, moves rebind" and "Registry self-healing") derive a new shared home's name from the main repo and forbid self-heal from renaming an existing home.
- `ci-test-harness`: A new requirement isolates the machine data root for the whole test run so in-process tests cannot write the real machine root.

## Impact

- Code: `src/core/global-config.ts` (`adoptLegacyMachineData` and its `adoptChildrenInto`/`adoptOneScheme` helpers, `oldDirFullyPresentIn`, `checkMachineRootRelocation`), `src/core/project-registry.ts` (`registerProject` case 2c naming, `deriveHomeBaseName` callers), `src/core/project-home.ts` (`touchProjectRegistry` self-heal), `vitest.setup.ts` / `vitest.config.ts` (global setup + per-worker isolation), leaky test suites.
- Behavior: no CLI surface or flag changes (`doctor --gc` already exists); no config schema change; version-independent (repo at 0.1.1, no bump).
- Depends on `git rev-parse --git-common-dir` (already used via `src/core/store/git.ts`).
