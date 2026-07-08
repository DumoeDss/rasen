## Context

Cherry-pick of two upstream `archive` bug fixes (`5956a8e`, `7e21cc5`) into the rasen fork. The fork has globally rebranded (`bin/rasen.js`, `RASEN_*` env, config dir `rasen`) and removed changesets, so upstream commits never apply 100% cleanly. This design records exactly which hunks apply as-is, which are dropped, and how the fix is verified.

## Goals / Non-Goals

- **Goals:** faithful behavioral parity with upstream for archive exit codes and scenario-drift protection; regression tests carried over; zero collateral change outside the touch-set.
- **Non-Goals:** no rebranding of the ported code beyond what already exists; no changeset file; no docs changes.

## Decisions

### Apply order (serial within the child)
Apply `5956a8e` first, then `7e21cc5`. The `7e21cc5` `archive.test.ts` hunk is cut against the post-`5956a8e` blob (`d0d5868`), so its context (the exit-code describe block) only exists after `5956a8e`'s test hunk lands. Picking in the reverse order fuzzes.

### Hunk-by-hunk plan

**`5956a8e` (`src/core/archive.ts`)** — 3 hunks, all clean:
- The three added lines are literally `process.exitCode = 1;` inserted before an existing `return null;`. The surrounding context lines (`console.log('\nValidation failed...')`, `console.log('Aborted. No files were changed.')`, the rebuilt-spec error block) are brand-neutral and present verbatim in our `archive.ts` (verified at ~L311, ~L429, ~L453). Applies as-is.

**`5956a8e` (`test/core/archive.test.ts`)** — 3 hunks, all clean:
- Add `originalExitCode` const; isolate `process.exitCode = undefined` in `beforeEach`; restore in `afterEach`; new `describe('exit code on blocked archive (human mode)')` block. All anchor context (`console.log = vi.fn();`, `archiveCommand = new ArchiveCommand();`, `// Restore console.log`) is brand-neutral and present. The added test bodies are brand-neutral (no `bin` path, no brand strings). Applies as-is.

**`5956a8e` (`.changeset/fix-archive-exit-code.md`)** — **DROP**. Changesets were removed during the fork. Do not create this file; if `git cherry-pick -n` materializes it, `git rm -f --cached` + delete before ship.

**`7e21cc5` (`src/core/specs-apply.ts`)** — clean:
- Adds `ScenarioBlock` interface; rewrites the MODIFIED loop to capture `currentBlock` and call `findMissingCurrentScenarios`; adds `findMissingCurrentScenarios` + `parseScenarioBlocks` helpers. The pre-image MODIFIED loop (`if (!nameToBlock.has(key))`) matches our file verbatim (verified ~L286). All added code is brand-neutral. Applies as-is.

**`7e21cc5` (`test/core/archive.test.ts`)** — clean given serial order:
- Adds the stale-MODIFIED scenario-drift test before the `should abort with a structural error...` test. Brand-neutral. Applies as-is on the post-`5956a8e` tree.

### Self-consistency note (this change's own spec delta)
Because `7e21cc5` is exactly the fix that makes `archive` abort when a MODIFIED block drops scenarios, this change's own `cli-archive` delta MODIFIED blocks reproduce the **full** current requirement text (every existing scenario) and only *append* new scenarios. Dropping any existing scenario would make this very change fail to archive once the fix is live.

## Risks / Trade-offs

- **Low risk.** Behavior fix in a single command; the exit-code change is additive (only tightens a previously-silent failure). The scenario-drift guard can, in principle, surface a new abort for a genuinely stale change delta — but that is the intended correctness behavior and matches upstream.

## Simple vs Complex (for adaptive-verify)

**Simple.** Single area (`archive` spec-apply path), no cross-cutting surface, deterministic. Targeted `test/core/archive.test.ts` run plus `pnpm build` is sufficient evidence; no full-suite or live QA required.

## Migration / Rollout

Local ship only. No user-facing migration.

## Open Questions
<!-- none -->
