import { describe, expect, it } from 'vitest';

import type {
  ActionId,
  Digest,
  NodeId,
  RunId,
} from '../../../src/core/change-run/contracts.js';
import { deriveNodeId } from '../../../src/core/change-run/internal/identity.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanBoundedLoopNode,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  gauntletWaveInvocationPath,
  gauntletWaveInvocation,
  projectGauntletWaveProgress,
  queryWaveState,
  isDegenerateDecomposition,
  locateGauntletWaveInvocationWithRecord,
  type GauntletWaveDecomposition,
  type GauntletWaveInvocationDescriptor,
} from '../../../src/core/change-run/internal/gauntlet-wave.js';
import {
  buildWaveDecomposition,
  assertOneLevelDecomposition,
  decidePhaseTransition,
  decideSmoothing,
  adviseDegenerateDecomposition,
  GAUNTLET_LEAD_CONTRACT,
} from '../../../src/core/change-run/internal/gauntlet-lead.js';
import { selectCompatibleAdmissions } from '../../../src/core/change-run/internal/reconciler.js';
import { startRecord } from './reconciler-fixture.js';
import type { CanonicalRunRecord, CommittedAction } from '../../../src/core/change-run/internal/record.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const branded = <T>(value: string): T => value as T;
const digest = (char: string): Digest =>
  branded<Digest>(`sha256:${char.repeat(64)}`);

function gauntletWavePlan(
  maxIterations = 5,
  withSmooth = true
): RuntimePlan {
  const phases = [
    {
      role: 'decompose' as const,
      profilePath: 'declaration:gauntlet-wave/node:decompose',
      admissionKind: 'agent' as const,
      workspace: { access: 'write' as const },
    },
    {
      role: 'build' as const,
      profilePath: 'declaration:gauntlet-wave/node:build',
      admissionKind: 'agent' as const,
      workspace: { access: 'write' as const },
    },
    {
      role: 'critic' as const,
      profilePath: 'declaration:gauntlet-wave/node:critic',
      admissionKind: 'agent' as const,
      workspace: { access: 'read' as const },
    },
    {
      role: 'meta-critic' as const,
      profilePath: 'declaration:gauntlet-wave/node:meta-critic',
      admissionKind: 'agent' as const,
      workspace: { access: 'read' as const },
    },
  ];
  if (withSmooth) {
    phases.push({
      role: 'smooth' as const,
      profilePath: 'declaration:gauntlet-wave/node:smooth',
      admissionKind: 'agent' as const,
      workspace: { access: 'write' as const },
    });
  }
  return createRuntimePlan({
    runId: branded<RunId>(`run:${'a'.repeat(64)}`),
    pipeline: 'gauntlet-loop',
    planDigest: digest('1'),
    profileDigest: digest('2'),
    sourceRevisionDigest: digest('3'),
    capabilityDigest: digest('4'),
    policyDigest: digest('5'),
    implicitFinishOutcome: 'gauntlet-completed',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/gauntlet-wave',
        requires: [],
        maxIterations,
        body: {
          kind: 'gauntlet-wave',
          phases,
        },
        outcomes: {
          clean: 'converged',
          exhausted: 'gauntlet_wave_exhausted',
        },
      },
    ],
  });
}

function loopOf(plan: RuntimePlan): RuntimePlanBoundedLoopNode {
  const node = plan.nodes.find(
    (n): n is RuntimePlanBoundedLoopNode =>
      n.kind === 'bounded-loop' && n.body.kind === 'gauntlet-wave'
  );
  if (node === undefined) throw new Error('No gauntlet-wave loop in plan');
  return node;
}

/**
 * Create a mock committed action for a gauntlet-wave nodeId. This bypasses the
 * full reducer for unit-testing the progressor's state machine.
 */
function mockCommittedAction(
  plan: RuntimePlan,
  hierarchicalPath: string,
  result: unknown
): Readonly<{ action: { nodeId: NodeId; actionId: string }; result: { status: 'succeeded'; result: unknown; evidence: readonly never[] } }> {
  const nodeId = deriveNodeId(plan.runId, hierarchicalPath);
  return {
    action: {
      nodeId,
      actionId: `action:${hierarchicalPath}` as string,
    },
    result: {
      status: 'succeeded' as const,
      result,
      evidence: [],
    },
  };
}

