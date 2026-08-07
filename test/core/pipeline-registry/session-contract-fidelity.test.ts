/**
 * ECP-5 task 10.4 — session-contract fidelity (design D9, delta spec
 * `ecp-change-run-runtime` → "Recorded session guidance is placeholder until a
 * slice defines its authoritative source").
 *
 * `buildAgentAction` persists `session: { reuse, handoffTokenLimit,
 * reuseRoundLimit }` into EVERY committed agent action, and actions go into the
 * Record permanently — while nothing reads any of it in 0.1.6. Two consequences
 * this file pins:
 *
 * 1. The two limits are PLACEHOLDERS. They must keep `'default'` provenance at
 *    all four write sites, because the spec rule that protects old Records keys
 *    on exactly that: nobody chose these values. A future "helpful" cleanup that
 *    hardcodes a chosen value would silently turn a placeholder into contract —
 *    so it trips a test here instead.
 * 2. Authored reuse intent must survive resolution. The four authored scopes
 *    flatten onto two contract values, so `sessionReuseAuthored` carries the
 *    authored scope verbatim. It is undefined-dropped, so it must be INVISIBLE
 *    to existing digests.
 */
import { describe, expect, it } from 'vitest';

import { buildAgentAction } from '../../../src/core/change-run/internal/actions.js';
import type {
  ActionBuildContext,
  ActionIdentity,
} from '../../../src/core/change-run/internal/actions.js';
import {
  createRuntimeExecutionProfile,
  type EffectiveRunPolicy,
  type RuntimeCapabilityBinding,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import { canonicalJson, deriveNodeId } from '../../../src/core/change-run/internal/identity.js';
import type { Digest, RunId } from '../../../src/core/change-run/index.js';
import { withTestAttestationAuthority } from '../../fixtures/trusted-completion.js';

const branded = <T>(value: string): T => value as T;
const runId = branded<RunId>(`run:${'a'.repeat(64)}`);
const workspaceDigest = branded<Digest>(`sha256:${'c'.repeat(64)}`);
const nodeId = deriveNodeId(runId, 'stage:apply');

type AuthoredScope = 'none' | 'stage' | 'run-planner' | 'review-thread';
type PolicyStage = EffectiveRunPolicy['stages'][number];

const identity: ActionIdentity = {
  runId,
  nodeId,
  occurrence: 0,
  attemptOrdinal: 0,
  expectedBeforeWorkspace: {
    format: 'workspace-revision/1',
    head: { kind: 'commit' as const, digest: workspaceDigest, detached: false },
    treeDigest: workspaceDigest,
    dirtyWorktreeDigest: workspaceDigest,
  },
};

function capability(): RuntimeCapabilityBinding {
  return withTestAttestationAuthority({
    nodeId: 'stage:apply',
    authoredCapability: { id: 'skill:rasen-apply-change', version: 'legacy' },
    contract: { id: 'apply-change', version: '1', digest: branded(`sha256:${'1'.repeat(64)}`) },
    actionKind: 'agent',
    resultContract: {
      id: 'apply-change-result',
      version: '1',
      digest: branded(`sha256:${'2'.repeat(64)}`),
    },
    evidenceContract: {
      id: 'apply-change-evidence',
      version: '1',
      digest: branded(`sha256:${'3'.repeat(64)}`),
    },
    recovery: 'suspend-if-ambiguous',
    workspace: { access: 'write', resources: ['worktree'] },
    effects: [
      {
        slot: 'workspace',
        kind: 'workspace',
        resource: 'worktree',
        recovery: 'suspend-if-ambiguous',
      },
    ],
    adapter: {
      id: 'adapter:apply-change',
      version: '1',
      contentDigest: branded(`sha256:${'4'.repeat(64)}`),
    },
  });
}

/**
 * A resolved policy stage shaped exactly as the CLI resolver produces one:
 * the two-value `reuse` contract, plus `sessionReuseAuthored` ONLY when the
 * pipeline authored a scope.
 */
function stage(authored?: AuthoredScope): PolicyStage {
  const flattened =
    authored === undefined || authored === 'none'
      ? ('never' as const)
      : ('same-invocation' as const);
  return {
    nodeId: 'stage:apply',
    role: 'implementer',
    model: 'sonnet',
    effort: 'medium',
    runtime: 'codex',
    sandbox: 'workspace-write',
    gate: false,
    sessionReuse: flattened,
    ...(authored !== undefined ? { sessionReuseAuthored: authored } : {}),
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 1,
    provenance: {
      role: 'stage',
      model: 'default',
      effort: 'default',
      runtime: 'stage',
      sandbox: 'stage',
      gate: 'stage',
      sessionReuse: authored !== undefined ? 'stage' : 'default',
      handoffTokenLimit: 'default',
      reuseRoundLimit: 'default',
    },
  } as PolicyStage;
}

function actionFor(authored?: AuthoredScope) {
  const ctx: ActionBuildContext = {
    capability: capability(),
    stage: stage(authored) as never,
    executionProfileDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
  };
  const action = buildAgentAction(ctx, identity, { input: { change: 'fixture' } });
  return action as Extract<typeof action, { kind: 'agent' }>;
}

// ---------------------------------------------------------------------------
// The four SYNTHESIS write sites, driven through the REAL production resolver.
// Re-declaring their shapes locally would let a test pass while the production
// sites drifted — the exact failure this file exists to prevent.
// ---------------------------------------------------------------------------

function descriptor(skill: string, digest: string) {
  return {
    id: `skill:${skill}`,
    version: digest,
    availability: 'enabled' as const,
    inputs: [],
    artifacts: [],
    outcomes: ['completed'],
    limits: {},
  };
}

const SOURCE_REVISION = {
  layer: 'package',
  kind: 'pipeline-yaml',
  sourceId: 'package:session-fixture',
  authoredContentDigest: `sha256:${'7'.repeat(64)}`,
  semanticDigest: `sha256:${'8'.repeat(64)}`,
} as const;

/**
 * Synthesized stages for a v1 pipeline. Passing NO authored policy stages is
 * what routes root AtomicStages through `synthesizeDefaultPolicyStage`, while
 * the FanOut evaluator and the review-cycle body phases take their own
 * synthesis paths.
 */
function synthesizedStages(source: unknown): readonly PolicyStage[] {
  const catalog = createCapabilityCatalogSnapshot([
    descriptor('rasen-propose', `sha256:${'1'.repeat(64)}`),
    descriptor('rasen-apply-change', `sha256:${'2'.repeat(64)}`),
    descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
    descriptor('rasen-cso', `sha256:${'4'.repeat(64)}`),
    descriptor('rasen-ship', `sha256:${'5'.repeat(64)}`),
    descriptor('rasen-review-cycle', `sha256:${'6'.repeat(64)}`),
    descriptor('implement', `sha256:${'9'.repeat(64)}`),
  ]);
  const prepared = EcpDefinitionModule.prepare(source, catalog);
  if (!prepared.ok) throw prepared.error;
  return resolveRuntimeExecutionProfile(
    prepared.value,
    catalog,
    [],
    SOURCE_REVISION,
    { maxAttempts: 3, maxActions: 64 }
  ).policy.stages;
}

const PARALLEL_PIPELINE = {
  version: 1,
  name: 'session-parallel',
  description: 'v1 parallelGroup fixture (FanOut evaluator synthesis)',
  stages: [
    {
      id: 'review',
      skill: 'rasen-review',
      role: 'reviewer',
      requires: [],
      parallelGroup: 'experts',
      condition: 'always',
    },
    {
      id: 'security',
      skill: 'rasen-cso',
      role: 'reviewer',
      requires: [],
      parallelGroup: 'experts',
      condition: 'security-relevant',
    },
    { id: 'ship', skill: 'rasen-ship', role: 'shipper', requires: ['review', 'security'] },
  ],
} as const;

const REVIEW_LOOP_PIPELINE = {
  version: 1,
  name: 'session-review-loop',
  description: 'v1 review-cycle fixture (phase synthesis)',
  stages: [
    { id: 'propose', skill: 'rasen-propose', role: 'planner', requires: [] },
    { id: 'apply', skill: 'rasen-apply-change', role: 'implementer', requires: ['propose'] },
    {
      id: 'review-loop',
      skill: 'rasen-review-cycle',
      role: 'fixer',
      requires: ['apply'],
      loop: { kind: 'review-cycle' as const, maxRounds: 3 },
    },
  ],
} as const;

/** A v2-authored definition whose only root node is a Choice evaluator. */
const CHOICE_DEFINITION = {
  version: 2,
  id: 'definition-choice',
  sourceId: 'fixture:session-choice',
  name: 'session-choice',
  inputs: [],
  artifacts: [],
  outcomes: ['accepted', 'rejected'],
  declarations: [],
  root: {
    nodes: [{ id: 'choice', kind: 'Choice', outcomes: ['accepted', 'rejected'] }],
    connections: [],
  },
} as const;

function findStage(stages: readonly PolicyStage[], predicate: (id: string) => boolean): PolicyStage {
  const found = stages.find((entry) => predicate(entry.nodeId));
  if (!found) {
    throw new Error(
      `fixture produced no matching policy stage; got: ${stages.map((s) => s.nodeId).join(', ')}`
    );
  }
  return found;
}

/** `synthesizeEvaluatorPolicyStage(..., 'parallel-dispatch')`. */
function evaluatorStage(): PolicyStage {
  const stages = synthesizedStages(PARALLEL_PIPELINE);
  return findStage(stages, (id) => id.includes('fanout'));
}

/** `synthesizeEvaluatorPolicyStage(..., 'choice-select')`. */
function choiceEvaluatorStage(): PolicyStage {
  const stages = synthesizedStages(CHOICE_DEFINITION);
  return findStage(stages, (id) => id.includes('choice'));
}

/** `synthesizeReviewCyclePolicyStage` — a bounded-loop body phase. */
function reviewCycleStage(): PolicyStage {
  const stages = synthesizedStages(REVIEW_LOOP_PIPELINE);
  return findStage(stages, (id) => id.startsWith('declaration:'));
}

/** `synthesizeDefaultPolicyStage` — a root stage with no authored policy. */
function defaultStage(): PolicyStage {
  const stages = synthesizedStages(PARALLEL_PIPELINE);
  return findStage(stages, (id) => id === 'root:stage:ship');
}

describe('ECP-5 D9: authored session-reuse fidelity', () => {
  it('carries an authored review-thread scope onto the stage AND the action', () => {
    // Spec scenario: "Authored reuse scope survives resolution verbatim".
    const resolved = stage('review-thread');
    expect(resolved.sessionReuseAuthored).toBe('review-thread');
    // The two-value contract is unchanged — the additive field sits BESIDE it.
    expect(resolved.sessionReuse).toBe('same-invocation');

    const action = actionFor('review-thread');
    expect(action.agent.session.sessionReuseAuthored).toBe('review-thread');
    expect(action.agent.session.reuse).toBe('same-invocation');

    // This is the false-provenance pair the field cures: provenance says the
    // author chose something ('stage'), and now the record says WHAT.
    expect(resolved.provenance.sessionReuse).toBe('stage');
  });

  it('keeps stage, run-planner, and review-thread distinguishable in the Record', () => {
    const scopes: AuthoredScope[] = ['stage', 'run-planner', 'review-thread'];
    const recorded = scopes.map((scope) => actionFor(scope).agent.session);

    // All three flatten to the SAME two-value contract...
    expect(recorded.map((session) => session.reuse)).toEqual([
      'same-invocation',
      'same-invocation',
      'same-invocation',
    ]);
    // ...and remain fully distinguishable, which is the whole point: this is
    // intent an author expressed, and no future rule could recover it if the
    // flattening were the only thing recorded.
    expect(recorded.map((session) => session.sessionReuseAuthored)).toEqual(scopes);
    expect(new Set(recorded.map((session) => session.sessionReuseAuthored)).size).toBe(3);
  });

  it('records an authored `none` rather than treating it as unauthored', () => {
    // `none` flattens to `never`, the same value an UNAUTHORED stage gets — so
    // without the field, "the author chose no reuse" and "nobody said anything"
    // are indistinguishable.
    const action = actionFor('none');
    expect(action.agent.session.reuse).toBe('never');
    expect(action.agent.session.sessionReuseAuthored).toBe('none');
  });

  it('survives the v1 -> v2 policy remap that every built-in pipeline goes through', () => {
    // The CLI resolver emits flat `stage:<id>` policy stages; every v1 pipeline
    // with a loop or a parallel group is then remapped onto v2 hierarchical
    // paths. If the remap dropped the field, fidelity would be captured at the
    // resolver and lost before it ever reached an action — invisible to a test
    // that only checks the resolver's own output.
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-propose', `sha256:${'1'.repeat(64)}`),
      descriptor('rasen-apply-change', `sha256:${'2'.repeat(64)}`),
      // The review-cycle body's phases bind `rasen-review`.
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
      descriptor('rasen-review-cycle', `sha256:${'6'.repeat(64)}`),
    ]);
    const prepared = EcpDefinitionModule.prepare(REVIEW_LOOP_PIPELINE, catalog);
    if (!prepared.ok) throw prepared.error;

    // An authored `run-planner` scope on the flat `stage:propose` policy stage.
    const authoredFlat: PolicyStage = {
      ...stage('run-planner'),
      nodeId: 'stage:propose',
    } as PolicyStage;
    const remapped = resolveRuntimeExecutionProfile(
      prepared.value,
      catalog,
      [authoredFlat],
      SOURCE_REVISION,
      { maxAttempts: 3, maxActions: 64 }
    ).policy.stages;

    const propose = findStage(remapped, (id) => id === 'root:stage:propose');
    expect(propose.sessionReuseAuthored).toBe('run-planner');
    expect(propose.sessionReuse).toBe('same-invocation');
  });

  it('omits the field entirely when nothing was authored', () => {
    // Spec scenario: "Unauthored reuse records no fabricated intent".
    const resolved = stage();
    expect('sessionReuseAuthored' in resolved).toBe(false);

    const session = actionFor().agent.session;
    expect(session.reuse).toBe('never');
    // Absent as a KEY, not present-and-undefined: a serialized `undefined`
    // would still be a fabricated claim, and would perturb strict readers.
    expect('sessionReuseAuthored' in session).toBe(false);
    expect(JSON.stringify(session)).not.toContain('sessionReuseAuthored');
  });

  it('leaves digests byte-identical when nothing is authored', () => {
    // The field is undefined-dropped by `canonicalJson`, so introducing it
    // cannot perturb any existing Record or profile. Verified, not assumed.
    const unauthored = stage();
    const legacyShape: Record<string, unknown> = { ...unauthored };
    delete legacyShape.sessionReuseAuthored;
    expect(canonicalJson(unauthored)).toBe(canonicalJson(legacyShape));

    const profileWith = createRuntimeExecutionProfile({
      sourceRevision: {
        layer: 'package',
        kind: 'pipeline-yaml',
        sourceId: 'package:fixture',
        authoredContentDigest: `sha256:${'7'.repeat(64)}`,
        semanticDigest: `sha256:${'8'.repeat(64)}`,
      },
      capabilities: [capability()],
      policy: {
        format: 'effective-run-policy/1',
        maxAttempts: 3,
        maxActions: 64,
        stages: [unauthored],
      },
    });
    const profileWithout = createRuntimeExecutionProfile({
      sourceRevision: {
        layer: 'package',
        kind: 'pipeline-yaml',
        sourceId: 'package:fixture',
        authoredContentDigest: `sha256:${'7'.repeat(64)}`,
        semanticDigest: `sha256:${'8'.repeat(64)}`,
      },
      capabilities: [capability()],
      policy: {
        format: 'effective-run-policy/1',
        maxAttempts: 3,
        maxActions: 64,
        stages: [legacyShape as never],
      },
    });
    expect(profileWith.policyDigest).toBe(profileWithout.policyDigest);
    expect(profileWith.profileDigest).toBe(profileWithout.profileDigest);

    // An AUTHORED scope, by contrast, must change the digest — otherwise the
    // fidelity is not actually recorded.
    const authoredProfile = createRuntimeExecutionProfile({
      sourceRevision: {
        layer: 'package',
        kind: 'pipeline-yaml',
        sourceId: 'package:fixture',
        authoredContentDigest: `sha256:${'7'.repeat(64)}`,
        semanticDigest: `sha256:${'8'.repeat(64)}`,
      },
      capabilities: [capability()],
      policy: {
        format: 'effective-run-policy/1',
        maxAttempts: 3,
        maxActions: 64,
        stages: [stage('review-thread')],
      },
    });
    expect(authoredProfile.policyDigest).not.toBe(profileWithout.policyDigest);
  });
});

