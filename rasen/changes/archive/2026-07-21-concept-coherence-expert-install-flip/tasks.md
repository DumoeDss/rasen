## 1. Constants, config marker, and profile expert sets

- [x] 1.1 In `src/core/workflow-registry/experts.ts`, memoize `getBuiltInExpertDefinitions()` in a module-level cache (M2); keep `getExpertSkillDefinitions`/`getExpertSkillNames` as pure static derivations.
- [x] 1.2 In `src/core/profiles.ts`, add `ALL_EXPERTS` (all 21 expert ids from `getExpertSkillDefinitions()`) and `QUALITY_FLOOR_EXPERTS` (`review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`); add a test asserting `QUALITY_FLOOR_EXPERTS ⊆ ALL_EXPERTS`.
- [x] 1.3 In `src/core/global-config.ts`, add `expertSelectionExplicit?: boolean` to `GlobalConfig` (machine-managed; absent = legacy). Do not default it in `DEFAULT_CONFIG`. Update the `profiles` config-schema doc/scenario references if needed.
- [x] 1.4 Extend `getProfileWorkflows(profile, customWorkflows, options?)` with `options.expertSelectionExplicit`: when not explicit → workflow set + `ALL_EXPERTS` (profile-independent legacy adopt); when explicit → `full`=`ALL_WORKFLOWS`+`ALL_EXPERTS`, `core`=`CORE_WORKFLOWS`+`QUALITY_FLOOR_EXPERTS`, `custom`=`customWorkflows` verbatim.

## 2. Closure resolver (the flip core)

- [x] 2.1 In `src/core/workflow-registry/selection.ts`, add an opt-in `{ includeSkillDependencies?: boolean }` to `resolveWorkflowSelection`. When set, after the `requires.workflows` closure, map each selected definition's `requires.skills` (dual form via `portablePathCollisionKey`) to catalog unit ids and include them. Leave the default (workflow-only) path byte-identical.
- [x] 2.2 In `src/core/shared/skill-generation.ts`, replace the always-install expert branch (`:142-151`): source expert `SkillTemplateEntry`s from the resolved (closure-included) selection's `kind === 'expert'` members, not from `catalog.definitions` unconditionally. Keep the `kind !== 'expert'` split on the workflow side.
- [x] 2.3 Introduce a single desired-set resolution used by both `init` and `update`: `getProfileWorkflows(..., { expertSelectionExplicit })` → `filterKnownWorkflowRoots` → `resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(id)`. Thread it to `getSkillTemplates` and the removal seam so install and removal never disagree.

## 3. Removal seam and drift

- [x] 3.1 In `src/core/update.ts`, extend `removeUnselectedSkillDirs` to iterate `getBuiltInCatalogDefinitions()` (workflows + experts) and remove any built-in unit id absent from `desiredWorkflows`. Verify `removeUnselectedCommandFiles` is unaffected (experts carry no command; its `definition.command` check already skips them) and iterate the catalog for symmetry.
- [x] 3.2 In `src/core/profile-sync-drift.ts`, drop the `&& kind !== 'expert'` clause from the five `source === 'built-in'` filters (`:122,146,166,209,222`) so experts count as installable/deselectable; confirm drift is computed against the closure-included desired set the install path uses.

## 4. Migration marker wiring + notice

- [x] 4.1 Set `expertSelectionExplicit = true` in every explicit-write path: `applyProfileState` (`profile-editor.ts`), `profile use`, `profile new`/`import`, and fresh `init`. Do NOT set it in `update`.
- [x] 4.2 In `update`, when resolving under the legacy branch (`expertSelectionExplicit !== true`), emit a one-time "experts are now selectable via `rasen profile`" notice, guarded to print once per project session (mirror the delivery-consolidation notice pattern); add en/ja locale strings for it.

## 5. Picker and named-profile validation (M1)

- [x] 5.1 In `src/commands/profile-editor.ts` `workflowChoices`, drop the `kind !== 'expert'` filter (`:145`); render workflows then experts as two labeled groups. Expert metadata from a new `messages.experts[id]` table; `checked` from `currentState.workflows.includes(id)`.
- [x] 5.2 Extend the `requiredBy` map to also follow selected workflows' `requires.skills` (dual form) so a closure-required expert renders `disabled` with a "required by" note (matrix row 8).
- [x] 5.3 Update `deriveProfileFromWorkflowSelection` to compare against `full`=`ALL_WORKFLOWS`+`ALL_EXPERTS` and `core`=`CORE_WORKFLOWS`+`QUALITY_FLOOR_EXPERTS`.
- [x] 5.4 M1: keep `validateProfileMembership` accepting expert ids via `catalog.has`; ensure `normalizeProfileDefinition` uses the workflow-only `resolveWorkflowSelection` (no `includeSkillDependencies`) so snapshots list exactly chosen ids. Add tests: an expert id is a valid member; an unknown id still fails; a snapshot is not auto-expanded with closure experts.