/**
 * Build a record-like object with committed actions for specific paths.
 */
function recordWithActions(
  plan: RuntimePlan,
  actions: ReadonlyArray<ReturnType<typeof mockCommittedAction>>
): CanonicalRunRecord {
  const base = startRecord(plan);
  const actionMap: Record<string, CommittedAction> = {};
  for (const action of actions) {
    actionMap[action.action.actionId] = action as unknown as CommittedAction;
  }
  return {
    ...base,
    actions: actionMap,
  } as CanonicalRunRecord;
}

function sampleDecomposition(wave: number, pieces = 3): GauntletWaveDecomposition {
  const pieceList = Array.from({ length: pieces }, (_, i) => ({
    id: `piece-${i + 1}`,
    description: `Piece ${i + 1} of the artifact`,
    targetPaths: [`src/module-${i + 1}.ts`],
  }));
  return buildWaveDecomposition({ wave, pieces: pieceList });
}

// ---------------------------------------------------------------------------
// 4.1 — gauntlet-wave body kind validation
// ---------------------------------------------------------------------------

describe('gauntlet-wave body kind (Task 4.1)', () => {
  it('createRuntimePlan accepts a gauntlet-wave body with 4 required phases', () => {
    const p = gauntletWavePlan(5, false);
    const loop = loopOf(p);
    expect(loop.body.kind).toBe('gauntlet-wave');
    if (loop.body.kind !== 'gauntlet-wave') return;
    expect(loop.body.phases).toHaveLength(4);
    expect(loop.body.phases.map((ph) => ph.role)).toEqual([
      'decompose',
      'build',
      'critic',
      'meta-critic',
    ]);
  });

  it('createRuntimePlan accepts a gauntlet-wave body with 5 phases (smooth)', () => {
    const p = gauntletWavePlan(5, true);
    const loop = loopOf(p);
    if (loop.body.kind !== 'gauntlet-wave') return;
    expect(loop.body.phases).toHaveLength(5);
    expect(loop.body.phases[4]!.role).toBe('smooth');
  });

  it('sets read access for critic and meta-critic, write for others', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    if (loop.body.kind !== 'gauntlet-wave') return;
    const access = (role: string) =>
      loop.body.kind === 'gauntlet-wave'
        ? loop.body.phases.find((ph) => ph.role === role)?.workspace.access
        : undefined;
    expect(access('decompose')).toBe('write');
    expect(access('build')).toBe('write');
    expect(access('critic')).toBe('read');
    expect(access('meta-critic')).toBe('read');
    expect(access('smooth')).toBe('write');
  });

  it('rejects a gauntlet-wave body with missing required phases', () => {
    expect(() =>
      createRuntimePlan({
        runId: branded<RunId>(`run:${'a'.repeat(64)}`),
        pipeline: 'gauntlet-loop',
        planDigest: digest('1'),
        profileDigest: digest('2'),
        sourceRevisionDigest: digest('3'),
        capabilityDigest: digest('4'),
        policyDigest: digest('5'),
        implicitFinishOutcome: 'x',
        nodes: [
          {
            kind: 'bounded-loop',
            hierarchicalPath: 'root/gw',
            requires: [],
            maxIterations: 3,
            body: {
              kind: 'gauntlet-wave',
              phases: [
                {
                  role: 'decompose',
                  profilePath: 'p:d',
                  admissionKind: 'agent',
                },
                {
                  role: 'build',
                  profilePath: 'p:b',
                  admissionKind: 'agent',
                },
              ],
            },
            outcomes: { clean: 'c', exhausted: 'e' },
          },
        ],
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4.2 — piece-loops are non-nested children
// ---------------------------------------------------------------------------

describe('non-nested piece children (Task 4.2)', () => {
  it('piece nodeIds are derived from hierarchical paths, not nested BoundedLoop nodes', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);

    // The plan has exactly ONE bounded-loop node — the gauntlet-wave itself.
    const boundedLoops = p.nodes.filter((n) => n.kind === 'bounded-loop');
    expect(boundedLoops).toHaveLength(1);

    // Piece paths are children of the loop's hierarchical path, but they are
    // NOT separate plan nodes.
    const decomposePath = gauntletWaveInvocationPath(
      loop.hierarchicalPath,
      1,
      'decompose'
    );
    const pieceBuildPath = gauntletWaveInvocationPath(
      loop.hierarchicalPath,
      1,
      'build',
      'piece-1'
    );
    expect(decomposePath).toBe('root/gauntlet-wave/wave:1/decompose');
    expect(pieceBuildPath).toBe('root/gauntlet-wave/wave:1/piece:piece-1/build');
  });

  it('gauntletWaveInvocation derives correct descriptor for each role', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    if (loop.body.kind !== 'gauntlet-wave') return;

    const decomposePhase = loop.body.phases.find((ph) => ph.role === 'decompose')!;
    const buildPhase = loop.body.phases.find((ph) => ph.role === 'build')!;
    const criticPhase = loop.body.phases.find((ph) => ph.role === 'critic')!;
    const metaPhase = loop.body.phases.find((ph) => ph.role === 'meta-critic')!;

    const decomposeDesc = gauntletWaveInvocation(p, loop, 1, decomposePhase);
    expect(decomposeDesc.role).toBe('decompose');
    expect(decomposeDesc.wave).toBe(1);
    expect(decomposeDesc.workspace.access).toBe('write');

    const buildDesc = gauntletWaveInvocation(p, loop, 1, buildPhase, 'piece-1');
    expect(buildDesc.role).toBe('build');
    expect(buildDesc.pieceId).toBe('piece-1');
    expect(buildDesc.workspace.access).toBe('write');

    const criticDesc = gauntletWaveInvocation(p, loop, 1, criticPhase, 'piece-1');
    expect(criticDesc.role).toBe('critic');
    expect(criticDesc.pieceId).toBe('piece-1');
    expect(criticDesc.workspace.access).toBe('read');

    const metaDesc = gauntletWaveInvocation(p, loop, 1, metaPhase);
    expect(metaDesc.role).toBe('meta-critic');
    expect(metaDesc.workspace.access).toBe('read');
  });
});

// ---------------------------------------------------------------------------
// 4.3 — parent/child piece-loop accounting via Run DAG
// ---------------------------------------------------------------------------

describe('parent/child DAG accounting (Task 4.3)', () => {
  it('queryWaveState returns null when no decomposition exists', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const record = startRecord(p);
    expect(queryWaveState(p, loop, record, 1)).toBeNull();
  });

  it('queryWaveState returns piece states after decomposition + builds', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    // Decomposition + build for piece-1 committed.
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const record = recordWithActions(p, actions);

    const state = queryWaveState(p, loop, record, 1);
    expect(state).not.toBeNull();
    expect(state!.wave).toBe(1);
    expect(state!.pieces).toHaveLength(2);
    expect(state!.pieces[0]!.buildCommitted).toBe(true);
    expect(state!.pieces[1]!.buildCommitted).toBe(false);
    expect(state!.allBuilt).toBe(false);
  });

  it('queryWaveState reports allBuilt when all pieces are built', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const record = recordWithActions(p, actions);

    const state = queryWaveState(p, loop, record, 1);
    expect(state!.allBuilt).toBe(true);
    expect(state!.allCriticized).toBe(false);
    expect(state!.waveComplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4.4 — decomposition as replayable committed Actions
// ---------------------------------------------------------------------------

describe('replayable decomposition (Task 4.4)', () => {
  it('the plan digest is unchanged whether or not decompositions are committed', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    // Before decomposition.
    const emptyRecord = startRecord(p);
    const progressBefore = projectGauntletWaveProgress(p, loop, emptyRecord);

    // After decomposition.
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
    ];
    const recordAfter = recordWithActions(p, actions);
    const progressAfter = projectGauntletWaveProgress(p, loop, recordAfter);

    // The plan digest is the same — decomposition is a committed Action,
    // not a plan mutation.
    expect(p.planDigest).toBe(emptyRecord.planDigest);
    expect(p.planDigest).toBe(recordAfter.planDigest);

    // Progress changes (decompose-ready → build-ready).
    expect(progressBefore.kind).toBe('ready');
    expect(progressAfter.kind).toBe('ready');
    if (progressAfter.kind !== 'ready') return;
    expect(progressAfter.descriptor.role).toBe('build');
    expect(progressAfter.descriptor.pieceId).toBe('piece-1');
  });

  it('resume reconstructs wave structure from the event log', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    // Simulate: commit decomposition + one build, then "resume" by projecting
    // from the record.
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const record = recordWithActions(p, actions);

    // On resume, the progressor should reconstruct wave 1 with piece-1 built
    // and piece-2 pending.
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('piece-2');
  });
});

// ---------------------------------------------------------------------------
// 4.5 — two-sub-phase staging
// ---------------------------------------------------------------------------

describe('two-sub-phase staging (Task 4.5)', () => {
  it('empty record → ready for wave 1 decompose (write access)', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const record = startRecord(p);
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('decompose');
    expect(progress.descriptor.workspace.access).toBe('write');
  });

  it('after decomposition → ready for first piece build (write access)', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 3);
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.workspace.access).toBe('write');
  });

  it('builds serialize: only one build candidate at a time', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 3);

    // Commit decomposition + piece-1 build.
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);

    // Should be ready for piece-2 build (next unbuilt piece).
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('piece-2');
  });

  it('critics withheld until every piece in the wave is committed', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 3);

    // Only 2 of 3 pieces built.
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);

    // Should still be ready for piece-3 build, NOT critics-ready.
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('piece-3');
  });

  it('after all builds → critics-ready with ALL critics + meta-critic (read access)', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 3);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-3/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);

    // Should be critics-ready: all piece critics + meta-critic.
    expect(progress.kind).toBe('critics-ready');
    if (progress.kind !== 'critics-ready') return;
    // 3 piece critics + 1 meta-critic = 4.
    expect(progress.critics).toHaveLength(4);
    // All should have read access.
    for (const critic of progress.critics) {
      expect(critic.workspace.access).toBe('read');
    }
    // Verify roles.
    const roles = progress.critics.map((c) => c.role).sort();
    expect(roles).toEqual(['critic', 'critic', 'critic', 'meta-critic']);
  });

  it('critic parallelism realized under selectCompatibleAdmissions', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('critics-ready');
    if (progress.kind !== 'critics-ready') return;

    // Pass all critics through selectCompatibleAdmissions with no active lock.
    const candidates = progress.critics.map((descriptor) => ({
      nodeId: descriptor.nodeId,
      occurrence: 0,
      admissionKind: descriptor.admissionKind,
      access: descriptor.workspace.access as 'read' | 'write' | 'none',
    }));
    const selection = selectCompatibleAdmissions(candidates, {
      writerActive: false,
      readerActive: false,
    });

    // All readers should be admitted together (parallel).
    expect(selection.admitted).toHaveLength(3);
    expect(selection.blocked).toHaveLength(0);
  });

  it('a single writer blocks all readers (serialization)', () => {
    const candidates = [
      { nodeId: 'a' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'write' as const },
      { nodeId: 'b' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'read' as const },
      { nodeId: 'c' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'read' as const },
    ];
    const selection = selectCompatibleAdmissions(candidates, {
      writerActive: false,
      readerActive: false,
    });
    // First sorted candidate is a writer → only it is admitted.
    expect(selection.admitted).toHaveLength(1);
    expect(selection.admitted[0]!.access).toBe('write');
    expect(selection.blocked).toHaveLength(2);
  });

  it('after all critics + meta-critic �� smooth-ready (if smooth phase exists)', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/critic', {
        contract: 'goal-cycle/evaluate-judge/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/critic', {
        contract: 'goal-cycle/evaluate-judge/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/meta-critic', {
        contract: 'goal-cycle/evaluate-judge/1',
      }),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('smooth');
    expect(progress.descriptor.workspace.access).toBe('write');
  });

  it('after wave complete → ready for next wave decompose', () => {
    const p = gauntletWavePlan(5);
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/meta-critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/smooth', {}),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.wave).toBe(2);
    expect(progress.descriptor.role).toBe('decompose');
  });

  it('maxIterations reached → exhausted', () => {
    const p = gauntletWavePlan(1);
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 1);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/meta-critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/smooth', {}),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('exhausted');
  });
});

