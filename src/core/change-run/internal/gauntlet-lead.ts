import type { NodeId } from '../contracts.js';
import type { CanonicalRunRecord } from './record.js';
import type { RuntimePlan, RuntimePlanBoundedLoopNode } from './runtime-plan.js';
import { deriveNodeId } from './identity.js';
import {
  GauntletDomainError,
  type GauntletInput,
} from './gauntlet-bar.js';
import {
  isDegenerateDecomposition,
  type GauntletWaveDecomposition,
  type GauntletWavePiece,
} from './gauntlet-wave.js';

// ---------------------------------------------------------------------------
// Lead role (Task 5.1)
// ---------------------------------------------------------------------------

/**
 * The gauntlet lead owns four responsibilities:
 *
 * 1. **Goal + bar custody**: the frozen goal and reference bar are the lead's
 *    north star. The lead does not modify them (they are launch-identity frozen).
 *
 * 2. **Phase-transition decisions**: the lead decides WHEN to transition from
 *    Phase 0 (flat serial foundation) to Phase 1+ (per-wave polish). This
 *    decision is SOVEREIGN over the meta-critic's advisory signal — the
 *    meta-critic may advise "ready to decompose" but the lead decides.
 *
 * 3. **Per-wave one-level decomposition**: the lead decomposes the artifact
 *    into pieces at exactly ONE level per wave. Pieces are NEVER recursively
 *    sub-decomposed (Task 5.2 invariant).
 *
 * 4. **Smoothing decisions**: the lead decides whether to run an optional fresh
 *    smoothing pass between waves (Task 5.3).
 *
 * The lead's internal skill contract is defined by the `GauntletLeadContract`
 * interface below. The engine layer provides the types and validation; the
 * skill layer (group 6) provides the behavioral prompts.
 */
export interface GauntletLeadContract {
  readonly role: 'gauntlet-lead';
  readonly responsibilities: readonly string[];
}

export const GAUNTLET_LEAD_CONTRACT: GauntletLeadContract = Object.freeze({
  role: 'gauntlet-lead',
  responsibilities: Object.freeze([
    'Hold the frozen goal and reference bar as the north star',
    'Decide when to transition from Phase 0 to Phase 1+ (sovereign over meta-critic advisory)',
    'Decompose the artifact at exactly one level per wave (never recursive sub-decomposition)',
    'Decide whether to run optional fresh smoothing between waves',
    'Converge the Run via attestation when the artifact meets the user judgment',
  ]),
});

// ---------------------------------------------------------------------------
// Phase transition decision (Task 5.1 — sovereign over meta-critic advisory)
// ---------------------------------------------------------------------------

/**
 * The lead's phase-transition decision. The lead is sovereign: the meta-critic's
 * advisory signal is input, not authority. The lead may transition even when the
 * meta-critic advises against it, or stay in Phase 0 when the meta-critic
 * advises transition.
 *
 * - 'stay-phase-0':    continue the flat serial foundation loop
 * - 'transition':      begin per-wave polish (Phase 1+)
 */
export type GauntletPhaseTransitionDecision =
  | Readonly<{ kind: 'stay-phase-0'; reason: string }>
  | Readonly<{ kind: 'transition'; reason: string }>;

/**
 * The meta-critic's advisory signal for phase transition. This is advisory
 * only — the lead's decision is sovereign.
 */
export type MetaCriticTransitionAdvisory =
  | Readonly<{ kind: 'ready-to-decompose'; biggestGap: string }>
  | Readonly<{ kind: 'needs-more-foundation'; biggestGap: string }>
  | Readonly<{ kind: 'neutral' }>;

/**
 * Make a phase-transition decision. The lead is sovereign over the meta-critic.
 *
 * This function encapsulates the decision policy:
 * - If the meta-critic advises 'ready-to-decompose', the lead MAY transition
 *   but is not required to.
 * - If the meta-critic advises 'needs-more-foundation', the lead MAY still
 *   transition (sovereign override).
 * - The lead's own judgment (encoded in `leadJudgment`) is the final word.
 */
export function decidePhaseTransition(input: {
  readonly metaCriticAdvisory: MetaCriticTransitionAdvisory;
  readonly leadJudgment: 'transition' | 'stay';
  readonly reason: string;
}): GauntletPhaseTransitionDecision {
  // The lead's judgment is sovereign. The meta-critic advisory is recorded
  // for audit but does not override the lead's decision.
  if (input.leadJudgment === 'transition') {
    return Object.freeze({
      kind: 'transition' as const,
      reason: input.reason,
    });
  }
  return Object.freeze({
    kind: 'stay-phase-0' as const,
    reason: input.reason,
  });
}

// ---------------------------------------------------------------------------
// Per-wave one-level decomposition (Task 5.2)
// ---------------------------------------------------------------------------

