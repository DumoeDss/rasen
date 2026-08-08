import { describe, it, expect } from 'vitest';
import { resolveModelPreset, MODEL_PRESETS } from '../../src/core/model-presets.js';
import { resolveModelLimit, DEFAULT_CONTEXT_LIMIT } from '../../src/core/agent-context.js';

describe('model-presets', () => {
  describe('resolveModelPreset', () => {
    it('resolves known model families by substring, case-insensitively', () => {
      expect(resolveModelPreset('claude-haiku-4-5-20251001')?.contextWindow).toBe(200_000);
      expect(resolveModelPreset('CLAUDE-HAIKU-4-5')?.contextWindow).toBe(200_000);
      expect(resolveModelPreset('claude-opus-4-8')?.contextWindow).toBe(1_000_000);
      expect(resolveModelPreset('claude-sonnet-5')?.contextWindow).toBe(1_000_000);
      expect(resolveModelPreset('claude-sonnet-4-6')?.contextWindow).toBe(1_000_000);
      expect(resolveModelPreset('claude-fable-5')?.contextWindow).toBe(1_000_000);
      expect(resolveModelPreset('claude-mythos-5')?.contextWindow).toBe(1_000_000);
    });

    it('resolves provider-prefixed ids', () => {
      expect(resolveModelPreset('us.anthropic.claude-haiku-4-5-20251001')?.contextWindow).toBe(
        200_000
      );
    });

    it('resolves the gpt-5 family with suggested absolute thresholds', () => {
      const preset = resolveModelPreset('gpt-5.6-sol');
      expect(preset?.contextWindow).toBe(272_000);
      expect(preset?.handoffThreshold).toEqual({ remainingTokens: 60_000 });
      expect(preset?.reuseThreshold).toEqual({ remainingTokens: 180_000 });
    });

    it('large-window families carry no suggested thresholds', () => {
      const preset = resolveModelPreset('claude-fable-5');
      expect(preset?.handoffThreshold).toBeUndefined();
      expect(preset?.reuseThreshold).toBeUndefined();
    });

    it('returns undefined for an unknown or absent model id', () => {
      expect(resolveModelPreset('some-unknown-model')).toBeUndefined();
      expect(resolveModelPreset(undefined)).toBeUndefined();
      expect(resolveModelPreset(null)).toBeUndefined();
      expect(resolveModelPreset('')).toBeUndefined();
    });

    it('every preset pattern resolves its own representative id to that entry', () => {
      // Regression guard: catches an entry silently shadowed by an earlier
      // one (e.g. a future broader pattern inserted before a narrower one).
      for (const preset of MODEL_PRESETS) {
        for (const pattern of preset.match) {
          expect(resolveModelPreset(pattern)).toBe(preset);
        }
      }
    });

    it('first match wins: an id matching two different entries resolves the array-earlier one', () => {
      // 'gpt-5-haiku' contains both the haiku pattern and the gpt-5 pattern —
      // two DIFFERENT table entries. The haiku entry precedes gpt-5 in
      // MODEL_PRESETS, so first-match-wins must return the haiku preset, not
      // the (also-matching) gpt-5 preset. A reordering that put gpt-5 first
      // would flip this assertion.
      const haikuIndex = MODEL_PRESETS.findIndex((p) => p.match.includes('haiku'));
      const gpt5Index = MODEL_PRESETS.findIndex((p) => p.match.includes('gpt-5'));
      expect(haikuIndex).toBeLessThan(gpt5Index);

      const resolved = resolveModelPreset('gpt-5-haiku');
      expect(resolved).toBe(MODEL_PRESETS[haikuIndex]);
      expect(resolved?.contextWindow).toBe(200_000);
    });
  });

  describe('resolveModelLimit parity with pre-change behavior', () => {
    it('matches prior resolutions for every previously-known id', () => {
      expect(resolveModelLimit('claude-opus-4-8')).toBe(1_000_000);
      expect(resolveModelLimit('claude-sonnet-5')).toBe(1_000_000);
      expect(resolveModelLimit('claude-sonnet-4-6')).toBe(1_000_000);
      expect(resolveModelLimit('claude-fable-5')).toBe(1_000_000);
      expect(resolveModelLimit('claude-mythos-5')).toBe(1_000_000);
      expect(resolveModelLimit('claude-haiku-4-5-20251001')).toBe(200_000);
      expect(resolveModelLimit('some-unknown-model')).toBe(DEFAULT_CONTEXT_LIMIT);
      expect(resolveModelLimit(undefined)).toBe(DEFAULT_CONTEXT_LIMIT);
      expect(resolveModelLimit(null)).toBe(DEFAULT_CONTEXT_LIMIT);
    });

    it('defaults an unrecognized model id to a 1M window, not 200K', () => {
      // Pinned as a LITERAL on purpose: asserting against DEFAULT_CONTEXT_LIMIT
      // is tautological and passed just as happily when the default was 200000.
      expect(DEFAULT_CONTEXT_LIMIT).toBe(1_000_000);

      // The test ids are chosen to not match any preset in the registry.
      // any preset (`claude-opus-99` is a future id absent from the registry; `glm` has no
      // entry), so both ride the default — the exact case that reported every
      // session as 5x more occupied than it was.
      expect(resolveModelPreset('claude-opus-99')).toBeUndefined();
      expect(resolveModelPreset('glm-5.2')).toBeUndefined();
      expect(resolveModelLimit('claude-opus-99')).toBe(1_000_000);
      expect(resolveModelLimit('glm-5.2')).toBe(1_000_000);
    });

    it('keeps haiku at 200K — the default does not swallow explicit presets', () => {
      expect(resolveModelLimit('claude-haiku-4-5-20251001')).toBe(200_000);
      expect(resolveModelLimit('gpt-5.6-sol')).toBe(272_000);
    });

    it('now also resolves gpt-5 family windows via the registry', () => {
      expect(resolveModelLimit('gpt-5.6-sol')).toBe(272_000);
    });
  });
});
