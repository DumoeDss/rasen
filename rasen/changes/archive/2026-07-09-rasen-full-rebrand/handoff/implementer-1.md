# Handoff — rasen-full-rebrand (implementer-1)

Reason: self-assessment / budget. Groups 1 and 3 are essentially complete and the
build is green throughout; groups 4, 5, 6 (store, repo git-mv + ~96 test-file
sweep, docs) remain and are the bulk of the effort. Handing off with a clean,
buildable tree so a fresh context takes the mechanical sweep.

## State of the build
- `node build.js` is GREEN (use this, NOT `pnpm build` — pnpm errors with
  "packages field missing or empty" in this repo; `pnpm test` / `npx vitest run`
  work fine).
- New brand-guard test `test/core/brand-guard.test.ts` PASSES (3 tests): proves
  every generated command path/body and skill dirName/name/content is free of
  `/opsx:`, `opsx-`, `commands/opsx/`, `openspec-`, `openspec:`.
- Live smoke test done: `node bin/rasen.js init --tools claude` in a scratch dir
  produced `.claude/commands/rasen/`, `.claude/skills/rasen-*`, a `rasen/`
  workspace, and ZERO legacy tokens. The generation layer is validated end-to-end.

## Completed (tasks.md checkboxes updated): 1.1–1.4, 2.1, 2.2, 3.1, 3.3, 3.4, 3.6

### Group 1 — constants + workspace resolution (DONE)
- `src/core/config.ts`: added `WORKSPACE_DIR_NAME='rasen'`,
  `LEGACY_WORKSPACE_DIR_NAME='openspec'`, `COMMAND_PREFIX='rasen'`,
  `LEGACY_COMMAND_PREFIX='opsx'`, `SKILL_PREFIX='rasen'`. `OPENSPEC_DIR_NAME` is
  now a back-compat alias = `WORKSPACE_DIR_NAME`. `OPENSPEC_MARKERS` kept, commented
  legacy-only.
- Renamed `src/core/openspec-root.ts` → `src/core/workspace-root.ts` (via `git mv`).
  Constants renamed to `WORKSPACE_ROOT_DIR/CONFIG_YAML/CONFIG_YML/SPECS_DIR/
  CHANGES_DIR/ARCHIVE_DIR` + `ANCHORED_WORKSPACE_DIRS`, all derived from
  `WORKSPACE_DIR_NAME` (value 'rasen'). Importers updated: `store/operations.ts`,
  `root-selection.ts`, `shared-gather.ts`, `core/index.ts`.
  - DECISION: I did NOT rename the internal functions/types
    (`inspectOpenSpecRoot`, `ensureOpenSpecRoot`, `OpenSpecRootInspection`,
    `EnsureOpenSpecRootResult/Options`) or the store diagnostic CODE strings
    (`openspec_root_missing`, etc.). They are internal, not brand-guarded output,
    and renaming ripples into store tests. User-facing message text WAS updated
    ('Missing rasen/ directory.' etc.). If a later reviewer wants full purity,
    that's a mechanical follow-up — low priority.
- Task 1.3: routed the ~40 `'openspec'` path-segment literals through
  `WORKSPACE_DIR_NAME`. Files edited (import of `WORKSPACE_DIR_NAME` added at top):
  change.ts, doctor.ts, change-utils.ts, schema.ts, archive.ts, shared-gather.ts,
  item-discovery.ts, instruction-loader.ts, artifact-graph/resolver.ts,
  workflow/shared.ts, list.ts, planning-home.ts, project-config.ts,
  root-selection.ts, pipeline-registry/resolver.ts, specs-apply.ts, view.ts,
  spec.ts, references.ts (line 131 only).
  - LEFT DELIBERATELY (they are NOT workspace paths — do not touch):
    `format: 'openspec'` (spec.ts:50/115, markdown-parser.ts, spec.schema.ts) and
    `format: 'openspec-change'` (change-parser, change.schema) are the spec/change
    file FORMAT identifiers — Non-Goal keeps them.
  - STILL TODO in group 4: `store.ts:245` (`~/openspec/<id>` default) and
    `references.ts:69` (`~/openspec/<id>` store checkout) — these are the store
    default location, belong to task 4.3, NOT changed yet.
