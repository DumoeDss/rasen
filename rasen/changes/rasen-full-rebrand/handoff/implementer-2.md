# Handoff — rasen-full-rebrand (implementer-2)

Reason: context heavily loaded after the D4/D5 refactors (init/update coexistence,
store metadata rename). Groups 2, 3, 4 code are complete and the build is green;
what remains is the ORDER-CRITICAL Group 5 (git mv + ~100-file / ~1355-ref test
sweep) and Group 6 (docs), plus the init/update integration tests for 2.5/4.4.
These are best done fresh. Tree is buildable; `node build.js` is GREEN.

## Completed this session (tasks.md updated): 3.2, 3.5, 2.3, 2.4, 4.1, 4.2, 4.3

### Tails (Group 3)
- **3.2** `command-file-id.ts`: added `toLegacyPrefixPath()` + reworked
  `getCommandFilePathCandidates()` so detection/cleanup also probe legacy
  `opsx`-prefixed paths (both subdir `commands/opsx/<id>.md` and hyphen
  `opsx-<id>.md` forms). Imports `COMMAND_PREFIX`/`LEGACY_COMMAND_PREFIX`.
- **3.5** New `src/core/pipeline-registry/legacy-skill.ts` exports
  `mapLegacySkillId()` (openspec-opsx-X→rasen-X, openspec-X→rasen-X,
  openspec:X→rasen:X, else null); re-exported from pipeline-registry/index.ts.
  Wired into `pipeline.ts resume()`: scans loaded pipeline stages for legacy
  skill IDs, emits `legacySkillHints` in JSON + a human hint block. (Real
  trigger: a project-local/user-override pipeline yaml authored pre-rebrand.)

### Group 2 (D2/D4) — coexistence
- **2.3 + 2.4** `src/core/legacy-cleanup.ts`: added `cleanupMarkerBlocks()`
  (removes ONLY OPENSPEC marker blocks from shared config files, never deletes
  anything) and `formatLegacyCoexistenceNotice()` (one-time notice, never
  removes). The old `cleanupLegacyArtifacts`/`formatDetectionSummary`/
  `formatCleanupSummary` REMAIN in the module (still used by
  legacy-cleanup.test.ts) — I did not delete them, only stopped calling them
  from init/update.
  - `src/core/init.ts`: replaced `handleLegacyCleanup`/`performLegacyCleanup`
    (auto-delete) with `noticeLegacyArtifacts()` (notice-only) + `offerMarkerCleanup()`
    (runs INSIDE the migrate flow, interactive-only, default NO). Removed the
    `formatDetectionSummary`/`cleanupLegacyArtifacts` imports + `LegacyDetectionResult`.
  - `src/cli/index.ts` `migrate` command: added `--no-interactive` and a
    consent-gated (default NO) `cleanupMarkerBlocks` step after the copy.
    Imports `isInteractive`.

