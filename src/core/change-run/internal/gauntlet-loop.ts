import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  ActorRef,
  CompleteRunAction,
  Digest,
  EvidenceRef,
  JsonValue,
  NodeId,
  RunAction,
  WorkspaceRevision,
} from '../contracts.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';
import { domainDigest } from './identity.js';
import {
  verifyEvidenceBinding,
  verifyEvidenceRefIdentity,
} from './evidence.js';
import { verifyActorRef } from './actors.js';
import {
  decodeGoalCycleResult,
  type GoalWorkResult,
} from './goal-cycle.js';
import {
  goalCycleInvocation,
  locateGoalCycleInvocation,
  projectGoalCycleProgress,
  type GoalCycleProgress,
} from './goal-cycle-runtime.js';
import type {
  RuntimePlan,
  RuntimePlanBoundedLoopNode,
} from './runtime-plan.js';
import {
  GauntletDomainError,
  readGauntletInput,
  validateGauntletJudgment,
  type ConvergenceAttestation,
  type GauntletInput,
  type GauntletJudgeResult,
  type ReferenceBar,
} from './gauntlet-bar.js';

// ---------------------------------------------------------------------------
// Evidence schema constants
// ---------------------------------------------------------------------------

export const GAUNTLET_WORK_EVIDENCE_SCHEMA = 'gauntlet-work-delta/1';
export const GAUNTLET_CONVERGENCE_JUDGE_EVIDENCE_SCHEMA =
  'gauntlet-convergence-judge-evidence/1';
export const GAUNTLET_ACTOR_ATTESTATION_SCHEMA = 'gauntlet-actor-attestation/1';

// ---------------------------------------------------------------------------
// Phase + lifecycle types
// ---------------------------------------------------------------------------

/**
 * Gauntlet phases. Phase 0 is the flat serial foundation loop. Phase 1+ is the
 * lead-driven per-wave polish (not implemented in this module — group 4/5).
 */
export type GauntletPhase = 0;

// ---------------------------------------------------------------------------
// Backstop state (Task 2.4 — suspend-and-prompt, never destroy)
// ---------------------------------------------------------------------------

export interface GauntletBackstopState {
  readonly kind: 'active' | 'suspended';
  readonly roundsUsed: number;
  readonly maxRounds: number;
}

/**
 * Project the backstop cap state from rounds used vs the loop max.
 * On expiry the Run suspends and prompts — never destroys committed work.
 */
export function projectGauntletBackstop(
  roundsUsed: number,
  maxRounds: number
): GauntletBackstopState {
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      'Gauntlet backstop maxRounds must be a positive safe integer.'
    );
  }
  if (roundsUsed >= maxRounds) {
    return Object.freeze({
      kind: 'suspended' as const,
      roundsUsed,
      maxRounds,
    });
  }
  return Object.freeze({
    kind: 'active' as const,
    roundsUsed,
    maxRounds,
  });
}

/**
 * Assert that a suspended backstop preserves every committed Action —
 * no data loss. A suspend is a wait-for-user, not a destructive terminal.
 */
export function assertBackstopPreservesWork(
  state: GauntletBackstopState,
  record: CanonicalRunRecord
): void {
  if (state.kind !== 'suspended') return;
  // Every committed action must retain its result/evidence.
  for (const committed of Object.values(record.actions)) {
    if (
      committed.state === 'closed' &&
      committed.result?.status === 'succeeded'
    ) {
      // The action's evidence must still be present.
      if (committed.result.evidence.length === 0) {
        throw new GauntletDomainError(
          'gauntlet_delivery_guard',
          'Backstop suspend must not discard committed Action evidence.'
        );
      }
    }
  }
}

/**
 * On backstop expiry, convert to a suspend-and-prompt — not a destructive
 * terminal. All committed work is preserved. The user can resume or converge.
 */
export function backstopExpiryOutcome(): {
  readonly kind: 'backstop-suspended';
  readonly prompt: string;
} {
  return Object.freeze({
    kind: 'backstop-suspended' as const,
    prompt:
      'Gauntlet backstop cap reached. All committed work is preserved. ' +
      'Converge to ship, or resume to continue.',
  });
}

// ---------------------------------------------------------------------------
// Convergence-settle timeout (Task 2.3)
// ---------------------------------------------------------------------------

export interface ConvergenceSettleState {
  readonly kind: 'settled' | 'timeout-snapshotted';
  /** The tree digest to use for the convergence-judge. */
  readonly settledTree: Digest;
  /** True when uncommitted work was abandoned at the timeout. */
  readonly abandonedUncommitted: boolean;
}

/**
 * Compute the convergence-settle outcome. When the user converges:
 * 1. In-flight write Actions are allowed to settle within the timeout.
 * 2. If settled → use the settled tree.
 * 3. If timeout → snapshot at the last committed tree, abandon uncommitted.
 */
