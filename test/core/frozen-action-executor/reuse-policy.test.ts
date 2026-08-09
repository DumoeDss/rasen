import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXECUTOR_POLICY_BLOCK,
  decideReuse,
  isPlaceholderLimit,
  resolveReusePolicy,
} from '../../../src/core/frozen-action-executor/reuse-policy.js';
import type { AuthoredSessionGuidance } from '../../../src/core/frozen-action-executor/reuse-policy.js';

function authoredGuidance(
  overrides: Partial<AuthoredSessionGuidance> = {}
): AuthoredSessionGuidance {
  return {
    reuse: 'same-invocation',
    sessionReuseAuthored: 'stage',
    handoffTokenLimit: 1,
    reuseRoundLimit: 1,
    ...overrides,
  };
}

const established = {
  invocationId: 'inv-1',
  role: 'implementer',
  workspaceInstanceId: 'ws-1',
  backend: 'hosted' as const,
};

describe('reuse policy resolution - provenance', () => {
  it('the authored sessionReuse scope carries authored provenance', () => {
    const policy = resolveReusePolicy({
      authored: authoredGuidance({ sessionReuseAuthored: 'review-thread' }),
    });
    expect(policy.sessionReuse.provenance).toBe('authored');
    expect(policy.sessionReuse.scope).toBe('review-thread');
    expect(policy.sessionReuse.reuse).toBe('same-invocation');
  });

  it('authored none resolves to never with authored provenance', () => {
    const policy = resolveReusePolicy({
      authored: authoredGuidance({
        reuse: 'never',
        sessionReuseAuthored: 'none',
      }),
    });
    expect(policy.sessionReuse.reuse).toBe('never');
    expect(policy.sessionReuse.provenance).toBe('authored');
  });

  it('every resolved value carries traceable provenance', () => {
    const policy = resolveReusePolicy({ authored: authoredGuidance() });
    expect(policy.sessionReuse.provenance).toMatch(/authored|definition|default/);
    expect(policy.handoffTokenLimit.provenance).toMatch(/authored|definition|default/);
    expect(policy.reuseRoundLimit.provenance).toMatch(/authored|definition|default/);
    expect(policy.touchMaxIdleMs.provenance).toMatch(/authored|definition|default/);
  });

  it('placeholder recorded limits resolve to default-provenance, never enforced as authored', () => {
    // A pre-slice Record carries placeholder numeric limits (here 1/1, the
    // 0.1.6 stamp). The executor treats them as default-provenance and applies
    // its own authoritative policy on top.
    const policy = resolveReusePolicy({
      authored: authoredGuidance({ handoffTokenLimit: 1, reuseRoundLimit: 1 }),
    });
    expect(policy.handoffTokenLimit.provenance).toBe('default');
    expect(policy.reuseRoundLimit.provenance).toBe('default');
    expect(policy.handoffTokenLimit.value).toBe(
      DEFAULT_EXECUTOR_POLICY_BLOCK.defaultHandoffTokenLimit
    );
    expect(policy.reuseRoundLimit.value).toBe(
      DEFAULT_EXECUTOR_POLICY_BLOCK.defaultReuseRoundLimit
    );
  });

  it('isPlaceholderLimit flags every recorded placeholder value', () => {
    // The 0.1.6 stamps were non-negative integers; every one is a placeholder.
    expect(isPlaceholderLimit(1)).toBe(true);
    expect(isPlaceholderLimit(0)).toBe(true);
    expect(isPlaceholderLimit(10_000)).toBe(true);
  });
});

describe('reuse decisions - never / same-authority / cross-authority / over-limit', () => {
  it('authored never forbids reuse (retired, never-policy)', () => {
    const policy = resolveReusePolicy({
      authored: authoredGuidance({
        reuse: 'never',
        sessionReuseAuthored: 'none',
      }),
    });
    const decision = decideReuse({
      policy,
      established,
      requested: established,
      handoffTokensUsed: 0,
      reuseRoundsServed: 0,
    });
    expect(decision.kind).toBe('retired');
    if (decision.kind === 'retired') {
      expect(decision.reason).toBe('never-policy');
    }
  });

  it('same-authority reuse is permitted within the limits', () => {
    const policy = resolveReusePolicy({ authored: authoredGuidance() });
    const decision = decideReuse({
      policy,
      established,
      requested: established,
      handoffTokensUsed: 1,
      reuseRoundsServed: 2,
    });
    expect(decision.kind).toBe('permitted');
  });

  it('cross-invocation reuse produces an auditable retire, never a silent reuse', () => {
    const policy = resolveReusePolicy({ authored: authoredGuidance() });
    const decision = decideReuse({
      policy,
      established,
      requested: { ...established, invocationId: 'inv-2' },
      handoffTokensUsed: 0,
      reuseRoundsServed: 0,
    });
    expect(decision.kind).toBe('retired');
    if (decision.kind === 'retired') {
      expect(decision.reason).toBe('cross-authority');
    }
  });

  it('cross-backend-authority reuse produces an auditable retire', () => {
    const policy = resolveReusePolicy({ authored: authoredGuidance() });
    const decision = decideReuse({
      policy,
      established,
      requested: { ...established, backend: 'in-tool' },
      handoffTokensUsed: 0,
      reuseRoundsServed: 0,
    });
    expect(decision.kind).toBe('retired');
    if (decision.kind === 'retired') {
      expect(decision.reason).toBe('cross-authority');
    }
  });

  it('over-handoff-limit reuse produces an auditable handoff', () => {
    const policy = resolveReusePolicy({ authored: authoredGuidance() });
    const decision = decideReuse({
      policy,
      established,
      requested: established,
      handoffTokensUsed: policy.handoffTokenLimit.value,
      reuseRoundsServed: 0,
    });
    expect(decision.kind).toBe('handoff');
    if (decision.kind === 'handoff') {
      expect(decision.reason).toBe('over-handoff-limit');
    }
  });

  it('over-round-limit reuse produces an auditable retire', () => {
    const policy = resolveReusePolicy({ authored: authoredGuidance() });
    const decision = decideReuse({
      policy,
      established,
      requested: established,
      handoffTokensUsed: 0,
      reuseRoundsServed: policy.reuseRoundLimit.value,
    });
    expect(decision.kind).toBe('retired');
    if (decision.kind === 'retired') {
      expect(decision.reason).toBe('over-round-limit');
    }
  });
});
