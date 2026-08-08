/**
 * Frozen-action session executor: authoritative per-invocation session reuse,
 * handoff, touch, and retire policy (design D6; requirement "Session reuse,
 * handoff, touch, and retire policy is authoritative and program-enforced").
 *
 * This is the slice that retires the placeholder clause in `ecp-change-run-runtime`
 * ("recorded session guidance is placeholder until a slice defines its
 * authoritative source"). The authoritative source is the frozen Action's
 * authored `sessionReuse` scope (preserved verbatim through
 * `sessionReuseAuthored`) resolved against a declared executor policy block
 * carrying `authored | definition | default` provenance. Reuse is permitted
 * only within the same frozen invocation / role / workspace / backend
 * authority; an over-limit or authority-incompatible reuse produces an
 * auditable handoff or retire, never a silent reuse.
 *
 * This is per-Run, per-invocation session reuse at the executor seam and is
 * distinct from the cross-child worker reuse owned by `worker-reuse-config` and
 * `worker-reuse-orchestration`; those specifications are not modified. The
 * placeholder requirement heading in `ecp-change-run-runtime` is referenced by
 * name, not renamed, so no scenario is implicitly deleted.
 */

import type { ExecutionBackendId } from './capability-matrix.js';

/**
 * The authored reuse scope, preserved verbatim from the frozen Action. `none`
 * forbids reuse; the other values permit reuse within their named scope. This
 * is the four-value vocabulary the two-value `reuse` field cannot express.
 */
export type SessionReuseAuthoredScope =
  | 'none'
  | 'stage'
  | 'run-planner'
  | 'review-thread';

/**
 * Where a resolved policy value came from. Every resolved `sessionReuse`,
 * `handoffTokenLimit`, `reuseRoundLimit`, and touch/retire value carries one of
 * these, so an operator can trace any enforced value back to its source.
 */
export type PolicyProvenance = 'authored' | 'definition' | 'default';

export interface AuthoredSessionGuidance {
  readonly reuse: 'never' | 'same-invocation';
  readonly sessionReuseAuthored?: SessionReuseAuthoredScope;
  readonly handoffTokenLimit: number;
  readonly reuseRoundLimit: number;
}

/**
 * The declared executor policy block. The authoritative source for the limit
 * defaults and touch/retire behaviour. A real operator/author choice would be
 * carried here; in 0.2.0 the limits resolve from the default block and carry
 * `default` provenance (there is no authoring surface for the numeric limits
 * yet, so a recorded placeholder is never enforced as if authored).
 */
export interface ExecutorPolicyBlock {
  readonly defaultHandoffTokenLimit: number;
  readonly defaultReuseRoundLimit: number;
  readonly touchMaxIdleMs: number;
  readonly retireReasonLabel: string;
}

export const DEFAULT_EXECUTOR_POLICY_BLOCK: ExecutorPolicyBlock = Object.freeze({
  defaultHandoffTokenLimit: 4,
  defaultReuseRoundLimit: 8,
  touchMaxIdleMs: 5 * 60 * 1000,
  retireReasonLabel: 'session-reuse-limit-or-authority-mismatch',
});

export interface ProvenancedLimit {
  readonly value: number;
  readonly provenance: PolicyProvenance;
}

export interface ProvenancedReuseScope {
  readonly reuse: 'never' | 'same-invocation';
  readonly scope: SessionReuseAuthoredScope | 'unset';
  readonly provenance: PolicyProvenance;
}

export interface ResolvedReusePolicy {
  readonly sessionReuse: ProvenancedReuseScope;
  readonly handoffTokenLimit: ProvenancedLimit;
  readonly reuseRoundLimit: ProvenancedLimit;
  readonly touchMaxIdleMs: ProvenancedLimit;
  readonly retireReasonLabel: string;
}

/**
 * The authority tuple within which reuse is permitted. Two reuse requests must
 * agree on all four fields or the reuse is an auditable retire, never a silent
 * reuse across an authority boundary.
 */
export interface ReuseAuthorityContext {
  readonly invocationId: string;
  readonly role: string;
  readonly workspaceInstanceId: string;
  readonly backend: ExecutionBackendId;
}

/**
 * Resolve the authoritative reuse policy from the frozen Action's authored
 * guidance and the declared executor policy block.
 *
 * The authored `sessionReuseAuthored` scope is the authoritative reuse source
 * and carries `authored` provenance when present. The numeric limits are NEVER
 * taken at face value from a pre-slice Record: a recorded placeholder is
 * resolved as `default`-provenance from the executor policy block, never
 * enforced as if an operator or author chose it.
 */