export function computeConvergenceSettle(input: {
  readonly lastCommittedTree: Digest;
  readonly inFlightSettled: boolean;
  readonly settledTree?: Digest;
}): ConvergenceSettleState {
  if (input.inFlightSettled && input.settledTree !== undefined) {
    return Object.freeze({
      kind: 'settled',
      settledTree: input.settledTree,
      abandonedUncommitted: false,
    });
  }
  // Timeout: snapshot at the last committed tree.
  return Object.freeze({
    kind: 'timeout-snapshotted',
    settledTree: input.lastCommittedTree,
    abandonedUncommitted: true,
  });
}

// ---------------------------------------------------------------------------
// Terminal honesty + non-conversion + no-gate (Task 2.5)
// ---------------------------------------------------------------------------

/**
 * Terminal honesty: cancelled/blocked/backstop-suspended records are terminal.
 * They never convert to another Pipeline. No further build, critic, ship, or
 * archive action is admitted after a terminal outcome.
 */
export function assertGauntletTerminalHonesty(
  record: CanonicalRunRecord
): void {
  if (record.terminal === undefined) return;
  const kind = record.terminal.kind;
  if (
    kind === 'cancelled' ||
    kind === 'failed' ||
    kind === 'escalated'
  ) {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      `Gauntlet Run is terminal (${kind}); no further action is admitted.`
    );
  }
}

/**
 * Non-conversion: a terminal gauntlet-loop Run SHALL NEVER convert, upgrade,
 * or fall back to small-feature, full-feature, a goal Pipeline, or any other
 * Pipeline. The terminal outcome and its cause/evidence are retained.
 */
export function assertGauntletNonConversion(
  record: CanonicalRunRecord
): void {
  if (record.terminal === undefined) return;
  // The pipeline identity is frozen at launch. A terminal record's pipeline
  // must remain 'gauntlet-loop' — it must not be mutated to another pipeline.
  if (record.pipeline !== 'gauntlet-loop') {
    throw new GauntletDomainError(
      'gauntlet_pipeline_identity',
      `Non-conversion violated: terminal gauntlet Run pipeline is '${record.pipeline}', expected 'gauntlet-loop'.`
    );
  }
}

/**
 * No-gate cannot bypass gauntlet guards. --no-gate removes ordinary
 * confirmation pauses only. It SHALL NOT bypass gauntlet input, evidence,
 * fresh-critic, blind-A/B, terminal, or delivery guards.
 *
 * This function is the explicit assertion — gauntlet guards are always active
 * regardless of the gate policy. The policy is recorded for observability
 * but never weakens any check.
 */
export function assertGauntletNoGateNoBypass(
  record: CanonicalRunRecord
): void {
  // Guards are always active. This function records the intent: even if
  // record.inputs.gatePolicy indicates --no-gate, every gauntlet guard
  // (delivery, fresh-critic, evidence, terminal) remains enforced.
  // The function is intentionally a no-op beyond the intent assertion —
  // the actual guards in assertGauntletMayDeliver, validateGauntletJudgment,
  // etc. do not consult the gate policy.
  void record;
}

// ---------------------------------------------------------------------------
// Plan identity helpers (parallel to task-loop's isTaskLoopRun)
// ---------------------------------------------------------------------------

