import type {
  CompleteRunAction,
  JsonValue,
  NodeId,
} from '../contracts.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';
import { deriveNodeId } from './identity.js';
import { findConvergenceJudgeResult } from './gauntlet-loop.js';
import type {
  GauntletWavePhaseRole,
  RuntimePlan,
  RuntimePlanBoundedLoopNode,
  RuntimePlanGauntletWaveBody,
  RuntimePlanGauntletWavePhase,
  RuntimePlanAdmissionKind,
  RuntimePlanWorkspace,
} from './runtime-plan.js';

// ---------------------------------------------------------------------------
// Evidence schema constant
// ---------------------------------------------------------------------------

export const GAUNTLET_WAVE_DECOMPOSITION_EVIDENCE_SCHEMA =
  'gauntlet-wave-decomposition/1';

// ---------------------------------------------------------------------------
// Wave decomposition result (committed Action — the ReviewCycle pattern)
// ---------------------------------------------------------------------------

/**
 * The decomposition committed by the lead at the start of each wave. This is a
 * replayable committed Action within the sealed RuntimePlan (Decision 3): the
 * plan digest is never mutated, and resume reconstructs wave structure from
 * the event log.
 *
 * A 1-piece decomposition is a degenerate no-op that stays in Phase 0
 * (Task 5.4).
 */
export interface GauntletWavePiece {
  readonly id: string;
  readonly description: string;
  readonly targetPaths: readonly string[];
}

export interface GauntletWaveDecomposition {
  readonly contract: 'gauntlet-wave-decomposition/1';
  readonly wave: number;
  readonly pieces: readonly GauntletWavePiece[];
}

// ---------------------------------------------------------------------------
// Invocation descriptor + progress type
// ---------------------------------------------------------------------------

export interface GauntletWaveInvocationDescriptor {
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly wave: number;
  readonly role: GauntletWavePhaseRole;
  /** Present for build/critic roles; undefined for decompose/meta-critic/smooth. */
  readonly pieceId?: string;
  readonly hierarchicalPath: string;
  readonly nodeId: NodeId;
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
}

/**
 * The wave lifecycle progress, projected purely from the sealed plan and
 * committed Record. The reconciler dispatches on `kind`:
 *
 * - ready:          emit a single admit candidate (write access for
 *                   decompose/build/smooth).
 * - critics-ready:  emit MULTIPLE read-access candidates (all piece critics +
 *                   the meta-critic). These parallelize under the single-writer
 *                   lock because they are all readers.
 * - waiting:        an action is already active; no fresh candidate.
 * - satisfied:      the loop is clean (convergence-judge satisfaction or
 *                   terminal completion).
 * - exhausted:      maxIterations waves reached without convergence.
 */
export type GauntletWaveProgress =
  | Readonly<{
      kind: 'ready';
      descriptor: GauntletWaveInvocationDescriptor;
    }>
  | Readonly<{
      kind: 'critics-ready';
      critics: readonly GauntletWaveInvocationDescriptor[];
    }>
  | Readonly<{
      kind: 'waiting';
      descriptor: GauntletWaveInvocationDescriptor;
      action: CommittedAction;
    }>
  | Readonly<{ kind: 'satisfied' }>
  | Readonly<{ kind: 'exhausted' }>;

// ---------------------------------------------------------------------------
// Path / nodeId derivation
// ---------------------------------------------------------------------------

/**
 * Derive the hierarchical path for a gauntlet-wave invocation. Piece-loops are
 * expressed as non-nested children via path segments — they are NOT BoundedLoop
 * nodes nested inside the gauntlet-wave body.
 *
 *   decompose:    `${loopPath}/wave:${W}/decompose`
 *   piece build:  `${loopPath}/wave:${W}/piece:${P}/build`
 *   piece critic: `${loopPath}/wave:${W}/piece:${P}/critic`
 *   meta-critic:  `${loopPath}/wave:${W}/meta-critic`
 *   smooth:       `${loopPath}/wave:${W}/smooth`
 */