// ---------------------------------------------------------------------------
// 5.1 — lead role
// ---------------------------------------------------------------------------

describe('lead role (Task 5.1)', () => {
  it('GAUNTLET_LEAD_CONTRACT defines the five responsibilities', () => {
    expect(GAUNTLET_LEAD_CONTRACT.role).toBe('gauntlet-lead');
    expect(GAUNTLET_LEAD_CONTRACT.responsibilities.length).toBeGreaterThanOrEqual(4);
    expect(GAUNTLET_LEAD_CONTRACT.responsibilities).toContain(
      'Decide when to transition from Phase 0 to Phase 1+ (sovereign over meta-critic advisory)'
    );
  });

  it('decidePhaseTransition returns transition when lead judges transition', () => {
    const decision = decidePhaseTransition({
      metaCriticAdvisory: { kind: 'needs-more-foundation', biggestGap: 'gap' },
      leadJudgment: 'transition',
      reason: 'Foundation is coherent enough.',
    });
    expect(decision.kind).toBe('transition');
  });

  it('decidePhaseTransition is sovereign over meta-critic advisory', () => {
    // Meta-critic says ready, but lead decides to stay.
    const decision = decidePhaseTransition({
      metaCriticAdvisory: { kind: 'ready-to-decompose', biggestGap: 'gap' },
      leadJudgment: 'stay',
      reason: 'Need more foundation work.',
    });
    expect(decision.kind).toBe('stay-phase-0');

    // Meta-critic says needs more, but lead decides to transition.
    const decision2 = decidePhaseTransition({
      metaCriticAdvisory: { kind: 'needs-more-foundation', biggestGap: 'gap' },
      leadJudgment: 'transition',
      reason: 'I judge it ready.',
    });
    expect(decision2.kind).toBe('transition');
  });
});