export function isGauntletRun(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): boolean {
  if (plan.pipeline !== 'gauntlet-loop' || record.pipeline !== 'gauntlet-loop') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Contract helpers
// ---------------------------------------------------------------------------

function gauntletContract(record: CanonicalRunRecord): GauntletInput {
  return readGauntletInput(record.inputs, {});
}

export function gauntletContractDigest(contract: GauntletInput): Digest {
  return domainDigest('gauntlet-loop-input/1', contract);
}

// ---------------------------------------------------------------------------
// Action helpers (parallel to task-loop)
// ---------------------------------------------------------------------------

function actionForGauntletPhase(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  round: number,
  phase: 'work' | 'judge'
): CommittedAction | undefined {
  if (loop.body.kind !== 'goal-cycle') return undefined;
  const phasePlan = loop.body.phases.find((item) => item.phase === phase);
  if (phasePlan === undefined) return undefined;
  const nodeId = goalCycleInvocation(plan, loop, round, phasePlan).nodeId;
  return Object.values(record.actions).find(
    (committed) => committed.action.nodeId === nodeId
  );
}

function priorCriticSessions(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  excludeActionId?: string
): readonly string[] {
  return Object.values(record.actions)
    .filter((committed) => {
      const descriptor = locateGoalCycleInvocation(
        plan,
        committed.action.nodeId as NodeId
      );
      return (
        descriptor?.phase === 'judge' &&
        committed.action.actionId !== excludeActionId &&
        committed.result?.status === 'succeeded' &&
        committed.result.actor !== undefined
      );
    })
    .flatMap((committed) => {
      const actor = committed.result!.actor!;
      return actor.kind === 'agent' ? [actor.sessionIdentityDigest] : [];
    });
}

function latestAcceptedJudgment(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): GauntletJudgeResult | undefined {
  let latest: { round: number; result: GauntletJudgeResult } | undefined;
  for (const committed of Object.values(record.actions)) {
    const descriptor = locateGoalCycleInvocation(
      plan,
      committed.action.nodeId as NodeId
    );
    if (
      descriptor?.phase !== 'judge' ||
      committed.result?.status !== 'succeeded'
    ) {
      continue;
    }
    const result = committed.result.result as Readonly<Record<string, unknown>>;
    // Check if this is a gauntlet judge result (has verdict field).
    if (typeof result.verdict !== 'string') continue;
    if (
      latest === undefined ||
      descriptor.round > latest.round
    ) {
      latest = {
        round: descriptor.round,
        result: result as unknown as GauntletJudgeResult,
      };
    }
  }
  return latest?.result;
}

/**
 * Find the convergence-judge result in the record: a satisfied judge action
 * with satisfactionSource 'attestation-evidenced'. This is the through-judge
 * satisfaction that unlocks delivery (Task 2.1 / 2.2).
 */
export function findConvergenceJudgeResult(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): GauntletJudgeResult | undefined {
  for (const committed of Object.values(record.actions)) {
    const descriptor = locateGoalCycleInvocation(
      plan,
      committed.action.nodeId as NodeId
    );
    if (
      descriptor?.phase !== 'judge' ||
      committed.result?.status !== 'succeeded'
    ) {
      continue;
    }
    const result = committed.result.result as Readonly<Record<string, unknown>>;
    if (
      result.satisfied === true &&
      result.satisfactionSource === 'attestation-evidenced'
    ) {
      return result as unknown as GauntletJudgeResult;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Convergence-judge Action (Task 2.1)
// ---------------------------------------------------------------------------

/**
 * Build the convergence-judge result: a fresh-session judge that records an
 * auditable satisfied result whose evidence is the user's convergence
 * attestation. Semantically "user-converged via attestation," NOT "bar reached."
 *
 * The last A/B verdict and gaps are preserved for audit — attestation
 * overrides the comparison, it does not erase it.
 */
export function buildConvergenceJudgeResult(input: {
  readonly attestation: ConvergenceAttestation;
  readonly latestComparison: GauntletJudgeResult;
}): GauntletJudgeResult {
  const { attestation, latestComparison } = input;
  return Object.freeze({
    contract: 'goal-cycle/evaluate-judge/1' as const,
    satisfied: true,
    satisfactionSource: 'attestation-evidenced' as const,
    // Preserve the last A/B verdict for audit.
    verdict: latestComparison.verdict,
    // Preserve the last gap for audit.
    biggestGap: latestComparison.biggestGap,
    gaps: latestComparison.gaps,
    criteria: latestComparison.criteria,
    attestation,
  });
}

/**
 * Validate a convergence-judge completion. The convergence-judge must:
 * 1. Run under a fresh session identity (subject to gauntlet's critic-reuse guard).
 * 2. Record satisfactionSource 'attestation-evidenced'.
 * 3. Carry a valid ConvergenceAttestation as evidence.
 * 4. Preserve the last A/B verdict for audit (not erase it).
 */
export function validateConvergenceJudge(input: {
  readonly contract: GauntletInput;
  readonly result: unknown;
  readonly rawEvidence: readonly EvidenceRef[];
  readonly criticSessionIdentity: string;
  readonly priorCriticSessionIdentities: readonly string[];
  readonly evidenceContext?: Readonly<{
    record: CanonicalRunRecord;
    actionId: string;
    treeDigest: Digest;
  }>;
}): GauntletJudgeResult {
  // Delegate to the gauntlet judgment validation from gauntlet-bar.ts,
  // which checks: fresh-critic guard, schema, evidence binding, satisfaction
  // source rules (attestation-evidenced requires attestation).
  const validated = validateGauntletJudgment({
    contract: input.contract,
    result: input.result,
    rawEvidence: input.rawEvidence,
    criticSessionIdentity: input.criticSessionIdentity,
    priorCriticSessionIdentities: input.priorCriticSessionIdentities,
    evidenceContext: input.evidenceContext,
  });

  // Convergence-judge specific: must be attestation-evidenced.
  if (!validated.satisfied) {
    throw new GauntletDomainError(
      'gauntlet_false_satisfaction',
      'A convergence-judge must record a satisfied result.'
    );
  }
  if (validated.satisfactionSource !== 'attestation-evidenced') {
    throw new GauntletDomainError(
      'gauntlet_false_satisfaction',
      `A convergence-judge must use satisfactionSource 'attestation-evidenced', got '${validated.satisfactionSource}'.`
    );
  }
  if (validated.attestation === undefined) {
    throw new GauntletDomainError(
      'gauntlet_false_satisfaction',
      'A convergence-judge must carry a convergence attestation.'
    );
  }

  return validated;
}

// ---------------------------------------------------------------------------
// Delivery guard (Task 2.2 — mirror assertTaskLoopMayDeliver)
// ---------------------------------------------------------------------------

function verifyGauntletEvidenceRef(
  ref: EvidenceRef,
  context: Readonly<{
    record: CanonicalRunRecord;
    actionId: string;
    treeDigest: Digest;
  }>,
  schema: string
): void {
  try {
    verifyEvidenceRefIdentity(ref);
    verifyEvidenceBinding(ref, {
      planningSpaceId: context.record.change.planningSpaceId,
      changeInstanceId: context.record.change.instanceId,
      projectId: context.record.change.projectId,
      changeId: context.record.change.changeId,
      runId: context.record.runId,
      actionId: context.actionId as EvidenceRef['binding']['actionId'],
      schema,
      treeDigest: context.treeDigest,
    });
  } catch (error) {
    throw new GauntletDomainError(
      'gauntlet_evidence_missing',
      `Gauntlet evidence is not bound to the expected Run, Action, schema, and workspace tree: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function assertAgentMatchesAction(
  actor: ActorRef | undefined,
  action: RunAction,
  expectedRole: 'implementer' | 'reviewer'
): asserts actor is Extract<ActorRef, { kind: 'agent' }> {
  if (
    actor === undefined ||
    actor.kind !== 'agent' ||
    action.kind !== 'agent' ||
    action.agent.role !== expectedRole ||
    actor.role !== action.agent.role ||
    actor.runtime !== action.agent.runtime
  ) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      `Gauntlet ${expectedRole} completion must come from the admitted agent role and runtime.`
    );
  }
  try {
    verifyActorRef(actor);
  } catch (error) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      `Gauntlet actor identity is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseCommittedWork(committed: CommittedAction): GoalWorkResult {
  if (committed.result?.status !== 'succeeded') {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      'Gauntlet work must be successfully committed.'
    );
  }
  return decodeGoalCycleResult(
    'work',
    'evaluate',
    committed.result.result
  ) as GoalWorkResult;
}

function validateCommittedWork(
  record: CanonicalRunRecord,
  committed: CommittedAction,
  expectedBeforeTree: Digest,
  expectedAfterTree?: Digest
): GoalWorkResult {
  const work = parseCommittedWork(committed);
  assertAgentMatchesAction(
    committed.result?.actor,
    committed.action,
    'implementer'
  );
  if (
    committed.action.expectedBeforeWorkspace.treeDigest !== expectedBeforeTree ||
    work.beforeTree !== expectedBeforeTree ||
    (expectedAfterTree !== undefined && work.afterTree !== expectedAfterTree)
  ) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      'Gauntlet work before/after trees do not match the admitted and observed workspace chain.'
    );
  }
  const delta = committed.result!.evidence.find(
    (ref) => ref.evidenceDigest === work.delta.evidenceDigest
  );
  if (delta === undefined) {
    throw new GauntletDomainError(
      'gauntlet_evidence_missing',
      'Gauntlet work delta is not one of the Action evidence refs.'
    );
  }
  verifyGauntletEvidenceRef(
    delta,
    {
      record,
      actionId: committed.action.actionId,
      treeDigest: work.afterTree as Digest,
    },
    GAUNTLET_WORK_EVIDENCE_SCHEMA
  );
  return work;
}

function expectedBeforeTreeForRound(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  round: number
): Digest {
  if (round === 1) return record.initialWorkspaceRevision.treeDigest as Digest;
  const prior = actionForGauntletPhase(
    plan,
    loop,
    record,
    round - 1,
    'work'
  );
  if (prior === undefined) {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      'Gauntlet workspace chain is missing the prior builder round.'
    );
  }
  return parseCommittedWork(prior).afterTree as Digest;
}

/**
 * Gauntlet delivery guard. Ship SHALL become ready only after the
 * convergence-judge satisfaction, and archive only after ship. No bypass
 * terminal is introduced — the mechanical-trust invariant is preserved.
 *
 * This mirrors assertTaskLoopMayDeliver but checks for attestation-evidenced
 * satisfaction (the convergence-judge) rather than mechanical criterion
 * satisfaction.
 */
export function assertGauntletMayDeliver(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  observedWorkspace?: WorkspaceRevision
): void {
  if (!isGauntletRun(plan, record)) return;

  // Terminal honesty: cancelled/blocked/escalated records are terminal.
  assertGauntletTerminalHonesty(record);
  assertGauntletNonConversion(record);
  assertGauntletNoGateNoBypass(record);

  // Find the convergence-judge satisfaction.
  const convergenceJudge = findConvergenceJudgeResult(plan, record);
  if (convergenceJudge === undefined) {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      'Gauntlet delivery requires convergence-judge satisfaction (attestation-evidenced). No bypass terminal exists around the judge.'
    );
  }

  // Validate the satisfaction source.
  if (convergenceJudge.satisfactionSource !== 'attestation-evidenced') {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      `Gauntlet delivery requires attestation-evidenced satisfaction, got '${convergenceJudge.satisfactionSource}'.`
    );
  }

  if (observedWorkspace === undefined) {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      'Gauntlet delivery requires a current trusted workspace observation.'
    );
  }

  // Validate the workspace chain: every builder round's trees must chain.
  const loop = plan.nodes.find(
    (node): node is RuntimePlanBoundedLoopNode =>
      node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
  );
  if (loop === undefined) return;

  const progress = projectGoalCycleProgress(plan, loop, record);
  if (progress.kind !== 'satisfied') {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      'Gauntlet delivery requires one mechanically valid satisfied outcome from the convergence-judge.'
    );
  }

  // Walk the builder chain to verify workspace integrity.
  let expectedBefore = record.initialWorkspaceRevision.treeDigest as Digest;
  let finalAfter: Digest | undefined;
  for (let round = 1; round <= progress.state.round; round += 1) {
    const work = actionForGauntletPhase(plan, loop, record, round, 'work');
    if (work === undefined) break;
    const workResult = validateCommittedWork(record, work, expectedBefore);
    expectedBefore = workResult.afterTree as Digest;
    finalAfter = workResult.afterTree as Digest;
  }
  if (
    finalAfter !== undefined &&
    finalAfter !== (observedWorkspace.treeDigest as Digest)
  ) {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      'The current workspace no longer matches the final evidenced builder tree.'
    );
  }
}

