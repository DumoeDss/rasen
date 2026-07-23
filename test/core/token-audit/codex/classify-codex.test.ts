import { describe, expect, it } from 'vitest';

import { classifyCodex, clusterCodexBursts, CODEX_IDLE_GAP_MIN } from '../../../../src/core/token-audit/classify.js';
import type { CodexDeltaRequest } from '../../../../src/core/token-audit/parse-codex.js';

const BASE_TS = Date.parse('2026-01-01T00:00:00.000Z');

function req(over: Partial<CodexDeltaRequest> & { gapMin?: number; prevTs?: number }): CodexDeltaRequest {
  const gapMin = over.gapMin;
  const ts = over.ts !== undefined ? over.ts : gapMin !== undefined ? (over.prevTs ?? BASE_TS) + gapMin * 60_000 : BASE_TS;
  return {
    ts,
    turnId: null,
    inputTokens: over.inputTokens ?? 1000,
    cachedInputTokens: over.cachedInputTokens ?? 0,
    cacheWriteInputTokens: over.cacheWriteInputTokens ?? 0,
    outputTokens: over.outputTokens ?? 10,
    reasoningOutputTokens: over.reasoningOutputTokens ?? 0,
    totalTokens: over.totalTokens ?? 1010,
    contextEstimate: over.contextEstimate ?? over.inputTokens ?? 1000,
    fromIncrement: over.fromIncrement ?? true,
    markers: over.markers ?? { compacted: 0, rolledBack: 0, userMessage: 0 },
  };
}

describe('classifyCodex', () => {
  it('classifies the first request as spawn and a warm continuation as hit', () => {
    // prevPrefix = 1000 (cached) + 0 (cw); req reads 950 >= 900 => hit.
    const warm = req({ cachedInputTokens: 950, contextEstimate: 1100, ts: BASE_TS + 30_000, prevTs: BASE_TS });
    const prevWithPrefix = req({ cachedInputTokens: 1000, contextEstimate: 1000, ts: BASE_TS });
    const { classes, rebuildEvents } = classifyCodex([prevWithPrefix, warm]);
    expect(classes[0]).toBe('spawn');
    expect(classes[1]).toBe('hit');
    expect(rebuildEvents).toHaveLength(0);
  });

  it('attributes compaction-evidenced rebuilds to context-drop even across a long idle gap', () => {
    const prev = req({ cachedInputTokens: 1000, contextEstimate: 1000 });
    const after = req({
      cachedInputTokens: 0,
      contextEstimate: 1200, // context did NOT shrink; only the event evidences the drop
      gapMin: CODEX_IDLE_GAP_MIN + 30,
      prevTs: BASE_TS,
      markers: { compacted: 1, rolledBack: 0, userMessage: 0 },
    });
    const { classes, rebuildEvents } = classifyCodex([prev, after]);
    expect(classes[1]).toBe('context-drop');
    expect(rebuildEvents[0]).toMatchObject({ cause: 'context-drop', compacted: true });
  });

  it('attributes an injected user message to rebase (injection)', () => {
    const prev = req({ cachedInputTokens: 1000, contextEstimate: 1000 });
    const after = req({
      cachedInputTokens: 0,
      contextEstimate: 1100,
      gapMin: 1,
      prevTs: BASE_TS,
      markers: { compacted: 0, rolledBack: 0, userMessage: 1 },
    });
    const { classes, rebuildEvents } = classifyCodex([prev, after]);
    expect(classes[1]).toBe('rebase');
    expect(rebuildEvents[0]).toMatchObject({ cause: 'rebase', injected: true });
  });

  it('attributes a rollback to context-drop', () => {
    const prev = req({ cachedInputTokens: 1000, contextEstimate: 1000 });
    const after = req({
      cachedInputTokens: 0,
      contextEstimate: 1100,
      gapMin: 1,
      prevTs: BASE_TS,
      markers: { compacted: 0, rolledBack: 1, userMessage: 0 },
    });
    const { classes } = classifyCodex([prev, after]);
    expect(classes[1]).toBe('context-drop');
  });

  it('attributes a ratio-only context collapse (no event marker) to context-drop', () => {
    const prev = req({ cachedInputTokens: 1000, contextEstimate: 1000 });
    // No compaction/rollback/injection markers; context shrank below DROP_CTX_RATIO (70%).
    const after = req({ cachedInputTokens: 0, contextEstimate: 600, gapMin: 1, prevTs: BASE_TS });
    const { classes, rebuildEvents } = classifyCodex([prev, after]);
    expect(classes[1]).toBe('context-drop');
    expect(rebuildEvents[0]).toMatchObject({ cause: 'context-drop', compacted: false, rolledBack: false, injected: false });
  });

  it('event-evidenced injection outranks a coincidental ratio-only context shrink', () => {
    const prev = req({ cachedInputTokens: 1000, contextEstimate: 1000 });
    // Both a user_message AND a >30% context shrink: injection (an event) must win over the ratio inference.
    const after = req({ cachedInputTokens: 0, contextEstimate: 600, gapMin: 1, prevTs: BASE_TS, markers: { compacted: 0, rolledBack: 0, userMessage: 1 } });
    const { classes } = classifyCodex([prev, after]);
    expect(classes[1]).toBe('rebase');
  });

  it('falls back to the idle-gap ttl-expiry approximation when only spacing evidences the rebuild', () => {
    const prev = req({ cachedInputTokens: 1000, contextEstimate: 1000 });
    const after = req({ cachedInputTokens: 0, contextEstimate: 1100, gapMin: CODEX_IDLE_GAP_MIN + 1, prevTs: BASE_TS });
    const { classes, rebuildEvents } = classifyCodex([prev, after]);
    expect(classes[1]).toBe('ttl-expiry');
    // Idle-gap is flagged as an approximation at the payload level (spec: report presents it as approx.).
    expect(rebuildEvents[0].approximate).toBe(true);
  });

  it('leaves an unevidenced rebuild unattributed (never claims chain-fork)', () => {
    const prev = req({ cachedInputTokens: 1000, contextEstimate: 1000 });
    const after = req({ cachedInputTokens: 0, contextEstimate: 1100, gapMin: 1, prevTs: BASE_TS });
    const { classes, rebuildEvents } = classifyCodex([prev, after]);
    expect(classes[1]).toBe('unattributed');
    // No chain-fork field exists on the rebuild event; the only fork-ish cause is injection.
    expect(Object.keys(rebuildEvents[0])).not.toContain('forked');
  });
});

describe('clusterCodexBursts', () => {
  it('splits activity into bursts across an idle gap and labels the resume', () => {
    const rs = [
      req({ ts: BASE_TS, cacheWriteInputTokens: 0 }),
      req({ ts: BASE_TS + 60_000, cacheWriteInputTokens: 0 }),
      req({ ts: BASE_TS + 10 * 60_000, cacheWriteInputTokens: 4096 }), // >3min gap => new burst, MISS
    ];
    const classes = ['spawn', 'hit', 'ttl-expiry'] as const;
    const bursts = clusterCodexBursts(rs, [...classes]);
    expect(bursts).toHaveLength(2);
    expect(bursts[0].resume).toBe('spawn');
    expect(bursts[1].resume).toBe('MISS');
    expect(bursts[1].rewrote).toBe(4096);
  });
});