- Task 1.4: `planning-home.ts` gained `findLegacyWorkspaceRootSync()` +
  `legacyWorkspaceGuidance()`. `root-selection.ts` `resolveOpenSpecRoot()` now,
  when `allowImplicitRoot===false` and no rasen root, checks for a legacy
  `openspec/` and throws `RootSelectionError` code `legacy_workspace_detected`
  with migration guidance before the generic `no_openspec_root`.

### Group 2 — migrate command (2.1, 2.2 DONE; 2.3, 2.4, 2.5 TODO)
- NEW `src/core/workspace-migration.ts`: `migrateWorkspace(projectRoot)` —
  copy-only, skip-existing, per-file-failure-tolerant, idempotent, all path.join.
  Copies `openspec/{specs,changes,config.yaml,config.yml}` → `rasen/`. Also exports
  `hasLegacyWorkspace`, `hasRasenWorkspace`, `formatMigrationSummary`,
  `WorkspaceMigrationSummary`.
- `src/cli/index.ts`: registered `rasen migrate [path]` command (right before the
  `list` command). Prints summary; exit 1 if any file failed.
- `src/core/init.ts`: added `offerWorkspaceMigration()` called in `execute()` right
  before `handleLegacyCleanup`. Interactive → confirm prompt (default yes);
  non-interactive/declined → fresh workspace + hint. Imports added from
  workspace-migration.js.

### Group 3 — generation layer (3.1, 3.3, 3.4, 3.6 DONE; 3.2, 3.5 ~90%)
- 3.1: ALL 26 adapters in `src/core/command-generation/adapters/` now derive their
  path segment from `COMMAND_PREFIX` (imported from `../../config.js`). Both forms
  handled: subdir `'opsx'`→`COMMAND_PREFIX` and hyphen ``opsx-${commandId}``→
  ``${COMMAND_PREFIX}-${commandId}``; body frontmatter (`name:/id:` in
  cursor/iflow/continue) too. costrict's `.cospec/openspec/` → `.cospec/rasen/`.
  Comments cleaned. `types.ts:38` doc comment fixed.
- 3.2 (command-references.ts DONE; command-file-id.ts NOT done): 
  `transformToHyphenCommands` now builds its regex from `COMMAND_PREFIX`.
  REMAINING for 3.2: task text asks that `command-file-id.ts` legacy candidate-path
  logic incorporate `LEGACY_COMMAND_PREFIX` (so detection can still find old
  `opsx-*` / `commands/opsx/` files from older rasen installs). Not implemented —
  it's a detection concern tied to the group-2 legacy-notice work (2.4). Do it with 2.4.
- 3.3: `WORKFLOW_TO_SKILL_DIR` in BOTH `profile-sync-drift.ts` AND `init.ts`
  (there are two copies!) → `rasen-*` with double-prefix collapse
  (`openspec-opsx-ship`→`rasen-ship`). `skill-generation.ts` `getSkillTemplates()`
  dirNames (lines ~160-206) → `rasen-*`. `tool-detection.ts` `SKILL_NAMES` →
  `rasen-*`. Expert `name:` fields and `author:` in templates handled by 3.4 sweep.
  `skill-generation.ts:318` default author → 'rasen'.
- 3.4: swept ALL `src/core/templates/**/*.ts` (workflows + experts, incl.
  `_orchestration.ts`, `_shared.ts`) with ordered sed:
  `openspec-opsx-`→`rasen-`, `/opsx:`→`/rasen:`, `openspec-`→`rasen-`,
  `openspec:`→`rasen:`, `author: 'openspec'`→`'rasen'`, `openspec/`→`rasen/`.
  Also fixed non-template output/comments: welcome-screen.ts, init.ts (845/848 +
  comments), migration.ts:132, claude-settings.ts, command-file-id.ts comments,
  run-state.ts:91, update.ts:309-311, workflow/instructions.ts skill refs.
  DELIBERATELY KEPT: `.openspec.yaml` (change metadata filename — Non-Goal) still
  appears in archive-change.ts / bulk-archive-change.ts / propose.ts prose. Correct.