// ---------------------------------------------------------------------------
// Completion validation (parallel to validateTaskLoopCompletion)
// ---------------------------------------------------------------------------

function verifyActorAttestation(
  record: CanonicalRunRecord,
  committed: CommittedAction,
  treeDigest: Digest
): void {
  const attestation = committed.result?.actorAttestation;
  if (attestation === undefined) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      'Gauntlet agent completion is missing its actor attestation.'
    );
  }
  verifyGauntletEvidenceRef(
    attestation,
    {
      record,
      actionId: committed.action.actionId,
      treeDigest,
    },
    GAUNTLET_ACTOR_ATTESTATION_SCHEMA
  );
}

function validateCommittedJudge(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  committed: CommittedAction,
  work: CommittedAction,
  roundTree: Digest
): GauntletJudgeResult {
  const critic = committed.result?.actor;
  const builder = work.result?.actor;
  assertAgentMatchesAction(critic, committed.action, 'reviewer');
  assertAgentMatchesAction(builder, work.action, 'implementer');

  // Fresh-critic guard: the critic MUST differ from the builder.
  if (critic.sessionIdentityDigest === builder.sessionIdentityDigest) {
    throw new GauntletDomainError(
      'gauntlet_critic_reused',
      'The gauntlet critic must use a session distinct from the current builder.'
    );
  }
  verifyActorAttestation(record, committed, roundTree);
  return validateGauntletJudgment({
    contract: gauntletContract(record),
    result: committed.result!.result,
    rawEvidence: committed.result!.evidence,
    criticSessionIdentity: critic.sessionIdentityDigest,
    priorCriticSessionIdentities: priorCriticSessions(
      plan,
      record,
      committed.action.actionId
    ),
    evidenceContext: {
      record,
      actionId: committed.action.actionId,
      treeDigest: roundTree,
    },
  });
}

