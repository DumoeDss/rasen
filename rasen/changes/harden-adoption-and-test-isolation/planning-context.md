# Planning context — harden-adoption-and-test-isolation

## Durable findings (verified at source, 2026-07-10)

- **Adoption is per-TOP-LEVEL-child, name-based.** `adoptChildrenInto` (src/core/global-config.ts:321) loops the source's top-level children and `if (fs.existsSync(destChild)) continue` — so an existing target `projects/` skips the ENTIRE legacy `projects/` subtree, and copies land under the OLD name. Both defects live here. Fast path (target `projects/` absent) can stay the atomic whole-child copy; recursion only needed when target exists.
- **Home name = `<display>-<sha256(projectId).slice(0,8)>`** (`deriveHomeBaseName`, project-registry.ts:204). The short hash is STABLE across the brand/relocation churn (`1e42477e` identical for `openspec-code-*` and `autonomy-ladder-*`); only the display prefix differs. So home-name mapping (defect 2) only needs to swap the prefix — projectId-keyed lookup in old→current registry is exact.
- **Worktree-first naming (defect 3):** `registerProject` case 2c derives the fresh home from the REGISTERING path's basename (project-registry.ts:312). A `.claude/worktrees/<branch>` registering before the main repo permanently names the shared home after the branch. Fix at case 2c: derive `<display>` from `gitCommonDir(path)`'s parent (main working tree). Cases 1/2a already reuse `existingAtPath.home` — home dir is never renamed today; the only churn is the entry's `name` FIELD, refreshed on every `touchProjectRegistry`.
- **`doctor --gc` already exists** (doctor.ts:314, `gcProjectRegistry` in project-registry.ts:405) and already sweeps unreferenced home dirs (`listUnreferencedHomeDirs`). No new CLI flag needed — nothing to register in command-registry.ts for this change.
- **Test isolation:** `vitest.config.ts` already wires `globalSetup: './vitest.setup.ts'`, but that file (vitest.setup.ts) ONLY calls `ensureCliBuilt()` — NO machine-root net. `runCLI` (test/helpers/run-cli.ts:170) isolates SPAWNED CLIs via XDG + blanked `RASEN_HOME`; the leak is IN-PROCESS unit tests calling `getGlobalDataDir()`/`registerProject`/`resolveProjectHome` with no `globalDataDir` override → they hit real `~/.rasen`. Mechanism for the net: set `process.env.RASEN_HOME` in globalSetup `setup()` (runs in main process BEFORE the forks pool spawns → inherited by workers). RASEN_HOME outranks XDG and the literal default, so it wins in-process; runCLI still blanks it for spawned CLIs so the two schemes don't collide.
- **Scope guard:** store registry (`src/core/store/**`) is out of scope and owned by concurrent sessions; this change touches project-registry, global-config, project-home, and the vitest harness only.

## Spec targeting
- MODIFIED `global-config` → "One-time brand config migration" (granularity + home mapping).
- MODIFIED `project-registry` → "Clones fork, worktrees share, moves rebind" (main-repo naming) + "Registry self-healing" (never rename existing home).
- ADDED `ci-test-harness` → "Machine Data Root Isolation for Test Runs".
- No RENAMED/REMOVED requirements → no REMOVED+ADDED pairing needed.

## Validation
`rasen validate harden-adoption-and-test-isolation --strict` → exit 0, all 4 artifacts complete.
