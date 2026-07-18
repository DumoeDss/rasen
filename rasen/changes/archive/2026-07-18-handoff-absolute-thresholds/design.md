# Design: handoff-absolute-thresholds

## Context

Threshold plumbing today:

- `src/core/pipeline-registry/types.ts` — `HandoffThresholdSchema` and `ReuseThresholdSchema` are bare `z.number()` in (0, 1]. `resolveStageHandoffConfig(stage, pipeline)` resolves stage > `handoff.roles[<role>]` > pipeline > `DEFAULT_HANDOFF_CONFIG` (0.5) and reports `source: 'stage' | 'role' | 'pipeline' | 'default'`. `resolvePipelineReuseConfig(pipeline)` resolves `roles[<role>]` > `threshold` > `DEFAULT_REUSE_CONFIG` (0.25).
- `src/core/agent-context.ts` — `resolveModelLimit(model)` is already a crude built-in model→window map (haiku→200K; opus-4/sonnet-5/sonnet-4-6/fable/mythos→1M; default 200K). Probes report `{ model, contextTokens, limit, pct, transcript }`. Codex rollouts carry their exact `model_context_window` inline and bypass the map.
- `src/commands/pipeline.ts` (`toStageView`, `show`) reports resolved handoff/reuse in `pipeline show --json`; `src/commands/agent.ts` formats the probe.
- `src/core/templates/workflows/_orchestration.ts` (Step H, B.1.5, G.1.3) and `handoff.ts` instruct the LEAD to compare probe `pct` against resolved thresholds.
- The stage's model is already resolvable via `resolveStageRuntimeConfig(stage, pipeline).model` (stage `model` > `pipeline.agents[<role>].model` > none) — this is the hook for a model-keyed preset layer.

## Goals / Non-Goals

**Goals:**
- Unambiguous dual-form thresholds (fraction | absolute remaining tokens) accepted everywhere a fractional threshold is accepted today.
- One shared model registry providing context windows and suggested thresholds; consulted by both context-limit resolution and threshold resolution.
- Preset layer slots just above built-in defaults; every ordinary config value overrides it.
- Byte-for-byte behavior for existing fraction configs and for `pipeline show --json` output of pipelines that configure no absolute values and name no preset-known model. Known deliberate exception: the threshold-provenance-first `source` logic (D3) changes `source` for two edge combos where a stage's `handoff` block is non-empty (sets `maxRelays` only, no `threshold`) but a HIGHER-precedence layer actually supplies the resolved threshold — the old any-field `hasFields` check stopped at "the stage block is non-empty" and reported `'stage'` regardless. (1) Stage sets only `maxRelays`, pipeline supplies `threshold`: now reports `source: 'pipeline'` (previously `'stage'`). (2) Stage sets only `maxRelays`, a pipeline-level `handoff.roles[<role>]` override supplies the threshold: now reports `source: 'role'` (previously `'stage'`). Both leave the resolved threshold VALUE unchanged — this is truthful `source` labeling, not a behavior regression — and both combos are test-pinned in `test/core/pipeline-registry/pipeline.test.ts`.

**Non-Goals:**
- No user-editable preset file / project-level preset overrides — overriding happens through ordinary `handoff`/`reuse` config (the existing precedence already provides this).
- No change to run-state schemas, relay counters, `maxRelays`/`stallLimit`, or the two-threshold-families rule.
- No live model-API lookup of context windows; the registry is static data (Codex rollouts keep their exact inline window).
- No version bump.

## Decisions

### D1 — Config shape: bare number = fraction, `{ remainingTokens: N }` = absolute

`threshold: 0.5` keeps its exact meaning; the absolute form is only ever the object `{ remainingTokens: <positive integer> }`. Rejected alternatives:

- *"numbers > 1 are tokens"* — makes `1` a boundary case users must memorize, leaves 1-token inexpressible, and a typo like `50` (meant 0.50) silently becomes 50 tokens. The object form makes intent explicit and is the existing config idiom (cf. `AgentRuntimeConfigValueSchema`, a string-shorthand | object union).
- *string forms like `"60000 tokens"`* — needs parsing, no schema-level validation, foreign to the YAML idiom here.

`remainingTokens` (not `usedTokens`) because the user's actual signal is remaining headroom: "hand off when fewer than N tokens remain". It is also window-portable — the same `{ remainingTokens: 60000 }` means the same thing on a 300K and a 1M model, which is exactly why absolute form exists.

Zod: `HandoffThresholdSchema` / `ReuseThresholdSchema` become unions of the existing fraction number and a strict object `{ remainingTokens: z.number().int().positive() }`. Exported type `ThresholdValue = number | { remainingTokens: number }`.

### D2 — Comparison semantics: both forms express "required headroom", each in its native direction

- **Handoff** (fire = stop and relay): fraction fires when `pct >= t`; absolute fires when `limit - contextTokens <= N`. (Equivalent: `pct >= t` ⇔ `remaining <= (1−t)·limit`.)
- **Reuse** (pass = may take a new child change): fraction passes when `pct <= t` (occupancy ceiling, as today); absolute passes when `limit - contextTokens >= N` (headroom floor).

The playbook templates state these two rules once, next to the existing two-threshold-families rule.

### D3 — Resolved values pass the configured form through; no normalization to fraction

`ResolvedStageHandoffConfig.threshold` and `ResolvedReuseConfig.threshold`/`roles.*` widen from `number` to `ThresholdValue`. `pipeline show --json` therefore emits a bare number exactly as before for fraction configs (byte-identical) and the self-describing object for absolute configs. Rejected alternative: normalizing absolute → fraction at resolution time — impossible without knowing the probe-time limit (Codex rollouts report their own window), and it would erase the user's intent from `show` output.