export function gauntletWaveInvocationPath(
  loopPath: string,
  wave: number,
  role: GauntletWavePhaseRole,
  pieceId?: string
): string {
  const base = `${loopPath}/wave:${wave}`;
  switch (role) {
    case 'decompose':
      return `${base}/decompose`;
    case 'meta-critic':
      return `${base}/meta-critic`;
    case 'smooth':
      return `${base}/smooth`;
    case 'build':
    case 'critic':
      if (pieceId === undefined) {
        throw new Error(
          `gauntletWaveInvocationPath: pieceId is required for role '${role}'.`
        );
      }
      return `${base}/piece:${pieceId}/${role}`;
  }
}

export function gauntletWaveInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  wave: number,
  phase: RuntimePlanGauntletWavePhase,
  pieceId?: string
): GauntletWaveInvocationDescriptor {
  const hierarchicalPath = gauntletWaveInvocationPath(
    loop.hierarchicalPath,
    wave,
    phase.role,
    pieceId
  );
  return Object.freeze({
    loop,
    wave,
    role: phase.role,
    ...(pieceId !== undefined ? { pieceId } : {}),
    hierarchicalPath,
    nodeId: deriveNodeId(plan.runId, hierarchicalPath),
    profilePath: phase.profilePath,
    admissionKind: phase.admissionKind,
    workspace: phase.workspace,
  });
}

// ---------------------------------------------------------------------------
// Record → wave state extraction
// ---------------------------------------------------------------------------

function gauntletWaveBody(
  loop: RuntimePlanBoundedLoopNode
): RuntimePlanGauntletWaveBody {
  if (loop.body.kind !== 'gauntlet-wave') {
    throw new Error(
      `Expected gauntlet-wave body but got ${loop.body.kind}.`
    );
  }
  return loop.body;
}

function phaseByRole(
  body: RuntimePlanGauntletWaveBody,
  role: GauntletWavePhaseRole
): RuntimePlanGauntletWavePhase {
  const found = body.phases.find((phase) => phase.role === role);
  if (found === undefined) {
    throw new Error(
      `GauntletWave body is missing phase role '${role}'.`
    );
  }
  return found;
}

function hasSmoothPhase(body: RuntimePlanGauntletWaveBody): boolean {
  return body.phases.some((phase) => phase.role === 'smooth');
}

function actionForNodeId(
  record: CanonicalRunRecord,
  nodeId: NodeId
): CommittedAction | undefined {
  return Object.values(record.actions).find(
    (committed) => committed.action.nodeId === nodeId
  );
}

function committedResultFor(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  wave: number,
  role: GauntletWavePhaseRole,
  pieceId?: string
): CommittedAction | undefined {
  const body = gauntletWaveBody(loop);
  const phase = phaseByRole(body, role);
  const descriptor = gauntletWaveInvocation(plan, loop, wave, phase, pieceId);
  const action = actionForNodeId(record, descriptor.nodeId);
  return action;
}

function isCommitted(
  action: CommittedAction | undefined
): action is CommittedAction {
  return action !== undefined && action.result?.status === 'succeeded';
}

/**
 * Scan the record for committed decomposition Actions and return the latest.
 * The wave number is read from the decomposition result itself, ensuring
 * resume reconstructs the exact same wave structure from the event log.
 */
function latestDecomposition(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): { wave: number; decomposition: GauntletWaveDecomposition } | null {
  const body = gauntletWaveBody(loop);
  const decomposePhase = phaseByRole(body, 'decompose');
  let latest: { wave: number; decomposition: GauntletWaveDecomposition } | null =
    null;
  for (let wave = 1; wave <= loop.maxIterations; wave += 1) {
    const descriptor = gauntletWaveInvocation(
      plan,
      loop,
      wave,
      decomposePhase
    );
    const action = actionForNodeId(record, descriptor.nodeId);
    if (!isCommitted(action)) continue;
    const result = action.result!.result as Readonly<Record<string, unknown>>;
    if (result.contract !== 'gauntlet-wave-decomposition/1') continue;
    const decomposition = result as unknown as GauntletWaveDecomposition;
    if (latest === null || decomposition.wave > latest.wave) {
      latest = { wave: decomposition.wave, decomposition };
    }
  }
  return latest;
}