### Group 4 (D4/D5) — update + store
- **4.1** init output already rasen-namespaced (predecessor's sweep + smoke test).
- **4.2** `src/core/update.ts`: step-1 now distinguishes legacy-only (points to
  `rasen migrate`/`rasen init`, throws → exit 1, no writes) vs uninitialized
  ("No rasen project found. Run 'rasen init' to set up."). Replaced the whole
  `handleLegacyCleanup`/`performLegacyCleanup`/`upgradeLegacyTools` machinery
  (removed ~215 lines) with `noticeLegacyArtifacts()`. Dropped `newlyConfiguredTools`
  and its onboarding block. Imports trimmed; `hasLegacyWorkspace` added.
- **4.3** `src/core/store/foundation.ts`: `STORE_METADATA_DIR_NAME='.rasen-store'`,
  new `LEGACY_STORE_METADATA_DIR_NAME='.openspec-store'`,
  `getLegacyStoreMetadataDir/Path`, `resolveReadableStoreMetadataPath` (read:
  prefer new, fall back legacy), `isStoreRoot` + `readStoreMetadataState` now
  legacy-aware, `copyForwardLegacyStoreMetadata()` (copy-only). Diagnostic text
  `.openspec-store`→`.rasen-store`.
  - `registry.ts ensureStoreMetadata`: calls `copyForwardLegacyStoreMetadata` when
    metadata already exists (the "next registration copies forward" scenario).
  - `operations.ts`: `.openspec-store/` display strings → `.rasen-store/`.
  - Default store location: `store.ts` (`~/openspec/<id>`→`~/${WORKSPACE_DIR_NAME}/<id>`,
    plus 3 example strings) and `references.ts:70` (`path.join(homedir,'openspec',id)`
    → `WORKSPACE_DIR_NAME`). Registered absolute paths NOT rewritten (unchanged).

### New tests (all GREEN in isolation — 15 tests):
- `test/core/workspace-migration.test.ts` (2.5 migration contract: copy, nested
  archive round-trip, source untouched, idempotent/no-overwrite, legacyMissing).
- `test/core/store/legacy-metadata.test.ts` (4.4 store: new write, legacy read,
  copy-forward, no-op when new present).
- `test/core/legacy-namespace-detection.test.ts` (3.2/3.5: mapLegacySkillId +
  legacy opsx candidate paths).
Run: `npx vitest run test/core/workspace-migration.test.ts test/core/store/legacy-metadata.test.ts test/core/legacy-namespace-detection.test.ts`

## Exact next actions (ORDER-CRITICAL)

1. **Group 5.3 — test-reference sweep FIRST (before git mv).** ~100 files,
   ~1355 refs of `opsx` / `openspec-` / `openspec:` / `.openspec-store` /
   `/openspec/` / `'openspec'`. Hub: `test/helpers/openspec-fixtures.ts`. Batch
   by directory; run each batch with `npx vitest run <dir>` (mind the Windows
   EBUSY flake on CLI-spawning tests — re-run the single failing file once).
   - **Behavioral (not token) rewrites needed** — my Group 2/4 changes changed
     behavior, so these files need logic edits, not just token swaps:
     - `test/core/init.test.ts` — init no longer auto-cleans legacy artifacts;
       it prints a coexistence notice and (only in the migrate flow, default no)
       offers marker removal. Any assertion that init deletes `.claude/commands/openspec`
       dirs / removes markers / prompts "Upgrade and clean up legacy files?" is stale.
     - `test/core/update.test.ts` — update: new "No rasen project found..." message;
       legacy-only project now exits 1 with migrate guidance and writes nothing;
       NO more legacy auto-upgrade / `newlyConfigured` onboarding. Refresh assertions.
     - `test/core/legacy-cleanup.test.ts` — the OLD functions still exist and
       still pass; ADD coverage for `cleanupMarkerBlocks` + `formatLegacyCoexistenceNotice`
       if you want 2.4 fully test-backed (optional; behavior is simple).
   - Store tests: `test/core/store/foundation.test.ts` etc. assert
     `.openspec-store` — swap to `.rasen-store` (const already renamed).
2. **Group 5.1 — `git mv openspec rasen`** (moves this change dir too → afterwards
   tasks.md/handoff live at `rasen/changes/rasen-full-rebrand/`; keep editing there).
   Then verify CLI resolves: `node bin/rasen.js status --change rasen-full-rebrand --json`
   (currently ERRORS because root resolution only accepts `rasen/` and the repo is
   still `openspec/` — this is EXPECTED and fixed by the git mv).
3. **Group 5.2** — `schemas/spec-driven/schema.yaml`, `templates/proposal.md`,
   `hooks/compact-recovery.sh`, `.github/workflows/*` path refs `openspec/`→`rasen/`.
4. **Group 5.3 tail / 5.4** — `pnpm test` fully green (use `node build.js` to build,
   NOT `pnpm build`). CI three-platform matrix.
5. **Group 6 (docs)** — README.md/README_zh.md (drop uninstall requirement, add
   Coexistence section: 4 isolated namespaces + copy-only `rasen migrate`, alignment
   wording → "workflow semantics aligned with upstream v1.5.0, independent namespaces"),
   docs/ + docs/zh/ + website/ sweep, CHANGELOG BREAKING entry.
6. Optionally round out **2.5/4.4** with init/update integration tests
   (legacy-only guidance, coexistence-notice, double-workspace-picks-rasen).
   Migration copy contract + store metadata compat are already tested.

## Gotchas (still true)
- `pnpm build` broken here — always `node build.js`. CLI: `node bin/rasen.js <args>`.
- Every path via path.join/resolve, including test expected values.
- `legacy-cleanup.ts` `LEGACY_SLASH_COMMAND_PATHS` / `RETIRED_EXPERT_SKILL_PREFIX`
  and `.openspec.yaml` metadata filename are the legacy-DETECTION whitelist +
  Non-Goals — do NOT rebrand them.
- `format: 'openspec'` / `format: 'openspec-change'` are file-format identifiers
  (Non-Goal) — leave them.
- `WORKFLOW_TO_SKILL_DIR` exists in TWO files (profile-sync-drift.ts + init.ts).
- Full suite is currently RED BY DESIGN (100 test files assert old tokens +
  init/update behavior changed). Do NOT treat that as regression — it is the
  Group 5 sweep backlog. Build is green.
