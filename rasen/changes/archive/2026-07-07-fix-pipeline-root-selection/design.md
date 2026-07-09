## Context

The upstream v1.5.0 merge introduced a shared root-selection layer, `src/core/root-selection.ts`, whose CLI adapter `resolveRootForCommand(selector, { json })` resolves exactly one OpenSpec root: `--store <id>` selects a registered store's root, otherwise the nearest ancestor carrying a planning shape or config pointer wins, with an implicit-root fallback. `validate` was migrated onto it (`src/commands/validate.ts:86`) and consumes the resolved `ResolvedOpenSpecRoot` — using `root.path` for pipeline/spec discovery and `root.changesDir` for change lookup.

The `openspec pipeline` command group was **not** migrated. `PipelineCommand.resolveProjectRoot()` (`src/commands/pipeline.ts:126-128`) returns `process.cwd()` verbatim, and the CLI registration (`src/cli/index.ts:588-682`) registers no `--store` on any of the five subcommands. Every method (`list`, `show`, `agents`, `classify`, `resume`) calls `resolveProjectRoot()` and passes the result as the `projectRoot` string into pipeline-registry functions. `resume` additionally hard-codes `path.join(projectRoot, 'openspec', 'changes', changeName)`.

This is the sole divergence: the registry layer beneath both surfaces is root-agnostic. A prior session audited the resolver, run-state reader, and portfolio-state reader twice and confirmed each takes its root path purely as an argument with no internal `cwd()` call, so aligning the command layer is sufficient.

## Goals / Non-Goals

**Goals:**

- `pipeline list/show/classify/resume/agents` resolve their root identically to `validate` — same `--store` flag, same nearest-root walk, same implicit-root fallback.
- From a subdirectory or a store-pointer repo, `pipeline list` and `validate --pipelines` see the same pipeline set; `pipeline resume` on a store-root change reads that change's run-state (`hasRunState:true`).
- `pipeline agents` writes its project override into the resolved root, where root-aware `validate` can see it.
- The `/opsx:auto` template teaches agents to write the blackboard/run-state into the change's absolute directory, so store scenarios don't silently strand run-state in the cwd.

**Non-Goals:**

- Reverting `validate --pipelines` to cwd semantics (the direction is the opposite — pipeline commands move toward root-selection).
- Any change to the pipeline-registry public API, resolver precedence, or the on-disk `auto-run.json` / `portfolio-run.json` shape.
- Regenerating or editing generated `skills/**/SKILL.md` files by hand — they are regenerated from the TS templates.
- The stale `docs/zh` follow-up (explicitly a separate change).

## Decisions

### Resolver signature: return the full `ResolvedOpenSpecRoot`, not a string

`resolveProjectRoot(): string` is replaced by an async helper that returns the whole `ResolvedOpenSpecRoot` (or `null` on a JSON-mode resolution failure), because `resume` needs `root.changesDir` in addition to `root.path`. Each of the five methods becomes: resolve once, early-`return` if the resolver returned `null` (JSON failure already printed a machine-readable payload and set `process.exitCode = 1`), then continue using `root.path` where the old code used the cwd string. This mirrors `validate.ts:86-89` exactly (`const root = await resolveRootForCommand(options, { json: options.json }); if (!root) return;`).

The store selector is the command's options object itself — `resolveRootForCommand` reads `.store` / `.storePath` off it, the same object Commander populates. So `PipelineCommandOptions` gains `store?: string` and `storePath?: string`, and each subcommand's `.action` passes its parsed options straight through.

### `resume` change directory from `root.changesDir`

`resume` currently calls `validateChangeExists(change, projectRoot)` and builds `changeDir = path.join(projectRoot, 'openspec', 'changes', changeName)`. Both are switched to the resolved root: `validateChangeExists(change, root.path, root.changesDir)` (the helper already accepts a `changesDir` override — `src/commands/workflow/shared.ts:141-146`) and `changeDir = path.join(root.changesDir, changeName)`. This is what makes `readRunState` / `readPortfolioState` read from the selected store's change, fixing the `hasRunState:false` break.

### Registry layer untouched — recorded rationale

`src/core/pipeline-registry/` (resolver, run-state, portfolio-state) is deliberately not modified. The audit confirmed all of its entry points (`listPipelines`, `listPipelinesWithInfo`, `loadPipelineByName`, `getProjectPipelinesDir`, `readRunState`, `readPortfolioState`) accept the root path as a parameter and never call `process.cwd()` internally. Pushing the fix down into the registry would duplicate the root-selection logic that already lives in `root-selection.ts` and diverge the two consumers again. The fix belongs entirely in the command layer.

### Orchestration template: teach the absolute `changeRoot`, not a cwd-relative path

`_orchestration.ts` Step F (around line 104) tells the LEAD to write run-state to `openspec/changes/<name>/auto-run.json`. Read as a cwd-relative path, this strands run-state outside a store root. The fix adds an instruction to resolve the change's **absolute** directory once from `openspec status --change <n> --json`. **Correction to the seed:** the field that carries this absolute path is `changeRoot`, not `changeDir` (verified in `src/core/artifact-graph/instruction-loader.ts:492` — `formatChangeStatus` emits `changeRoot: context.changeDir`). The template must name `changeRoot`. The same absolute-path caveat applies to the blackboard/handoff/planning-context paths the template mentions (lines 50, 60, 70, 176); a single note that all `openspec/changes/<name>/` paths are relative to the selected root (obtain the absolute base from `openspec status`) covers them without rewriting each mention.

### store-selection guidance: disambiguate `context`

`STORE_SELECTION_GUIDANCE` (`store-selection.ts:7`) lists `context` among the `--store`-supporting commands. That is the top-level `openspec context`; our workflow templates elsewhere teach `openspec agent context`, which does **not** take `--store`. A half-sentence clarification prevents an agent from pasting `--store` onto `agent context`.

## Risks / Trade-offs

- **Async migration surface.** `resolveProjectRoot` becomes async, so all five call sites must `await` and handle the `null` (JSON-failure) return. Missing one leaves a method on cwd semantics. Mitigated by the store + subdirectory regression tests exercising each subcommand.
- **Behavior change from a subdirectory.** Users who ran `pipeline list` from a nested directory and relied on cwd semantics will now get the nearest-root result. This is the intended correction (parity with `validate`) and matches every other root-aware command, but it is a visible behavior change worth calling out in the change log.
- **Template wording only affects newly generated skills.** The `_orchestration.ts` fix reaches deployed skills only after regeneration; the generated `SKILL.md` files must be rebuilt (not hand-edited) as part of applying this change.
- **Test isolation.** The seed records a prior incident where a test polluted the real global config at `%APPDATA%\openspec\config.json`. New store tests MUST route the global data dir through the env (XDG_* / `getGlobalDataDir({ env })`) as `test/commands/store-root-selection.test.ts` does, and never touch the real global store registry.