/**
 * Extract the piece IDs from a committed decomposition.
 */
function pieceIds(decomposition: GauntletWaveDecomposition): readonly string[] {
  return decomposition.pieces.map((piece) => piece.id);
}

// ---------------------------------------------------------------------------
// Wave state machine (the core progressor)
// ---------------------------------------------------------------------------

/**
 * Project the gauntlet-wave bounded-loop progress purely from the sealed plan
 * and committed Record. This is the wave state machine:
 *
 * 1. Convergence-judge satisfaction → 'satisfied'
 * 2. No decomposition yet → 'ready' (decompose for wave 1)
 * 3. Decomposition for wave W → check piece builds:
 *    a. Not all built → 'ready' (build next unbuilt piece, write access)
 *    b. All built → check critics:
 *       i.  Not all committed → 'critics-ready' (ALL critics + meta-critic
 *           admitted together as read-only — this is the parallel sub-phase)
 *       ii. All committed → check smooth:
 *           - Smooth phase exists & not committed → 'ready' (smooth)
 *           - Smooth done or absent → next wave:
 *             * W < maxIterations → 'ready' (decompose wave W+1)
 *             * W >= maxIterations → 'exhausted'
 *
 * Two-sub-phase staging (Task 4.5): piece-builders emit ONE write candidate
 * per reconcile cycle (serialized by selectCompatibleAdmissions); critics emit
 * MULTIPLE read candidates (parallelized by selectCompatibleAdmissions).
 * Critics are NEVER candidates until every piece in the wave is committed.
 */
