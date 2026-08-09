import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXECUTOR_POLICY_BLOCK,
  decideReuse,
} from '../../../src/core/frozen-action-executor/reuse-policy.js';
import {
  resolveSessionPolicyBlock,
  resolveSessionPolicySource,
  SessionPolicyConfigError,
  SESSION_POLICY_LIMIT_BOUNDS,
  type SessionPolicyConfigLayers,
} from '../../../src/core/session-policy-parity/policy-source.js';
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

describe('policy source - 4.1 a configured value reaches resolveReusePolicy as the block', () => {
  it('a project-configured handoffTokenLimit reaches the resolver block and the resolved policy', () => {
    const block = resolveSessionPolicyBlock({ project: { handoffTokenLimit: 7 } });
    // The configured value reaches the executor block (the resolver consumes
    // block.defaultHandoffTokenLimit).
    expect(block.block.defaultHandoffTokenLimit).toBe(7);
    // ...and the authoritative resolved reuse policy when composed with guidance.
    const source = resolveSessionPolicySource(
      { project: { handoffTokenLimit: 7 } },
      authoredGuidance()
    );
    expect(source.resolvedReusePolicy.handoffTokenLimit.value).toBe(7);
  });

  it('store beats global, project beats store (the existing configuration chain order)', () => {
    const block = resolveSessionPolicyBlock({
      project: { reuseRoundLimit: 3 },
      store: { reuseRoundLimit: 4 },
      global: { reuseRoundLimit: 5 },
    });
    expect(block.fields.reuseRoundLimit.value).toBe(3);
    expect(block.fields.reuseRoundLimit.layer).toBe('project');
    expect(block.fields.reuseRoundLimit.provenance).toBe('authored');
  });

  it('store wins when project is unset; global wins when store is unset', () => {
    const storeWins = resolveSessionPolicyBlock({
      store: { reuseRoundLimit: 4 },
      global: { reuseRoundLimit: 5 },
    });
    expect(storeWins.fields.reuseRoundLimit.value).toBe(4);
    expect(storeWins.fields.reuseRoundLimit.layer).toBe('store');
    const globalWins = resolveSessionPolicyBlock({
      global: { reuseRoundLimit: 5 },
    });
    expect(globalWins.fields.reuseRoundLimit.value).toBe(5);
    expect(globalWins.fields.reuseRoundLimit.layer).toBe('global');
  });

  it('the configured value drives the over-handoff-limit decision (decideReuse unchanged)', () => {
    // A project-configured handoffTokenLimit of 7 means the 7th consumed token
    // triggers handoff (handoffTokensUsed >= 7). The resolver's decideReuse
    // safety decision is unchanged; it just consumes the configured block.
    const source = resolveSessionPolicySource(
      { project: { handoffTokenLimit: 7 } },
      authoredGuidance()
    );
    const policy = source.resolvedReusePolicy;
    const atSix = decideReuse({
      policy,
      established,
      requested: established,
      handoffTokensUsed: 6,
      reuseRoundsServed: 0,
    });
    expect(atSix.kind).toBe('permitted');
    const atSeven = decideReuse({
      policy,
      established,
      requested: established,
      handoffTokensUsed: 7,
      reuseRoundsServed: 0,
    });
    expect(atSeven.kind).toBe('handoff');
  });
});

describe('policy source - 4.2 provenance is authoritative and traceable', () => {
  it('a configured limit carries authored provenance and its configured value', () => {
    const source = resolveSessionPolicySource(
      { project: { handoffTokenLimit: 9 } },
      authoredGuidance()
    );
    expect(source.fields.handoffTokenLimit.provenance).toBe('authored');
    expect(source.fields.handoffTokenLimit.value).toBe(9);
    expect(source.resolvedReusePolicy.handoffTokenLimit.provenance).toBe('authored');
  });

  it('an unset limit carries default provenance and the shipped default value', () => {
    const block = resolveSessionPolicyBlock({});
    expect(block.fields.handoffTokenLimit.provenance).toBe('default');
    expect(block.fields.handoffTokenLimit.value).toBe(
      DEFAULT_EXECUTOR_POLICY_BLOCK.defaultHandoffTokenLimit
    );
    expect(block.fields.reuseRoundLimit.provenance).toBe('default');
    expect(block.fields.touchMaxIdleMs.provenance).toBe('default');
    expect(block.fields.retireReasonLabel.provenance).toBe('default');
  });

  it('every resolved provenance is within the authored | definition | default vocabulary', () => {
    const source = resolveSessionPolicySource(
      { global: { reuseRoundLimit: 11 } },
      authoredGuidance()
    );
    const vocab = ['authored', 'definition', 'default'];
    expect(vocab).toContain(source.fields.handoffTokenLimit.provenance);
    expect(vocab).toContain(source.fields.reuseRoundLimit.provenance);
    expect(vocab).toContain(source.fields.touchMaxIdleMs.provenance);
    expect(vocab).toContain(source.resolvedReusePolicy.handoffTokenLimit.provenance);
  });

  it('a per-field unset value keeps default provenance even when a sibling is configured', () => {
    // handoffTokenLimit is configured (authored); reuseRoundLimit is unset
    // (default). Provenance is per-field, never blanket-applied.
    const source = resolveSessionPolicySource(
      { project: { handoffTokenLimit: 6 } },
      authoredGuidance()
    );
    expect(source.fields.handoffTokenLimit.provenance).toBe('authored');
    expect(source.fields.reuseRoundLimit.provenance).toBe('default');
    expect(source.resolvedReusePolicy.handoffTokenLimit.provenance).toBe('authored');
    expect(source.resolvedReusePolicy.reuseRoundLimit.provenance).toBe('default');
  });

  it('a placeholder (unset) limit is never stamped authored (discrimination guard)', () => {
    // The mutation target: if the source ever stamped an unset value `authored`
    // (mirroring the executor's documented placeholder-as-authored hazard),
    // this guard fails. An unset value MUST be `default`.
    const block = resolveSessionPolicyBlock({});
    expect(block.fields.handoffTokenLimit.provenance).not.toBe('authored');
    const source = resolveSessionPolicySource({}, authoredGuidance());
    expect(source.resolvedReusePolicy.handoffTokenLimit.provenance).not.toBe('authored');
  });
});

