# Tasks: handoff-absolute-thresholds

## 1. Model-preset registry

- [x] 1.1 Create `src/core/model-presets.ts`: `ThresholdValue` type (`number | { remainingTokens: number }`), `ModelPreset` interface (`match: string[]`, `contextWindow`, optional `handoffThreshold`/`reuseThreshold`), the ordered preset table per design D4 (haiku 200K; opus-4/sonnet-5/sonnet-4-6/fable/mythos 1M, no suggested thresholds; gpt-5 272K with `{ remainingTokens: 60000 }` handoff / `{ remainingTokens: 180000 }` reuse), and `resolveModelPreset(model)` with case-insensitive substring matching, first match wins
- [x] 1.2 Refactor `resolveModelLimit` in `src/core/agent-context.ts` to `resolveModelPreset(model)?.contextWindow ?? DEFAULT_CONTEXT_LIMIT`; delete the now-redundant local constants; verify existing resolutions unchanged
- [x] 1.3 Unit tests for `resolveModelPreset` (known families, provider-prefixed ids, unknown/absent model) and for `resolveModelLimit` parity with pre-change behavior

## 2. Dual-form threshold schemas

- [x] 2.1 In `src/core/pipeline-registry/types.ts`, widen `HandoffThresholdSchema` and `ReuseThresholdSchema` to unions: existing fraction number in (0, 1] OR strict object `{ remainingTokens: z.number().int().positive() }`; keep actionable error messages for out-of-range fractions, non-positive-integer `remainingTokens`, and unknown object keys; export `ThresholdValue` (or re-export from model-presets to avoid a cycle)
- [x] 2.2 Update the `ReuseThresholdSchema` doc comment per the worker-reuse-orchestration delta: fraction = occupancy ceiling (`pct <= threshold → reuse`), absolute = headroom floor (`remainingTokens >= N → reuse`)
- [x] 2.3 Schema tests: both forms parse at pipeline/role/stage handoff levels and reuse top-level/roles; invalid forms rejected (fraction 0 or >1, `remainingTokens` 0/negative/non-integer, unknown keys, bare number never read as tokens)

## 3. Resolution with the preset layer

- [x] 3.1 `resolveStageHandoffConfig`: widen `ResolvedStageHandoffConfig.threshold` to `ThresholdValue`, add `'preset'` to `source`; resolve the stage's model via `resolveStageRuntimeConfig(stage, pipeline).model` and slot `preset.handoffThreshold` between pipeline config and `DEFAULT_HANDOFF_CONFIG` (threshold only; `maxRelays`/`stallLimit` unchanged); `source: 'preset'` only when no stage/role/pipeline field contributed and the preset supplied the threshold
- [x] 3.2 `resolvePipelineReuseConfig`: widen `ResolvedReuseConfig.threshold` and `roles.*` to `ThresholdValue`; per-role resolution becomes `reuse.roles[<role>]` ?? `reuse.threshold` ?? preset-for-`agents[<role>]`-model`.reuseThreshold` ?? default; top-level threshold stays config ?? default
- [x] 3.3 Resolution tests: preset applies only when nothing configured; every config layer beats the preset; roles without a configured model skip the preset; existing fraction-only fixtures resolve byte-identically (including `source` values)

## 4. Probe output: remainingTokens

- [x] 4.1 In `src/core/agent-context.ts`, add `remainingTokens = max(0, limit - contextTokens)` to `AgentContextResult` and `ContextEstimate` (computed in both the transcript and rollout branches, and in `tryContextEstimate`); 0 when limit is 0
- [x] 4.2 In `src/commands/agent.ts`, include `remainingTokens` in the JSON output and the human-readable line; recompute against an explicit `--limit`
- [x] 4.3 Tests: probe output carries `remainingTokens` for Claude transcript, Codex rollout, zero-turn rollout (0), and `--limit` override

## 5. pipeline show reporting

- [x] 5.1 Verify `src/commands/pipeline.ts` (`toStageView`, `show`, `printPipelineDetail`) passes the widened resolved values through `--json` unchanged and renders the `{ remainingTokens }` form legibly in the human-readable detail view (e.g. `threshold=60000 tokens remaining`)
- [x] 5.2 Tests: `pipeline show --json` for a fraction-only pipeline is byte-identical to pre-change output; an absolute-threshold pipeline reports the object form and `source: 'preset'` where applicable

## 6. Orchestration template prose

- [x] 6.1 Update `src/core/templates/workflows/_orchestration.ts` Step H: resolution-order sentence gains `> model preset (by the stage's resolved model)` before built-in defaults; add the dual-form comparison rules (fraction `pct >= t` hands off / `pct <= t` allows reuse; absolute `remainingTokens <= N` hands off / `>= N` allows reuse) next to the two-threshold-families block; state that a `limit: 0` probe fires neither form
- [x] 6.2 Update `src/core/templates/workflows/handoff.ts` probe step to mention `remainingTokens` in the reported fields
- [x] 6.3 Rebuild/update generated skill outputs if the template pipeline requires it (follow the existing build→update flow for template changes) and run any template-parity checks — golden-master hashes in `test/core/templates/skill-templates-parity.test.ts` regenerated for the 8 affected templates (rasen-auto, rasen-goal, rasen-handoff, rasen-review-cycle + their opsx command counterparts); no committed generated-skills directory in this repo to rebuild

## 7. Verification

- [x] 7.1 Run the full test suite (`pnpm test`) and fix regressions — 133 files / 2746 tests, all green
- [x] 7.2 Run `rasen validate handoff-absolute-thresholds` and fix any artifact issues — "Change 'handoff-absolute-thresholds' is valid"
- [x] 7.3 Manual smoke: a fixture pipeline with `handoff: { threshold: { remainingTokens: 60000 } }` validates and shows correctly; a fixture with `agents.implementer.model: gpt-5.x` and no thresholds resolves `source: preset` — both confirmed via built CLI (`pipeline show --json` and human-readable, `validate --pipelines`)