`source` gains `'preset'` and is threshold-provenance-first: it names the layer that supplied the resolved THRESHOLD specifically (stage `threshold` ?? role ?? pipeline `threshold` ?? preset, in that order), not merely a layer that touched the handoff block at all. A pipeline block that sets `roles.reviewer` alone, for example, must not tag an unrelated implementer stage's preset-sourced threshold as `'pipeline'` — the original `hasFields`-based "did this layer's block have ANY field" check would do exactly that, since it sees `roles` and stops looking. `source` falls back to the original `hasFields` check only in the residual case where NO layer supplies a threshold at all (every field falls through to the built-in default); there, `source` still reports whichever layer configured `maxRelays`/`stallLimit`, preserving pre-preset behavior for that edge.

### D4 — Model-preset registry: new `src/core/model-presets.ts`, substring patterns, first match wins

```ts
export interface ModelPreset {
  /** case-insensitive substrings; a model id matches if it contains any */
  match: string[];
  contextWindow: number;
  handoffThreshold?: ThresholdValue;
  reuseThreshold?: ThresholdValue;
}
export function resolveModelPreset(model: string | undefined | null): ModelPreset | undefined;
```

Ordered most-specific-first, first match wins (same substring matching `resolveModelLimit` uses today, so provider-prefixed ids keep resolving). Initial table:

| family (match) | contextWindow | handoffThreshold | reuseThreshold |
|---|---|---|---|
| `haiku` | 200 000 | — (default 0.5) | — (default 0.25) |
| `opus-4`, `sonnet-5`, `sonnet-4-6`, `fable`, `mythos` | 1 000 000 | — | — |
| `gpt-5` (covers gpt-5.x / gpt-5.x-codex) | 272 000 | `{ remainingTokens: 60000 }` | `{ remainingTokens: 180000 }` |

Large-window families deliberately carry no suggested thresholds — the built-in fraction defaults are already right for them; the preset layer only earns its keep on small windows. The GPT-5 numbers are suggestions tuned to "degrades gracefully near the limit": handoff at <60K remaining ≈ 78% occupancy; reuse needs ≥180K free ≈ 34% occupancy — both deliberately looser than the fraction defaults would be on that window. The table is plain data; adding a family is a one-entry edit.

`resolveModelLimit` in `agent-context.ts` becomes a thin wrapper: `resolveModelPreset(model)?.contextWindow ?? DEFAULT_CONTEXT_LIMIT` — identical behavior for every id it resolves today (one source of truth, no behavior change).

### D5 — Preset slot in resolution

- **Handoff** (`resolveStageHandoffConfig`): resolve the stage's model via `resolveStageRuntimeConfig(stage, pipeline).model`; threshold = stage ?? role ?? pipeline ?? `preset.handoffThreshold` ?? default. Only `threshold` has a preset layer — `maxRelays`/`stallLimit` are model-independent.
- **Reuse** (`resolvePipelineReuseConfig`): per-role threshold = `reuse.roles[<role>]` ?? `reuse.threshold` ?? preset-for-`agents[<role>]`-model`.reuseThreshold` ?? default. The top-level `threshold` field stays config ?? default (there is no single pipeline-wide model); the preset applies at the per-role step, keyed by that role's configured model. No configured model for a role ⇒ no preset layer for it (we do not guess the Claude default model id).

### D6 — Probe output gains `remainingTokens`

`AgentContextResult` and `ContextEstimate` gain `remainingTokens = max(0, limit - contextTokens)` (0 when limit is 0/unknown, matching the honest-zero Codex convention). The JSON and text output of `rasen agent context` include it, so a LEAD comparing an absolute threshold reads one field instead of doing arithmetic. Additive: existing consumers of `{contextTokens, limit, pct}` are untouched.

### D7 — Template prose updates

`_orchestration.ts` Step H (defaults/comparison paragraph and the two-threshold-families block) and `handoff.ts` gain the dual-form rule from D2 and mention `remainingTokens` in probe output. The resolution-order sentence gains "> model preset" before "built-in defaults".

## Risks / Trade-offs

- [Preset thresholds are opinions] → they sit below every config layer; any user value wins; the table documents intent ("suggested") and each value's rationale is in D4.
- [`gpt-5` substring is broad] → first-match-most-specific ordering lets a future narrower entry (e.g. `gpt-5-nano`) precede it; matching is the same convention `resolveModelLimit` already shipped with.
- [Widened `ThresholdValue` leaks into `pipeline show --json` consumers] → the only in-repo consumers are the orchestration templates, updated in this change; fraction-only pipelines emit unchanged JSON.
- [Absolute threshold with unknown limit (Codex rollout with no window yet, limit=0)] → `remainingTokens` reports 0, which would naively read as "fired". The templates state the rule: a probe with `limit: 0` carries no window information, so NEITHER form fires on it (the fraction form already reads pct=0 as not-fired); a young rollout is by definition not near its limit.
- [Drift between registry and reality as models evolve] → static table is explicitly a convenience; Codex rollouts always trust their inline window over the registry.

## Migration Plan

Pure addition. Existing YAMLs parse identically (fraction branch of the union). No data migration, no rollback steps beyond reverting the commit.

## Open Questions

- Exact GPT-5.6 window (272K used, per published input-token limit; the registry is one-line editable if the provider number differs).