export function resolveReusePolicy(input: Readonly<{
  authored: AuthoredSessionGuidance;
  policyBlock?: ExecutorPolicyBlock;
}>): ResolvedReusePolicy {
  const policyBlock = input.policyBlock ?? DEFAULT_EXECUTOR_POLICY_BLOCK;
  const authored = input.authored;

  // The authored scope is the authoritative reuse source. When the frozen
  // Action preserved it verbatim, the resolved scope carries `authored`
  // provenance. When it is absent, the two-value `reuse` field is resolved at
  // `default` provenance (the executor does not infer a four-value scope the
  // author never expressed).
  const sessionReuse: ProvenancedReuseScope =
    authored.sessionReuseAuthored !== undefined
      ? {
          reuse: authored.sessionReuseAuthored === 'none' ? 'never' : 'same-invocation',
          scope: authored.sessionReuseAuthored,
          provenance: 'authored',
        }
      : {
          reuse: authored.reuse,
          scope: 'unset',
          provenance: 'default',
        };

  // The numeric limits: a recorded placeholder is treated as default-provenance
  // and the executor applies its own authoritative default ON TOP, never
  // enforcing the placeholder as authored. In 0.2.0 there is no authoring
  // surface for these numbers, so the resolved value is always the policy
  // block default at `default` provenance.
  const handoffTokenLimit: ProvenancedLimit = {
    value: policyBlock.defaultHandoffTokenLimit,
    provenance: 'default',
  };
  const reuseRoundLimit: ProvenancedLimit = {
    value: policyBlock.defaultReuseRoundLimit,
    provenance: 'default',
  };
  const touchMaxIdleMs: ProvenancedLimit = {
    value: policyBlock.touchMaxIdleMs,
    provenance: 'default',
  };

  return Object.freeze({
    sessionReuse,
    handoffTokenLimit,
    reuseRoundLimit,
    touchMaxIdleMs,
    retireReasonLabel: policyBlock.retireReasonLabel,
  });
}

/**
 * Whether a placeholder recorded limit must be treated as default-provenance
 * rather than enforced as authored. In 0.2.0 every pre-slice recorded limit is
 * a placeholder by definition (the placeholder comment in
 * `ecp-change-run-runtime`); this predicate is the guard the executor consults
 * so a placeholder is never enforced as if an operator chose it.
 */
export function isPlaceholderLimit(recordedValue: number): boolean {
  // The placeholder stamp recorded the literal default values. Treating any of
  // them as authored would silently enforce a non-choice; the executor always
  // re-resolves from its policy block instead.
  return Number.isInteger(recordedValue) && recordedValue >= 0;
}

export type ReuseDecision =
  | {
      readonly kind: 'permitted';
      readonly policy: ResolvedReusePolicy;
      readonly authority: ReuseAuthorityContext;
    }
  | {
      readonly kind: 'retired';
      readonly reason:
        | 'never-policy'
        | 'cross-authority'
        | 'over-handoff-limit'
        | 'over-round-limit';
      readonly message: string;
      readonly policy: ResolvedReusePolicy;
    }
  | {
      readonly kind: 'handoff';
      readonly reason: 'over-handoff-limit';
      readonly message: string;
      readonly policy: ResolvedReusePolicy;
    };

export interface DecideReuseOptions {
  readonly policy: ResolvedReusePolicy;
  readonly established: ReuseAuthorityContext;
  readonly requested: ReuseAuthorityContext;
  /** How many handoff tokens the session has already consumed. */
  readonly handoffTokensUsed: number;
  /** How many reuse rounds the session has already served. */
  readonly reuseRoundsServed: number;
}

function sameAuthority(
  a: ReuseAuthorityContext,
  b: ReuseAuthorityContext
): boolean {
  return (
    a.invocationId === b.invocationId &&
    a.role === b.role &&
    a.workspaceInstanceId === b.workspaceInstanceId &&
    a.backend === b.backend
  );
}

/**
 * Decide whether a subsequent invocation may reuse an established Session.
 *
 * `never` forbids reuse outright. `same-invocation` permits reuse only when the
 * requested authority matches the established authority on all four fields
 * (invocation / role / workspace / backend). An over-limit request produces an
 * auditable handoff (handoff token limit) or retire (reuse round limit); a
 * cross-authority request produces an auditable retire. There is no code path
 * that silently reuses across an authority boundary or past a limit.
 */
export function decideReuse(options: DecideReuseOptions): ReuseDecision {
  const { policy, established, requested, handoffTokensUsed, reuseRoundsServed } = options;

  if (policy.sessionReuse.reuse === 'never') {
    return {
      kind: 'retired',
      reason: 'never-policy',
      message: 'Authored sessionReuse is never; the Session is retired with no reuse.',
      policy,
    };
  }

  if (!sameAuthority(established, requested)) {
    return {
      kind: 'retired',
      reason: 'cross-authority',
      message:
        'Reuse requested across a different invocation/role/workspace/backend authority; the Session is retired rather than silently reused.',
      policy,
    };
  }

  if (handoffTokensUsed >= policy.handoffTokenLimit.value) {
    return {
      kind: 'handoff',
      reason: 'over-handoff-limit',
      message: `Handoff token limit ${policy.handoffTokenLimit.value} (${policy.handoffTokenLimit.provenance}) reached; the Session is handed off rather than silently reused.`,
      policy,
    };
  }

  if (reuseRoundsServed >= policy.reuseRoundLimit.value) {
    return {
      kind: 'retired',
      reason: 'over-round-limit',
      message: `Reuse round limit ${policy.reuseRoundLimit.value} (${policy.reuseRoundLimit.provenance}) reached; the Session is retired rather than silently reused.`,
      policy,
    };
  }

  return { kind: 'permitted', policy, authority: requested };
}
