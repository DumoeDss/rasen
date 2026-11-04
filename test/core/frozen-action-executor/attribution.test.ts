import { describe, expect, it } from 'vitest';

import {
  REGISTRY_FORBIDDEN_COMPLETION_FIELDS,
  RegistryGuardError,
  assertRegistryHoldsLifecycleOnly,
  projectRegistryLifecycleFacts,
} from '../../../src/core/frozen-action-executor/attribution.js';
import type { HostedSessionRecord } from '../../../src/core/session-host/contracts.js';

function lifecycleRecord(
  extra: Record<string, unknown> = {}
): HostedSessionRecord & { [extra: string]: unknown } {
  return {
    sessionId: '11111111-1111-1111-1111-111111111111',
    backend: 'claude',
    cwd: '/workspace',
    cwdDigest: 'sha256:cwd',
    hostState: 'idle',
    generation: 1,
    createdAt: '2026-08-08T00:00:00Z',
    updatedAt: '2026-08-08T00:00:00Z',
    requests: [],
    ...extra,
  } as HostedSessionRecord & { [extra: string]: unknown };
}

describe('registry holds lifecycle facts only (no completion truth)', () => {
  it('accepts a lifecycle-only registry record', () => {
    expect(() => assertRegistryHoldsLifecycleOnly(lifecycleRecord())).not.toThrow();
  });

  it('rejects a completion-truth field written to the registry', () => {
    for (const field of REGISTRY_FORBIDDEN_COMPLETION_FIELDS) {
      const poisoned = lifecycleRecord({ [field]: { something: true } });
      expect(() => assertRegistryHoldsLifecycleOnly(poisoned)).toThrowError(
        RegistryGuardError
      );
    }
  });

  it('rejects a result body on a registry request entry', () => {
    const poisoned = lifecycleRecord({
      requests: [{ requestId: 'r', resultBody: 'the whole result' }],
    });
    expect(() => assertRegistryHoldsLifecycleOnly(poisoned)).toThrowError(
      /result body or evidence/
    );
  });

  it('the lifecycle projection carries identity/backend/cwd/digests only', () => {
    const facts = {
      runId: 'run:abc',
      actionId: 'action:abc',
      invocationId: 'inv:abc',
      sessionIdentity: 'session-1',
      host: 'this-host',
      backend: 'claude',
      model: 'claude-opus',
      canonicalCwd: '/workspace',
      actorRef: { kind: 'agent' },
      startedAt: '2026-08-08T00:00:00Z',
      structuredEvents: [{ kind: 'tool-use' }],
      usageCost: { tokens: 1000, dollars: 0.05 },
      result: { ok: true },
      evidenceReferences: [{ evidenceDigest: 'sha256:e' }],
    };
    const projection = projectRegistryLifecycleFacts(facts);
    expect(projection).toEqual({
      sessionIdentity: 'session-1',
      backend: 'claude',
      canonicalCwd: '/workspace',
      lifecycleState: 'active',
      generation: 0,
      requestDigest: undefined,
      resultDigest: undefined,
    });
    // The projection carries NO completion truth: no result, evidence, usage, actor.
    expect((projection as unknown as Record<string, unknown>).result).toBeUndefined();
    expect((projection as unknown as Record<string, unknown>).evidenceReferences).toBeUndefined();
    expect((projection as unknown as Record<string, unknown>).usageCost).toBeUndefined();
  });
});