## 6. Locale

- [x] 6.1 Add a `profile.prompt.experts` table (name + description per expert id) to `src/locales/en.json` and `src/locales/ja.json`; keep both catalogs key/placeholder-identical.
- [x] 6.2 Add a catalog-test assertion that `profile.prompt.experts` keys are exactly the built-in expert ids in both languages (mirror the existing `profile.prompt.workflows` 1:1 guard). Leave `ALL_WORKFLOWS`/`profile.prompt.workflows` untouched.

## 7. T1 cleanup

- [x] 7.1 In `src/core/pipeline-registry/execution-validation.ts` `resolvePipelineExecutionSkillSets`, collapse the redundant expert-name Set insertion into a single pass.

## 8. Tests — the install-set matrix and guards

- [x] 8.1 Encode the design.md install-set matrix rows 1-14 as tests: per profile × marker state × closure. Tests must set `RASEN_HOME` (never delete it) to avoid reading the real `~/.rasen`.
- [x] 8.2 Non-regression (rows 1-3, 14): legacy `full`/`core`/`custom` installs resolve to all 21 experts and remove none on update; notice fires once.
- [x] 8.3 Flipped semantics (rows 5-11): fresh/explicit `core` installs floor experts (incl. `benchmark` via profile default, not closure); closure pulls `review`/`cso`/`qa`/`qa-only`/`design-review`; deselected unreferenced expert removed; deselected required expert retained.
- [x] 8.4 Delete-guard interplay (row 12) and `qa-only`→`qa` sidecar materialization under selection (row 13).
- [x] 8.5 Assert `builtins-v1.json` golden fixture and expert template parity hashes (`EXPECTED_FUNCTION_HASHES`/`EXPECTED_GENERATED_SKILL_CONTENT_HASHES`) are byte-identical (no regeneration) — a moved hash means an edit leaked into a template/projection.
- [x] 8.6 Sync sibling test surfaces that deep-equal expert install behavior: `skill-generation.test.ts`, profile-editor/drift tests, `named-profiles`/`profiles` tests, `catalog.test.ts`.

## 9. Validate

- [x] 9.1 Run `rasen validate concept-coherence-expert-install-flip --strict` and fix any flags.
- [x] 9.2 Run `pnpm test` (worktree-local) for the touched surfaces; isolate any Windows CLI-spawn flake per the known-flake note.

## 10. Review-round fixes (Blocker: cross-project marker leak; Major: preflight expert leniency)

- [x] 10.1 Blocker fix: add `src/core/expert-selection-state.ts` (per-project machine-local acknowledgment file, `resolveProjectHome`-scoped). `update.ts` computes its effective `expertSelectionExplicit` as `globalMarkerExplicit && projectAcknowledged`, so a project without its own acknowledgment always resolves the legacy (all-experts) branch on `update` regardless of the global marker, and the first post-flip `update` for a project writes that project's acknowledgment (one-run grace, mirroring the existing migration notice) instead of pruning immediately. Fresh (non-extend) `init` writes its own project's acknowledgment right away (nothing pre-existing to lose).
- [x] 10.2 Update design.md D4 with the "Review-round Blocker fix" subsection and matrix row 15; add the permanent cross-project regression test to `test/core/expert-install-flip.test.ts` (project A legacy → project B fresh init → project A's first `update` keeps all 21 → project A's second `update` narrows).
- [x] 10.3 Major fix: `resolvePipelineExecutionSkillSets` (`execution-validation.ts`) now reuses `resolveDesiredWorkflowSelection` (same resolver `init`/`update` use) instead of unconditionally enabling every expert name, so a not-installed expert named by a pipeline stage fails preflight with `pipeline_skill_disabled` instead of falling through to a raw dispatch-time error. Preserves the single-call-site/probe-once property. Added tests in `test/core/pipeline-registry/execution-validation.test.ts`: lean explicit profile without an expert fails preflight; the same profile still enables an expert it selected; a legacy (marker-absent) machine keeps every expert enabled.
- [x] 10.4 Re-review round 2 Major fix: threaded `projectRoot` into `resolvePipelineExecutionSkillSets`/`validatePipelineForExecution` (both now `async`, all call sites in `pipeline.ts`/`validate.ts` updated to `await`) so preflight gates the expert dimension exactly like `update.ts`'s per-project acknowledgment (`globalMarkerExplicit && projectAcknowledged`), not the raw global marker — otherwise a project with no acknowledgment of its own got a false-positive `pipeline_skill_disabled` during the Blocker fix's one-run delay window. Added 2 tests covering the false-positive-fixed case and the acknowledged-project-still-gates case.
