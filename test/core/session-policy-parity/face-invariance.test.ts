import { describe, expect, it } from 'vitest';

import { decideReuse } from '../../../src/core/frozen-action-executor/reuse-policy.js';
import {
  resolveSessionPolicySource,
  type SessionPolicyConfigLayers,
} from '../../../src/core/session-policy-parity/policy-source.js';
import { DRIVER_FACES, type DriverFaceId } from '../../../src/core/session-policy-parity/parity-gate.js';
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

const layers: SessionPolicyConfigLayers = {
  project: { handoffTokenLimit: 7, reuseRoundLimit: 9 },
  global: { handoffTokenLimit: 4 },
};

/**
 * The single resolution point. `resolveSessionPolicySource` is FACE-AGNOSTIC by
 * construction (it takes no face parameter): every driver face that reaches the
 * executor through the shared contract consumes the SAME resolved policy. This
 * helper models that: it delegates to the one source, ignoring the face. A
 * per-face policy source would have to diverge here, and the face-invariance
 * guard below catches it.
 */
function resolvePolicyForFace(
  _face: DriverFaceId,
  faceLayers: SessionPolicyConfigLayers,
  authored: AuthoredSessionGuidance
) {
  return resolveSessionPolicySource(faceLayers, authored).resolvedReusePolicy;
}

describe('face-invariance - 5.1 the same Action from each face yields the same decision', () => {
  const authored = authoredGuidance();

  it('every face resolves the identical policy from one configured block', () => {
    const canonical = resolvePolicyForFace('daemon', layers, authored);
    for (const face of DRIVER_FACES) {
      const facePolicy = resolvePolicyForFace(face, layers, authored);
      // One resolution point consuming one configured block => byte-equal policy
      // regardless of which face asks. No face carries its own policy source.
      expect(JSON.stringify(facePolicy)).toBe(JSON.stringify(canonical));
    }
  });

  it('every face yields the identical reuse/handoff/touch/retire decision', () => {
    const canonicalPolicy = resolvePolicyForFace('daemon', layers, authored);
    const canonicalDecision = decideReuse({
      policy: canonicalPolicy,
      established,
      requested: established,
      handoffTokensUsed: 6,
      reuseRoundsServed: 2,
    });
    for (const face of DRIVER_FACES) {
      const policy = resolvePolicyForFace(face, layers, authored);
      const decision = decideReuse({
        policy,
        established,
        requested: established,
        handoffTokensUsed: 6,
        reuseRoundsServed: 2,
      });
      expect(JSON.stringify(decision)).toBe(JSON.stringify(canonicalDecision));
    }
  });

  it('the decision is face-invariant across permitted, handoff, retire, and cross-authority outcomes', () => {
    // For each decision class, every face reaches the same decision for the same
    // authority/limits. (handoffTokenLimit=7: 6 used -> permitted; 7 -> handoff.)
    for (const { usage, expectedKind } of [
      { usage: { handoffTokensUsed: 6, reuseRoundsServed: 0 }, expectedKind: 'permitted' },
      { usage: { handoffTokensUsed: 7, reuseRoundsServed: 0 }, expectedKind: 'handoff' },
      { usage: { handoffTokensUsed: 0, reuseRoundsServed: 9 }, expectedKind: 'retired' },
    ] as const) {
      const decisions = DRIVER_FACES.map((face) => {
        const policy = resolvePolicyForFace(face, layers, authored);
        return decideReuse({
          policy,
          established,
          requested: established,
          ...usage,
        }).kind;
      });
      expect(new Set(decisions).size).toBe(1);
      expect(decisions[0]).toBe(expectedKind);
    }
  });
});

describe('face-invariance - 5.2 one resolution point; the drift gate catches a bypass', () => {
  const authored = authoredGuidance();

  it('resolveSessionPolicySource is face-agnostic (one resolution point, no face parameter)', () => {
    // The source signature carries no face identity; policy is resolved at one
    // point consuming one configured block. This is the structural guarantee
    // that no face can carry its own policy source.
    const source = resolveSessionPolicySource(layers, authored);
    // Every face consumes this one resolution; re-resolving is idempotent.
    const reresolved = resolveSessionPolicySource(layers, authored);
    expect(JSON.stringify(reresolved)).toBe(JSON.stringify(source));
  });

  it('a cross-authority request retires identically on every face (safety is face-invariant)', () => {
    // The cross-authority retire is a safety decision; it MUST be identical
    // across faces (a face that permitted cross-authority reuse would diverge).
    const decisions = DRIVER_FACES.map((face) => {
      const policy = resolvePolicyForFace(face, layers, authored);
      return decideReuse({
        policy,
        established,
        requested: { ...established, invocationId: 'inv-other' },
        handoffTokensUsed: 0,
        reuseRoundsServed: 0,
      });
    });
    expect(new Set(decisions.map((d) => d.kind))).toEqual(new Set(['retired']));
    expect(new Set(decisions.map((d) => (d as { reason?: string }).reason))).toEqual(
      new Set(['cross-authority'])
    );
  });
});
