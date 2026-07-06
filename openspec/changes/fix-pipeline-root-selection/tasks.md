## 1. Register `--store` on the pipeline command group

- [x] 1.1 In `src/cli/index.ts`, add `.option('--store <id>', STORE_OPTION_DESCRIPTION)` and `.addOption(hiddenStorePathOption())` to all five pipeline subcommands (`list`, `show <name>`, `agents <name>`, `classify <task>`, `resume <change>`), reusing the existing `STORE_OPTION_DESCRIPTION` (index.ts:45) and `hiddenStorePathOption()` (index.ts:51).
- [x] 1.2 Widen each subcommand's `.action` options type to include `store?: string; storePath?: string`, and pass the full parsed `options` object through to the corresponding `PipelineCommand` method (do not drop the new fields).

## 2. Migrate `PipelineCommand` to root-selection

- [x] 2.1 In `src/commands/pipeline.ts`, extend `PipelineCommandOptions` (and thus `PipelineAgentsOptions`) with `store?: string` and `storePath?: string`.
- [x] 2.2 Replace `private resolveProjectRoot(): string { return process.cwd(); }` with an async helper that calls `resolveRootForCommand(selector, { json })` and returns `ResolvedOpenSpecRoot | null` (import `resolveRootForCommand` and the `ResolvedOpenSpecRoot` type from `../core/root-selection.js`). The selector is the command's options object (`{ store, storePath }`).
- [x] 2.3 Update `list`: `const root = await this.resolveRoot(options); if (!root) return;` then call `listPipelinesWithInfo(root.path)`.
- [x] 2.4 Update `show`: resolve root (early-return on null), then use `root.path` for `loadPipelineByName` and `listPipelines`.
- [x] 2.5 Update `agents`: resolve root (early-return on null), then use `root.path` for `loadPipelineOrExplain`, `listPipelines`, and `writeProjectPipelineOverride` (so the override is written under the resolved root, not the cwd).
- [x] 2.6 Update `classify`: resolve root (early-return on null), then use `root.path` for `listPipelines`.
- [x] 2.7 Update `resume`: resolve root (early-return on null); call `validateChangeExists(change, root.path, root.changesDir)` and derive `const changeDir = path.join(root.changesDir, changeName);` instead of `path.join(process.cwd(), 'openspec', 'changes', changeName)`.
- [x] 2.8 Confirm the JSON-failure contract: when the resolver returns `null` in `--json` mode, the method returns without printing further output (the resolver already emitted the machine-readable diagnostic and set `process.exitCode = 1`), matching `ValidateCommand.execute`.

## 3. Fix the orchestration template blackboard path teaching

- [x] 3.1 In `src/core/templates/workflows/_orchestration.ts`, update the run-state/blackboard teaching (Step F, ~line 104) so the LEAD is instructed to resolve the change's absolute directory from `openspec status --change <n> --json` and read the `changeRoot` field (NOT `changeDir`) before writing `auto-run.json`.
- [x] 3.2 Add a single clarifying note that every `openspec/changes/<name>/` path in the workflow (blackboard, handoff, planning-context) is relative to the SELECTED OpenSpec root — obtain the absolute base from `changeRoot` — so store-selected runs do not strand artifacts in the cwd.
- [x] 3.3 Regenerate the affected skill markdown from the templates (do not hand-edit `skills/**/SKILL.md`); confirm the generator ran and the `/opsx:auto` skill reflects the new wording.

## 4. Clarify store-selection guidance wording

- [x] 4.1 In `src/core/templates/workflows/store-selection.ts`, amend `STORE_SELECTION_GUIDANCE` so the `context` entry is disambiguated: the top-level `openspec context` takes `--store`, but `openspec agent context` does not — add a half-sentence so agents do not paste `--store` onto `agent context`.

## 5. Tests: store and subdirectory scenarios

- [x] 5.1 In `test/commands/pipeline.test.ts`, add a subdirectory case: create a planning-shaped root (`openspec/specs/` + `openspec/changes/`) with a project pipeline, run `pipeline list --json` from a nested subdirectory, and assert it resolves the ancestor root and lists the project pipeline (parity with `validate --pipelines`). Note a bare `openspec/pipelines/` dir does NOT qualify as a root.
- [x] 5.2 Add a store case following `test/commands/store-root-selection.test.ts`: register a store via `registerStore` + `getGlobalDataDir({ env })` with XDG_* env isolation (never touch the real global config), put a change with recorded `auto-run.json` in the store, then run `pipeline resume <change> --store <id> --json` from an unrelated cwd and assert `hasRunState: true` with the expected next/remaining stages.
- [x] 5.3 Add a store case asserting `pipeline list --store <id> --json` and `validate --pipelines --store <id> --json` report the same pipeline set from the store root.
- [x] 5.4 (Optional but recommended) Assert `pipeline agents <name> --store <id>` writes its override under the store root's `openspec/pipelines/<name>/pipeline.yaml`, and that `validate --pipelines --store <id>` then sees it.

## 6. Verify

- [x] 6.1 `pnpm build && pnpm test` all green (baseline: 114 files / 2070 cases).
- [x] 6.2 After the full test run, `openspec config list` to confirm the real global config at `%APPDATA%\openspec\config.json` was not polluted (guards against the recorded test-pollution incident).
- [x] 6.3 `openspec validate fix-pipeline-root-selection --json` passes.