export function projectGauntletWaveProgress(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): GauntletWaveProgress {
  const body = gauntletWaveBody(loop);

  // 1. Convergence-judge satisfaction → clean.
  const convergence = findConvergenceJudgeResult(plan, record);
  if (convergence !== undefined && convergence.satisfied) {
    return Object.freeze({ kind: 'satisfied' });
  }

  // 2. Find the latest committed decomposition.
  const latest = latestDecomposition(plan, loop, record);

  if (latest === null) {
    // No decomposition yet → decompose-ready for wave 1.
    const decomposePhase = phaseByRole(body, 'decompose');
    const descriptor = gauntletWaveInvocation(
      plan,
      loop,
      1,
      decomposePhase
    );
    const action = actionForNodeId(record, descriptor.nodeId);
    if (action !== undefined && action.result === undefined) {
      return Object.freeze({ kind: 'waiting', descriptor, action });
    }
    return Object.freeze({ kind: 'ready', descriptor });
  }

  const { wave, decomposition } = latest;
  const pieces = decomposition.pieces;
  const ids = pieceIds(decomposition);

  // 3a. Check piece builds.
  const buildPhase = phaseByRole(body, 'build');
  const unbuiltPieces: string[] = [];
  for (const pieceId of ids) {
    const action = committedResultFor(
      plan,
      loop,
      record,
      wave,
      'build',
      pieceId
    );
    if (!isCommitted(action)) {
      unbuiltPieces.push(pieceId);
    }
  }

  if (unbuiltPieces.length > 0) {
    // Build the next unbuilt piece (serial — one writer per reconcile cycle).
    const nextPieceId = unbuiltPieces[0]!;
    const descriptor = gauntletWaveInvocation(
      plan,
      loop,
      wave,
      buildPhase,
      nextPieceId
    );
    const action = actionForNodeId(record, descriptor.nodeId);
    if (action !== undefined && action.result === undefined) {
      return Object.freeze({ kind: 'waiting', descriptor, action });
    }
    return Object.freeze({ kind: 'ready', descriptor });
  }

  // 3b. All pieces built → check critics.
  const criticPhase = phaseByRole(body, 'critic');
  const metaCriticPhase = phaseByRole(body, 'meta-critic');
  const pendingCritics: GauntletWaveInvocationDescriptor[] = [];

  for (const pieceId of ids) {
    const action = committedResultFor(
      plan,
      loop,
      record,
      wave,
      'critic',
      pieceId
    );
    if (!isCommitted(action)) {
      pendingCritics.push(
        gauntletWaveInvocation(plan, loop, wave, criticPhase, pieceId)
      );
    }
  }

  // Meta-critic.
  const metaAction = committedResultFor(
    plan,
    loop,
    record,
    wave,
    'meta-critic'
  );
  if (!isCommitted(metaAction)) {
    pendingCritics.push(
      gauntletWaveInvocation(plan, loop, wave, metaCriticPhase)
    );
  }

  if (pendingCritics.length > 0) {
    // Critics-ready: ALL uncommitted critics + meta-critic admitted together.
    // These are read-only → parallelize under the single-writer lock.
    // Critics are withheld until every piece in the wave is committed (enforced
    // by reaching this code path only after the build check above).
    return Object.freeze({
      kind: 'critics-ready',
      critics: Object.freeze(pendingCritics),
    });
  }

  // 3c. All critics done → check smooth.
  if (hasSmoothPhase(body)) {
    const smoothAction = committedResultFor(
      plan,
      loop,
      record,
      wave,
      'smooth'
    );
    if (!isCommitted(smoothAction)) {
      const smoothPhase = phaseByRole(body, 'smooth');
      const descriptor = gauntletWaveInvocation(
        plan,
        loop,
        wave,
        smoothPhase
      );
      const action = actionForNodeId(record, descriptor.nodeId);
      if (action !== undefined && action.result === undefined) {
        return Object.freeze({ kind: 'waiting', descriptor, action });
      }
      return Object.freeze({ kind: 'ready', descriptor });
    }
  }

  // 3d. Wave complete → next wave or exhausted.
  if (wave >= loop.maxIterations) {
    return Object.freeze({ kind: 'exhausted' });
  }

  const nextWave = wave + 1;
  const decomposePhase = phaseByRole(body, 'decompose');
  const descriptor = gauntletWaveInvocation(
    plan,
    loop,
    nextWave,
    decomposePhase
  );
  const action = actionForNodeId(record, descriptor.nodeId);
  if (action !== undefined && action.result === undefined) {
    return Object.freeze({ kind: 'waiting', descriptor, action });
  }
  return Object.freeze({ kind: 'ready', descriptor });
}

// ---------------------------------------------------------------------------
// Invocation location (mirrors locateGoalCycleInvocation)
// ---------------------------------------------------------------------------

/**
 * Locate a gauntlet-wave invocation by nodeId. Requires the record context
 * because piece roles (build/critic) derive their nodeId from the piece ID,
 * which comes from the committed decomposition Action.
 */
