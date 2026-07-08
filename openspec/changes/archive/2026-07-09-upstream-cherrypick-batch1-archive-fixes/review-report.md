# Review Report — upstream-cherrypick-batch1-archive-fixes

**Reviewer:** reviewer-a (did not author)
**Date:** 2026-07-09
**Branch:** main (uncommitted working-tree)
**Scope:** `src/core/archive.ts`, `src/core/specs-apply.ts`, `test/core/archive.test.ts` only. Sibling tree churn (package.json, .gitignore, workflows, package-lock.json, telemetry-*) ignored per task brief.

## VERDICT: APPROVE — upstream faithfulness held. No blockers, no majors.

---

## 1. Faithfulness to upstream intent — PASS

Compared the applied working-tree diff against `git show 5956a8e` (exit-code, #1311) and `git show 7e21cc5` (scenario drift, #1246/#1252). Every functional hunk is present and byte-identical to upstream:

**From 5956a8e (archive.ts):** all three `process.exitCode = 1;` lines present at the exact three human-mode abort sites — verified in context against the source, not just the diff:
- `archive.ts:312` — delta-spec validation failure (human branch, after the `json` `ArchiveBlockedError` throw, before `return null`).
- `archive.ts:435` — spec-rebuild failure (`buildUpdatedSpec` catch, human branch).
- `archive.ts:462` — rebuilt-spec `validateSpecContent` failure (human branch).

Each is guarded by the non-`json` path and sits immediately before `return null`. The three legitimate user-cancellation paths (`archive.ts:334`, `:369`, `:412` — declined confirm / cancelled) correctly do NOT set the exit code, matching upstream's "cancellations stay exit 0 by design."

**From 5956a8e (test isolation + 4 tests):** `originalExitCode` capture, `beforeEach` reset to `undefined`, `afterEach` restore, and the `exit code on blocked archive (human mode)` describe with all 4 cases — present verbatim.

**From 7e21cc5 (specs-apply.ts):** `ScenarioBlock` interface, the `currentBlock = nameToBlock.get(key)` change, the `findMissingCurrentScenarios` guard + descriptive throw, and the `parseScenarioBlocks` / `findMissingCurrentScenarios` helpers — all byte-identical. Plus the `stale MODIFIED blocks` (#1246) test.

**No hunk silently lost or half-applied.** The only intentional omission is `.changeset/fix-archive-exit-code.md`, correct for the fork (changesets removed) and explicitly called out in planning-context section A + proposal.md.

## 2. Fork-correctness of the adaptation — PASS

- **No brand regression.** grep for added `openspec` strings in the 3 files returns only `path.join(tempDir, 'openspec', ...)` test-fixture directory paths — this fork retains `openspec/` as the on-disk directory name (only the CLI/brand renamed to rasen). No product-facing "openspec" strings introduced. Error messages carried in (`... MODIFIED failed for header ...`) are brand-neutral.
- **`.changeset/` not resurrected** — `git status` shows no changeset files.
- **No changes outside the 3-file touch-set** attributable to this change. Other tree churn is the sibling implementer (workflows/lockfile) and the other session (telemetry-backend), per brief.

## 3. Scenario-drift guard semantics — PASS (with one documented limitation)

`findMissingCurrentScenarios` / `parseScenarioBlocks` correctly implement the #1246 delta semantics: for a MODIFIED requirement whose header already matches an existing block, any scenario name present in the current main-spec block but absent from the incoming block triggers an abort. This is exactly the accidental-drop guard (two changes MODIFY the same requirement; the second is stale). Comparison is by trimmed scenario-name string; `parseScenarioBlocks` anchors on `^####\s*Scenario:` and slices to the next scenario header. Correct against OpenSpec's full-block-replacement MODIFIED model.

**No false-positive risk on legitimate deltas** where the MODIFIED block reproduces all current scenarios and appends new ones — confirmed by the passing `stale MODIFIED` test (change A archives, change B with the stale block is rejected) and consistent with the "self-consistency gotcha" note in planning-context (every MODIFIED delta in this batch reproduces full current text).

**Documented limitation (Minor, upstream behavior — not introduced by fork):** the guard also fires if an author *intentionally* drops or renames a scenario via a MODIFIED block. This is upstream's deliberate conservative stance (#1246 treats omission as accidental; intentional removal belongs in REMOVED). Carried faithfully; no action needed. Same-named duplicate scenarios in the current block are Set-deduped so a drop of one duplicate wouldn't be detected — a pre-existing upstream edge, out of scope.

## 4. Tests — PASS

Ran `node build.js` then `node node_modules/vitest/vitest.mjs run test/core/archive.test.ts`: **32 passed**, vitest process itself exited clean.

- The 4 exit-code tests genuinely exercise the new behavior — they assert `process.exitCode === 1` (or `toBeUndefined()` for success), that no archive dir entry was created, that the main spec is unchanged, and the specific console message. Not tautological. Spot-3 test spies `Validator.prototype.validateSpecContent` (same pattern as the pre-existing `--no-validate` test) to reach the otherwise-defensive branch while `buildUpdatedSpec` runs for real.
- The drift test archives change A for real, then asserts change B is rejected with the named-scenario error, B is not archived, and A's scenario survives in the main spec.
- **Exit-code isolation is sound and load-bearing:** `afterEach` restores `originalExitCode` (undefined at module load), so a test setting `exitCode = 1` cannot leak into other suites or skew vitest's own exit status. The clean vitest exit confirms it works. The success test's `toBeUndefined()` proves no intra-suite leak.

## 5. Spec deltas — PASS

`specs/cli-archive/spec.md` MODIFIES `Archive Validation` (adds "Blocked archive sets a non-zero exit code in human mode" scenario naming all three abort points and preserving the exit-0 cancellation carve-out) and `Spec Update Process` (adds "Stale MODIFIED block dropping current scenarios is rejected"). Both scenarios accurately describe the implemented behavior with valid WHEN/THEN structure, and the MODIFIED blocks reproduce the full existing scenario set (consistent with the very guard being added).

---

## Durable findings

1. **The scenario-drift guard is intentionally conservative** — a MODIFIED block that omits any current scenario is always rejected, so any *deliberate* scenario removal/rename must go through REMOVED, not by dropping it from the MODIFIED block. This is upstream #1246 behavior carried faithfully; worth knowing when authoring future MODIFIED deltas in this fork.
2. **Exit-code test isolation via `originalExitCode` capture + `afterEach` restore is the correct pattern** and prevents a blocked-archive test from turning the whole vitest run non-zero — keep this if the suite is refactored.
