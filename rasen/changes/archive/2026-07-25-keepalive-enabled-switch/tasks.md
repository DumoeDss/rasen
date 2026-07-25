## 1. Configuration Contract

- [x] 1.1 Add `keepalive.enabled` to `src/core/config-keys.ts` as a global/project boolean in the Pipelines group with default `true`, update registry-count expectations, and cover scope/value validation in `test/core/config-keys.test.ts`.
- [x] 1.2 Extend `GlobalConfigSchema` in `src/core/config-schema.ts` and `ProjectConfigSchema` in `src/core/project-config.ts` with the optional boolean field, then add global/project schema round-trip coverage.
- [x] 1.3 Extend the keepalive input, resolved type, and default in `src/core/keepalive/index.ts`; test unset/true/false resolution while preserving all existing beat and runtime defaults in `test/core/keepalive.test.ts`.
- [x] 1.4 Add the `keepalive.enabled` config description to the English, Japanese, and Simplified Chinese CLI locale catalogs and extend locale/catalog tests without rewriting unrelated translations.
- [x] 1.5 Add effective-config coverage proving default source metadata, global values, project-over-global precedence, and store exclusion for `keepalive.enabled`.

## 2. Command and Orchestration Gates

- [x] 2.1 Resolve the effective enabled entry for the current planning root in `src/commands/agent.ts` through an explicit key lookup, and return `{ "standDown": true, "reason": "keepalive-disabled" }` before runtime, context, beat-state, signal, or polling work.
- [x] 2.2 Extend `test/commands/agent-wait.test.ts` with default-enabled, global-disabled, and opposing global/project override cases; assert disabled calls return promptly and create or mutate no beat-state file using `path.join`-based expectations that run on Windows.
- [x] 2.3 Update Step B.4 in `src/core/templates/workflows/_orchestration.ts` so the LEAD reads the effective switch once at run start, grants a reusable horizon only for enabled Claude stages, and dispatches all disabled/non-Claude stages as `ONE_SHOT` without embedding the parking protocol or raw switch value in their prompts.
- [x] 2.4 Extend `test/core/templates/orchestration-bundles.test.ts` to pin the run-start read, the enabled-plus-Claude condition, the `ONE_SHOT` fallback, and prompt omission while preserving the existing runtime safety-gate wording.

## 3. Pipelines UI

- [x] 3.1 Update `packages/ui/src/components/PipelinesPage.tsx` and its fixtures to look up both keepalive entries and render the dedicated control in Global mode and project Local mode, while omitting it from store Local mode.
- [x] 3.2 Extend `packages/ui/src/components/KeepaliveBeatControl.tsx` with an accessible effective-value toggle, per-key source/reset/error handling, and scope-correct `putKey`/`deleteKey` writes without clearing or coupling the retained beat value.
- [x] 3.3 Add only the minimal toggle modifiers needed in `packages/ui/src/style.css`; inspect the shared-worktree diff before and after so unrelated keepalive polish or i18n edits remain intact.
- [x] 3.4 Add enabled label, description, state, and accessible-name keys to all three `packages/ui/src/i18n/locales/*.json` catalogs and extend catalog/live-relocalization coverage.
- [x] 3.5 Extend `packages/ui/test/components/keepalive-beat-control.test.tsx` and `pipelines-page.test.tsx` for effective off/on rendering, global and project writes/unsets, inherited source restoration, store-local invisibility, API re-resolution, accessibility, and preservation of beat settings.

## 4. Verification

- [x] 4.1 Run the focused core and command tests for config keys, schemas, effective config, keepalive resolution, agent wait, and orchestration bundles; run `pnpm run build` first when the CLI test path depends on fresh `dist/`.
- [x] 4.2 Run the focused UI component, page, catalog, and live-relocalization tests plus the UI typecheck/build used by the package.
- [x] 4.3 Run `rasen validate keepalive-enabled-switch`, then trial the archive/spec-sync merge path without altering the real main specs and confirm every MODIFIED requirement targets the exact current heading and retains all pre-existing scenarios.
- [x] 4.4 Inspect the final explicit-path diff to confirm implementation/test files are limited to this change and that shared dirty files, unrelated UI polish, and untracked artifacts were preserved.