/**
 * Validate a gauntlet completion after generic GoalCycle envelope checks.
 * This is the gauntlet-specific pre-commit validation, parallel to
 * validateTaskLoopCompletion.
 *
 * For every judge completion, enforces:
 * - Fresh critic (not the builder, not any prior gauntlet critic)
 * - Builder cannot authoritatively declare the bar met (Task 3.2)
 * - Prior-critic-session completions are rejected (Task 3.2)
 */
export function validateGauntletCompletion(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  request: CompleteRunAction,
  observedWorkspace: WorkspaceRevision
): void {
  if (!isGauntletRun(plan, record) || request.kind !== 'domain-action-result') {
    return;
  }
  const committed = record.actions[request.actionId];
  if (committed === undefined) return;
  const descriptor = locateGoalCycleInvocation(
    plan,
    committed.action.nodeId as NodeId
  );
  if (descriptor === null || request.status !== 'succeeded') {
    return;
  }
  const expectedBefore = expectedBeforeTreeForRound(
    plan,
    descriptor.loop,
    record,
    descriptor.round
  );
  if (descriptor.phase === 'work') {
    const staged = {
      ...committed,
      result: {
        status: request.status,
        receiptDigest: request.receiptDigest,
        result: request.result,
        evidence: request.evidence,
        actor: request.actor,
        actorAttestation: request.actorAttestation,
      },
    } as unknown as CommittedAction;
    validateCommittedWork(
      record,
      staged,
      expectedBefore,
      observedWorkspace.treeDigest as Digest
    );
    return;
  }
  // Judge phase.
  const work = actionForGauntletPhase(
    plan,
    descriptor.loop,
    record,
    descriptor.round,
    'work'
  );
  if (work === undefined) {
    throw new GauntletDomainError(
      'gauntlet_delivery_guard',
      'Gauntlet judge has no committed builder round.'
    );
  }
  const workResult = validateCommittedWork(
    record,
    work,
    expectedBefore,
    observedWorkspace.treeDigest as Digest
  );
  const staged = {
    ...committed,
    result: {
      status: request.status,
      receiptDigest: request.receiptDigest,
      result: request.result,
      evidence: request.evidence,
      actor: request.actor,
      actorAttestation: request.actorAttestation,
    },
  } as unknown as CommittedAction;
  validateCommittedJudge(
    plan,
    record,
    staged,
    work,
    workResult.afterTree as Digest
  );
}

