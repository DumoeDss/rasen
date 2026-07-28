import { describe, expect, it } from 'vitest';

import {
  ActorError,
  buildAgentActor,
  buildCommandActor,
  buildHostActor,
  verifyActorRef,
} from '../../../src/core/change-run/internal/actors.js';
import { decodeActorRef } from '../../../src/core/change-run/index.js';
import type { Digest } from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const d = (c: string) => branded<Digest>(`sha256:${c.repeat(64)}`);

const adapter = { id: 'adapter:apply', version: '1', artifactDigest: d('a') };

const agentInput = {
  role: 'implementer',
  provider: 'anthropic',
  runtime: 'claude',
  principalIdentityDigest: d('b'),
  sessionIdentityDigest: d('c'),
  adapter,
};

describe('ActorRef identity digest (6.5/6.6)', () => {
  it('builds a closed agent actor with a canonical identity digest', () => {
    const actor = buildAgentActor(agentInput);
    expect(actor.kind).toBe('agent');
    expect(actor.identityDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(actor.principalIdentityDigest).toBe(d('b'));
    expect(actor.sessionIdentityDigest).toBe(d('c'));
  });

  it('is deterministic: same meaning -> same identity digest', () => {
    expect(buildAgentActor(agentInput).identityDigest).toBe(
      buildAgentActor(agentInput).identityDigest
    );
  });

  it('keeps principal and session distinct in the identity digest', () => {
    const byPrincipal = buildAgentActor(agentInput).identityDigest;
    const swappedSession = buildAgentActor({
      ...agentInput,
      principalIdentityDigest: d('c'),
      sessionIdentityDigest: d('b'),
    }).identityDigest;
    expect(swappedSession).not.toBe(byPrincipal);

    const newSession = buildAgentActor({
      ...agentInput,
      sessionIdentityDigest: d('d'),
    }).identityDigest;
    expect(newSession).not.toBe(byPrincipal);
  });

  it('accepts a canonically-built actor under verifyActorRef', () => {
    expect(() => verifyActorRef(buildAgentActor(agentInput))).not.toThrow();
    expect(() =>
      verifyActorRef(
        buildCommandActor({
          adapter,
          executable: { id: 'adapter:apply', artifactDigest: d('a') },
        })
      )
    ).not.toThrow();
    expect(() =>
      verifyActorRef(buildHostActor({ adapter, principalIdentityDigest: d('b') }))
    ).not.toThrow();
  });

  it('rejects a spoofed identity digest (anti-spoof)', () => {
    const real = buildAgentActor(agentInput);
    const tampered = decodeActorRef({
      ...real,
      identityDigest: d('e'),
    });
    expect(() => verifyActorRef(tampered)).toThrowError(ActorError);
  });

  it('rejects an unknown actor major before any verification', () => {
    expect(() =>
      decodeActorRef({ ...buildAgentActor(agentInput), format: 'change-run-actor/9' })
    ).toThrow();
  });

  it('carries only identity digests, never raw principal/token/path data', () => {
    const actor = buildAgentActor(agentInput);
    // The actor's principal/session are digests; the type carries no token/path/env field.
    expect(typeof actor.principalIdentityDigest).toBe('string');
    expect(actor.principalIdentityDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect('token' in actor).toBe(false);
    expect('path' in actor).toBe(false);
  });
});
