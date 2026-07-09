## 1. Adoption granularity (global-config)

- [x] 1.1 In `src/core/global-config.ts`, split the `projects/` child out of the top-level `adoptChildrenInto` loop: keep the atomic whole-child copy for `projects/` ONLY when the target `projects/` does not yet exist (fast path, unchanged); when it exists, recurse and adopt each old `projects/<home>/` individually, preserving per-home all-or-nothing (temp-then-rename) and never-overwrite.
- [x] 1.2 Keep every non-`projects/` top-level child on the current atomic, never-overwrite path.
- [x] 1.3 Ensure idempotency: a re-run after a completed adoption copies nothing (existing per-home dirs are skipped).
- [x] 1.4 Verify `checkMachineRootRelocation` / `oldDirFullyPresentIn` still report "adopted" correctly under the finer grain (a top-level `projects/` present but sub-homes pending should NOT read as fully adopted); adjust the presence check to recurse for `projects/` if needed.

## 2. Home-name mapping (global-config)

- [x] 2.1 Add a best-effort reader for the OLD-scheme `projects/registry.json` (reuse `parseProjectRegistryState`; parse/read failure returns null, never throws).
- [x] 2.2 Before adopting each old `projects/<oldHome>/`, resolve the destination home name: old registry `home === oldHome` → its `projectId` → current registry entry with that `projectId` → its `home`. Copy into that current home name.
- [x] 2.3 Fallback: when either registry is missing/unreadable or no current entry shares the `projectId`, copy under the old home name (lossless).
- [x] 2.4 Never overwrite the target `projects/registry.json` (read-only for mapping); never-overwrite applies at the destination-home / per-file grain.

## 3. Worktree name derivation (project-registry)

- [x] 3.1 In `src/core/project-registry.ts`, add a helper that resolves the MAIN repo directory from a path via `gitCommonDir` (parent of the `.git` common dir); returns null for non-git / unresolvable.
- [x] 3.2 In `registerProject` case 2c (fresh home), derive the `<name>` prefix from the main-repo directory when available, else fall back to the registering path's basename; leave `deriveHomeBaseName`'s short-hash logic unchanged.
- [x] 3.3 Confirm case 1 (path-exact) and case 2a (worktree share) reuse the existing `home` unchanged — no home dir is renamed or re-created.

## 4. Self-heal never renames (project-registry / project-home)

- [x] 4.1 In `src/core/project-home.ts` `touchProjectRegistry`, ensure a refresh never changes the entry's `home`; the `name` field may refresh for display but the home directory name is immutable once assigned.
- [x] 4.2 Confirm no code path renames or re-creates an existing home directory during self-heal or re-registration.

## 5. Test-isolation safety net (ci-test-harness)

- [x] 5.1 In `vitest.setup.ts` `setup()`, create a per-run temp dir (`mkdtempSync`) and set `process.env.RASEN_HOME` to it BEFORE workers fork; keep `ensureCliBuilt()`.
- [x] 5.2 In `teardown()`, remove the temp machine root via the retrying cleanup helper (best-effort), keeping `terminateActiveCliChildren()`.
- [x] 5.3 Verify `runCLI`'s spawned-CLI isolation is unaffected (it still blanks `RASEN_HOME` and applies XDG isolation) — no collision with the in-process net.
- [x] 5.4 Audit suites that call `resolveProjectHome`/`registerProject`/registry helpers without an explicit `globalDataDir`; pin the leaky ones to per-test temp dirs. Grep for direct `getGlobalDataDir`/`registerProject`/`resolveProjectHome` usage in `test/**`.

## 6. Tests

- [x] 6.1 global-config: adoption test for pre-existing target `projects/` that adopts a missing per-home dir without overwriting existing homes.
- [x] 6.2 global-config: adoption test for old→current home-name mapping (old `openspec-code-*` maps to current `autonomy-ladder-*`; no unreferenced dir; target registry untouched).
- [x] 6.3 global-config: fallback test when the old/target registry is absent (copy under old name, no throw).
- [x] 6.4 project-registry: worktree-first registration names the shared home after the main repo (mock or real git worktree fixture).
- [x] 6.5 project-registry: self-heal of a worktree entry does not rename the home directory.
- [x] 6.6 ci-test-harness: assert an in-process registration lands under the per-run temp root, not the real machine root (guard test).

## 7. Verify

- [x] 7.1 Build with `node build.js` (NEVER pnpm) and run the full suite with `npx vitest run`; confirm green and no new fixture entries leak into the real `~/.rasen`.
- [x] 7.2 Run `rasen validate harden-adoption-and-test-isolation --strict` and fix any issues.
- [x] 7.3 Manually confirm on this machine: next CLI start adopts the previously-skipped `projects/` content under the referenced home; `rasen doctor` reports clean or a lingering-old-dir note.