describe('policy source - 4.3 configured limits are validated and safety-disabling rejected', () => {
  it('rejects a non-integer handoffTokenLimit (would permit an off-by-one past-limit reuse)', () => {
    expect(() =>
      resolveSessionPolicyBlock({ project: { handoffTokenLimit: 1.5 } })
    ).toThrowError(SessionPolicyConfigError);
  });

  it('rejects a non-positive reuseRoundLimit', () => {
    expect(() =>
      resolveSessionPolicyBlock({ project: { reuseRoundLimit: 0 } })
    ).toThrowError(SessionPolicyConfigError);
    expect(() =>
      resolveSessionPolicyBlock({ project: { reuseRoundLimit: -1 } })
    ).toThrowError(SessionPolicyConfigError);
  });

  it('rejects an out-of-bound limit (would disable the over-limit protection)', () => {
    const max = SESSION_POLICY_LIMIT_BOUNDS.handoffTokenLimit.max;
    expect(() =>
      resolveSessionPolicyBlock({ project: { handoffTokenLimit: max + 1 } })
    ).toThrowError(SessionPolicyConfigError);
  });

  it('rejects an invalid retireReasonLabel', () => {
    expect(() =>
      resolveSessionPolicyBlock({ project: { retireReasonLabel: '' } })
    ).toThrowError(SessionPolicyConfigError);
  });

  it('rejects a malformed value that escaped the resilient global layer (defense-in-depth)', () => {
    // The global config has no schema gate on read; a hand-edited NaN or
    // non-integer reaches the resolver, which MUST reject it (not silently
    // apply it). This is the safety-disabling rejection at the authoritative gate.
    expect(() =>
      resolveSessionPolicyBlock({ global: { handoffTokenLimit: Number.NaN } })
    ).toThrowError(SessionPolicyConfigError);
    expect(() =>
      resolveSessionPolicyBlock({ global: { touchMaxIdleMs: 30_000.5 } })
    ).toThrowError(SessionPolicyConfigError);
  });

  it('a configured limit can never enable a cross-authority silent reuse (safety unchanged)', () => {
    // Even a maximally permissive valid config cannot disable decideReuse's
    // cross-authority retire. The configured limit governs only same-authority
    // over-limit; the cross-authority safety decision is independent of it.
    const max = SESSION_POLICY_LIMIT_BOUNDS.handoffTokenLimit.max;
    const rmax = SESSION_POLICY_LIMIT_BOUNDS.reuseRoundLimit.max;
    const source = resolveSessionPolicySource(
      { project: { handoffTokenLimit: max, reuseRoundLimit: rmax } },
      authoredGuidance()
    );
    const policy = source.resolvedReusePolicy;
    const crossAuthority = decideReuse({
      policy,
      established,
      requested: { ...established, invocationId: 'inv-other' },
      handoffTokensUsed: 0,
      reuseRoundsServed: 0,
    });
    expect(crossAuthority.kind).toBe('retired');
    if (crossAuthority.kind === 'retired') {
      expect(crossAuthority.reason).toBe('cross-authority');
    }
  });

  it('a configured limit can never enable a never-policy silent reuse (safety unchanged)', () => {
    const neverSource = resolveSessionPolicySource(
      { project: { handoffTokenLimit: 50 } },
      authoredGuidance({ reuse: 'never', sessionReuseAuthored: 'none' })
    );
    const decision = decideReuse({
      policy: neverSource.resolvedReusePolicy,
      established,
      requested: established,
      handoffTokensUsed: 0,
      reuseRoundsServed: 0,
    });
    expect(decision.kind).toBe('retired');
  });
});