/**
 * Build a wave decomposition result. This is the committed Action that
 * records the lead's one-level decomposition for the wave. The decomposition
 * is replayable: resume reconstructs it from the event log, and the sealed
 * RuntimePlan digest is never mutated.
 *
 * CRITICAL INVARIANT: pieces are decomposed at exactly ONE level. They are
 * NEVER recursively sub-decomposed into sub-pieces. Each wave re-applies the
 * decomposition fresh — it does not nest.
 */
export function buildWaveDecomposition(input: {
  readonly wave: number;
  readonly pieces: readonly GauntletWavePiece[];
}): GauntletWaveDecomposition {
  if (!Number.isSafeInteger(input.wave) || input.wave < 1) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      `Wave decomposition wave number must be a positive safe integer, got ${input.wave}.`
    );
  }
  if (input.pieces.length === 0) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      'Wave decomposition must declare at least one piece. Use a 1-piece decomposition to stay in Phase 0.'
    );
  }
  // Validate piece IDs are unique and non-empty.
  const seenIds = new Set<string>();
  for (const piece of input.pieces) {
    if (piece.id.length === 0 || piece.id.length > 256) {
      throw new GauntletDomainError(
        'gauntlet_input_invalid',
        `Piece ID ${JSON.stringify(piece.id)} is out of bounds (1–256 chars).`
      );
    }
    if (seenIds.has(piece.id)) {
      throw new GauntletDomainError(
        'gauntlet_input_invalid',
        `Piece ID ${JSON.stringify(piece.id)} is duplicated in the decomposition.`
      );
    }
    seenIds.add(piece.id);
    if (piece.targetPaths.length === 0) {
      throw new GauntletDomainError(
        'gauntlet_input_invalid',
        `Piece ${JSON.stringify(piece.id)} must declare at least one target path.`
      );
    }
  }
  return Object.freeze({
    contract: 'gauntlet-wave-decomposition/1' as const,
    wave: input.wave,
    pieces: Object.freeze(
      input.pieces.map((piece) =>
        Object.freeze({
          id: piece.id,
          description: piece.description,
          targetPaths: Object.freeze([...piece.targetPaths]),
        })
      )
    ),
  });
}

/**
 * Assert that a decomposition is one-level only. This is the mechanical guard
 * for Task 5.2: pieces are never recursively sub-decomposed.
 *
 * A one-level decomposition means each piece is a leaf — it has a description
 * and target paths, not a nested decomposition. This function validates the
 * structure of the committed decomposition Action.
 */