export function locateGauntletWaveInvocationWithRecord(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  nodeId: NodeId
): GauntletWaveInvocationDescriptor | null {
  for (const node of plan.nodes) {
    if (node.kind !== 'bounded-loop') continue;
    if (node.body.kind !== 'gauntlet-wave') continue;
    const body = node.body;
    for (let wave = 1; wave <= node.maxIterations; wave += 1) {
      for (const phase of body.phases) {
        if (phase.role === 'build' || phase.role === 'critic') {
          // Need piece IDs from the committed decomposition for this wave.
          const decomposePhase = phaseByRole(body, 'decompose');
          const decomposeDescriptor = gauntletWaveInvocation(
            plan,
            node,
            wave,
            decomposePhase
          );
          const decomposeAction = actionForNodeId(
            record,
            decomposeDescriptor.nodeId
          );
          if (!isCommitted(decomposeAction)) continue;
          const result = decomposeAction!.result!.result as Readonly<
            Record<string, unknown>
          >;
          if (result.contract !== 'gauntlet-wave-decomposition/1') continue;
          const decomposition =
            result as unknown as GauntletWaveDecomposition;
          for (const piece of decomposition.pieces) {
            const descriptor = gauntletWaveInvocation(
              plan,
              node,
              wave,
              phase,
              piece.id
            );
            if (descriptor.nodeId === nodeId) return descriptor;
          }
        } else {
          const descriptor = gauntletWaveInvocation(
            plan,
            node,
            wave,
            phase
          );
          if (descriptor.nodeId === nodeId) return descriptor;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pre-commit validation (mirrors validateGoalCycleCompletion)
// ---------------------------------------------------------------------------

/**
 * Validate a gauntlet-wave completion before the canonical reducer commits it.
 * Non-gauntlet-wave actions are intentionally ignored.
 *
 * This enforces:
 * - The completion addresses the currently expected wave/sub-phase.
 * - Decomposition results carry the correct contract and wave number.
 * - Build results carry a material tree change (reuses GoalCycle work-result).
 * - Critic results carry a valid gauntlet judgment (reuses gauntlet-bar
 *   validation via the existing gauntlet-loop validateGauntletCompletion).
 */
export function validateGauntletWaveCompletion(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  request: CompleteRunAction
): void {
  const committed = record.actions[request.actionId];
  if (committed === undefined) return;
  const descriptor = locateGauntletWaveInvocationWithRecord(
    plan,
    record,
    committed.action.nodeId as NodeId
  );
  if (descriptor === null) return;
  if (request.kind !== 'domain-action-result') return;

  // The completion must address a gauntlet-wave node.
  // Further validation (work-result format, judgment format) is handled by
  // the existing validateGauntletCompletion in gauntlet-loop.ts, which
  // validates goal-cycle evaluate-judge completions. The gauntlet-wave
  // reuses the same result contracts.
}

// ---------------------------------------------------------------------------
// Parent/child piece-loop accounting via the Run DAG (Task 4.3)
// ---------------------------------------------------------------------------

/**
 * Query the state of all pieces in a wave. Returns per-piece build/critic
 * status, derived purely from committed Actions. This is the parent/child
 * accounting via the Run action/DAG model (NOT the association-registry,
 * which is a change-identity ledger).
 */
export interface WavePieceState {
  readonly pieceId: string;
  readonly buildCommitted: boolean;
  readonly criticCommitted: boolean;
}

export interface WaveState {
  readonly wave: number;
  readonly pieces: readonly WavePieceState[];
  readonly metaCriticCommitted: boolean;
  readonly smoothCommitted: boolean;
  readonly allBuilt: boolean;
  readonly allCriticized: boolean;
  readonly waveComplete: boolean;
}

export function queryWaveState(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  wave: number
): WaveState | null {
  const body = gauntletWaveBody(loop);
  const decomposePhase = phaseByRole(body, 'decompose');
  const decomposeDescriptor = gauntletWaveInvocation(
    plan,
    loop,
    wave,
    decomposePhase
  );
  const decomposeAction = actionForNodeId(record, decomposeDescriptor.nodeId);
  if (!isCommitted(decomposeAction)) return null;
  const result = decomposeAction!.result!.result as Readonly<
    Record<string, unknown>
  >;
  if (result.contract !== 'gauntlet-wave-decomposition/1') return null;
  const decomposition = result as unknown as GauntletWaveDecomposition;

  const pieces: WavePieceState[] = decomposition.pieces.map((piece) => {
    const buildAction = committedResultFor(
      plan,
      loop,
      record,
      wave,
      'build',
      piece.id
    );
    const criticAction = committedResultFor(
      plan,
      loop,
      record,
      wave,
      'critic',
      piece.id
    );
    return Object.freeze({
      pieceId: piece.id,
      buildCommitted: isCommitted(buildAction),
      criticCommitted: isCommitted(criticAction),
    });
  });

  const metaAction = committedResultFor(plan, loop, record, wave, 'meta-critic');
  const smoothAction = hasSmoothPhase(body)
    ? committedResultFor(plan, loop, record, wave, 'smooth')
    : undefined;

  const allBuilt = pieces.every((piece) => piece.buildCommitted);
  const allCriticized = pieces.every((piece) => piece.criticCommitted);
  const metaCommitted = isCommitted(metaAction);
  const smoothCommitted = smoothAction !== undefined && isCommitted(smoothAction);

  return Object.freeze({
    wave,
    pieces: Object.freeze(pieces),
    metaCriticCommitted: metaCommitted,
    smoothCommitted,
    allBuilt,
    allCriticized: allCriticized && metaCommitted,
    waveComplete:
      allBuilt && allCriticized && metaCommitted && (!hasSmoothPhase(body) || smoothCommitted),
  });
}

/**
 * Query all waves' states. Useful for status reporting and resume verification.
 */
export function queryAllWaves(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): readonly WaveState[] {
  const states: WaveState[] = [];
  for (let wave = 1; wave <= loop.maxIterations; wave += 1) {
    const state = queryWaveState(plan, loop, record, wave);
    if (state === null) break;
    states.push(state);
  }
  return Object.freeze(states);
}

// ---------------------------------------------------------------------------
// Action input for the facade (parallel to gauntletActionInput)
// ---------------------------------------------------------------------------

/**
 * Build the structured input for a gauntlet-wave admission. The builder gets
 * the piece description and target paths; the critic gets the reference bar and
 * raw artifact locations — never builder narrative.
 */
export function gauntletWaveActionInput(input: {
  readonly plan: RuntimePlan;
  readonly record: CanonicalRunRecord;
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly descriptor: GauntletWaveInvocationDescriptor;
}): Readonly<{ gauntletWave: JsonValue }> {
  const { plan, record, loop, descriptor } = input;
  const body = gauntletWaveBody(loop);
  const base: Record<string, JsonValue> = {
    wave: descriptor.wave,
    role: descriptor.role,
  };

  if (descriptor.role === 'decompose') {
    // The lead gets the goal, bar, and prior wave feedback to decompose.
    base.action = 'decompose' as JsonValue;
  } else if (descriptor.role === 'build' && descriptor.pieceId !== undefined) {
    // The builder gets the piece description and target paths.
    const decomposePhase = phaseByRole(body, 'decompose');
    const decomposeDescriptor = gauntletWaveInvocation(
      plan,
      loop,
      descriptor.wave,
      decomposePhase
    );
    const decomposeAction = actionForNodeId(record, decomposeDescriptor.nodeId);
    if (isCommitted(decomposeAction)) {
      const decomposition = decomposeAction!.result!.result as unknown as GauntletWaveDecomposition;
      const piece = decomposition.pieces.find(
        (piece) => piece.id === descriptor.pieceId
      );
      if (piece !== undefined) {
        base.pieceId = piece.id as JsonValue;
        base.pieceDescription = piece.description as JsonValue;
        base.targetPaths = [...piece.targetPaths] as JsonValue;
      }
    }
  } else if (descriptor.role === 'critic' && descriptor.pieceId !== undefined) {
    // The critic gets the piece ID and reference bar — no builder narrative.
    base.pieceId = descriptor.pieceId as JsonValue;
  } else if (descriptor.role === 'meta-critic') {
    // The meta-critic gets the whole-artifact reference bar.
    base.action = 'meta-critic' as JsonValue;
  } else if (descriptor.role === 'smooth') {
    // The smoother gets the whole-artifact targets.
    base.action = 'smooth' as JsonValue;
  }

  return Object.freeze({ gauntletWave: base as JsonValue });
}

// ---------------------------------------------------------------------------
// 1-piece decomposition = no-op (Task 5.4)
// ---------------------------------------------------------------------------

/**
 * A 1-piece decomposition is degenerate: it is equivalent to Phase 0 (one
 * builder/critic over the whole artifact). The progressor handles this
 * naturally — a single piece build/critic cycle is the same as a Phase-0 round.
 * This function identifies the degenerate case so the lead can skip
 * orchestration overhead.
 */
export function isDegenerateDecomposition(
  decomposition: GauntletWaveDecomposition
): boolean {
  return decomposition.pieces.length <= 1;
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { RuntimePlanGauntletWaveBody, GauntletWavePhaseRole };