// ---------------------------------------------------------------------------
// Phase-0 flat loop (Tasks 3.1–3.3)
// ---------------------------------------------------------------------------

/**
 * Phase-0 flat gauntlet loop: one builder/critic loop over the WHOLE artifact
 * against the reference bar, with a meta-critic performing blind A/B and
 * returning the single largest gap. No decomposition, no pieces, no waves.
 *
 * Phase-0 reuses GoalCycle's bounded loop with the evaluate variant in
 * gauntlet mode. The builder works on the whole artifact; the critic does
 * blind A/B against the reference bar.
 */
export function projectGauntletPhase0(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  loop: RuntimePlanBoundedLoopNode,
  progress?: GoalCycleProgress
): {
  readonly phase: 0;
  readonly round: number;
  readonly builderActor?: string;
  readonly criticActor?: string;
  readonly latestGap?: string;
  readonly backstop: GauntletBackstopState;
} {
  const resolvedProgress = progress ?? projectGoalCycleProgress(plan, loop, record);
  const round = 'next' in resolvedProgress ? resolvedProgress.next.round : resolvedProgress.state.round;
  const judgment = latestAcceptedJudgment(plan, record);
  const backstop = projectGauntletBackstop(
    resolvedProgress.state.round,
    loop.maxIterations
  );

  const builderActor = actionForGauntletPhase(
    plan,
    loop,
    record,
    round,
    'work'
  )?.result?.actor?.identityDigest;
  const criticActor = actionForGauntletPhase(
    plan,
    loop,
    record,
    round,
    'judge'
  )?.result?.actor?.identityDigest;

  return Object.freeze({
    phase: 0 as const,
    round,
    ...(builderActor === undefined ? {} : { builderActor }),
    ...(criticActor === undefined ? {} : { criticActor }),
    ...(judgment?.biggestGap === undefined
      ? {}
      : { latestGap: judgment.biggestGap }),
    backstop,
  });
}

/**
 * Phase 0 creates NO runtime proposal/design/specs/tasks/goal-plan artifacts.
 * The gauntlet input has no spec-related fields (enforced by the strictObject
 * schema in decodeGauntletInput). This function asserts the invariant.
 */
export function assertPhase0NoSpecArtifacts(
  input: GauntletInput
): void {
  // GauntletInput has no spec-related fields. The schema is strictObject,
  // so any attempt to add proposal/design/specs/tasks fields is rejected at
  // decode time. This function is the explicit assertion.
  expectNoField(input, 'proposal');
  expectNoField(input, 'design');
  expectNoField(input, 'specs');
  expectNoField(input, 'tasks');
  expectNoField(input, 'goalPlan');
}

function expectNoField(obj: object, field: string): void {
  if (field in obj) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      `Gauntlet input must not contain spec-driven artifact '${field}'. Phase 0 creates no runtime planning artifacts.`
    );
  }
}

/**
 * Phase-0 fresh-critic enforcement (Task 3.2): a builder cannot authoritatively
 * declare the bar met. Prior-critic-session and builder-as-critic completions
 * are rejected.
 *
 * This is enforced in validateCommittedJudge above (the fresh-critic guard
 * rejects builder-as-critic) and in validateGauntletJudgment (the
 * priorCriticSessionIdentities guard rejects prior sessions). This function
 * is the explicit assertion for Phase-0 status.
 */
