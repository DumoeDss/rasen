/**
 * Frozen-action session executor: real-backend attribution (design D8, D10;
 * requirement "A real backend attributes the complete execution fact set to one
 * Run/Action").
 *
 * The durable session-host registry holds host lifecycle facts and request/
 * result DIGESTS only; it SHALL NOT become a second completion truth. Completion
 * (result body, evidence references, usage/cost, ActorRef binding) is written
 * ONLY to the canonical Record through the Facade. This module owns the guard
 * that a completion-truth field written to a registry record fails closed, and
 * the attribution fact set that correlates a real backend's execution to one
 * Run/Action for the canonical Record.
 */

import type { HostedSessionRecord } from '../session-host/contracts.js';

/**
 * Fields a registry record MUST NOT carry: any of these would duplicate the
 * canonical Record's completion truth. The registry's `requests[].resultDigest`
 * and `requests[].resultRef` are lifecycle facts (a digest / a ref, never the
 * body); everything in this list is the body or the binding the Record owns.
 */
export const REGISTRY_FORBIDDEN_COMPLETION_FIELDS = Object.freeze([
  'resultBody',
  'result',
  'evidence',
  'evidenceRefs',
  'usage',
  'cost',
  'actor',
  'actorRef',
  'completion',
] as const);

export type RegistryForbiddenField = (typeof REGISTRY_FORBIDDEN_COMPLETION_FIELDS)[number];

export type RegistryGuardErrorCode =
  | 'registry_carries_completion_truth'
  | 'registry_carries_evidence_duplicate';

export class RegistryGuardError extends Error {
  constructor(
    readonly code: RegistryGuardErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'RegistryGuardError';
  }
}

/**
 * Assert that a session-host registry record carries host lifecycle facts and
 * request/result digests ONLY. A completion-truth field (result body, evidence,
 * usage/cost, actor binding) written to the registry fails closed here. The
 * registry stays a lifecycle reader; completion lives only in the canonical
 * Record.
 *
 * This guard is deliberately field-name-based so it catches a future edit that
 * adds a completion field to the registry shape, even before any code writes it.
 */
export function assertRegistryHoldsLifecycleOnly(
  record: HostedSessionRecord & { [extra: string]: unknown }
): void {
  for (const field of REGISTRY_FORBIDDEN_COMPLETION_FIELDS) {
    if (record[field] !== undefined) {
      throw new RegistryGuardError(
        'registry_carries_completion_truth',
        `The session-host registry record carries a completion-truth field '${field}'; completion belongs only in the canonical Record.`
      );
    }
  }
  // A request entry may carry a resultDigest/resultRef (lifecycle facts) but
  // never the result body or evidence. The cast lets this guard catch a future
  // edit that adds a completion field to the request shape, even though the
  // current HostedRequestRecord type does not name one.
  for (const request of record.requests) {
    const entry = request as unknown as Record<string, unknown>;
    if (entry.resultBody !== undefined || entry.evidence !== undefined) {
      throw new RegistryGuardError(
        'registry_carries_evidence_duplicate',
        'A registry request entry carries a result body or evidence; the registry holds digests only.'
      );
    }
  }
}

/**
 * The complete execution fact set a real backend attributes to one Run/Action
 * (design D10; slice acceptance 2). Each field is correlated to the granted
 * Action id and invocation id; the canonical Record receives the completion
 * through the Facade, never the registry.
 */
export interface AttributionFactSet {
  readonly runId: string;
  readonly actionId: string;
  readonly invocationId: string;
  readonly sessionIdentity: string;
  readonly host: string;
  readonly backend: string;
  readonly model?: string;
  readonly canonicalCwd: string;
  readonly actorRef: unknown;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly structuredEvents: readonly unknown[];
  readonly usageCost?: unknown;
  readonly result?: unknown;
  readonly stderrDiagnostics?: string;
  readonly evidenceReferences: readonly unknown[];
}

/**
 * The lifecycle facts the registry MAY hold (a strict allowlist projection of
 * the attribution fact set). Everything else stays in the canonical Record.
 */
export interface RegistryLifecycleFacts {
  readonly sessionIdentity: string;
  readonly backend: string;
  readonly canonicalCwd: string;
  readonly lifecycleState: string;
  readonly generation: number;
  readonly requestDigest?: string;
  readonly resultDigest?: string;
}

/**
 * Project the lifecycle-only facts the registry is allowed to hold from a full
 * attribution fact set. The result body, evidence, usage/cost, actor binding,
 * and structured events stay in the canonical Record; the registry gets
 * identity, backend, cwd, state, generation, and digests only.
 */
export function projectRegistryLifecycleFacts(
  facts: AttributionFactSet
): RegistryLifecycleFacts {
  return {
    sessionIdentity: facts.sessionIdentity,
    backend: facts.backend,
    canonicalCwd: facts.canonicalCwd,
    lifecycleState: 'active',
    generation: 0,
    requestDigest: undefined,
    resultDigest: undefined,
  };
}
