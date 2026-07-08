## 1. openspec-root health (clean)

- [x] 1.1 In `src/core/openspec-root.ts`, add `OptionalPlanningDirectoryKey` type and `inspectOptionalPlanningDirectory(inspection, storeRoot, key, relativePath, notDirectoryCode, target)` (sets `{ present: kind === 'directory' }`, returns early for `directory`/`missing`, else pushes a `*_not_directory` diagnostic). Pre-image matches; clean.
- [x] 1.2 Replace the `for (const [key, relativePath, code, message, target] of [...])` loop with: `inspectOptionalPlanningDirectory(... 'specs' ...)`, `const changesKind = inspectOptionalPlanningDirectory(... 'changes' ...)`, and only if `changesKind === 'directory'` inspect `'archive'` (else `inspection.archive = { present: false }`).
- [x] 1.3 Change `inspection.healthy` to `inspection.present === true && inspection.config.present === true && inspection.diagnostics.length === 0` (drop the specs/changes/archive `.present === true` conjuncts).

## 2. store registration guard (clean)

- [x] 2.1 In `src/core/store/operations.ts`, add `import { classifyOpenSpecDir, storePointerProblem } from '../project-config.js';`.
- [x] 2.2 Add `assertNotConfigOnlyPointerRoot(storeRoot)`: return if `hasPlanningShape || pointer.filePath === null`; throw `StoreError('invalid_store_pointer', ...)` if `pointer.malformed`; throw `StoreError('store_root_pointer_declared', ...)` if `pointer.value !== undefined`.
- [x] 2.3 Call `assertNotConfigOnlyPointerRoot(storeRoot)` at the top of the `if (kind === 'directory')` branch in `prepareSetupPlan`, and again in `registerExistingStore` immediately before `const openspecRoot = await inspectOpenSpecRoot(storeRoot)`.

## 3. archive.ts — tolerate missing changes dir (applied AFTER child A)

- [x] 3.1 Add `isMissingPathError(error)` helper (ENOENT check) near the top of `src/core/archive.ts`.
- [x] 3.2 Change `listActiveChangeNames`'s `} catch {` to `} catch (error) { if (!isMissingPathError(error)) throw error; return []; }`.
- [x] 3.3 **Manual:** delete the `fs.access(changesDir)` + `throw new Error("No Rasen changes directory found. Run 'rasen init' first.")` block in `run()` (~L195-202). (Upstream deletes the OpenSpec-worded block; delete the fork's rasen-worded one.)
- [x] 3.4 In `selectChange`, replace the inline `fs.readdir(...)`/filter/sort with `const changeDirs = await listActiveChangeNames(changesDir);`.

## 4. list.ts — tolerate missing changes dir

- [x] 4.1 Add `type Dirent` to the `from 'fs'` import; add `isMissingPathError` + `readChangeDirectoryEntries(changesDir)` (ENOENT → `[]`).
- [x] 4.2 **Manual:** delete the `fs.access(changesDir)` + `throw new Error("No Rasen changes directory found. Run 'rasen init' first.")` block (~L85-90); replace `const entries = await fs.readdir(changesDir, ...)` with `const entries = await readChangeDirectoryEntries(changesDir);`.
- [x] 4.3 Apply the EOF trailing-newline fix.

## 5. Tests (drop docs hunks)

- [x] 5.1 Apply `test/core/openspec-root.test.ts`, `test/core/list.test.ts`, `test/core/archive.test.ts` (archive.test.ts on the post-A tree — 4-line change to the empty-store expectation, `rejects.toThrow("Change 'any-change' not found. No active changes exist in this root.")`).
- [x] 5.2 Apply `test/commands/store.test.ts`, `test/commands/store-git.test.ts`, `test/commands/store-root-selection.test.ts` (the latter two on the post-C tree — they already have the `cleanupTempPath` import from child C). Added tests use unchanged workspace paths and brand-neutral assertions; no adaptation.
- [x] 5.3 **DROP** the `docs/agent-contract.md`, `docs/cli.md`, `docs/stores-beta/user-guide.md` hunks.

## 6. Verify (complex)

- [x] 6.1 `pnpm build`.
- [x] 6.2 `pnpm vitest run test/commands/store.test.ts test/commands/store-git.test.ts test/commands/store-root-selection.test.ts test/core/archive.test.ts test/core/list.test.ts test/core/openspec-root.test.ts` — all green.
- [x] 6.3 `node bin/rasen.js validate upstream-cherrypick-batch1-store-fix` — change delta valid.
- [x] 6.4 Confirm the touch-set is exactly the 4 source + 6 test files; no `docs/**` and no `project-config.ts` change.