describe('ECP-5 D9: recorded session limits stay marked as placeholders', () => {
  /**
   * The spec rule that protects every 0.1.6-era Record keys on these values
   * being unchosen. If a future change hardcodes a "real" limit here, the
   * provenance stamp silently becomes a lie — so pin it at every write site.
   */
  it('stamps handoffTokenLimit and reuseRoundLimit `default` at every write site', () => {
    const sites: Array<[string, PolicyStage]> = [
      ['evaluator (parallel-dispatch)', evaluatorStage()],
      ['evaluator (choice-select)', choiceEvaluatorStage()],
      ['review-cycle phase', reviewCycleStage()],
      ['default synthesis', defaultStage()],
      // The CLI resolver is the fourth production write site; `stage()` above
      // mirrors the shape it emits.
      ['CLI resolver', stage()],
    ];
    for (const [site, resolved] of sites) {
      expect(resolved.handoffTokenLimit, site).toBe(10_000);
      expect(resolved.reuseRoundLimit, site).toBe(1);
      expect(resolved.provenance.handoffTokenLimit, site).toBe('default');
      expect(resolved.provenance.reuseRoundLimit, site).toBe('default');
    }
  });

  it('marks a one-shot evaluator non-reuse as DEFINITIONAL, not defaulted', () => {
    // Spec scenario: "One-shot evaluator non-reuse is definitional, not
    // defaulted" — an evaluator has no session to reuse, so `never` is implied
    // by the node's nature and a reader MAY rely on it.
    for (const [name, resolved] of [
      ['parallel-dispatch', evaluatorStage()],
      ['choice-select', choiceEvaluatorStage()],
    ] as const) {
      expect(resolved.sessionReuse, name).toBe('never');
      expect(resolved.provenance.sessionReuse, name).toBe('definition');
    }
  });

  it('keeps review-cycle and default synthesis at `default` provenance', () => {
    // Deliberately NOT lifted to `definition`: `never` is merely the
    // conservative value there, and nobody chose it. Stamping it authoritative
    // would let a future reader honor a value ECP-5 never decided — and the
    // authored-intent loss those sites suffer is repaired by
    // `sessionReuseAuthored`, not by promoting a guess.
    for (const resolved of [reviewCycleStage(), defaultStage()]) {
      expect(resolved.sessionReuse).toBe('never');
      expect(resolved.provenance.sessionReuse).toBe('default');
    }
  });

  it('never fabricates an authored scope for a synthesized stage', () => {
    for (const resolved of [
      evaluatorStage(),
      choiceEvaluatorStage(),
      reviewCycleStage(),
      defaultStage(),
    ]) {
      expect('sessionReuseAuthored' in resolved).toBe(false);
    }
  });
});
