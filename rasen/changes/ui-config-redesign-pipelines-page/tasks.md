> **Dependency note**: implemented in the MAIN tree, gated on `ui-config-redesign-wildcard-config` (the enabler) being review-clean there — its family machinery and instance API are this child's substrate. W2's Config-page state is also assumed landed (this change shrinks it).
>
> **Stacked-delta note**: FIVE pending changes' ADDED texts are quoted in this change's REMOVED blocks — W1 (`autopilot-gate-policy`, `opsx-pipeline-registry`, `pipeline-handoff-config`), W2 (`config-ui-package`), the enabler (`config-key-registry`), and W4 (`change-submission`, `management-http-api`). Archive order: W1, W2, W6, W4, and the enabler ALL before this change; W5 after. Before this change archives, re-check every REMOVED block against the archived sibling text verbatim.
>
> **LEAD merge points**: `whitelist.ts` rows and `Layout.tsx` nav entry collide additively with W4's worktree; if W4's review extracts a shared bounded submitter, adopt it here at merge.

## 1. Runtime family and stage-override resolver

- [x] 1.1 Add the `pipelines.<name>.runtimes.<role>` family row (enum `claude`/`codex`, scopes global/store/project, group `Pipelines`, no default) in `src/core/config-keys.ts`; extend the schema `pipelines` block with the `runtimes` sub-record in `global-config.ts`/`project-config.ts`; extend the family round-trip test.
- [x] 1.2 Create `src/core/pipeline-registry/stage-overrides.ts`: resolve all four family namespaces for one pipeline across project/store/global (reading the same layer objects `resolveEffectiveConfig` reads; store layer via `resolveConfigStoreLayer`), returning per-stage gate/model/handoff and per-role runtime override maps, each value with a scope-qualified source. Pure given the layer inputs; unit-tested per scope precedence.
- [x] 1.3 Wire the top layer into `resolveStageRuntimeConfig` and `resolveStageHandoffConfig` (`pipeline-registry/types.ts`): new optional top-layer params, source unions gain the scope-qualified per-stage values; chains below byte-identical (regression-test with the existing fixtures). Wire the runtime chain: family instance > `agents.<role>.runtime` > default.

## 2. Gate mask

- [x] 2.1 Implement mask composition in the stage-overrides resolver: per-stage instance (project→store→global) → effective `autopilot.gates` off (flag→project→store→global, reusing the existing base resolution) → stage `gate:`. `'vet'` values pass through untouched and unmaskable (W5 boundary — zero vet edits anywhere in this change).
- [x] 2.2 `rasen pipeline show --json` reports per-stage effective gate/model/handoff/runtime with sources through the resolver; run-state shape untouched (base `gatePolicy` recorded as today; instances resolve live). Tests: mask tier precedence, `--no-gate` flag behavior unchanged, vet passthrough, pre-existing run-state parses.
- [x] 2.3 Rewrite `auto.ts` §0.5: the LEAD consults `pipeline show`'s effective gates instead of combining `autopilot.gates` with stage definitions; leave §0.6 and every vet mention byte-identical. Repaste the `rasen-auto` golden hash in `test/core/templates/skill-templates-parity.test.ts` from the failing test's actual.

## 3. `pipeline agents` re-point

- [x] 3.1 `src/commands/pipeline.ts`: `agents` writes runtime-family instances at the resolved root via the standard config write path; delete the `applyAgentRuntimeUpdates` + `writeProjectPipelineOverride` freeze path (keep `writeProjectPipelineOverride` only if other callers exist — verify; if none, remove it). Reads report resolved runtimes with sources.
- [x] 3.2 Tests: setting a runtime writes config not YAML; unset reverts to declaration; `--store <id>` writes the store's own config; a pre-existing frozen copy still resolves with its project source badge (no migration).

## 4. Pipelines API