// ---------------------------------------------------------------------------
// 5.2 — one-level decomposition
// ---------------------------------------------------------------------------

describe('one-level decomposition (Task 5.2)', () => {
  it('buildWaveDecomposition creates a valid decomposition', () => {
    const decomp = buildWaveDecomposition({
      wave: 1,
      pieces: [
        {
          id: 'auth',
          description: 'Authentication module',
          targetPaths: ['src/auth.ts'],
        },
        {
          id: 'ui',
          description: 'UI components',
          targetPaths: ['src/ui/'],
        },
      ],
    });
    expect(decomp.contract).toBe('gauntlet-wave-decomposition/1');
    expect(decomp.wave).toBe(1);
    expect(decomp.pieces).toHaveLength(2);
    expect(decomp.pieces[0]!.id).toBe('auth');
  });

  it('buildWaveDecomposition rejects empty pieces', () => {
    expect(() =>
      buildWaveDecomposition({ wave: 1, pieces: [] })
    ).toThrow();
  });

  it('buildWaveDecomposition rejects duplicate piece IDs', () => {
    expect(() =>
      buildWaveDecomposition({
        wave: 1,
        pieces: [
          { id: 'x', description: 'd', targetPaths: ['a'] },
          { id: 'x', description: 'd', targetPaths: ['b'] },
        ],
      })
    ).toThrow();
  });

  it('assertOneLevelDecomposition accepts flat pieces', () => {
    const decomp = sampleDecomposition(1, 3);
    expect(() => assertOneLevelDecomposition(decomp)).not.toThrow();
  });

  it('assertOneLevelDecomposition rejects pieces with nested decomposition', () => {
    const nestedPiece = {
      id: 'nested',
      description: 'A piece with nested decomposition',
      targetPaths: ['src/nested.ts'],
      pieces: [{ id: 'sub', description: 'sub', targetPaths: ['x'] }],
    } as unknown as { id: string; description: string; targetPaths: string[] };
    const decomp = {
      contract: 'gauntlet-wave-decomposition/1',
      wave: 1,
      pieces: [nestedPiece],
    } as unknown as GauntletWaveDecomposition;
    expect(() => assertOneLevelDecomposition(decomp)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5.3 — optional fresh smoothing pass
// ---------------------------------------------------------------------------

describe('smoothing pass (Task 5.3)', () => {
  it('decideSmoothing returns smooth when lead judges smoothing', () => {
    const decision = decideSmoothing({
      metaCriticAdvisory: { kind: 'neutral' },
      remainingWaves: 3,
      leadJudgment: 'smooth',
      reason: 'Pieces need integration.',
    });
    expect(decision.kind).toBe('smooth');
  });

  it('decideSmoothing returns skip when lead judges skip', () => {
    const decision = decideSmoothing({
      metaCriticAdvisory: { kind: 'ready-to-decompose', biggestGap: 'gap' },
      remainingWaves: 2,
      leadJudgment: 'skip',
      reason: 'No integration gaps.',
    });
    expect(decision.kind).toBe('skip');
  });

  it('decideSmoothing returns skip when no remaining waves', () => {
    const decision = decideSmoothing({
      metaCriticAdvisory: { kind: 'neutral' },
      remainingWaves: 0,
      leadJudgment: 'smooth',
      reason: 'Want to smooth.',
    });
    expect(decision.kind).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// 5.4 — 1-piece decomposition = no-op
// ---------------------------------------------------------------------------

describe('1-piece no-op (Task 5.4)', () => {
  it('isDegenerateDecomposition returns true for 1-piece', () => {
    const decomp = buildWaveDecomposition({
      wave: 1,
      pieces: [
        { id: 'whole', description: 'The whole artifact', targetPaths: ['src/'] },
      ],
    });
    expect(isDegenerateDecomposition(decomp)).toBe(true);
  });

  it('isDegenerateDecomposition returns false for multi-piece', () => {
    const decomp = sampleDecomposition(1, 3);
    expect(isDegenerateDecomposition(decomp)).toBe(false);
  });

  it('adviseDegenerateDecomposition advises staying in Phase 0 for 1-piece', () => {
    const decomp = buildWaveDecomposition({
      wave: 1,
      pieces: [
        { id: 'whole', description: 'The whole artifact', targetPaths: ['src/'] },
      ],
    });
    const advice = adviseDegenerateDecomposition(decomp);
    expect(advice.degenerate).toBe(true);
    expect(advice.advice).toContain('Phase 0');
  });

  it('1-piece decomposition still works in the progressor (no crash)', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = buildWaveDecomposition({
      wave: 1,
      pieces: [
        { id: 'whole', description: 'The whole artifact', targetPaths: ['src/'] },
      ],
    });
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);
    // Should proceed normally — build the single piece.
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('whole');
  });
});

// ---------------------------------------------------------------------------
// Invocation location
// ---------------------------------------------------------------------------

describe('locateGauntletWaveInvocationWithRecord', () => {
  it('locates a decompose invocation', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const record = startRecord(p);
    if (loop.body.kind !== 'gauntlet-wave') return;
    const decomposePhase = loop.body.phases.find((ph) => ph.role === 'decompose')!;
    const descriptor = gauntletWaveInvocation(p, loop, 1, decomposePhase);
    const located = locateGauntletWaveInvocationWithRecord(
      p,
      record,
      descriptor.nodeId
    );
    expect(located).not.toBeNull();
    expect(located!.role).toBe('decompose');
    expect(located!.wave).toBe(1);
  });

  it('locates a piece build invocation after decomposition is committed', () => {
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);
    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
    ];
    const record = recordWithActions(p, actions);
    if (loop.body.kind !== 'gauntlet-wave') return;
    const buildPhase = loop.body.phases.find((ph) => ph.role === 'build')!;
    const descriptor = gauntletWaveInvocation(p, loop, 1, buildPhase, 'piece-1');
    const located = locateGauntletWaveInvocationWithRecord(
      p,
      record,
      descriptor.nodeId
    );
    expect(located).not.toBeNull();
    expect(located!.role).toBe('build');
    expect(located!.pieceId).toBe('piece-1');
  });
});

// ---------------------------------------------------------------------------
// 8.2 — Resume/replay: interruption after decomposition, reconstruction,
//        sealed plan digest, no duplicate admission
// ---------------------------------------------------------------------------

describe('resume/replay after wave decomposition (Task 8.2)', () => {
  it('reconstructs wave structure from committed Actions on resume', () => {
    // Simulate: commit decomposition + piece-1 build, then "stop" and "resume"
    // by projecting from the record. The progressor must reconstruct the
    // exact same wave state without re-doing completed work.
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 3);

    const partialActions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const partialRecord = recordWithActions(p, partialActions);

    // "Resume" — project progress from the committed state.
    const resumedProgress = projectGauntletWaveProgress(p, loop, partialRecord);
    expect(resumedProgress.kind).toBe('ready');
    if (resumedProgress.kind !== 'ready') return;
    expect(resumedProgress.descriptor.role).toBe('build');
    expect(resumedProgress.descriptor.pieceId).toBe('piece-2');

    // The wave state is queryable after resume.
    const waveState = queryWaveState(p, loop, partialRecord, 1);
    expect(waveState).not.toBeNull();
    expect(waveState!.pieces[0]!.buildCommitted).toBe(true);
    expect(waveState!.pieces[1]!.buildCommitted).toBe(false);
    expect(waveState!.pieces[2]!.buildCommitted).toBe(false);
  });

  it('the sealed plan digest is unchanged across decomposition + builds', () => {
    // The decomposition is a committed Action, not a plan mutation.
    // The plan digest must be byte-identical before and after decomposition.
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    const emptyRecord = startRecord(p);
    const digestBefore = emptyRecord.planDigest;

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {
        contract: 'goal-cycle/work-result/1',
      }),
    ];
    const fullRecord = recordWithActions(p, actions);
    const digestAfter = fullRecord.planDigest;

    expect(digestBefore).toBe(digestAfter);
    expect(digestBefore).toBe(p.planDigest);
  });

  it('resume after partial critic commit: only pending critics remain', () => {
    // Commit decomposition + all builds + piece-1 critic, then resume.
    // The progressor should only admit the pending critics.
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {
        contract: 'goal-cycle/work-result/1',
      }),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/critic', {
        contract: 'goal-cycle/evaluate-judge/1',
      }),
    ];
    const record = recordWithActions(p, actions);

    const progress = projectGauntletWaveProgress(p, loop, record);
    // Should be critics-ready with only the pending critics (piece-2 critic + meta-critic).
    expect(progress.kind).toBe('critics-ready');
    if (progress.kind !== 'critics-ready') return;
    expect(progress.critics).toHaveLength(2);
    const roles = progress.critics.map((c) => c.role).sort();
    expect(roles).toEqual(['critic', 'meta-critic']);
  });

  it('no duplicate phase/piece admission on resume (idempotent reconstruction)', () => {
    // After fully completing wave 1 (all phases), resume should advance to
    // wave 2 decompose — NOT re-admit any wave 1 action.
    const p = gauntletWavePlan(5);
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 2);

    const wave1Complete = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/meta-critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/smooth', {}),
    ];
    const record = recordWithActions(p, wave1Complete);

    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    // Next is wave 2 decompose, not any wave 1 action.
    expect(progress.descriptor.wave).toBe(2);
    expect(progress.descriptor.role).toBe('decompose');

    // All wave 1 pieces are committed — no re-admission.
    const wave1State = queryWaveState(p, loop, record, 1);
    expect(wave1State!.waveComplete).toBe(true);
  });

  it('reconstruction handles multi-wave resume (wave 2 mid-build)', () => {
    // Simulate: wave 1 fully done, wave 2 decomposed + piece-1 built.
    const p = gauntletWavePlan(5);
    const loop = loopOf(p);
    const decomp1 = sampleDecomposition(1, 2);
    const decomp2 = buildWaveDecomposition({
      wave: 2,
      pieces: [
        { id: 'w2-a', description: 'Wave 2 piece A', targetPaths: ['src/a.ts'] },
        { id: 'w2-b', description: 'Wave 2 piece B', targetPaths: ['src/b.ts'] },
      ],
    });

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp1),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/meta-critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/smooth', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:2/decompose', decomp2),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:2/piece:w2-a/build', {}),
    ];
    const record = recordWithActions(p, actions);

    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.wave).toBe(2);
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('w2-b');
  });
});

