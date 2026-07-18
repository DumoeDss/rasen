# Planning Context — handoff-absolute-thresholds

## User intent (verbatim)

> 我们当前handoff的自动阈值都是用的百分比，对于1M的模型来说没问题，但是对于gpt5.6这种上下文只有300多K的模型就很不友好，因为这些模型的能力可以支持接近上限时能力下降不严重，因此需要让配置能够支持绝对值，以及内置一些模型的预设，能够根据模型名来提供一些预设（用户可以再手动修改）。开worktree新建开发分支。完成后提pr。

## Interpretation

Today all context-occupancy thresholds (handoff `threshold` default 0.5, reuse `threshold` default 0.25, per-role overrides) are **fractions of the context window**. That is reasonable for 1M-context models, but for small-window models (e.g. GPT-5.6 with ~300K context) a percentage fires far too early in absolute-token terms — and those models degrade gracefully near their limit, so the *remaining absolute headroom* is the better signal.

Required capabilities:

1. **Absolute-value threshold support** in config: a threshold may be expressed as an absolute token count (e.g. "hand off when remaining tokens < 60K" or "when used tokens > 240K" — planner to decide the exact semantics/shape, but the config must unambiguously distinguish fraction vs absolute). Everywhere a fractional threshold is consumed (handoff resolution, reuse resolution, `rasen agent context` comparisons, pipeline show reporting) must understand both forms.
2. **Built-in model presets**: a registry of known models (keyed by model name / pattern) providing preset threshold values tuned to their context window (context window size + suggested thresholds). Resolution by model name gives the preset; user config always overrides the preset (preset < project config < stage config, or per existing precedence — planner to slot it into the existing precedence chain: stage handoff > pipeline handoff.roles > pipeline handoff > preset-by-model > built-in default).
3. Presets must be user-modifiable (config can override any preset value).

## Constraints / decisions already made

- Branch: `feat/handoff-model-presets` in worktree `/Users/sayo/repos/rasen-worktrees/handoff-model-presets`, based on `dev/0.1.4`. PR target: `dev/0.1.4`.
- Version discipline: never bump major/minor; the change is version-agnostic.
- Keep backward compatibility: existing numeric fraction configs (0.5 etc.) must keep working unchanged.
- Relevant existing code (from prior sessions' knowledge): pipeline handoff resolution lives in the pipeline registry / `resolvePipelineReuseConfig` area (`src/core/`); `rasen agent context` measures occupancy as a percentage from transcript API usage. Codex worker rollouts already carry `context_window` in `turn_context` (verified fact from codex-parity research) — that may be a useful signal source for absolute-mode computation.

## Findings log (planner appends durable findings below)

### Planner round 1 (2026-07-16, propose)

- **Real files:** threshold schemas + both resolvers live in `src/core/pipeline-registry/types.ts` (`HandoffThresholdSchema`, `ReuseThresholdSchema`, `resolveStageHandoffConfig`, `resolvePipelineReuseConfig`, `DEFAULT_HANDOFF_CONFIG` 0.5 / `DEFAULT_REUSE_CONFIG` 0.25). Probe core is `src/core/agent-context.ts`; command layers are `src/commands/agent.ts` and `src/commands/pipeline.ts` (`toStageView` at ~:694 reports resolved handoff per stage). LEAD-facing comparison prose is `src/core/templates/workflows/_orchestration.ts` (Step H) and `handoff.ts`.
- **A model→window map already exists:** `resolveModelLimit` in agent-context.ts (haiku 200K; opus-4/sonnet-5/sonnet-4-6/fable/mythos 1M; default 200K). The new preset registry (`src/core/model-presets.ts`) subsumes it — one source of truth; `resolveModelLimit` becomes a thin wrapper.
- **Model hook for presets:** a stage's model resolves via `resolveStageRuntimeConfig(stage, pipeline).model` (stage > `pipeline.agents[<role>]`); reuse presets key off `agents[<role>].model`. No configured model ⇒ preset layer skipped (never guess a default model id).
- **Config shape decision (D1):** bare number is ALWAYS a fraction; absolute form is ONLY the strict object `{ remainingTokens: N }` (headroom semantics, window-portable). Rejected ">1 = tokens" (typo hazard, boundary ambiguity at 1). Resolved values pass the configured form through — no fraction normalization (limit unknowable at show time; Codex windows are inline per-rollout).
- **Comparison semantics (D2):** handoff fires at `pct >= t` / `remainingTokens <= N`; reuse passes at `pct <= t` / `remainingTokens >= N`. A `limit: 0` probe fires neither form.
- **Spec constraint discovered:** `worker-reuse-orchestration` has a requirement pinning the `ReuseThresholdSchema` doc comment to "occupancy ceiling, NOT headroom" — the absolute form IS headroom, so that requirement needed a MODIFIED delta (included) or archive-time sync would conflict.
- **Probe output gains `remainingTokens`** (additive) so absolute comparisons read one field.
- Artifacts: proposal/design/tasks + 6 delta specs (new `model-presets`; modified `pipeline-handoff-config`, `worker-reuse-config`, `cli-agent-context`, `orchestration-handoff`, `worker-reuse-orchestration`). `rasen validate` green.