- [x] 4.1 `src/core/config-api/router.ts`: `GET /api/v1/pipelines` gains `?space=` (reuse the config endpoints' space resolution + error vocabulary; launch-project fallback unchanged) and serves per-stage effective values + provenance/source through the stage-overrides resolver. Additive wire fields in `wire-types.ts`/`serialize.ts`.
- [x] 4.2 Whitelist rows `import-pipeline`/`init-pipeline`/`export-pipeline`/`delete-pipeline` in `src/core/management-api/whitelist.ts` (merge point with W4's four); new `src/core/management-api/pipeline-submit.ts` mirroring the W4 bridge (op discriminator, absolute-path + name guards, single argv tokens, `--yes` always on delete, `--force` only when flagged, cap-1, 60s timeout, 422 verbatim, 409 busy). Route POST on `/api/v1/pipelines`; PUT/DELETE stay 405.
- [x] 4.3 API tests: space-addressed inventory (project-layer pipeline visible only in its space; store space resolves its own root), effective-value reporting incl. mask and vet literal, token/405 guards, bridge per-op argv construction, guard rejections before spawn, built-in delete refusal passthrough, cap-1, cross-admission rejection (pipeline bridge refuses workflow ops and vice versa).

## 5. UI

- [x] 5.1 Mirror wire shapes (`packages/ui/src/api/types.ts` — including the enabler's `instanceKey` this change finally consumes) and add client methods (`listPipelines(space)`, `mutatePipeline`); config-instance writes reuse the existing config client.
- [x] 5.2 `PipelinesPage.tsx` + route registrations (`/p/:id/pipelines`, `/s/:id/pipelines`) + `Layout.tsx` nav entry (space-SCOPED, beside Config): Defaults table (role-matrix rows + `autopilot.gates`/`autopilot.selection` via reused `ConfigEntryRow`), per-pipeline sections (build-order stage lane, per-stage gate/model/handoff rows, per-role runtime controls, provenance + source badges), Global/Local scope mode identical to W2's pattern.
- [x] 5.3 Library action dialogs (init/import/export/delete) transplanted from the W4 flows: absolute-path fields, verbatim CLI errors, overwrite/force retries, built-in delete lock (export stays available on built-ins), in-flight submit guard, post-success refresh. No `validate` dialog — the ratified office-hours §W3 scope lists only import/export/init/delete and the bridge admits only those four ops; validation stays the CLI path (`rasen pipeline validate`) / W4 Workflows territory. spec.md + design.md D5 amended to drop the over-promised validate clause (review R1 M1).
- [x] 5.4 Config page shrink: TAB_MAP drops the Workflow tab and excludes the Workflow/Autopilot/Pipelines groups; delete `GatesInventoryPanel.tsx` and its tests. `labels.ts` kept intact — `labelFor` is the shared label source the Defaults table reuses, so the moved keys' labels travel with them.
- [x] 5.5 UI tests: defaults grid writes with mode scopes; two-write "gate small-feature at propose only" scenario end-to-end against fixtures; per-stage override write + re-render with source; unset falls back; built-in lock; nav entry; Config page renders exactly four tabs with no Workflow/Autopilot/Pipelines keys (grouping.test TAB_MAP/EXCLUDED_GROUPS).

## 6. Verification

- [x] 6.1 Full suite green: CLI `node build.js` ✓, UI `pnpm --filter @atelierai/rasen-ui build` ✓ + `typecheck` ✓ + 232 UI tests ✓; touched backend suites re-run (config-api/router, workflow-whitelist, pipeline-submit, stage-overrides, templates parity, pipeline) = 169 ✓; all new path handling is string-only (display paths; no `fs`).
- [x] 6.2 chrome-use SPA smoke NOT feasible against this build: `resolveUiPackageDir()` returns null (the `@atelierai/rasen-ui` bundle is not installed at the CLI root and has no sibling copy), so `rasen ui` serves API-only with no SPA to click — the W2-precedent fallback. Relying on the jsdom coverage in 5.5, which exercises the two-write gate scenario, per-stage override→source, stage model write (config write, never YAML), and import/export/delete equivalents.
- [x] 6.3 CHANGELOG note (version untouched): present under Unreleased > Changed, two bullets covering both halves — `autopilot.gates: off` reinterpreted as a maskable base (pierceable by a per-stage `on`) and `pipeline agents` no longer freezing pipeline copies (existing copies stay until manually removed). Verified wording covers the UI half too (the page surfaces this behavior; it adds no new semantics). No version bump.
- [x] 6.4 `rasen validate ui-config-redesign-pipelines-page --strict` re-run fresh from repo root after the UI work — valid. The five stacked-delta sources' verbatim re-check stays a LEAD pre-archive gate (archive order W1→W2→W6→W4→enabler→W3→W5): the siblings are not yet archived on this branch, so there is no archived text to diff against verbatim until archive time.