export function assertPhase0FreshCritic(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  loop: RuntimePlanBoundedLoopNode,
  round: number
): void {
  const work = actionForGauntletPhase(plan, loop, record, round, 'work');
  const judge = actionForGauntletPhase(plan, loop, record, round, 'judge');
  if (work === undefined || judge === undefined) return;

  const builder = work.result?.actor;
  const critic = judge.result?.actor;
  if (builder === undefined || critic === undefined) return;

  // Builder cannot be the critic.
  if (builder.identityDigest === critic.identityDigest) {
    throw new GauntletDomainError(
      'gauntlet_critic_reused',
      'Phase-0 builder cannot authoritatively declare the bar met (builder-as-critic rejected).'
    );
  }

  // Prior-critic-session check: the critic must not have judged an earlier round.
  const priorSessions = priorCriticSessions(
    plan,
    record,
    judge.action.actionId
  );
  if (critic.kind === 'agent' && priorSessions.includes(critic.sessionIdentityDigest)) {
    throw new GauntletDomainError(
      'gauntlet_critic_reused',
      'Phase-0 critic session was already used in an earlier gauntlet round (prior-critic-session rejected).'
    );
  }
}

// ---------------------------------------------------------------------------
// Status projection + report (Task 3.3)
// ---------------------------------------------------------------------------

/**
 * Build the phase input without leaking builder narrative into the critic
 * context (parallel to taskLoopActionInput). The critic gets the frozen goal,
 * reference bar, real artifact/evidence locations, and raw evidence — never
 * the builder's reasoning or summary.
 */
export function gauntletActionInput(input: {
  readonly plan: RuntimePlan;
  readonly record: CanonicalRunRecord;
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly round: number;
  readonly phase: 'work' | 'judge';
}): Readonly<{ gauntlet: JsonValue }> {
  const contract = gauntletContract(input.record);
  const base: Record<string, JsonValue> = {
    contract: contract as unknown as JsonValue,
    contractDigest: gauntletContractDigest(contract),
    round: input.round,
    phase: input.phase,
  };
  if (input.phase === 'work') {
    // Feedback: the latest unsatisfied gap from the previous round's critic.
    const prior = latestAcceptedJudgment(input.plan, input.record);
    if (
      prior !== undefined &&
      !prior.satisfied &&
      prior.biggestGap !== undefined
    ) {
      base.feedback = {
        biggestGap: prior.biggestGap,
        verdict: prior.verdict,
      };
    }
  } else {
    // Judge phase: provide real artifact targets and raw evidence.
    // Never include builder narrative.
    const work = actionForGauntletPhase(
      input.plan,
      input.loop,
      input.record,
      input.round,
      'work'
    );
    base.artifactTargets = [...contract.artifactTargets];
    base.bar = {
      domain: contract.bar.domain,
      referenceTargets: [...contract.bar.referenceTargets],
      comparisonAxis: contract.bar.comparisonAxis,
    } as JsonValue;
    base.rawEvidence = (work?.result?.evidence ?? []) as unknown as JsonValue;
    const workResult = work?.result?.result;
    if (
      workResult !== null &&
      typeof workResult === 'object' &&
      !Array.isArray(workResult) &&
      typeof (workResult as { afterTree?: unknown }).afterTree === 'string'
    ) {
      base.afterTree = (workResult as { afterTree: string }).afterTree;
    }
  }
  return Object.freeze({ gauntlet: base as JsonValue });
}

/**
 * Project the gauntlet status section. Reports phase, round, actors, evidence,
 * budget, and the deterministic next action (Task 3.3).
 *
 * This is a read-only projection — it cannot change the canonical next action,
 * satisfaction, or terminal result. All authority is in the Canonical Run
 * Record.
 */
