## 1. Re-verify current-tree evidence (cheap spot-checks)

- [x] 1.1 Re-confirm `src/utils/file-system.ts` `updateFileWithMarkers()` only searches `legacyMarkers` when the current pair is entirely absent (i.e. it never checks for a legacy block once the current pair is found)
- [x] 1.2 Re-confirm `src/core/completions/installers/bash-installer.ts`'s `resolvePresentMarkers()`/`removeBashrcConfig()` and `src/core/completions/installers/zsh-installer.ts`'s equivalent each act on one preferred family only
- [x] 1.3 Re-confirm `src/core/completions/installers/powershell-installer.ts`'s `findManagedBlockRange()` returns on the first family match and is used by both `configureProfile()` and `removeProfileConfig()`

## 2. Shared helper (file-system.ts)

- [x] 2.1 Add an exported pure function `findAllMarkerBlocks(content: string, markerFamilies: Array<{ start: string; end: string }>): Array<{ startIndex: number; endIndex: number; startMarker: string; endMarker: string }>` to `src/utils/file-system.ts` — scans every given family in order, finds all non-overlapping matched blocks (advancing the search cursor past each match within a family), skips a family entirely if its marker state is malformed (start without a matching end) rather than throwing, and returns all matches sorted by `startIndex` ascending across all families combined
- [x] 2.2 Rewrite `updateFileWithMarkers()` to build its family list as `[{start: startMarker, end: endMarker}, ...(legacyMarkers ? [legacyMarkers] : [])]`, call `findAllMarkerBlocks()`, and when one or more matches are found: do a single left-to-right cursor pass over `existingContent` that substitutes the first match's span with `startMarker + '\n' + content + '\n' + endMarker` and drops every subsequent match's span entirely; when zero matches are found, keep the existing append-new-block behavior; collapse resulting `(\r?\n){3,}` runs to `\n\n` after the splice
- [x] 2.3 Confirm the single-match case (`findAllMarkerBlocks` returns exactly one block) produces output byte-identical to the pre-change code path — this is the regression guard for the existing fresh-install/single-family-upgrade tests

## 3. PowerShell installer (both reconfigure and uninstall)

- [x] 3.1 Replace `findManagedBlockRange()` with a call to the shared `findAllMarkerBlocks(content, [PROFILE_MARKERS, LEGACY_PROFILE_MARKERS])`, returning the full sorted match array (or an empty array) instead of a single optional range
- [x] 3.2 Update `configureProfile()`: the "already configured, skip" fast path now requires exactly one match AND that match is the current family AND the script line is present (if there are 2+ matches, an orphan exists and must still be deduped even though the current family is already correct); when writing, replace the first match's span with the fresh managed-block text and drop every other match's span via the same cursor-pass approach as 2.2, adapted to this file's block-comment format
- [x] 3.3 Update `removeProfileConfig()` to drop every match's span (not just the first), reusing the existing before/after trim-and-join cleanup generalized to N matches via a cursor pass
- [x] 3.4 Confirm the single-match case in both `configureProfile()` and `removeProfileConfig()` produces output identical to the pre-change behavior

## 4. Bash and zsh installer uninstall paths

- [x] 4.1 In `bash-installer.ts`, generalize `resolvePresentMarkers()` into a function that returns ALL present marker families (current and/or legacy) instead of the single preferred one; update `removeBashrcConfig()` to loop the existing line-splice removal over every present family (re-deriving line indices from the current state of the `lines` array after each splice), skipping and continuing past any family whose marker placement is malformed rather than failing the whole removal
- [x] 4.2 Apply the equivalent change to `zsh-installer.ts`'s `resolvePresentMarkers()` and `removeZshrcConfig()`
- [x] 4.3 Confirm the single-family case in both installers' uninstall paths is unchanged from current behavior

## 5. Test coverage

- [x] 5.1 In `test/core/completions/installers/bash-installer.test.ts`, add a reconfigure test seeding a `.bashrc` with both a `# RASEN:START/END` block and a separate `# OPENSPEC:START/END` block, run configure, and assert the result has exactly one `RASEN`-marked block with fresh content and no `OPENSPEC` remnant
- [x] 5.2 In the same file, add an uninstall test seeding both marker families and asserting the resulting file has neither `RASEN` nor `OPENSPEC` markers
- [x] 5.3 Apply the equivalent pair of tests (reconfigure-dedupes, uninstall-removes-both) to `test/core/completions/installers/zsh-installer.test.ts`
- [x] 5.4 Apply the equivalent pair of tests to `test/core/completions/installers/powershell-installer.test.ts`
- [x] 5.5 Add a focused unit test for `findAllMarkerBlocks()` in `test/utils/file-system.test.ts` (or the existing marker-related test file for `file-system.ts`) covering: zero families present, one family present, both families present (sorted by position regardless of which family appears first in the array or the file), and a malformed family (start with no end) being skipped rather than throwing
- [x] 5.6 Confirm all existing fresh-install/single-family-upgrade/single-family-uninstall tests in the three installer test files pass unmodified

## 6. Validation

- [x] 6.1 Run `pnpm build` in the worktree
- [x] 6.2 Run `pnpm exec vitest run test/core/completions/ test/utils/` and confirm all tests pass
- [x] 6.3 Run `node dist/cli/index.js validate fix-marker-orphan --strict` and confirm exit code 0
- [x] 6.4 Run `node dist/cli/index.js validate --specs --strict` and confirm it passes