// ---------------------------------------------------------------------------
// 8.4 — Parallelism: explicit staging-order assertion
// ---------------------------------------------------------------------------

describe('parallelism staging order (Task 8.4)', () => {
  it('full staging sequence: decompose → serial builds → parallel critics → smooth → next wave', () => {
    // Trace the full staging order for a 3-piece wave with smoothing.
    const p = gauntletWavePlan(5, true);
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 3);

    // Step 0: no decomposition → decompose-ready (write).
    let record = startRecord(p);
    let progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('decompose');
    expect(progress.descriptor.workspace.access).toBe('write');

    // Step 1: after decompose → piece-1 build (write, serial).
    record = recordWithActions(p, [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
    ]);
    progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('piece-1');
    expect(progress.descriptor.workspace.access).toBe('write');

    // Step 2: piece-1 done → piece-2 build (still serial, still write).
    record = recordWithActions(p, [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
    ]);
    progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('piece-2');

    // Step 3: piece-2 done → piece-3 build (last serial build).
    record = recordWithActions(p, [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {}),
    ]);
    progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('build');
    expect(progress.descriptor.pieceId).toBe('piece-3');

    // Step 4: ALL pieces built → critics-ready (ALL parallel, read-only).
    // Critics are NEVER candidates before this point (enforced by reaching here
    // only after the build check).
    record = recordWithActions(p, [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-3/build', {}),
    ]);
    progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('critics-ready');
    if (progress.kind !== 'critics-ready') return;
    // 3 piece critics + 1 meta-critic = 4 parallel readers.
    expect(progress.critics).toHaveLength(4);
    for (const critic of progress.critics) {
      expect(critic.workspace.access).toBe('read');
    }

    // Step 5: all critics done → smooth-ready (write, whole artifact).
    record = recordWithActions(p, [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-3/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-3/critic', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/meta-critic', {}),
    ]);
    progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.descriptor.role).toBe('smooth');
    expect(progress.descriptor.workspace.access).toBe('write');
  });

  it('piece-builders serialize under the single-writer lock (one writer per reconcile cycle)', () => {
    // Even if multiple builders were candidates, selectCompatibleAdmissions
    // admits at most ONE writer per cycle.
    const candidates = [
      { nodeId: 'a' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'write' as const },
      { nodeId: 'b' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'write' as const },
      { nodeId: 'c' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'write' as const },
    ];
    const selection = selectCompatibleAdmissions(candidates, {
      writerActive: false,
      readerActive: false,
    });
    // Only one writer is admitted.
    expect(selection.admitted).toHaveLength(1);
    expect(selection.blocked).toHaveLength(2);
  });

  it('piece-critics and meta-critic parallelize under the single-writer lock (all readers together)', () => {
    // When all builds are committed, ALL critics (readers) are admitted together.
    const p = gauntletWavePlan();
    const loop = loopOf(p);
    const decomp = sampleDecomposition(1, 3);

    const actions = [
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/decompose', decomp),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-1/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-2/build', {}),
      mockCommittedAction(p, 'root/gauntlet-wave/wave:1/piece:piece-3/build', {}),
    ];
    const record = recordWithActions(p, actions);
    const progress = projectGauntletWaveProgress(p, loop, record);
    expect(progress.kind).toBe('critics-ready');
    if (progress.kind !== 'critics-ready') return;

    // Pass all critic candidates through selectCompatibleAdmissions.
    const candidates = progress.critics.map((descriptor) => ({
      nodeId: descriptor.nodeId,
      occurrence: 0,
      admissionKind: descriptor.admissionKind,
      access: descriptor.workspace.access as 'read' | 'write' | 'none',
    }));
    const selection = selectCompatibleAdmissions(candidates, {
      writerActive: false,
      readerActive: false,
    });

    // All readers admitted together (parallel).
    expect(selection.admitted).toHaveLength(4);
    expect(selection.blocked).toHaveLength(0);
    // All admitted are readers.
    for (const admitted of selection.admitted) {
      expect(admitted.access).toBe('read');
    }
  });

  it('a writer active blocks all critic readers (critics wait until writes commit)', () => {
    // If a writer is active (e.g., the next wave's decompose), critics from
    // the prior wave must wait. This proves critics are only admitted when
    // no writer is active — the staging invariant.
    const candidates = [
      { nodeId: 'critic-1' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'read' as const },
      { nodeId: 'critic-2' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'read' as const },
      { nodeId: 'meta' as NodeId, occurrence: 0, admissionKind: 'agent' as const, access: 'read' as const },
    ];
    const selection = selectCompatibleAdmissions(candidates, {
      writerActive: true,
      readerActive: false,
    });
    // All readers blocked while a writer is active.
    expect(selection.admitted).toHaveLength(0);
    expect(selection.blocked).toHaveLength(3);
  });
});
