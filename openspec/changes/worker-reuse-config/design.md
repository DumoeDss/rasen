## Context

The pipeline registry already models a sibling concern — `handoff` — end to end: a Zod schema (`HandoffConfigSchema`) on the pipeline YAML, a field-wise resolver (`resolveStageHandoffConfig`) that layers stage > role > pipeline > built-in defaults, a resolved shape surfaced per-stage in `openspec pipeline show --json`, and run-state records (`SessionHandoffSchema`, `StageHandoffRecordSchema`) surfaced by `openspec pipeline resume`. This change mirrors that machinery for a new `reuse` block, deliberately reusing its idioms so the two blocks read as one family.

The load-bearing difference: `handoff` answers "should the worker holding this task hand off *now*", so it is meaningful per-stage. `reuse` answers "may a worker be carried into a whole new child change, and with how much headroom", which is a cross-stage / cross-child decision — so `reuse` is pipeline-level only and has no stage form. This is the reason the design is simpler than handoff (no stage override layer, no `StageReuseConfigSchema`).

Current relevant code (all under `src/core/pipeline-registry/`):
- `types.ts` — `HandoffThresholdSchema`, `HandoffRolesSchema`, `HandoffConfigSchema`, `DEFAULT_HANDOFF_CONFIG`, `resolveStageHandoffConfig`, and `PipelineYamlSchema` (which mounts `handoff`).
- `run-state.ts` — `RunStateWorkerSchema` (a `.passthrough()` object with optional `role`/`agentId`/`transcript`/`threadId`/…); `stageWorkers()` selects workers carrying `agentId || transcript || threadId`.
- `index.ts` — barrel re-exporting the above.
- `src/commands/pipeline.ts` — `show()` builds a `result` object (top-level `name`/`description`/`agents`/`buildOrder`/`stages`); `toStageView()` (~line 597) attaches `resolveStageHandoffConfig(stage, pipeline)` as `handoff`; `resume()` (~line 419) builds `workersWithContext` by spreading each worker record.

## Goals / Non-Goals

**Goals:**
- Add a validated pipeline-level `reuse` block and a resolver, exactly paralleling the handoff idioms so the implementer can copy-adapt.
- Surface the resolved reuse config once at the top level of `openspec pipeline show --json`.
- Accept and pass through an optional `reusedFrom` lineage marker on worker records, surfaced by `openspec pipeline resume`.

**Non-Goals:**
- No stage-level `reuse` (cross-change concern). No reuse *decision logic* — this change only defines/validates/surfaces config and lineage; the policy that reads it ships in the follow-up `worker-reuse-playbook`.
- No change to handoff behavior. No new CLI subcommand or flag.

## Decisions

**1. `reuse` is pipeline-level only; resolver returns per-role resolved thresholds.**
Add to `types.ts`, modeled on the handoff symbols:
```ts
export const ReuseModeSchema = z.enum(['auto', 'never']);            // planner/implementer switch
const ReuseThresholdSchema = z.number().gt(0,{…}).lte(1,{…});        // reuse HandoffThreshold’s (0,1] rule (own copy — messages say "reuse threshold")
const ReuseRolesSchema = z.object({ planner: ReuseThresholdSchema.optional(), implementer: ReuseThresholdSchema.optional() }).strict();
export const ReuseConfigSchema = z.object({
  planner: ReuseModeSchema.optional(),
  implementer: ReuseModeSchema.optional(),
  threshold: ReuseThresholdSchema.optional(),
  roles: ReuseRolesSchema.optional(),
}).strict();
export const DEFAULT_REUSE_CONFIG = { planner: 'auto', implementer: 'auto', threshold: 0.25 } as const;
```
`.strict()` gives the "unknown key rejected" scenario for free (handoff relies on the same). Mount it on `PipelineYamlSchema` as `reuse: ReuseConfigSchema.optional()`, sibling of `handoff`.

Resolver, paralleling `resolveStageHandoffConfig` but pipeline-scoped and returning both modes plus resolved per-role thresholds:
```ts
export interface ResolvedReuseConfig {
  planner: 'auto' | 'never';
  implementer: 'auto' | 'never';
  threshold: number;                              // pipeline-level resolved threshold
  roles: { planner: number; implementer: number }; // per-role resolved thresholds
}
export function resolvePipelineReuseConfig(pipeline: PipelineYaml): ResolvedReuseConfig
```
Per-role threshold = `reuse.roles[role] ?? reuse.threshold ?? DEFAULT_REUSE_CONFIG.threshold`. Modes = `reuse[role] ?? DEFAULT_REUSE_CONFIG[role]`. The top-level `threshold` = `reuse.threshold ?? DEFAULT_REUSE_CONFIG.threshold`. Only `planner`/`implementer` are reusable roles, so `roles`/resolved-roles cover exactly those two (reviewer/fixer/shipper are out of scope — fixer's fresh-eyes value is the reason, per the portfolio design). Restricting `ReuseRolesSchema` to those two keys (rather than reusing the 5-role handoff shape) both documents scope and rejects `roles: { reviewer: … }` as an unknown key.

*Alternative considered — reuse `HandoffThresholdSchema` directly:* rejected only to keep the validation message vocabulary ("reuse threshold") self-describing; the numeric rule is identical, so an implementer may alias it if preferred. Not load-bearing.

**2. Resolved reuse surfaces at the top level of `pipeline show --json`, not per-stage.**
Because reuse has no stage dimension, attach it once to the `show()` `result` object as `reuse: resolvePipelineReuseConfig(pipeline)` (sibling of `agents`), rather than inside `toStageView`. This keeps `StageView` untouched and matches the config's actual granularity. Existing consumers (e.g. `auto.ts`) see a new top-level key only; no stage shape changes.

**3. `reusedFrom` is one optional string on the worker record; passthrough surfaces it.**
Add `reusedFrom: z.string().optional()` to `RunStateWorkerSchema` in `run-state.ts`. The schema is already `.passthrough()`, so a `reusedFrom` in `auto-run.json` already round-trips; declaring it makes the field first-class (documented, typed, discoverable) and is the spec's contract. `resume()` spreads worker records into `workersWithContext`, so `reusedFrom` surfaces with no change to the spread. Do NOT gate stage-worker inclusion on `reusedFrom`: `stageWorkers()` keeps its `agentId || transcript || threadId` filter — a reused worker carries a transcript, so it is already included; `reusedFrom` is descriptive lineage, not an inclusion key. Export the type via `index.ts` if a new type symbol is added (the field rides the existing `RunStateWorker` type, so likely only the new `types.ts` symbols need barrel exports).

## Risks / Trade-offs

- [Resolved-reuse shape must stay stable for `auto.ts`/playbook consumers] → Fix the `ResolvedReuseConfig` shape now (modes + top-level threshold + per-role resolved thresholds) and cover it with a `pipeline show --json` test, so the follow-up playbook builds against a settled contract.
- [Two near-identical threshold schemas (handoff vs reuse) invite drift] → Acceptable: they are independent product knobs with distinct validation-message vocabulary; a shared `(0,1]` helper could be extracted later without behavior change.
- [Windows CLI e2e flake (EBUSY rmdir / 10s timeout), known prior] → not logic; isolate-rerun to confirm. runCLI e2e tests execute `dist`, so `pnpm run build` must precede `test/commands/*` (called out in tasks.md).