export function assertOneLevelDecomposition(
  decomposition: GauntletWaveDecomposition
): void {
  for (const piece of decomposition.pieces) {
    // A piece must NOT contain a nested decomposition. Check that the piece
    // has no 'pieces' field (which would indicate nesting).
    const pieceRecord = piece as unknown as Readonly<Record<string, unknown>>;
    if ('pieces' in pieceRecord || 'decomposition' in pieceRecord) {
      throw new GauntletDomainError(
        'gauntlet_input_invalid',
        `Piece ${JSON.stringify(piece.id)} contains a nested decomposition. Gauntlet is one-level only — pieces are never recursively sub-decomposed.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Phase-0 → Phase-1+ transition (Task 5.2)
// ---------------------------------------------------------------------------

/**
 * Determine if a gauntlet-loop Run has transitioned from Phase 0 to Phase 1+.
 * The transition is signaled by the first committed wave decomposition in the
 * gauntlet-wave bounded-loop.
 *
 * Before any decomposition: Phase 0 (flat serial foundation).
 * After the first decomposition: Phase 1+ (per-wave polish).
 */
export function currentGauntletPhase(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): 0 | number {
  if (loop.body.kind !== 'gauntlet-wave') return 0;
  // Check for any committed decomposition.
  for (let wave = 1; wave <= loop.maxIterations; wave += 1) {
    const decomposePath = `${loop.hierarchicalPath}/wave:${wave}/decompose`;
    const hasAction = Object.values(record.actions).some(
      (committed) =>
        committed.action.nodeId ===
          (deriveNodeIdSafe(plan, decomposePath)) &&
        committed.result?.status === 'succeeded'
    );
    if (hasAction) {
      // Phase 1+ — return the wave number.
      return wave;
    }
  }
  return 0;
}

/**
 * Assert that the Phase-0 → Phase-1+ transition preserves the one-level
 * invariant: each wave re-applies decomposition fresh, never nesting.
 */
export function assertTransitionOneLevel(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): void {
  if (loop.body.kind !== 'gauntlet-wave') return;
  // Scan all committed decompositions and assert each is one-level.
  for (let wave = 1; wave <= loop.maxIterations; wave += 1) {
    const decomposePath = `${loop.hierarchicalPath}/wave:${wave}/decompose`;
    const nodeId = deriveNodeIdSafe(plan, decomposePath);
    if (nodeId === undefined) continue;
    const action = Object.values(record.actions).find(
      (committed) =>
        committed.action.nodeId === nodeId &&
        committed.result?.status === 'succeeded'
    );
    if (action === undefined) continue;
    const result = action.result!.result as Readonly<Record<string, unknown>>;
    if (result.contract !== 'gauntlet-wave-decomposition/1') continue;
    const decomposition = result as unknown as GauntletWaveDecomposition;
    assertOneLevelDecomposition(decomposition);
  }
}

// ---------------------------------------------------------------------------
// Optional fresh smoothing pass (Task 5.3)
// ---------------------------------------------------------------------------

/**
 * The lead's smoothing decision. Smoothing is optional and lead-triggered.
 * It runs in a fresh context over the whole artifact for cohesion — it does
 * NOT redesign pieces.
 */
export type GauntletSmoothingDecision =
  | Readonly<{ kind: 'smooth'; reason: string }>
  | Readonly<{ kind: 'skip'; reason: string }>;

/**
 * Decide whether to smooth between waves. The lead considers:
 * - Whether the pieces integrated coherently
 * - Whether the meta-critic identified integration gaps
 * - The remaining wave budget
 *
 * Smoothing is a fresh pass over the WHOLE artifact — it does not redesign
 * individual pieces. It addresses cross-piece cohesion only.
 */
export function decideSmoothing(input: {
  readonly metaCriticAdvisory: MetaCriticTransitionAdvisory;
  readonly remainingWaves: number;
  readonly leadJudgment: 'smooth' | 'skip';
  readonly reason: string;
}): GauntletSmoothingDecision {
  // The lead's judgment is sovereign.
  if (input.leadJudgment === 'smooth' && input.remainingWaves > 0) {
    return Object.freeze({
      kind: 'smooth' as const,
      reason: input.reason,
    });
  }
  return Object.freeze({
    kind: 'skip' as const,
    reason: input.reason,
  });
}

/**
 * Assert that a smoothing pass does not redesign pieces. The smoothing action
 * works over the whole artifact (cohesion), not individual pieces. This is
 * enforced by the workspace access model: smoothing has write access to the
 * whole workspace, but the lead's skill contract prohibits piece redesign.
 *
 * This function is the mechanical assertion — it validates that the smoothing
 * result references the whole artifact targets, not individual piece targets.
 */
export function assertSmoothingWholeArtifact(
  smoothingResult: Readonly<Record<string, unknown>>,
  artifactTargets: readonly string[]
): void {
  // The smoothing result should reference artifact targets, not piece-specific
  // targets. This is a lightweight structural check.
  const targets = smoothingResult.targetPaths;
  if (Array.isArray(targets)) {
    for (const target of targets) {
      if (typeof target === 'string' && !artifactTargets.includes(target)) {
        throw new GauntletDomainError(
          'gauntlet_smoothing_target_invalid',
          `Smoothing pass referenced target ${JSON.stringify(target)} which is not in the artifact targets; piece-level redesign is not permitted in a whole-artifact smoothing pass.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 1-piece decomposition = no-op (Task 5.4)
// ---------------------------------------------------------------------------

/**
 * A 1-piece decomposition is degenerate: it is equivalent to Phase 0 (one
 * builder/critic over the whole artifact). The gauntlet-wave progressor
 * handles this naturally — a single piece build/critic cycle has the same
 * structure as a Phase-0 round.
 *
 * When the lead emits a 1-piece decomposition, the wave-loop pays no
 * orchestration overhead beyond a single extra action (the decompose commit).
 * The progressor emits one build candidate, one critic candidate, and one
 * meta-critic candidate — exactly like a Phase-0 round.
 *
 * This function identifies the degenerate case and advises staying in Phase 0.
 */
export function adviseDegenerateDecomposition(
  decomposition: GauntletWaveDecomposition
): Readonly<{ degenerate: boolean; advice: string }> {
  if (isDegenerateDecomposition(decomposition)) {
    return Object.freeze({
      degenerate: true,
      advice:
        '1-piece decomposition is equivalent to Phase 0. Consider staying in the flat serial foundation loop instead of paying wave orchestration overhead.',
    });
  }
  return Object.freeze({
    degenerate: false,
    advice: '',
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely derive a nodeId. Used in scan loops where the path is well-formed.
 */
function deriveNodeIdSafe(
  plan: RuntimePlan,
  hierarchicalPath: string
): NodeId {
  return deriveNodeId(plan.runId, hierarchicalPath);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { GauntletInput, GauntletWavePiece };