- 3.5 (pipeline yaml DONE; resume-error hint NOT done): all 7
  `pipelines/*/pipeline.yaml` swept to `rasen-*`/`rasen:*`. REMAINING: when
  pipeline resume reads an unknown legacy skill ID, emit an error hinting the
  old→new mapping. Minor edge case — defer or add in pipeline-registry resolver.
- 3.6: `test/core/brand-guard.test.ts` written and PASSING.

## Exact next actions (in order)
1. **Group 4 (store + init/update finish):**
   - `store/foundation.ts:28` `STORE_METADATA_DIR_NAME='.openspec-store'` →
     `.rasen-store` with legacy READ compat (probe new name, fall back to old) and
     copy-forward on write (D5). Also line 174 fix message text.
   - `store.ts:245` default `['~','openspec',id]` → `['~','rasen',id]`;
     `references.ts:69` `~/openspec/<id>` → `~/rasen/<id>` (task 4.3). Registered
     absolute paths in registry must NOT be rewritten.
   - init (4.1): already scaffolds `rasen/` + `rasen/config.yaml` and prints
     `/rasen:*` (verified in smoke test) — likely just needs test coverage.
   - update (4.2): `src/core/update.ts` — legacy-only project (`openspec/` but no
     `rasen/`) must exit 1 with migration guidance; only refresh rasen-namespace
     artifacts. Check current behavior against cli-update spec.
   - Legacy notices (2.4) + marker-cleanup gating (2.3): `handleLegacyCleanup` in
     init.ts currently auto-removes marker blocks via `cleanupLegacyArtifacts`.
     D4 says: init/update must NOT auto-clean markers or delete opsx/openspec-*
     artifacts — only print a one-time notice; marker removal moves behind explicit
     migrate-flow consent (default no). Read `src/core/legacy-cleanup.ts` carefully
     — it is the WHITELIST for legacy tokens (RETIRED_EXPERT_SKILL_PREFIX=
     'openspec-gstack-', `.opencode/command/opsx-*.md` patterns etc.) — those
     `openspec-`/`opsx-` literals are legacy DETECTION and MUST stay.
2. **Group 5 (repo self-bootstrap):**
   - ORDER-CRITICAL: groups 1–4 must be green first. Then `git mv openspec rasen`
     (moves this change dir too → change then lives at
     `rasen/changes/rasen-full-rebrand/`; update tasks.md at the NEW path after).
   - Then `schemas/spec-driven/schema.yaml`, `templates/proposal.md`,
     `hooks/compact-recovery.sh`, CI `.github/workflows/*` path refs `openspec/`→`rasen/`.
   - 5.3: the big one — ~96 test files, ~1300 refs. `test/helpers/openspec-fixtures.ts`
     is the hub. Batch by directory. Existing tests assert OLD tokens (e.g.
     `skill-generation.test.ts` asserts `dirName==='openspec-review-cycle'`,
     store tests assert `.openspec-store`, etc.) — these WILL fail until swept.
     After sweep, `npx vitest run` must be fully green (mind the Windows EBUSY
     flake on CLI-spawning tests — re-run the single file once before trusting).
3. **Group 6 (docs):** README.md/README_zh.md (drop uninstall requirement, add
   Coexistence section, `/opsx:`→`/rasen:`), docs/, docs/zh/, website/, CHANGELOG.

## Gotchas
- `pnpm build` is broken here — always `node build.js`.
- Cross-platform law: every path via path.join/resolve, including test expected values.
- `WORKFLOW_TO_SKILL_DIR` exists in TWO files (profile-sync-drift.ts AND init.ts) —
  keep them in sync.
- `legacy-cleanup.ts` is the legacy-detection whitelist — do NOT rebrand its
  `openspec-`/`opsx-` literals; the brand-guard test whitelists it by not
  exercising it.
- Metadata format literals (`format: 'openspec'`, `format: 'openspec-change'`) and
  `.openspec.yaml` filename are Non-Goals — leave them.
- Do NOT git commit (ship stage owns commits). Leave tree finished.
