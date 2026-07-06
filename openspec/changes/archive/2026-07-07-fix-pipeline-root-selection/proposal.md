## Why

After the upstream v1.5.0 merge, `openspec validate --pipelines` resolves its OpenSpec root through the shared root-selection layer (`resolveRootForCommand`), but the `openspec pipeline` command group (`list`/`show`/`classify`/`resume`/`agents`) is still hard-wired to `process.cwd()` and never registers `--store`. The two surfaces now disagree about which root a pipeline lives in: from a subdirectory or a store-pointer repo, `pipeline list` sees a different (or empty) pipeline set than `validate --pipelines`, `pipeline resume` reads run-state from the wrong directory (`hasRunState:false`), and `pipeline agents` writes a ghost override into the cwd that root-aware commands never see. This breaks `/opsx:auto` resume and portfolio orchestration in every store scenario. The pipeline commands must align with the same root-selection semantics `validate` already uses.

## What Changes

- Register `--store <id>` (and the hidden `--store-path` rejection option) on all five `pipeline` subcommands, matching the flag surface `validate` exposes.
- Migrate `PipelineCommand.resolveProjectRoot()` from `process.cwd()` to the shared `resolveRootForCommand(selector, { json })` resolver; make it async and thread a store selector through all five entry points (`list`, `show`, `agents`, `classify`, `resume`).
- Derive `pipeline resume`'s change directory from the resolved `root.changesDir` instead of `path.join(process.cwd(), 'openspec', 'changes', …)`, so run-state is read from the selected root.
- Fix the `/opsx:auto` orchestration template (`_orchestration.ts`) so the blackboard / run-state teaching resolves the change directory as an absolute path from `openspec status --change <n> --json` (the `changeRoot` field), instead of a cwd-relative `openspec/changes/<name>/`.
- Clarify the store-selection guidance (`store-selection.ts`) so it distinguishes the top-level `openspec context` (takes `--store`) from `openspec agent context` (does not), preventing agents from mis-applying the flag.
- Add store and subdirectory regression cases to `test/commands/pipeline.test.ts`.
- The pipeline-registry layer (resolver / run-state / portfolio-state) is intentionally **not** changed — it already passes the input root path straight through with no internal cwd.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `opsx-pipeline-registry`: The Pipeline CLI Surface requirement gains root-selection semantics — the command group resolves its root through the shared resolver and honors `--store <id>`, matching `validate`.
- `opsx-orchestration`: The Change Directory Blackboard and Run-State requirement is tightened to require the LEAD to resolve the change directory as an absolute path (from `openspec status … --json`), so run-state lands in the selected root rather than the cwd.

## Impact

- Code: `src/cli/index.ts` (pipeline command group registration), `src/commands/pipeline.ts` (root resolution + resume changeDir), `src/core/templates/workflows/_orchestration.ts` (blackboard path teaching), `src/core/templates/workflows/store-selection.ts` (context wording).
- Generated skills: the `/opsx:auto` skill markdown is regenerated from the `_orchestration.ts` template.
- Tests: `test/commands/pipeline.test.ts` (new store + subdirectory cases).
- No change to the pipeline-registry public API or on-disk run-state format.
