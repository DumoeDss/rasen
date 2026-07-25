## 1. Threshold scheme management API and wire contracts

- [x] 1.1 Add root management wire types for valid/invalid scheme entries, complete preset seeds with per-family source, capability-derived binding rows, and create/update/delete request/response unions.
- [x] 1.2 Implement the installation-wide threshold-scheme handler by composing the existing scheme CRUD library, model-preset registry, built-in threshold defaults, and `PROBE_RUNTIMES`; map invalid/conflict/not-found cases to the unified envelope without adding a CLI mutation path.
- [x] 1.3 Register authenticated GET/POST `/api/v1/threshold-schemes` routes with existing body limits and 405 handling.
- [x] 1.4 Add management API tests for empty/mixed-validity catalogs, complete preset seeds and source labels, runtime/default rows, create conflict, update/repair, delete, invalid input, authorization, method rejection, and Windows-safe temporary paths.
- [x] 1.5 Add equivalent UI API mirror types and client methods, plus compile-time/fixture tests that pin both mirrors to the same catalog and mutation shapes.

## 2. Pipeline threshold metadata over the management wire

- [x] 2.1 Define wire mirrors for threshold binding metadata and missing/invalid-scheme diagnostics, and extend effective handoff plus pipeline-level effective reuse shapes additively.
- [x] 2.2 Update pipeline inventory/detail projection to preserve `resolveEffectiveStage` handoff binding/diagnostic fields and call `resolvePipelineReuseConfig` with server-resolved planner/implementer runtimes from the same space bundle.
- [x] 2.3 Synchronize the UI pipeline mirror types and representative fixtures without reimplementing binding selection in the UI.
- [x] 2.4 Extend pipeline management API tests for runtime-specific handoff binding metadata, dangling fallback diagnostics, independent planner/implementer reuse bindings, default-row-only top-level reuse, store inheritance, and unchanged legacy fields.

## 3. Scheme library and preset UI

- [x] 3.1 Refactor the Pipelines page data load/refresh seam to fetch config, pipeline inventory, and the threshold-scheme catalog together while preserving open dialogs and drafts during background refresh.
- [x] 3.2 Implement valid and invalid scheme cards with scalar summaries, expandable role overrides, source/error states, and responsive styling.
- [x] 3.3 Implement the structured create/edit scheme editor with dual-form handoff/reuse scalars, constrained optional role overrides, client feedback, authoritative API errors, create conflict behavior, and no rename-on-edit.
- [x] 3.4 Implement separately confirmed delete with the dangling-binding warning, then refetch scheme, config, and effective pipeline surfaces after every successful mutation.
- [x] 3.5 Implement read-only model-preset cards from the server catalog and seed-from-preset into an unsaved complete create draft, preserving source badges and preventing preset editing/direct binding.
- [x] 3.6 Add UI tests for loading/empty/mixed-validity libraries, create/edit/delete success and failures, draft preservation, dual forms and role maps, preset provenance, default-filled presets, and seed-without-write.

## 4. Binding rows, slim Defaults, and migration guidance

- [x] 4.1 Implement binding rows from the server-provided eligible rows plus config API wildcard entries, including runtime/default labels, scheme selectors, effective and raw-scope badges, add/remove at the active scope, inherited-store handling, and refetch after writes.
- [x] 4.2 Add the no-binding compatibility empty state, dangling scheme warnings, and server-provided effective/fallback diagnostics without calculating a winner client-side.
- [x] 4.3 Slim the Defaults role matrix to model keys while retaining autopilot and keepalive beat controls in their established write paths.
- [x] 4.4 Add a collapsed Advanced Overrides surface for legacy handoff scalar/role keys, independent keepalive runtime/context-floor controls, and per-pipeline stage handoff instances while leaving stage gate/model and dispatch-runtime controls in their ordinary locations.
- [x] 4.5 Add detection-only migration guidance when bindings coexist with explicit legacy handoff values, accurately documenting precedence and fallback without any automatic create/bind/unset/delete mutation.
- [x] 4.6 Add UI tests for runtime vocabulary (including absent Zed), explicit/default add/remove, per-key project/store/global inheritance, scope-mode writes, empty/dangling states, model-only Defaults, advanced disclosure, keepalive separation, coexistence guidance, and zero-write notice behavior.

## 5. Three-language UI coverage

- [x] 5.1 Replace every new or changed threshold-management literal with `useT()` catalog keys while leaving runtime ids, scheme/model names, config paths, values, and server error details as data.
- [x] 5.2 Add complete English, Simplified Chinese, and Japanese entries for scheme, preset, binding, advanced, migration, loading, confirmation, validation, and mutation-feedback strings.
- [x] 5.3 Extend catalog parity and component locale tests to render every new surface in all three locales with no raw key/blank/English fallback in Japanese, and verify live relocalization preserves an unsaved scheme draft.

## 6. Binding-aware orchestration template delivery

- [x] 6.1 Update canonical Step H handoff precedence in `_orchestration.ts` to include configured stage instances, runtime-bound schemes with row-first scope fallback, inherited store, dangling diagnostics, preset, and default while directing the LEAD to consume resolver output.
- [x] 6.2 Update Step H's per-role and top-level reuse prose plus every feature-reduced replacement block so actual worker role/runtime, default-only top-level reuse, and missing/invalid scheme fallback match the core contract.
- [x] 6.3 Extend orchestration bundle/content tests to assert the exact handoff and reuse ordering in full and reduced playbooks, including store, explicit runtime rows before default rows, and no stale legacy-only sentence.
- [x] 6.4 Run `pnpm build`, then `node dist/cli/index.js update`, and inspect the refreshed dogfooding skills for the new Step H text; do not hand-edit generated skills.
- [x] 6.5 Run `pnpm vitest run test/core/templates/skill-templates-parity.test.ts`, replace only actual changed entries in both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`, and rerun until parity is green with unaffected hashes unchanged.

## 7. Integration and final verification

- [x] 7.1 Add end-to-end UI/core integration coverage proving create scheme → bind runtime → server-resolved pipeline handoff/reuse metadata → remove binding → legacy compatibility fallback, including a dangling-deletion branch.
- [x] 7.2 Run focused management API, pipeline/config integration, threshold, UI Pipelines, UI API mirror, i18n catalog/live-localization, orchestration bundle, and template parity suites; resolve all regressions.
- [x] 7.3 Run root and UI builds/type checks, lint/format checks, the full relevant test suites, and `rasen validate threshold-schemes-runtime-bindings-threshold-surfaces --type change --json`.
- [x] 7.4 Run the repository's Windows CI-equivalent checks for management filesystem mutations and UI/core integration, confirming all new path assertions use `path.join`/`path.resolve` and no package-version file changed.
