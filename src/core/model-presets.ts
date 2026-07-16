/**
 * Built-in model-preset registry.
 *
 * A single source of truth for two things that are both keyed by model id:
 * context-window size, and suggested handoff/reuse thresholds for models
 * whose window is small enough that the built-in fraction defaults fire too
 * early in absolute-token terms (design D4). Presets are pure data — every
 * ordinary config value (stage, role, or pipeline threshold) overrides a
 * preset's suggestion; a preset only fills a gap nothing else configured.
 */

/**
 * A threshold value: a bare fraction of the context window in (0, 1], or an
 * absolute required-headroom threshold in tokens. A bare number is ALWAYS a
 * fraction — the absolute form is ALWAYS the `{ remainingTokens }` object, so
 * no value is ambiguous.
 */
export type ThresholdValue = number | { remainingTokens: number };

export interface ModelPreset {
  /** Case-insensitive substrings; a model id matches if it contains any. */
  match: string[];
  /** Context-window size in tokens. */
  contextWindow: number;
  /** Suggested handoff threshold for this family, if it differs from the built-in default. */
  handoffThreshold?: ThresholdValue;
  /** Suggested reuse threshold for this family, if it differs from the built-in default. */
  reuseThreshold?: ThresholdValue;
}

/**
 * Ordered most-specific-first; the first matching entry wins. Matching is
 * case-insensitive substring matching (the same convention `resolveModelLimit`
 * shipped with), so provider-prefixed ids (e.g. `us.anthropic.claude-...`)
 * resolve correctly.
 *
 * Large-window families deliberately carry no suggested thresholds — the
 * built-in fraction defaults are already right for them; the preset layer
 * only earns its keep on small windows. The GPT-5 numbers are tuned to
 * "degrades gracefully near the limit": handoff at <60K remaining ≈ 78%
 * occupancy; reuse needs ≥180K free ≈ 34% occupancy — both deliberately
 * looser than the fraction defaults would be on that window.
 */
export const MODEL_PRESETS: ModelPreset[] = [
  { match: ['haiku'], contextWindow: 200_000 },
  {
    match: ['opus-4', 'sonnet-5', 'sonnet-4-6', 'fable', 'mythos'],
    contextWindow: 1_000_000,
  },
  {
    match: ['gpt-5'],
    contextWindow: 272_000,
    handoffThreshold: { remainingTokens: 60_000 },
    reuseThreshold: { remainingTokens: 180_000 },
  },
];

/**
 * Resolve a model id to its preset via case-insensitive substring matching,
 * first match wins. Returns `undefined` for an absent or unrecognized id —
 * callers fall back to their own built-in defaults.
 */
export function resolveModelPreset(model: string | undefined | null): ModelPreset | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  for (const preset of MODEL_PRESETS) {
    if (preset.match.some((m) => id.includes(m))) return preset;
  }
  return undefined;
}
