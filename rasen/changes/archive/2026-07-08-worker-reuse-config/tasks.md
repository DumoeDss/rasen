## 1. Reuse config schema + resolver (src/core/pipeline-registry/types.ts)

- [x] 1.1 Add `ReuseModeSchema` (`z.enum(['auto','never'])`), a reuse threshold schema (`(0, 1]`, messages phrased "reuse threshold"), and `ReuseRolesSchema` (`.strict()`, only `planner`/`implementer` optional thresholds).
- [x] 1.2 Add `ReuseConfigSchema` (`.strict()`, optional `planner`/`implementer` modes, optional `threshold`, optional `roles`) and mount it on `PipelineYamlSchema` as `reuse: ReuseConfigSchema.optional()` (sibling of `handoff`).
- [x] 1.3 Add `DEFAULT_REUSE_CONFIG = { planner: 'auto', implementer: 'auto', threshold: 0.25 }` and `ResolvedReuseConfig` interface (`planner`, `implementer`, `threshold`, `roles: { planner, implementer }`).
- [x] 1.4 Add `resolvePipelineReuseConfig(pipeline)`: per-role threshold = `reuse.roles[role] ?? reuse.threshold ?? default`; modes = `reuse[role] ?? default`; top-level `threshold = reuse.threshold ?? default`.
- [x] 1.5 Export the new symbols (`ReuseConfigSchema`, `ReuseModeSchema`, `DEFAULT_REUSE_CONFIG`, `ResolvedReuseConfig`, `resolvePipelineReuseConfig`) from `src/core/pipeline-registry/index.ts`.

## 2. Run-state lineage (src/core/pipeline-registry/run-state.ts)

- [x] 2.1 Add `reusedFrom: z.string().optional()` to `RunStateWorkerSchema` (keep `.passthrough()`); leave `stageWorkers()` inclusion filter (`agentId || transcript || threadId`) unchanged.

## 3. CLI surfacing (src/commands/pipeline.ts)

- [x] 3.1 In `show()`, add `reuse: resolvePipelineReuseConfig(pipeline)` to the top-level `result` object (sibling of `agents`); import `resolvePipelineReuseConfig`/`ResolvedReuseConfig`.
- [x] 3.2 Confirm `resume()` surfaces `reusedFrom` via the existing worker spread into `workersWithContext` (no gating change); add nothing if the spread already carries it.

## 4. Tests (mirror pipeline-handoff-config shapes)

- [x] 4.1 `test/core/pipeline-registry/pipeline.test.ts`: valid reuse block parses; invalid rejected (bad mode, threshold outside `(0,1]` top-level and per-role, unknown key); `resolvePipelineReuseConfig` resolution (per-role override > pipeline threshold > default; modes; no-block defaults).
- [x] 4.2 `test/core/pipeline-registry/run-state.test.ts`: worker record with `reusedFrom` parses round-trip; worker without it parses as before.
- [x] 4.3 `test/commands/pipeline.test.ts`: `pipeline show <name> --json` exposes resolved `reuse` (with and without a declared block); `pipeline resume` surfaces a worker's `reusedFrom` and omits it when absent.

## 5. Validate

- [x] 5.1 `pnpm run build` (runCLI e2e tests execute `dist` — build before the CLI tests in group 4), then run the touched test files; isolate-rerun any Windows EBUSY/timeout flake.
- [x] 5.2 `openspec validate worker-reuse-config` passes.
