import {
  ChangeRunContractError,
  decodeActorRef,
  type ActorRef,
  type Digest,
} from '../contracts.js';
import { domainDigest } from './identity.js';

export type ActorRefKind = 'agent' | 'command' | 'host';

export interface TrustedAdapter {
  readonly id: string;
  readonly version: string;
  readonly artifactDigest: Digest;
}

export interface AgentActorInput {
  readonly role: string;
  readonly provider: string;
  readonly runtime: string;
  readonly principalIdentityDigest: Digest;
  readonly sessionIdentityDigest: Digest;
  readonly adapter: TrustedAdapter;
}

export interface CommandActorInput {
  readonly adapter: TrustedAdapter;
  readonly executable: Readonly<{ id: string; artifactDigest: Digest }>;
}

export interface HostActorInput {
  readonly adapter: TrustedAdapter;
  readonly principalIdentityDigest: Digest;
}

export type ActorErrorCode = 'invalid_actor_input' | 'actor_identity_mismatch';

export class ActorError extends Error {
  constructor(
    readonly code: ActorErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'ActorError';
  }
}

/**
 * The canonical identity digest binds an actor's exact meaning. It is computed
 * from the trusted fields, never supplied by the caller, so a spoofed digest
 * cannot make one actor impersonate another.
 */
export function agentActorIdentityDigest(input: AgentActorInput): Digest {
  return domainDigest('change-run-actor/agent', input);
}

export function commandActorIdentityDigest(input: CommandActorInput): Digest {
  return domainDigest('change-run-actor/command', input);
}

export function hostActorIdentityDigest(input: HostActorInput): Digest {
  return domainDigest('change-run-actor/host', input);
}

function finish(value: unknown): ActorRef {
  try {
    return decodeActorRef(value);
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      throw new ActorError('invalid_actor_input', error.message, error.issues);
    }
    throw error;
  }
}

export function buildAgentActor(input: AgentActorInput): ActorRef {
  return finish({
    format: 'change-run-actor/1',
    kind: 'agent',
    identityDigest: agentActorIdentityDigest(input),
    role: input.role,
    provider: input.provider,
    runtime: input.runtime,
    principalIdentityDigest: input.principalIdentityDigest,
    sessionIdentityDigest: input.sessionIdentityDigest,
    adapter: input.adapter,
  });
}

export function buildCommandActor(input: CommandActorInput): ActorRef {
  return finish({
    format: 'change-run-actor/1',
    kind: 'command',
    identityDigest: commandActorIdentityDigest(input),
    adapter: input.adapter,
    executable: input.executable,
  });
}

export function buildHostActor(input: HostActorInput): ActorRef {
  return finish({
    format: 'change-run-actor/1',
    kind: 'host',
    identityDigest: hostActorIdentityDigest(input),
    adapter: input.adapter,
    principalIdentityDigest: input.principalIdentityDigest,
  });
}

/**
 * Recompute the canonical identity digest of a decoded {@link ActorRef} and
 * reject a mismatch. This is the anti-spoof check: the wire form may carry any
 * digest, but only one matches the actor's actual meaning.
 */
export function verifyActorRef(actor: ActorRef): void {
  const expected = expectedIdentityDigest(actor);
  if (actor.identityDigest !== expected) {
    throw new ActorError(
      'actor_identity_mismatch',
      'ActorRef identityDigest does not match its canonical meaning.'
    );
  }
}

function expectedIdentityDigest(actor: ActorRef): Digest {
  switch (actor.kind) {
    case 'agent':
      return agentActorIdentityDigest({
        role: actor.role,
        provider: actor.provider,
        runtime: actor.runtime,
        principalIdentityDigest: actor.principalIdentityDigest as Digest,
        sessionIdentityDigest: actor.sessionIdentityDigest as Digest,
        adapter: actor.adapter as TrustedAdapter,
      });
    case 'command':
      return commandActorIdentityDigest({
        adapter: actor.adapter as TrustedAdapter,
        executable: actor.executable as Readonly<{ id: string; artifactDigest: Digest }>,
      });
    case 'host':
      return hostActorIdentityDigest({
        adapter: actor.adapter as TrustedAdapter,
        principalIdentityDigest: actor.principalIdentityDigest as Digest,
      });
  }
}