export function projectGauntletSection(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  loop: RuntimePlanBoundedLoopNode,
  progress: GoalCycleProgress
): Readonly<Record<string, unknown>> {
  const contract = gauntletContract(record);
  const judgment = latestAcceptedJudgment(plan, record);
  const convergenceJudge = findConvergenceJudgeResult(plan, record);
  const phase0 = projectGauntletPhase0(plan, record, loop, progress);
  const actors = Array.from(
    { length: progress.state.round },
    (_, index) => {
      const round = index + 1;
      const builder = actionForGauntletPhase(plan, loop, record, round, 'work')
        ?.result?.actor?.identityDigest;
      const critic = actionForGauntletPhase(plan, loop, record, round, 'judge')
        ?.result?.actor?.identityDigest;
      return Object.freeze({
        round,
        ...(builder === undefined ? {} : { builder }),
        ...(critic === undefined ? {} : { critic }),
      });
    }
  ).filter(
    (entry) => entry.builder !== undefined || entry.critic !== undefined
  );
  const phase = 'next' in progress ? progress.next.phase : progress.state.phase;
  const round = 'next' in progress ? progress.next.round : progress.state.round;
  const terminalOutcome =
    record.terminal?.kind === 'completed'
      ? record.terminal.outcome
      : record.terminal?.kind === 'escalated' ||
          record.terminal?.kind === 'failed'
        ? record.terminal.code
        : record.terminal?.kind;

  // Deterministic next action.
  const nextAction =
    record.terminal !== undefined
      ? 'none'
      : progress.kind === 'satisfied'
        ? 'ship'
        : progress.kind === 'exhausted' || progress.kind === 'failed'
          ? 'converge-or-resume'
          : phase === 'work'
            ? 'build'
            : 'critic';

  return deepFreeze({
    kind: 'gauntlet-loop',
    version: 1,
    phase: phase0.phase,
    contractDigest: gauntletContractDigest(contract),
    contract,
    round,
    currentPhase: phase,
    budget: {
      used: progress.state.eventCount,
      max: loop.maxIterations * 2,
      remainingRounds: Math.max(0, loop.maxIterations - round + 1),
    },
    backstop: phase0.backstop,
    actors,
    ...(judgment?.biggestGap === undefined
      ? {}
      : { largestGap: judgment.biggestGap }),
    ...(judgment?.verdict === undefined
      ? {}
      : { lastVerdict: judgment.verdict }),
    rawEvidence: Object.values(record.actions)
      .filter((entry) => entry.result !== undefined)
      .flatMap((entry) => entry.result!.evidence)
      .sort((left, right) =>
        left.evidenceDigest < right.evidenceDigest
          ? -1
          : left.evidenceDigest > right.evidenceDigest
            ? 1
            : left.binding.actionId < right.binding.actionId
              ? -1
              : left.binding.actionId > right.binding.actionId
                ? 1
                : 0
      ),
    ...(convergenceJudge === undefined
      ? {}
      : {
          convergence: {
            satisfied: true,
            satisfactionSource: convergenceJudge.satisfactionSource,
            attestationDigest: convergenceJudge.attestation?.attestationDigest,
            issuedAt: convergenceJudge.attestation?.issuedAt,
          },
        }),
    stallStreak: progress.state.stallStreak,
    outcome: terminalOutcome ?? progress.state.outcome,
    nextAction,
    ...(record.inputs.gatePolicy === undefined
      ? {}
      : { gatePolicy: record.inputs.gatePolicy }),
  });
}

/** Write a digest-stamped, read-only projection from committed Record truth. */
export function writeGauntletReport(
  evidenceDir: string,
  plan: RuntimePlan,
  record: CanonicalRunRecord
): string | undefined {
  if (!isGauntletRun(plan, record)) return undefined;
  const loop = plan.nodes.find(
    (node): node is RuntimePlanBoundedLoopNode =>
      node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
  );
  if (loop === undefined) return undefined;
  const progress = projectGoalCycleProgress(plan, loop, record);
  const section = projectGauntletSection(plan, record, loop, progress);
  const reportPath = path.join(evidenceDir, 'gauntlet-report.md');
  const contract = section.contract as GauntletInput;
  const actors = section.actors as readonly {
    round: number;
    builder?: string;
    critic?: string;
  }[];
  const rawEvidence = section.rawEvidence as readonly EvidenceRef[];
  const backstop = section.backstop as GauntletBackstopState;
  const lines = [
    '# Gauntlet Loop Report',
    '',
    `Contract digest: ${String(section.contractDigest)}`,
    `Phase: ${String(section.phase)}`,
    `Outcome: ${String(section.outcome ?? 'in-progress')}`,
    `Round: ${String(section.round)}`,
    `Next action: ${String(section.nextAction)}`,
    '',
    `Goal: ${contract.goal}`,
    '',
    `## Reference Bar`,
    '',
    `- Domain: ${contract.bar.domain}`,
    `- Comparison axis: ${contract.bar.comparisonAxis}`,
    `- Reference targets: ${contract.bar.referenceTargets.join(', ')}`,
    '',
    `## Backstop`,
    '',
    `- State: ${backstop.kind}`,
    `- Rounds used: ${backstop.roundsUsed} / ${backstop.maxRounds}`,
    '',
    ...(section.largestGap === undefined
      ? []
      : [`Largest gap: ${String(section.largestGap)}`]),
    ...(section.lastVerdict === undefined
      ? []
      : [`Last A/B verdict: ${String(section.lastVerdict)}`]),
    ...(section.largestGap === undefined && section.lastVerdict === undefined
      ? []
      : ['']),
    '## Actors',
    '',
    ...actors.map(
      (entry) =>
        `- Round ${entry.round}: builder=${entry.builder ?? 'pending'}, critic=${entry.critic ?? 'pending'}`
    ),
    '',
    '## Raw evidence',
    '',
    ...rawEvidence.map(
      (ref) =>
        `- ${ref.evidenceDigest} | content ${ref.contentDigest} | action ${ref.binding.actionId} | tree ${ref.binding.treeDigest ?? 'none'}`
    ),
    '',
  ];
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  return reportPath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Re-exports from gauntlet-bar for convenience
// ---------------------------------------------------------------------------

export type { ReferenceBar };
