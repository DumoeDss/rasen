import { describe, expect, it } from 'vitest';

import { classify, clusterBursts } from '../../../src/core/token-audit/classify.js';
import type { BetweenLines, ParsedRequest } from '../../../src/core/token-audit/types.js';

function between(overrides: Partial<BetweenLines> = {}): BetweenLines {
  return { toolResultLines: 0, userTextLines: 0, metaLines: 0, compact: false, ...overrides };
}

function req(overrides: Partial<ParsedRequest> & { id: string }): ParsedRequest {
  return {
    ts: null,
    model: 'claude-opus-4-8',
    in: 0,
    cw: 0,
    cr: 0,
    out: 0,
    firstParent: null,
    prevLastUuid: null,
    between: between(),
    lastUuid: '',
    ...overrides,
  };
}

const MIN = 60_000;

describe('classify', () => {
  it('classifies the first request as spawn', () => {
    const { classes, churnEvents } = classify([req({ id: 'a', ts: 0, cw: 100 })], 60);
    expect(classes).toEqual(['spawn']);
    expect(churnEvents).toEqual([]);
  });

  it('classifies a warm continuation as hit when cache_read covers >=90% of the previous prefix', () => {
    const a = req({ id: 'a', ts: 0, cw: 200, cr: 0 });
    const b = req({ id: 'b', ts: 1 * MIN, in: 20, cw: 10, cr: 190, firstParent: 'u1', prevLastUuid: 'u1' });
    const { classes, churnEvents } = classify([a, b], 60);
    expect(classes).toEqual(['spawn', 'hit']);
    expect(churnEvents).toEqual([]);
  });

  it('classifies ttl-expiry when the idle gap meets the tier TTL and context did not shrink', () => {
    const a = req({ id: 'a', ts: 0, in: 100, cw: 200, cr: 0 });
    const b = req({
      id: 'b',
      ts: 65 * MIN, // >= 60min TTL
      in: 50,
      cw: 250, // keeps ctx(b)=300 >= 0.7*ctx(a)=210, so context-drop does not fire first
      cr: 0, // < 90% of prevPrefix (200) so it is churn, not hit
      firstParent: 'u1b',
      prevLastUuid: 'u1b', // not forked
    });
    const { classes, churnEvents } = classify([a, b], 60);
    expect(classes).toEqual(['spawn', 'ttl-expiry']);
    expect(churnEvents).toHaveLength(1);
    expect(churnEvents[0]).toMatchObject({ cause: 'ttl-expiry', rewrote: 250, forked: false, injected: false });
  });

  it('classifies rebase when the gap is under TTL but the parent chain forked', () => {
    const a = req({ id: 'a', ts: 0, in: 100, cw: 200, cr: 0 });
    const b = req({
      id: 'b',
      ts: 2 * MIN,
      in: 50,
      cw: 250,
      cr: 0,
      firstParent: 'some-other-uuid',
      prevLastUuid: 'u1b', // differs from firstParent => forked
    });
    const { classes, churnEvents } = classify([a, b], 60);
    expect(classes).toEqual(['spawn', 'rebase']);
    expect(churnEvents[0]).toMatchObject({ cause: 'rebase', forked: true, injected: false });
  });

  it('classifies rebase when a non-tool user message was injected', () => {
    const a = req({ id: 'a', ts: 0, in: 100, cw: 200, cr: 0 });
    const b = req({
      id: 'b',
      ts: 2 * MIN,
      in: 50,
      cw: 250,
      cr: 0,
      firstParent: 'u1b',
      prevLastUuid: 'u1b', // not forked
      between: between({ userTextLines: 1 }), // injected
    });
    const { classes, churnEvents } = classify([a, b], 60);
    expect(classes).toEqual(['spawn', 'rebase']);
    expect(churnEvents[0]).toMatchObject({ cause: 'rebase', forked: false, injected: true });
  });

  it('classifies context-drop when context shrinks below 70% of the previous context, regardless of gap', () => {
    const a = req({ id: 'a', ts: 0, in: 100, cw: 200, cr: 0 }); // prevCtx = 300
    const b = req({
      id: 'b',
      ts: 1 * MIN, // short gap: would not be ttl-expiry
      in: 50,
      cw: 50,
      cr: 50, // ctx(b) = 150 < 0.7*300 = 210
      firstParent: 'u1b',
      prevLastUuid: 'u1b',
    });
    const { classes, churnEvents } = classify([a, b], 60);
    expect(classes).toEqual(['spawn', 'context-drop']);
    expect(churnEvents[0].cause).toBe('context-drop');
  });

  it('classifies context-drop when the compact flag is set, even if context did not shrink', () => {
    const a = req({ id: 'a', ts: 0, in: 100, cw: 200, cr: 0 });
    const b = req({
      id: 'b',
      ts: 1 * MIN,
      in: 100,
      cw: 200,
      cr: 0,
      firstParent: 'u1b',
      prevLastUuid: 'u1b',
      between: between({ compact: true }),
    });
    const { classes } = classify([a, b], 60);
    expect(classes).toEqual(['spawn', 'context-drop']);
  });

  it('classifies unattributed when none of the churn fingerprints match', () => {
    const a = req({ id: 'a', ts: 0, in: 60, cw: 50, cr: 10 }); // prevPrefix = 60, prevCtx = 120
    const b = req({
      id: 'b',
      ts: 1 * MIN, // short gap
      in: 60,
      cw: 50,
      cr: 10, // ctx(b) = 120 >= 0.7*120 = 84; cr(10) < 0.9*60=54 -> churn
      firstParent: 'u1b',
      prevLastUuid: 'u1b', // not forked
    });
    const { classes, churnEvents } = classify([a, b], 60);
    expect(classes).toEqual(['spawn', 'unattributed']);
    expect(churnEvents[0].cause).toBe('unattributed');
  });
});

describe('clusterBursts', () => {
  it('keeps consecutive requests within the gap threshold in one burst', () => {
    const a = req({ id: 'a', ts: 0 });
    const b = req({ id: 'b', ts: 1 * MIN });
    const bursts = clusterBursts([a, b], ['spawn', 'hit']);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].requests).toBe(2);
    expect(bursts[0].resume).toBe('spawn');
  });

  it('splits a new burst after a gap exceeding BURST_GAP_MS, tagging it HIT or MISS by class', () => {
    const a = req({ id: 'a', ts: 0, cw: 10 });
    const b = req({ id: 'b', ts: 10 * MIN, cw: 20 }); // gap > 3min
    const bursts = clusterBursts([a, b], ['spawn', 'hit']);
    expect(bursts).toHaveLength(2);
    expect(bursts[0].resume).toBe('spawn');
    expect(bursts[1].resume).toBe('HIT');
    expect(bursts[1].rewrote).toBe(0); // HIT resumes do not carry a rewrite cost

    const bursts2 = clusterBursts([a, b], ['spawn', 'ttl-expiry']);
    expect(bursts2[1].resume).toBe('MISS');
    expect(bursts2[1].rewrote).toBe(20); // MISS resumes carry the churn write cost
  });
});
