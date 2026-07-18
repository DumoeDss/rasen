# Proposal: handoff-absolute-thresholds

## Why

All context-occupancy thresholds (handoff default 0.5, reuse default 0.25, per-role overrides) are fractions of the context window. For 1M-context models a fraction works, but for small-window models (e.g. the GPT-5.6 family at ~300K) a fraction fires far too early in absolute-token terms — and those models degrade gracefully near their limit, so the remaining absolute headroom is the better signal. Configs need an absolute-token threshold form, and the CLI should ship sensible per-model presets so users of small-window models get good behavior without hand-tuning.

## What Changes

- Handoff and reuse `threshold` values (pipeline-level, per-role, stage-level) accept a second form: `{ remainingTokens: <positive integer> }` — an absolute required-headroom threshold — alongside the existing bare fraction in (0, 1]. A bare number is ALWAYS a fraction; the absolute form is ALWAYS the object, so no value is ambiguous.
- A built-in model-preset registry keyed by model-id substring patterns provides, per known model family: the context-window size and suggested handoff/reuse threshold values. It subsumes the existing ad-hoc model→limit map in `resolveModelLimit`.
- Threshold resolution gains a preset layer just above built-in defaults: stage `handoff` > pipeline `handoff.roles[<role>]` > pipeline `handoff` > model preset (via the stage's resolved model) > built-in default. Reuse: `reuse.roles[<role>]` > `reuse.threshold` > model preset (via `agents[<role>]` model) > built-in default. Any ordinary config value therefore overrides a preset.
- `rasen pipeline show --json` reports resolved thresholds in whichever form they resolved to (bare number for fractions — byte-identical for existing configs — or the `{ remainingTokens }` object), and `source` can now be `preset`.
- `rasen agent context` output gains `remainingTokens` (limit − contextTokens) so absolute thresholds can be compared directly against a probe.
- The orchestration playbook and handoff templates state the comparison rule for both forms (fraction: `pct >= t` hands off / `pct <= t` allows reuse; absolute: `remainingTokens <= N` hands off / `remainingTokens >= N` allows reuse).
- Backward compatible: existing fraction configs parse and resolve byte-for-byte identically; no version bump.

## Capabilities

### New Capabilities
- `model-presets`: built-in registry of known model families (matched by model-id pattern) providing context-window size and suggested handoff/reuse thresholds; consulted by context-limit resolution and threshold resolution; overridable by any ordinary config value.

### Modified Capabilities
- `pipeline-handoff-config`: handoff `threshold` accepts fraction or `{ remainingTokens }`; resolution order gains the model-preset layer and a `preset` source.
- `worker-reuse-config`: reuse `threshold` (top-level and per-role) accepts fraction or `{ remainingTokens }`; resolution order gains the model-preset layer.
- `cli-agent-context`: context-limit resolution consults the shared model-preset registry (same behavior for known models, one source of truth); output shape gains `remainingTokens`.
- `orchestration-handoff`: playbook states the dual-form threshold comparison rule (fraction vs remaining-tokens).
- `worker-reuse-orchestration`: the reuse-threshold documentation requirement is widened to cover both forms (fraction = occupancy ceiling; absolute = required-headroom floor).

## Impact

- `src/core/pipeline-registry/types.ts` — threshold schemas become unions; `resolveStageHandoffConfig` / `resolvePipelineReuseConfig` gain the preset layer; resolved types widen.
- `src/core/model-presets.ts` (new) — the registry.
- `src/core/agent-context.ts` — `resolveModelLimit` delegates to the registry; result gains `remainingTokens`.
- `src/commands/agent.ts`, `src/commands/pipeline.ts` — output plumbing.
- `src/core/templates/workflows/_orchestration.ts`, `handoff.ts` — comparison-rule prose.
- Tests for schema, resolution precedence, registry matching, CLI output.
- No dependency, API-surface, or version changes; existing pipeline YAMLs and run-states unaffected.
