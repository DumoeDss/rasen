## Context

Cherry-pick of `93e27a7` (empty store registration, #1328) into the rasen fork, applied last in the batch. Depends on child A (shared `archive.ts`) and child C (shared store test files). The fork retains workspace conventions (`openspec/`, `.openspec-store/`, `config.yaml`) but rebranded the two CLI error strings the fix deletes.

## Goals / Non-Goals

- **Goals:** a config-only store is healthy and registrable; a config-only pointer repo is rejected; `archive`/`list` no longer crash on a missing `changes/` dir; upstream regressions carried over.
- **Non-Goals:** no `docs/**` changes; no rebranding of ported test bodies (workspace paths are unchanged); no change to `project-config.ts` (its `classifyOpenSpecDir`/`storePointerProblem` already match).

## Decisions

### Hunk-by-hunk plan

**`src/core/openspec-root.ts`** — clean. The pre-image loop (`for (const [key, relativePath, code, message, target] of [...]`) with codes `openspec_specs_missing` etc. and the `inspection.healthy = ... archive.present === true` criterion match our file verbatim (~L169-190; codes are internal, brand-neutral). Apply the refactor: add `inspectOptionalPlanningDirectory` + `OptionalPlanningDirectoryKey`, replace the loop with the specs/changes(+conditional archive) calls, and change health to `present && config.present && diagnostics.length === 0`.

**`src/core/store/operations.ts`** — clean. Anchors present: import block, `alreadyRegisteredDiagnostic` (~L212), `if (kind === 'directory') {` in `prepareSetupPlan` (~L461), `registerExistingStore` (~L705) with `inspectOpenSpecRoot` (~L733). Add the `classifyOpenSpecDir`/`storePointerProblem` import, the `assertNotConfigOnlyPointerRoot` function, and the two call sites. `project-config.ts` already exports both with the expected shape (`hasPlanningShape`, `pointer.{filePath,malformed,value}`).

**`src/core/archive.ts`** — one manual conflict. Clean parts: add `isMissingPathError`; change `listActiveChangeNames`'s `} catch {` → `} catch (error) { if (!isMissingPathError(error)) throw error; return []; }`; rewrite `selectChange` to call `listActiveChangeNames`. **Manual:** the hunk that removes the `fs.access(changesDir)` / `throw new Error("No … changes directory found …")` block targets upstream's OpenSpec wording; our block is rasen-worded (`"No Rasen changes directory found. Run 'rasen init' first."`, ~L200-202). Resolve by deleting our rasen-worded block. D's `archive.ts` diff is cut against the post-`5956a8e` blob, so apply after child A.

**`src/core/list.ts`** — one manual conflict, same pattern. Clean: add `type Dirent` import, `isMissingPathError`, `readChangeDirectoryEntries`; swap the readdir; EOF newline. **Manual:** delete the rasen-worded `fs.access` throw block (~L88-90).

**Tests** — apply `test/commands/{store,store-git,store-root-selection}.test.ts`, `test/core/{archive,list,openspec-root}.test.ts`. Added tests use workspace paths (`openspec/config.yaml`, `.openspec-store/store.yaml`, `openspec/changes/...`) that are unchanged on the fork, and brand-neutral assertions (`Change 'x' not found. No active changes exist in this root.` — confirmed present in our `archive.ts`; internal code `openspec_archive_not_directory` — matches the new openspec-root codes). No brand adaptation needed. Apply store-git/store-root-selection on the post-C tree (they gained the `cleanupTempPath` import in child C) and archive.test.ts on the post-A tree.

**`docs/**`** — **DROP** all three doc hunks.

### Capability boundaries (avoid overlapping claims)
Child A owns the `cli-archive` spec. To avoid two changes claiming the same capability spec, D does **not** modify `cli-archive`; the archive command's missing-dir tolerance is specified under the new `store-registration` capability instead. D modifies `cli-list` (which A does not touch) and adds `store-registration`.

## Risks / Trade-offs

- **Health-criterion change is load-bearing:** switching to `diagnostics.length === 0` means any future diagnostic pushed during inspection now flips health. That matches upstream intent (only real problems are diagnostics) but is worth noting.
- **Pointer rejection is a new hard failure:** repos that were (incorrectly) registered as stores while declaring a `store:` pointer will now be rejected. This is the intended correctness fix.

## Simple vs Complex (for adaptive-verify)

**Complex.** Four source files spanning store registration, root health, and two commands; behavior change to registration acceptance. Evidence: `pnpm build` + targeted vitest on `test/commands/{store,store-git,store-root-selection}.test.ts` and `test/core/{archive,list,openspec-root}.test.ts`.

## Migration / Rollout

Local ship only.

## Open Questions
<!-- none -->
